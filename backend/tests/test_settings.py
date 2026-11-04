"""Settings parsing — auth mode resolution, sysadmin list, HR gate."""

import pytest

from app.settings import Settings


def test_auth_mode_defaults_to_dev() -> None:
    assert Settings(auth_mode="").resolved_auth_mode() == "dev"


def test_auth_mode_case_insensitive() -> None:
    assert Settings(auth_mode="KEYCLOAK").resolved_auth_mode() == "keycloak"


def test_auth_mode_rejects_ldap() -> None:
    with pytest.raises(ValueError, match="ldap"):
        Settings(auth_mode="ldap").resolved_auth_mode()


def test_sysadmins_parsed() -> None:
    assert Settings(app_sysadmins=" a , b,").sysadmin_login_ids() == {"a", "b"}


def test_hr_enabled_needs_url_and_token() -> None:
    assert not Settings(n8n_hr_url="x").hr_enabled
    assert not Settings(n8n_hr_token="t").hr_enabled
    assert Settings(n8n_hr_url="x", n8n_hr_token="t").hr_enabled
