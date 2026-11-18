"""규칙 쪼개기 — 빈 글자 판정·문장 경계·언어 판정·블록 → 단위 초안·한/영 연달아 짝 제안(DB를 모르는 순수 함수)."""

import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Literal

from app.sop.constants import MAX_PAIR_SIDE
from app.sop.noise import NOISE_TOC, find_toc_block_ids

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
# 다음 글자와 상관없이 문장 끝이 아닌 약줄임 — "(e.g. ABC)"처럼 대문자·고유 이름이 바로 뒤에 온다
NEVER_END_ABBREVIATIONS = ("e.g", "i.e")
# 번호 약줄임 "No." "Nos."는 숫자 말고 여는 괄호·따옴표 앞에서도 문장 끝이 아니다 — '"Lot No. (a)"'
NUMBER_ABBREVIATIONS = ("no", "nos")
NUMBER_ABBREVIATION_FOLLOWERS = "(\"'“‘"
# 줄 맨 앞(글머리 기호·목록 번호·여는 따옴표 바로 뒤 포함)의 라벨 낱말 + 선택 번호 + 마침표는 문장 끝이 아니다 —
# "Chapter 1. Filter setup", "Note. Plant X …", "그림. 장비 사진". 줄 가운데의 같은 낱말은 보통 문장 끝일 수 있어 보호하지 않는다.
_LINE_LABEL_RE = re.compile(
    r"(?:(?:[•*\-–●■]|o(?=[ \t]))[ \t]*)?[\"'“‘]?"
    r"(?:Chapter|Appendix|Attachment|Section|Step|Figure|Fig|Table|Notes?|그림|표|참고|주의|예)"
    r"(?:(\.)?[ \t]*\d+(?:[.\-]\d+)*)?(?=\.)",
    re.IGNORECASE,
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
# docx_reader.FLAG_CAPTION_OF와 같은 값 — 캡션 문단 블록이 "caption_of:<그림 블록 seq | 표 첫 칸 블록 seq>"로 제 묶음을 가리킨다
CAPTION_OF_FLAG = "caption_of"
# docx_reader.SIGNAL_NUMBERS·NUMBER_CELL과 같은 값 — 블록 신호의 번호 범위 [[시작, 끝, 출처], …]와 글 전체가 번호 꼴인 칸
NUMBERS_SIGNAL = "numbers"
NUMBER_CELL = "cell"
NEUTRAL = "neutral"
# 제목다움(F8b · 설계 2d) — 라벨 뒤 글이 이보다 길고 마침표로 끝나는 "제목"은 문장이다. 합성 자료로 잡은 값이다(실제 SOP 시험 뒤 다시 정한다)
HEADING_SENTENCE_MIN_CHARS = 60
# 제목 줄 머리의 번호 라벨("5.2.1" "5.2.1." "(3)") — 제목다움은 그 뒤 글로 잰다
_HEADING_LABEL_RE = re.compile(r"\s*\(?\d+(?:\.\d+)*[.)]?(?=\s)")


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
        lowered = token.lower()
        if lowered in NEVER_END_ABBREVIATIONS:
            return False
        if lowered in ABBREVIATIONS and "0" <= following <= "9":
            return False
        if lowered in NUMBER_ABBREVIATIONS and following in NUMBER_ABBREVIATION_FOLLOWERS:
            return False
        # 괄호 안 보기 "(예. 솔로)" — 줄 첫 "예."는 줄 라벨 규칙(_find_label_dots)이 본다
        if terminator >= 2 and text[terminator - 1] == "예" and text[terminator - 2] in "(（":
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


def _find_label_dots(text: str, line_start: int, list_number_dot: int) -> tuple[int, ...]:
    """line_start에서 시작하는 줄 맨 앞의 라벨("Chapter 1." "Note." "그림.")이 품은 마침표 자리들 — 라벨이 없으면 빈 튜플.

    목록 번호(추출기가 글 앞에 써 넣은 자동 번호 포함) 뒤의 라벨도 줄 맨 앞으로 본다 — "1. Note. …".
    """
    first = line_start if list_number_dot < 0 else list_number_dot + 1
    while first < len(text) and text[first] != "\n" and is_blank_char(text[first]):
        first += 1
    label = _LINE_LABEL_RE.match(text, first)
    if label is None:
        return ()
    # "Fig. 1."처럼 낱말 뒤 마침표와 번호 뒤 마침표가 둘 다 라벨 안이다
    return (label.end(),) if label.start(1) < 0 else (label.start(1), label.end())


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
    label_dots = _find_label_dots(text, 0, list_number_dot)
    while index < length:
        if text[index] == "\n":
            if split_lines:
                _append_trimmed(ranges, text, start, index)
                start = index + 1
            index += 1
            list_number_dot = _find_list_number_dot(text, index)
            label_dots = _find_label_dots(text, index, list_number_dot)
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
        is_protected = index == list_number_dot or index in label_dots
        if is_candidate and not is_protected and _is_sentence_end(text, index, after):
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
    signals: Mapping[str, object] | None = None  # 블록 신호(source_blocks.signals) — 목차 판정(noise.py)과 번호 칸 붙이기가 읽는다. 추출기 5 전의 추출은 없다


@dataclass(frozen=True)
class TableView:
    id: int
    is_layout: bool


@dataclass(frozen=True)
class UnitDraft:
    """만들 단위 하나 — spans는 (블록 id, 시작, 끝), group_index는 묶일 표·그림 초안의 목록 번호.

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
    noise_kind: str | None = None  # 잡음 표시(noise.py) — 목차 줄이면 "toc"
    from_heading: bool = False  # 제목 스타일 줄을 제목답지 않아 문장으로 바꾼 것(F8b) — units.from_heading


def is_heading_like(text: str) -> bool:
    """제목 스타일 줄이 제목다운가(F8b · 설계 2d) — 문장 끝이 둘 이상이거나, 라벨 뒤 글이 HEADING_SENTENCE_MIN_CHARS를 넘고
    마침표로 끝나면 문장이다. "5.2 Pre-cleaning"·"1. Purpose"·"Note."는 제목이다. 원문 글자는 읽기만 한다."""
    ends = sum(1 for start, end in split_sentences(text) if _is_terminated(text, start, end))
    if ends >= 2:
        return False
    label = _HEADING_LABEL_RE.match(text)
    body = text[label.end() if label is not None else 0:].strip()
    return not (len(body) > HEADING_SENTENCE_MIN_CHARS and body.rstrip(SENTENCE_CLOSERS).endswith((".", "。")))


def _is_terminated(text: str, start: int, end: int) -> bool:
    """문장 범위가 문장 끝 글자(와 닫는 글자)로 끝나는가 — 라벨 마침표("Chapter 1.")는 split_sentences가 이미 범위 안에 묶는다."""
    return text[start:end].rstrip(SENTENCE_CLOSERS)[-1:] in tuple(SENTENCE_TERMINATORS)


def _has_leading_number(block: BlockView) -> bool:
    """블록 글 앞에 번호가 있는가 — 추출 신호(자동·타자 번호)가 있거나 글이 숫자 번호로 시작한다."""
    return bool((block.signals or {}).get(NUMBERS_SIGNAL)) or _HEADING_LABEL_RE.match(block.text) is not None


def build_unit_drafts(
    blocks: Sequence[BlockView],
    tables: Sequence[TableView],
    layout: str,
    *,
    split_lines: bool = False,
    shift_headings: bool = True,
) -> list[UnitDraft]:
    """블록(seq 순) → 단위 초안(정렬 키 순). 규칙은 설계 §6.4·§7.4, 데이터 규칙은 공용 계약.

    split_lines(DOCX)면 블록 안 줄바꿈에서도 단위를 나눈다 — 블록은 그대로 하나라, 합치면 줄바꿈을 품은 한 범위로 돌아간다.
    - 문단: 제목 스타일이나 조항 번호만 있는 줄은 블록 전체가 제목(split_lines면 줄마다 제목 — "목적"/"Purpose" 두 줄 제목이
      언어별로 나뉜다), 아니면 문장마다. 머리말·각주 등도 같은 규칙.
    - 표 칸: 데이터 표는 표마다 첫 칸 자리에 표 단위(범위 없음·중립)를 두고 칸 문장을 묶는다. 레이아웃 표는 묶지 않는다.
      병합 칸(merged_cell)도 보통 칸이다. 레이아웃 표의 번호만 든 칸("A", "7" — 신호 cell)은 제 줄이 되지 않고 같은 행 다음 칸의
      첫 줄 앞에 붙어 그 줄의 번호 범위가 된다(붙을 줄이 없으면 제 줄, §11-7).
    - 그림: 그림 블록 글자(새 추출은 비었다, 예전 추출은 캡션)를 범위로 갖는 중립 단위 하나. 칸 안 그림도 표에 묶지 않는
      독립 단위다.
    - 캡션: caption_of 표시가 있는 블록은 문장으로 쪼개지 않고 블록 전체 범위 하나의 캡션 단위로 그 그림·표 초안에 묶는다.
      이을 초안이 없으면(레이아웃 표) 표시를 무시하고 보통 문장으로 쪼갠다.
    - 목차 줄(noise.find_toc_block_ids): 문장으로 쪼개지 않고 블록 전체 범위 하나의 문장 단위에 잡음 표시 "toc"를 붙인다 —
      점 끌기("1. 목적 ........ 3")의 점에서 잘리면 목차 한 줄이 두 단위가 된다.
    - shift_headings(옛 문서)면 제목답지 않은 제목 줄(is_heading_like)은 문장으로 쪼개고 from_heading 표시를 단다(F8b) — 조항형 옛 SOP의
      "제목 N수준" 조항. 번호 없는 제목 블록이 다른 언어의 바뀐 조항 바로 뒤에 오면 그 번역으로 보고 함께 바꾼다(짝이 문장마다 서게).
    """
    toc_block_ids = find_toc_block_ids(blocks)
    layout_table_ids = {table.id for table in tables if table.is_layout}
    # 캡션이 묶음보다 앞에 올 수 있어 묶음 초안이 생길 블록 seq를 먼저 모은다 — 그림 블록, 데이터 표의 첫 칸 블록
    bundle_seqs: set[int] = set()
    first_cell_tables: set[int] = set()
    for block in blocks:
        if block.kind == "figure":
            bundle_seqs.add(block.seq)
        elif block.kind == "table_cell" and block.table_id is not None and block.table_id not in layout_table_ids:
            if block.table_id not in first_cell_tables:
                first_cell_tables.add(block.table_id)
                bundle_seqs.add(block.seq)
    drafts: list[UnitDraft] = []
    table_draft_index: dict[int, int] = {}
    bundle_draft_index: dict[int, int] = {}  # 묶음 블록 seq → 그 그림·표 초안의 목록 번호
    caption_targets: dict[int, int] = {}  # 캡션 초안 목록 번호 → 가리키는 묶음 블록 seq
    number_cell: UnitDraft | None = None  # 같은 행 다음 칸의 첫 줄을 기다리는 번호 칸 초안
    shifted_lang: str | None = None  # 바로 앞 블록이 문장으로 바꾼 제목 줄이면 그 언어 — 뒤따르는 번호 없는 번역 블록이 따라 바뀐다
    for block in blocks:
        previous_shifted, shifted_lang = shifted_lang, None
        if number_cell is not None and not _is_same_row_cell(block, number_cell):
            drafts.append(number_cell)
            number_cell = None
        if block.id in toc_block_ids:
            line = trim_blank_range(block.text, 0, len(block.text))
            if line is not None:
                drafts.append(replace(_build_text_draft("sentence", block, *line), noise_kind=NOISE_TOC))
            continue
        caption_of = _read_caption_of(block.flags)
        if caption_of is not None and caption_of in bundle_seqs:
            caption = trim_blank_range(block.text, 0, len(block.text))
            if caption is not None:
                caption_targets[len(drafts)] = caption_of
                drafts.append(_build_text_draft("caption", block, *caption))
                continue
        if block.kind == "figure":
            bundle_draft_index[block.seq] = len(drafts)
            caption = trim_blank_range(block.text, 0, len(block.text))
            spans = [] if caption is None else [(block.id, *caption)]
            pos_start = 0 if caption is None else caption[0]
            drafts.append(UnitDraft("figure", spans, NEUTRAL, None, None, None, block.seq, pos_start))
        elif block.kind == "table_cell":
            group_index = None
            if block.table_id is not None and block.table_id not in layout_table_ids:
                group_index = table_draft_index.get(block.table_id)
                if group_index is None:
                    group_index = table_draft_index[block.table_id] = bundle_draft_index[block.seq] = len(drafts)
                    drafts.append(UnitDraft("table", [], NEUTRAL, block.table_id, None, None, block.seq, -1))
            cells = [
                _build_text_draft("cell_sentence", block, start, end, block.table_id, block.row_index, group_index)
                for start, end in split_sentences(block.text, split_lines=split_lines)
            ]
            if group_index is None and len(cells) == 1 and _is_number_cell(block, cells[0]):
                if number_cell is not None:  # 번호 칸이 잇달아 오면 앞의 것은 제 줄이다
                    drafts.append(number_cell)
                number_cell = cells[0]
                continue
            if number_cell is not None and cells:
                # 번호 칸 블록 전체가 그 줄 범위의 첫 조각이 된다 — 자리도 번호 칸의 것이다
                cells[0] = replace(
                    cells[0], spans=[*number_cell.spans, *cells[0].spans], pos_seq=number_cell.pos_seq,
                    pos_start=number_cell.pos_start,
                )
                number_cell = None
            drafts.extend(cells)
        elif block.heading_level is not None or CLAUSE_NUMBER_FLAG in block.flags:
            follows_shift = (
                previous_shifted is not None and not _has_leading_number(block)
                and detect_language(block.text) not in (None, previous_shifted)
            )
            for start, end in _split_heading(block.text, split_lines):
                if not shift_headings or (is_heading_like(block.text[start:end]) and not follows_shift):
                    drafts.append(_build_text_draft("heading", block, start, end))
                    continue
                for sentence_start, sentence_end in split_sentences(block.text[start:end]):
                    draft = _build_text_draft("sentence", block, start + sentence_start, start + sentence_end)
                    drafts.append(replace(draft, from_heading=True))
                shifted_lang = detect_language(block.text[start:end])
        else:
            drafts.extend(
                _build_text_draft("sentence", block, start, end)
                for start, end in split_sentences(block.text, split_lines=split_lines)
            )
    if number_cell is not None:
        drafts.append(number_cell)
    for index, target_seq in caption_targets.items():
        drafts[index] = replace(drafts[index], group_index=bundle_draft_index[target_seq])
    return _fill_languages(drafts, layout)


def _is_number_cell(block: BlockView, draft: UnitDraft) -> bool:
    """칸의 글 전체가 번호 꼴인가 — 추출기가 남긴 cell 신호가 그 칸의 한 줄과 같은 범위일 때."""
    _, start, end = draft.spans[0]
    return [start, end, NUMBER_CELL] in [list(number) for number in (block.signals or {}).get(NUMBERS_SIGNAL) or ()]


def _is_same_row_cell(block: BlockView, number_cell: UnitDraft) -> bool:
    """번호 칸이 기다릴 블록인가 — 같은 표 같은 행의 칸. 다른 행·표 밖 문단·그림이 오면 번호 칸은 제 줄이 된다."""
    return (
        block.kind == "table_cell" and block.table_id == number_cell.table_id
        and block.row_index == number_cell.row_index
    )


def _read_caption_of(flags: Sequence[str]) -> int | None:
    """caption_of 표시가 가리키는 묶음 블록 seq — 없으면 None."""
    prefix = f"{CAPTION_OF_FLAG}:"
    value = next((flag[len(prefix):] for flag in flags if flag.startswith(prefix)), None)
    return int(value) if value is not None and value.isdigit() else None


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


PairDirection = Literal["ko_en", "en_ko"]
_PairRun = tuple[str, list[int], list[str], int | None]  # (언어, 단위들, 글들, 바꾼 조항 블록 seq — 보통 단위는 None)


def suggest_interleaved_pairs(
    units: Sequence[tuple[int, str, str]],
    preferred: PairDirection | None = None,
    clauses: Mapping[int, int] | None = None,
) -> list[tuple[list[int], list[int]]]:
    """(단위 id, 언어, 글) 순서 목록 → 코드 짝 제안 [(한글 단위들, 영어 단위들)]. 중립을 건너뛰고 같은 언어가 이어진 덩어리를 만든다.

    한글 먼저·영어 먼저 두 방향으로 각각 짝을 만들어 번역 짝으로 보이는(_is_likely_pair) 짝이 더 많은 쪽을 채택한다.
    동점이면 preferred(문서 전체의 우세 순서, 부르는 쪽이 모은다), 그것도 없으면 한글 먼저다.
    한 방향 안에서는 왼쪽부터 첫 언어 덩어리 바로 뒤에 다음 언어 덩어리가 오고 둘이 번역 짝으로 보이면 둘을 잇고 그 뒤로 넘어가고,
    아니면 그 덩어리 하나만 건너뛴다(앞머리의 외톨이 회사명·제목 줄 하나가 문서 전체 짝을 한 칸씩 밀지 않게).
    어느 쪽이든 MAX_PAIR_SIDE를 넘으면 그 두 덩어리는 짝 없이 넘어간다. 머리말·본문처럼 부분이 다른 단위는 부르는 쪽이 나눠 넘긴다.
    clauses(단위 id → 조항 블록 seq)는 제목에서 문장으로 바꾼 조항의 단위다(F8b) — 조항마다 따로 덩어리가 되고, 문장 수가 같은
    두 조항은 문장마다 1:1 짝이 된다(한쪽 MAX_PAIR_SIDE는 1:1로 나눈 짝에는 걸지 않는다).
    """
    runs = _build_language_runs(units, clauses or {})
    ko_en = _pair_runs(runs, "ko_en")
    en_ko = _pair_runs(runs, "en_ko")
    if len(ko_en) == len(en_ko):
        return en_ko if preferred == "en_ko" else ko_en
    return ko_en if len(ko_en) > len(en_ko) else en_ko


def count_pair_directions(
    units: Sequence[tuple[int, str, str]], clauses: Mapping[int, int] | None = None
) -> tuple[int, int]:
    """(한글 먼저로 잡히는 짝 수, 영어 먼저로 잡히는 짝 수) — 문서 전체의 우세 순서를 정할 때 구간마다 모은다."""
    runs = _build_language_runs(units, clauses or {})
    return len(_pair_runs(runs, "ko_en")), len(_pair_runs(runs, "en_ko"))


def _build_language_runs(units: Sequence[tuple[int, str, str]], clauses: Mapping[int, int]) -> list[_PairRun]:
    """같은 언어가 이어진 덩어리 — 바꾼 조항(clauses)은 조항 블록이 달라지는 자리에서도 끊는다(조항 하나가 덩어리 하나)."""
    runs: list[_PairRun] = []
    for unit_id, lang, text in units:
        if lang == NEUTRAL:
            continue
        clause = clauses.get(unit_id)
        if runs and runs[-1][0] == lang and runs[-1][3] == clause:
            runs[-1][1].append(unit_id)
            runs[-1][2].append(text)
        else:
            runs.append((lang, [unit_id], [text], clause))
    return runs


def _pair_runs(runs: Sequence[_PairRun], direction: PairDirection) -> list[tuple[list[int], list[int]]]:
    first_lang, second_lang = ("ko", "en") if direction == "ko_en" else ("en", "ko")
    pairs = []
    index = 0
    while index < len(runs):
        if runs[index][0] == first_lang and index + 1 < len(runs) and runs[index + 1][0] == second_lang:
            first, second = runs[index], runs[index + 1]
            korean, english = (first, second) if direction == "ko_en" else (second, first)
            # 문장 수가 같은 바꾼 조항 둘은 문장마다 1:1 짝이다(F8b)
            is_clause_pair = korean[3] is not None and english[3] is not None and len(korean[1]) == len(english[1])
            if not is_clause_pair and (len(korean[1]) > MAX_PAIR_SIDE or len(english[1]) > MAX_PAIR_SIDE):
                index += 2
                continue
            if _is_likely_pair(korean[2], english[2]):
                if is_clause_pair:
                    pairs.extend(([korean_id], [english_id]) for korean_id, english_id in zip(korean[1], english[1], strict=True))
                else:
                    pairs.append((korean[1], english[1]))
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
