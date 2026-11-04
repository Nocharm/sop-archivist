"""HR 동기화 테스트 공유 헬퍼 — 행 빌더·목·시드 (test_hr_sync/history/active_filter 공용)."""

import asyncio

import httpx2

from app.db import SessionLocal
from app.hr.client import RawHrEmployee
from app.models import Employee
from app.settings import settings


# _mock_hr가 설정하는 웹훅 주소 — 실패 기록·응답에 새면 안 되는 값
HR_TEST_URL = "http://hr.test/webhook"


def _make_status_error(status: int = 502) -> httpx2.HTTPStatusError:
    """실제 raise_for_status가 만드는 예외 — 메시지에 웹훅 주소가 들어 있어 누출 검사의 전제가 된다."""
    request = httpx2.Request("POST", HR_TEST_URL)
    try:
        httpx2.Response(status, request=request).raise_for_status()
    except httpx2.HTTPStatusError as exc:
        assert HR_TEST_URL in str(exc)
        return exc
    raise AssertionError(f"status {status} did not raise")


def _hr_row(login_id: str, **overrides) -> RawHrEmployee:
    base = dict(
        login_id=login_id, status="active", name=login_id, name_ko=None, dept_code=None,
        department="Team A", department_ko=None, org_levels=["Div", "Team A"],
    )
    base.update(overrides)
    return RawHrEmployee(**base)


def _mock_hr(monkeypatch, employees: list, count: int | None = None, departments: list | None = None) -> None:
    """HR 설정 위장 + 가드 리셋 + fetch 목 — parsed 리스트(None=skip 행 포함)를 그대로 주입.

    삭제 상한 가드는 기본 해제(cap=0) — 소규모 피드가 상한을 오탐하면 가드와 무관한 테스트가
    abort로 오염된다. 가드 테스트만 명시적으로 켠다.
    """
    from app.hr import client as hr_client
    from app.hr import service as hr_service

    monkeypatch.setattr(settings, "n8n_hr_url", HR_TEST_URL)
    monkeypatch.setattr(settings, "n8n_hr_token", "tok")
    monkeypatch.setattr(settings, "hr_sync_delete_cap_pct", 0)
    monkeypatch.setattr(hr_service, "_last_full_sync_at", None)

    async def fake_all():
        return (count if count is not None else sum(1 for e in employees)), employees

    async def fake_depts():
        return departments or []

    monkeypatch.setattr(hr_client, "fetch_all_employees", fake_all)
    monkeypatch.setattr(hr_client, "fetch_departments", fake_depts)


def _seed_employee(login_id: str, *, source: str, active: bool = True, **cols) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, login_id)
            if emp is None:
                emp = Employee(login_id=login_id)
                session.add(emp)
            emp.source = source
            emp.active = active
            for key, value in cols.items():
                setattr(emp, key, value)
            await session.commit()

    asyncio.run(_run())


def _get_employee(login_id: str) -> Employee | None:
    async def _run() -> Employee | None:
        async with SessionLocal() as session:
            return await session.get(Employee, login_id)

    return asyncio.run(_run())


def _run_sync():
    from app.hr.service import sync_all

    async def _run():
        async with SessionLocal() as session:
            return await sync_all(session)

    return asyncio.run(_run())
