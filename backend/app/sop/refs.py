"""참조 줄(REF) — 다른 문서를 번호로 가리키는 글 단위(설계 2026-11-15 REF 문단).

REF는 KO·EN과 같은 자리(`Unit.lang`)에 둔다. 번호 영역은 사람이 확인한 것만 `unit_refs`에 남기고, 제안은 읽을 때 글에서
찾는다 — 편집으로 단위가 새로 생겨도 다시 채울 것이 없다.
"""

import re
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.equis.client import is_sendable_number
from app.equis.rules import normalize_number
from app.sop.models import Extraction, Unit, UnitRef

REF_LANG = "ref"
REF_CONFIRMED = "confirmed"
REF_REJECTED = "rejected"
# 참조 줄이 될 수 있는 단위 — 그림·표는 번호 영역을 갖지 않는다
REF_KINDS = ("sentence", "heading", "cell_sentence")
# 쪼개기가 Reference 절 아래 줄을 REF로 확정한 사람 표시(unit_refs.decided_by)
REF_SPLIT_ACTOR = "system"
# 이 추출기(extract.types.EXTRACTOR_VERSION)부터 쪼개기가 Reference 절 아래 줄을 REF로 확정하고, 글을 보고 제안하지 않는다
# (요청서 12 · 14, 2026-11-19). 그 전에 올린 문서는 다시 올릴 때까지 전처럼 제안한다
FIRST_SECTION_REF_VERSION = 6

# Reference 절 제목 이름 — 번호를 뺀 제목 글(괄호 · 빗금으로 나뉜 조각 하나)이 이것과 같으면 그 절이다. 대소문자 · 빈칸은 무시(사용자 확인 2026-11-19)
_REF_SECTION_NAME = re.compile(
    r"references?|reference documents?|related documents?|associated documents?|work instructions?"
    r"|참고 ?문헌|참고 ?문서|참조(?: ?문서)?|관련 ?문서|참고 ?자료",
    re.IGNORECASE,
)
# 제목 앞 절 번호("7." · "7.1" · "(7)" · "VII.")
_HEADING_NUMBER = re.compile(r"\s*(?:\(?\d+(?:\.\d+)*\.?\)?|[IVX]+\.)\s*")

# 문서 번호 꼴(파일 이름에서 번호를 읽는 규칙과 같다, `filename.py`) — 영문 대문자 머리 + 하이픈 마디 + 숫자 끝
_NUMBER_BODY = r"[A-Z]{2,}(?:-[A-Z0-9]{1,8})*-\d{1,6}"
_NUMBER = rf"{_NUMBER_BODY}(?![A-Za-z0-9])"
_DOCUMENT_NUMBER = re.compile(_NUMBER_BODY)
# 줄 맨 앞의 번호만 제안한다 — 글머리 기호나 항목 번호는 건너뛴다. 문장 가운데의 번호는 사람이 직접 표시한다
_LEADING_NUMBER = re.compile(rf"\s*(?:[-–•·*▪◦]\s*|\(?\d{{1,3}}[.)]\s*|\d+(?:\.\d+)+\s+)?({_NUMBER})")


@dataclass(frozen=True)
class RefState:
    state: Literal["proposed", "confirmed"]
    number: str


def is_document_number(number: str) -> bool:
    """글 전체가 문서 번호 꼴인가 — 다듬지 않고 본다(빈칸·소문자가 섞이면 아니다). 참조 지도가 남에게 보일 번호를 거른다."""
    return _DOCUMENT_NUMBER.fullmatch(number) is not None


def find_leading_number(text: str) -> str | None:
    """줄이 문서 번호로 시작하면 그 번호 — 참조 줄 제안의 근거."""
    found = _LEADING_NUMBER.match(text)
    return found.group(1) if found else None


# 번호를 견줄 때 지우는 글자 — 빈칸과 하이픈 변형(‐ ‑ ‒ – — ― −). "WI SYN 0101" · "wi–syn–0101"이 "WI-SYN-0101"과 같다
_CODE_SEPARATORS = re.compile(r"[\s\-\u2010-\u2015\u2212]+")


def normalize_ref_code(code: str) -> str:
    """참조 번호와 문서 번호를 견줄 때의 꼴 — 대문자로, 빈칸 · 하이픈 변형을 지운다(참조로 찾은 상위, B13)."""
    return _CODE_SEPARATORS.sub("", code).upper()


def read_leading_ref_number(text: str) -> str:
    """줄 맨 앞 문서 번호를 조회할 수 있는 꼴로 — 없거나 조회할 수 없는 꼴이면 빈 글(번호 없는 참조 줄)."""
    number = find_leading_number(text)
    return (read_number_in_text(text, number) or "") if number else ""


def read_number_in_text(text: str, number: str) -> str | None:
    """사람이 고른 번호가 그 글 안에 있고 조회할 수 있는 꼴이면 다듬은 번호, 아니면 None.

    글에 없는 번호를 받지 않는다 — 번호를 자유롭게 받으면 앱이 EQUIS 검색 창구가 된다.
    """
    normalized = normalize_number(number)
    if not normalized or not is_sendable_number(normalized) or normalized not in text.upper():
        return None
    return normalized


# 번호와 이름 사이를 잇는 글자(빈칸·쉼표·줄표·쌍점) — 원문의 것을 그대로 쓴다
_SEPARATOR = re.compile(r"[\s,:;–—-]*")
# 줄 끝에 남겨 둘 마침 부호
_TAIL = re.compile(r"[.;,]?\s*$")


def build_ref_text(text: str, number: str, current_number: str, name: str) -> str | None:
    """참조 줄의 글을 EQUIS의 지금 번호와 정식 이름으로 맞춘 글 — 새 문장에 쓸 제안. 이미 같으면 None.

    줄이 번호로 시작하면 번호 뒤를 이름으로 갈아 끼운다(줄 앞의 글머리 기호·항목 번호와 끝의 마침 부호는 둔다). 번호가 문장
    가운데에 있으면 문장을 건드리지 않고 번호만 지금 번호로 바꾼다 — 그 뒤의 글은 문서 이름이 아니다.
    """
    at = text.upper().find(number)
    if at < 0 or not current_number:
        return None
    head, rest = text[:at], text[at + len(number) :]
    is_leading = find_leading_number(text) is not None and normalize_number(find_leading_number(text) or "") == number
    if not is_leading or not name or not rest.strip():
        suggestion = f"{head}{current_number}{rest}"
    else:
        separator = _SEPARATOR.match(rest)
        tail = _TAIL.search(rest)
        joiner = separator.group(0) if separator and separator.group(0) else " "
        suggestion = f"{head}{current_number}{joiner}{name}{tail.group(0).rstrip() if tail else ''}"
    return None if suggestion == text else suggestion


def _fold(text: str) -> str:
    """대소문자와 빈칸 차이는 같은 글로 본다(사용자 확인 2026-11-14 — 제목 비교)."""
    return " ".join(text.split()).upper()


def check_ref_text(
    text: str, source_text: str, number: str, current_number: str, name: str
) -> Literal["number", "title"] | None:
    """참조 줄의 새 문장이 EQUIS와 어긋나는지 — 번호가 지금 번호가 아니면 "number", 번호는 맞는데 이름이 다르면 "title".

    견줄 글은 원문을 EQUIS에 맞춘 글이다(`build_ref_text`, 원문이 이미 맞으면 원문). 화면의 `readRefAdvice`와 같은 규칙이다.
    """
    if not current_number:
        return None
    expected = build_ref_text(source_text, number, current_number, name) or source_text
    if _fold(text) == _fold(expected):
        return None
    return "title" if current_number.upper() in _fold(text) else "number"


def read_ref_state(unit: Unit, mark: UnitRef | None, *, propose: bool) -> RefState | None:
    """단위의 참조 상태 — REF로 확정됐는지, 앱이 제안하는지, 아무것도 아닌지.

    되돌리기는 언어만 되돌리고 표시(`unit_refs`)는 그대로 둔다. 그래서 언어가 먼저다: 언어가 REF면 확정, 아니면 사람이
    "참조 아님"이라 한 것만 제안에서 빼고 나머지는 글을 다시 본다. propose가 거짓이면(새 추출기, is_proposing_version) 글을 보고
    제안하지 않는다 — Reference 절 아래 줄은 쪼갤 때 이미 확정됐다.
    """
    if unit.kind not in REF_KINDS:
        return None
    if unit.lang == REF_LANG:
        number = mark.number if mark is not None else normalize_number(find_leading_number(unit.text) or "")
        return RefState(REF_CONFIRMED, number)
    if not propose or (mark is not None and mark.state == REF_REJECTED):
        return None
    number = find_leading_number(unit.text)
    return RefState("proposed", normalize_number(number)) if number else None


def is_proposing_version(extractor_version: str) -> bool:
    """그 추출의 REF를 글에서 제안하는가 — FIRST_SECTION_REF_VERSION 전 추출만(옛 추출은 Reference 절 확정이 없었다)."""
    return not (extractor_version.isdigit() and int(extractor_version) >= FIRST_SECTION_REF_VERSION)


async def load_proposing_extractions(session: AsyncSession, extraction_ids: Collection[int]) -> set[int]:
    """REF를 글에서 제안하는 추출 id(is_proposing_version)."""
    if not extraction_ids:
        return set()
    rows = await session.execute(
        select(Extraction.id, Extraction.extractor_version).where(Extraction.id.in_(set(extraction_ids)))
    )
    return {extraction_id for extraction_id, version in rows if is_proposing_version(version)}


def is_ref_section_heading(text: str) -> bool:
    """제목이 Reference 절을 여는가 — 절 번호를 떼고, 괄호 · 빗금으로 나뉜 조각("참고 문헌 (References)") 하나라도 이름과 같으면."""
    body = _HEADING_NUMBER.sub("", text, count=1)
    parts = (" ".join(part.split()).strip(" :.-–") for part in re.split(r"[()/|]", body))
    return any(part and _REF_SECTION_NAME.fullmatch(part) for part in parts)


@dataclass(frozen=True)
class SectionLine:
    """Reference 절 찾기가 읽는 단위 하나(문서 순서) — level은 제목의 단계(모르면 None)."""

    kind: str
    text: str
    lang: str
    level: int | None
    is_body: bool
    is_noise: bool


def find_ref_section_lines(lines: Sequence[SectionLine], *, interleaved: bool, separate: bool) -> list[int]:
    """Reference 절 아래에서 REF로 확정할 글 줄(문장 · 칸 문장)의 자리 — 쪼갤 때 쓴다(요청서 12, 사용자 확인 2026-11-19).

    절은 이름이 맞는 본문 제목에서 시작해 같거나 높은 단계의 다음 제목 전까지다(단계를 모르는 제목은 1단계로 본다). 한/영 따로
    문서는 절반마다 절이 있어 이름이 맞는 제목을 모두 쓴다. 머리말 · 꼬리말과 목차 줄은 보지 않는다.
    문서 번호로 시작하는 줄은 늘 REF다. 번호가 없는 줄은 한/영 짝이 없을 때만 REF다(EQUIS에 없는 참고 문서 "ISO 9001:2015") —
    짝이 있는 문장("제조사 설명서를 참고한다." / "Refer to the manual.")은 보통 문장으로 둔다. 짝은 연달아 배치면 바로 다음 줄이
    다른 언어인 것, 따로 배치면 절들의 한글 줄과 영어 줄을 차례로 맞춘 것이다. 한 언어 문서는 짝이 없다.
    """
    numbered: list[int] = []
    prose: list[int] = []
    level: int | None = None
    for index, line in enumerate(lines):
        if not line.is_body or line.is_noise:
            continue
        if line.kind == "heading":
            own = line.level or 1
            if is_ref_section_heading(line.text):
                level = own
            elif level is not None and own <= level:
                level = None
        elif level is not None and line.kind in ("sentence", "cell_sentence"):
            (numbered if find_leading_number(line.text) else prose).append(index)
    paired = _find_prose_partners(lines, prose, interleaved=interleaved, separate=separate)
    return sorted([*numbered, *(index for index in prose if index not in paired)])


def _find_prose_partners(
    lines: Sequence[SectionLine], prose: Sequence[int], *, interleaved: bool, separate: bool
) -> set[int]:
    """번호 없는 줄 가운데 한/영 짝이 있는 줄의 자리."""
    paired: set[int] = set()
    if interleaved:
        # 한글 줄마다 바로 다음 줄, 없으면 바로 앞 줄이 짝 없는 영어 줄이면 짝 — 앞의 번호 없는 영어 줄("ISO 9001")을 먼저 데려가지 않게
        prose_set = set(prose)
        for index in prose:
            if lines[index].lang != "ko":
                continue
            partner = next(
                (other for other in (index + 1, index - 1)
                 if other in prose_set and other not in paired and lines[other].lang == "en"),
                None,
            )
            if partner is not None:
                paired.update((index, partner))
    elif separate:
        korean = [index for index in prose if lines[index].lang == "ko"]
        english = [index for index in prose if lines[index].lang == "en"]
        for left, right in zip(korean, english, strict=False):
            paired.update((left, right))
    return paired
