"""GET /api/directory·/api/departments — 인증 사용자용 읽기 전용 디렉터리(권한 부여 화면의 개인·부서 선택용)."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Employee
from app.settings import settings
from tests.hr_sync_helpers import _seed_employee

pytestmark = pytest.mark.usefixtures("clean_directory")

DEV_LOGIN_IDS = {"dev.admin", "qa.lead", "qa.member", "prod.member", "ops.member"}
DEV_DEPT_CODES = {"CORP", "DIV-QA", "TEAM-QA1", "DIV-PROD", "TEAM-PROD1", "DIV-IT", "TEAM-IT1"}


def _ids(client: TestClient, **params: str | int) -> list[str]:
    response = client.get("/api/directory", params=params)
    assert response.status_code == 200
    return [u["login_id"] for u in response.json()]


def _seed_many(count: int) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            session.add_all(
                Employee(login_id=f"bulk.{i:03d}", name=f"Bulk {i}", source="hr", active=True)
                for i in range(count)
            )
            await session.commit()

    asyncio.run(_run())


def test_directory_lists_dev_users_with_the_documented_shape(client: TestClient) -> None:
    response = client.get("/api/directory")

    assert response.status_code == 200
    rows = {u["login_id"]: u for u in response.json()}
    assert set(rows) == DEV_LOGIN_IDS
    assert set(rows["qa.member"]) == {"login_id", "name", "korean_name", "department", "dept_code", "dept_path"}
    assert rows["qa.member"] == {
        "login_id": "qa.member", "name": "QA Member", "korean_name": "품질담당",
        "department": "QA Team 1", "dept_code": "TEAM-QA1",
        # 상위 2단계(법인·본부급)는 org_trim_levels로 경로에서 빠진다
        "dept_path": "QA Team 1",
    }
    assert rows["qa.lead"]["dept_path"] == "Quality Division"  # 체인이 트림 레벨 이하로 짧으면 리프만


def test_directory_is_ordered_by_login_id(client: TestClient) -> None:
    ids = _ids(client)
    assert ids == sorted(ids)


def test_directory_matches_korean_name(client: TestClient) -> None:
    assert set(_ids(client, q="품질")) == {"qa.lead", "qa.member"}


def test_directory_matches_login_id_name_and_department_case_insensitively(client: TestClient) -> None:
    assert set(_ids(client, q="QA.LE")) == {"qa.lead"}  # login_id
    assert set(_ids(client, q="production member")) == {"prod.member"}  # name
    assert set(_ids(client, q="OPS")) == {"dev.admin", "ops.member"}  # department "IT Ops Team" + login_id/name


def test_directory_q_is_a_plain_substring_not_a_pattern(client: TestClient) -> None:
    assert _ids(client, q="%") == []
    assert _ids(client, q="_") == []
    assert _ids(client, q="qa.%") == []


def test_directory_blank_q_lists_everyone(client: TestClient) -> None:
    assert set(_ids(client, q="   ")) == DEV_LOGIN_IDS


def test_directory_excludes_inactive(client: TestClient) -> None:
    _seed_employee("quit.person", source="hr", active=False, name="Quit Person")
    _seed_employee("stay.person", source="hr", active=True, name="Stay Person")

    ids = _ids(client, q="person")

    assert ids == ["stay.person"]


def test_directory_limit_defaults_to_20(client: TestClient) -> None:
    _seed_many(30)
    assert len(_ids(client)) == 20


def test_directory_limit_is_honoured_below_the_cap(client: TestClient) -> None:
    assert len(_ids(client, limit=3)) == 3


def test_directory_limit_capped(client: TestClient) -> None:
    _seed_many(60)

    response = client.get("/api/directory", params={"limit": 500})

    assert response.status_code == 200  # 큰 값은 422가 아니라 상한으로 자른다
    assert len(response.json()) == 50


def test_directory_rejects_a_non_positive_limit(client: TestClient) -> None:
    assert client.get("/api/directory", params={"limit": 0}).status_code == 422


def test_directory_rejects_an_oversized_query(client: TestClient) -> None:
    assert client.get("/api/directory", params={"q": "x" * 201}).status_code == 422
    assert client.get("/api/directory", params={"q": "x" * 200}).status_code == 200


def test_directory_all_lists_every_active_person(client: TestClient) -> None:
    _seed_many(60)
    _seed_employee("quit.person", source="hr", active=False, name="Quit Person")

    response = client.get("/api/directory/all")

    assert response.status_code == 200
    ids = [person["login_id"] for person in response.json()]
    assert len(ids) == 60 + len(DEV_LOGIN_IDS)  # 50명 상한 없이 전원
    assert "quit.person" not in ids
    assert ids == sorted(ids)
    assert set(response.json()[0]) == {"login_id", "name", "korean_name", "department", "dept_code", "dept_path"}


def test_departments_list(client: TestClient) -> None:
    response = client.get("/api/departments")

    assert response.status_code == 200
    rows = {d["dept_code"]: d for d in response.json()}
    assert set(rows) == DEV_DEPT_CODES
    assert rows["TEAM-QA1"] == {
        "dept_code": "TEAM-QA1", "parent_dept_code": "DIV-QA",
        "name": "QA Team 1", "name_ko": "품질보증1팀", "level": 3,
    }
    assert rows["CORP"]["parent_dept_code"] is None


@pytest.mark.parametrize("path", ["/api/directory", "/api/departments"])
def test_directory_routes_require_authentication(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, path: str
) -> None:
    monkeypatch.setattr(settings, "auth_mode", "keycloak")

    assert client.get(path).status_code == 401
