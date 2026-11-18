"""캡션 자리(F7) — 표·그림과 캡션 후보 글 사이를 블록 자리(문단 · 표 · 그림 하나가 한 자리, 빈 문단은 자리가 아니다)로 잰다.

프런트 lib/caption-slot-model.ts의 buildBlockPlaces·getPlaceDistance가 같은 규칙의 사본이다(후보 단추와 끌어 놓기 미리 판정) —
규칙을 바꾸면 함께 고치고 두 쪽 시험을 같은 사례로 둔다.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from app.sop.segment import has_visible_char

CAPTION_REACH = 2  # 캡션으로 붙일 수 있는 거리(자리 수) — 1은 바로 앞·뒤, 2는 사이에 문단·표·그림 하나(F7 ④, 기본값 §11-5)


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


def get_place_distance(places: Mapping[int, int], first: Iterable[int], second: Iterable[int]) -> int | None:
    """두 블록 묶음 사이의 가장 가까운 자리 거리 — 어느 쪽이든 자리가 없으면 None."""
    left = [places[block_id] for block_id in first if block_id in places]
    right = [places[block_id] for block_id in second if block_id in places]
    if not left or not right:
        return None
    return min(abs(a - b) for a in left for b in right)
