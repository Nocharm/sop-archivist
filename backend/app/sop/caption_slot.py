"""캡션 자리(F7) — 블록 자리(문단 · 표 · 그림 하나가 한 자리, 빈 문단은 자리가 아니다). 캡션 후보를 가까운 순으로 늘어놓는 잣대다.

붙이기에 거리 제한은 없다(B10 8-b — 서버는 거리를 재지 않는다). 프런트 lib/caption-slot-model.ts의 buildBlockPlaces가 같은 규칙의
사본이고(후보 순서) rule-cases.json block_places로 대조한다 — 규칙을 바꾸면 함께 고친다.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from app.sop.segment import has_visible_char


@dataclass(frozen=True)
class PlaceBlock:
    id: int
    seq: int
    kind: str
    text: str
    table_id: int | None


def _find_top_table(table_id: int, parent_of: Mapping[int, int | None]) -> int:
    """칸 안 표의 가장 바깥 표 — 안쪽 표는 바깥 표 자리 하나에 든다."""
    seen = {table_id}
    while (parent := parent_of.get(table_id)) is not None and parent not in seen:
        seen.add(parent)
        table_id = parent
    return table_id


def build_block_places(blocks: Iterable[PlaceBlock], parent_of: Mapping[int, int | None]) -> dict[int, int]:
    """블록 → 자리 번호(원문 순). 표는 칸 블록 모두가 바깥 표 하나의 자리, 그림·글 있는 문단은 제 자리, 빈 문단은 키가 없다."""
    places: dict[int, int] = {}
    index = -1
    last_table: int | None = None
    for block in sorted(blocks, key=lambda item: item.seq):
        if block.kind == "table_cell" and block.table_id is not None:
            top = _find_top_table(block.table_id, parent_of)
            if top != last_table:
                index += 1
                last_table = top
            places[block.id] = index
            continue
        last_table = None
        if block.kind != "figure" and not has_visible_char(block.text):
            continue
        index += 1
        places[block.id] = index
    return places
