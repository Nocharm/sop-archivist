"""표·그림 캡션 번호와 본문 참조를 읽고 숫자만 바꾸는 순수 함수 — 번호 다시 매기기는 규칙 계산이다(AI 아님)."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

CaptionKind = Literal["table", "figure"]
Direction = Literal["next", "previous"]

# 캡션 머리: 숫자 바로 뒤에 조사가 오면("표 1에") 캡션이 아니다. 알려진 틈 "표 1 에 따라"는 그대로 둔다.
_CAPTION_TAIL = r"(?=$|[\s.:)\-–—])"
FIGURE_CAPTION_RE = re.compile(r"^(?:그림|Figure|Fig)\s*\.?\s*(\d+)" + _CAPTION_TAIL)
TABLE_CAPTION_RE = re.compile(r"^(?:표|Table)\s*\.?\s*(\d+)" + _CAPTION_TAIL)

# 본문 참조: 영문 단어 안("Portable 3")·한글 합성어("도표 3")는 거르고, 조사가 붙어도("표 3을") 참조로 잡는다.
# 숫자 뒤 꼬리(범위·복합 번호)는 코드가 따로 판정한다.
_REF_RE = re.compile(
    r"(?:(?<![가-힣])(?P<ko_table>표)|(?<![가-힣])(?P<ko_figure>그림)"
    r"|(?<![A-Za-z])(?P<en_table>Table)|(?<![A-Za-z])(?P<en_figure>Figure|Fig))\s*\.?\s*(?P<a>\d+)",
    re.IGNORECASE,
)
_TILDE_RANGE_RE = re.compile(r"\s*~\s*(\d+)")
_DASH_RANGE_RE = re.compile(r"[-–](\d+)")  # 공백 없는 줄표만 범위 후보
_COMPOUND_TAIL_RE = re.compile(r"[.\-–]\d")  # "3-1"·"3.2" 같은 복합 번호

# 위치 참조 어휘는 작게 — 표준·표현·표시·그림자 같은 낱말은 거른다.
_KO_PLACE_RE = re.compile(
    r"(?<![가-힣])(?P<dir>아래|위|다음|앞)\s*(?:(?P<table>표(?![현준시면기지]))|(?P<figure>그림(?!자)))"
)
_EN_PLACE_RES = (
    re.compile(r"\bthe\s+following\s+(?P<kind>table|figure)\b", re.IGNORECASE),
    re.compile(r"\bthe\s+(?P<kind>table|figure)\s+(?P<dir>above|below)\b", re.IGNORECASE),
    re.compile(r"\bthe\s+(?P<dir>above|below)\s+(?P<kind>table|figure)\b", re.IGNORECASE),
)
_KO_DIRECTIONS: dict[str, Direction] = {"아래": "next", "다음": "next", "위": "previous", "앞": "previous"}
_EN_DIRECTIONS: dict[str, Direction] = {"above": "previous", "below": "next"}


@dataclass(frozen=True)
class NumberToken:
    kind: CaptionKind
    number: int
    start: int  # 숫자 글자의 시작 — 바꿀 때 숫자만 바꾼다("Fig." 꼴은 그대로)
    end: int


@dataclass(frozen=True)
class PlaceToken:
    kind: CaptionKind
    direction: Direction  # 아래 표·the following table → next, 위 그림·the figure above → previous
    start: int  # 구절 전체
    end: int


def _match_caption_head(text: str) -> tuple[CaptionKind, re.Match[str]] | None:
    for kind, pattern in (("table", TABLE_CAPTION_RE), ("figure", FIGURE_CAPTION_RE)):
        match = pattern.match(text)
        if match is not None:
            return kind, match
    return None


def has_caption_head(text: str) -> bool:
    """캡션 머리 꼴인지 — 복합 번호("Table 3-1")·다른 종류 머리도 머리다. 머리가 있는 캡션에는 머리 번호를 붙이지 않는다."""
    return _match_caption_head(text) is not None


def read_caption_number(text: str) -> NumberToken | None:
    """캡션 머리("표 1."·"Fig.6")의 번호 — 머리가 아니거나 복합 번호("Table 3-1."·"표 3.2")면 None.

    복합 번호는 장·절 번호라 다시 매길 번호가 아니다(캡션 꼴 판정은 정규식 그대로라 여전히 캡션이다).
    """
    head = _match_caption_head(text)
    if head is None:
        return None
    kind, match = head
    if _COMPOUND_TAIL_RE.match(text, match.end(1)) is not None:
        return None
    return NumberToken(kind, int(match.group(1)), match.start(1), match.end(1))


def find_caption_number(text: str, kind: CaptionKind | None) -> NumberToken | None:
    """캡션의 자기 번호 — 그 종류의 머리 번호, 머리가 없으면 글 안의 첫 그 종류 번호("<표 3> 운전 조건").

    머리가 있는데 복합 번호이거나 다른 종류면 None. kind(묶음 종류)를 모르면 머리만 본다.
    """
    if has_caption_head(text) or kind is None:
        head = read_caption_number(text)
        return head if head is not None and (kind is None or head.kind == kind) else None
    return next((token for token in find_number_tokens(text) if token.kind == kind), None)


def find_number_tokens(text: str) -> list[NumberToken]:
    """글 안 어디든 표·그림 번호 참조를 읽는다.

    "~" 범위와 공백 없는 증가 줄표 범위("1-3")는 양 끝 둘, "3-1"·"3.2" 같은 복합 번호는 토큰 없음.
    """
    tokens: list[NumberToken] = []
    for match in _REF_RE.finditer(text):
        kind: CaptionKind = "table" if match.group("ko_table") or match.group("en_table") else "figure"
        first = int(match.group("a"))
        rest = match.end("a")
        second = None
        if (tilde := _TILDE_RANGE_RE.match(text, rest)) is not None:
            second = tilde
        elif (dash := _DASH_RANGE_RE.match(text, rest)) is not None:
            if int(dash.group(1)) <= first:
                continue  # "Table 3-1" — 복합 번호
            second = dash
        elif _COMPOUND_TAIL_RE.match(text, rest) is not None:
            continue
        tokens.append(NumberToken(kind, first, match.start("a"), match.end("a")))
        if second is not None:
            tokens.append(NumberToken(kind, int(second.group(1)), second.start(1), second.end(1)))
    return tokens


def find_place_tokens(text: str) -> list[PlaceToken]:
    """"아래 표"·"the figure above" 같은 위치 참조를 시작 순서대로 읽는다."""
    tokens: list[PlaceToken] = []
    for match in _KO_PLACE_RE.finditer(text):
        kind: CaptionKind = "table" if match.group("table") else "figure"
        tokens.append(PlaceToken(kind, _KO_DIRECTIONS[match.group("dir")], match.start(), match.end()))
    for pattern in _EN_PLACE_RES:
        for match in pattern.finditer(text):
            kind = "table" if match.group("kind").lower() == "table" else "figure"
            word = match.groupdict().get("dir")
            direction: Direction = _EN_DIRECTIONS[word.lower()] if word else "next"
            tokens.append(PlaceToken(kind, direction, match.start(), match.end()))
    return sorted(tokens, key=lambda token: token.start)


def replace_numbers(text: str, changes: Mapping[tuple[int, int], int]) -> str:
    """(start, end) 숫자 자리를 새 번호로 바꾼다 — 뒤에서부터 바꿔 앞쪽 자리가 밀리지 않게 한다.

    키는 find_number_tokens·read_caption_number가 준 숫자 span이어야 한다.
    """
    for start, end in sorted(changes, reverse=True):
        text = text[:start] + str(changes[(start, end)]) + text[end:]
    return text


def format_caption_prefix(kind: CaptionKind, number: int, lang: str) -> str:
    """새 캡션 머리 — ko는 한글, 그 밖은 영문."""
    if lang == "ko":
        return f"{'표' if kind == 'table' else '그림'} {number}. "
    return f"{'Table' if kind == 'table' else 'Figure'} {number}. "
