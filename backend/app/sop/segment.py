"""규칙 쪼개기 — 빈 글자 판정·문장 경계·언어 판정·블록 → 단위 초안·한/영 연달아 짝 제안(DB를 모르는 순수 함수)."""

import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Literal

from app.sop.constants import MAX_PAIR_SIDE

# 공백 외에 "빈 글자"로 보는 보이지 않는 글자 — ZWSP·ZWNJ·ZWJ·WORD JOINER·BOM(ZWNBSP)
INVISIBLE_CHARS = "\u200b\u200c\u200d\u2060\ufeff"
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
# 줄 첫 토큰인 목록 번호 "1." "5.1." "a." "iv." "가." "ㄱ." — 그 마침표는 문장 끝이 아니다(번호에 이어 마침표가 오는 자리를 찾는다).
# 추출기가 Word 자동 번호를 글 앞에 써 넣으므로(docx_reader) 숫자 말고 글자·로마 숫자·가나다 번호도 본다.
_LIST_NUMBER_RE = re.compile(r"(?:\d+(?:\.\d+)*|[A-Za-z]|[ivx]{2,5}|[IVX]{2,5}|[가나다라마바사아자차카타파하ㄱ-ㅎ])(?=\.)")
# 짝 가드 — 문장 머리의 숫자 번호("1." "5.1" "(2)" "3)")와 문장 안의 숫자 토큰("30", "2.5", "1,000")
_PAIR_LABEL_RE = re.compile(r"\(?(\d+(?:\.\d+)*)[.)]?(?=\s|$)")
_DIGIT_TOKEN_RE = re.compile(r"\d+(?:[.,]\d+)*")
# 아래 짝 가드 값은 모두 합성 SOP로만 잡았다(실제 SOP 시험 뒤 다시 정한다). 헷갈리면 짝을 만들지 않는 쪽으로 둔다 —
# 틀린 짝은 사람이 풀어야 하지만 빠진 짝은 쪼개기 화면에서 바로 이을 수 있다.
# 영어 글자 수 / 한글 쪽 글자 수(빈 글자 제외)의 허용 범위 — 한글 한 글자가 영어 두세 글자쯤이라 번역 짝은 대개 1.5~3이다
PAIR_LENGTH_RATIO_MIN = 0.6
PAIR_LENGTH_RATIO_MAX = 4.5
# 한글 쪽이 이보다 짧으면 길이 비율을 보지 않는다 — "책임"/"Responsibilities"처럼 짧은 제목은 비율이 크게 튄다
PAIR_RATIO_MIN_CHARS = 10
# 두 쪽 모두 숫자 토큰이 있을 때 겹치는 토큰 수 / 더 많은 쪽 토큰 수의 하한 — "2024년 1월"/"January 2024"는 통과한다
PAIR_DIGIT_OVERLAP_MIN = 0.5
# docx_reader.FLAG_CLAUSE_NUMBER와 같은 값 — 추출기가 이 모듈을 import하므로 거꾸로 import하지 않는다(테스트가 같음을 지킨다)
CLAUSE_NUMBER_FLAG = "clause_number"
NEUTRAL = "neutral"


def has_unstorable_char(text: str) -> bool:
    """DB에 담지 못하는 글자(NUL·짝 없는 서로게이트)가 있는가 — 입력 경계·파일 이름 검사가 AI 응답 정리(replace)와 같은 판정을 쓴다."""
    return _UNSTORABLE_RE.search(text) is not None


def replace_unstorable_chars(text: str) -> str:
    """추출 글자를 DB에 담을 수 있게 한다 — 지우면 글자 위치가 밀려 같은 길이의 대체 문자로 바꾼다."""
    return _UNSTORABLE_RE.sub("\N{REPLACEMENT CHARACTER}", text)


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


def _find_list_number_dot(text: str, line_start: int) -> int:
    """line_start에서 시작하는 줄의 첫 토큰이 목록 번호("1." "5.1." "가.")면 번호 뒤 마침표 자리, 아니면 -1."""
    first = line_start
    while first < len(text) and text[first] != "\n" and is_blank_char(text[first]):
        first += 1
    number = _LIST_NUMBER_RE.match(text, first)
    return -1 if number is None else number.end()


def split_sentences(text: str, *, split_lines: bool = False) -> list[tuple[int, int]]:
    """문장 범위 목록 — 범위는 앞뒤 빈 글자를 빼고, 빈 글자 아닌 글자를 빠짐없이 덮는다.

    split_lines면 줄바꿈("\\n")에서도 자른다 — DOCX의 줄바꿈(Shift+Enter)·칸 안 문단은 글쓴이가 넣은 경계다. PDF 블록의
    줄바꿈은 화면 폭에 따라 접힌 줄이라 자르지 않는다(기본값). 목록 번호는 어느 쪽이든 줄마다 첫 토큰을 본다.
    """
    ranges: list[tuple[int, int]] = []
    start = 0
    index = 0
    length = len(text)
    list_number_dot = _find_list_number_dot(text, 0)
    while index < length:
        if text[index] == "\n":
            if split_lines:
                _append_trimmed(ranges, text, start, index)
                start = index + 1
            index += 1
            list_number_dot = _find_list_number_dot(text, index)
            continue
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
    """한글 음절이 하나라도 있으면 ko, 없고 라틴(ASCII) 글자가 있으면 en, 둘 다 없으면(숫자·기호뿐) None.

    영어 문장에는 한글이 섞이지 않지만 한글 문장에는 장비 이름·약어 같은 영어 낱말이 얼마든지 섞인다 — 비율로 재면 영어 낱말이
    많은 한글 문장이 en으로 넘어간다.
    """
    has_latin = False
    for ch in text:
        if "가" <= ch <= "힣":
            return "ko"
        has_latin = has_latin or _is_latin_letter(ch)
    return "en" if has_latin else None


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


def build_unit_drafts(
    blocks: Sequence[BlockView], tables: Sequence[TableView], layout: str, *, split_lines: bool = False
) -> list[UnitDraft]:
    """블록(seq 순) → 단위 초안(정렬 키 순). 규칙은 설계 §6.4·§7.4, 데이터 규칙은 공용 계약.

    split_lines(DOCX)면 블록 안 줄바꿈에서도 단위를 나눈다 — 블록은 그대로 하나라, 합치면 줄바꿈을 품은 한 범위로 돌아간다.
    - 문단: 제목 스타일이나 조항 번호만 있는 줄은 블록 전체가 제목(split_lines면 줄마다 제목 — "목적"/"Purpose" 두 줄 제목이
      언어별로 나뉜다), 아니면 문장마다. 머리말·각주 등도 같은 규칙.
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
                for start, end in split_sentences(block.text, split_lines=split_lines)
            )
        elif block.heading_level is not None or CLAUSE_NUMBER_FLAG in block.flags:
            drafts.extend(
                _build_text_draft("heading", block, start, end) for start, end in _split_heading(block.text, split_lines)
            )
        else:
            drafts.extend(
                _build_text_draft("sentence", block, start, end)
                for start, end in split_sentences(block.text, split_lines=split_lines)
            )
    return _fill_languages(drafts, layout)


def _split_heading(text: str, split_lines: bool) -> list[tuple[int, int]]:
    """제목 블록의 단위 범위 — 문장으로는 나누지 않고, split_lines일 때만 줄마다 나눈다."""
    ranges: list[tuple[int, int]] = []
    start = 0
    if split_lines:
        while (line_end := text.find("\n", start)) >= 0:
            _append_trimmed(ranges, text, start, line_end)
            start = line_end + 1
    _append_trimmed(ranges, text, start, len(text))
    return ranges


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


def suggest_interleaved_pairs(units: Sequence[tuple[int, str, str]]) -> list[tuple[list[int], list[int]]]:
    """(단위 id, 언어, 글) 순서 목록 → 코드 짝 제안 [(한글 단위들, 영어 단위들)]. 중립을 건너뛰고 같은 언어가 이어진 덩어리를 만든다.

    한/영 연달아는 한글이 먼저다 — 왼쪽부터 한글 덩어리 바로 뒤에 영어 덩어리가 오고 둘이 번역 짝으로 보이면(_is_likely_pair)
    둘을 잇고 그 뒤로 넘어가고, 아니면 그 덩어리 하나만 건너뛴다(앞머리의 영어 회사명·제목 줄 하나가 문서 전체 짝을 한 칸씩 밀지 않게).
    어느 쪽이든 MAX_PAIR_SIDE를 넘으면 그 두 덩어리는 짝 없이 넘어간다. 머리말·본문처럼 부분이 다른 단위는 부르는 쪽이 나눠 넘긴다.
    """
    runs: list[tuple[str, list[int], list[str]]] = []
    for unit_id, lang, text in units:
        if lang == NEUTRAL:
            continue
        if runs and runs[-1][0] == lang:
            runs[-1][1].append(unit_id)
            runs[-1][2].append(text)
        else:
            runs.append((lang, [unit_id], [text]))
    pairs = []
    index = 0
    while index < len(runs):
        lang, korean, korean_texts = runs[index]
        if lang == "ko" and index + 1 < len(runs) and runs[index + 1][0] == "en":
            _, english, english_texts = runs[index + 1]
            if len(korean) > MAX_PAIR_SIDE or len(english) > MAX_PAIR_SIDE:
                index += 2
                continue
            if _is_likely_pair(korean_texts, english_texts):
                pairs.append((korean, english))
                index += 2
                continue
        index += 1
    return pairs


def _is_likely_pair(korean: Sequence[str], english: Sequence[str]) -> bool:
    """한글 덩어리와 영어 덩어리가 서로의 번역으로 보이는가 — 번역해도 그대로인 것(번호·숫자)과 길이만 본다.

    - 두 쪽 모두 머리에 숫자 번호가 있으면 같아야 한다("5.1 …" 뒤의 "5.2 …"는 번역이 아니라 다음 항목이다).
    - 번호를 뺀 숫자 토큰: 한쪽에만 있으면 짝이 아니고, 두 쪽에 있으면 PAIR_DIGIT_OVERLAP_MIN 이상 겹쳐야 한다.
    - 한글 쪽이 PAIR_RATIO_MIN_CHARS 이상이면 글자 수 비율이 범위 안이어야 한다.
    - 문장 수가 다른 덩어리(1:2, 2:1 …)는 번역이 빠진 문장이 끼었을 수 있다 — 번호가 같거나 숫자 토큰이 완전히 같을 때만 잇는다.
    """
    korean_label, korean_body = _strip_pair_label(korean[0])
    english_label, english_body = _strip_pair_label(english[0])
    has_same_label = korean_label is not None and korean_label == english_label
    if korean_label is not None and english_label is not None and not has_same_label:
        return False
    korean_digits = _count_digit_tokens([korean_body, *korean[1:]])
    english_digits = _count_digit_tokens([english_body, *english[1:]])
    if bool(korean_digits) != bool(english_digits):
        return False
    if korean_digits:
        shared = sum(min(count, english_digits[token]) for token, count in korean_digits.items())
        if shared / max(sum(korean_digits.values()), sum(english_digits.values())) < PAIR_DIGIT_OVERLAP_MIN:
            return False
    korean_chars = sum(_count_visible_chars(text) for text in korean)
    if korean_chars >= PAIR_RATIO_MIN_CHARS:
        ratio = sum(_count_visible_chars(text) for text in english) / korean_chars
        if not PAIR_LENGTH_RATIO_MIN <= ratio <= PAIR_LENGTH_RATIO_MAX:
            return False
    if len(korean) != len(english):
        return has_same_label or (bool(korean_digits) and korean_digits == english_digits)
    return True


def _strip_pair_label(text: str) -> tuple[str | None, str]:
    """문장 머리의 숫자 번호와 그 뒤 글 — 번호가 없으면 (None, 글 그대로)."""
    match = _PAIR_LABEL_RE.match(text.lstrip())
    if match is None:
        return None, text
    return match.group(1), text.lstrip()[match.end():]


def _count_digit_tokens(texts: Sequence[str]) -> Counter[str]:
    """숫자 토큰별 개수 — 자릿수 쉼표는 지워 "1,000"과 "1000"을 같게 본다."""
    return Counter(token.replace(",", "") for text in texts for token in _DIGIT_TOKEN_RE.findall(text))


def _count_visible_chars(text: str) -> int:
    return sum(1 for ch in text if not is_blank_char(ch))
