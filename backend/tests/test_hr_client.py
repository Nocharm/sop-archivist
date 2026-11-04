"""HR 웹훅 클라이언트 파싱 테스트 — 순수 함수(HTTP 없음). 계약: loginId 외 전부 null 가능."""

import asyncio

from app.hr import client as hr_client
from app.hr.client import RawHrEmployee, parse_department_row, parse_employee_row


def test_parse_employee_full_row() -> None:
    row = {
        "loginId": "hong.gd", "status": "active", "name": "Gildong Hong",
        "nameKo": "홍길동", "deptCode": "D100", "department": "Sourcing Team 1",
        "departmentKo": "구매1팀",
        "orgLevels": ["Management Support Division", "Procurement Office", "Sourcing Team 1"],
    }
    parsed = parse_employee_row(row)
    assert parsed == RawHrEmployee(
        login_id="hong.gd", status="active", name="Gildong Hong", name_ko="홍길동",
        dept_code="D100", department="Sourcing Team 1", department_ko="구매1팀",
        org_levels=["Management Support Division", "Procurement Office", "Sourcing Team 1"],
    )


def test_parse_employee_nulls_and_blank_levels() -> None:
    # loginId 외 전부 null/공백 — 전부 None, orgLevels의 빈 항목은 압축
    row = {"loginId": " kim.cs ", "status": None, "name": "", "orgLevels": ["A", "", None, "B"]}
    parsed = parse_employee_row(row)
    assert parsed is not None
    assert parsed.login_id == "kim.cs"
    assert parsed.status is None and parsed.name is None
    assert parsed.org_levels == ["A", "B"]


def test_parse_employee_missing_login_id_returns_none() -> None:
    assert parse_employee_row({"name": "X"}) is None
    assert parse_employee_row({"loginId": "  "}) is None
    assert parse_employee_row("not-a-dict") is None


def test_parse_department_row() -> None:
    parsed = parse_department_row(
        {"deptCode": "D100", "name": "HR Team", "nameKo": "인사팀", "parentDeptCode": "D1", "level": 3}
    )
    assert parsed is not None
    assert (parsed.dept_code, parsed.parent_dept_code, parsed.level) == ("D100", "D1", 3)
    assert parse_department_row({"name": "no code"}) is None
    assert parse_department_row({"deptCode": "D2", "level": "bad"}).level is None


def test_fetch_employee_uses_single_timeout(monkeypatch) -> None:
    """단건 조회는 전수용 180초가 아닌 로그인 크리티컬 패스용 10초 타임아웃을 쓴다."""
    captured: dict = {}

    async def fake_post(payload: dict, timeout: float = hr_client.HR_TIMEOUT_SECONDS) -> dict:
        captured["timeout"] = timeout
        return {"rows": []}

    monkeypatch.setattr(hr_client, "_post", fake_post)
    asyncio.run(hr_client.fetch_employee("someone"))
    assert captured["timeout"] == hr_client.HR_SINGLE_TIMEOUT_SECONDS == 10.0


def test_fetch_all_employees_asks_for_every_status_and_parses(monkeypatch) -> None:
    captured: dict = {}

    async def fake_post(payload: dict, timeout: float = hr_client.HR_TIMEOUT_SECONDS) -> dict:
        captured["payload"] = payload
        captured["timeout"] = timeout
        return {"count": 2, "rows": [{"loginId": "a.b"}, {"name": "no id"}]}

    monkeypatch.setattr(hr_client, "_post", fake_post)
    count, parsed = asyncio.run(hr_client.fetch_all_employees())
    assert captured["payload"] == {"kind": "employees", "status": "all"}
    assert captured["timeout"] == hr_client.HR_TIMEOUT_SECONDS == 180.0
    assert count == 2
    assert [p.login_id if p else None for p in parsed] == ["a.b", None]  # 결측 행은 None으로 남겨 호출부가 센다


def test_fetch_employee_trusts_only_exact_login_id(monkeypatch) -> None:
    """계약상 부분검색 불가 — 응답에 비슷한 id가 섞여 와도 정확히 일치하는 행만 쓴다."""

    async def fake_post(payload: dict, timeout: float = hr_client.HR_TIMEOUT_SECONDS) -> dict:
        return {"rows": [{"loginId": "kim.cs2"}, {"loginId": "kim.cs"}]}

    monkeypatch.setattr(hr_client, "_post", fake_post)
    found = asyncio.run(hr_client.fetch_employee("kim.cs"))
    assert found is not None and found.login_id == "kim.cs"
    assert asyncio.run(hr_client.fetch_employee("kim")) is None
