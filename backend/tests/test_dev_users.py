"""dev 디렉터리 시드 — 공용 데이터 표(부서 7·사용자 5)가 그대로 들어가고, 여러 번 불러도 같다."""

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.db import SessionLocal
from app.dev_users import DEV_DEPARTMENTS, DEV_USERS, seed_dev_directory
from app.main import app
from app.models import Department, Employee
from app.settings import settings

pytestmark = pytest.mark.usefixtures("clean_directory")

# 공용 데이터 표(plan global.md) — frontend lib/dev-auth.ts LOCAL_USERS와 같은 값
EXPECTED_DEPARTMENTS = {
    "CORP": (None, "Example Pharma", "예시제약", 1),
    "DIV-QA": ("CORP", "Quality Division", "품질본부", 2),
    "TEAM-QA1": ("DIV-QA", "QA Team 1", "품질보증1팀", 3),
    "DIV-PROD": ("CORP", "Production Division", "생산본부", 2),
    "TEAM-PROD1": ("DIV-PROD", "Production Team 1", "생산1팀", 3),
    "DIV-IT": ("CORP", "IT Division", "IT본부", 2),
    "TEAM-IT1": ("DIV-IT", "IT Ops Team", "IT운영팀", 3),
}
EXPECTED_USERS = {
    "dev.admin": ("Dev Admin", "개발관리자", "TEAM-IT1"),
    "qa.lead": ("QA Lead", "품질리드", "DIV-QA"),
    "qa.member": ("QA Member", "품질담당", "TEAM-QA1"),
    "prod.member": ("Production Member", "생산담당", "TEAM-PROD1"),
    "ops.member": ("Ops Member", "운영담당", "TEAM-IT1"),
}


def _run(coro_factory):
    async def _go():
        async with SessionLocal() as session:
            return await coro_factory(session)

    return asyncio.run(_go())


async def _count(session, model) -> int:
    return await session.scalar(select(func.count()).select_from(model))


async def _empty_tables(session) -> None:
    await session.execute(delete(Employee))
    await session.execute(delete(Department))
    await session.commit()


def test_dev_data_matches_the_shared_table() -> None:
    assert {
        d.dept_code: (d.parent_dept_code, d.name, d.name_ko, d.level) for d in DEV_DEPARTMENTS
    } == EXPECTED_DEPARTMENTS
    assert {u.login_id: (u.name, u.korean_name, u.dept_code) for u in DEV_USERS} == EXPECTED_USERS
    assert len(DEV_DEPARTMENTS) == 7 and len(DEV_USERS) == 5


def test_seed_dev_directory_idempotent() -> None:
    async def _seed_twice(session) -> tuple[int, int]:
        await _empty_tables(session)
        await seed_dev_directory(session)
        await seed_dev_directory(session)
        return await _count(session, Employee), await _count(session, Department)

    assert _run(_seed_twice) == (5, 7)


def test_seeded_rows_carry_the_directory_fields() -> None:
    async def _load(session) -> Employee:
        return await session.get(Employee, "qa.member")

    emp = _run(_load)
    assert emp.source == "dev" and emp.active is True
    assert (emp.name, emp.korean_name, emp.dept_code) == ("QA Member", "품질담당", "TEAM-QA1")
    assert (emp.department, emp.korean_dept) == ("QA Team 1", "품질보증1팀")


def test_seeded_departments_form_a_single_tree() -> None:
    async def _load(session) -> list[Department]:
        return list((await session.scalars(select(Department))).all())

    depts = {d.dept_code: d for d in _run(_load)}
    assert [c for c, d in depts.items() if d.parent_dept_code is None] == ["CORP"]
    assert all(d.parent_dept_code in depts for c, d in depts.items() if c != "CORP")
    assert all(u.dept_code in depts for u in DEV_USERS)


def test_seed_only_inserts_what_is_missing() -> None:
    """이미 있는 행은 고치지 않는다 — 개발자가 손본 값이나 HR이 채운 값을 덮어쓰지 않게."""

    async def _edit_and_reseed(session) -> tuple[str, bool]:
        lead = await session.get(Employee, "qa.lead")
        lead.korean_name = "수정됨"
        qa_member = await session.get(Employee, "qa.member")
        await session.delete(qa_member)
        await session.commit()
        await seed_dev_directory(session)
        return (await session.get(Employee, "qa.lead")).korean_name, (await session.get(Employee, "qa.member")) is not None

    assert _run(_edit_and_reseed) == ("수정됨", True)  # 고친 값은 유지, 지워진 행은 복원


def test_lifespan_seeds_in_dev_mode_only(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _run(_empty_tables)

    monkeypatch.setattr(settings, "auth_mode", "keycloak")
    with TestClient(app):
        pass
    assert _run(lambda s: _count(s, Employee)) == 0  # 실 인증 모드는 가짜 사용자를 만들지 않는다

    monkeypatch.setattr(settings, "auth_mode", "dev")
    with TestClient(app):
        pass
    assert _run(lambda s: _count(s, Employee)) == 5
