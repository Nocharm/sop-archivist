"""HR 행 → Employee 필드 매핑 테스트 — 순수 함수. 매핑 표·불변식 감시."""

from app.hr.client import RawHrEmployee
from app.hr.service import to_employee_fields


def _raw(**overrides) -> RawHrEmployee:
    base = dict(
        login_id="hong.gd", status="active", name="Gildong Hong", name_ko="홍길동",
        dept_code="D100", department="Sourcing Team 1", department_ko="구매1팀",
        org_levels=["Div", "Office", "Sourcing Team 1"],
    )
    base.update(overrides)
    return RawHrEmployee(**base)


def test_basic_mapping() -> None:
    f = to_employee_fields(_raw())
    assert (f.login_id, f.name, f.korean_name, f.korean_dept) == ("hong.gd", "Gildong Hong", "홍길동", "구매1팀")
    assert (f.org_l1, f.org_l2, f.org_l3, f.org_l4, f.org_l5) == ("Div", "Office", "Sourcing Team 1", None, None)
    assert f.department == "Sourcing Team 1"
    assert f.dept_code == "D100"
    assert f.active is True and f.dept_mismatch is False and f.truncated is False


def test_null_fallbacks() -> None:
    # name null → login_id, department null → orgLevels 리프, korean 계열 null 그대로(보존 신호)
    f = to_employee_fields(_raw(name=None, name_ko=None, department=None, department_ko=None))
    assert f.name == "hong.gd"
    assert f.department == "Sourcing Team 1"
    assert f.korean_name is None and f.korean_dept is None


def test_status_mapping() -> None:
    assert to_employee_fields(_raw(status="inactive")).active is False
    assert to_employee_fields(_raw(status=None)).active is True  # 결측 → 보수적으로 활성


def test_status_is_case_insensitive() -> None:
    assert to_employee_fields(_raw(status="ACTIVE")).active is True
    assert to_employee_fields(_raw(status="Inactive")).active is False


def test_six_levels_truncated_and_mismatch_flagged() -> None:
    # 6레벨 → org_l1~l5는 루트 쪽 5개, department(리프 L6)는 저장 경로 리프와 어긋남 → 리포트 플래그
    f = to_employee_fields(_raw(org_levels=["A", "B", "C", "D", "E", "F"], department="F"))
    assert (f.org_l1, f.org_l5) == ("A", "E")
    assert f.truncated is True and f.dept_mismatch is True


def test_department_mismatch_without_truncation() -> None:
    f = to_employee_fields(_raw(department="Other Team"))
    assert f.dept_mismatch is True and f.truncated is False


def test_empty_org_levels() -> None:
    f = to_employee_fields(_raw(org_levels=[], department="Solo Team"))
    assert f.org_l1 is None and f.department == "Solo Team" and f.dept_mismatch is False
    assert f.has_org is False  # org_l*를 덮지 않는 신호


def test_oversized_text_is_clipped_to_column_width() -> None:
    f = to_employee_fields(_raw(name="N" * 250, dept_code="D" * 120))
    assert len(f.name) == 200 and len(f.dept_code) == 100
