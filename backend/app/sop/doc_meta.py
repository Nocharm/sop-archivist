"""문서 정보 규칙 탐지 — 업로드 때 비어 있는 문서 번호·버전을 머리글·첫 장에서, 언어 배치를 본문 줄의 한·영 순서에서 읽는다.

순수 함수다(추출 결과만 받는다). 파일 이름에서 읽은 값이 늘 먼저이고, 여기 값은 빈 칸만 채운다(ingest).
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass

from app.sop.constants import LANGUAGE_LAYOUTS
from app.sop.extract.types import ExtractedBlock
from app.sop.segment import detect_language

# 머리글 말고 본문은 앞에서 이만큼만 본다 — 첫 장의 표지·정보 칸에 있는 값만 믿는다
FIRST_BODY_BLOCKS = 40
# 이웃한 본문 줄의 언어가 바뀌는 비율이 이 이상이면 한·영이 번갈아 나오는 문서로 본다(합성 SOP로 잡은 값)
INTERLEAVED_CHANGE_RATIO = 0.6
DEFAULT_LAYOUT = "ko_en_interleaved"
# 표 밖 본문 문단이 이보다 적고 표의 행이 훨씬 많으면 본문이 거의 다 표 안인 문서다 — 문단만 세면 판정할 것이 없어 표의 행도 센다
SPARSE_BODY_PARAGRAPHS = 20
TABLE_HEAVY_ROW_RATIO = 2  # 표의 행 수가 표 밖 문단 수의 이 배를 넘어야 "본문이 거의 다 표 안"이다(합성 자료로 잡은 값)

_CODE_RE = re.compile(
    r"(?:Doc(?:ument)?\.?\s*No\.?|문서\s*번호|SOP\s*No\.?)\s*[:：]?\s*([A-Z]{2,5}(?:-[A-Z0-9]{2,10}){1,3})",
    re.IGNORECASE,
)
_VERSION_RE = re.compile(r"(?:Version|Ver\.|Rev(?:ision)?\.?|버전|개정\s*번호)\s*[:：]?\s*(\d{1,3}(?:\.\d{1,3})?)(?![\d.])", re.IGNORECASE)
# 표지 표는 라벨 칸 바로 아래 칸에 값이 있다 — 칸 글 전체가 라벨일 때만 아래 칸을 읽는다
_CODE_LABEL_RE = re.compile(r"(?:Doc(?:ument)?\.?\s*No\.?|문서\s*번호)\s*[:：]?", re.IGNORECASE)
_VERSION_LABEL_RE = re.compile(r"(?:Version|Ver\.?)\s*[:：]?", re.IGNORECASE)
_RECORD_LABEL_RE = re.compile(r"Record\s*No\.?\s*[:：]?", re.IGNORECASE)
_CODE_VALUE_RE = re.compile(r"[A-Z]{2,5}(?:-[A-Z0-9]{2,10}){1,3}", re.IGNORECASE)
_VERSION_VALUE_RE = re.compile(r"\d{1,3}(?:\.\d{1,3})?")


@dataclass(frozen=True)
class HeaderFields:
    doc_code: str | None
    version: str | None
    record_no: str | None = None  # 변경관리 번호(표지 표의 Record No.) — 읽기만 하고 아직 저장하는 곳은 없다


def _list_candidates(blocks: Sequence[ExtractedBlock]) -> list[ExtractedBlock]:
    headers = [block for block in blocks if block.part == "header"]
    body = [block for block in blocks if block.part == "body"][:FIRST_BODY_BLOCKS]
    return headers + body


def _read_cell_below(block: ExtractedBlock, cells: dict[tuple[int, int], list[ExtractedBlock]]) -> str | None:
    """라벨 칸 바로 아래 행에서 같은 격자 열을 덮는 칸의 글 — 표 칸이 아니거나 그런 칸이 없으면 None."""
    if block.kind != "table_cell" or block.table_index is None or block.row_index is None or block.col_index is None:
        return None
    for below in cells.get((block.table_index, block.row_index + 1), ()):
        if below.col_index is not None and below.col_index <= block.col_index < below.col_index + below.grid_span:
            return below.text.strip()
    return None


def detect_header_fields(blocks: Sequence[ExtractedBlock]) -> HeaderFields:
    """머리글 전부와 본문 앞 블록에서 첫 일치만 읽는다. 없으면 None.

    값은 라벨과 같은 블록("Doc No.: X")에 있거나, 표지 표처럼 라벨 칸 바로 아래 칸에 있다.
    """
    cells: dict[tuple[int, int], list[ExtractedBlock]] = {}
    for block in blocks:
        if block.kind == "table_cell" and block.table_index is not None and block.row_index is not None:
            cells.setdefault((block.table_index, block.row_index), []).append(block)
    code: str | None = None
    version: str | None = None
    record_no: str | None = None
    for block in _list_candidates(blocks):
        label = block.text.strip()
        if code is None and (match := _CODE_RE.search(block.text)):
            code = match.group(1).upper()
        if version is None and (match := _VERSION_RE.search(block.text)):
            version = match.group(1)
        below = _read_cell_below(block, cells)
        if below is None:
            continue
        if code is None and _CODE_LABEL_RE.fullmatch(label) and _CODE_VALUE_RE.fullmatch(below):
            code = below.upper()
        if version is None and _VERSION_LABEL_RE.fullmatch(label) and _VERSION_VALUE_RE.fullmatch(below):
            version = below
        if record_no is None and _RECORD_LABEL_RE.fullmatch(label) and _CODE_VALUE_RE.fullmatch(below):
            record_no = below.upper()
    return HeaderFields(doc_code=code, version=version, record_no=record_no)


def detect_language_layout(blocks: Sequence[ExtractedBlock], *, has_language_halves: bool = False) -> str:
    """본문 문단(표 칸 제외)의 언어 순서로 정한다 — 한쪽만이면 *_only, 자주 바뀌면 교차, 아니면 분리.

    본문이 거의 다 표 안인 문서(표 밖 문단이 적고 표의 행이 훨씬 많다)는 표의 행도 함께 센다. has_language_halves는 추출기가
    읽은 강한 신호(언어 절반 책갈피·스타일)다 — 두 언어가 다 있으면 순서를 세지 않고 분리로 본다.
    """
    paragraphs = [
        block for block in blocks if block.part == "body" and block.kind == "paragraph" and block.table_index is None
    ]
    cells = [block for block in blocks if block.part == "body" and block.kind == "table_cell"]
    n_rows = len({(block.table_index, block.row_index) for block in cells})
    if len(paragraphs) < SPARSE_BODY_PARAGRAPHS and n_rows > TABLE_HEAVY_ROW_RATIO * len(paragraphs):
        langs = _list_languages_with_rows(blocks)
    else:
        langs = [lang for block in paragraphs for lang in _list_line_languages(block.text)]
        # 한쪽 언어 문단뿐인데 표 칸에 두 언어가 다 있으면 KO|EN 레이아웃 표 문서다 — 기본(연달아)으로 두어 표의 코드 짝을 지킨다
        cell_langs = {lang for block in cells for lang in _list_line_languages(block.text)}
        if langs and len(set(langs)) == 1 and cell_langs == {"ko", "en"}:
            return DEFAULT_LAYOUT
    if not langs:
        return DEFAULT_LAYOUT
    if "ko" not in langs:
        return "en_only"
    if "en" not in langs:
        return "ko_only"
    if has_language_halves:
        return "ko_en_separate"
    changes = sum(1 for before, after in zip(langs, langs[1:], strict=False) if before != after)
    layout = "ko_en_interleaved" if changes / (len(langs) - 1) >= INTERLEAVED_CHANGE_RATIO else "ko_en_separate"
    assert layout in LANGUAGE_LAYOUTS
    return layout


def _list_languages_with_rows(blocks: Sequence[ExtractedBlock]) -> list[str]:
    """본문 블록 순서의 언어 — 표 밖 문단은 줄마다, 표는 행마다(_list_row_languages)."""
    row_texts: dict[tuple[int | None, int | None], list[str]] = {}
    order: list[tuple[int | None, int | None] | ExtractedBlock] = []
    for block in blocks:
        if block.part != "body":
            continue
        if block.kind == "paragraph" and block.table_index is None:
            order.append(block)
        elif block.kind == "table_cell":
            key = (block.table_index, block.row_index)
            if key not in row_texts:
                order.append(key)
            row_texts.setdefault(key, []).append(block.text)
    langs: list[str] = []
    for item in order:
        langs.extend(
            _list_line_languages(item.text) if isinstance(item, ExtractedBlock) else _list_row_languages(row_texts[item])
        )
    return langs


def _list_row_languages(cell_texts: Sequence[str]) -> list[str]:
    """표 한 행의 언어 — 칸마다 보고 같은 언어는 한 번만, 칸 순서대로.

    한글 절반의 행에는 영어 라벨·약어 칸("A", "A-1", "pH")이 섞이므로 띄어쓰기 없는 영어 한 낱말 칸은 세지 않는다.
    칸마다 언어가 다른 행(KO|EN 두 열 레이아웃 표)은 두 언어를 다 낸다 — 그런 표가 본문이면 언어가 줄마다 바뀌어 교차가 된다.
    """
    langs: list[str] = []
    for text in cell_texts:
        lang = detect_language(text)
        if lang is None or lang in langs or (lang == "en" and len(text.split()) <= 1):
            continue
        langs.append(lang)
    return langs


def _list_line_languages(text: str) -> list[str]:
    """블록 글의 줄별 언어 — 이어진 같은 언어 줄은 하나로 센다.

    한 문단에 줄바꿈으로 한글 줄과 영어 줄을 함께 쓴 문서는 블록 전체로 보면 늘 ko라(한글이 하나라도 있으면 ko) 줄로 본다.
    같은 언어 줄을 하나로 묶는 것은 PDF의 접힌 줄이 개수를 불리지 않게 하려는 것이다.
    """
    langs: list[str] = []
    for line in text.split("\n"):
        lang = detect_language(line)
        if lang is not None and (not langs or langs[-1] != lang):
            langs.append(lang)
    return langs
