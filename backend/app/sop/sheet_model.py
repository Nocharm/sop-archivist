"""Excel 시트 모델 — 네 시트의 열 머리·폭과 줄마다 칸 글·줄 종류·흐림·기울임을 한 번 지어 xlsx와 미리보기 JSON이 함께 쓴다 (제품 명세 §7.14 시트 모델).

계산은 app/sop/outputs.py가 끝냈고 여기서는 그 결과를 칸 글로 옮긴다. 시스템 표시 값은 영어 한 벌이다(Excel·미리보기는 늘 en).
32,767자 나누기도 여기서 해 미리보기와 파일이 같은 줄이 된다. xlsx 쓰기는 excel_export.build_workbook.
"""

import base64
import math
from collections.abc import Collection, Iterator, Mapping, Sequence
from typing import Literal

from pydantic import BaseModel

from app.equis.view import EquisOut
from app.sop.captions import join_caption_texts
from app.sop.constants import NUMBER_BULLET, NUMBER_NOTE
from app.sop.excel_export import ExportMeta, build_export_file_name, clean_cell_text, format_kst, split_cell_text
from app.sop.flow_image import draw_flow_png
from app.sop.output_labels import LABELS
from app.sop.outputs import (
    ARow,
    CItem,
    FlowNode,
    LocationOut,
    build_output_a,
    build_output_b,
    build_output_c,
    build_summary,
)
from app.sop.snapshot import BundleSnapshot

RowKind = Literal["status", "header", "group_start", "in_group", "doc", "section", "plain"]

SHEET_NAMES = ("A Comparison", "B Flow", "C New documents", "Info", "Documents")
A_HEADERS = (
    "Row", "Old doc", "Ver.", "Location", "Unit ID", "Old text", "Destination", "New doc", "New doc title", "Place",
    "No.", "New text", "AI suggestion", "Change", "Remark", "Status", "Confirmed by", "Confirmed at", "Group ID",
    "Checks",
)
A_COLUMN_WIDTHS = (8, 12, 8, 26, 14, 50, 14, 14, 26, 28, 12, 50, 40, 18, 28, 12, 24, 18, 14, 40)
A_SHARED_COLUMNS = (1, 7, 8, 9, 15)  # Row·Destination·New doc·New doc title·Remark (1부터) — 묶음이 함께 쓰는 칸(제품 명세 §7.13 줄 규칙 (5))
A_ROW_COLUMN = 1
A_ID_COLUMN = 5  # Unit ID — 이어진 줄의 이어짐 표시가 들어가는 칸
A_NOTE_COLUMNS = (12, 13)  # 보낸 새 문장이 주석 줄이면 기울여 쓰는 칸 — New text·AI suggestion
C_HEADERS = (
    "Document", "Slot", "No.", "Item", "Table cell", "Cell position", "Unit ID", "AI-suggested sentence", "Change type",
    "Status", "Old units", "Moved to", "Reason",
)
# 결과물 C — 문서·칸·항목·표 칸이 들여쓰기 열이고 나머지는 항목의 세부다(0부터). 번호 열은 칸·항목의 섹션 번호(outputs가 센 값)
(C_DOC, C_SECTION, C_NUMBER, C_ITEM, C_CELL, C_POSITION, C_ID, C_AI, C_CHANGE, C_STATUS, C_SOURCE, C_MOVE, C_REASON) = (
    range(13)
)
C_COLUMN_WIDTHS = (34, 30, 12, 50, 40, 12, 14, 40, 14, 10, 30, 18, 30)
B_COLUMN_WIDTHS = (34, 12)  # 이름·건수, 그 뒤로 보낸 곳마다 B_DEST_WIDTH
B_DEST_WIDTH = 18
INFO_COLUMN_WIDTHS = (24, 60)
# 문서 목록 시트 — 묶음의 옛 문서와 새 문서, 그리고 그 번호의 EQUIS 값(꺼져 있거나 묻지 않는 번호면 EQUIS 칸은 빈다)
DOC_HEADERS = (
    "Side", "Doc no.", "Title", "Uploaded ver.", "EQUIS", "Current no.", "Current ver.", "Effective date", "Owning dept.",
    "EQUIS link",
)
DOC_COLUMN_WIDTHS = (8, 20, 50, 14, 30, 20, 20, 14, 26, 50)
# EQUIS 판정 이유의 시트 글 — 화면의 상태 글자와 같이 영어다
_EQUIS_REASONS = {
    "old_number": "Old number", "retired": "Retired", "version_mismatch": "Not the current version",
    "newer_authorized": "Newer version authorized", "no_current": "No current version",
}
# 시트마다 미리보기 줄 상한(제품 명세 §7.14 시트 모델) — 파일에는 전체를 싣는다. 2026-11-13 극단 시드 W1(A 1,558줄·C 2,304줄)에서 잰 값:
# 500이면 응답 3.6MB(그중 B 흐름도 PNG 1.6MB는 상한과 무관)·서버 0.8초·창을 눌러 시트가 보일 때까지 1.9초.
# 상한이 없으면 약 8.3MB, 300이면 2.9MB — 500줄이면 모양 확인에 넉넉하고 크기도 받을 만해 그대로 둔다
MAX_PREVIEW_ROWS = 500

STATUS_LINE = "Status: {status}"
BUNDLE_STATUSES = {"in_progress": "In progress", "in_review": "Awaiting review", "done": "Review complete"}
SUMMARY_NAMES = (
    "Old rows", "Assigned", "No destination", "Duplicate assignments", "Deleted", "Moved", "New", "Translated",
    "Confirmed rate", "Single language",
)
INFO_NAMES = (
    "Bundle title", "Status", "Created by", "Created at (KST)", "Exported by", "Exported at (KST)", "Guideline version",
    "Synthetic data",
)
_LABELS = LABELS["en"]
_MARKERS = {"table": "[Table]", "figure": "[Figure]"}  # 확정한 캡션 글이 없는 표·그림 줄에만
_BULLET = "•"  # 글머리 기호 줄의 No. 칸(C 시트) — 화면의 줄 머리와 같은 기호
_CAPTION_POSITION = "Caption"  # 캡션 줄의 Cell position 칸 — 칸 줄의 "R 1 C 1" 자리
_NO_WRAP_KINDS = ("status", "plain")  # 상태 줄·제목·이름 칸은 옆 칸으로 넘쳐 보이게 접지 않는다


class SheetCell(BaseModel):
    """칸 하나 — 미리보기와 xlsx가 이 값만 보고 그린다(모양을 다시 판정하지 않는다)."""

    text: str = ""  # 보이는 글 그대로 — XML에 못 쓰는 문자는 이미 U+FFFD(clean_cell_text), 32,767자 이하
    head: bool = False  # 머리 칸(글이 있는 머리 줄 칸): 바탕 #2B2F36·흰 굵은 글자·아래 thick #202124. 머리 줄의 빈 채움 칸은 False
    faint: bool = False  # 같은 묶음에서 바로 윗줄과 같은 함께 쓰는 칸 — 흐린 글자 #9AA0A6
    italic: bool = False  # 주석 줄의 글 칸
    bold: bool = False
    numeric: bool = False  # 글이 정수인 칸(Row·건수) — xlsx에는 숫자로 쓴다


class SheetRow(BaseModel):
    """줄 하나 — 위 테두리는 kind로 정한다: group_start는 medium #5F6368, in_group은 thin #9AA0A6, 그 밖은 없음."""

    kind: RowKind
    wrap: bool  # 칸 글을 칸 폭 안에서 접는다(위 맞춤). False(상태 줄·plain 줄)면 접지 않아 옆 빈 칸으로 넘쳐 보인다
    cells: list[SheetCell]  # 늘 시트 열 수(widths)만큼 — 빈 칸도 싣는다


class Sheet(BaseModel):
    name: str
    widths: list[int]
    rows: list[SheetRow]
    freeze: str | None  # "A3"(A·C — 1행 상태 줄·2행 머리를 고정), 그 밖 None
    filter_columns: int  # 2행 머리에 자동 필터를 거는 열 수 — A는 20, 나머지 0
    image_png: str | None  # B 흐름도 PNG base64(파일과 같은 draw_flow_png), 그 밖 None
    image_row: int | None  # 그림을 놓는 줄(1부터)
    total_rows: int  # 자르기 전 줄 수
    truncated: bool  # 미리보기가 줄을 잘랐다 — 파일에는 전체가 있다


class WorkbookModel(BaseModel):
    file_name: str
    sheets: list[Sheet]


# --- 줄 짓기 ---


def _make_row(
    kind: RowKind,
    texts: Sequence[str],
    *,
    bold: Collection[int] = (),
    italic: Collection[int] = (),
    numeric: Collection[int] = (),
) -> SheetRow:
    """칸 글 목록으로 한 줄 — 글은 여기서 한 번 clean_cell_text를 거친다. 모양 집합은 1부터 센 열 번호다.

    머리 모양은 글이 있는 머리 줄 칸에만(B의 두 칸짜리 Item·Value 머리가 뒤 열까지 칠하지 않게), 상태·plain 줄은 접지 않는다.
    """
    cells = []
    for column, raw in enumerate(texts, start=1):
        text = clean_cell_text(raw)
        cells.append(
            SheetCell(
                text=text, head=kind == "header" and bool(text), bold=column in bold, italic=column in italic,
                numeric=column in numeric and bool(text),
            )
        )
    return SheetRow(kind=kind, wrap=kind not in _NO_WRAP_KINDS, cells=cells)


def _pad(texts: Sequence[str], width: int) -> list[str]:
    return [*texts, *[""] * (width - len(texts))]


def _split_line(texts: Sequence[str], id_column: int, repeated: Collection[int] = ()) -> list[list[str]]:
    """한 줄의 칸 글을 칸 한계로 나눈 줄들 — 넘는 글은 다음 줄들에 잇고, 이어진 줄의 id_column은 이어짐 표시다.

    이어진 줄에서 repeated 칸(한 조각인 함께 쓰는 칸)은 되풀이하고 나머지 칸은 빈다 — 이어진 줄도 묶음 값을 지녀 흐림·거르기가 끊기지 않는다.
    """
    pieces = [split_cell_text(text) for text in texts]
    height = max(len(chunks) for chunks in pieces)
    lines = [[chunks[0] for chunks in pieces]]
    for offset in range(1, height):
        line = []
        for column, chunks in enumerate(pieces, start=1):
            if column == id_column:
                line.append(_LABELS.continued)
            elif offset < len(chunks):
                line.append(chunks[offset])
            else:
                line.append(chunks[0] if column in repeated and len(chunks) == 1 else "")
        lines.append(line)
    return lines


def _build_status_row(snap: BundleSnapshot, width: int) -> SheetRow:
    status = BUNDLE_STATUSES.get(snap.bundle.status, snap.bundle.status)
    return _make_row("status", _pad([STATUS_LINE.format(status=status)], width), bold=(1,))


def _make_sheet(
    name: str,
    widths: Sequence[int],
    rows: list[SheetRow],
    *,
    freeze: str | None = None,
    filter_columns: int = 0,
    image_png: str | None = None,
    image_row: int | None = None,
) -> Sheet:
    return Sheet(
        name=name, widths=list(widths), rows=rows, freeze=freeze, filter_columns=filter_columns, image_png=image_png,
        image_row=image_row, total_rows=len(rows), truncated=False,
    )


# --- A Comparison ---


def _format_location(location: LocationOut) -> str:
    pieces = [f"§{location.section}"] if location.section else []
    if location.place:
        pieces.append(location.place)
    if location.page is not None:
        pieces.append(f"~p. {location.page}" if location.page_basis == "estimated" else f"p. {location.page}")
    return " · ".join(pieces)


def _format_warnings(row: ARow) -> str:
    return "; ".join(
        f"{warning.get('kind', '')}: {warning.get('source', '')} → {warning.get('target', '')}"
        for warning in row.warnings
    )


def _list_a_texts(row: ARow) -> list[str]:
    """결과물 A 한 줄의 칸 글(A_HEADERS 순서) — 미배정은 보낸 곳 칸이 빈 채로 보인다."""
    return [
        str(row.row_no),
        row.old_doc_code,
        row.old_doc_version,
        _format_location(row.location),
        row.display_id,
        row.source_text,
        _LABELS.dest_kinds.get(row.dest_kind, ""),
        row.dest_doc_code,
        row.dest_doc_title,
        row.dest_location,
        row.dest_number,
        row.confirmed_text,
        row.ai_text,
        _LABELS.change_types.get(row.change_type, row.change_type),
        row.remark,
        _LABELS.statuses.get(row.status, row.status),
        row.confirmed_by or "",
        format_kst(row.confirmed_at) if row.confirmed_at is not None else "",
        row.group_id or "",
        _format_warnings(row),
    ]


def _build_a_sheet(snap: BundleSnapshot, people: Mapping[str, str]) -> Sheet:
    """ARow 하나가 한 줄(넘는 글은 이어진 줄) — 묶음 첫 줄 말고는 함께 쓰는 칸이 바로 윗줄과 같으면 흐리게(제품 명세 §7.14 되풀이 + 흐림, O6).

    흐림은 보이는 글(clean_cell_text를 거친 칸 글)끼리 견준다.
    """
    rows = [_build_status_row(snap, len(A_HEADERS)), _make_row("header", A_HEADERS)]
    above: SheetRow | None = None
    for a_row in build_output_a(snap, "en", people):
        italic = A_NOTE_COLUMNS if a_row.dest_is_note else ()
        for offset, line in enumerate(_split_line(_list_a_texts(a_row), A_ID_COLUMN, A_SHARED_COLUMNS)):
            starts = a_row.is_group_start and offset == 0
            row = _make_row("group_start" if starts else "in_group", line, italic=italic, numeric=(A_ROW_COLUMN,))
            if not starts and above is not None:
                for column in A_SHARED_COLUMNS:
                    cell = row.cells[column - 1]
                    cell.faint = cell.text == above.cells[column - 1].text
            rows.append(row)
            above = row
    return _make_sheet(SHEET_NAMES[0], A_COLUMN_WIDTHS, rows, freeze="A3", filter_columns=len(A_HEADERS))


# --- B Flow ---


def format_rate(rate: float) -> str:
    """확정률 글 — "28%"(반올림은 floor(rate*100 + 0.5), 줄이 0이면 rate가 0이라 "0%")."""
    return f"{math.floor(rate * 100 + 0.5)}%"


def _describe_node(node: FlowNode) -> str:
    return f"{node.label} {node.title}" if node.title else node.label


def _build_b_sheet(snap: BundleSnapshot) -> Sheet:
    """요약 숫자 표, 옛 문서 × 보낸 곳 건수 표(줄로 센다), 그 아래 흐름도 그림."""
    graph, summary = build_output_b(snap, "en"), build_summary(snap)
    old_nodes = [node for node in graph.nodes if node.kind == "old"]
    dest_nodes = [node for node in graph.nodes if node.kind != "old"]
    widths = (*B_COLUMN_WIDTHS, *[B_DEST_WIDTH] * len(dest_nodes))
    width = len(widths)
    rows = [
        _build_status_row(snap, width),
        _make_row("plain", _pad(["Summary"], width), bold=(1,)),
        _make_row("header", _pad(["Item", "Value"], width)),
    ]
    values = (
        summary.old_rows, summary.assigned, summary.no_destination, summary.duplicate, summary.deleted, summary.moved,
        summary.new, summary.translated, format_rate(summary.confirmed_rate), summary.single_language,
    )
    for name, value in zip(SUMMARY_NAMES, values, strict=True):
        rows.append(_make_row("plain", _pad([name, str(value)], width), numeric=() if isinstance(value, str) else (2,)))

    rows.append(_make_row("plain", _pad([], width)))
    rows.append(_make_row("plain", _pad(["Old documents × destinations (count)"], width), bold=(1,)))
    rows.append(_make_row("header", ["Old document", "Rows", *[_describe_node(node) for node in dest_nodes]]))
    counts = {(edge.source, edge.target): edge.count for edge in graph.edges}
    count_columns = range(2, width + 1)
    for old in old_nodes:
        texts = [_describe_node(old), str(old.count), *[str(counts.get((old.id, dest.id), 0)) for dest in dest_nodes]]
        rows.append(_make_row("plain", texts, numeric=count_columns))
    total = ["Total", str(sum(old.count for old in old_nodes)), *[str(dest.count) for dest in dest_nodes]]
    rows.append(_make_row("plain", total, bold=range(1, width + 1), numeric=count_columns))

    image = base64.b64encode(draw_flow_png(graph, "en")).decode("ascii")
    return _make_sheet(SHEET_NAMES[1], widths, rows, image_png=image, image_row=len(rows) + 2)


# --- C New documents ---


def _make_c_texts(values: Mapping[int, str]) -> list[str]:
    return [values.get(column, "") for column in range(len(C_HEADERS))]


def _list_c_item_lines(item: CItem, depth: int) -> Iterator[tuple[list[str], tuple[int, ...]]]:
    """새 문장 한 줄과, 표·그림 새 문장이면 그 자식들(한 단계 더 들여쓴 열) — (칸 글, 기울일 열(1부터)). 주석 줄은 항목·AI 글을 기울인다.

    표·그림 줄의 항목 칸은 [Table]·[Figure] 대신 확정한 캡션 글(AI 글은 쓰지 않는다 — 캡션 줄의 AI 칸에 있다)이다. 자식은 캡션 줄이
    칸 줄 앞에 오고(서버 순서), 칸 줄처럼 자기 확정 글·AI 글·변경 종류·상태·출처를 싣는다.
    """
    confirmed_caption = join_caption_texts(
        (child.lang, child.text) for child in item.children if child.cell_row is None or child.cell_col is None
    )
    values = {
        C_ITEM + depth: item.text or confirmed_caption or _MARKERS.get(item.kind, ""),
        C_AI: item.ai_text,
        C_CHANGE: _LABELS.change_types.get(item.change_type or "", ""),
        C_STATUS: _LABELS.statuses.get(item.status, item.status),
        C_SOURCE: item.source_note,
    }
    if depth == 0 and item.number is not None:  # 표 칸은 표의 번호라 표 줄에만 적는다
        values[C_NUMBER] = item.number
    elif depth == 0 and item.number_style == NUMBER_BULLET:
        values[C_NUMBER] = _BULLET
    if item.cell_row is not None and item.cell_col is not None:
        values[C_POSITION] = f"R {item.cell_row + 1} C {item.cell_col + 1}"
    elif depth > 0:  # 표·그림 아래 칸 좌표 없는 자식 = 캡션 줄
        values[C_POSITION] = _CAPTION_POSITION
    italic = (C_ITEM + depth + 1, C_AI + 1) if item.number_style == NUMBER_NOTE else ()
    yield _make_c_texts(values), italic
    for child in item.children:
        yield from _list_c_item_lines(child, depth + 1)


def _append_c_lines(rows: list[SheetRow], texts: list[str], starts: bool, italic: Collection[int] = ()) -> None:
    """C 한 줄과 그 이어진 줄들 — 이어진 줄은 같은 묶음(in_group)이다."""
    for offset, line in enumerate(_split_line(texts, C_ID + 1)):
        rows.append(_make_row("group_start" if starts and offset == 0 else "in_group", line, italic=italic))


def _format_old_ref(doc_code: str, section: str) -> str:
    return f"{doc_code} §{section}" if section else doc_code


def _build_c_sheet(snap: BundleSnapshot) -> Sheet:
    """새 문서(doc) → 칸(section, Old units 칸에 칸 제목 출처) → 항목(같은 의미 묶음이 이어지면 in_group), 끝에 삭제·다른 문서로 이동."""
    result = build_output_c(snap, "en")
    width = len(C_HEADERS)
    rows = [_build_status_row(snap, width), _make_row("header", C_HEADERS)]
    for doc in result.docs:
        title = f" · {doc.title}" if doc.title else ""
        parent = f" ({doc.parent_code})" if doc.parent_code else ""
        heading = f"{doc.doc_type.upper()} {doc.code}{title}{parent}"
        rows.append(_make_row("doc", _make_c_texts({C_DOC: heading}), bold=(C_DOC + 1,)))
        for section in doc.sections:
            values = {C_SECTION: section.label, C_SOURCE: section.heading_note}
            if section.number is not None and section.shows_number:  # 부록은 라벨("Appendix 1. 이름")에 번호가 들어 있다
                values[C_NUMBER] = section.number
            if section.na_reason is not None:
                values |= {C_STATUS: "N/A", C_REASON: section.na_reason}
            rows.append(_make_row("section", _make_c_texts(values), bold=(C_SECTION + 1,)))
            for auto in section.auto_items:  # 자동 목록 절(7.2 Work Instructions) — 앱이 채운 자식 WI, 배정한 줄이 아니다
                text = f"{auto.code} · {auto.title}" if auto.title else auto.code
                _append_c_lines(rows, _make_c_texts({C_ITEM: text}), True)
            previous_key: str | None = None
            for index, item in enumerate(section.items):
                # 칸의 첫 항목·묶음 키가 없는 항목(고아 번역)·키가 바뀐 항목이 새 묶음을 연다 — 표 칸은 표 묶음 안이다
                starts = index == 0 or item.meaning_key is None or item.meaning_key != previous_key
                for depth_index, (texts, italic) in enumerate(_list_c_item_lines(item, 0)):
                    _append_c_lines(rows, texts, starts and depth_index == 0, italic)
                previous_key = item.meaning_key
    tails = (
        (_LABELS.dest_kinds["delete"], [(entry, "") for entry in result.deleted]),
        (_LABELS.dest_kinds["move_external"], [(entry, entry.move_target_code) for entry in result.moved]),
    )
    for label, entries in tails:
        if not entries:
            continue
        rows.append(_make_row("doc", _make_c_texts({C_DOC: label}), bold=(C_DOC + 1,)))
        for entry, move_target_code in entries:
            values = {
                C_ITEM: entry.source_text, C_ID: entry.display_id, C_MOVE: move_target_code, C_REASON: entry.reason,
                C_SOURCE: _format_old_ref(entry.doc_code, entry.section),
            }
            _append_c_lines(rows, _make_c_texts(values), True)
    return _make_sheet(SHEET_NAMES[2], C_COLUMN_WIDTHS, rows, freeze="A3")


# --- Info ---


def _build_info_sheet(snap: BundleSnapshot, meta: ExportMeta) -> Sheet:
    bundle = snap.bundle
    values = (
        bundle.title,
        BUNDLE_STATUSES.get(bundle.status, bundle.status),
        bundle.created_by,
        format_kst(bundle.created_at),
        meta.exported_by,
        format_kst(meta.exported_at),
        meta.guideline_version,
        "Yes" if bundle.is_synthetic else "No",
    )
    rows = [_make_row("plain", [name, value], bold=(1,)) for name, value in zip(INFO_NAMES, values, strict=True)]
    return _make_sheet(SHEET_NAMES[3], INFO_COLUMN_WIDTHS, rows)


# --- Documents ---


def build_equis_key(side: Literal["old", "new"], row_id: int) -> str:
    """문서 목록 시트가 EQUIS 값을 찾는 열쇠 — 옛 문서는 문서 id, 새 문서는 To-Be 줄 id."""
    return f"{side}:{row_id}"


def _describe_equis(equis: EquisOut | None) -> str:
    """EQUIS 칸의 한 줄 — 화면의 표시와 같은 뜻을 글로만 적는다."""
    if equis is None:
        return ""
    if equis.state == "pending":
        return "Looking up"
    if equis.state == "not_found":
        return "Not in EQUIS"
    if equis.verdict is None:
        return "Lookup failed"
    if equis.verdict == "attention":
        return "Check: " + ", ".join(_EQUIS_REASONS.get(reason, reason) for reason in equis.reasons)
    return "Current" if equis.verdict == "ok" else "In EQUIS"


def _list_equis_texts(equis: EquisOut | None) -> list[str]:
    """EQUIS 여섯 칸 — 표시·지금 번호·지금 판·시행일·소유 부서·링크. 받은 값이 없으면 표시만 채운다."""
    label = _describe_equis(equis)
    if equis is None or equis.verdict is None:
        return [label, "", "", "", "", ""]
    current = equis.current
    version = f"{current.version} {current.status}".strip() if current else ""
    return [
        label, equis.number, version, current.effective_date if current else "", equis.owning_department,
        equis.doc_url or "",
    ]


def _build_documents_sheet(snap: BundleSnapshot, equis: Mapping[str, EquisOut]) -> Sheet:
    """묶음의 문서 목록 — 옛 문서(올린 순서)와 새 문서(To-Be 순서). 새 문서는 올린 판이 없다."""
    rows = [_build_status_row(snap, len(DOC_HEADERS)), _make_row("header", DOC_HEADERS)]
    old_docs = sorted((doc for doc in snap.documents.values() if doc.side == "old"), key=lambda doc: doc.order)
    for doc in old_docs:
        texts = ["Old", doc.doc_code, doc.title, doc.doc_version, *_list_equis_texts(equis.get(build_equis_key("old", doc.id)))]
        rows.append(_make_row("plain", texts))
    for target in sorted(snap.target_docs.values(), key=lambda item: (item.order_index, item.id)):
        texts = ["New", target.code, target.title, "", *_list_equis_texts(equis.get(build_equis_key("new", target.id)))]
        rows.append(_make_row("plain", texts))
    return _make_sheet(SHEET_NAMES[4], DOC_COLUMN_WIDTHS, rows, freeze="A3")


# --- 통합 문서 ---


def build_workbook_model(
    snap: BundleSnapshot, meta: ExportMeta, people: Mapping[str, str], equis: Mapping[str, EquisOut] | None = None
) -> WorkbookModel:
    """Excel 다섯 시트의 모델과 파일 이름 — 순수 계산이라 이벤트 루프 밖 스레드에서 부른다. people(로그인 ID → 이름)은 Confirmed by용,
    equis(`build_equis_key` → 그 문서의 EQUIS 값)는 문서 목록 시트용이다."""
    sheets = [
        _build_a_sheet(snap, people), _build_b_sheet(snap), _build_c_sheet(snap), _build_info_sheet(snap, meta),
        _build_documents_sheet(snap, equis or {}),
    ]
    file_name = build_export_file_name(snap.bundle.id, snap.bundle.title, meta.exported_at)
    return WorkbookModel(file_name=file_name, sheets=sheets)


def limit_preview(model: WorkbookModel, max_rows: int = MAX_PREVIEW_ROWS) -> WorkbookModel:
    """미리보기용 — 시트마다 앞 max_rows줄만 싣고 truncated를 켠다. total_rows는 파일의 줄 수 그대로다."""
    sheets = [
        sheet.model_copy(update={"rows": sheet.rows[:max_rows], "truncated": True}) if len(sheet.rows) > max_rows else sheet
        for sheet in model.sheets
    ]
    return model.model_copy(update={"sheets": sheets})
