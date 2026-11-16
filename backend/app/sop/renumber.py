"""표·그림 캡션 번호와 본문 참조를 읽고 숫자만 바꾸는 순수 함수 — 번호 다시 매기기는 규칙 계산이다(AI 아님)."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

CaptionKind = Literal["table", "figure"]

# 캡션 머리: 숫자 바로 뒤에 조사가 오면("표 1에") 캡션이 아니다. 알려진 틈 "표 1 에 따라"는 그대로 둔다.
_CAPTION_TAIL = r"(?=$|[\s.:)\-–—])"
FIGURE_CAPTION_RE = re.compile(r"^(?:그림|Figure|Fig)\s*\.?\s*(\d+)" + _CAPTION_TAIL)
TABLE_CAPTION_RE = re.compile(r"^(?:표|Table)\s*\.?\s*(\d+)" + _CAPTION_TAIL)

# 본문 참조: 영문 단어 안("Portable 3")은 거르고, 조사가 붙어도("표 3을") 참조로 잡는다. "1~3" 범위는 둘째 숫자도 잡는다.
_REF_RE = re.compile(
    r"(?<![A-Za-z])(?:(?P<table>표|Table)|(?P<figure>그림|Figure|Fig))\s*\.?\s*(?P<a>\d+)"
    r"(?:\s*[~\-–]\s*(?P<b>\d+))?",
    re.IGNORECASE,
)

# 위치 참조 어휘는 작게 — 표준·표현·표시·그림자 같은 낱말은 거른다.
_KO_PLACE_RE = re.compile(
    r"(?<![가-힣])(?P<dir>아래|위|다음|앞)\s*(?:(?P<table>표(?![현준시면기지]))|(?P<figure>그림(?!자)))"
)
_EN_PLACE_RES = (
    re.compile(r"\bthe\s+following\s+(?P<kind>table|figure)\b", re.IGNORECASE),
    re.compile(r"\bthe\s+(?P<kind>table|figure)\s+(?P<dir>above|below)\b", re.IGNORECASE),
    re.compile(r"\bthe\s+(?P<dir>above|below)\s+(?P<kind>table|figure)\b", re.IGNORECASE),
)
_KO_DIRECTIONS = {"아래": "next", "다음": "next", "위": "previous", "앞": "previous"}
_EN_DIRECTIONS = {"above": "previous", "below": "next"}


@dataclass(frozen=True)
class NumberToken:
    kind: CaptionKind
    number: int
    start: int  # 숫자 글자의 시작 — 바꿀 때 숫자만 바꾼다("Fig." 꼴은 그대로)
    end: int


@dataclass(frozen=True)
class PlaceToken:
    kind: CaptionKind
    direction: Literal["next", "previous"]  # 아래 표·the following table → next, 위 그림·the figure above → previous
    start: int  # 구절 전체
    end: int


def read_caption_number(text: str) -> NumberToken | None:
    """캡션 머리("표 1."·"Fig.6")의 번호 — 머리가 아니면 None."""
    for kind, pattern in (("table", TABLE_CAPTION_RE), ("figure", FIGURE_CAPTION_RE)):
        match = pattern.match(text)
        if match is not None:
            return NumberToken(kind, int(match.group(1)), match.start(1), match.end(1))
    return None


def find_number_tokens(text: str) -> list[NumberToken]:
    """글 안 어디든 표·그림 번호 참조를 읽는다(범위는 양 끝 둘)."""
    tokens: list[NumberToken] = []
    for match in _REF_RE.finditer(text):
        kind: CaptionKind = "table" if match.group("table") else "figure"
        for group in ("a", "b"):
            if match.group(group) is not None:
                tokens.append(NumberToken(kind, int(match.group(group)), match.start(group), match.end(group)))
    return tokens


def find_place_tokens(text: str) -> list[PlaceToken]:
    """"아래 표"·"the figure above" 같은 위치 참조를 시작 순서대로 읽는다."""
    tokens: list[PlaceToken] = []
    for match in _KO_PLACE_RE.finditer(text):
        kind: CaptionKind = "table" if match.group("table") else "figure"
        tokens.append(PlaceToken(kind, _KO_DIRECTIONS[match.group("dir")], match.start(), match.end()))  # type: ignore[arg-type]
    for pattern in _EN_PLACE_RES:
        for match in pattern.finditer(text):
            kind = match.group("kind").lower()  # type: ignore[assignment]
            word = match.groupdict().get("dir")
            direction = _EN_DIRECTIONS[word.lower()] if word else "next"
            tokens.append(PlaceToken(kind, direction, match.start(), match.end()))  # type: ignore[arg-type]
    return sorted(tokens, key=lambda token: token.start)


def replace_numbers(text: str, changes: Mapping[tuple[int, int], int]) -> str:
    """(start, end) 숫자 자리를 새 번호로 바꾼다 — 뒤에서부터 바꿔 앞쪽 자리가 밀리지 않게 한다."""
    for start, end in sorted(changes, reverse=True):
        text = text[:start] + str(changes[(start, end)]) + text[end:]
    return text


def format_caption_prefix(kind: CaptionKind, number: int, lang: str) -> str:
    """새 캡션 머리 — ko는 한글, 그 밖은 영문."""
    if lang == "ko":
        return f"{'표' if kind == 'table' else '그림'} {number}. "
    return f"{'Table' if kind == 'table' else 'Figure'} {number}. "
