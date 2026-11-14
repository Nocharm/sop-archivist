"""참조 줄(REF) — 다른 문서를 번호로 가리키는 글 단위(설계 2026-11-15 REF 문단).

REF는 KO·EN과 같은 자리(`Unit.lang`)에 둔다. 번호 영역은 사람이 확인한 것만 `unit_refs`에 남기고, 제안은 읽을 때 글에서
찾는다 — 편집으로 단위가 새로 생겨도 다시 채울 것이 없다.
"""

import re
from dataclasses import dataclass
from typing import Literal

from app.equis.client import is_sendable_number
from app.equis.rules import normalize_number
from app.sop.models import Unit, UnitRef

REF_LANG = "ref"
REF_CONFIRMED = "confirmed"
REF_REJECTED = "rejected"
# 참조 줄이 될 수 있는 단위 — 그림·표·행은 번호 영역을 갖지 않는다
REF_KINDS = ("sentence", "heading", "cell_sentence")

# 문서 번호 꼴(파일 이름에서 번호를 읽는 규칙과 같다, `filename.py`) — 영문 대문자 머리 + 하이픈 마디 + 숫자 끝
_NUMBER = r"[A-Z]{2,}(?:-[A-Z0-9]{1,8})*-\d{1,6}(?![A-Za-z0-9])"
# 줄 맨 앞의 번호만 제안한다 — 글머리 기호나 항목 번호는 건너뛴다. 문장 가운데의 번호는 사람이 직접 표시한다
_LEADING_NUMBER = re.compile(rf"\s*(?:[-–•·*▪◦]\s*|\(?\d{{1,3}}[.)]\s*|\d+(?:\.\d+)+\s+)?({_NUMBER})")


@dataclass(frozen=True)
class RefState:
    state: Literal["proposed", "confirmed"]
    number: str


def find_leading_number(text: str) -> str | None:
    """줄이 문서 번호로 시작하면 그 번호 — 참조 줄 제안의 근거."""
    found = _LEADING_NUMBER.match(text)
    return found.group(1) if found else None


def read_number_in_text(text: str, number: str) -> str | None:
    """사람이 고른 번호가 그 글 안에 있고 조회할 수 있는 꼴이면 다듬은 번호, 아니면 None.

    글에 없는 번호를 받지 않는다 — 번호를 자유롭게 받으면 앱이 EQUIS 검색 창구가 된다.
    """
    normalized = normalize_number(number)
    if not normalized or not is_sendable_number(normalized) or normalized not in text.upper():
        return None
    return normalized


def read_ref_state(unit: Unit, mark: UnitRef | None) -> RefState | None:
    """단위의 참조 상태 — REF로 확정됐는지, 앱이 제안하는지, 아무것도 아닌지.

    되돌리기는 언어만 되돌리고 표시(`unit_refs`)는 그대로 둔다. 그래서 언어가 먼저다: 언어가 REF면 확정, 아니면 사람이
    "참조 아님"이라 한 것만 제안에서 빼고 나머지는 글을 다시 본다.
    """
    if unit.kind not in REF_KINDS:
        return None
    if unit.lang == REF_LANG:
        number = mark.number if mark is not None else normalize_number(find_leading_number(unit.text) or "")
        return RefState(REF_CONFIRMED, number)
    if mark is not None and mark.state == REF_REJECTED:
        return None
    number = find_leading_number(unit.text)
    return RefState("proposed", normalize_number(number)) if number else None
