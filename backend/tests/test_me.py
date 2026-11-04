"""GET /api/me — 신원·유효 권한, KST 하루 1행 접속 기록, 실 인증에서만 단건 HR 동기화."""

from collections.abc import Iterator
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.catalog import PERMISSIONS
from app.auth import get_current_user
from app.clock import now
from app.main import app
from app.models import Employee, LoginRecord
from app.routers import me as me_router
from app.settings import settings
from tests.access_helpers import run_in_session


@pytest.fixture(autouse=True)
def clean_login_records(client: TestClient) -> Iterator[None]:
    """/api/me는 부를 때마다 기록을 남길 수 있다 — 앞뒤로 비워 실행 순서에 기대지 않는다."""

    async def _clear(session: AsyncSession) -> None:
        await session.execute(delete(LoginRecord))
        await session.commit()

    run_in_session(_clear)
    yield
    run_in_session(_clear)


def _count_records(login_id: str) -> int:
    async def _count(session: AsyncSession) -> int:
        return await session.scalar(
            select(func.count()).select_from(LoginRecord).where(LoginRecord.login_id == login_id)
        )

    return run_in_session(_count)


def _get_me(client: TestClient, login_id: str) -> dict:
    response = client.get("/api/me", headers={"X-Dev-User": login_id})
    assert response.status_code == 200, response.text
    return response.json()


def test_me_records_login_once_per_day(client: TestClient) -> None:
    _get_me(client, "qa.member")
    _get_me(client, "qa.member")

    assert _count_records("qa.member") == 1

    async def _load_name(session: AsyncSession) -> str | None:
        return await session.scalar(select(LoginRecord.name).where(LoginRecord.login_id == "qa.member"))

    assert run_in_session(_load_name) == "QA Member"  # 조회 편의용 이름 스냅샷


def test_me_records_again_on_a_new_kst_day(client: TestClient) -> None:
    day_start = now().replace(hour=0, minute=0, second=0, microsecond=0)

    async def _add_yesterday(session: AsyncSession) -> None:
        session.add(LoginRecord(login_id="qa.member", occurred_at=day_start - timedelta(seconds=1)))
        await session.commit()

    run_in_session(_add_yesterday)

    _get_me(client, "qa.member")

    assert _count_records("qa.member") == 2  # KST 자정 직전 기록은 오늘 접속을 막지 않는다


@pytest.mark.usefixtures("enforce", "demo_access")
def test_me_unknown_employee(client: TestClient) -> None:
    # HR 동기화 전에 처음 로그인한 사람 — 200, 빈 신원, 권한 없음
    assert _get_me(client, "ghost") == {
        "login_id": "ghost", "name": "", "korean_name": "", "department": "", "dept_path": "",
        "is_sysadmin": False, "permissions": [], "auth_mode": "dev", "ai_enabled": False,
    }
    assert _count_records("ghost") == 1


@pytest.mark.usefixtures("enforce", "demo_access")
def test_me_returns_directory_identity(client: TestClient) -> None:
    me = _get_me(client, "qa.member")

    assert (me["name"], me["korean_name"], me["department"]) == ("QA Member", "품질담당", "QA Team 1")
    assert me["dept_path"] == "QA Team 1"  # 상위 2단계는 org_trim_levels로 빠진다
    assert (me["is_sysadmin"], me["permissions"]) == (False, ["permission.manage"])


@pytest.mark.usefixtures("enforce", "demo_access")
def test_me_permissions_match_effective(client: TestClient) -> None:
    effective = client.get("/api/access/effective/qa.lead", headers={"X-Dev-User": "qa.lead"}).json()

    assert _get_me(client, "qa.lead")["permissions"] == ["permission.manage"] == effective["permissions"]
    assert _get_me(client, "ops.member")["permissions"] == ["ai.admin", "directory.sync", "system.view"]


def test_me_dev_unenforced_reports_sysadmin(client: TestClient) -> None:
    me = _get_me(client, "prod.member")

    assert me["is_sysadmin"] is True
    assert me["permissions"] == sorted(PERMISSIONS)


def test_me_syncs_one_employee_only_with_real_auth(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def fake_sync_one(_session: AsyncSession, login_id: str) -> Employee | None:
        calls.append(login_id)
        return None

    monkeypatch.setattr(me_router, "sync_one", fake_sync_one)
    monkeypatch.setattr(settings, "n8n_hr_url", "http://hr.test/webhook")
    monkeypatch.setattr(settings, "n8n_hr_token", "tok")

    _get_me(client, "qa.member")  # dev 모드: 시드 디렉터리를 쓰므로 동기화하지 않는다
    assert calls == []

    monkeypatch.setattr(settings, "auth_mode", "keycloak")
    monkeypatch.setitem(app.dependency_overrides, get_current_user, lambda: "qa.member")
    response = client.get("/api/me")

    assert response.status_code == 200, response.text
    assert calls == ["qa.member"]
    assert response.json()["auth_mode"] == "keycloak"
