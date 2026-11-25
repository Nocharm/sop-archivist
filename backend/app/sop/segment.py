"""규칙 쪼개기 — 빈 글자 판정·문장 경계·언어 판정·블록 → 단위 초안·한/영 연달아 짝 제안(DB를 모르는 순수 함수)."""

import re
from bisect import bisect_left
from collections import Counter
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Literal

from app.sop.constants import MAX_PAIR_SIDE
from app.sop.noise import NOISE_TOC, find_toc_block_ids

# 쪼개기 규칙 번호(extractions.split_rule, 설계 2026-11-25 R0) — 1은 문장마다, 2는 문단 안에서 이어진 같은 언어를 한 박스로.
# 이미 올린 문서는 1이고 편집(제목 ↔ 문장 · 띠 표)까지 1로 다시 만든다 — 규칙을 바꿔도 예전 문서의 박스는 바뀌지 않는다
RULE_LEGACY = 1
RULE_PARAGRAPH = 2
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
# docx_reader.SIGNAL_CAPTIONS와 같은 값 — 칸 블록 안 안쪽 표 캡션 줄 [[시작, 끝, 안쪽 표 첫 칸 seq], …](추출기 8부터)
CAPTIONS_SIGNAL = "captions"
# docx_reader.SIGNAL_NUMBERS·NUMBER_CELL과 같은 값 — 블록 신호의 번호 범위 [[시작, 끝, 출처], …]와 글 전체가 번호 꼴인 칸
NUMBERS_SIGNAL = "numbers"
NUMBER_CELL = "cell"
# 글 앞에 타자로 친 번호 — 점이 있어야 번호로 본다("1." "6.1" "1.10."). "3 times"처럼 숫자로 시작하는 문장을 집지 않게.
# 추출기(docx_reader._find_number)가 문단 머리에서, numbering.read_number_range가 줄바꿈 뒤 줄머리에서 같은 꼴을 읽는다
TYPED_NUMBER_RE = re.compile(r"(?:\d+(?:\.\d+)+\.?|\d+\.)(?=\s|$)")
# 문서 번호 꼴(파일 이름에서 번호를 읽는 규칙과 같다, `filename.py`) — 영문 대문자 머리 + 하이픈 마디 + 숫자 끝. 참조 줄(refs.py)과
# 규칙 2의 줄머리가 함께 쓴다 — 추출 자식이 모델을 물지 않게 이 모듈에 둔다
DOCUMENT_NUMBER_BODY = r"[A-Z]{2,}(?:-[A-Z0-9]{1,8})*-\d{1,6}"
# 규칙 2 — 한글 사이 · 끝의 영어 덩어리가 이보다 적은 낱말이면 앞 한글 박스에 잇는다("Buffer A."). 합성 자료로 잡은 값(실제 SOP 뒤 다시 정한다)
SHORT_ENGLISH_WORDS = 3
# 규칙 2의 줄머리(번호 말고) — 글머리 기호나 문서 번호면 DOCX · PDF 모두 그 줄에서 나눈다. 줄표는 "-5 °C"를 집지 않게 숫자 앞이면 아니다
_LINE_MARKER_RE = re.compile(
    rf"[•·*▪◦●○■□◆※]|[-–—](?!\d)|o(?=[ \t])|{DOCUMENT_NUMBER_BODY}(?![A-Za-z0-9])"
)
# 규칙 2의 줄머리 번호 — "5.1" "1." | "(1)" "1)" "a." "a)" "가." "ㄱ)" "iv." | "①"
_LINE_NUMBER_RE = re.compile(
    rf"(?P<dotted>{TYPED_NUMBER_RE.pattern})"
    r"|(?P<open>\(?)(?P<body>\d{1,3}|[A-Za-z]|[가나다라마바사아자차카타파하ㄱ-ㅎ]|[ivx]{2,}|[IVX]{2,})(?P<close>\)|\.(?=\s|$))"
    r"|(?P<circled>[①-⑳])"
)
# 글자 번호의 차례 — 한 글자는 자리 + 1이 값이다
_LETTER_SERIES = (
    "abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "가나다라마바사아자차카타파하", "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ",
    "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳",
)
_ROMAN_SERIES = (
    "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii",
    "xix", "xx",
)
# docx_reader.SIGNAL_BAND와 같은 값 — 띠 표(1행 3칸: 번호 칸 | 빈 칸 | 제목 칸)의 표 신호 {"number", "level"}
BAND_SIGNAL = "band"
# docx_reader.SIGNAL_PLACE·SIGNAL_PARAS와 같은 값 — 안쪽 표의 바깥 칸 자리 {"row", "col", "para"}와 칸 안 문단 시작 자리
PLACE_SIGNAL = "place"
PARAS_SIGNAL = "paras"
# docx_reader.SIGNAL_INLINE과 같은 값 — 문단·칸 안 그림 블록이 놓인 글자 자리 {"at"}(추출기 7부터)
INLINE_SIGNAL = "inline"
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


_MAX_NUMBER_DIGITS = 9  # 번호 마디 하나에서 읽는 자리 수 — 긴 숫자열(4,300자리 넘으면 int()가 예외)에 업로드가 죽지 않게
_MAX_NUMBER_PARTS = 10  # 점 번호의 마디 수 — 넘으면 번호로 읽지 않는다(조작한 글이 줄마다의 견주기를 키우지 못하게)
# 번호 하나의 읽기 — (차례 이름, 값). 점 번호의 값은 마디 묶음(5, 1), 나머지는 순번 하나다
_NumberReading = tuple[tuple[str, ...], tuple[int, ...]]


def _read_line_number(text: str, at: int) -> list[_NumberReading]:
    """at에서 시작하는 줄머리 번호의 읽기들 — 번호가 아니면 빈 목록. "i"는 로마 숫자 1이자 글자 9라 둘 다 낸다."""
    match = _LINE_NUMBER_RE.match(text, at)
    if match is None:
        return []
    if match["dotted"] is not None:
        parts = match["dotted"].rstrip(".").split(".")
        if len(parts) > _MAX_NUMBER_PARTS:
            return []
        return [(("dotted",), tuple(int(part[:_MAX_NUMBER_DIGITS]) for part in parts))]
    body = match["body"] or match["circled"]
    marks = (match["open"] or "", match["close"] or "")  # "1)"과 "(1)"은 다른 차례다
    if body.isdecimal():
        return [(("digit", *marks), (int(body),))]
    readings: list[_NumberReading] = [
        ((series, *marks), (series.index(body) + 1,)) for series in _LETTER_SERIES if len(body) == 1 and body in series
    ]
    if body.lower() in _ROMAN_SERIES:
        case = "roman" if body.islower() else "ROMAN"
        readings.append(((case, *marks), (_ROMAN_SERIES.index(body.lower()) + 1,)))
    return readings


def _is_number_after(
    reading: _NumberReading, last_values: Mapping[tuple[str, ...], tuple[int, ...]], previous: set[tuple[str, ...]]
) -> bool:
    """PDF 블록에서 이 번호가 앞 번호들을 잇는가 — 같은 차례의 다음 번호 · 첫 하위 · 윗 단계 다음. 접힌 줄이 "0.8 bar"로 시작해도
    앞 번호 5.1의 다음이 아니라 번호 줄이 아니다."""
    series, value = reading
    last = last_values.get(series)
    if last is not None:
        depth = len(value)
        is_next = depth <= len(last) and value[:-1] == last[: depth - 1] and value[-1] == last[depth - 1] + 1
        if is_next or (depth == len(last) + 1 and value[:-1] == last and value[-1] == 1):
            return True
    # 다른 차례의 번호 바로 뒤에 새로 시작하는 1 — "5.1" 아래 "a)"
    return value == (1,) and series not in previous


def find_marker_lines(text: str, *, split_lines: bool) -> list[int]:
    """번호 · 글머리 기호 · 문서 번호로 시작하는 줄의 시작 자리(첫 줄 제외) — 규칙 2가 여기서는 같은 언어여도 나눈다.

    split_lines(DOCX)면 줄머리가 맞으면 늘이다(줄바꿈은 글쓴이가 넣었다). PDF의 줄바꿈은 폭에 따라 접힌 것이라 글머리 · 문서
    번호면 늘, 번호면 블록에서 바로 앞 번호(첫 줄 포함)를 이을 때만이다 — 앞 번호가 없으면 번호 줄로 보지 않는다.
    """
    if "\n" not in text:
        return []
    starts: list[int] = []
    last_values: dict[tuple[str, ...], tuple[int, ...]] = {}
    previous: set[tuple[str, ...]] = set()
    line_start = 0
    while line_start < len(text):
        first = line_start
        while first < len(text) and text[first] != "\n" and is_blank_char(text[first]):
            first += 1
        readings = _read_line_number(text, first)
        if line_start > 0 and not split_lines:
            readings = [item for item in readings if previous and _is_number_after(item, last_values, previous)]
        if readings:
            last_values.update(readings)
            previous = {series for series, _ in readings}
        if line_start > 0 and (readings or _LINE_MARKER_RE.match(text, first) is not None):
            starts.append(line_start)
        line_end = text.find("\n", first)
        if line_end < 0:
            break
        line_start = line_end + 1
    return starts


@dataclass
class _Run:
    """같은 언어가 이어진 조각 덩어리 하나(규칙 2) — kept는 앞뒤와 잇지 않는 조각(참조 줄)이다."""

    start: int
    end: int
    lang: Literal["ko", "en"] | None
    kept: bool


def split_paragraph(
    text: str, *, split_lines: bool = False, paras: Sequence[int] = (), kept: Collection[int] = ()
) -> list[tuple[int, int]]:
    """규칙 2의 박스 범위(설계 2026-11-25 R2) — 문장 조각(split_sentences)을 이어진 같은 언어끼리 다시 잇는다.

    바깥 경계는 번호 · 글머리 · 문서 번호 줄(find_marker_lines)과 칸 안 문단 시작(paras)이고, 배치는 보지 않는다. 언어를 모르는
    조각(숫자 · 기호뿐)은 앞 조각을 따르고 맨 앞이면 뒤 조각을 따른다. kept는 잇지 않을 조각의 시작 자리(Reference 절의 참조 줄)다.
    """
    cuts = sorted({0, len(text), *find_marker_lines(text, split_lines=split_lines), *(at for at in paras if 0 < at < len(text))})
    ranges: list[tuple[int, int]] = []
    for segment_start, segment_end in zip(cuts, cuts[1:], strict=False):
        ranges.extend(_join_segment(text, segment_start, segment_end, split_lines, kept))
    return ranges


def _join_segment(
    text: str, segment_start: int, segment_end: int, split_lines: bool, kept: Collection[int]
) -> list[tuple[int, int]]:
    """바깥 경계 안의 조각들 → 박스 범위. 짧은 영어 예외는 조각이 아니라 덩어리째 본다."""
    runs: list[_Run] = []
    for piece_start, piece_end in split_sentences(text[segment_start:segment_end], split_lines=split_lines):
        start, end = segment_start + piece_start, segment_start + piece_end
        lang = detect_language(text[start:end])
        last = runs[-1] if runs else None
        if last is not None and start not in kept and not last.kept and (lang is None or last.lang in (None, lang)):
            last.end = end
            last.lang = last.lang or lang
        else:
            runs.append(_Run(start, end, lang, start in kept))
    boxes: list[_Run] = []
    for run in runs:
        last = boxes[-1] if boxes and not run.kept and not boxes[-1].kept else None
        if last is not None and (last.lang == run.lang or _is_short_english(text, last, run, split_lines)):
            last.end = run.end  # 예외로 이은 영어 뒤의 한글도 다시 이어진다
        else:
            boxes.append(run)
    return [(run.start, run.end) for run in boxes]


def _is_short_english(text: str, last: _Run, run: _Run, split_lines: bool) -> bool:
    """한글 박스에 이을 짧은 영어 덩어리인가 — DOCX에서 줄이 갈린 "온도↵Temperature"는 짝이라 잇지 않는다."""
    if last.lang != "ko" or run.lang != "en" or (split_lines and "\n" in text[last.end:run.start]):
        return False
    words = sum(1 for word in text[run.start:run.end].split() if any(map(_is_latin_letter, word)))
    return words < SHORT_ENGLISH_WORDS


def split_block_text(
    text: str, *, rule: int, split_lines: bool, paras: Sequence[int] = (), kept: Collection[int] = ()
) -> list[tuple[int, int]]:
    """추출의 규칙으로 블록 글을 나눈 범위 — 규칙 1은 문장마다(split_sentences 그대로), 규칙 2는 split_paragraph."""
    if rule == RULE_LEGACY:
        return split_sentences(text, split_lines=split_lines)
    return split_paragraph(text, split_lines=split_lines, paras=paras, kept=kept)


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
    is_band: bool = False  # 띠 표 신호가 있다 — 레이아웃(벗긴) 띠 표는 제목 칸이 번호 칸을 품은 제목 줄이 된다(F4)


def is_band_table(signals: Mapping[str, object] | None) -> bool:
    """추출기가 띠 표 신호를 남긴 표인가 — 꼴(1행 3칸 · 번호 꼴 첫 칸 · 빈 가운데 칸 · 글 있는 셋째 칸)은 docx_reader가 본다."""
    return bool((signals or {}).get(BAND_SIGNAL))


def is_certain_band(signals: Mapping[str, object] | None, parent_table_id: int | None, part: str) -> bool:
    """올리자마자 제목 줄로 만들 띠 표인가(F4 · §11-1) — 띠 표 신호가 있는 본문의 바깥 표. 데이터 표 안의 띠 표는 바깥 표를 벗길 때까지
    표 안에 두고(브랜치 6), 머리말·꼬리말의 띠 표 꼴은 절을 열지 않아 표로 둔다. 표로 둔 띠 표도 사람이 벗기면 제목 줄이 된다."""
    return is_band_table(signals) and parent_table_id is None and part == "body"


def is_band_heading(kind: str, table_id: int | None) -> bool:
    """띠 표 제목 줄인가 — 제목 단위 가운데 원문 표를 가리키는 것은 벗긴 띠 표에서 나온 것뿐이다(표 칸 문단은 제목 스타일이어도 칸 문장)."""
    return kind == "heading" and table_id is not None


def read_table_place(signals: Mapping[str, object] | None) -> tuple[int, int, int] | None:
    """안쪽 표가 바깥 칸에서 놓인 자리 (행, 격자 열, 그 칸에서 표 앞에 있던 문단 수) — 바깥 표·추출기 5 전의 추출은 None(F2)."""
    place = (signals or {}).get(PLACE_SIGNAL)
    if not isinstance(place, Mapping):
        return None
    return int(place["row"]), int(place["col"]), int(place["para"])


def read_figure_inline(signals: Mapping[str, object] | None) -> int | None:
    """그림 블록이 놓인 글자 자리 — 앞선 가장 가까운 그림 아닌 블록(같은 문단 · 칸) 글 안. 그림만 든 문단 · 추출기 7 전의 추출은 None."""
    inline = (signals or {}).get(INLINE_SIGNAL)
    if not isinstance(inline, Mapping):
        return None
    return int(inline["at"])


def find_anchor_offset(cell_text: str, cell_signals: Mapping[str, object] | None, para: int) -> int:
    """바깥 칸 블록 글에서 안쪽 표가 놓인 글자 자리 — 표 앞 문단이 para개면 para번째 문단의 시작, 모든 문단 뒤면 글 길이(F2).
    칸 안 문단 시작 자리(신호 paras)는 문단이 둘 이상일 때만 남으니 없으면 문단 하나(0에서 시작)다."""
    starts = list((cell_signals or {}).get(PARAS_SIGNAL) or [0])
    return int(starts[para]) if para < len(starts) else len(cell_text)


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
    rule: int = RULE_LEGACY,
    kept: Mapping[int, Collection[int]] = {},
) -> list[UnitDraft]:
    """블록(seq 순) → 단위 초안(정렬 키 순). 규칙은 설계 §6.4·§7.4, 데이터 규칙은 공용 계약.

    split_lines(DOCX)면 블록 안 줄바꿈에서도 단위를 나눈다 — 블록은 그대로 하나라, 합치면 줄바꿈을 품은 한 범위로 돌아간다.
    rule은 그 추출의 쪼개기 규칙(extractions.split_rule)이다 — 아래에서 "문장"은 규칙 1이면 문장, 규칙 2면 이어진 같은 언어의 박스
    (split_block_text). 제목 · 캡션 · 그림 · 목차 · 띠 표 줄은 규칙과 상관없다. kept는 규칙 2가 잇지 않을 조각 — 블록 id → 시작 자리들.
    - 문단: 제목 스타일이나 조항 번호만 있는 줄은 블록 전체가 제목(split_lines면 줄마다 제목 — "목적"/"Purpose" 두 줄 제목이
      언어별로 나뉜다), 아니면 문장마다. 머리말·각주 등도 같은 규칙.
    - 표 칸: 데이터 표는 표마다 첫 칸 자리에 표 단위(범위 없음·중립)를 두고 칸 문장을 묶는다. 레이아웃 표는 묶지 않는다.
      병합 칸(merged_cell)도 보통 칸이다. 레이아웃 표의 번호만 든 칸("A", "7" — 신호 cell)은 제 줄이 되지 않고 같은 행 다음 칸의
      첫 줄 앞에 붙어 그 줄의 번호 범위가 된다(붙을 줄이 없으면 제 줄, §11-7). 레이아웃 띠 표(is_band)는 칸 글이 제목 줄이라
      번호 칸 + 제목 칸이 제목 단위 하나가 된다(F4 — 번호는 번호 칸에만, 글은 제목만).
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
    band_heading_ids = {table.id for table in tables if table.is_layout and table.is_band}
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
            if block.table_id in band_heading_ids:
                # 벗긴 띠 표 — 칸 글은 제목이고(문장으로 쪼개지 않는다) 번호 칸은 아래 번호 칸 규칙으로 그 제목 줄의 번호 범위가 된다
                cells = [
                    _build_text_draft("heading", block, start, end, block.table_id, block.row_index)
                    for start, end in _split_heading(block.text, split_lines)
                ]
            else:
                cells = [
                    _build_text_draft("cell_sentence", block, start, end, block.table_id, block.row_index, group_index)
                    for start, end in split_block_text(
                        block.text, rule=rule, split_lines=split_lines, paras=(block.signals or {}).get(PARAS_SIGNAL) or (),
                        kept=kept.get(block.id, ()),
                    )
                ]
            cell_captions = _read_cell_captions(block, bundle_seqs) if block.table_id not in band_heading_ids else {}
            if cell_captions:
                cells = _swap_caption_lines(block, cells, cell_captions)
            if group_index is None and len(cells) == 1 and _is_number_cell(block, cells[0]):
                if number_cell is not None:  # 번호 칸이 잇달아 오면 앞의 것은 제 줄이다
                    drafts.append(number_cell)
                number_cell = cells[0]
                continue
            if number_cell is not None and cells and cells[0].kind == "caption":
                drafts.append(number_cell)  # 캡션 줄은 번호를 받지 않는다 — 번호 칸은 제 줄이다
                number_cell = None
            if number_cell is not None and cells:
                # 번호 칸 블록 전체가 그 줄 범위의 첫 조각이 된다 — 자리도 번호 칸의 것이다
                cells[0] = replace(
                    cells[0], spans=[*number_cell.spans, *cells[0].spans], pos_seq=number_cell.pos_seq,
                    pos_start=number_cell.pos_start,
                )
                number_cell = None
            for cell in cells:
                if cell.kind == "caption":
                    caption_targets[len(drafts)] = cell_captions[cell.pos_start][1]
                drafts.append(cell)
        elif block.heading_level is not None or CLAUSE_NUMBER_FLAG in block.flags:
            follows_shift = (
                previous_shifted is not None and not _has_leading_number(block)
                and detect_language(block.text) not in (None, previous_shifted)
            )
            block_kept = sorted(kept.get(block.id, ()))
            for start, end in _split_heading(block.text, split_lines):
                if not shift_headings or (is_heading_like(block.text[start:end]) and not follows_shift):
                    drafts.append(_build_text_draft("heading", block, start, end))
                    continue
                line_kept = block_kept[bisect_left(block_kept, start):bisect_left(block_kept, end)]
                for sentence_start, sentence_end in split_block_text(
                    block.text[start:end], rule=rule, split_lines=False, kept={at - start for at in line_kept}
                ):
                    draft = _build_text_draft("sentence", block, start + sentence_start, start + sentence_end)
                    drafts.append(replace(draft, from_heading=True))
                shifted_lang = detect_language(block.text[start:end])
        else:
            drafts.extend(
                _build_text_draft("sentence", block, start, end)
                for start, end in split_block_text(
                    block.text, rule=rule, split_lines=split_lines, kept=kept.get(block.id, ())
                )
            )
    if number_cell is not None:
        drafts.append(number_cell)
    for index, target_seq in caption_targets.items():
        drafts[index] = replace(drafts[index], group_index=bundle_draft_index[target_seq])
    return _fill_languages(drafts, layout)


def _is_number_cell(block: BlockView, draft: UnitDraft) -> bool:
    _, start, end = draft.spans[0]
    return is_number_cell_range(block.signals, start, end)


def is_number_cell_range(signals: Mapping[str, object] | None, start: int, end: int) -> bool:
    """칸의 글 전체가 번호 꼴인가 — 추출기가 남긴 cell 신호가 그 칸의 한 줄과 같은 범위일 때. 표 벗기기 편집도 같은 판정을 쓴다."""
    return [start, end, NUMBER_CELL] in [list(number) for number in (signals or {}).get(NUMBERS_SIGNAL) or ()]


def _is_same_row_cell(block: BlockView, number_cell: UnitDraft) -> bool:
    """번호 칸이 기다릴 블록인가 — 같은 표 같은 행의 칸. 다른 행·표 밖 문단·그림이 오면 번호 칸은 제 줄이 된다."""
    return (
        block.kind == "table_cell" and block.table_id == number_cell.table_id
        and block.row_index == number_cell.row_index
    )


def _read_cell_captions(block: BlockView, bundle_seqs: set[int]) -> dict[int, tuple[int, int]]:
    """칸 안 캡션 줄 — 시작 자리 → (끝, 안쪽 표 첫 칸 seq). 이을 표 초안이 없는(레이아웃) 안쪽 표의 줄은 보통 칸 줄이다."""
    lines = (block.signals or {}).get(CAPTIONS_SIGNAL) or ()
    return {start: (end, seq) for start, end, seq in lines if seq in bundle_seqs}


def _swap_caption_lines(
    block: BlockView, cells: list[UnitDraft], captions: Mapping[int, tuple[int, int]]
) -> list[UnitDraft]:
    """캡션 줄 범위 안의 칸 문장들을 캡션 초안 하나로 바꾼다(문장으로 쪼개지 않는다 — "표 1. 조제…"의 마침표). 묶음은 뒤에서 잇는다."""
    def is_inside(draft: UnitDraft) -> bool:
        _, start, end = draft.spans[0]
        return any(head <= start and end <= tail for head, (tail, _) in captions.items())

    kept = [cell for cell in cells if not is_inside(cell)]
    lines = [_build_text_draft("caption", block, start, end) for start, (end, _) in captions.items()]
    return sorted([*kept, *lines], key=lambda draft: draft.spans[0][1])


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


_LINE_BREAKS_TO_SPACE = str.maketrans("\r\n", "  ")


def flatten_line_breaks(text: str) -> str:
    """줄바꿈("\\n" "\\r")을 띄어쓰기로 — 한 글자를 한 글자로 바꿔 길이가 그대로다."""
    return text.translate(_LINE_BREAKS_TO_SPACE)


def build_unit_text(spans: Sequence[Sequence[int]], block_texts: Mapping[int, str]) -> str:
    """단위 글자 = 범위 글자를 띄어쓰기 하나로 이은 것 — 범위 안 줄바꿈("\\n" "\\r")도 띄어쓰기다(박스 하나는 한 줄, 항목 6-a).

    한 글자를 한 글자로 바꾸므로 글 안 좌표(나눌 자리·번호 범위·그림 자리)는 범위 글자 길이 그대로다.
    """
    return " ".join(flatten_line_breaks(block_texts[block_id][start:end]) for block_id, start, end in spans)


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
