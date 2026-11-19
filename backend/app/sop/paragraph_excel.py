"""문단 Excel — 문서를 쪼갠 단위 한 줄씩 한 열로 내려받는다(1.2.0 피드백 6번, Assign 문서 대시보드).

Word에서 복사해 Excel에 붙인 것처럼 머리 줄·모양 없이 글만 쓴다. 자동 번호는 추출이 글 앞에 붙여 두었으므로(docx_reader
_add_number) 단위 글 그대로다. 본문(body)만 쓴다 — 머리말·꼬리말·각주·글상자는 Old 칸의 다른 탭이다.
표는 고를 수 있다 — 넣으면 표 한 행이 한 줄, 칸은 옆 열(같은 칸의 문장은 한 칸에)이다.
이어 붙은 한/영 짝 카드 안은 사람이 바꾼 순서(pair_order.py)를 따른다 — Assign 용지의 카드와 같은 줄 순서다.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from io import BytesIO

from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.excel_export import split_cell_text, write_text_cell
from app.sop.models import Document, SourceBlock, Unit, UnitPairMember
from app.sop.pair_order import order_pair_card
from app.sop.units import UNIT_ACTIVE, get_latest_extraction_id

FIGURE_MARKER = "[Figure]"  # 결과물 Excel(sheet_model)의 그림 표시와 같은 글
_SKIPPED_KINDS = ("table",)  # 칸 문장을 묶는 단위 — 자기 글이 없다
_SHEET_NAME_LIMIT = 31  # Excel 시트 이름 최대 글자 수
_SHEET_NAME_FORBIDDEN = str.maketrans({char: "_" for char in "[]:*?/\\"})
_COLUMN_WIDTH = 100  # 첫 열 너비(글자 수) — 긴 문장도 한눈에, 접지 않는다


@dataclass(frozen=True)
class UnitLine:
    """줄을 짓는 데 필요한 단위 한 개 — 첫 범위의 블록이 쪽(part)·칸 열을 정한다."""

    kind: str
    text: str
    part: str
    block_id: int
    table_id: int | None
    row_index: int | None
    col_index: int | None


def build_paragraph_rows(units: Sequence[UnitLine], include_tables: bool) -> list[list[str]]:
    """원문 순서의 단위 → 줄(칸 글 목록). 표 행은 그 행의 첫 칸 문장 자리에 한 번 쓴다."""
    body = [unit for unit in units if unit.part == "body" and unit.kind not in _SKIPPED_KINDS]
    cells: dict[tuple[int | None, int | None], dict[int, list[UnitLine]]] = {}
    for unit in body:
        if unit.kind == "cell_sentence":
            cells.setdefault((unit.table_id, unit.row_index), {}).setdefault(unit.col_index or 0, []).append(unit)
    rows: list[list[str]] = []
    written: set[tuple[int | None, int | None]] = set()
    for unit in body:
        if unit.kind != "cell_sentence":
            rows.append([FIGURE_MARKER if unit.kind == "figure" and not unit.text else unit.text])
            continue
        key = (unit.table_id, unit.row_index)
        if not include_tables or key in written:
            continue
        written.add(key)
        columns = cells[key]
        rows.append([_join_cell(columns.get(index, [])) for index in range(max(columns) + 1)])
    return rows


def _join_cell(units: Sequence[UnitLine]) -> str:
    """한 칸의 문장들 — 같은 문단에서 나뉜 문장은 띄어 쓰고, 다른 문단은 줄을 바꾼다(Word 칸 복사와 같게)."""
    text = ""
    for index, unit in enumerate(units):
        if index > 0:
            text += " " if unit.block_id == units[index - 1].block_id else "\n"
        text += unit.text
    return text


def make_sheet_name(name: str, taken: set[str]) -> str:
    """시트 이름 — 못 쓰는 글자는 `_`, 31자까지, 겹치면 ` (2)`… 를 붙인다. 고른 이름을 taken에 더한다."""
    base = (name.translate(_SHEET_NAME_FORBIDDEN).strip() or "Sheet")[:_SHEET_NAME_LIMIT]
    candidate, number = base, 2
    while candidate.lower() in taken:
        suffix = f" ({number})"
        candidate = base[: _SHEET_NAME_LIMIT - len(suffix)] + suffix
        number += 1
    taken.add(candidate.lower())
    return candidate


def build_paragraph_workbook(sheets: Sequence[tuple[str, list[list[str]]]]) -> bytes:
    """(시트 이름, 줄) 목록 → .xlsx 바이트. 한 칸에 넘치는 글은 다음 줄 같은 열로 이어 쓴다. 순수 계산이라 스레드에서 부른다."""
    workbook = Workbook()
    workbook.remove(workbook.active)
    for name, rows in sheets or [("Sheet", [])]:
        sheet = workbook.create_sheet(name)
        sheet.column_dimensions["A"].width = _COLUMN_WIDTH
        row_no = 1
        for row in rows:
            chunks = [split_cell_text(text) for text in row]
            for part in range(max(len(chunk) for chunk in chunks)):
                for col_no, chunk in enumerate(chunks, start=1):
                    if part < len(chunk) and chunk[part]:
                        write_text_cell(sheet.cell(row=row_no, column=col_no), chunk[part])
                row_no += 1
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


async def load_unit_lines(session: AsyncSession, document: Document) -> list[UnitLine]:
    """문서 최신 추출의 활성 단위를 원문 순서로(문서 보기와 같은 정렬). 추출이 없으면 빈 목록."""
    extraction_id = await get_latest_extraction_id(session, document.id)
    if extraction_id is None:
        return []
    blocks = {
        row.id: row
        for row in await session.execute(
            select(SourceBlock.id, SourceBlock.seq, SourceBlock.part, SourceBlock.col_index).where(
                SourceBlock.extraction_id == extraction_id
            )
        )
    }
    units = _order_pair_cards(
        list(await session.scalars(
            select(Unit)
            .where(Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE)
            .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
        )),
        dict((await session.execute(
            select(UnitPairMember.unit_id, UnitPairMember.pair_id)
            .join(Unit, Unit.id == UnitPairMember.unit_id)
            .where(Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE)
        )).tuples().all()),
    )
    block_at = {block.seq: block for block in blocks.values()}
    lines: list[UnitLine] = []
    for unit in units:
        # 그림·표 단위는 범위가 없고 정렬 키(pos_seq)가 제 블록의 seq다
        block = blocks[unit.spans[0][0]] if unit.spans else block_at.get(unit.pos_seq)
        if block is None:
            continue
        lines.append(UnitLine(
            kind=unit.kind, text=unit.text, part=block.part, block_id=block.id,
            table_id=unit.table_id, row_index=unit.row_index, col_index=block.col_index,
        ))
    return lines


def _order_pair_cards(units: Sequence[Unit], pair_of: dict[int, int]) -> list[Unit]:
    """원문 순서에서 같은 짝이 끊김 없이 이어진 줄(용지의 한 카드)만 그 카드 안 순서로 — 떨어진 구성원은 제자리다."""
    ordered: list[Unit] = []
    start = 0
    while start < len(units):
        pair_id = pair_of.get(units[start].id)
        end = start + 1
        while pair_id is not None and end < len(units) and pair_of.get(units[end].id) == pair_id:
            end += 1
        ordered += order_pair_card(units[start:end], lambda unit: unit.pair_seq)
        start = end
    return ordered
