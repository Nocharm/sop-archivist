"""새 문서 목록 AI 읽기의 입력 — 사람이 올린 계획 파일(Excel·Word·글)이나 붙여 넣은 글에서 AI에 보낼 글을 뽑는다.

이 파일은 SOP 문서가 아니다: 저장하지 않고, 뽑은 글만 작업에 실었다가 읽은 뒤 비운다. Excel은 시트의 행마다 한 줄(칸은 " | "),
Word는 문단마다 한 줄이고 표는 행마다 한 줄이다. 길이 상한을 넘으면 앞부분만 쓰고 잘렸다고 알린다.
"""

import io
import re
import zipfile
from dataclasses import dataclass
from xml.etree import ElementTree

from defusedxml import ElementTree as SafeElementTree
from defusedxml.common import DefusedXmlException
from openpyxl import load_workbook

from app.sop.errors import raise_rule

# 올릴 수 있는 파일 크기 — 계획표는 작다. 큰 파일은 SOP 문서를 잘못 고른 것이기 쉽다
MAX_LIST_FILE_BYTES = 2 * 1024 * 1024
# 풀었을 때의 크기 상한(압축 폭탄 막기) — docx의 본문 XML과 xlsx 전체
_MAX_UNZIPPED_BYTES = 20 * 1024 * 1024
# AI에 보낼 글의 길이 상한 — 넘으면 앞부분만 보낸다(읽은 범위를 사람에게 알린다)
MAX_LIST_CHARS = 20_000
_MAX_ROWS = 2000
_CELL_SEPARATOR = " | "
_WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_SPACES = re.compile(r"[ \t ]+")


@dataclass(frozen=True)
class ListText:
    text: str
    # 상한에 걸려 뒷부분을 버렸다
    truncated: bool


def _clean_line(text: str) -> str:
    return _SPACES.sub(" ", text.replace("\x00", "")).strip()


def cap_text(lines: list[str]) -> ListText:
    """빈 줄을 빼고 상한까지 이어 붙인다 — 줄 중간에서 자르지 않는다(반쪽 번호를 만들지 않게)."""
    kept: list[str] = []
    used = 0
    truncated = False
    for raw in lines:
        line = _clean_line(raw)
        if not line:
            continue
        if used + len(line) + 1 > MAX_LIST_CHARS or len(kept) >= _MAX_ROWS:
            truncated = True
            break
        kept.append(line)
        used += len(line) + 1
    return ListText(text="\n".join(kept), truncated=truncated)


def _check_zip(data: bytes) -> zipfile.ZipFile:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise_rule(422, "list_file_unreadable")
    if sum(info.file_size for info in archive.infolist()) > _MAX_UNZIPPED_BYTES:
        raise_rule(422, "list_file_too_large")
    return archive


def _read_xlsx(data: bytes) -> list[str]:
    _check_zip(data).close()
    try:
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:  # noqa: BLE001 -- openpyxl은 깨진 파일에 여러 예외를 낸다. 어느 것이든 "읽지 못함"이다
        raise_rule(422, "list_file_unreadable")
    lines: list[str] = []
    try:
        for sheet in workbook.worksheets:
            for row in sheet.iter_rows(values_only=True):
                cells = [_clean_line(str(cell)) for cell in row if cell is not None]
                cells = [cell for cell in cells if cell]
                if cells:
                    lines.append(_CELL_SEPARATOR.join(cells))
                if len(lines) > _MAX_ROWS:
                    return lines
    finally:
        workbook.close()
    return lines


def _read_paragraph(node: ElementTree.Element) -> str:
    return "".join(text.text or "" for text in node.iter(f"{_WORD_NS}t"))


def _read_docx(data: bytes) -> list[str]:
    with _check_zip(data) as archive:
        try:
            xml = archive.read("word/document.xml")
        except KeyError:
            raise_rule(422, "list_file_unreadable")
    try:
        root = SafeElementTree.fromstring(xml)  # DTD·외부 엔티티를 받지 않는다(문서 추출과 같은 파서)
    except (ElementTree.ParseError, DefusedXmlException):
        raise_rule(422, "list_file_unreadable")
    body = root.find(f"{_WORD_NS}body")
    lines: list[str] = []
    for node in body if body is not None else []:
        if node.tag == f"{_WORD_NS}p":
            lines.append(_read_paragraph(node))
        elif node.tag == f"{_WORD_NS}tbl":
            for row in node.iter(f"{_WORD_NS}tr"):
                cells = [_clean_line(" ".join(_read_paragraph(p) for p in cell.iter(f"{_WORD_NS}p"))) for cell in row.findall(f"{_WORD_NS}tc")]
                lines.append(_CELL_SEPARATOR.join(cell for cell in cells if cell))
    return lines


def _read_plain(data: bytes) -> list[str]:
    for encoding in ("utf-8-sig", "cp949"):
        try:
            return data.decode(encoding).splitlines()
        except UnicodeDecodeError:
            continue
    raise_rule(422, "list_file_unreadable")


_READERS = {".xlsx": _read_xlsx, ".docx": _read_docx, ".txt": _read_plain, ".csv": _read_plain, ".md": _read_plain}


def read_list_file(file_name: str, data: bytes) -> ListText:
    """올린 파일에서 글을 뽑는다 — 형식은 확장자로 정한다(xlsx·docx·txt·csv·md). 그 밖은 422 list_file_format,
    크기를 넘으면 422 list_file_too_large, 열지 못하면 422 list_file_unreadable, 글이 없으면 422 list_text_empty."""
    if len(data) > MAX_LIST_FILE_BYTES:
        raise_rule(422, "list_file_too_large")
    lowered = file_name.lower()
    reader = next((read for extension, read in _READERS.items() if lowered.endswith(extension)), None)
    if reader is None:
        raise_rule(422, "list_file_format")
    return _ensure_text(cap_text(reader(data)))


def read_list_text(text: str) -> ListText:
    """붙여 넣은 글 — 글이 없으면 422 list_text_empty."""
    return _ensure_text(cap_text(text.splitlines()))


def _ensure_text(result: ListText) -> ListText:
    if not result.text:
        raise_rule(422, "list_text_empty")
    return result
