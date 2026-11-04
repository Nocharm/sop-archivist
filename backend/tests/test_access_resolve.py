"""유효 권한 판정 — 개인·부서 부여, 하위 부서 상속, 역할 펼침, 퇴직자·미등록자, 깨진 부서 체인, sysadmin 우회."""

import pytest

from app.access.catalog import PERMISSIONS, is_known_permission
from app.access.deps import require_permission
from app.access.resolve import AccessSource, is_sysadmin
from app.models import Department, Employee
from app.settings import settings
from tests.access_helpers import add_grant, add_role_permission, resolve, update_row

pytestmark = pytest.mark.usefixtures("enforce", "clean_directory", "demo_access")


def test_catalog_lists_the_admin_permissions_in_order() -> None:
    assert PERMISSIONS == ("permission.manage", "directory.sync", "ai.admin", "system.view")
    assert is_known_permission("system.view") is True
    assert is_known_permission("sop.draft") is False


def test_resolve_dept_grant_inherits_to_subteam() -> None:
    # 데모 부여는 DIV-QA에 걸려 있고 qa.member는 그 하위 TEAM-QA1 소속이다
    access = resolve("qa.member")

    assert access.permissions == frozenset({"permission.manage"})
    assert access.sources == {
        "permission.manage": (AccessSource(kind="dept", subject_id="DIV-QA", role="Permission Admin"),),
    }
    assert (access.known, access.active, access.is_sysadmin) == (True, True, False)


def test_resolve_dept_grant_does_not_reach_parent_or_sibling() -> None:
    add_grant("dept", "TEAM-QA1", permission="system.view")

    assert resolve("qa.lead").permissions == frozenset({"permission.manage"})  # DIV-QA 소속: 하위 팀 부여는 안 올라온다
    assert resolve("dev.admin").permissions == frozenset()  # TEAM-IT1: 다른 갈래 부서 부여는 안 닿는다


def test_resolve_user_role_grant() -> None:
    access = resolve("ops.member")

    assert access.permissions == frozenset({"directory.sync", "system.view", "ai.admin"})
    assert access.sources["ai.admin"] == (AccessSource(kind="user", subject_id="ops.member", role="Operations"),)


def test_resolve_direct_permission_grant() -> None:
    access = resolve("prod.member")

    assert access.permissions == frozenset({"system.view"})
    assert access.sources == {"system.view": (AccessSource(kind="user", subject_id="prod.member", role=None),)}


def test_resolve_union_dedupes() -> None:
    add_grant("user", "qa.member", permission="permission.manage")

    access = resolve("qa.member")

    assert access.permissions == frozenset({"permission.manage"})
    # 개인 부여가 먼저, 부서 부여는 가까운 부서부터
    assert access.sources["permission.manage"] == (
        AccessSource(kind="user", subject_id="qa.member", role=None),
        AccessSource(kind="dept", subject_id="DIV-QA", role="Permission Admin"),
    )


def test_resolve_inactive_employee_has_nothing() -> None:
    update_row(Employee, "ops.member", active=False)

    access = resolve("ops.member")

    assert access.permissions == frozenset()
    assert access.sources == {}
    assert (access.known, access.active, access.is_sysadmin) == (True, False, False)


def test_resolve_unknown_employee() -> None:
    access = resolve("ghost")

    assert (access.known, access.active, access.is_sysadmin) == (False, False, False)
    assert access.permissions == frozenset()
    assert access.sources == {}


def test_resolve_unknown_dept_keeps_user_grants() -> None:
    update_row(Employee, "qa.member", dept_code="GONE")
    add_grant("user", "qa.member", permission="system.view")

    # DIV-QA 부여는 체인이 끊겨 닿지 않고, 개인 부여는 그대로 남는다
    assert resolve("qa.member").permissions == frozenset({"system.view"})


def test_resolve_dept_cycle_terminates() -> None:
    update_row(Department, "DIV-QA", parent_dept_code="TEAM-QA1")  # TEAM-QA1 → DIV-QA → TEAM-QA1 …

    assert resolve("qa.member").permissions == frozenset({"permission.manage"})


def test_resolve_drops_unknown_keys_stored_in_roles() -> None:
    add_role_permission("Permission Admin", "legacy.removed")

    access = resolve("qa.member")

    assert access.permissions == frozenset({"permission.manage"})
    assert "legacy.removed" not in access.sources


def test_resolve_sysadmin_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "app_sysadmins", "prod.member")

    access = resolve("prod.member")

    assert is_sysadmin("prod.member") is True and is_sysadmin("qa.member") is False
    assert access.is_sysadmin is True
    assert access.permissions == frozenset(PERMISSIONS)


def test_resolve_dev_unenforced_is_sysadmin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dev_enforce_permissions", False)

    access = resolve("qa.member")

    assert access.is_sysadmin is True
    assert access.permissions == frozenset(PERMISSIONS)


def test_resolve_keycloak_never_takes_the_dev_shortcut(monkeypatch: pytest.MonkeyPatch) -> None:
    # dev 전권은 dev 모드에서만 — 운영(keycloak)에 DEV_ENFORCE_PERMISSIONS가 꺼져 있어도 표대로 판정한다
    monkeypatch.setattr(settings, "auth_mode", "keycloak")
    monkeypatch.setattr(settings, "dev_enforce_permissions", False)

    access = resolve("prod.member")

    assert access.is_sysadmin is False
    assert access.permissions == frozenset({"system.view"})


def test_require_permission_rejects_unknown_key() -> None:
    # 라우터의 오타가 "모두 403"으로 조용히 숨지 않고 import 시점에 터지게 한다
    with pytest.raises(ValueError, match="unknown permission: system.veiw"):
        require_permission("system.veiw")
