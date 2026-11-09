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

_CODE_RE = re.compile(
    r"(?:Doc(?:ument)?\.?\s*No\.?|문서\s*번호|SOP\s*No\.?)\s*[:：]?\s*([A-Z]{2,5}(?:-[A-Z0-9]{2,10}){1,3})",
    re.IGNORECASE,
)
_VERSION_RE = re.compile(r"(?:Version|Ver\.|Rev(?:ision)?\.?|버전|개정\s*번호)\s*[:：]?\s*(\d{1,3}(?:\.\d{1,3})?)(?![\d.])", re.IGNORECASE)


@dataclass(frozen=True)
class HeaderFields:
    doc_code: str | None
    version: str | None


def _list_candidates(blocks: Sequence[ExtractedBlock]) -> list[str]:
    headers = [block.text for block in blocks if block.part == "header"]
    body = [block.text for block in blocks if block.part == "body"][:FIRST_BODY_BLOCKS]
    return headers + body


def detect_header_fields(blocks: Sequence[ExtractedBlock]) -> HeaderFields:
    """머리글 전부와 본문 앞 블록에서 첫 일치만 읽는다. 없으면 None."""
    code: str | None = None
    version: str | None = None
    for text in _list_candidates(blocks):
        if code is None and (match := _CODE_RE.search(text)):
            code = match.group(1).upper()
        if version is None and (match := _VERSION_RE.search(text)):
            version = match.group(1)
        if code is not None and version is not None:
            break
    return HeaderFields(doc_code=code, version=version)


def detect_language_layout(blocks: Sequence[ExtractedBlock]) -> str:
    """본문 문단(표 칸 제외)의 언어 순서로 정한다 — 한쪽만이면 *_only, 자주 바뀌면 교차, 아니면 분리."""
    langs = [
        lang
        for block in blocks
        if block.part == "body" and block.kind == "paragraph" and block.table_index is None
        if (lang := detect_language(block.text)) is not None
    ]
    if not langs:
        return DEFAULT_LAYOUT
    # 한쪽 언어 문단뿐인데 표 칸에 두 언어가 다 있으면 KO|EN 레이아웃 표 문서다 — 기본(연달아)으로 두어 표의 코드 짝을 지킨다
    cell_langs = {
        lang
        for block in blocks
        if block.part == "body" and block.kind == "table_cell"
        if (lang := detect_language(block.text)) is not None
    }
    if len(set(langs)) == 1 and cell_langs == {"ko", "en"}:
        return DEFAULT_LAYOUT
    if "ko" not in langs:
        return "en_only"
    if "en" not in langs:
        return "ko_only"
    changes = sum(1 for before, after in zip(langs, langs[1:], strict=False) if before != after)
    layout = "ko_en_interleaved" if changes / (len(langs) - 1) >= INTERLEAVED_CHANGE_RATIO else "ko_en_separate"
    assert layout in LANGUAGE_LAYOUTS
    return layout
