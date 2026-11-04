"""HR 전체·단건 동기화 테스트 — 목·시드 헬퍼는 hr_sync_helpers 공유(실 HTTP 없음)."""

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import SessionLocal
from app.dev_users import DEV_DEPARTMENTS, DEV_USERS
from app.hr import client as hr_client
from app.hr import service as hr_service
from app.hr.client import RawHrDepartment
from app.models import Department, Employee, HrSyncRun
from app.settings import settings
from tests.hr_sync_helpers import _get_employee, _hr_row, _mock_hr, _run_sync, _seed_employee

pytestmark = pytest.mark.usefixtures("clean_directory")


def _count_rows(model: type) -> int:
    async def _run() -> int:
        async with SessionLocal() as session:
            return await session.scalar(select(func.count()).select_from(model))

    return asyncio.run(_run())


def test_sync_upserts_hr_rows(client: TestClient, monkeypatch) -> None:
    _seed_employee("old.hr", source="hr", name="Old", korean_name="기존")
    _mock_hr(monkeypatch, [_hr_row("old.hr", name="Old Kim"), _hr_row("new.hr")])
    summary = _run_sync()
    assert summary.upserted == 2 and summary.created == 1 and summary.aborted_reason is None
    emp = _get_employee("old.hr")
    assert emp.source == "hr" and emp.name == "Old Kim"
    assert emp.korean_name == "기존"  # nameKo null → 기존값 보존(소거 아님)
    new = _get_employee("new.hr")
    assert new is not None and new.source == "hr" and new.active is True


def test_sync_deactivates_and_preserves_dev(client: TestClient, monkeypatch) -> None:
    _seed_employee("quit.user", source="hr", active=True)
    _mock_hr(monkeypatch, [_hr_row("quit.user", status="inactive")])
    summary = _run_sync()
    assert summary.deactivated == 1
    assert _get_employee("quit.user").active is False  # 퇴직은 삭제가 아니라 비활성
    assert _get_employee("dev.admin").active is True  # dev 시드 행은 그대로


def test_sync_deletes_absent_hr_rows_only(client: TestClient, monkeypatch) -> None:
    _seed_employee("gone.hr", source="hr")
    _mock_hr(monkeypatch, [_hr_row("alive.hr")])  # 가드는 _mock_hr가 기본 해제
    summary = _run_sync()
    assert summary.deleted == 1
    assert _get_employee("gone.hr") is None
    assert _get_employee("alive.hr") is not None
    assert _get_employee("qa.lead") is not None  # dev 행은 피드에 없어도 지우지 않는다


def test_sync_never_deletes_dev_rows(client: TestClient, monkeypatch) -> None:
    """dev 시드 뒤 비어 있지 않은 HR 피드로 전체 동기화해도 source=dev 행은 그대로다."""
    before = {u.login_id: _get_employee(u.login_id) for u in DEV_USERS}
    assert all(emp is not None and emp.source == "dev" for emp in before.values())
    _seed_employee("real.hr", source="hr")
    _mock_hr(monkeypatch, [_hr_row("real.hr"), _hr_row("other.hr")])  # 빈 부서 피드 = 부서 삭제 스킵

    summary = _run_sync()

    assert summary.aborted_reason is None
    for user in DEV_USERS:
        emp = _get_employee(user.login_id)
        assert emp is not None and emp.source == "dev" and emp.active is True
        assert emp.name == user.name and emp.dept_code == user.dept_code
    assert _count_rows(Department) == len(DEV_DEPARTMENTS)


def test_sync_ignores_feed_rows_for_dev_login_ids(client: TestClient, monkeypatch) -> None:
    """피드에 dev 시드와 같은 loginId가 와도 그 행은 덮어쓰지도 비활성화하지도 않는다."""
    _mock_hr(monkeypatch, [
        _hr_row("dev.admin", name="Real Person", status="inactive", dept_code="X-1"),
        _hr_row("someone.else"),
    ])
    summary = _run_sync()
    assert summary.upserted == 1 and summary.deactivated == 0
    emp = _get_employee("dev.admin")
    assert (emp.source, emp.name, emp.active, emp.dept_code) == ("dev", "Dev Admin", True, "TEAM-IT1")


def test_sync_delete_cap_aborts_without_changes(client: TestClient, monkeypatch) -> None:
    _seed_employee("cap.a", source="hr")
    _seed_employee("cap.b", source="hr")
    _mock_hr(monkeypatch, [_hr_row("cap.new")])  # 기존 배치 관리 행이 전부 삭제될 피드
    monkeypatch.setattr(settings, "hr_sync_delete_cap_pct", 20)  # _mock_hr 기본 해제 후 가드 재활성
    summary = _run_sync()
    assert summary.aborted_reason is not None and "delete cap" in summary.aborted_reason
    assert _get_employee("cap.a") is not None and _get_employee("cap.b") is not None  # 아무것도 안 바뀜
    assert _get_employee("cap.new") is None


def test_sync_delete_cap_boundary_is_allowed(client: TestClient, monkeypatch) -> None:
    """상한은 초과일 때만 막는다 — 10명 중 2명(정확히 20%) 삭제는 통과."""
    ids = [f"edge.{i:02d}" for i in range(10)]
    for login_id in ids:
        _seed_employee(login_id, source="hr")
    _mock_hr(monkeypatch, [_hr_row(login_id) for login_id in ids[:8]])
    monkeypatch.setattr(settings, "hr_sync_delete_cap_pct", 20)
    summary = _run_sync()
    assert summary.aborted_reason is None and summary.deleted == 2
    assert _get_employee("edge.09") is None


def test_sync_count_mismatch_aborts_without_changes(client: TestClient, monkeypatch) -> None:
    _seed_employee("count.keep", source="hr")
    _mock_hr(monkeypatch, [_hr_row("x.y")], count=99)
    summary = _run_sync()
    assert summary.aborted_reason is not None and "count mismatch" in summary.aborted_reason
    assert _get_employee("count.keep") is not None  # 아무것도 안 바뀜
    assert _get_employee("x.y") is None


def test_sync_empty_feed_aborts_without_changes(client: TestClient, monkeypatch) -> None:
    # 유효 직원 0명 = 전멸 사고 방어 — cap=0(_mock_hr 기본, 가드 off)이어도 막혀야 한다
    _seed_employee("survivor.hr", source="hr")
    _mock_hr(monkeypatch, [])
    summary = _run_sync()
    assert summary.aborted_reason == "empty feed: no valid employee rows"
    assert _get_employee("survivor.hr") is not None  # 아무것도 안 바뀜


def test_sync_feed_of_only_dev_ids_counts_as_empty(client: TestClient, monkeypatch) -> None:
    """관리 대상 행이 하나도 남지 않는 피드는 전멸 방어로 중단한다 — hr 행을 모두 지우지 않는다."""
    _seed_employee("survivor.hr", source="hr")
    _mock_hr(monkeypatch, [_hr_row("dev.admin"), _hr_row("qa.lead")])
    summary = _run_sync()
    assert summary.aborted_reason == "empty feed: no valid employee rows"
    assert _get_employee("survivor.hr") is not None


def test_sync_skips_rows_without_login_id_and_reports(client: TestClient, monkeypatch) -> None:
    rows = [_hr_row("ok.user"), None,
            _hr_row("deep.user", org_levels=["A", "B", "C", "D", "E", "F"], department="F")]
    _mock_hr(monkeypatch, rows)
    summary = _run_sync()
    assert summary.skipped == 1
    assert summary.truncated_levels == 1 and summary.org_mismatches == 1


def test_sync_clips_oversized_fields_and_skips_long_login_id(client: TestClient, monkeypatch) -> None:
    # Postgres VARCHAR 초과 사각 — sqlite는 강제 안 하지만 클램프·skip 로직 자체를 검증
    long_name = "N" * 250
    long_dept_code = "D" * 120
    long_login_id = "L" * 110
    rows = [
        _hr_row("clip.user", name=long_name, dept_code=long_dept_code),
        _hr_row(long_login_id),
    ]
    _mock_hr(monkeypatch, rows)
    summary = _run_sync()
    assert summary.skipped == 1  # 초과 login_id 행만 skip
    emp = _get_employee("clip.user")
    assert emp.name == long_name[:200]
    assert emp.dept_code == long_dept_code[:100]
    assert _get_employee(long_login_id) is None  # 저장 자체가 안 됨


def test_delete_chunk_is_500_rows() -> None:
    assert hr_service._DELETE_CHUNK == 500
    assert [len(c) for c in hr_service._chunks(list(range(1100)), 500)] == [500, 500, 100]


def test_sync_chunked_delete_over_bind_limit(client: TestClient, monkeypatch) -> None:
    # SQLite 바인드 상한(구버전 999) 초과 삭제가 청크로 완료되는지
    async def _seed_bulk() -> None:
        async with SessionLocal() as session:
            session.add_all(Employee(login_id=f"bulk{i}.hr", source="hr") for i in range(1100))
            await session.commit()

    asyncio.run(_seed_bulk())
    _mock_hr(monkeypatch, [_hr_row("survivor.hr")])
    summary = _run_sync()
    assert summary.deleted == 1100
    assert _get_employee("bulk0.hr") is None and _get_employee("bulk1099.hr") is None
    assert _get_employee("survivor.hr") is not None


def test_sync_mirrors_departments(client: TestClient, monkeypatch) -> None:
    depts = [RawHrDepartment("D1", "Div", "본부", None, 1), RawHrDepartment("D11", "Team A", "A팀", "D1", 2)]
    _mock_hr(monkeypatch, [_hr_row("mirror.user")], departments=depts)
    summary = _run_sync()
    assert summary.departments_upserted == 2

    async def _check() -> Department | None:
        async with SessionLocal() as session:
            return await session.get(Department, "D11")

    dept = asyncio.run(_check())
    assert dept is not None and dept.parent_dept_code == "D1" and dept.name_ko == "A팀" and dept.level == 2


def test_department_mirror_drops_codes_missing_from_feed(client: TestClient, monkeypatch) -> None:
    depts = [RawHrDepartment("D1", "Div", "본부", None, 1)]
    _mock_hr(monkeypatch, [_hr_row("mirror.user")], departments=depts)
    _run_sync()

    async def _codes() -> set[str]:
        async with SessionLocal() as session:
            return set((await session.scalars(select(Department.dept_code))).all())

    assert asyncio.run(_codes()) == {"D1"}  # 피드에 없는 코드(시드 포함)는 미러에서 빠진다


def test_full_sync_throttle_blocks_a_second_run_within_five_minutes(client: TestClient, monkeypatch) -> None:
    async def _run_guarded() -> None:
        async with SessionLocal() as session:
            await hr_service.run_full_sync(session)

    _mock_hr(monkeypatch, [_hr_row("throttle.user")])
    asyncio.run(_run_guarded())
    with pytest.raises(hr_service.SyncTooSoon) as exc:
        asyncio.run(_run_guarded())
    assert 0 < exc.value.remaining_seconds <= 300


async def _run_guarded_sync() -> hr_service.HrSyncSummary:
    async with SessionLocal() as session:
        return await hr_service.run_full_sync(session)


def test_overlapping_full_sync_is_rejected_while_one_is_running(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("lock.user")])
    monkeypatch.setattr(hr_service, "_full_sync_lock", asyncio.Lock())  # 앞선 테스트의 잠금 상태에 기대지 않는다
    fetch_calls = {"n": 0}

    async def _scenario() -> hr_service.SyncTooSoon:
        entered = asyncio.Event()
        release = asyncio.Event()

        async def blocking_fetch():
            fetch_calls["n"] += 1
            entered.set()
            await release.wait()
            return 1, [_hr_row("lock.user")]

        monkeypatch.setattr(hr_client, "fetch_all_employees", blocking_fetch)
        first = asyncio.create_task(_run_guarded_sync())
        await asyncio.wait_for(entered.wait(), timeout=5)
        with pytest.raises(hr_service.SyncTooSoon) as overlap:
            # 잠금이 없으면 이 호출도 HR 응답을 기다리다 시간 초과로 실패한다
            await asyncio.wait_for(_run_guarded_sync(), timeout=5)
        release.set()
        assert (await first).upserted == 1
        return overlap.value

    overlap = asyncio.run(_scenario())

    assert overlap.remaining_seconds == 0  # 진행 중 거절 — 5분 가드(남은 시간 > 0)와 구분된다
    assert fetch_calls["n"] == 1  # 거절된 쪽은 HR을 부르지 않았다
    assert _count_rows(HrSyncRun) == 1  # 거절은 회차로 남지 않는다
    assert not hr_service._full_sync_lock.locked()
    # 끝난 뒤엔 5분 가드가 막고(잠금이 아니라), 가드를 풀면 다시 돈다
    with pytest.raises(hr_service.SyncTooSoon) as throttled:
        asyncio.run(_run_guarded_sync())
    assert throttled.value.remaining_seconds > 0
    assert not hr_service._full_sync_lock.locked()
    monkeypatch.setattr(hr_service, "_last_full_sync_at", None)
    monkeypatch.setattr(hr_client, "fetch_all_employees", _fixed_feed)
    assert asyncio.run(_run_guarded_sync()).aborted_reason is None


async def _fixed_feed():
    return 1, [_hr_row("lock.user")]


def test_failed_full_sync_releases_the_lock(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("lock.user")])
    monkeypatch.setattr(hr_service, "_full_sync_lock", asyncio.Lock())

    async def fail_fetch():
        raise RuntimeError("boom")

    monkeypatch.setattr(hr_client, "fetch_all_employees", fail_fetch)
    with pytest.raises(RuntimeError):
        asyncio.run(_run_guarded_sync())

    assert not hr_service._full_sync_lock.locked()
    monkeypatch.setattr(hr_client, "fetch_all_employees", _fixed_feed)
    assert asyncio.run(_run_guarded_sync()).aborted_reason is None  # 실패한 시도는 가드도 잠금도 남기지 않는다


def test_aborted_run_does_not_consume_the_throttle(client: TestClient, monkeypatch) -> None:
    async def _run_guarded() -> hr_service.HrSyncSummary:
        async with SessionLocal() as session:
            return await hr_service.run_full_sync(session)

    _mock_hr(monkeypatch, [])
    assert asyncio.run(_run_guarded()).aborted_reason is not None

    async def fixed_feed():
        return 1, [_hr_row("retry.user")]

    monkeypatch.setattr(hr_client, "fetch_all_employees", fixed_feed)  # 가드 상태는 그대로 두고 피드만 교체
    assert asyncio.run(_run_guarded()).aborted_reason is None


def test_preview_reports_impact_without_touching_the_db(client: TestClient, monkeypatch) -> None:
    _seed_employee("pv.stay", source="hr", active=True)
    _seed_employee("pv.leave", source="hr", active=True)
    _seed_employee("pv.gone", source="hr", active=True)
    _mock_hr(monkeypatch, [
        _hr_row("pv.stay"), _hr_row("pv.leave", status="inactive"), _hr_row("pv.new"),
        _hr_row("dev.admin"),  # dev 행과 겹치는 피드 행은 영향 집계에서 뺀다
    ])

    async def _preview() -> hr_service.HrSyncPreview:
        async with SessionLocal() as session:
            return await hr_service.build_sync_preview(session)

    before = _count_rows(Employee)
    preview = asyncio.run(_preview())

    assert (preview.scanned, preview.would_upsert, preview.would_deactivate, preview.would_delete) == (4, 3, 1, 1)
    assert preview.new_login_ids == ["pv.new"] and preview.delete_login_ids == ["pv.gone"]
    assert _count_rows(Employee) == before  # DB 무변경
    assert _get_employee("pv.new") is None and _get_employee("pv.leave").active is True


def test_sync_one_upserts_once_per_day(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "n8n_hr_url", "http://hr.test/webhook")
    monkeypatch.setattr(settings, "n8n_hr_token", "tok")
    monkeypatch.setattr(hr_service, "_one_sync_done", {})
    calls = {"n": 0}

    async def fake_fetch(login_id: str):
        calls["n"] += 1
        return _hr_row(login_id, name="First Login", name_ko="첫로그인")

    monkeypatch.setattr(hr_client, "fetch_employee", fake_fetch)

    async def _sync() -> Employee | None:
        async with SessionLocal() as session:
            return await hr_service.sync_one(session, "first.login")

    emp = asyncio.run(_sync())
    assert emp is not None and emp.name == "First Login" and emp.korean_name == "첫로그인"
    assert asyncio.run(_sync()) is None  # 같은 날 두 번째는 웹훅을 부르지 않는다
    assert calls["n"] == 1


def test_sync_one_is_noop_when_hr_disabled(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "n8n_hr_url", "")
    monkeypatch.setattr(hr_service, "_one_sync_done", {})

    async def _sync() -> Employee | None:
        async with SessionLocal() as session:
            return await hr_service.sync_one(session, "nobody")

    assert asyncio.run(_sync()) is None


def test_sync_one_keeps_existing_row_when_webhook_fails(client: TestClient, monkeypatch) -> None:
    """웹훅 장애가 로그인을 막으면 안 된다 — 예외를 삼키고 기존 행을 그대로 둔다."""
    monkeypatch.setattr(settings, "n8n_hr_url", "http://hr.test/webhook")
    monkeypatch.setattr(settings, "n8n_hr_token", "tok")
    monkeypatch.setattr(hr_service, "_one_sync_done", {})
    _seed_employee("flaky.user", source="hr", name="Before")

    async def boom(login_id: str):
        raise RuntimeError("webhook down")

    monkeypatch.setattr(hr_client, "fetch_employee", boom)

    async def _sync() -> Employee | None:
        async with SessionLocal() as session:
            return await hr_service.sync_one(session, "flaky.user")

    assert asyncio.run(_sync()) is None
    assert _get_employee("flaky.user").name == "Before"


def test_sync_one_never_touches_dev_rows(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "n8n_hr_url", "http://hr.test/webhook")
    monkeypatch.setattr(settings, "n8n_hr_token", "tok")
    monkeypatch.setattr(hr_service, "_one_sync_done", {})

    calls = {"n": 0}

    async def fake_fetch(login_id: str):
        calls["n"] += 1
        return _hr_row(login_id, name="Real Person", status="inactive")

    monkeypatch.setattr(hr_client, "fetch_employee", fake_fetch)

    async def _sync() -> Employee | None:
        async with SessionLocal() as session:
            return await hr_service.sync_one(session, "qa.lead")

    assert asyncio.run(_sync()) is None
    assert calls["n"] == 0  # dev 행이면 웹훅도 부르지 않는다
    emp = _get_employee("qa.lead")
    assert (emp.source, emp.name, emp.active) == ("dev", "QA Lead", True)
