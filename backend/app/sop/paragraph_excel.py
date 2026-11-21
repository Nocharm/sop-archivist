"""문단 Excel — 문서를 쪼갠 단위 한 줄씩 다섯 열(Section No. · Text · Lang · Number note · Remark)로 내려받는다(시안 2 D4).

본문(body)만 쓴다 — 머리말·꼬리말·각주·글상자는 Old 칸의 다른 탭이다. 줄은 시트 모델(sheet_model.Sheet)로 한 번 짓고 xlsx와
Assign Space 미리 보기가 같은 모델을 쓴다. 숨은 값(Unit ID · 그룹 · 상태)은 싣지 않는다 — 미리 보기만 줄마다 unit_id를 단다.
- 줄 차례: 원문 순서 + 짝 카드 안 사람이 바꾼 순서(pair_order.py) + 벗긴 표 덩이 안 순서(unwrap_order.py) — Assign 용지와 같다.
- 벗긴 표의 칸 줄은 보통 줄이다(벗긴 것은 문단). 아직 표인 데이터 표는 고를 수 있고, 넣으면 표 한 행이 한 줄(칸 글을 ` | `로 이음).
- 그림은 제자리에 `[Figure] 캡션` 한 줄(그 그림에 묶인 캡션은 따로 줄을 두지 않는다).
- 편집 반영(B9): 확정 삭제한 줄은 지우지 않고 Remark "Deleted"(사유가 있으면 "Deleted — 사유") · Text 취소선 · 회색 · Lang 빈 칸(미리 보기는
  `deleted`로 숨긴다). 원문에서 이어진 줄이 확정 배정으로 같은 새 문장 하나에 가면 한 행. 점 기호 줄의 Section No.는 "5.1 •"이고 Text에
  기호가 없다. Text 칸 들여쓰기 = 용지의 번호 칸 단계(numbering.build_row_levels) − 1.
설계: docs/superpowers/specs/2026-11-20-assign-mockup2-design.md D4
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.captions import CAPTION_KIND, join_caption_texts
from app.sop.constants import BULLET_SYMBOLS
from app.sop.excel_export import build_workbook, clean_cell_text, split_cell_text
from app.sop.models import Document, SourceBlock, SourceTable, TargetSource, Unit, UnitDecision, UnitPairMember
from app.sop.numbering import (
    NUMBER_CELL,
    NUMBERED_KINDS,
    SECTION_KIND,
    LevelRow,
    build_row_levels,
    build_section_numbers,
    get_number,
    get_number_note,
    is_read_from_text,
    strip_number,
)
from app.sop.pair_order import order_pair_card
from app.sop.sheet_model import MAX_PREVIEW_ROWS, Sheet, SheetCell, SheetRow, WorkbookModel, limit_window
from app.sop.units import UNIT_ACTIVE, get_latest_extraction_id
from app.sop.unwrap_order import UnwrapTable, find_line_table, order_unwrapped_lines, read_unwrap_tables

FIGURE_MARKER = "[Figure]"  # 결과물 Excel(sheet_model)의 그림 표시와 같은 글
PARAGRAPH_HEADERS = ("Section No.", "Text", "Lang", "Number note", "Remark")
PARAGRAPH_WIDTHS = (12, 90, 6, 18, 40)  # 글자 수 — 긴 글은 칸 안에서 접는다
PARAGRAPH_HEAD_ROWS = 1  # 머리 줄 — 미리 보기 창을 잘라도 늘 싣는다(freeze "A2")
NUMBER_NOTE = "Source {read} → {now}"  # 사람이 고친 번호의 원문 번호 — 번호 없음으로 바꿨으면 now가 NO_NUMBER_NOTE
NO_NUMBER_NOTE = "none"
DELETED_REMARK = "Deleted"  # 확정 삭제한 줄의 Remark — 사유가 있으면 "Deleted — 사유"
READ_FROM_TEXT_NOTE = "Read from text"  # 본문 줄 글 앞 타자 번호를 저절로 번호로 읽음(사람이 고치지 않음) — 틀렸으면 번호 칸에서 고친다
CELL_JOINER = " | "  # 아직 표인 데이터 표 한 행의 칸 글 사이
_LANG_LABELS = {"ko": "KO", "en": "EN", "ref": "REF"}  # 중립은 빈 칸
_SKIPPED_KINDS = ("table",)  # 칸 문장을 묶는 단위 — 자기 글이 없다(행 줄의 Remark만 준다)
_SHEET_NAME_LIMIT = 31  # Excel 시트 이름 최대 글자 수
_SHEET_NAME_FORBIDDEN = str.maketrans({char: "_" for char in "[]:*?/\\"})


@dataclass(frozen=True)
class UnitLine:
    """줄을 짓는 데 필요한 단위 한 개 — 첫 범위의 블록이 쪽(part)·칸 열을 정한다. text는 번호를 뺀 내용, number는 번호 칸 값."""

    unit_id: int
    kind: str
    text: str
    part: str
    block_id: int
    table_id: int | None = None
    row_index: int | None = None
    col_index: int | None = None
    group_unit_id: int | None = None  # 묶인 단위(아직 표인 표의 칸 문장 · 캡션)의 묶음 단위
    lang: str = "neutral"
    number: str | None = None
    number_note: str = ""
    remark: str = ""
    deleted: bool = False  # 확정 삭제한 줄
    target_id: int | None = None  # 확정 배정으로 간 새 문장이 하나뿐이면 그 문장 — 이어진 줄이 같은 문장이면 한 행
    block: int | None = None  # 줄이 든 벗긴 표 덩이(unwrap_order.find_line_table)
    is_cell_number: bool = False  # 덩이의 숫자만 든 칸에서 읽은 번호(사람이 고치지 않음) — 덩이 안에서만 Section No.
    pair_id: int | None = None
    indent_shift: int = 0
    noise: bool = False  # 목차 줄 — 번호 칸이 없다


@dataclass(frozen=True)
class _Entry:
    """시트 한 줄이 될 것 — lang · number · block · is_cell_number는 섹션 번호 세기(numbering.SectionLine)용."""

    unit_id: int
    lang: str
    number: str | None
    text: str
    note: str = ""
    remark: str = ""
    block: int | None = None
    is_cell_number: bool = False
    deleted: bool = False
    target_id: int | None = None


def format_number_note(read: str | None, now: str | None) -> str:
    """번호 노트 칸 — 원문 번호가 있으면 `Source 3. → 4.`(번호 없음이면 `→ none`), 없으면 빈 칸."""
    return NUMBER_NOTE.format(read=read, now=now or NO_NUMBER_NOTE) if read else ""


def _format_section(section: str | None, number: str | None) -> str:
    """Section No. 칸 — 점 기호 줄은 물려받은 번호 뒤에 그 기호("5.1 •"), 번호가 없으면 기호만."""
    if number in BULLET_SYMBOLS:
        return f"{section} {number}" if section else number
    return section or ""


def _is_table_cell(line: UnitLine) -> bool:
    """아직 표인 데이터 표의 칸 문장인가 — 벗긴 표의 칸 줄은 묶음이 풀려(group_unit_id 없음) 보통 줄이다."""
    return line.kind == "cell_sentence" and line.group_unit_id is not None


def _list_entries(lines: Sequence[UnitLine], include_tables: bool) -> list[_Entry]:
    body = [line for line in lines if line.part == "body"]
    figures = {line.unit_id for line in body if line.kind == "figure"}
    captions: dict[int, list[tuple[str, str]]] = {}
    for line in body:
        if line.kind == CAPTION_KIND and line.group_unit_id in figures:
            captions.setdefault(line.group_unit_id, []).append((line.lang, line.text))
    table_lines = {line.unit_id: line for line in body if line.kind in _SKIPPED_KINDS}
    cells: dict[tuple[int, int | None], dict[int, list[UnitLine]]] = {}
    for line in body:
        if _is_table_cell(line):
            cells.setdefault((line.group_unit_id, line.row_index), {}).setdefault(line.col_index or 0, []).append(line)
    entries: list[_Entry] = []
    written: set[tuple[int, int | None]] = set()
    for line in body:
        if line.kind in _SKIPPED_KINDS or (line.kind == CAPTION_KIND and line.group_unit_id in figures):
            continue
        if _is_table_cell(line):
            key = (line.group_unit_id, line.row_index)
            if not include_tables or key in written:
                continue
            # 표 단위의 Remark는 그 표의 첫 행에만
            table = table_lines.get(line.group_unit_id)
            first_row = not any(table_id == line.group_unit_id for table_id, _ in written)
            written.add(key)
            columns = cells[key]
            text = CELL_JOINER.join(_join_cell(columns.get(index, [])) for index in range(max(columns) + 1))
            entries.append(_Entry(
                line.group_unit_id, "neutral", None, text, remark=table.remark if table and first_row else "",
                block=table.block if table else None, deleted=bool(table and table.deleted),
            ))
            continue
        if line.kind == "figure":
            caption = join_caption_texts(captions.get(line.unit_id, ()))
            text = " ".join(part for part in (FIGURE_MARKER, line.text, caption) if part)
            entries.append(_Entry(line.unit_id, line.lang, None, text, remark=line.remark, block=line.block, deleted=line.deleted))
            continue
        entries.append(_Entry(
            line.unit_id, line.lang, line.number, line.text, line.number_note, line.remark, line.block, line.is_cell_number,
            line.deleted, line.target_id,
        ))
    return entries


def _group_entries(entries: Sequence[_Entry]) -> list[list[int]]:
    """한 행이 될 줄 무리(index) — 원문에서 이어진 줄이 확정 배정으로 같은 새 문장 하나에 가면 한 무리(9-c), 나머지는 한 줄씩."""
    groups: list[list[int]] = []
    for index, entry in enumerate(entries):
        if groups and entry.target_id is not None and entries[groups[-1][-1]].target_id == entry.target_id:
            groups[-1].append(index)
        else:
            groups.append([index])
    return groups


def _get_levels(lines: Sequence[UnitLine]) -> dict[int, int]:
    """단위마다 용지의 번호 칸 단계 — 용지 줄(묶이지 않은 본문 단위)을 문서 순서로, 짝 카드는 첫 줄 단계(numbering.build_row_levels)."""
    rows = [line for line in lines if line.part == "body" and line.group_unit_id is None]
    level_rows: list[LevelRow] = []
    card_start = 0
    for index, line in enumerate(rows):
        same_card = index > 0 and line.pair_id is not None and rows[index - 1].pair_id == line.pair_id
        if not same_card:
            card_start = index
        level_rows.append(LevelRow(
            label=line.number or "", shift=line.indent_shift, has_cell=line.kind in NUMBERED_KINDS and not line.noise,
            pair_top=card_start if same_card else None,
        ))
    return {line.unit_id: level for line, level in zip(rows, build_row_levels(level_rows), strict=True)}


def _join_cell(units: Sequence[UnitLine]) -> str:
    """한 칸의 문장들 — 같은 문단에서 나뉜 문장은 띄어 쓰고, 다른 문단은 줄을 바꾼다(Word 칸 복사와 같게)."""
    text = ""
    for index, unit in enumerate(units):
        if index > 0:
            text += " " if unit.block_id == units[index - 1].block_id else "\n"
        text += unit.text
    return text


_TEXT_COLUMN = PARAGRAPH_HEADERS.index("Text")


def _make_row(
    texts: Sequence[str], *, head: bool = False, unit_id: int | None = None, unit_ids: Sequence[int] = (), indent: int = 0,
    deleted: bool = False,
) -> SheetRow:
    cells = [SheetCell(text=clean_cell_text(text), head=head and bool(text)) for text in texts]
    if not head:
        cells[_TEXT_COLUMN] = cells[_TEXT_COLUMN].model_copy(update={"indent": indent, "faint": deleted, "strike": deleted})
    return SheetRow(
        kind="header" if head else "in_group", wrap=True, cells=cells, unit_id=unit_id, deleted=deleted, unit_ids=list(unit_ids)
    )


def _format_remark(remarks: Sequence[str], deleted: bool) -> str:
    remark = " / ".join(remark for remark in remarks if remark)
    if not deleted:
        return remark
    return f"{DELETED_REMARK} — {remark}" if remark else DELETED_REMARK


def build_paragraph_sheet(lines: Sequence[UnitLine], include_tables: bool, name: str = "Sheet") -> Sheet:
    """용지 순서의 단위 → 문단 Excel 시트 모델. 한 칸에 넘치는 글은 다음 줄 같은 열로 이어 쓴다(이어진 줄도 같은 unit_id)."""
    entries = _list_entries(lines, include_tables)
    sections = build_section_numbers(entries)
    levels = _get_levels(lines)
    rows = [_make_row(PARAGRAPH_HEADERS, head=True)]
    for group in _group_entries(entries):
        members = [entries[index] for index in group]
        first = members[0]
        langs = {member.lang for member in members}
        texts = [
            _format_section(sections[group[0]], first.number),
            " ".join(member.text for member in members),
            "" if first.deleted or len(langs) > 1 else _LANG_LABELS.get(first.lang, ""),
            first.note,
            _format_remark([member.remark for member in members], first.deleted),
        ]
        unit_ids = [member.unit_id for member in members] if len(members) > 1 else []
        chunks = [split_cell_text(text) for text in texts]
        for part in range(max(len(chunk) for chunk in chunks)):
            rows.append(_make_row(
                [chunk[part] if part < len(chunk) else "" for chunk in chunks], unit_id=first.unit_id, unit_ids=unit_ids,
                indent=levels.get(first.unit_id, 1) - 1, deleted=first.deleted,
            ))
    return Sheet(
        name=name, widths=list(PARAGRAPH_WIDTHS), rows=rows, freeze="A2", filter_columns=0, image_png=None, image_row=None,
        total_rows=len(rows), truncated=False,
    )


def build_paragraph_preview(
    lines: Sequence[UnitLine], include_tables: bool, name: str, around_unit_id: int | None, max_rows: int = MAX_PREVIEW_ROWS
) -> Sheet:
    """Assign Space 미리 보기 — 파일과 같은 시트를 고른 단위 가운데로 max_rows줄까지(Excel A 미리 보기와 같은 창 계약)."""
    return limit_window(build_paragraph_sheet(lines, include_tables, name), PARAGRAPH_HEAD_ROWS, around_unit_id, max_rows)


def build_paragraph_file(sheets: Sequence[Sheet]) -> bytes:
    """문단 Excel 시트들 → .xlsx 바이트(결과물 Excel과 같은 시트 쓰기). 순수 계산이라 스레드에서 부른다."""
    return build_workbook(WorkbookModel(file_name="", sheets=list(sheets) or [build_paragraph_sheet([], True)]))


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


async def load_unit_lines(session: AsyncSession, document: Document) -> list[UnitLine]:
    """문서 최신 추출의 활성 단위를 용지 순서로(번호 칸 값 · 노트 · 판단 Remark까지 한 번에). 추출이 없으면 빈 목록."""
    extraction_id = await get_latest_extraction_id(session, document.id)
    if extraction_id is None:
        return []
    blocks = {
        row.id: row
        for row in await session.execute(
            select(SourceBlock.id, SourceBlock.seq, SourceBlock.part, SourceBlock.col_index, SourceBlock.table_id).where(
                SourceBlock.extraction_id == extraction_id
            )
        )
    }
    tables = read_unwrap_tables((await session.execute(
        select(SourceTable.id, SourceTable.parent_table_id, SourceTable.is_layout, SourceTable.signals)
        .where(SourceTable.extraction_id == extraction_id)
    )).tuples().all())
    pair_of: dict[int, int] = dict((await session.execute(
        select(UnitPairMember.unit_id, UnitPairMember.pair_id)
        .join(Unit, Unit.id == UnitPairMember.unit_id)
        .where(Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE)
    )).tuples().all())
    # 벗긴 표 덩이 순서 뒤에 짝 카드 안 순서 — 용지(paper.tsx)와 같은 차례로 편다
    units = _order_pair_cards(
        _order_unwrapped(
            list(await session.scalars(
                select(Unit)
                .where(Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE)
                .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
            )),
            blocks, tables,
        ),
        pair_of,
    )
    decisions = {
        unit_id: (disposition, status, reason)
        for unit_id, disposition, status, reason in (await session.execute(
            select(UnitDecision.unit_id, UnitDecision.disposition, UnitDecision.status, UnitDecision.reason)
            .join(Unit, Unit.id == UnitDecision.unit_id)
            .where(Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE)
        )).tuples().all()
    }
    targets: dict[int, set[int]] = {}
    for unit_id, target_id in (await session.execute(
        select(TargetSource.unit_id, TargetSource.target_id)
        .join(Unit, Unit.id == TargetSource.unit_id)
        .where(Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE)
    )).tuples().all():
        targets.setdefault(unit_id, set()).add(target_id)
    block_at = {block.seq: block for block in blocks.values()}
    lines: list[UnitLine] = []
    for unit in units:
        # 그림·표 단위는 범위가 없고 정렬 키(pos_seq)가 제 블록의 seq다
        block = blocks[unit.spans[0][0]] if unit.spans else block_at.get(unit.pos_seq)
        if block is None:
            continue
        number = get_number(unit)
        disposition, status, reason = decisions.get(unit.id, ("", "", ""))
        confirmed = status == "confirmed"
        unit_targets = targets.get(unit.id, set())
        lines.append(UnitLine(
            unit_id=unit.id, kind=unit.kind, text=strip_number(unit.text, unit), part=block.part, block_id=block.id,
            table_id=unit.table_id, row_index=unit.row_index, col_index=block.col_index, group_unit_id=unit.group_unit_id,
            lang=unit.lang, number=number,
            number_note=READ_FROM_TEXT_NOTE if is_read_from_text(unit) else format_number_note(get_number_note(unit), number),
            remark=reason,
            deleted=confirmed and disposition == "delete",
            target_id=next(iter(unit_targets)) if confirmed and disposition == "assigned" and len(unit_targets) == 1 else None,
            block=None if unit.group_unit_id is not None else find_line_table(unit.kind, unit.table_id, block.table_id, tables),
            # 띠 표 제목 줄(번호 칸 + 제목 칸)의 칸 번호는 절 번호라 덩이 밖으로 이어진다
            is_cell_number=unit.number_source == NUMBER_CELL and unit.number_set is None and unit.kind != SECTION_KIND,
            pair_id=pair_of.get(unit.id),
            indent_shift=unit.indent_shift,
            noise=unit.noise_kind is not None,
        ))
    return lines


def _order_unwrapped(units: Sequence[Unit], blocks: Mapping[int, Any], tables: Mapping[int, UnwrapTable]) -> list[Unit]:
    """벗긴 표 덩이 안만 사람이 바꾼 순서로(unwrap_order.py) — 묶인 단위(표의 칸 문장 · 캡션)는 제 묶음 줄을 따라간다."""
    by_id = {unit.id: unit for unit in units}
    block_at = {block.seq: block for block in blocks.values()}

    def find_block(line_id: int) -> int | None:
        unit = by_id.get(line_id)
        if unit is None or unit.group_unit_id is not None:
            return None
        block = blocks.get(unit.spans[0][0]) if unit.spans else block_at.get(unit.pos_seq)
        return find_line_table(unit.kind, unit.table_id, None if block is None else block.table_id, tables)

    return order_unwrapped_lines(
        units,
        lambda unit: unit.id if unit.group_unit_id is None else unit.group_unit_id,
        find_block,
        lambda line_id: by_id[line_id].unwrap_seq,
    )


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
