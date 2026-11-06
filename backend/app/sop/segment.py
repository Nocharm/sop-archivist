"""규칙 쪼개기 — 빈 글자 판정·문장 경계·언어 판정·블록 → 단위 초안·한/영 연달아 짝 제안(DB를 모르는 순수 함수)."""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Literal

from app.sop.constants import MAX_PAIR_SIDE

# 공백 외에 "빈 글자"로 보는 보이지 않는 글자 — ZWSP·ZWNJ·ZWJ·WORD JOINER·BOM(ZWNBSP)
INVISIBLE_CHARS = "\u200b\u200c\u200d\u2060\ufeff"
REPLACEMENT_CHAR = "\N{REPLACEMENT CHARACTER}"
# Postgres text에 못 넣는 글자 — NUL, 그리고 UTF-8로 인코딩되지 않아 드라이버 오류 메시지에 글이 통째로 실리는 짝 없는 서로게이트
_UNSTORABLE_RE = re.compile("[\x00\ud800-\udfff]")
SENTENCE_TERMINATORS = ".!?。"
# 문장 끝 뒤에 붙어 있으면 앞 문장에 넣는 닫는 따옴표·괄호
SENTENCE_CLOSERS = "\"'”’)]"
# 마침표 앞 토큰이 이것이고(대소문자 무시) 다음 글자가 소문자 라틴·숫자면 자르지 않는다 — "e.g. a", "No. 5", "Rev. 2"
ABBREVIATIONS = (
    "e.g", "i.e", "etc", "no", "nos", "fig", "figs", "vol", "approx", "dr", "mr", "ms", "vs", "eq", "ref", "cf",
    "ca", "sec", "min", "rev", "ver",
)
# 블록 첫 토큰인 목록 번호 "1." "5.1." — 그 마침표는 문장 끝이 아니다(번호에 이어 마침표가 오는 자리를 찾는다)
_LIST_NUMBER_RE = re.compile(r"\d+(?:\.\d+)*(?=\.)")
# 한글 음절 / (한글 음절 + 라틴 글자)가 이 이상이면 ko — 한글 문장 안의 rpm·START 같은 영어 낱말을 견딘다
KO_RATIO_THRESHOLD = 0.2
# docx_reader.FLAG_CLAUSE_NUMBER와 같은 값 — 추출기가 이 모듈을 import하므로 거꾸로 import하지 않는다(테스트가 같음을 지킨다)
CLAUSE_NUMBER_FLAG = "clause_number"
NEUTRAL = "neutral"


def replace_unstorable_chars(text: str) -> str:
    """추출 글자를 DB에 담을 수 있게 한다 — 지우면 글자 위치가 밀려 같은 길이의 대체 문자로 바꾼다."""
    return _UNSTORABLE_RE.sub(REPLACEMENT_CHAR, text)


def is_blank_char(ch: str) -> bool:
    """빈 글자 판정 하나 — 쪼개기·커버리지 검사·MarkItDown 누락 대조·추출기가 모두 이것을 쓴다."""
    return ch.isspace() or ch in INVISIBLE_CHARS


def has_visible_char(text: str) -> bool:
    return not all(map(is_blank_char, text))


def trim_blank_range(text: str, start: int, end: int) -> tuple[int, int] | None:
    """[start, end)에서 앞뒤 빈 글자를 뺀 범위 — 빈 글자뿐이면 None."""
    while start < end and is_blank_char(text[start]):
        start += 1
    while end > start and is_blank_char(text[end - 1]):
        end -= 1
    return (start, end) if start < end else None


def _is_lower_latin(ch: str) -> bool:
    return "a" <= ch <= "z"


def _is_latin_letter(ch: str) -> bool:
    return "a" <= ch <= "z" or "A" <= ch <= "Z"


def _read_token_before(text: str, end: int) -> str:
    """end 바로 앞의 라틴 토큰 — 글자 사이 마침표까지 넣는다("e.g", "Fig", "J")."""
    start = end
    while start > 0:
        ch = text[start - 1]
        if _is_latin_letter(ch) or (ch == "." and start < end and start > 1 and _is_latin_letter(text[start - 2])):
            start -= 1
        else:
            break
    return text[start:end]


def _is_sentence_end(text: str, terminator: int, after: int) -> bool:
    """terminator 자리의 문장 끝 글자(와 닫는 글자들, after 앞까지) 뒤에서 자를지 — 예외 규칙은 설계 §7.4."""
    position = after
    while position < len(text) and is_blank_char(text[position]):
        position += 1
    if position == len(text):
        return True
    following = text[position]
    if _is_lower_latin(following):
        return False
    if text[terminator] == ".":
        token = _read_token_before(text, terminator)
        if token.lower() in ABBREVIATIONS and "0" <= following <= "9":
            return False
        # 이니셜 — 마침표로 나눈 마지막 조각이 대문자 한 글자("J. Smith", "J.R. Smith", "U.S. FDA")
        initial = token.rsplit(".", 1)[-1]
        if len(initial) == 1 and "A" <= initial <= "Z":
            return False
    return True


def _find_list_number_dot(text: str) -> int:
    """블록 첫 토큰이 목록 번호("1." "5.1.")면 번호 뒤 마침표 자리, 아니면 -1 — 블록마다 한 번만 본다."""
    first = 0
    while first < len(text) and is_blank_char(text[first]):
        first += 1
    number = _LIST_NUMBER_RE.match(text, first)
    return -1 if number is None else number.end()


def split_sentences(text: str) -> list[tuple[int, int]]:
    """문장 범위 목록 — 범위는 앞뒤 빈 글자를 빼고, 빈 글자 아닌 글자를 빠짐없이 덮는다. 줄바꿈만으로는 자르지 않는다."""
    ranges: list[tuple[int, int]] = []
    start = 0
    index = 0
    length = len(text)
    list_number_dot = _find_list_number_dot(text)
    while index < length:
        if text[index] not in SENTENCE_TERMINATORS:
            index += 1
            continue
        after = index
        while after < length and text[after] in SENTENCE_TERMINATORS:
            after += 1
        while after < length and text[after] in SENTENCE_CLOSERS:
            after += 1
        # 문장 끝 글자 뒤에 빈 글자가 오거나 글이 끝날 때만 경계 후보다 — "3.5", "SOP-QC.01"은 후보가 아니다
        is_candidate = after == length or is_blank_char(text[after])
        if is_candidate and index != list_number_dot and _is_sentence_end(text, index, after):
            _append_trimmed(ranges, text, start, after)
            start = after
        index = after
    _append_trimmed(ranges, text, start, length)
    return ranges


def _append_trimmed(ranges: list[tuple[int, int]], text: str, start: int, end: int) -> None:
    trimmed = trim_blank_range(text, start, end)
    if trimmed is not None:
        ranges.append(trimmed)


def detect_language(text: str) -> Literal["ko", "en"] | None:
    """한글 음절 수 h, 라틴(ASCII) 글자 수 l로 정한다 — 둘 다 0(숫자·기호뿐)이면 None, h/(h+l) ≥ 0.2면 ko, 아니면 en."""
    hangul = latin = 0
    for ch in text:
        if "가" <= ch <= "힣":
            hangul += 1
        elif _is_latin_letter(ch):
            latin += 1
    if hangul + latin == 0:
        return None
    return "ko" if hangul / (hangul + latin) >= KO_RATIO_THRESHOLD else "en"


@dataclass(frozen=True)
class BlockView:
    """쪼개기가 읽는 블록 칸 — seq 순서로 넘긴다."""

    id: int
    seq: int
    kind: str
    part: str
    text: str
    heading_level: int | None
    flags: Sequence[str]
    table_id: int | None
    row_index: int | None


@dataclass(frozen=True)
class TableView:
    id: int
    is_layout: bool


@dataclass(frozen=True)
class UnitDraft:
    """만들 단위 하나 — spans는 (블록 id, 시작, 끝), group_index는 묶일 표 초안의 목록 번호.

    pos_seq·pos_start는 정렬 키(units.pos_seq·pos_start)다 — 범위가 없는 표·캡션 없는 그림도 자리를 가져야 해서 따로 싣는다.
    """

    kind: str
    spans: list[tuple[int, int, int]]
    lang: str
    table_id: int | None
    row_index: int | None
    group_index: int | None
    pos_seq: int
    pos_start: int


def build_unit_drafts(blocks: Sequence[BlockView], tables: Sequence[TableView], layout: str) -> list[UnitDraft]:
    """블록(seq 순) → 단위 초안(정렬 키 순). 규칙은 설계 §6.4·§7.4, 데이터 규칙은 공용 계약.

    - 문단: 제목 스타일이나 조항 번호만 있는 줄은 블록 전체가 제목 하나, 아니면 문장마다. 머리말·각주 등도 같은 규칙.
    - 표 칸: 데이터 표는 표마다 첫 칸 자리에 표 단위(범위 없음·중립)를 두고 칸 문장을 묶는다. 레이아웃 표는 묶지 않는다.
      병합 칸(merged_cell)도 보통 칸이다.
    - 그림: 캡션 글자를 범위로 갖는 중립 단위 하나. 칸 안 그림도 표에 묶지 않는 독립 단위다.
    """
    layout_table_ids = {table.id for table in tables if table.is_layout}
    drafts: list[UnitDraft] = []
    table_draft_index: dict[int, int] = {}
    for block in blocks:
        if block.kind == "figure":
            caption = trim_blank_range(block.text, 0, len(block.text))
            spans = [] if caption is None else [(block.id, *caption)]
            pos_start = 0 if caption is None else caption[0]
            drafts.append(UnitDraft("figure", spans, NEUTRAL, None, None, None, block.seq, pos_start))
        elif block.kind == "table_cell":
            group_index = None
            if block.table_id is not None and block.table_id not in layout_table_ids:
                group_index = table_draft_index.get(block.table_id)
                if group_index is None:
                    group_index = table_draft_index[block.table_id] = len(drafts)
                    drafts.append(UnitDraft("table", [], NEUTRAL, block.table_id, None, None, block.seq, -1))
            drafts.extend(
                _build_text_draft("cell_sentence", block, start, end, block.table_id, block.row_index, group_index)
                for start, end in split_sentences(block.text)
            )
        elif block.heading_level is not None or CLAUSE_NUMBER_FLAG in block.flags:
            heading = trim_blank_range(block.text, 0, len(block.text))
            if heading is not None:
                drafts.append(_build_text_draft("heading", block, *heading))
        else:
            drafts.extend(_build_text_draft("sentence", block, start, end) for start, end in split_sentences(block.text))
    return _fill_languages(drafts, layout)


def _build_text_draft(
    kind: str,
    block: BlockView,
    start: int,
    end: int,
    table_id: int | None = None,
    row_index: int | None = None,
    group_index: int | None = None,
) -> UnitDraft:
    # 언어는 detect_language 결과(None이면 빈 칸)로 두고 _fill_languages가 이웃·배치로 채운다
    lang = detect_language(block.text[start:end]) or ""
    return UnitDraft(kind, [(block.id, start, end)], lang, table_id, row_index, group_index, block.seq, start)


def _fill_languages(drafts: list[UnitDraft], layout: str) -> list[UnitDraft]:
    """언어를 모르는 단위는 앞 단위의 언어, 앞에 없으면 뒤 단위, 둘 다 없으면 배치 기본값(en_only → en, 나머지 → ko)."""
    known = [draft.lang for draft in drafts if draft.lang not in ("", NEUTRAL)]
    previous = known[0] if known else ("en" if layout == "en_only" else "ko")
    filled = []
    for draft in drafts:
        if draft.lang == "":
            draft = replace(draft, lang=previous)
        elif draft.lang != NEUTRAL:
            previous = draft.lang
        filled.append(draft)
    return filled


def build_unit_text(spans: Sequence[Sequence[int]], block_texts: Mapping[int, str]) -> str:
    """단위 글자 = 범위 글자를 이은 것 — 같은 블록끼리는 " ", 다른 블록끼리는 "\\n"으로 잇는다."""
    pieces: list[str] = []
    previous_block: int | None = None
    for block_id, start, end in spans:
        if pieces:
            pieces.append(" " if block_id == previous_block else "\n")
        pieces.append(block_texts[block_id][start:end])
        previous_block = block_id
    return "".join(pieces)


def suggest_interleaved_pairs(units: Sequence[tuple[int, str]]) -> list[tuple[list[int], list[int]]]:
    """(단위 id, 언어) 순서 목록 → 코드 짝 제안 [(한글 단위들, 영어 단위들)]. 중립을 건너뛰고 같은 언어가 이어진 덩어리를 만든다.

    한/영 연달아는 한글이 먼저다 — 왼쪽부터 한글 덩어리 바로 뒤에 영어 덩어리가 오면 둘을 잇고 그 뒤로 넘어가고, 아니면 그 덩어리
    하나만 건너뛴다(앞머리의 영어 회사명·제목 줄 하나가 문서 전체 짝을 한 칸씩 밀지 않게). 어느 쪽이든 MAX_PAIR_SIDE를 넘으면
    그 두 덩어리는 짝 없이 넘어간다. 머리말·본문처럼 부분이 다른 단위는 부르는 쪽이 나눠 넘긴다.
    """
    runs: list[tuple[str, list[int]]] = []
    for unit_id, lang in units:
        if lang == NEUTRAL:
            continue
        if runs and runs[-1][0] == lang:
            runs[-1][1].append(unit_id)
        else:
            runs.append((lang, [unit_id]))
    pairs = []
    index = 0
    while index < len(runs):
        lang, korean = runs[index]
        if lang == "ko" and index + 1 < len(runs) and runs[index + 1][0] == "en":
            english = runs[index + 1][1]
            if len(korean) <= MAX_PAIR_SIDE and len(english) <= MAX_PAIR_SIDE:
                pairs.append((korean, english))
            index += 2
        else:
            index += 1
    return pairs
