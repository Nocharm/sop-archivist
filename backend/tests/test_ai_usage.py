"""AI 호출 계량(app.ai_usage) — 성공·실패 모두 1행(자기 세션), 원문 없음, 실패 기록이 원래 오류를 가리지 않음."""

import asyncio
import json
import logging
from collections.abc import Callable
from typing import NoReturn

import httpx2
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import ai_usage
from app.ai_usage import call_ai_recorded, record_ai_usage
from app.models import AiUsageEvent
from app.settings import settings
from tests.access_helpers import run_in_session
from tests.ai_helpers import enable_ai, install_ai_transport, reply_with

pytestmark = pytest.mark.usefixtures("clean_ai_usage")

MESSAGES = [{"role": "system", "content": "SECRET-PROMPT-TEXT"}, {"role": "user", "content": "SECRET-QUESTION"}]


def _list_events() -> list[AiUsageEvent]:
    async def _list(session: AsyncSession) -> list[AiUsageEvent]:
        return list(await session.scalars(select(AiUsageEvent).order_by(AiUsageEvent.id)))

    return run_in_session(_list)


def _call_recorded(**overrides: object):
    kwargs = dict(login_id="ops.member", feature="unit", messages=MESSAGES)
    return asyncio.run(call_ai_recorded(**{**kwargs, **overrides}))


def _break_recording(monkeypatch: pytest.MonkeyPatch) -> None:
    """기록용 세션의 commit을 실패시킨다 — DB가 죽은 상황."""
    real_session_factory = ai_usage.SessionLocal

    def make_session() -> AsyncSession:
        session = real_session_factory()

        async def fail_commit() -> NoReturn:
            raise RuntimeError("db down")

        monkeypatch.setattr(session, "commit", fail_commit)
        return session

    monkeypatch.setattr(ai_usage, "SessionLocal", make_session)


def test_success_records_one_row_with_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_ai(monkeypatch)
    install_ai_transport(monkeypatch, reply_with("{}", prompt_tokens=12, completion_tokens=34))

    reply = _call_recorded()

    assert reply.content == "{}"
    [event] = _list_events()
    assert (event.login_id, event.feature, event.ok) == ("ops.member", "unit", True)
    assert (event.prompt_tokens, event.completion_tokens) == (12, 34)
    assert event.model == ""  # 요청 선택자 — 서버 기본 모델이면 빈 값
    assert event.occurred_at is not None


def test_row_stores_the_requested_model_selector(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_ai(monkeypatch)
    install_ai_transport(monkeypatch, reply_with("{}"))

    _call_recorded(model="glm-test")

    assert _list_events()[0].model == "glm-test"


def test_row_has_no_content_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    # 계량만 남긴다 — 프롬프트·답변 원문을 담을 수 있는 컬럼이 모델에 아예 없어야 한다
    assert set(AiUsageEvent.__table__.columns.keys()) == {
        "id", "occurred_at", "login_id", "feature", "model", "prompt_tokens", "completion_tokens", "ok",
    }
    enable_ai(monkeypatch)
    install_ai_transport(monkeypatch, reply_with("SECRET-REPLY-TEXT"))

    _call_recorded()

    [event] = _list_events()
    stored = json.dumps({column: str(getattr(event, column)) for column in AiUsageEvent.__table__.columns.keys()})
    assert "SECRET" not in stored


def test_missing_usage_from_server_is_stored_as_null(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_ai(monkeypatch)
    install_ai_transport(monkeypatch, reply_with("{}", prompt_tokens=None, completion_tokens=None))

    _call_recorded()

    assert (_list_events()[0].prompt_tokens, _list_events()[0].completion_tokens) == (None, None)


def _raise_connect_error(request: httpx2.Request) -> NoReturn:
    raise httpx2.ConnectError("cannot reach http://ai.test/v1")


@pytest.mark.parametrize(
    ("handler", "error"),
    [
        pytest.param(lambda request: httpx2.Response(500), httpx2.HTTPStatusError, id="http-status"),
        pytest.param(_raise_connect_error, httpx2.ConnectError, id="connect"),
        pytest.param(lambda request: httpx2.Response(200, json={"choices": []}), IndexError, id="malformed-body"),
    ],
)
def test_failure_records_a_failed_row_and_reraises(
    monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx2.Request], httpx2.Response], error: type[Exception]
) -> None:
    enable_ai(monkeypatch)
    install_ai_transport(monkeypatch, handler)

    with pytest.raises(error):
        _call_recorded(feature="boom")

    [event] = _list_events()
    assert (event.login_id, event.feature, event.ok) == ("ops.member", "boom", False)
    assert (event.prompt_tokens, event.completion_tokens) == (None, None)


def test_config_error_is_recorded_as_a_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_endpoints", "not-json")  # call_ai가 요청 전에 ValueError

    with pytest.raises(ValueError, match="invalid JSON"):
        _call_recorded()

    assert [event.ok for event in _list_events()] == [False]


def test_failed_recording_does_not_mask_the_ai_error(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    enable_ai(monkeypatch)
    install_ai_transport(monkeypatch, lambda request: httpx2.Response(500))
    _break_recording(monkeypatch)

    with caplog.at_level(logging.WARNING, logger="app.ai_usage"):
        with pytest.raises(httpx2.HTTPStatusError):  # 호출자가 받는 건 AI 오류 — 계량 실패(RuntimeError)가 아니다
            _call_recorded()

    assert _list_events() == []
    # 로그에는 예외 클래스 이름만 — 메시지·트레이스백에는 값이 실릴 수 있다
    assert "RuntimeError" in caplog.text
    assert "db down" not in caplog.text and "Traceback" not in caplog.text


def test_failed_recording_after_a_good_reply_is_not_swallowed(monkeypatch: pytest.MonkeyPatch) -> None:
    # 성공 쪽은 삼키지 않는다 — DB가 죽었는데 조용히 계량이 빠지면 안 된다
    enable_ai(monkeypatch)
    install_ai_transport(monkeypatch, reply_with("{}"))
    _break_recording(monkeypatch)

    with pytest.raises(RuntimeError, match="db down"):
        _call_recorded()


def test_record_ai_usage_writes_one_row_in_its_own_session() -> None:
    asyncio.run(
        record_ai_usage(
            login_id="ops.member", feature="unit", model="glm-test", prompt_tokens=5, completion_tokens=6, ok=True
        )
    )

    [event] = _list_events()
    assert (event.login_id, event.feature, event.model, event.ok) == ("ops.member", "unit", "glm-test", True)
    assert (event.prompt_tokens, event.completion_tokens) == (5, 6)
