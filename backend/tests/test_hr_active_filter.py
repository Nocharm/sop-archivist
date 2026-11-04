"""active=false 행(퇴직자)은 디렉터리 검색에서 빠지고, 재직 복귀하면 다시 보인다."""

import pytest
from fastapi.testclient import TestClient

from tests.hr_sync_helpers import _hr_row, _mock_hr, _run_sync, _seed_employee

pytestmark = pytest.mark.usefixtures("clean_directory")


def _directory_ids(client: TestClient, q: str) -> set[str]:
    response = client.get("/api/directory", params={"q": q})
    assert response.status_code == 200
    return {u["login_id"] for u in response.json()}


def test_directory_excludes_inactive(client: TestClient) -> None:
    _seed_employee("act.on", source="hr", active=True, name="Active One", department="Filter Div")
    _seed_employee("act.off", source="hr", active=False, name="Gone One", department="Filter Div")

    ids = _directory_ids(client, "Filter Div")

    assert "act.on" in ids and "act.off" not in ids


def test_retiree_disappears_from_directory_after_sync_and_returns_on_rehire(
    client: TestClient, monkeypatch
) -> None:
    _seed_employee("flip.user", source="hr", active=True, name="Flip User")
    assert "flip.user" in _directory_ids(client, "flip.user")

    _mock_hr(monkeypatch, [_hr_row("flip.user", status="inactive"), _hr_row("stay.user")])
    _run_sync()
    assert "flip.user" not in _directory_ids(client, "flip.user")  # 행은 남지만 검색에서 빠진다

    _mock_hr(monkeypatch, [_hr_row("flip.user"), _hr_row("stay.user")])
    _run_sync()
    assert "flip.user" in _directory_ids(client, "flip.user")
