"""/api/admin/ai/* — 연결 점검(ping)과 일별 사용량. ai.admin 게이트, 꺼짐·상류 오류 계약, 계량을 확인한다."""

from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import KST, now
from app.main import app
from app.models import AiUsageEvent
from app.routers.admin import _sum_usage_by_kst_day
from app.settings import settings
from tests.access_helpers import run_in_session
from tests.ai_helpers import (
    AI_TEST_BASE_URL,
    AI_TEST_TOKEN,
    capture_requests,
    enable_ai,
    install_ai_transport,
    read_payload,
    reply_with,
)

pytestmark = pytest.mark.usefixtures("enforce", "clean_directory", "demo_access", "clean_ai_usage")

OPS = {"X-Dev-User": "ops.member"}  # Operations 역할 → ai.admin 보유
LEAD = {"X-Dev-User": "qa.lead"}  # permission.manage만
PROD = {"X-Dev-User": "prod.member"}  # system.view만

PING = "/api/admin/ai/ping"
USAGE = "/api/admin/ai/usage"

PING_SYSTEM_PROMPT = 'Reply with the JSON object {"ok": true}.'


def _list_events() -> list[AiUsageEvent]:
    async def _list(session: AsyncSession) -> list[AiUsageEvent]:
        return list(await session.scalars(select(AiUsageEvent).order_by(AiUsageEvent.id)))

    return run_in_session(_list)


def _add_events(*events: AiUsageEvent) -> None:
    async def _add(session: AsyncSession) -> None:
        session.add_all(events)
        await session.commit()

    run_in_session(_add)


def _set_ai_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    # 로컬 .env 값이 새도 "AI 꺼짐" 경로를 보게 명시한다
    monkeypatch.setattr(settings, "ai_enabled", False)


# ── 권한 게이트 ────────────────────────────────────────────────────────────────


def test_ai_routes_are_in_the_admin_route_table() -> None:
    # test_admin_ops의 라우트 순회(권한 없는 사용자 403)가 이 둘을 빠뜨리지 않는지 — 빈 표로 조용히 건너뛰지 않게
    routes = {(method, route.path) for route in app.routes if hasattr(route, "methods") for method in route.methods}

    assert {("POST", PING), ("GET", USAGE)} <= routes


@pytest.mark.parametrize(("method", "path"), [("POST", PING), ("GET", USAGE)])
@pytest.mark.parametrize("headers", [LEAD, PROD])
def test_ai_routes_require_ai_admin(client: TestClient, method: str, path: str, headers: dict[str, str]) -> None:
    response = client.request(method, path, headers=headers)

    assert response.status_code == 403
    assert response.json() == {"detail": "missing permission: ai.admin"}


def test_ai_ping_requires_ai_admin_before_anything_runs(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    enable_ai(monkeypatch)
    seen = capture_requests(monkeypatch)

    response = client.post(PING, headers=LEAD)

    assert response.status_code == 403
    assert seen == []  # 권한 없는 사람이 사내 AI를 두드릴 수 없다
    assert _list_events() == []


def test_permission_check_comes_before_the_ai_disabled_check(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _set_ai_disabled(monkeypatch)

    response = client.post(PING, headers=LEAD)

    assert response.status_code == 403  # 설정 상태(503)로 권한 없는 사람에게 운영 정보를 흘리지 않는다


# ── ping ──────────────────────────────────────────────────────────────────────


def test_ai_ping_disabled(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _set_ai_disabled(monkeypatch)
    seen = capture_requests(monkeypatch)

    response = client.post(PING, headers=OPS)

    assert response.status_code == 503
    assert response.json() == {"detail": "AI is disabled"}
    assert seen == [] and _list_events() == []  # 시도하지 않았으니 호출도 기록도 없다


def test_ai_ping_success_records_usage(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    enable_ai(monkeypatch)
    seen = capture_requests(monkeypatch, content='{"ok": true}')

    response = client.post(PING, headers=OPS)

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"ok", "model", "latency_ms", "reply_ok"}
    assert body["ok"] is True and body["reply_ok"] is True
    assert body["model"] == "glm-test"  # 요청이 쓴 기본 모델 id
    assert isinstance(body["latency_ms"], int) and body["latency_ms"] >= 0
    # 점검 요청 — 직원 정보 없이 고정 문구만, 사고는 최소·응답 상한 256
    [request] = seen
    payload = read_payload(request)
    assert payload["messages"] == [
        {"role": "system", "content": PING_SYSTEM_PROMPT},
        {"role": "user", "content": "ping"},
    ]
    assert payload["chat_template_kwargs"] == {"reasoning_effort": "low", "clear_thinking": True}
    assert payload["max_tokens"] == 256
    # 사용량 한 행 — 누가(login_id)·무엇을(feature)·토큰
    [event] = _list_events()
    assert (event.login_id, event.feature, event.ok) == ("ops.member", "ping", True)
    assert (event.prompt_tokens, event.completion_tokens) == (11, 7)


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        pytest.param('{"ok": true}', True, id="ok-true"),
        pytest.param('{"ok": true, "extra": 1}', True, id="ok-true-with-extra-keys"),
        pytest.param('{"ok": false}', False, id="ok-false"),
        pytest.param('{"ok": "true"}', False, id="ok-string"),
        pytest.param('{"ok": 1}', False, id="ok-number"),
        pytest.param('{"fine": true}', False, id="no-ok-key"),
        pytest.param("[true]", False, id="not-an-object"),
        pytest.param("Sure! I am here.", False, id="not-json"),
        pytest.param("", False, id="empty-reply"),
    ],
)
def test_ai_ping_reply_ok_reads_the_reply_as_json(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, content: str, expected: bool
) -> None:
    enable_ai(monkeypatch)
    install_ai_transport(monkeypatch, reply_with(content))

    response = client.post(PING, headers=OPS)

    # 연결은 됐다 — 답이 기대와 달라도 오류가 아니라 reply_ok=false로 알린다
    assert response.status_code == 200
    assert response.json()["ok"] is True and response.json()["reply_ok"] is expected
    assert [event.ok for event in _list_events()] == [True]


def _raise_error(error: Exception) -> Callable[[httpx2.Request], httpx2.Response]:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise error

    return handler


# (상류 동작, 응답 detail 끝부분) — 예외 메시지에는 모두 주소를 넣는다
UPSTREAM_FAILURES = [
    pytest.param(lambda request: httpx2.Response(500), "500", id="http-500"),
    pytest.param(lambda request: httpx2.Response(401), "401", id="http-401"),
    pytest.param(_raise_error(httpx2.ConnectError(f"cannot reach {AI_TEST_BASE_URL}")), "ConnectError", id="connect"),
    pytest.param(_raise_error(httpx2.ReadTimeout(f"timed out {AI_TEST_BASE_URL}")), "ReadTimeout", id="timeout"),
    pytest.param(lambda request: httpx2.Response(200, json={"choices": []}), "IndexError", id="malformed-body"),
    pytest.param(lambda request: httpx2.Response(200, content=b"<html>"), "JSONDecodeError", id="html-body"),
]


@pytest.mark.parametrize(("handler", "shown"), UPSTREAM_FAILURES)
def test_ai_ping_upstream_error_records_failure(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx2.Request], httpx2.Response], shown: str
) -> None:
    enable_ai(monkeypatch)
    install_ai_transport(monkeypatch, handler)

    response = client.post(PING, headers=OPS)

    assert response.status_code == 502
    assert response.json() == {"detail": f"AI endpoint error: {shown}"}
    # 주소·토큰이 어느 응답에도 새지 않는다
    for secret in (AI_TEST_BASE_URL, "ai.test", AI_TEST_TOKEN):
        assert secret not in response.text
    # 502 전에 실패도 한 행으로 남는다
    [event] = _list_events()
    assert (event.login_id, event.feature, event.ok) == ("ops.member", "ping", False)
    assert (event.prompt_tokens, event.completion_tokens) == (None, None)


def test_ai_ping_bad_endpoint_config_is_a_readable_502(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "ai_endpoints", "not-json")

    response = client.post(PING, headers=OPS)

    assert response.status_code == 502
    assert response.json() == {"detail": "AI endpoint error: ValueError"}
    assert [event.ok for event in _list_events()] == [False]


# ── 일별 사용량 ────────────────────────────────────────────────────────────────

TODAY: date = now().date()


def _make_kst_time(days_ago: int, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(TODAY - timedelta(days=days_ago), time(hour, minute), tzinfo=KST)


def _make_event(when: datetime, *, ok: bool = True, tokens: tuple[int | None, int | None] = (None, None)) -> AiUsageEvent:
    return AiUsageEvent(
        occurred_at=when, login_id="ops.member", feature="ping", ok=ok,
        prompt_tokens=tokens[0], completion_tokens=tokens[1],
    )


def test_ai_usage_daily(client: TestClient) -> None:
    _add_events(
        _make_event(_make_kst_time(3, 10), tokens=(100, 50)),
        _make_event(_make_kst_time(3, 23, 30), ok=False),  # 실패 + 토큰 없음(NULL은 0으로 합산)
        _make_event(_make_kst_time(2, 0, 30), tokens=(10, 5)),  # KST 자정 직후 — UTC로 묶으면 전날로 샌다
    )

    response = client.get(USAGE, headers=OPS)

    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "date": (TODAY - timedelta(days=3)).isoformat(),
            "calls": 2, "failed": 1, "prompt_tokens": 100, "completion_tokens": 50,
        },
        {
            "date": (TODAY - timedelta(days=2)).isoformat(),
            "calls": 1, "failed": 0, "prompt_tokens": 10, "completion_tokens": 5,
        },
    ]  # 날짜 오름차순, 호출이 없던 날은 줄이 없다


def test_daily_sum_buckets_by_kst_date_whichever_zone_the_database_returns() -> None:
    # sqlite 통합 테스트는 KST 벽시계(시간대 없음)만 돌려받아 UTC 경로를 못 밟는다 — Postgres가 돌려주는 UTC 값을 직접 먹인다
    rows = [
        (datetime(2026, 11, 3, 14, 59, tzinfo=UTC), True, 1, 2),  # KST 11/3 23:59
        (datetime(2026, 11, 3, 15, 0, tzinfo=UTC), True, 3, None),  # KST 11/4 00:00 — UTC 날짜로 묶으면 11/3으로 샌다
        (datetime(2026, 11, 4, 0, 30), False, None, None),  # 시간대 없는 값은 KST 벽시계
    ]

    summary = _sum_usage_by_kst_day(rows)

    assert [(d.date, d.calls, d.failed, d.prompt_tokens, d.completion_tokens) for d in summary] == [
        (date(2026, 11, 3), 1, 0, 1, 2),
        (date(2026, 11, 4), 2, 1, 3, 0),
    ]


def test_ai_usage_is_empty_before_any_call(client: TestClient) -> None:
    assert client.get(USAGE, headers=OPS).json() == []


def test_ai_usage_is_readable_while_ai_is_disabled(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _set_ai_disabled(monkeypatch)
    _add_events(_make_event(_make_kst_time(1, 9), tokens=(1, 2)))

    response = client.get(USAGE, headers=OPS)

    assert response.status_code == 200 and response.json()[0]["calls"] == 1  # 꺼져 있어도 지난 기록은 본다


def test_ai_usage_window_is_the_last_n_kst_days_including_today(client: TestClient) -> None:
    _add_events(
        _make_event(_make_kst_time(0, 0, 0)),  # 오늘 KST 자정 정각
        _make_event(_make_kst_time(1, 23, 59)),
        _make_event(_make_kst_time(40, 12)),
    )

    def dates(days: int) -> list[str]:
        response = client.get(f"{USAGE}?days={days}", headers=OPS)
        assert response.status_code == 200
        return [row["date"] for row in response.json()]

    assert dates(1) == [TODAY.isoformat()]
    assert dates(2) == [(TODAY - timedelta(days=1)).isoformat(), TODAY.isoformat()]
    assert (TODAY - timedelta(days=40)).isoformat() not in dates(30)  # 기본값 30일 밖
    assert (TODAY - timedelta(days=40)).isoformat() in dates(60)


def test_ai_usage_default_window_is_30_days(client: TestClient) -> None:
    _add_events(_make_event(_make_kst_time(29, 12)), _make_event(_make_kst_time(30, 12)))

    rows = client.get(USAGE, headers=OPS).json()

    assert [row["date"] for row in rows] == [(TODAY - timedelta(days=29)).isoformat()]


@pytest.mark.parametrize("days", ["0", "-1", "366", "abc", ""])
def test_ai_usage_days_must_be_1_to_365(client: TestClient, days: str) -> None:
    assert client.get(f"{USAGE}?days={days}", headers=OPS).status_code == 422


@pytest.mark.parametrize("days", ["1", "365"])
def test_ai_usage_days_bounds_are_inclusive(client: TestClient, days: str) -> None:
    assert client.get(f"{USAGE}?days={days}", headers=OPS).status_code == 200


def test_ai_usage_permission_check_comes_before_validation(client: TestClient) -> None:
    assert client.get(f"{USAGE}?days=0", headers=LEAD).status_code == 403
