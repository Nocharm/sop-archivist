"""커버 단위 상태 — 칸 문장은 묶인 표·행 단위의 판단을, 나머지는 자기 판단을 따른다(view·단위 목록·결과물·검토 조건 공용).
배정 화면 한 줄(짝 하나·짝 없는 단위 하나)의 상태도 여기서 정한다.
"""

from collections.abc import Iterable, Mapping
from typing import Protocol


# 줄 상태 순서 — 앞일수록 덜 끝났다. 프런트 classify-model.ts의 STATUS_RANK와 같은 순서여야 한다
ROW_STATUS_ORDER: tuple[str, ...] = ("unassigned", "ai_suggested", "on_hold", "confirmed")


class CoverUnit(Protocol):
    """ORM 단위와 결과물 스냅숏 단위가 함께 맞는 모양 — 규칙을 한 벌만 두려고 필요한 필드만 적는다."""

    @property
    def id(self) -> int: ...

    @property
    def group_unit_id(self) -> int | None: ...


class StatusHolder(Protocol):
    @property
    def status(self) -> str: ...


def get_cover_status(unit: CoverUnit, decisions_by_unit_id: Mapping[int, StatusHolder]) -> str:
    """옛 문서 단위의 상태. 판단 행이 없으면 KeyError — 옛 문서 단위는 만들 때 판단 행이 함께 생기므로 버그다."""
    decision_unit_id = unit.group_unit_id if unit.group_unit_id is not None else unit.id
    return decisions_by_unit_id[decision_unit_id].status


def pick_row_status(statuses: Iterable[str]) -> str:
    """줄의 상태 — 구성 단위 중 가장 덜 끝난 것. 빈 입력은 confirmed(프런트 pickRowStatus와 같다)."""
    return min(statuses, key=ROW_STATUS_ORDER.index, default="confirmed")
