"""EQUIS 조회 결과의 응답 모양 — 번호별 사실에 줄의 쪽과 올린 판을 얹어 판정을 계산한다(설계 §8.4)."""

from collections.abc import Mapping
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.clock import KST
from app.equis.rules import Side, VersionFact, judge, normalize_number
from app.equis.service import is_in_flight, is_title_locked, needs_lookup, read_facts, read_state
from app.settings import settings
from app.sop.models import EquisLookup

# 물은 번호가 옛 번호(Legacy)였다 — 판정 이유의 맨 앞에 붙는다
REASON_OLD_NUMBER = "old_number"


class EquisVersionOut(BaseModel):
    version: str
    status: str
    effective_date: str
    retired_date: str


class EquisOut(BaseModel):
    """문서나 To-Be 줄 하나의 EQUIS 표시. 기능이 꺼졌거나 묻지 않는 번호(빈 칸·임시 번호)면 줄에 붙지 않는다."""

    state: Literal["pending", "found", "not_found", "unavailable"]
    # 조회가 도는 중이다 — 화면이 조금 뒤 다시 읽는다(첫 조회와 다시 조회 모두)
    refreshing: bool = False
    verdict: Literal["ok", "attention", "in_equis"] | None = None
    reasons: list[str] = []
    notes: list[EquisVersionOut] = []
    current: EquisVersionOut | None = None
    in_progress: list[EquisVersionOut] = []
    retired: EquisVersionOut | None = None
    # 지금 문서의 번호 — 물은 번호가 옛 번호면 다르다(trail이 지난 길)
    number: str = ""
    trail: list[str] = []
    ambiguous: list[str] = []
    name: str = ""
    subtype: str = ""
    owning_department: str = ""
    plant: str = ""
    area: str = ""
    legacy_numbers: list[str] = []
    equipment_tag: str = ""
    doc_url: str | None = None
    title_locked: bool = False
    fetched_at: datetime | None = None


def _to_version_out(fact: VersionFact) -> EquisVersionOut:
    return EquisVersionOut(
        version=fact.version_text, status=fact.status, effective_date=fact.effective_date, retired_date=fact.retired_date
    )


def _to_kst(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=KST) if value.tzinfo is None else value.astimezone(KST)


def build_equis_out(
    code: str, side: Side, doc_version: str, lookups: Mapping[str, EquisLookup], now: datetime
) -> EquisOut | None:
    """줄 하나의 EQUIS 표시. lookups의 열쇠는 다듬은 번호다(`service.load_lookups`)."""
    if not settings.equis_enabled:
        return None
    number = normalize_number(code)
    if not needs_lookup(number):
        return None
    lookup = lookups.get(number)
    if lookup is None:
        # 아직 물은 적 없는 번호 — 목록을 읽는 요청이 곧 조회를 건다
        return EquisOut(state="pending", refreshing=True, number=number)
    state = read_state(lookup, now)
    stored = lookup.facts or {}
    out = EquisOut(
        state=state,  # type: ignore[arg-type] -- read_state는 네 값만 돌려준다
        refreshing=is_in_flight(lookup, now),
        number=number,
        trail=list(stored.get("trail") or []),
        ambiguous=list(stored.get("ambiguous") or []),
        title_locked=is_title_locked(lookup, now),
        fetched_at=_to_kst(lookup.fetched_at),
    )
    facts = read_facts(lookup)
    if facts is None or state in ("pending", "not_found"):
        return out
    verdict = judge(facts, side, doc_version)
    reasons = list(verdict.reasons)
    if facts.number != number:
        reasons.insert(0, REASON_OLD_NUMBER)
    return out.model_copy(
        update={
            "verdict": "attention" if reasons else verdict.verdict,
            "reasons": reasons,
            "notes": [_to_version_out(fact) for fact in verdict.notes],
            "current": _to_version_out(facts.current) if facts.current else None,
            "in_progress": [_to_version_out(fact) for fact in facts.in_progress],
            "retired": _to_version_out(facts.retired) if facts.retired else None,
            "number": facts.number,
            "name": facts.name,
            "subtype": facts.subtype,
            "owning_department": facts.owning_department,
            "plant": facts.plant,
            "area": facts.area,
            "legacy_numbers": list(facts.legacy_numbers),
            "equipment_tag": facts.equipment_tag,
            "doc_url": f"{settings.equis_doc_url_base.rstrip('/')}/ui/#doc_info/{facts.doc_id}",
        }
    )
