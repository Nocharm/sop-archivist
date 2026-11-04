"""/api/admin/* 운영 API — HR 동기화 실행·프리뷰·이력, 배치 상태. 권한 게이트와 설정·스로틀 오류 계약을 확인한다."""

import re
from dataclasses import fields
from typing import Any, NoReturn

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.batch_runs import JOB_DB_BACKUP, JOB_HR_SYNC, record_batch_run
from app.hr.service import HrSyncPreview, HrSyncSummary
from app.main import app
from app.models import BatchJobRun, Employee, HrSyncRun
from app.settings import settings
from tests.access_helpers import run_in_session
from tests.hr_sync_helpers import _get_employee, _hr_row, _mock_hr, _seed_employee

pytestmark = pytest.mark.usefixtures("enforce", "clean_directory", "demo_access")

OPS = {"X-Dev-User": "ops.member"}  # Operations 역할 → directory.sync · system.view · ai.admin
PROD = {"X-Dev-User": "prod.member"}  # system.view만
LEAD = {"X-Dev-User": "qa.lead"}  # permission.manage만
NOBODY = {"X-Dev-User": "dev.admin"}  # 데모 부여가 없는 사람

HR_SYNC = "/api/admin/hr-sync"
HR_PREVIEW = "/api/admin/hr-sync/preview"
HR_RUNS = "/api/admin/hr-sync/runs"
BATCH_RUNS = "/api/admin/batch-runs"

HR_ROUTES = [("POST", HR_SYNC), ("GET", HR_PREVIEW), ("GET", HR_RUNS)]


def _count_rows(model: type[Any]) -> int:
    async def _count(session: AsyncSession) -> int:
        return await session.scalar(select(func.count()).select_from(model))

    return run_in_session(_count)


def _get_batch_run(job: str, outcome: str) -> BatchJobRun | None:
    return run_in_session(lambda session: session.get(BatchJobRun, (job, outcome)))


def _add_hr_runs(count: int) -> None:
    """scanned=1..count인 이력 행을 직접 넣는다 — 보존 정리(record_hr_sync_run)를 거치지 않는 대량 시드."""
    async def _add(session: AsyncSession) -> None:
        session.add_all(HrSyncRun(outcome="success", scanned=n) for n in range(1, count + 1))
        await session.commit()

    run_in_session(_add)


def _record_batch_run(job: str, outcome: str, detail: str | None) -> None:
    run_in_session(lambda session: record_batch_run(session, job, outcome, detail))


def _set_hr_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    # 로컬 .env 값이 새도 "HR 미설정" 경로를 보게 명시한다
    monkeypatch.setattr(settings, "n8n_hr_url", "")
    monkeypatch.setattr(settings, "n8n_hr_token", "")


ADMIN_ROUTES = sorted(
    (method, route.path)
    for route in app.routes
    if isinstance(route, APIRoute) and route.path.startswith("/api/admin")
    for method in route.methods
    if method not in {"HEAD", "OPTIONS"}
)


# ── 권한 게이트 ────────────────────────────────────────────────────────────────


def test_admin_route_table_includes_the_ops_routes() -> None:
    # 아래 파라미터 테스트가 빈 표로 조용히 건너뛰어지지 않게
    expected = {("POST", HR_SYNC), ("GET", HR_PREVIEW), ("GET", HR_RUNS), ("GET", BATCH_RUNS)}

    assert expected <= set(ADMIN_ROUTES)


@pytest.mark.parametrize(("method", "path"), ADMIN_ROUTES)
def test_every_admin_route_rejects_a_user_without_permissions(
    client: TestClient, method: str, path: str
) -> None:
    # 새 관리 엔드포인트가 게이트 없이 열리지 않게 — 경로 변수는 아무 값이어도 403이 먼저 나와야 한다
    target = re.sub(r"\{[^}]+\}", "1", path)

    response = client.request(method, target, headers=NOBODY)

    assert response.status_code == 403
    assert response.json()["detail"].startswith("missing permission: ")


@pytest.mark.parametrize(("method", "path"), HR_ROUTES)
@pytest.mark.parametrize("headers", [PROD, LEAD])
def test_hr_sync_requires_directory_sync(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, method: str, path: str, headers: dict[str, str]
) -> None:
    # system.view·permission.manage는 동기화 권한이 아니다. HR이 설정돼 있어도 아무것도 돌지 않는다.
    _mock_hr(monkeypatch, [_hr_row("denied.user")])

    response = client.request(method, path, headers=headers)

    assert response.status_code == 403
    assert response.json() == {"detail": "missing permission: directory.sync"}
    assert _get_employee("denied.user") is None
    assert _count_rows(HrSyncRun) == 0
    assert _get_batch_run(JOB_HR_SYNC, "success") is None


@pytest.mark.parametrize(("method", "path"), HR_ROUTES)
def test_permission_check_comes_before_hr_configuration(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, method: str, path: str
) -> None:
    _set_hr_unconfigured(monkeypatch)

    response = client.request(method, path, headers=PROD)

    assert response.status_code == 403  # 설정 상태(503)로 권한 없는 사람에게 운영 정보를 흘리지 않는다


def test_batch_runs_requires_system_view(client: TestClient) -> None:
    denied = client.get(BATCH_RUNS, headers=LEAD)
    assert denied.status_code == 403
    assert denied.json() == {"detail": "missing permission: system.view"}

    assert client.get(BATCH_RUNS, headers=PROD).status_code == 200  # 개인 직접 부여
    assert client.get(BATCH_RUNS, headers=OPS).status_code == 200  # 역할 부여


# ── HR 설정·스로틀 오류 ────────────────────────────────────────────────────────


@pytest.mark.parametrize(("method", "path"), HR_ROUTES)
def test_hr_sync_unconfigured(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, method: str, path: str
) -> None:
    _set_hr_unconfigured(monkeypatch)

    response = client.request(method, path, headers=OPS)

    assert response.status_code == 503
    assert response.json() == {"detail": "HR sync is not configured"}


def test_hr_sync_runs_and_records(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("ep.user"), None])
    runs_before = _count_rows(HrSyncRun)

    response = client.post(HR_SYNC, headers=OPS)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["upserted"] == 1 and body["created"] == 1 and body["skipped"] == 1
    assert body["aborted_reason"] is None
    assert _get_employee("ep.user") is not None
    batch_run = _get_batch_run(JOB_HR_SYNC, "success")
    assert batch_run is not None and batch_run.detail.startswith("scanned 2 · upserted 1")
    assert _count_rows(HrSyncRun) == runs_before + 1


def test_hr_sync_summary_exposes_every_summary_field_but_the_change_lists(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 변경 인원 목록(changes)은 회차 이력 전용이라 응답에서 뺀다. 나머지는 Task 4 요약 필드 그대로다.
    _mock_hr(monkeypatch, [_hr_row("shape.user")])

    body = client.post(HR_SYNC, headers=OPS).json()

    assert set(body) == {f.name for f in fields(HrSyncSummary)} - {"changes"}


def test_hr_sync_too_soon(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("soon.user")])
    assert client.post(HR_SYNC, headers=OPS).status_code == 200
    runs_after_first = _count_rows(HrSyncRun)

    second = client.post(HR_SYNC, headers=OPS)

    assert second.status_code == 409
    assert second.json() == {"detail": "sync ran too recently"}
    assert _count_rows(HrSyncRun) == runs_after_first  # 스로틀은 시도가 아니라 이력을 남기지 않는다


def test_hr_sync_aborted_run_is_a_recorded_summary_and_can_be_retried(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _mock_hr(monkeypatch, [])  # 빈 피드는 전멸 사고 방어로 중단된다

    response = client.post(HR_SYNC, headers=OPS)

    assert response.status_code == 200
    assert response.json()["aborted_reason"] == "empty feed: no valid employee rows"
    failure = _get_batch_run(JOB_HR_SYNC, "failure")
    assert failure is not None and failure.detail == "empty feed: no valid employee rows"
    assert client.post(HR_SYNC, headers=OPS).status_code == 200  # 중단은 가드를 쓰지 않아 409가 아니다


def test_hr_sync_upstream_error_is_not_swallowed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.hr import client as hr_client

    _mock_hr(monkeypatch, [_hr_row("x.user")])

    async def fail_fetch() -> NoReturn:
        raise RuntimeError("upstream down")

    monkeypatch.setattr(hr_client, "fetch_all_employees", fail_fetch)

    with pytest.raises(RuntimeError, match="upstream down"):
        client.post(HR_SYNC, headers=OPS)

    failure = _get_batch_run(JOB_HR_SYNC, "failure")
    assert failure is not None and failure.detail == "upstream down"
    assert _count_rows(HrSyncRun) == 1  # 실패도 회차로 남는다


# ── 프리뷰 ────────────────────────────────────────────────────────────────────


def test_hr_sync_preview_reports_without_writes(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_employee("pv.gone", source="hr")
    _seed_employee("PV.case", source="hr")
    _mock_hr(monkeypatch, [_hr_row("pv.new"), _hr_row("pv.case")])
    employees_before = _count_rows(Employee)

    response = client.get(HR_PREVIEW, headers=OPS)

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {f.name for f in fields(HrSyncPreview)}
    assert "pv.new" in body["new_login_ids"]
    assert "pv.gone" in body["delete_login_ids"]
    assert any("pv.case" in mismatch for mismatch in body["case_mismatches"])  # 표기 불일치 감지
    assert _get_employee("pv.new") is None  # 무변경
    assert _get_employee("pv.gone") is not None
    assert _count_rows(Employee) == employees_before
    assert _count_rows(HrSyncRun) == 0


def test_hr_sync_preview_does_not_use_up_the_sync_throttle(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _mock_hr(monkeypatch, [_hr_row("dry.user")])

    assert client.get(HR_PREVIEW, headers=OPS).status_code == 200

    assert client.post(HR_SYNC, headers=OPS).status_code == 200


# ── 회차 이력 ─────────────────────────────────────────────────────────────────


def test_hr_sync_runs_are_newest_first_and_default_to_20(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_hr(monkeypatch, [])
    _add_hr_runs(25)

    response = client.get(HR_RUNS, headers=OPS)

    assert response.status_code == 200
    runs = response.json()
    assert [run["scanned"] for run in runs] == list(range(25, 5, -1))
    assert set(runs[0]) == {
        "id", "ran_at", "outcome", "detail", "scanned", "created", "deactivated", "reactivated",
        "deleted", "skipped", "duplicates", "managed", "mass_departure",
    }  # 바뀐 사람 목록(changes)은 목록에 싣지 않는다
    assert runs[0]["ran_at"].endswith("+09:00")


def test_hr_sync_runs_limit_is_clamped_not_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_hr(monkeypatch, [])
    _add_hr_runs(205)

    two = client.get(f"{HR_RUNS}?limit=2", headers=OPS).json()
    oversized = client.get(f"{HR_RUNS}?limit=100000", headers=OPS)

    assert [run["scanned"] for run in two] == [205, 204]
    assert oversized.status_code == 200 and len(oversized.json()) == 200  # 상한을 넘는 limit은 잘라서 받는다
    assert client.get(f"{HR_RUNS}?limit=0", headers=OPS).status_code == 422


def test_hr_sync_runs_show_a_run_made_through_the_api(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_employee("api.leave", source="hr", active=True)
    _mock_hr(monkeypatch, [_hr_row("api.leave", status="inactive")])
    assert client.post(HR_SYNC, headers=OPS).status_code == 200

    runs = client.get(HR_RUNS, headers=OPS).json()

    assert len(runs) == 1
    assert runs[0]["outcome"] == "success" and runs[0]["deactivated"] == 1 and runs[0]["managed"] == 1
    assert runs[0]["detail"] is None


# ── 배치 상태 ─────────────────────────────────────────────────────────────────


def test_batch_runs_are_ordered_by_job_then_outcome(client: TestClient) -> None:
    _record_batch_run(JOB_HR_SYNC, "success", "scanned 3")
    _record_batch_run(JOB_DB_BACKUP, "success", None)
    _record_batch_run(JOB_HR_SYNC, "failure", "boom")
    _record_batch_run(JOB_DB_BACKUP, "failure", "disk full")

    response = client.get(BATCH_RUNS, headers=PROD)

    assert response.status_code == 200
    runs = response.json()
    assert [(run["job"], run["outcome"]) for run in runs] == [
        ("db_backup", "failure"), ("db_backup", "success"), ("hr_sync", "failure"), ("hr_sync", "success"),
    ]
    assert set(runs[0]) == {"job", "outcome", "ran_at", "detail"}
    assert runs[0]["detail"] == "disk full" and runs[1]["detail"] is None
    assert runs[0]["ran_at"].endswith("+09:00")


def test_batch_runs_is_empty_before_any_run(client: TestClient) -> None:
    assert client.get(BATCH_RUNS, headers=PROD).json() == []
