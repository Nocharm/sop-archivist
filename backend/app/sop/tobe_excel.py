"""To-Be 목록 Excel — 템플릿 만들기와 가져오기 파일 읽기(저장된 값만 읽고 수식은 무시한다)."""

import zipfile
from dataclasses import dataclass
from io import BytesIO
from typing import NoReturn
from xml.etree.ElementTree import ParseError

from openpyxl import Workbook, load_workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.utils.exceptions import InvalidFileException
from openpyxl.worksheet.worksheet import Worksheet
from pydantic import ValidationError

from app.sop.errors import raise_rule
from app.sop.tobe import MAX_TOBE_ROWS, NaSlotIn, TargetDocIn, ToBeOut, WiStepIn

DOC_SHEET = "새 문서"
STEP_SHEET = "WI 단계"
DOC_HEADER = ("문서 번호", "제목", "종류", "부모 SOP 번호", "장비 SOP 여부")
STEP_HEADER = ("WI 번호", "단계 번호", "단계 제목")
# 입력 모델 필드 → 머리 칸. 길이·범위 규칙은 모델이 정하고 파일 오류는 이 칸 이름으로 알린다
DOC_COLUMNS = {"code": "문서 번호", "title": "제목", "parent_code": "부모 SOP 번호"}
STEP_COLUMNS = {"code": "WI 번호", "step_no": "단계 번호", "title": "단계 제목"}

MAX_FILE_BYTES = 5 * 1024 * 1024
# 압축을 푼 크기 상한 — 작게 압축된 거대한 시트로 서버가 오래 붙들리지 않게(zip 헤더에 적힌 크기 기준)
MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
# 행 상한을 넘는 뒤쪽 줄이 비어 있는지 볼 최대 범위 — 이보다 멀리 줄이 있으면 확인하지 않고 거절한다
MAX_SCAN_ROWS = 10 * MAX_TOBE_ROWS
# XML 1.0에 못 쓰는 제어 문자(\x0b 등)를 바꿀 글자 — 그대로 두면 저장이 실패한다
REPLACEMENT_CHAR = "\N{REPLACEMENT CHARACTER}"
TRUE_TEXTS = frozenset({"Y", "예", "TRUE", "1"})
FALSE_TEXTS = frozenset({"", "N", "아니오", "FALSE", "0"})


@dataclass
class ParsedWorkbook:
    """읽은 템플릿. N/A는 파일에 없으므로 None(저장이 N/A를 건드리지 않는다)."""

    docs: list[TargetDocIn]
    wi_steps: list[WiStepIn]
    na_slots: list[NaSlotIn] | None = None


# --- 템플릿 ---


def build_tobe_template(tobe: ToBeOut) -> bytes:
    """현재 assign 목록으로 채운 템플릿 — 그대로 다시 가져오면 같은 목록이 된다(match 문서는 파일 업로드가 관리해 싣지 않는다)."""
    workbook = Workbook()
    doc_sheet = workbook.active
    doc_sheet.title = DOC_SHEET
    doc_sheet.append(DOC_HEADER)
    step_sheet = workbook.create_sheet(STEP_SHEET)
    step_sheet.append(STEP_HEADER)

    assign_codes = {doc.code for doc in tobe.docs if doc.entrance == "assign"}
    for doc in tobe.docs:
        if doc.code in assign_codes:
            _append_row(doc_sheet, [
                doc.code, doc.title, doc.doc_type.upper(), doc.parent_code, "Y" if doc.is_equipment_sop else "N"
            ])
    for step in tobe.wi_steps:
        if step.code in assign_codes:
            _append_row(step_sheet, [step.code, step.step_no, step.title])

    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _append_row(sheet: Worksheet, values: list[object]) -> None:
    """한 줄을 더한다. 빈 글자는 빈 칸으로, XML에 못 쓰는 제어 문자는 대체 문자로 바꾸고 `=`로 시작하는 글은 수식이 아닌 글로 둔다."""
    cleaned = [ILLEGAL_CHARACTERS_RE.sub(REPLACEMENT_CHAR, v) if isinstance(v, str) else v for v in values]
    sheet.append([None if v == "" else v for v in cleaned])
    for cell in sheet[sheet.max_row]:
        if cell.data_type == "f":  # 우리는 수식을 쓰지 않으므로 수식으로 잡힌 칸은 모두 사용자 글이다
            cell.data_type = "s"


# --- 가져오기 ---


def parse_tobe_workbook(data: bytes) -> ParsedWorkbook:
    """업로드한 템플릿을 읽는다. 크기·머리 줄·칸 값이 어긋나면 422 invalid_tobe_file / tobe_file_too_large."""
    if len(data) > MAX_FILE_BYTES:
        raise_rule(422, "tobe_file_too_large")
    _check_archive(data)
    try:
        # 수식은 저장된 값만 읽는다(값이 없으면 빈 칸) — 수식 문자열이 제목 등에 들어가지 않는다
        workbook = load_workbook(BytesIO(data), read_only=True, data_only=True)
        try:
            # read_only라 시트 내용은 여기서 처음 읽혀 깨진 XML·값이 이때 드러난다
            doc_rows = _read_rows(workbook, DOC_SHEET, DOC_HEADER)
            step_rows = _read_rows(workbook, STEP_SHEET, STEP_HEADER)
        finally:
            workbook.close()
    except (KeyError, ParseError, InvalidFileException, ValueError):
        raise_rule(422, "invalid_tobe_file")

    docs = [_parse_doc_row(index, values, order) for order, (index, values) in enumerate(doc_rows)]
    steps = [_parse_step_row(index, values) for index, values in step_rows]
    return ParsedWorkbook(docs=docs, wi_steps=steps)


def _check_archive(data: bytes) -> None:
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            total_size = sum(info.file_size for info in archive.infolist())
    except zipfile.BadZipFile:
        raise_rule(422, "invalid_tobe_file")
    if total_size > MAX_UNCOMPRESSED_BYTES:
        raise_rule(422, "tobe_file_too_large")


def _is_blank(value: object) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _read_rows(workbook: Workbook, sheet_name: str, header: tuple[str, ...]) -> list[tuple[int, tuple]]:
    """머리 줄을 확인하고 값이 있는 줄만 (엑셀 줄 번호, 값들)로 돌려준다. 읽는 칸은 머리 칸 수까지다."""
    if sheet_name not in workbook.sheetnames:
        raise_rule(422, "invalid_tobe_file", sheet=sheet_name)
    rows: list[tuple[int, tuple]] = []
    has_header = False
    sheet_rows = workbook[sheet_name].iter_rows(max_col=len(header), max_row=MAX_SCAN_ROWS + 1, values_only=True)
    for index, values in enumerate(sheet_rows, start=1):
        if index > MAX_SCAN_ROWS:
            raise_rule(422, "tobe_file_too_large")
        if index == 1:
            has_header = True
            if tuple("" if _is_blank(v) else str(v).strip() for v in values) != header:
                raise_rule(422, "invalid_tobe_file", sheet=sheet_name)
        elif not all(_is_blank(v) for v in values):
            if index > MAX_TOBE_ROWS + 1:  # 머리 줄 다음부터 MAX_TOBE_ROWS줄까지
                raise_rule(422, "tobe_file_too_large")
            rows.append((index, values))
    if not has_header:
        raise_rule(422, "invalid_tobe_file", sheet=sheet_name)
    return rows


def _read_text(value: object) -> str | None:
    """칸 값을 글자로 — 숫자 칸의 정수는 소수점 없이(문서 번호 1001). 날짜 같은 지원 밖 형식은 None."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else str(value)
    return None


def _read_step_no(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    if isinstance(value, str):
        text = value.strip()
        return int(text) if text.isascii() and text.isdecimal() else None
    return None


def _raise_bad_cell(sheet: str, row: int, column: str) -> NoReturn:
    raise_rule(422, "invalid_tobe_file", sheet=sheet, row=row, column=column)


def _parse_doc_row(index: int, values: tuple, order: int) -> TargetDocIn:
    code, title, type_text, parent, equipment = (_read_text(value) for value in values)
    for text, column in zip((code, title, type_text, parent, equipment), DOC_HEADER, strict=True):
        if text is None:
            _raise_bad_cell(DOC_SHEET, index, column)
    if type_text.upper() not in ("SOP", "WI"):
        _raise_bad_cell(DOC_SHEET, index, "종류")
    if equipment.upper() not in TRUE_TEXTS | FALSE_TEXTS:
        _raise_bad_cell(DOC_SHEET, index, "장비 SOP 여부")
    try:
        return TargetDocIn(
            code=code, title=title, doc_type=type_text.lower(), parent_code=parent,
            is_equipment_sop=equipment.upper() in TRUE_TEXTS, order_index=order,
        )
    except ValidationError as error:
        _raise_bad_cell(DOC_SHEET, index, DOC_COLUMNS.get(str(error.errors()[0]["loc"][0]), ""))


def _parse_step_row(index: int, values: tuple) -> WiStepIn:
    code, title = _read_text(values[0]), _read_text(values[2])
    if code is None:
        _raise_bad_cell(STEP_SHEET, index, "WI 번호")
    if title is None:
        _raise_bad_cell(STEP_SHEET, index, "단계 제목")
    step_no = _read_step_no(values[1])
    if step_no is None:
        _raise_bad_cell(STEP_SHEET, index, "단계 번호")
    try:
        return WiStepIn(code=code, step_no=step_no, title=title)
    except ValidationError as error:
        _raise_bad_cell(STEP_SHEET, index, STEP_COLUMNS.get(str(error.errors()[0]["loc"][0]), ""))
