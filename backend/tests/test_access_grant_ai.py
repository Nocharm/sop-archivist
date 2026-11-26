"""사내 AI로 부여 읽기(POST /api/access/grants/ai-read) — 대상 맞추기, 아무것도 쓰지 않음, 실패와 권한."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.catalog import PERMISSIONS
from app.access.grant_ai import GRANT_AI_FEATURE, MAX_GRANT_AI_TEXT_CHARS
from app.models import AccessGrant, AiUsageEvent, Employee
from app.sop.ai.runner import AiCallFailed
from tests.access_helpers import delete_row, get_role_id, run_in_session
from tests.fake_ai import FakeAi

pytestmark = pytest.mark.usefixtures("enforce", "clean_directory", "demo_access")

LEAD = {"X-Dev-User": "qa.lead"}  # 데모 부서 부여로 permission.manage
PROD = {"X-Dev-User": "prod.member"}  # system.view만
URL = "/api/access/grants/ai-read"


def _reply(*lines: dict[str, Any]) -> str:
    return json.dumps({"lines": list(lines)}, ensure_ascii=False)


def _line(line: int, action: str, subjects: list[str], roles: list[str] = (), permissions: list[str] = ()) -> dict:
    return {"line": line, "action": action, "subjects": subjects, "roles": list(roles), "permissions": list(permissions)}


def _count(model: type, *where: Any) -> int:
    async def _go(session: AsyncSession) -> int:
        return await session.scalar(select(func.count()).select_from(model).where(*where)) or 0

    return run_in_session(_go)


def _add_employee(login_id: str, name: str, korean_name: str) -> None:
    async def _add(session: AsyncSession) -> None:
        session.add(Employee(login_id=login_id, name=name, korean_name=korean_name, department="QA"))
        await session.commit()

    run_in_session(_add)


def test_ai_off_is_503(client: TestClient) -> None:
    response = client.post(URL, json={"text": "qa.member Operations"}, headers=LEAD)

    assert response.status_code == 503


def test_needs_permission_manage(client: TestClient, fake_ai: FakeAi) -> None:
    response = client.post(URL, json={"text": "qa.member Operations"}, headers=PROD)

    assert response.status_code == 403
    assert fake_ai.requests == []


@pytest.mark.parametrize("text", ["", "   ", "x" * (MAX_GRANT_AI_TEXT_CHARS + 1)])
def test_empty_or_too_long_text_is_422_and_calls_nothing(client: TestClient, fake_ai: FakeAi, text: str) -> None:
    response = client.post(URL, json={"text": text}, headers=LEAD)

    assert response.status_code == 422
    assert fake_ai.requests == []


def test_payload_holds_the_text_roles_and_permissions_only(client: TestClient, fake_ai: FakeAi) -> None:
    fake_ai.chat = lambda data: _reply()

    response = client.post(URL, json={"text": "  품질담당 → Operations  "}, headers=LEAD)

    assert response.status_code == 200
    (sent,) = fake_ai.requests
    assert set(sent) == {"task", "text", "roles", "permissions"}  # 직원 명단은 보내지 않는다
    assert sent["task"] == "grant"
    assert sent["text"] == "품질담당 → Operations"
    assert {"Permission Admin", "Operations"} <= set(sent["roles"])
    assert sent["permissions"] == list(PERMISSIONS)


def test_subjects_resolve_by_id_code_and_both_names(client: TestClient, fake_ai: FakeAi) -> None:
    subjects = ["qa.member", "QA.LEAD", "품질담당", "Production Member", "TEAM-it1", "Quality Division", "생산1팀", "nobody"]
    fake_ai.chat = lambda data: _reply(_line(1, "add", subjects, roles=["operations", "Ghost"], permissions=["system.view", "x.y"]))

    body = client.post(URL, json={"text": "아무 지시"}, headers=LEAD).json()

    (line,) = body["lines"]
    matches = {s["written"]: [(m["subject_type"], m["subject_id"]) for m in s["matches"]] for s in line["subjects"]}
    assert matches == {
        "qa.member": [("user", "qa.member")],
        "QA.LEAD": [("user", "qa.lead")],
        "품질담당": [("user", "qa.member")],
        "Production Member": [("user", "prod.member")],
        "TEAM-it1": [("dept", "TEAM-IT1")],
        "Quality Division": [("dept", "DIV-QA")],
        "생산1팀": [("dept", "TEAM-PROD1")],
        "nobody": [],
    }
    assert line["roles"] == [
        {"written": "operations", "role_id": get_role_id("Operations")},
        {"written": "Ghost", "role_id": None},
    ]
    assert line["permissions"] == [{"written": "system.view", "permission": "system.view"}, {"written": "x.y", "permission": None}]
    assert line["action"] == "add" and line["line"] == 1


def test_same_name_returns_every_person_and_an_id_wins_over_a_name(client: TestClient, fake_ai: FakeAi) -> None:
    _add_employee("kim.a", "Kim Minseo", "김민서")
    _add_employee("kim.b", "Kim Minseo B", "김민서")
    _add_employee("qa.member2", "qa.member", "")  # 다른 사람의 영문 이름이 누군가의 로그인 ID와 같다
    try:
        fake_ai.chat = lambda data: _reply(_line(1, "remove", ["김민서", "qa.member"], roles=["Operations"]))

        body = client.post(URL, json={"text": "김민서 qa.member Operations 회수"}, headers=LEAD).json()
    finally:
        for login_id in ("kim.a", "kim.b", "qa.member2"):
            delete_row(Employee, login_id)

    (line,) = body["lines"]
    by_written = {s["written"]: sorted(m["subject_id"] for m in s["matches"]) for s in line["subjects"]}
    assert by_written == {"김민서": ["kim.a", "kim.b"], "qa.member": ["qa.member"]}
    assert line["action"] == "remove"


def test_reading_writes_no_grant_and_records_usage(client: TestClient, fake_ai: FakeAi) -> None:
    grants_before = _count(AccessGrant)
    usage_before = _count(AiUsageEvent, AiUsageEvent.feature == GRANT_AI_FEATURE)
    fake_ai.chat = lambda data: _reply(_line(1, "add", ["qa.member"], roles=["Operations"]))

    response = client.post(URL, json={"text": "qa.member Operations"}, headers=LEAD)

    assert response.status_code == 200
    assert _count(AccessGrant) == grants_before
    assert _count(AiUsageEvent, AiUsageEvent.feature == GRANT_AI_FEATURE) == usage_before + 1


def test_unreadable_reply_is_502(client: TestClient, fake_ai: FakeAi) -> None:
    fake_ai.chat = lambda data: '{"lines": [{"line": 0, "action": "give"}]}'

    response = client.post(URL, json={"text": "qa.member Operations"}, headers=LEAD)

    assert response.status_code == 502
    assert response.json()["detail"] == "AI reply was not valid"


def test_ai_call_failure_is_502_with_the_code(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _fail(**_kwargs: object) -> None:
        raise AiCallFailed("timeout")

    monkeypatch.setattr("app.routers.access.read_grant_text", _fail)

    response = client.post(URL, json={"text": "qa.member Operations"}, headers=LEAD)

    assert response.status_code == 502
    assert response.json()["detail"] == "AI call failed: timeout"
