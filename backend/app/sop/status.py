"""커버 단위 상태 — 칸 문장은 묶인 표·행 단위의 판단을, 나머지는 자기 판단을 따른다(view·단위 목록·결과물·검토 조건 공용)."""

from collections.abc import Mapping

from app.sop.models import Unit, UnitDecision


def get_cover_status(unit: Unit, decisions_by_unit_id: Mapping[int, UnitDecision]) -> str:
    """옛 문서 단위의 상태. 판단 행이 없으면 KeyError — 옛 문서 단위는 만들 때 판단 행이 함께 생기므로 버그다."""
    decision_unit_id = unit.group_unit_id if unit.group_unit_id is not None else unit.id
    return decisions_by_unit_id[decision_unit_id].status
