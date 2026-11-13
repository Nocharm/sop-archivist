"""Excel 내보내기 — 시트 모델(app/sop/sheet_model.py)을 Graphite 테마의 수식 없는 통합 문서 하나로 쓴다 (제품 명세 §7.14 시트 모델·Graphite 테마).

칸 글·줄 종류·흐림·기울임은 시트 모델이 정했고 여기서는 칸에 옮겨 쓰고 모양만 입힌다. 글 칸은 모두 write_text_cell 하나로 써서
XML에 못 쓰는 문자는 바꾸고 =·+·-·@로 시작하는 글도 수식이 되지 않게 한다(DB 원문은 바꾸지 않는다).
"""

import base64
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from typing import TYPE_CHECKING

from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE, Cell
from openpyxl.drawing.image import Image as SheetImage
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

from app.clock import KST
from app.sop.bundle_code import format_bundle_code

if TYPE_CHECKING:  # sheet_model이 이 모듈의 칸 쓰기·파일 이름을 불러 쓰므로 타입만 가져온다
    from app.sop.sheet_model import Sheet, SheetCell, WorkbookModel

CELL_TEXT_LIMIT = 32767  # Excel 칸 하나의 글자 수 한계(UTF-16 단위)
MAX_FILE_NAME_TITLE_CHARS = 150
REPLACEMENT_CHAR = "\N{REPLACEMENT CHARACTER}"
# openpyxl이 못 쓰는 제어 문자에 XML 1.0이 금지하는 비문자 두 개를 더한다
_UNWRITABLE_RE = re.compile(f"{ILLEGAL_CHARACTERS_RE.pattern}|[￾￿]")
_FORMULA_LEADS = ("=", "+", "-", "@")
_FILE_NAME_FORBIDDEN_RE = re.compile(r'[\\/:*?"<>|]')
_WRAP_TOP = Alignment(wrap_text=True, vertical="top")

# Graphite 테마(제품 명세 §7.14 Graphite 테마, O7) — 머리 줄만 바탕이 있고, 묶음은 줄 위 테두리 굵기로 가른다. 그 밖의 바탕색·줄무늬는 없다.
# 색은 ARGB 8자리로 적는다 — 6자리면 openpyxl이 투명(00)을 붙여 쓴다
FAINT_COLOR = "FF9AA0A6"  # 흐린 글자 — 묶음 안 테두리와 같은 회색
_HEADER_FILL = PatternFill("solid", fgColor="FF2B2F36")
_HEADER_FONT = Font(bold=True, color="FFFFFFFF")
_HEADER_BORDER = Border(bottom=Side("thick", color="FF202124"))
_ROW_BORDERS = {
    "group_start": Border(top=Side("medium", color="FF5F6368")),
    "in_group": Border(top=Side("thin", color=FAINT_COLOR)),
}


@dataclass(frozen=True)
class ExportMeta:
    """내보내기 때 정해지는 값 — 누가 언제 어떤 지침 버전으로 내보냈는가."""

    exported_by: str
    exported_at: datetime
    guideline_version: str


# --- 칸 쓰기 ---


def clean_cell_text(value: str) -> str:
    """XML에 못 쓰는 문자를 대체 문자로 바꾼다(같은 길이) — 시트 모델이 칸을 지을 때 써 미리보기와 파일이 같은 글을 보인다."""
    return _UNWRITABLE_RE.sub(REPLACEMENT_CHAR, value)


def write_text_cell(cell: Cell, value: str) -> None:
    """글 칸 하나를 쓴다 — 못 쓰는 문자는 대체 문자로 바꾸고 문자열 칸으로 고정한다(=로 시작해도 수식이 되지 않는다).

    시트 모델의 글은 이미 clean_cell_text를 거쳤지만 모델 밖에서 부르는 길을 위해 여기서도 지킨다.
    openpyxl은 32,767자를 넘는 글을 말없이 자르므로 호출부가 split_cell_text로 나눈 글만 넣는다.
    """
    text = clean_cell_text(value)
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


def format_kst(value: datetime) -> str:
    """시트에 적는 시각 — KST "2026-11-13 09:05"."""
    return _to_kst(value).strftime("%Y-%m-%d %H:%M")


def build_export_file_name(bundle_id: int, title: str, at: datetime) -> str:
    """`BND-0004_<묶음 제목>_<KST yyyymmdd-HHmm>.xlsx`, 제목이 비면 `BND-0004_<KST yyyymmdd-HHmm>.xlsx`.

    제목은 NFC로 맞추고 파일 이름에 못 쓰는 글자·제어 문자는 `_`, 150자까지 — 미리보기와 받기가 이 한 곳에서 이름을 짓는다.
    """
    normalized = unicodedata.normalize("NFC", title)
    cleaned = "".join("_" if unicodedata.category(char) == "Cc" else char for char in normalized)
    cleaned = _FILE_NAME_FORBIDDEN_RE.sub("_", cleaned).strip()[:MAX_FILE_NAME_TITLE_CHARS].strip()
    parts = [format_bundle_code(bundle_id), cleaned, f"{_to_kst(at):%Y%m%d-%H%M}"]
    return "_".join(part for part in parts if part) + ".xlsx"


# --- 시트 모델 → xlsx ---


# 굵게·기울임·흐림 조합마다 글꼴 하나 — 칸마다 새로 만들지 않는다
_FONTS = {
    (bold, italic, faint): Font(bold=bold, italic=italic, color=FAINT_COLOR if faint else None)
    for bold in (False, True)
    for italic in (False, True)
    for faint in (False, True)
}


def _get_font(cell: "SheetCell") -> Font | None:
    """칸 모양의 글꼴 — 모양이 없으면 None(기본 글꼴)."""
    key = (cell.bold, cell.italic, cell.faint)
    return _FONTS[key] if any(key) else None


def _write_sheet(sheet: Worksheet, model: "Sheet") -> None:
    """줄마다 칸 글과 모양을 모델 그대로 — 머리 모양은 칸의 head, 접기는 줄의 wrap, 묶음 줄은 줄 종류대로 열 전체에 위 테두리."""
    for row_no, row in enumerate(model.rows, start=1):
        border = _ROW_BORDERS.get(row.kind)
        for column, cell_model in enumerate(row.cells, start=1):
            if not cell_model.text and border is None:
                continue
            cell = sheet.cell(row_no, column)
            if border is not None:
                cell.border = border
            if not cell_model.text:
                continue
            if cell_model.numeric:
                cell.value = int(cell_model.text)
            else:
                write_text_cell(cell, cell_model.text)
            if row.wrap:
                cell.alignment = _WRAP_TOP
            if cell_model.head:
                cell.font, cell.fill, cell.border = _HEADER_FONT, _HEADER_FILL, _HEADER_BORDER
            elif (font := _get_font(cell_model)) is not None:
                cell.font = font
    for column, width in enumerate(model.widths, start=1):
        sheet.column_dimensions[get_column_letter(column)].width = width
    if model.freeze is not None:
        sheet.freeze_panes = model.freeze
    if model.filter_columns:
        sheet.auto_filter.ref = f"A2:{get_column_letter(model.filter_columns)}{max(len(model.rows), 2)}"
    if model.image_png is not None and model.image_row is not None:
        sheet.add_image(SheetImage(BytesIO(base64.b64decode(model.image_png))), f"A{model.image_row}")


def build_workbook(model: "WorkbookModel") -> bytes:
    """시트 모델을 .xlsx 바이트로 — 순수 계산이라 이벤트 루프 밖 스레드에서 부른다."""
    workbook = Workbook()
    workbook.remove(workbook.active)
    for sheet in model.sheets:
        _write_sheet(workbook.create_sheet(sheet.name), sheet)
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
