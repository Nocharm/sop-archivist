"""/api/access/* — permission.manage 게이트, 역할·부여 CRUD 오류 계약, 변경 기록, 사라진 대상 표시, 유효 권한 조회."""

from typing import Any

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.access.catalog import PERMISSIONS
from app.main import app
from app.models import Department, Employee
from tests.access_helpers import add_grant, delete_row

pytestmark = pytest.mark.usefixtures("enforce", "clean_directory", "demo_access")

LEAD = {"X-Dev-User": "qa.lead"}  # DIV-QA 소속 → 데모 부서 부여로 permission.manage
PROD = {"X-Dev-User": "prod.member"}  # system.view만


def _get(client: TestClient, path: str, headers: dict[str, str] = LEAD) -> Any:
    response = client.get(path, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _get_roles_by_name(client: TestClient) -> dict[str, dict[str, Any]]:
    return {role["name"]: role for role in _get(client, "/api/access/roles")}


def _find_grant(client: TestClient, subject_type: str, subject_id: str) -> dict[str, Any]:
    matches = [
        g for g in _get(client, "/api/access/grants")
        if (g["subject_type"], g["subject_id"]) == (subject_type, subject_id)
    ]
    assert len(matches) == 1, matches
    return matches[0]


def _list_audit(client: TestClient, limit: int = 100) -> list[dict[str, Any]]:
    return _get(client, f"/api/access/audit?limit={limit}")


def _post_role(client: TestClient, name: str, permissions: list[str], description: str = "") -> Any:
    return client.post(
        "/api/access/roles", headers=LEAD,
        json={"name": name, "description": description, "permissions": permissions},
    )


GUARDED_ROUTES = [
    ("GET", "/api/access/catalog", None),
    ("GET", "/api/access/roles", None),
    ("POST", "/api/access/roles", {"name": "Sneaky", "permissions": ["permission.manage"]}),
    ("PUT", "/api/access/roles/{role_id}", {"name": "Operations", "permissions": ["permission.manage"]}),
    ("DELETE", "/api/access/roles/{role_id}", None),
    ("GET", "/api/access/grants", None),
    ("POST", "/api/access/grants", {"subject_type": "user", "subject_id": "prod.member", "permission": "permission.manage"}),
    ("DELETE", "/api/access/grants/{grant_id}", None),
    ("GET", "/api/access/audit", None),
    ("GET", "/api/access/effective/qa.lead", None),
]


def test_guarded_route_list_covers_every_access_route() -> None:
    # 아래 403 테스트가 새 엔드포인트를 빠뜨리지 않게 — 실제 라우트 표와 대조한다
    declared = {
        (method, route.path)
        for route in app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/api/access")
        for method in route.methods
    }
    tested = {(method, path.replace("qa.lead", "{login_id}")) for method, path, _ in GUARDED_ROUTES}

    assert tested == declared


@pytest.mark.parametrize(("method", "path", "body"), GUARDED_ROUTES)
def test_access_requires_permission_manage(
    client: TestClient, method: str, path: str, body: dict[str, Any] | None,
) -> None:
    roles_before = _get(client, "/api/access/roles")
    grants_before = _get(client, "/api/access/grants")
    target = path.format(
        role_id=_get_roles_by_name(client)["Operations"]["id"],
        grant_id=_find_grant(client, "user", "prod.member")["id"],
    )

    response = client.request(method, target, headers=PROD, json=body)

    assert response.status_code == 403
    assert response.json() == {"detail": "missing permission: permission.manage"}
    # 거부된 요청은 표·기록을 바꾸지 않는다(권한 없는 사람이 스스로 권한을 올리는 길이 없음)
    assert _get(client, "/api/access/roles") == roles_before
    assert _get(client, "/api/access/grants") == grants_before
    assert _list_audit(client) == []


def test_catalog_lists_permissions(client: TestClient) -> None:
    assert _get(client, "/api/access/catalog") == list(PERMISSIONS)


def test_list_roles_shows_permissions_and_grant_count(client: TestClient) -> None:
    roles = _get_roles_by_name(client)

    assert set(roles) == {"Permission Admin", "Operations"}
    assert roles["Permission Admin"]["permissions"] == ["permission.manage"]
    assert roles["Operations"]["permissions"] == ["ai.admin", "directory.sync", "system.view"]
    assert {name: role["grant_count"] for name, role in roles.items()} == {"Permission Admin": 1, "Operations": 1}
    assert set(roles["Operations"]) == {"id", "name", "description", "permissions", "grant_count"}


def test_create_role_writes_audit(client: TestClient) -> None:
    response = _post_role(client, "Reviewer", ["system.view", "system.view"], description="Reads status")

    assert response.status_code == 201, response.text
    role = response.json()
    assert role["name"] == "Reviewer" and role["description"] == "Reads status"
    assert role["permissions"] == ["system.view"]  # 중복 제거
    assert role["grant_count"] == 0
    latest = _list_audit(client)[0]
    assert (latest["action"], latest["actor"]) == ("role.create", "qa.lead")
    assert latest["detail"] == {
        "role_id": role["id"], "name": "Reviewer", "description": "Reads status", "permissions": ["system.view"],
    }
    assert latest["occurred_at"].endswith("+09:00")  # sqlite도 KST 시각으로 내보낸다


def test_create_role_unknown_permission(client: TestClient) -> None:
    response = _post_role(client, "Broken", ["system.view", "bogus.perm"])

    assert response.status_code == 422
    assert response.json() == {"detail": "unknown permission: bogus.perm"}
    assert "Broken" not in _get_roles_by_name(client)
    assert _list_audit(client) == []


@pytest.mark.parametrize("name", ["", "   ", "x" * 101])
def test_create_role_rejects_blank_or_too_long_name(client: TestClient, name: str) -> None:
    assert _post_role(client, name, []).status_code == 422


def test_duplicate_role_name(client: TestClient) -> None:
    created = _post_role(client, "Permission Admin", [])
    renamed = client.put(
        f"/api/access/roles/{_get_roles_by_name(client)['Operations']['id']}", headers=LEAD,
        json={"name": "Permission Admin", "permissions": []},
    )

    assert created.status_code == 409 and created.json() == {"detail": "role name already exists"}
    assert renamed.status_code == 409 and renamed.json() == {"detail": "role name already exists"}
    assert _list_audit(client) == []


def test_update_role_records_before_and_after(client: TestClient) -> None:
    ops = _get_roles_by_name(client)["Operations"]

    response = client.put(
        f"/api/access/roles/{ops['id']}", headers=LEAD,
        json={"name": "Operations", "description": "Status only", "permissions": ["system.view"]},
    )

    assert response.status_code == 200, response.text  # 자기 이름 그대로는 중복이 아니다
    assert response.json()["permissions"] == ["system.view"]
    latest = _list_audit(client)[0]
    assert latest["action"] == "role.update"
    assert latest["detail"] == {
        "role_id": ops["id"],
        "before": {"name": "Operations", "description": ops["description"],
                   "permissions": ["ai.admin", "directory.sync", "system.view"]},
        "after": {"name": "Operations", "description": "Status only", "permissions": ["system.view"]},
    }
    # 역할을 받은 사람의 유효 권한이 곧바로 따라간다
    assert _get(client, "/api/access/effective/ops.member")["permissions"] == ["system.view"]


def test_missing_role_and_grant_return_404(client: TestClient) -> None:
    body = {"name": "Nobody", "permissions": []}

    assert client.put("/api/access/roles/999999", headers=LEAD, json=body).status_code == 404
    assert client.delete("/api/access/roles/999999", headers=LEAD).status_code == 404
    assert client.delete("/api/access/grants/999999", headers=LEAD).status_code == 404


def test_add_dept_grant_and_duplicate(client: TestClient) -> None:
    body = {"subject_type": "dept", "subject_id": "DIV-PROD", "role_id": _get_roles_by_name(client)["Operations"]["id"]}

    first = client.post("/api/access/grants", headers=LEAD, json=body)
    again = client.post("/api/access/grants", headers=LEAD, json=body)

    assert first.status_code == 201, first.text
    grant = first.json()
    assert grant["subject_name"] == "Production Division" and grant["subject_missing"] is False
    assert (grant["role_name"], grant["permission"], grant["created_by"]) == ("Operations", None, "qa.lead")
    assert grant["created_at"].endswith("+09:00")
    assert again.status_code == 409 and again.json() == {"detail": "grant already exists"}
    assert [event["action"] for event in _list_audit(client)] == ["grant.add"]  # 거절된 중복은 기록하지 않는다
    assert _list_audit(client)[0]["detail"] == {
        "grant_id": grant["id"], "subject_type": "dept", "subject_id": "DIV-PROD",
        "role_id": body["role_id"], "role_name": "Operations", "permission": None,
    }
    # DIV-PROD 하위 TEAM-PROD1의 prod.member가 역할을 물려받는다
    assert _get(client, "/api/access/effective/prod.member")["permissions"] == [
        "ai.admin", "directory.sync", "system.view",
    ]


@pytest.mark.parametrize("extra", [
    {"role_id": 1, "permission": "system.view"},
    {},
    {"role_id": None, "permission": None},
])
def test_add_grant_requires_exactly_one_of_role_or_permission(client: TestClient, extra: dict[str, Any]) -> None:
    response = client.post(
        "/api/access/grants", headers=LEAD, json={"subject_type": "user", "subject_id": "dev.admin", **extra},
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "exactly one of role_id or permission is required"}


@pytest.mark.parametrize(("subject_type", "subject_id"), [("user", "ghost"), ("dept", "GONE")])
def test_add_grant_unknown_subject(client: TestClient, subject_type: str, subject_id: str) -> None:
    response = client.post(
        "/api/access/grants", headers=LEAD,
        json={"subject_type": subject_type, "subject_id": subject_id, "permission": "system.view"},
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "unknown subject"}


def test_add_grant_rejects_unknown_role_permission_and_subject_type(client: TestClient) -> None:
    def post(**body: Any) -> Any:
        return client.post("/api/access/grants", headers=LEAD, json={"subject_id": "dev.admin", **body})

    unknown_role = post(subject_type="user", role_id=999999)
    unknown_permission = post(subject_type="user", permission="bogus.perm")
    unknown_type = post(subject_type="group", permission="system.view")
    too_long = post(subject_type="user", subject_id="x" * 101, permission="system.view")

    assert unknown_role.status_code == 422 and unknown_role.json() == {"detail": "unknown role"}
    assert unknown_permission.status_code == 422
    assert unknown_permission.json() == {"detail": "unknown permission: bogus.perm"}
    assert unknown_type.status_code == 422
    assert too_long.status_code == 422
    assert _list_audit(client) == []


def test_delete_role_still_granted(client: TestClient) -> None:
    role_id = _get_roles_by_name(client)["Permission Admin"]["id"]

    blocked = client.delete(f"/api/access/roles/{role_id}", headers=LEAD)
    assert blocked.status_code == 409 and blocked.json() == {"detail": "role is still granted"}

    grant_id = _find_grant(client, "dept", "DIV-QA")["id"]
    # 관리자가 dev.admin에게 먼저 권한을 넘겨 둔다 — DIV-QA 부여를 지우면 qa.lead 자신은 관리 권한을 잃는다
    handover = client.post(
        "/api/access/grants", headers=LEAD,
        json={"subject_type": "user", "subject_id": "dev.admin", "permission": "permission.manage"},
    )
    assert handover.status_code == 201, handover.text
    admin = {"X-Dev-User": "dev.admin"}
    assert client.delete(f"/api/access/grants/{grant_id}", headers=admin).status_code == 204
    assert client.delete(f"/api/access/roles/{role_id}", headers=admin).status_code == 204

    events = _get(client, "/api/access/audit", headers=admin)
    assert [event["action"] for event in events[:2]] == ["role.delete", "grant.remove"]
    assert events[0]["detail"] == {"role_id": role_id, "name": "Permission Admin", "permissions": ["permission.manage"]}
    assert events[1]["detail"]["subject_id"] == "DIV-QA" and events[1]["actor"] == "dev.admin"
    assert "Permission Admin" not in {r["name"] for r in _get(client, "/api/access/roles", headers=admin)}
    # 부서 부여가 사라지자 qa.lead의 관리 API 접근도 곧바로 막힌다
    assert client.get("/api/access/roles", headers=LEAD).status_code == 403


def test_grants_list_marks_missing_department(client: TestClient) -> None:
    delete_row(Department, "DIV-QA")  # 조직 개편으로 부서가 미러에서 사라짐
    delete_row(Employee, "prod.member")  # HR에서 지워진 사람

    # DIV-QA가 사라져 qa.lead도 관리 권한을 잃는다 — 목록을 볼 관리자로 ops.member에게 개인 부여를 둔다
    add_grant("user", "ops.member", permission="permission.manage")
    admin = {"X-Dev-User": "ops.member"}
    grants = {(g["subject_type"], g["subject_id"]): g for g in _get(client, "/api/access/grants", headers=admin)}

    assert grants[("dept", "DIV-QA")]["subject_missing"] is True
    assert grants[("dept", "DIV-QA")]["subject_name"] == ""
    assert grants[("dept", "DIV-QA")]["role_name"] == "Permission Admin"  # 부여 자체는 지워지지 않는다
    assert grants[("user", "prod.member")]["subject_missing"] is True
    ops_grants = [g for (kind, sid), g in grants.items() if (kind, sid) == ("user", "ops.member")]
    assert ops_grants and all(g["subject_missing"] is False and g["subject_name"] == "Ops Member" for g in ops_grants)
    # 판정에서는 무시된다: TEAM-QA1의 부모(DIV-QA)가 없어 체인이 거기서 끝난다
    effective = _get(client, "/api/access/effective/qa.member", headers=admin)
    assert (effective["permissions"], effective["sources"]) == ([], {})
    assert client.get("/api/access/roles", headers=LEAD).status_code == 403


def test_manager_can_grant_manage_to_self(client: TestClient) -> None:
    response = client.post(
        "/api/access/grants", headers=LEAD,
        json={"subject_type": "user", "subject_id": "qa.lead", "permission": "permission.manage"},
    )

    assert response.status_code == 201, response.text
    latest = _list_audit(client)[0]
    assert (latest["action"], latest["actor"]) == ("grant.add", "qa.lead")
    assert latest["detail"]["subject_id"] == "qa.lead" and latest["detail"]["permission"] == "permission.manage"


def test_effective_endpoint_sources(client: TestClient) -> None:
    assert _get(client, "/api/access/effective/qa.member") == {
        "login_id": "qa.member", "known": True, "active": True, "is_sysadmin": False,
        "permissions": ["permission.manage"],
        "sources": {"permission.manage": [
            {"kind": "dept", "subject_id": "DIV-QA", "subject_name": "Quality Division", "role": "Permission Admin"},
        ]},
    }
    ghost = _get(client, "/api/access/effective/ghost")
    assert (ghost["known"], ghost["active"], ghost["permissions"]) == (False, False, [])


def test_audit_is_newest_first_and_limited(client: TestClient) -> None:
    for name in ("Audit A", "Audit B", "Audit C"):
        assert _post_role(client, name, []).status_code == 201

    latest_two = _list_audit(client, limit=2)
    oversized = client.get("/api/access/audit?limit=100000", headers=LEAD)

    assert [event["detail"]["name"] for event in latest_two] == ["Audit C", "Audit B"]
    assert oversized.status_code == 200 and len(oversized.json()) == 3  # 상한을 넘는 limit은 잘라서 받는다
    assert client.get("/api/access/audit?limit=0", headers=LEAD).status_code == 422
