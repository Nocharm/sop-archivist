"""벗긴 표 덩이 안 줄 순서(units.unwrap_seq, 편집 reorder_unwrapped) — 문서 보기를 받는 화면과 문단 Excel이 같은 규칙으로 읽는다.

덩이 = 벗긴 보통 표(레이아웃 표, 띠 표가 아닌 것) 하나의 줄: 첫 블록이 그 표의 칸인 단위, 그 안쪽의 아직 표인 표(표 단위),
안쪽 띠 표의 제목 줄 — 안쪽 표는 바깥으로 올라가 처음 만나는 벗긴 표의 덩이다. 묶인 단위(칸 문장 · 캡션)는 제 묶음 줄을 따라간다.
unwrap_seq는 사람이 순서를 바꾼 덩이의 줄마다 0부터 매긴 값이다. 나누기 · 합치기의 조각은 옛 줄(합치기는 첫 줄)의 값을 물려받아
(editing._build_draft) 같은 값끼리 원문 자리 순 — 옛 줄 자리에 남는다. 값이 없는 줄은 원문 순서에서 바로 앞 줄의 값을 빌린다 — 바꾼 적
없으면 원문 순서이고, 짝 카드 순서처럼 "하나라도 없으면 원문 순서"로 돌아가지 않는다. 원문 글자 자리와 단위 글은 그대로다. 결과물 A는 따르지 않는다(원문 자리 순, 설계 확인할 것 4).
프런트 사본: frontend/src/lib/unwrap-order-model.ts `orderUnwrapped` · `orderUnwrappedLines` · `findLineTable`.
설계: 2026-11-20-assign-mockup2 D2 (docs/architecture/decisions.md)
"""

from collections.abc import Callable, Hashable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import TypeVar

from app.sop.groups import TABLE_UNIT_KINDS
from app.sop.segment import is_band_heading, is_band_table

T = TypeVar("T")
K = TypeVar("K", bound=Hashable)

_NO_SEQ = -1  # 덩이 맨 앞에서 빌릴 값이 없는 줄 — 매긴 값(0부터)보다 앞


@dataclass(frozen=True)
class UnwrapTable:
    """덩이를 재는 데 필요한 원문 표 하나 — is_unwrapped는 벗긴 보통 표(띠 표는 제목 줄이 되어 덩이가 없다)."""

    parent_id: int | None
    is_unwrapped: bool


def read_unwrap_tables(rows: Iterable[tuple[int, int | None, bool, Mapping[str, object] | None]]) -> dict[int, UnwrapTable]:
    """(id, parent_table_id, is_layout, signals) → 표 id → UnwrapTable."""
    return {
        table_id: UnwrapTable(parent_id, is_layout and not is_band_table(signals))
        for table_id, parent_id, is_layout, signals in rows
    }


def find_line_table(kind: str, table_id: int | None, block_table_id: int | None, tables: Mapping[int, UnwrapTable]) -> int | None:
    """묶이지 않은 단위 하나가 줄로 드는 덩이(벗긴 표 id) — 첫 블록이 벗긴 표의 칸이면 그 표, 아직 표인 표 단위 · 띠 표 제목 줄은
    바깥으로 올라가 처음 만나는 벗긴 표. 아니면 None."""
    if block_table_id is None:
        return None
    table = tables.get(block_table_id)
    if table is None:
        return None
    if table.is_unwrapped:
        return block_table_id
    if kind not in TABLE_UNIT_KINDS and not is_band_heading(kind, table_id):
        return None
    parent_id = table.parent_id
    while parent_id is not None:
        parent = tables.get(parent_id)
        if parent is None:
            return None
        if parent.is_unwrapped:
            return parent_id
        parent_id = parent.parent_id
    return None


def order_unwrapped(
    units: Sequence[T], seq_of: Callable[[T], int | None], pos_of: Callable[[T], tuple[int, ...]]
) -> list[T]:
    """덩이의 줄 → 덩이 안 순서. 원문 자리(pos_of) 순으로 놓고 값이 없는 줄은 바로 앞 줄의 값을 빌려 (값, 원문 자리)로 정렬한다."""
    ordered = sorted(units, key=pos_of)
    keys: list[int] = []
    borrowed = _NO_SEQ
    for unit in ordered:
        seq = seq_of(unit)
        if seq is not None:
            borrowed = seq
        keys.append(borrowed)
    order = sorted(range(len(ordered)), key=lambda index: (keys[index], index))
    return [ordered[index] for index in order]


def order_unwrapped_lines(
    items: Sequence[T],
    line_of: Callable[[T], K | None],
    block_of: Callable[[K], int | None],
    seq_of: Callable[[K], int | None],
) -> list[T]:
    """보이는 순서의 항목(용지 줄 · 단위) → 벗긴 덩이 안만 덩이 순서로. line_of는 항목이 딸린 줄(없으면 제자리), block_of는 그 줄의 덩이.

    덩이마다 줄을 처음 나온 차례를 원문 자리로 삼아 order_unwrapped로 정렬하고, 그 덩이 항목이 있던 자리에 차례로 다시 채운다 —
    덩이 밖 항목과 다른 덩이(벗긴 안쪽 표)의 항목은 제자리, 한 줄에 딸린 항목들(표와 그 칸 문장)은 서로의 차례를 지킨다.
    """
    lines_of_block: dict[int, list[K]] = {}
    items_of_line: dict[K, list[T]] = {}
    slots: dict[int, list[int]] = {}
    for index, item in enumerate(items):
        line = line_of(item)
        block = None if line is None else block_of(line)
        if line is None or block is None:
            continue
        if line not in items_of_line:
            items_of_line[line] = []
            lines_of_block.setdefault(block, []).append(line)
        items_of_line[line].append(item)
        slots.setdefault(block, []).append(index)
    result = list(items)
    for block, lines in lines_of_block.items():
        # 줄은 처음 나온 차례로 모였다 — 그 차례가 원문 자리다
        ordered = order_unwrapped(list(enumerate(lines)), lambda entry: seq_of(entry[1]), lambda entry: (entry[0],))
        refill = [item for _, line in ordered for item in items_of_line[line]]
        for index, item in zip(slots[block], refill, strict=True):
            result[index] = item
    return result
