"""단위 맥락 — AI 분류가 단위와 함께 받는 앞뒤 단위·소속 절 제목·표 Markdown (설계 §7.8).

질의 수는 단위 수와 상관없이 일정하다(추출 수·IN 조각 수에만 따라 는다). 글은 열 단위 select로만 읽어 지연 로드 열을 건드리지 않는다.
"""

import re
from bisect import bisect_left, bisect_right
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from sqlalchemy import Row, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.ai.constants import (
    MAX_TABLE_CONTEXT_CHARS,
    MAX_TABLE_CONTEXT_COLS,
    MAX_TABLE_CONTEXT_ROWS,
    NEIGHBOR_UNITS,
)
from app.sop.constants import COVER_KINDS
from app.sop.groups import TABLE_UNIT_KINDS, select_in_chunks
from app.sop.models import SourceBlock, Unit
from app.sop.units import UNIT_ACTIVE

_NEWLINE_RE = re.compile(r"\r\n|\r|\n")


@dataclass(frozen=True)
class UnitContext:
    """단위 하나의 맥락 — 앞뒤 단위 글(원문 순서), 소속 절 이름, 표·표 행 단위면 칸 격자 Markdown(아니면 빈 글)."""

    section: str
    before: tuple[str, ...]
    after: tuple[str, ...]
    table_markdown: str


def _escape_table_cell(text: str) -> str:
    return _NEWLINE_RE.sub("<br>", text.replace("|", "\\|"))


def render_table_markdown(grid: Sequence[Sequence[str]]) -> str:
    """칸 격자를 Markdown 표로 — 첫 행이 머리 줄이다. 칸 안의 `|`는 `\\|`로, 줄바꿈은 `<br>`로 바꿔 칸 경계와 행을 지킨다."""
    width = max((len(row) for row in grid), default=0)
    if width == 0:
        return ""
    lines: list[str] = []
    for index, row in enumerate(grid):
        cells = [_escape_table_cell(text) for text in row] + [""] * (width - len(row))
        lines.append("| " + " | ".join(cells) + " |")
        if index == 0:
            lines.append("| " + " | ".join(["---"] * width) + " |")
    return "\n".join(lines)


def _build_grid(cells: Iterable[Row]) -> list[list[str]]:
    """칸 블록 → 행 × 열 격자. 블록이 실제로 있는 행·열만 남기고(원문의 행·열 번호는 크기에 쓰지 않는다) 앞쪽 MAX_TABLE_CONTEXT_ROWS행·COLS열까지만 만든다.

    칸 번호는 DOCX의 gridBefore·gridSpan에서 오므로 아주 클 수 있다. 번호로 격자를 만들면 칸 몇 개로 메모리를 채울 수 있다.
    """
    texts = {
        (cell.row_index, cell.col_index): cell.text
        for cell in cells
        if cell.row_index is not None and cell.col_index is not None
    }
    rows = sorted({row for row, _ in texts})[:MAX_TABLE_CONTEXT_ROWS]
    cols = sorted({col for _, col in texts})[:MAX_TABLE_CONTEXT_COLS]
    return [[texts.get((row, col), "") for col in cols] for row in rows]


def _render_table_context(cells: Iterable[Row]) -> str:
    """표의 칸 블록 → 맥락용 Markdown. 격자는 행·열 수로, 글은 MAX_TABLE_CONTEXT_CHARS로 자른다."""
    return render_table_markdown(_build_grid(cells))[:MAX_TABLE_CONTEXT_CHARS]


def _pick_neighbor_ids(rows: Sequence[Row], indices: Iterable[int], unit_id: int) -> list[int]:
    """indices 순서로 훑어 이웃 NEIGHBOR_UNITS개를 고른다. 단위가 묶은 자기 칸 문장은 이웃이 아니다(표 Markdown이 이미 싣는다)."""
    picked: list[int] = []
    for index in indices:
        if rows[index].group_unit_id != unit_id:
            picked.append(rows[index].id)
            if len(picked) == NEIGHBOR_UNITS:
                break
    return picked


async def load_unit_context(session: AsyncSession, unit_ids: Sequence[int]) -> dict[int, UnitContext]:
    """단위마다 같은 추출 안 활성 커버 단위의 앞뒤 NEIGHBOR_UNITS개, 첫 블록의 소속 절, 표 단위면 칸 격자 Markdown을 읽는다.

    없는 단위 id는 결과에 없다. 은퇴한 단위와 표 단위 같은 비커버 단위는 이웃이 되지 않는다.
    """
    unit_rows = await select_in_chunks(
        session,
        lambda chunk: select(
            Unit.id, Unit.extraction_id, Unit.kind, Unit.spans, Unit.table_id, Unit.pos_seq, Unit.pos_start
        ).where(Unit.id.in_(chunk)),
        unit_ids,
    )

    # 이웃은 추출 안의 읽는 순서로 정한다 — 순서 열만 읽어 두고 뽑힌 단위의 글만 따로 가져온다
    ordered_rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit.id, Unit.extraction_id, Unit.group_unit_id, Unit.pos_seq, Unit.pos_start)
        .where(Unit.extraction_id.in_(chunk), Unit.status == UNIT_ACTIVE, Unit.kind.in_(COVER_KINDS))
        .order_by(Unit.extraction_id, Unit.pos_seq, Unit.pos_start, Unit.id),
        {row.extraction_id for row in unit_rows},
    )
    cover_rows: dict[int, list[Row]] = defaultdict(list)
    for row in ordered_rows:
        cover_rows[row.extraction_id].append(row)
    cover_keys = {
        extraction_id: [(row.pos_seq, row.pos_start, row.id) for row in rows] for extraction_id, rows in cover_rows.items()
    }
    neighbor_ids: dict[int, tuple[list[int], list[int]]] = {}
    for unit in unit_rows:
        rows, keys = cover_rows.get(unit.extraction_id, []), cover_keys.get(unit.extraction_id, [])
        key = (unit.pos_seq, unit.pos_start, unit.id)
        start, end = bisect_left(keys, key), bisect_right(keys, key)
        neighbor_ids[unit.id] = (
            _pick_neighbor_ids(rows, range(start - 1, -1, -1), unit.id)[::-1],
            _pick_neighbor_ids(rows, range(end, len(rows)), unit.id),
        )
    text_rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit.id, Unit.text).where(Unit.id.in_(chunk)),
        {neighbor_id for before, after in neighbor_ids.values() for neighbor_id in before + after},
    )
    texts = {row.id: row.text for row in text_rows}

    # 소속 절은 단위 첫 범위의 블록 것이고, 범위 없는 표 단위는 표의 첫 칸 블록 것이다. 표 격자도 같은 칸 블록에서 만든다
    first_block_ids = {row.spans[0][0] for row in unit_rows if row.spans}
    block_rows = await select_in_chunks(
        session,
        lambda chunk: select(SourceBlock.id, SourceBlock.section_label).where(SourceBlock.id.in_(chunk)),
        first_block_ids,
    )
    sections_by_block = {row.id: row.section_label for row in block_rows}
    table_ids = {row.table_id for row in unit_rows if row.kind in TABLE_UNIT_KINDS and row.table_id is not None}
    cell_rows = await select_in_chunks(
        session,
        lambda chunk: select(
            SourceBlock.table_id, SourceBlock.row_index, SourceBlock.col_index, SourceBlock.text, SourceBlock.section_label
        )
        .where(SourceBlock.table_id.in_(chunk), SourceBlock.kind == "table_cell")
        .order_by(SourceBlock.table_id, SourceBlock.seq),
        table_ids,
    )
    cells_by_table: dict[int, list[Row]] = defaultdict(list)
    for row in cell_rows:
        cells_by_table[row.table_id].append(row)

    # 표 하나를 쓰는 단위가 여럿(표 행 단위 여럿)이어도 표마다 한 번만 그린다
    markdown_by_table = {table_id: _render_table_context(cells) for table_id, cells in cells_by_table.items()}

    contexts: dict[int, UnitContext] = {}
    for unit in unit_rows:
        is_table_unit = unit.kind in TABLE_UNIT_KINDS
        table_cells = cells_by_table.get(unit.table_id, []) if is_table_unit else []
        if unit.spans:
            section = sections_by_block[unit.spans[0][0]]
        else:
            section = table_cells[0].section_label if table_cells else ""
        before, after = neighbor_ids[unit.id]
        contexts[unit.id] = UnitContext(
            section=section,
            before=tuple(texts[neighbor_id] for neighbor_id in before),
            after=tuple(texts[neighbor_id] for neighbor_id in after),
            table_markdown=markdown_by_table.get(unit.table_id, "") if is_table_unit else "",
        )
    return contexts
