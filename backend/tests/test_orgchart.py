"""orgchart 단위 테스트 — 경로 해석(체인·폴백·가드)과 권한 판정용 부서 체인 코드."""

import asyncio
from collections.abc import Callable, Coroutine
from typing import Any, TypeVar

import pytest

from app.db import SessionLocal
from app.models import Department, Employee
from app.orgchart import DeptIndex, get_dept_chain_codes, load_dept_index, resolve_org_path

T = TypeVar("T")


def _seed(coro_factory: Callable[[Any], Coroutine[Any, Any, T]]) -> T:
    """비동기 SessionLocal 작업을 동기 테스트에서 실행한다 — 이 코드베이스에는 async 테스트 러너가 없다."""

    async def _run() -> T:
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_run())


@pytest.fixture
def session() -> Callable[[Callable[[Any], Coroutine[Any, Any, T]]], T]:
    """DB 직접 조작용 — load_dept_index를 실제 세션으로 검증."""
    return _seed


def _dept(code: str, name: str, parent: str | None = None, name_ko: str = "") -> Department:
    return Department(dept_code=code, name=name, name_ko=name_ko, parent_dept_code=parent, level=0)


def _emp(login_id: str = "u.one", dept_code: str | None = None, **org: str) -> Employee:
    return Employee(
        login_id=login_id, name="U One", dept_code=dept_code,
        org_l1=org.get("org_l1"), org_l2=org.get("org_l2"), org_l3=org.get("org_l3"),
        org_l4=org.get("org_l4"), org_l5=org.get("org_l5"),
        department=org.get("department", ""),
    )


def _index(*depts: Department) -> DeptIndex:
    """세션 없이 인덱스 직조립 — load_dept_index와 같은 형태."""
    return DeptIndex(by_code={d.dept_code: (d.name, d.parent_dept_code) for d in depts})


def _generic_tops() -> tuple[Department, Department]:
    """HR 조직 최상위 2레벨(법인·사업부급) — settings.org_trim_levels가 해석 시 제외."""
    return _dept("D0a", "Corp Holding"), _dept("D0b", "Bio Business", "D0a")


def test_chain_resolves_root_to_leaf_with_top_levels_trimmed() -> None:
    idx = _index(
        *_generic_tops(),
        _dept("D1", "Alpha Division", "D0b"),
        _dept("D2", "Beta Office", "D1"),
        _dept("D3", "Gamma Team", "D2"),
    )
    emp = _emp(dept_code="D3", org_l1="Stale Root", department="Stale Leaf")
    assert resolve_org_path(emp, idx) == "Alpha Division/Beta Office/Gamma Team"


def test_trim_keeps_leaf_when_chain_short() -> None:
    """체인이 트림 레벨 이하로 짧으면 리프만 남긴다 — 범용 레벨 직속 직원 엣지."""
    idx = _index(*_generic_tops())
    emp = _emp(dept_code="D0b")
    assert resolve_org_path(emp, idx) == "Bio Business"


def test_trim_applies_only_to_chain_not_fallback() -> None:
    """트림은 체인 해석 전용 — org 컬럼 폴백은 원본 그대로."""
    idx = _index()
    emp = _emp(dept_code=None, org_l1="Corp Holding", org_l2="Bio Business", org_l3="Alpha", department="Alpha")
    assert resolve_org_path(emp, idx) == "Corp Holding/Bio Business/Alpha"


def test_fallback_when_dept_code_missing_or_stale() -> None:
    idx = _index(_dept("D1", "Alpha Division"))
    legacy = _emp(dept_code=None, org_l1="A", org_l2="B", department="B")
    stale = _emp(dept_code="ZZZ", org_l1="A", org_l2="B", department="B")
    assert resolve_org_path(legacy, idx) == "A/B"
    assert resolve_org_path(stale, idx) == "A/B"


def test_fallback_without_org_columns_is_the_department_name() -> None:
    assert resolve_org_path(_emp(dept_code=None, department="Solo Team"), _index()) == "Solo Team"


def test_fallback_when_departments_empty() -> None:
    idx = _index()
    emp = _emp(dept_code="D3", org_l1="A", org_l2="B", department="B")
    assert resolve_org_path(emp, idx) == "A/B"


def test_cycle_guard_falls_back() -> None:
    idx = _index(_dept("D1", "Alpha", "D2"), _dept("D2", "Beta", "D1"))
    emp = _emp(dept_code="D1", org_l1="A", department="A")
    assert resolve_org_path(emp, idx) == "A"


def test_empty_name_segment_skipped() -> None:
    idx = _index(
        *_generic_tops(),
        _dept("D1", "Alpha", "D0b"),
        _dept("D2", "", "D1"),
        _dept("D3", "Gamma", "D2"),
    )
    emp = _emp(dept_code="D3")
    assert resolve_org_path(emp, idx) == "Alpha/Gamma"


def test_all_names_empty_falls_back() -> None:
    idx = _index(_dept("D1", ""), _dept("D2", "", "D1"))
    emp = _emp(dept_code="D2", org_l1="A", department="A")
    assert resolve_org_path(emp, idx) == "A"


def test_slash_in_dept_name_sanitized() -> None:
    """부서명 속 "/"(AX/PI Department 등)는 전각 슬래시로 치환 — 경로 구분자와 섞이지 않게."""
    idx = _index(
        *_generic_tops(),
        _dept("D1", "Alpha Division", "D0b"),
        _dept("D2", "AX/PI Department", "D1"),
    )
    path = resolve_org_path(_emp(dept_code="D2"), idx)
    assert path == "Alpha Division/AX／PI Department"
    assert len(path.split("/")) == 2  # 이름 내부 슬래시로 3조각 나면 파손


def test_slash_sanitized_in_fallback_columns() -> None:
    idx = _index()
    emp = _emp(dept_code=None, org_l1="Ops", org_l2="ADC T/F", department="ADC T/F")
    assert resolve_org_path(emp, idx) == "Ops/ADC T／F"


def test_broken_parent_chain_falls_back_to_columns() -> None:
    """부모 코드가 미러에 없는 단절 체인 — 부분 경로(루트로 뜨는 고아) 대신 org 컬럼 폴백."""
    idx = _index(_dept("D9", "Dangling Team", "MISSING-PARENT"))
    emp = _emp(dept_code="D9", org_l1="Real Root", org_l2="Real Office", department="Real Office")
    assert resolve_org_path(emp, idx) == "Real Root/Real Office"


@pytest.mark.usefixtures("clean_directory")
def test_load_dept_index_reads_every_department_once(
    session: Callable[[Callable[[Any], Coroutine[Any, Any, Any]]], Any],
) -> None:
    async def _seed_depts(db_session: Any) -> None:
        db_session.add_all([_dept("ORGT-B2", "Bravo", "ORGT-A1"), _dept("ORGT-A1", "Alpha")])

    session(_seed_depts)
    idx = session(load_dept_index)
    assert idx.by_code["ORGT-B2"] == ("Bravo", "ORGT-A1")
    assert idx.by_code["ORGT-A1"] == ("Alpha", None)
    assert {"CORP", "TEAM-QA1"} <= idx.by_code.keys()  # dev 시드 부서도 함께 읽힌다


def _chain_index() -> DeptIndex:
    return _index(
        _dept("CORP", "Example Pharma"),
        _dept("DIV-QA", "Quality Division", "CORP"),
        _dept("TEAM-QA1", "QA Team 1", "DIV-QA"),
    )


def test_get_dept_chain_codes_normal() -> None:
    assert get_dept_chain_codes(_chain_index(), "TEAM-QA1") == ["TEAM-QA1", "DIV-QA", "CORP"]
    assert get_dept_chain_codes(_chain_index(), "CORP") == ["CORP"]  # 루트는 자기 자신만


def test_get_dept_chain_codes_unknown() -> None:
    idx = _chain_index()
    assert get_dept_chain_codes(idx, "NOPE") == []
    assert get_dept_chain_codes(idx, None) == []
    assert get_dept_chain_codes(idx, "") == []


def test_get_dept_chain_codes_broken_parent() -> None:
    idx = _index(_dept("TEAM-X", "Team X", "GONE"))  # 부모 코드가 미러에 없다
    assert get_dept_chain_codes(idx, "TEAM-X") == ["TEAM-X"]


def test_get_dept_chain_codes_cycle() -> None:
    idx = _index(_dept("A", "A", "B"), _dept("B", "B", "A"))
    assert get_dept_chain_codes(idx, "A") == ["A", "B"]  # 반복 직전까지
    assert get_dept_chain_codes(_index(_dept("S", "Self", "S")), "S") == ["S"]


def test_get_dept_chain_codes_is_capped_at_15() -> None:
    depts = [_dept(f"L{i}", f"Level {i}", f"L{i + 1}" if i < 19 else None) for i in range(20)]
    chain = get_dept_chain_codes(_index(*depts), "L0")
    assert chain == [f"L{i}" for i in range(15)]
