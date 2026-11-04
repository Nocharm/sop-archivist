"""HR 동기화 회차 이력·상태 판정 — 대량 퇴직은 멈추지 않고 기록하며, 배치 실행 기록은 (job, outcome)별 1행이다."""

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.batch_runs import JOB_DB_BACKUP, JOB_HR_SYNC, record_batch_run
from app.db import SessionLocal
from app.hr import history
from app.models import BatchJobRun, HrSyncRun
from tests.hr_sync_helpers import _get_employee, _hr_row, _mock_hr, _seed_employee

pytestmark = pytest.mark.usefixtures("clean_directory")


def _get_history() -> list[HrSyncRun]:
    async def _run() -> list[HrSyncRun]:
        async with SessionLocal() as session:
            return list((await session.scalars(select(HrSyncRun).order_by(HrSyncRun.id))).all())

    return asyncio.run(_run())


def _get_batch_run(job: str, outcome: str) -> BatchJobRun | None:
    async def _run() -> BatchJobRun | None:
        async with SessionLocal() as session:
            return await session.get(BatchJobRun, (job, outcome))

    return asyncio.run(_run())


def _run_full_sync():
    from app.hr.service import run_full_sync

    async def _run():
        async with SessionLocal() as session:
            return await run_full_sync(session)

    return asyncio.run(_run())


def test_status_case_does_not_deactivate(client: TestClient, monkeypatch) -> None:
    _seed_employee("case.user", source="hr", active=True)
    _mock_hr(monkeypatch, [_hr_row("case.user", status="Active")])

    summary = _run_full_sync()

    assert summary.deactivated == 0
    assert _get_employee("case.user").active is True


def test_missing_org_levels_keep_existing_org(client: TestClient, monkeypatch) -> None:
    _seed_employee(
        "org.keep", source="hr", department="Team Q", org_l1="Div", org_l2="Team Q",
    )
    _mock_hr(monkeypatch, [_hr_row("org.keep", department=None, org_levels=[])])

    _run_full_sync()

    emp = _get_employee("org.keep")
    assert (emp.org_l1, emp.org_l2, emp.department) == ("Div", "Team Q", "Team Q")


def test_duplicate_login_prefers_active_row(client: TestClient, monkeypatch) -> None:
    _seed_employee("dup.user", source="hr", active=True)
    _mock_hr(monkeypatch, [
        _hr_row("dup.user"),
        _hr_row("dup.user", status="inactive"),  # 낡은 퇴직 행이 뒤에 와도
    ])

    summary = _run_full_sync()

    assert _get_employee("dup.user").active is True
    assert summary.duplicates == 1
    run = _get_history()[-1]
    assert [p["login_id"] for p in run.changes["duplicates"]] == ["dup.user"]


def test_success_run_records_who_changed(client: TestClient, monkeypatch) -> None:
    _seed_employee("hist.leave", source="hr", active=True, korean_name="퇴직자")
    _seed_employee("hist.back", source="hr", active=False)
    _seed_employee("hist.gone", source="hr", active=True, name="Gone Kim", department="Team G")
    _mock_hr(monkeypatch, [
        _hr_row("hist.leave", status="inactive"),
        _hr_row("hist.back"),
        _hr_row("hist.new", department="Team N", org_levels=["Div", "Team N"]),
    ])

    summary = _run_full_sync()

    assert summary.aborted_reason is None
    run = _get_history()[-1]
    assert run.outcome == "success" and run.detail is None
    assert {p["login_id"] for p in run.changes["deactivated"]} == {"hist.leave"}
    assert run.changes["deactivated"][0]["name"] == "퇴직자"
    assert {p["login_id"] for p in run.changes["reactivated"]} == {"hist.back"}
    assert {p["login_id"] for p in run.changes["created"]} == {"hist.new"}
    gone = next(p for p in run.changes["deleted"] if p["login_id"] == "hist.gone")
    assert gone == {"login_id": "hist.gone", "name": "Gone Kim", "department": "Team G"}
    assert (run.deactivated, run.reactivated, run.created) == (1, 1, 1)
    assert run.deleted == len(run.changes["deleted"]) == 1  # dev 행은 삭제 후보가 아니다


def test_retirees_become_inactive_not_deleted(client: TestClient, monkeypatch) -> None:
    _seed_employee("retire.user", source="hr", active=True)
    _mock_hr(monkeypatch, [_hr_row("retire.user", status="inactive")])

    _run_full_sync()

    emp = _get_employee("retire.user")
    assert emp is not None and emp.active is False


def test_mass_departure_is_recorded_not_blocked(client: TestClient, monkeypatch) -> None:
    ids = [f"mass.{i:02d}" for i in range(12)]
    for login_id in ids:
        _seed_employee(login_id, source="hr", active=True)
    _mock_hr(monkeypatch, [_hr_row(login_id, status="inactive") for login_id in ids])

    summary = _run_full_sync()

    assert summary.aborted_reason is None  # 멈추지 않는다
    assert summary.mass_departure is True
    assert all(_get_employee(login_id).active is False for login_id in ids)
    run = _get_history()[-1]
    assert run.mass_departure is True
    assert run.deactivated == 12


def test_aborted_run_is_recorded_as_failure(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [])  # 빈 피드 → 가드 중단

    summary = _run_full_sync()

    run = _get_history()[-1]
    assert run.outcome == "failure"
    assert run.detail == summary.aborted_reason
    assert run.changes is None


def test_mass_departure_threshold() -> None:
    assert history.is_mass_departure(10, 200) is True     # 5%·10명
    assert history.is_mass_departure(9, 100) is False     # 10명 미만
    assert history.is_mass_departure(20, 1000) is False   # 2%
    assert history.is_mass_departure(300, 6000) is True


def test_history_keeps_latest_runs(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(history, "HR_SYNC_HISTORY_KEEP", 3)

    async def _run() -> None:
        async with SessionLocal() as session:
            for index in range(5):
                await history.record_hr_sync_run(
                    session, HrSyncRun(outcome="success", scanned=index)
                )

    asyncio.run(_run())

    assert [run.scanned for run in _get_history()] == [2, 3, 4]


def test_history_keeps_200_runs_by_default() -> None:
    assert history.HR_SYNC_HISTORY_KEEP == 200


def test_history_count_stays_one_per_run(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("once.user")])
    _run_full_sync()

    async def _count() -> int:
        async with SessionLocal() as session:
            return await session.scalar(select(func.count()).select_from(HrSyncRun))

    assert asyncio.run(_count()) == 1


def test_full_sync_writes_batch_job_run(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("batch.user")])

    _run_full_sync()

    row = _get_batch_run(JOB_HR_SYNC, "success")
    assert row is not None and row.detail.startswith("scanned 1 · upserted 1")
    assert _get_batch_run(JOB_HR_SYNC, "failure") is None


def test_aborted_sync_writes_failure_batch_run(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [])

    summary = _run_full_sync()

    row = _get_batch_run(JOB_HR_SYNC, "failure")
    assert row is not None and row.detail == summary.aborted_reason


def test_record_batch_run_keeps_one_row_per_job_and_outcome(client: TestClient) -> None:
    async def _record(job: str, outcome: str, detail: str | None) -> None:
        async with SessionLocal() as session:
            await record_batch_run(session, job, outcome, detail)

    asyncio.run(_record(JOB_HR_SYNC, "success", "first"))
    asyncio.run(_record(JOB_HR_SYNC, "success", "second"))
    asyncio.run(_record(JOB_HR_SYNC, "failure", "boom"))
    asyncio.run(_record(JOB_DB_BACKUP, "success", None))

    async def _rows() -> list[BatchJobRun]:
        async with SessionLocal() as session:
            return list((await session.scalars(select(BatchJobRun))).all())

    rows = asyncio.run(_rows())
    assert sorted((r.job, r.outcome) for r in rows) == [
        ("db_backup", "success"), ("hr_sync", "failure"), ("hr_sync", "success"),
    ]
    assert _get_batch_run(JOB_HR_SYNC, "success").detail == "second"  # 최신 값으로 갱신
