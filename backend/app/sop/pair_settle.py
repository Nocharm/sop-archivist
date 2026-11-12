"""짝의 운명 — 판단을 쓰는 길 끝에 서버가 한/영 짝을 풀거나 확정한다(설계 §5.2). 한 줄의 처분이 늘 하나이게 하는 규칙이다."""

from collections import defaultdict
from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.detach import CONFIRMED, UNASSIGNED
from app.sop.groups import select_in_chunks
from app.sop.models import Document, TargetSentence, TargetSource, Unit, UnitDecision, UnitPair, UnitPairMember
from app.sop.units import PAIR_SUGGESTED, UNIT_ACTIVE

# 운명 — (처분, 이동할 문서 번호, 새 문장이 놓인 새 문서들). 같은 새 문서 안의 칸·단계·절은 보지 않는다
Fate = tuple[str, str, frozenset[int]]


@dataclass(frozen=True)
class PairSettleReport:
    confirmed_pair_ids: list[int]
    dissolved_pair_ids: list[int]


@dataclass(frozen=True)
class _Member:
    unit_id: int
    decision: UnitDecision


async def settle_pairs(
    session: AsyncSession, bundle_id: int, unit_ids: Collection[int], actor: str, *, release: Collection[int] = ()
) -> PairSettleReport:
    """unit_ids·release의 단위가 든 이 묶음의 짝마다 위에서부터 하나만 적용한다 — 판단을 쓴 뒤, 같은 트랜잭션에서 부른다.

    1. 구성 단위가 release에 있으면 푼다(화면이 "남는 쪽을 따로 줄로"를 실어 보냈다).
    2. 미배정이 아닌 구성 단위들의 운명이 둘 이상이면 푼다.
    3. 제안 짝이고 구성 단위의 판단이 모두 확정이면 확정한다.
    판단 단위만 본다 — 은퇴했거나 표에 묶인 칸 문장은 자기 판단이 없어(늘 미배정) 줄에 들지 않는다. 질의 수는 단위 수와 무관하다.
    """
    # pairs → editing → decisions → pair_settle로 이어지는 순환 import라 여기서 부른다
    from app.sop.pairs import dissolve_pair, mark_pair_confirmed

    released = set(release)
    pair_rows = await select_in_chunks(
        session,
        lambda chunk: select(UnitPair, Document)
        .join(UnitPairMember, UnitPairMember.pair_id == UnitPair.id)
        .join(Document, Document.id == UnitPair.document_id)
        .where(UnitPairMember.unit_id.in_(chunk), Document.bundle_id == bundle_id),
        set(unit_ids) | released,
    )
    pairs = {pair.id: (pair, document) for pair, document in pair_rows}
    members: dict[int, list[_Member]] = defaultdict(list)
    for pair_id, unit_id, decision in await select_in_chunks(
        session,
        lambda chunk: select(UnitPairMember.pair_id, UnitPairMember.unit_id, UnitDecision)
        .join(Unit, Unit.id == UnitPairMember.unit_id)
        .join(UnitDecision, UnitDecision.unit_id == Unit.id)
        .where(UnitPairMember.pair_id.in_(chunk), Unit.status == UNIT_ACTIVE, Unit.group_unit_id.is_(None)),
        pairs,
    ):
        members[pair_id].append(_Member(unit_id, decision))
    target_docs = await _load_target_docs(session, [member.unit_id for group in members.values() for member in group])

    confirmed: list[int] = []
    dissolved: list[int] = []
    for pair_id in sorted(pairs):
        pair, document = pairs[pair_id]
        group = members[pair_id]
        fates = {
            _get_fate(member.decision, target_docs.get(member.unit_id, frozenset()))
            for member in group if member.decision.disposition != UNASSIGNED
        }
        if any(member.unit_id in released for member in group) or len(fates) > 1:
            await dissolve_pair(session, document, pair, actor)
            dissolved.append(pair_id)
        elif pair.status == PAIR_SUGGESTED and group and all(member.decision.status == CONFIRMED for member in group):
            await mark_pair_confirmed(session, document, pair, actor)
            confirmed.append(pair_id)
    return PairSettleReport(confirmed_pair_ids=confirmed, dissolved_pair_ids=dissolved)


async def _load_target_docs(session: AsyncSession, unit_ids: Collection[int]) -> dict[int, frozenset[int]]:
    """단위 → 그 단위를 출처로 둔 새 문장이 놓인 새 문서들."""
    docs: dict[int, set[int]] = defaultdict(set)
    for unit_id, target_doc_id in await select_in_chunks(
        session,
        lambda chunk: select(TargetSource.unit_id, TargetSentence.target_doc_id)
        .join(TargetSentence, TargetSentence.id == TargetSource.target_id)
        .where(TargetSource.unit_id.in_(chunk)),
        unit_ids,
    ):
        docs[unit_id].add(target_doc_id)
    return {unit_id: frozenset(doc_ids) for unit_id, doc_ids in docs.items()}


def _get_fate(decision: UnitDecision, target_doc_ids: frozenset[int]) -> Fate:
    move_target_code = decision.move_target_code if decision.disposition == "move_external" else ""
    return decision.disposition, move_target_code, target_doc_ids
