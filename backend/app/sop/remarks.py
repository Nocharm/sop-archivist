"""Remark 고르기 도움 — 내가 최근에 쓴 사유(모든 묶음)와 외부 이동 대상 문서 후보(내가 멤버인 다른 묶음의 To-Be 문서).

둘 다 읽기만 한다. 사유는 사람이 적은 글이라 앱 로그에 남기지 않는다.
"""

from dataclasses import dataclass
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.bundle_code import format_bundle_code
from app.sop.models import BundleEvent, BundleMember, TargetDoc, TargetSentence, UnitDecision

MAX_RECENT_REMARKS = 10  # 화면은 5개를 보이고 "더 보기"로 10개까지
# 출처마다 읽는 행 수 — 같은 글이 겹쳐도 서로 다른 글 10개를 채울 만큼 넉넉히(사람이 쓴 행만이라 작다)
_SOURCE_SCAN = 100
DEFAULT_MOVE_TARGETS = 20
MAX_MOVE_TARGETS = 50
# 사유가 사람이 쓴 것이 아닌 표시(system:…) — 프런트 readHumanReason과 같은 기준
_SYSTEM_PREFIX = "system:"
# 사람이 남긴 사유가 reason 칸에 실리는 작업 기록 — 보낼 곳 없는 보류(group.hold)와 한 번에 삭제·이동(decision.bulk)
_REMARK_EVENTS = ("group.hold", "decision.bulk")


class RecentRemarkOut(BaseModel):
    text: str
    used_at: datetime


class MoveTargetOut(BaseModel):
    code: str
    title: str
    # 이 코드를 가진 To-Be 문서의 묶음 코드 — 전에 쓴 코드뿐이고 어느 묶음에도 없으면 null
    bundle_code: str | None
    # 전에 쓴 코드인가 — bundle(이 묶음에서 외부 이동 대상으로 쓰임) · mine(내가 다른 묶음에서 씀) · null
    used: str | None


@dataclass
class _Candidate:
    code: str
    title: str = ""
    bundle_code: str | None = None
    used: str | None = None


def _is_human(text: str) -> bool:
    return bool(text.strip()) and not text.startswith(_SYSTEM_PREFIX)


async def list_recent_remarks(session: AsyncSession, actor: str, limit: int) -> list[RecentRemarkOut]:
    """내가 쓴 사유를 최근 것부터, 같은 글은 한 번 — 확정한 처분의 사유·출처 없는 새 문장의 Remark·보류와 일괄 처분의 사유.

    보류는 판단 행에 쓴 사람이 남지 않아(confirmed_by가 비워진다) 작업 기록의 사유로 읽는다.
    """
    rows: list[tuple[str, datetime]] = []
    decisions = await session.execute(
        select(UnitDecision.reason, UnitDecision.confirmed_at)
        .where(UnitDecision.confirmed_by == actor, UnitDecision.reason != "", UnitDecision.confirmed_at.is_not(None))
        .order_by(UnitDecision.confirmed_at.desc())
        .limit(_SOURCE_SCAN)
    )
    rows.extend(decisions.tuples())
    targets = await session.execute(
        select(TargetSentence.remark, TargetSentence.confirmed_at)
        .where(TargetSentence.confirmed_by == actor, TargetSentence.remark != "", TargetSentence.confirmed_at.is_not(None))
        .order_by(TargetSentence.confirmed_at.desc())
        .limit(_SOURCE_SCAN)
    )
    rows.extend(targets.tuples())
    events = await session.execute(
        select(BundleEvent.reason, BundleEvent.occurred_at)
        .where(BundleEvent.actor == actor, BundleEvent.action.in_(_REMARK_EVENTS), BundleEvent.reason != "")
        .order_by(BundleEvent.occurred_at.desc())
        .limit(_SOURCE_SCAN)
    )
    rows.extend(events.tuples())
    seen: set[str] = set()
    out: list[RecentRemarkOut] = []
    for text, used_at in sorted(rows, key=lambda row: row[1], reverse=True):
        key = text.strip()
        if not _is_human(text) or key in seen:
            continue
        seen.add(key)
        out.append(RecentRemarkOut(text=key, used_at=used_at))
        if len(out) >= limit:
            break
    return out


def _score_match(candidate: _Candidate, needle: str) -> int:
    """찾는 글과 맞는 정도 — 코드 앞부분 3, 코드 안 2, 제목 안 1, 안 맞음 0(찾는 글이 없으면 모두 1)."""
    if not needle:
        return 1
    code = candidate.code.casefold()
    if code.startswith(needle):
        return 3
    if needle in code:
        return 2
    return 1 if needle in candidate.title.casefold() else 0


async def list_move_targets(
    session: AsyncSession, bundle_id: int, actor: str, query: str, limit: int
) -> list[MoveTargetOut]:
    """외부 이동 대상 후보 — 내가 멤버인 다른 묶음의 To-Be 문서와 전에 쓴 이동 코드.

    보이는 범위는 묶음 목록과 같은 멤버십이다. 순서는 전에 쓴 코드(이 묶음 → 나) 먼저, 그다음 찾는 글과 맞는 정도, 코드.
    """
    candidates: dict[str, _Candidate] = {}
    docs = await session.execute(
        select(TargetDoc.code, TargetDoc.title, TargetDoc.bundle_id)
        .join(BundleMember, BundleMember.bundle_id == TargetDoc.bundle_id)
        .where(BundleMember.login_id == actor, TargetDoc.bundle_id != bundle_id)
        .order_by(TargetDoc.bundle_id.desc(), TargetDoc.order_index, TargetDoc.id)
    )
    for code, title, doc_bundle_id in docs.tuples():
        # 같은 코드가 여러 묶음에 있으면 가장 최근 묶음의 것 하나
        candidates.setdefault(code, _Candidate(code=code, title=title, bundle_code=format_bundle_code(doc_bundle_id)))
    used_here = await session.scalars(
        select(UnitDecision.move_target_code)
        .where(UnitDecision.bundle_id == bundle_id, UnitDecision.move_target_code != "")
        .distinct()
    )
    used_mine = await session.scalars(
        select(UnitDecision.move_target_code)
        .where(UnitDecision.confirmed_by == actor, UnitDecision.move_target_code != "")
        .distinct()
    )
    for code in used_mine:
        candidates.setdefault(code, _Candidate(code=code)).used = "mine"
    for code in used_here:
        candidates.setdefault(code, _Candidate(code=code)).used = "bundle"
    needle = query.strip().casefold()
    used_rank = {"bundle": 0, "mine": 1, None: 2}
    scored = [(item, _score_match(item, needle)) for item in candidates.values()]
    ranked = sorted(
        ((item, score) for item, score in scored if score > 0),
        key=lambda pair: (used_rank[pair[0].used], -pair[1], pair[0].code),
    )
    return [
        MoveTargetOut(code=item.code, title=item.title, bundle_code=item.bundle_code, used=item.used)
        for item, _ in ranked[:limit]
    ]
