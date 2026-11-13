"""언어별 Excel 내보내기 — 결과물 A·B·C와 정보 시트를 수식 없는 통합 문서 하나로 만든다 (스펙 §7.14).

계산은 app/sop/outputs.py가 끝냈고 여기서는 칸에 옮겨 쓰기만 한다. 글 칸은 모두 write_text_cell 하나로 써서
XML에 못 쓰는 문자는 바꾸고 =·+·-·@로 시작하는 글도 수식이 되지 않게 한다(DB 원문은 바꾸지 않는다).
"""

import re
import unicodedata
from collections.abc import Collection, Iterator, Sequence
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO

from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE, Cell
from openpyxl.drawing.image import Image as SheetImage
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

from app.clock import KST
from app.sop.constants import NUMBER_NOTE
from app.sop.flow_image import draw_flow_png
from app.sop.output_labels import LABELS, OutputLabels
from app.sop.outputs import (
    ARow,
    CItem,
    FlowNode,
    Lang,
    build_output_a,
    build_output_b,
    build_output_c,
    build_summary,
)
from app.sop.snapshot import BundleSnapshot

CELL_TEXT_LIMIT = 32767  # Excel 칸 하나의 글자 수 한계(UTF-16 단위)
MAX_FILE_NAME_TITLE_CHARS = 150
REPLACEMENT_CHAR = "\N{REPLACEMENT CHARACTER}"
# openpyxl이 못 쓰는 제어 문자에 XML 1.0이 금지하는 비문자 두 개를 더한다
_UNWRITABLE_RE = re.compile(f"{ILLEGAL_CHARACTERS_RE.pattern}|[￾￿]")
_FORMULA_LEADS = ("=", "+", "-", "@")
_FILE_NAME_FORBIDDEN_RE = re.compile(r'[\\/:*?"<>|]')
_WRAP_TOP = Alignment(wrap_text=True, vertical="top")
_BOLD = Font(bold=True)
_ITALIC = Font(italic=True)  # 주석 줄(번호 없이 기울임)의 글 칸
_HEADER_FILL = PatternFill("solid", fgColor="E8EAF0")

# 결과물 A 칸 순서(스펙 §7.13) — 표시 ID 칸은 이어짐 표시가 들어가는 칸이다
A_ID_COLUMN = 5
A_COLUMN_WIDTHS = (8, 12, 8, 26, 14, 50, 14, 14, 26, 28, 12, 50, 40, 14, 14, 28, 10, 14, 18, 40)
A_NOTE_COLUMNS = (12, 13)  # 보낸 새 문장이 주석 줄이면 기울여 쓰는 칸 — 확정 문장·AI 제안 문장
# 결과물 C — 문서·칸·항목·표 칸이 들여쓰기 열이고 나머지는 항목의 세부다. 번호 열은 칸·항목의 섹션 번호(outputs가 센 값)
(C_DOC, C_SECTION, C_NUMBER, C_ITEM, C_CELL, C_POSITION, C_ID, C_AI, C_CHANGE, C_STATUS, C_SOURCE, C_MOVE, C_REASON) = (
    range(13)
)
C_COLUMN_WIDTHS = (34, 30, 12, 50, 40, 12, 14, 40, 14, 10, 30, 18, 30)


@dataclass(frozen=True)
class ExportMeta:
    """내보내기 때 정해지는 값 — 누가 언제 어떤 지침 버전으로 내보냈는가."""

    exported_by: str
    exported_at: datetime
    guideline_version: str


@dataclass(frozen=True)
class ExcelLabels:
    """한 언어의 시트 이름·머리·정보 칸 이름 — 코드 값의 표시 이름은 output_labels.LABELS를 쓴다."""

    sheets: tuple[str, str, str, str]  # A, B, C, 정보
    status_line: str  # {status}
    bundle_statuses: dict[str, str]
    a_headers: tuple[str, ...]
    c_headers: tuple[str, ...]
    page: str  # {page}
    page_estimated: str  # {page}
    cell_position: str  # {row} {col}
    table_marker: str
    figure_marker: str
    na: str
    summary_title: str
    summary_headers: tuple[str, str]
    summary_names: tuple[str, ...]  # Summary 필드 순서대로 여덟 개 + 확정률
    flow_title: str
    old_doc_header: str
    unit_count_header: str
    total: str
    info_names: tuple[str, ...]  # 제목 · 상태 · 만든 사람 · 만든 시각 · 내보낸 사람 · 내보낸 시각 · 지침 버전 · 합성 데이터 여부
    yes: str
    no: str


EXCEL_LABELS: dict[str, ExcelLabels] = {
    "ko": ExcelLabels(
        sheets=("A 비교표", "B 흐름", "C 새 문서", "정보"),
        status_line="상태: {status}",
        bundle_statuses={"in_progress": "작업 중", "in_review": "검토 대기", "done": "검토 완료"},
        a_headers=(
            "언어", "옛 문서 번호", "버전", "원문 위치", "단위 ID", "원문 문장", "보낸 곳 종류", "새 문서 번호",
            "새 문서 제목", "새 문서 안 위치", "새 문서 안 번호", "확정 문장", "AI 제안 문장", "변경 종류", "관계 묶음 ID",
            "이유", "상태", "확정한 사람", "확정 시각", "경고",
        ),
        c_headers=(
            "문서", "칸", "번호", "항목", "표 칸", "표 칸 위치", "단위 ID", "AI 제안 문장", "변경 종류", "상태", "옛 단위",
            "이동 대상", "이유",
        ),
        page="{page}쪽",
        page_estimated="약 {page}쪽",
        cell_position="{row}행 {col}열",
        table_marker="[표]",
        figure_marker="[그림]",
        na="N/A",
        summary_title="요약 숫자",
        summary_headers=("항목", "값"),
        summary_names=("옛 단위", "배정", "미배정", "중복 배정", "삭제", "이동", "신규", "번역", "확정률"),
        flow_title="옛 문서 × 보낸 곳 (건수)",
        old_doc_header="옛 문서",
        unit_count_header="단위 수",
        total="합계",
        info_names=(
            "묶음 제목", "상태", "만든 사람", "만든 시각 (KST)", "내보낸 사람", "내보낸 시각 (KST)", "지침 버전",
            "합성 데이터 여부",
        ),
        yes="예",
        no="아니오",
    ),
    "en": ExcelLabels(
        sheets=("A Comparison", "B Flow", "C New documents", "Info"),
        status_line="Status: {status}",
        bundle_statuses={"in_progress": "In progress", "in_review": "Awaiting review", "done": "Review complete"},
        a_headers=(
            "Language", "Old doc no.", "Version", "Source location", "Unit ID", "Source sentence", "Destination type",
            "New doc no.", "New doc title", "Location in new doc", "Number in new doc", "Confirmed sentence",
            "AI-suggested sentence", "Change type", "Relation group ID", "Reason", "Status", "Confirmed by", "Confirmed at",
            "Warnings",
        ),
        c_headers=(
            "Document", "Slot", "No.", "Item", "Table cell", "Cell position", "Unit ID", "AI-suggested sentence",
            "Change type", "Status", "Old units", "Moved to", "Reason",
        ),
        page="p. {page}",
        page_estimated="~p. {page}",
        cell_position="R {row} C {col}",
        table_marker="[Table]",
        figure_marker="[Figure]",
        na="N/A",
        summary_title="Summary",
        summary_headers=("Item", "Value"),
        summary_names=(
            "Old units", "Assigned", "Unassigned", "Duplicate assignments", "Deleted", "Moved", "New", "Translated",
            "Confirmed rate",
        ),
        flow_title="Old documents × destinations (count)",
        old_doc_header="Old document",
        unit_count_header="Units",
        total="Total",
        info_names=(
            "Bundle title", "Status", "Created by", "Created at (KST)", "Exported by", "Exported at (KST)",
            "Guideline version", "Synthetic data",
        ),
        yes="Yes",
        no="No",
    ),
}


# --- 칸 쓰기 ---


def write_text_cell(cell: Cell, value: str) -> None:
    """글 칸 하나를 쓴다 — 못 쓰는 문자는 대체 문자로 바꾸고 문자열 칸으로 고정한다(=로 시작해도 수식이 되지 않는다).

    openpyxl은 32,767자를 넘는 글을 말없이 자르므로 호출부가 split_cell_text로 나눈 글만 넣는다.
    """
    text = _UNWRITABLE_RE.sub(REPLACEMENT_CHAR, value)
    if len(text) > CELL_TEXT_LIMIT:
        raise ValueError(f"cell text longer than {CELL_TEXT_LIMIT}: {len(text)}")
    cell.value = text
    cell.data_type = "s"  # 값이 =로 시작하면 openpyxl은 수식(f)으로, #N/A 같은 글은 오류(e)로 읽는다
    if text.startswith(_FORMULA_LEADS):
        cell.quotePrefix = True  # 사람이 칸을 고쳐 다시 넣어도 수식으로 바뀌지 않게 한다


def split_cell_text(text: str, limit: int = CELL_TEXT_LIMIT) -> list[str]:
    """한 칸에 들어가는 길이로 나눈다 — 길이는 Excel처럼 UTF-16 단위로 세고(한 글자가 두 칸인 글자도 쌍을 가르지 않는다), 빈 글은 [""]."""
    if len(text) * 2 <= limit:  # 어떤 글자도 UTF-16 두 칸을 넘지 않는다
        return [text]
    chunks: list[str] = []
    start, width = 0, 0
    for index, char in enumerate(text):
        size = 2 if ord(char) > 0xFFFF else 1
        if width + size > limit:
            chunks.append(text[start:index])
            start, width = index, 0
        width += size
    chunks.append(text[start:])
    return chunks


def _to_kst(value: datetime) -> datetime:
    """시간대 없는 값은 DB가 돌려준 KST로 본다."""
    return value.replace(tzinfo=KST) if value.tzinfo is None else value.astimezone(KST)


def _format_kst(value: datetime) -> str:
    return _to_kst(value).strftime("%Y-%m-%d %H:%M")


def build_export_file_name(title: str, lang: str, at: datetime) -> str:
    """`<묶음 제목>_<ko|en>_<KST yyyymmdd-HHmm>.xlsx` — NFC, 파일 이름에 못 쓰는 글자·제어 문자는 `_`, 제목은 150자까지."""
    normalized = unicodedata.normalize("NFC", title)
    cleaned = "".join("_" if unicodedata.category(char) == "Cc" else char for char in normalized)
    cleaned = _FILE_NAME_FORBIDDEN_RE.sub("_", cleaned).strip()[:MAX_FILE_NAME_TITLE_CHARS].strip() or "bundle"
    return f"{cleaned}_{lang}_{_to_kst(at):%Y%m%d-%H%M}.xlsx"


def _put_text(sheet: Worksheet, row: int, column: int, text: str, *, wrap: bool = True) -> Cell:
    cell = sheet.cell(row, column)
    write_text_cell(cell, text)
    if wrap:
        cell.alignment = _WRAP_TOP
    return cell


def _put_header_row(sheet: Worksheet, row: int, headers: Sequence[str]) -> None:
    for column, header in enumerate(headers, start=1):
        cell = _put_text(sheet, row, column, header)
        cell.font, cell.fill = _BOLD, _HEADER_FILL


def _put_chunked_row(
    sheet: Worksheet, row: int, cells: Sequence[str], id_column: int, continued: str,
    italic_columns: Collection[int] = (),
) -> int:
    """한 줄을 쓴다. 칸 한계를 넘는 글은 다음 줄들에 이어 싣고, 이어진 줄의 표시 ID 칸에 이어짐 표시를 둔다. 다음 빈 줄 번호를 돌려준다.

    italic_columns(1부터 센 열)의 글은 이어진 조각까지 기울여 쓴다 — 주석 줄 표시다.
    """
    pieces = [split_cell_text(text) for text in cells]
    height = max(len(chunks) for chunks in pieces)
    for offset in range(height):
        for column, chunks in enumerate(pieces, start=1):
            text = continued if offset and column == id_column else (chunks[offset] if offset < len(chunks) else "")
            if text:
                cell = _put_text(sheet, row + offset, column, text)
                if column in italic_columns and not (offset and column == id_column):
                    cell.font = _ITALIC
    return row + height


def _put_status_line(sheet: Worksheet, labels: ExcelLabels, snap: BundleSnapshot) -> None:
    status = labels.bundle_statuses.get(snap.bundle.status, snap.bundle.status)
    _put_text(sheet, 1, 1, labels.status_line.format(status=status), wrap=False).font = _BOLD


def _set_widths(sheet: Worksheet, widths: Sequence[int]) -> None:
    for column, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(column)].width = width


# --- A 비교표 ---


def _format_location(row: ARow, labels: ExcelLabels) -> str:
    location = row.location
    pieces = [f"§{location.section}"] if location.section else []
    if location.place:
        pieces.append(location.place)
    if location.page is not None:
        template = labels.page_estimated if location.page_basis == "estimated" else labels.page
        pieces.append(template.format(page=location.page))
    return " · ".join(pieces)


def _format_warnings(row: ARow) -> str:
    return "; ".join(
        f"{warning.get('kind', '')}: {warning.get('source', '')} → {warning.get('target', '')}"
        for warning in row.warnings
    )


def _list_a_cells(row: ARow, labels: ExcelLabels, output: OutputLabels) -> list[str]:
    """결과물 A 한 줄의 칸 글(스펙 §7.13 칸 순서) — 미배정은 보낸 곳 칸이 빈 채로 보인다. 첫 칸은 묶음 번호다."""
    return [
        str(row.row_no),
        row.old_doc_code,
        row.old_doc_version,
        _format_location(row, labels),
        row.display_id,
        row.source_text,
        output.dest_kinds.get(row.dest_kind, ""),
        row.dest_doc_code,
        row.dest_doc_title,
        row.dest_location,
        row.dest_number,
        row.confirmed_text,
        row.ai_text,
        output.change_types.get(row.change_type, row.change_type),
        row.group_id or "",
        row.remark,
        output.statuses.get(row.status, row.status),
        row.confirmed_by or "",
        _format_kst(row.confirmed_at) if row.confirmed_at is not None else "",
        _format_warnings(row),
    ]


def _write_sheet_a(sheet: Worksheet, snap: BundleSnapshot, lang: Lang, labels: ExcelLabels) -> None:
    output = LABELS[lang]
    _put_status_line(sheet, labels, snap)
    _put_header_row(sheet, 2, labels.a_headers)
    next_row = 3
    for row in build_output_a(snap, lang, {}):  # 확정한 사람은 아직 ID만 적는다
        next_row = _put_chunked_row(
            sheet, next_row, _list_a_cells(row, labels, output), A_ID_COLUMN, output.continued,
            A_NOTE_COLUMNS if row.dest_is_note else (),
        )
    _set_widths(sheet, A_COLUMN_WIDTHS)
    sheet.freeze_panes = "A3"
    sheet.auto_filter.ref = f"A2:{get_column_letter(len(labels.a_headers))}{max(next_row - 1, 2)}"


# --- B 흐름 ---


def _describe_node(node: FlowNode) -> str:
    return f"{node.label} {node.title}" if node.title else node.label


def _write_sheet_b(sheet: Worksheet, snap: BundleSnapshot, lang: Lang, labels: ExcelLabels) -> None:
    """요약 숫자 표, 옛 문서 × 보낸 곳 건수 표, 그 아래에 흐름도 그림."""
    graph, summary = build_output_b(snap, lang), build_summary(snap)
    _put_status_line(sheet, labels, snap)
    _put_text(sheet, 2, 1, labels.summary_title, wrap=False).font = _BOLD
    _put_header_row(sheet, 3, labels.summary_headers)
    # 요약 한 벌의 값을 지금 이름 아홉 칸에 싣는다 — 이름(옛 줄·No destination)과 한 언어만 있는 줄은 Excel 개편 때 바꾼다
    values = (
        summary.old_rows, summary.assigned, summary.no_destination, summary.duplicate, summary.deleted, summary.moved,
        summary.new, summary.translated, summary.confirmed_rate,
    )
    row = 4
    for name, value in zip(labels.summary_names, values, strict=True):
        _put_text(sheet, row, 1, name, wrap=False)
        sheet.cell(row, 2, value).number_format = "0.0%" if isinstance(value, float) else "General"
        row += 1

    row += 1
    _put_text(sheet, row, 1, labels.flow_title, wrap=False).font = _BOLD
    old_nodes = [node for node in graph.nodes if node.kind == "old"]
    dest_nodes = [node for node in graph.nodes if node.kind != "old"]
    dest_headers = [_describe_node(node) for node in dest_nodes]
    _put_header_row(sheet, row + 1, [labels.old_doc_header, labels.unit_count_header, *dest_headers])
    counts = {(edge.source, edge.target): edge.count for edge in graph.edges}
    row += 2
    for old in old_nodes:
        _put_text(sheet, row, 1, _describe_node(old), wrap=False)
        sheet.cell(row, 2, old.count)
        for column, dest in enumerate(dest_nodes, start=3):
            sheet.cell(row, column, counts.get((old.id, dest.id), 0))
        row += 1
    _put_text(sheet, row, 1, labels.total, wrap=False).font = _BOLD
    sheet.cell(row, 2, sum(old.count for old in old_nodes)).font = _BOLD
    for column, dest in enumerate(dest_nodes, start=3):
        sheet.cell(row, column, dest.count).font = _BOLD

    sheet.add_image(SheetImage(BytesIO(draw_flow_png(graph, lang))), f"A{row + 2}")
    _set_widths(sheet, (34, 12, *([18] * len(dest_nodes))))


# --- C 새 문서 ---


_CRow = tuple[list[str], frozenset[int]]  # 칸 글과 기울여 쓸 열(1부터 센다)


def _make_c_cells(values: dict[int, str], italic: Collection[int] = ()) -> _CRow:
    return [values.get(column, "") for column in range(len(C_COLUMN_WIDTHS))], frozenset(column + 1 for column in italic)


def _list_c_item_cells(item: CItem, depth: int, labels: ExcelLabels, output: OutputLabels) -> Iterator[_CRow]:
    """새 문장 한 줄과, 표 새 문장이면 그 칸 새 문장들(한 단계 더 들여쓴 열). 주석 줄은 항목·AI 제안 글을 기울여 쓴다."""
    marker = {"table": labels.table_marker, "figure": labels.figure_marker}.get(item.kind, "")
    values = {
        C_ITEM + depth: item.text or marker,
        C_AI: item.ai_text,
        C_CHANGE: output.change_types.get(item.change_type or "", ""),
        C_STATUS: output.statuses.get(item.status, item.status),
        C_SOURCE: item.source_note,
    }
    if depth == 0 and item.number is not None:  # 표 칸은 표의 번호라 표 줄에만 적는다
        values[C_NUMBER] = item.number
    if item.cell_row is not None and item.cell_col is not None:
        values[C_POSITION] = labels.cell_position.format(row=item.cell_row + 1, col=item.cell_col + 1)
    yield _make_c_cells(values, (C_ITEM + depth, C_AI) if item.number_style == NUMBER_NOTE else ())
    for child in item.children:
        yield from _list_c_item_cells(child, depth + 1, labels, output)


def _format_old_ref(doc_code: str, section: str) -> str:
    return f"{doc_code} §{section}" if section else doc_code


def _list_c_cells(snap: BundleSnapshot, lang: Lang, labels: ExcelLabels) -> Iterator[_CRow]:
    """결과물 C를 줄 단위 칸 글로 — 새 문서, 그 칸, 항목 순으로 들여쓰고 끝에 삭제·다른 문서로 이동을 따로 둔다."""
    output, result = LABELS[lang], build_output_c(snap, lang)
    for doc in result.docs:
        title = f" · {doc.title}" if doc.title else ""
        parent = f" ({doc.parent_code})" if doc.parent_code else ""
        yield _make_c_cells({C_DOC: f"{doc.doc_type.upper()} {doc.code}{title}{parent}"})
        for section in doc.sections:
            values = {C_SECTION: section.label}
            if section.number is not None:
                values[C_NUMBER] = section.number
            if section.na_reason is not None:
                values |= {C_STATUS: labels.na, C_REASON: section.na_reason}
            yield _make_c_cells(values)
            for item in section.items:
                yield from _list_c_item_cells(item, 0, labels, output)
    if result.deleted:
        yield _make_c_cells({C_DOC: output.dest_kinds["delete"]})
        for deleted in result.deleted:
            yield _make_c_cells({
                C_ITEM: deleted.source_text, C_ID: deleted.display_id,
                C_SOURCE: _format_old_ref(deleted.doc_code, deleted.section), C_REASON: deleted.reason,
            })
    if result.moved:
        yield _make_c_cells({C_DOC: output.dest_kinds["move_external"]})
        for moved in result.moved:
            yield _make_c_cells({
                C_ITEM: moved.source_text, C_ID: moved.display_id,
                C_SOURCE: _format_old_ref(moved.doc_code, moved.section), C_MOVE: moved.move_target_code,
                C_REASON: moved.reason,
            })


def _write_sheet_c(sheet: Worksheet, snap: BundleSnapshot, lang: Lang, labels: ExcelLabels) -> None:
    _put_status_line(sheet, labels, snap)
    _put_header_row(sheet, 2, labels.c_headers)
    next_row = 3
    for cells, italic in _list_c_cells(snap, lang, labels):
        next_row = _put_chunked_row(sheet, next_row, cells, C_ID + 1, LABELS[lang].continued, italic)
    _set_widths(sheet, C_COLUMN_WIDTHS)
    sheet.freeze_panes = "A3"


# --- 정보 ---


def _write_sheet_info(sheet: Worksheet, snap: BundleSnapshot, labels: ExcelLabels, meta: ExportMeta) -> None:
    bundle = snap.bundle
    values = (
        bundle.title,
        labels.bundle_statuses.get(bundle.status, bundle.status),
        bundle.created_by,
        _format_kst(bundle.created_at),
        meta.exported_by,
        _format_kst(meta.exported_at),
        meta.guideline_version,
        labels.yes if bundle.is_synthetic else labels.no,
    )
    for row, (name, value) in enumerate(zip(labels.info_names, values, strict=True), start=1):
        _put_text(sheet, row, 1, name, wrap=False).font = _BOLD
        _put_text(sheet, row, 2, value)
    _set_widths(sheet, (24, 60))


def build_workbook(snap: BundleSnapshot, lang: Lang, meta: ExportMeta) -> bytes:
    """결과물 A·B·C와 정보 시트를 담은 .xlsx 바이트 — 순수 계산이라 이벤트 루프 밖 스레드에서 부른다."""
    labels = EXCEL_LABELS[lang]
    workbook = Workbook()
    sheet_a = workbook.active
    sheet_a.title = labels.sheets[0]
    _write_sheet_a(sheet_a, snap, lang, labels)
    _write_sheet_b(workbook.create_sheet(labels.sheets[1]), snap, lang, labels)
    _write_sheet_c(workbook.create_sheet(labels.sheets[2]), snap, lang, labels)
    _write_sheet_info(workbook.create_sheet(labels.sheets[3]), snap, labels, meta)
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
