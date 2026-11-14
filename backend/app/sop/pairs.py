"""한/영 짝 — 사람이 짝을 만들고(확정) 제안 짝을 확정하거나 푼다 (스펙 §6.5). 묶음 잠금·문서 revision 검사·커밋은 라우터가 한다."""

from collections import Counter, defaultdict
from collections.abc import Collection, Mapping, Sequence

from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.sop.ai.adoption import adopt_suggestions, reject_suggestions
from app.sop.constants import MAX_PAIR_SIDE
from app.sop.decisions import DbId
from app.sop.detach import sweep_translations
from app.sop.editing import PAIR_LANGS, TEXT_KINDS, ensure_unique_units, load_active_units
from app.sop.errors import raise_rule
from app.sop.events import record_event
from app.sop.models import Document, TargetSource, Unit, UnitPair, UnitPairMember
from app.sop.pair_settle import has_diverging_fates, load_decided_fates, settle_pairs
from app.sop.units import PAIR_SUGGESTED, get_latest_extraction_id

PAIR_CONFIRMED = "confirmed"
PAIR_SOURCE_HUMAN = "human"
PAIR_SOURCE_AI = "ai"


class PairIn(BaseModel):
    revision: int = Field(ge=1)
    # 한쪽 MAX_PAIR_SIDE 이하는 업무 규칙(422 pair_side_too_large)이 본다 — 여기는 입력 크기 상한
    unit_ids: list[DbId] = Field(min_length=2, max_length=2 * MAX_PAIR_SIDE)


class PairRevisionIn(BaseModel):
    revision: int = Field(ge=1)


class PairOut(BaseModel):
    id: int
    status: str
    source: str
    unit_ids: list[int]  # 원문 순서


class PairResult(BaseModel):
    document_revision: int
    pair: PairOut | None  # 푼 짝은 None


async def create_pair(session: AsyncSession, document: Document, unit_ids: Sequence[int], actor: str) -> UnitPair:
    """같은 문서의 활성 글자 단위로 사람이 짝을 만든다 — 확정·출처 human. 제안 짝에 든 단위면 그 제안 짝을 먼저 지운다.

    한글·영어가 모두 있고 한쪽 MAX_PAIR_SIDE 이하여야 한다. 다른 확정 짝에 든 단위가 있으면 409 unit_already_paired,
    이미 서로 다른 곳으로 보낸 단위들이면(운명이 갈림, pair_settle) 409 pair_fates_differ — 한 줄의 처분은 늘 하나다(제품 명세 §6.5).
    지우는 AI 제안 짝은 채택을 남긴다 — 사람이 같은 단위 집합으로 다시 만들면 그대로, 아니면 버림이다.
    """
    ensure_unique_units(unit_ids)
    units = await load_active_units(session, await get_latest_extraction_id(session, document.id), unit_ids)
    # 그림·표·행은 언어가 중립이라 짝의 어느 쪽도 아니다
    wrong = sorted(unit.id for unit in units.values() if unit.kind not in TEXT_KINDS)
    if wrong:
        raise_rule(422, "invalid_unit_kind", unit_ids=wrong)
    sides = Counter(unit.lang for unit in units.values())
    if not PAIR_LANGS <= set(sides):
        raise_rule(422, "missing_language", langs=sorted(sides))
    if max(sides.values()) > MAX_PAIR_SIDE:
        raise_rule(422, "pair_side_too_large", max_side=MAX_PAIR_SIDE)
    current = (
        await session.execute(
            select(UnitPairMember.unit_id, UnitPair.id, UnitPair.status, UnitPair.suggestion_id)
            .join(UnitPair, UnitPair.id == UnitPairMember.pair_id)
            .where(UnitPairMember.unit_id.in_(unit_ids))
        )
    ).all()
    taken = sorted(unit_id for unit_id, _, status, _ in current if status != PAIR_SUGGESTED)
    if taken:
        raise_rule(409, "unit_already_paired", unit_ids=taken)
    fates = await load_decided_fates(session, unit_ids)
    if has_diverging_fates(fates, unit_ids):
        raise_rule(409, "pair_fates_differ", unit_ids=sorted(fates))
    suggested = sorted({pair_id for _, pair_id, _, _ in current})
    if suggested:
        await _record_replaced_adoption(
            session, {pair_id: suggestion_id for _, pair_id, _, suggestion_id in current if suggestion_id is not None},
            set(unit_ids), actor,
        )
        # 짝 단위는 DB의 ON DELETE CASCADE가 함께 지운다
        await session.execute(delete(UnitPair).where(UnitPair.id.in_(suggested)))
    pair = UnitPair(document_id=document.id, status=PAIR_CONFIRMED, source=PAIR_SOURCE_HUMAN)
    session.add(pair)
    await session.flush()
    session.add_all(UnitPairMember(pair_id=pair.id, unit_id=unit_id) for unit_id in sorted(unit_ids))
    _record(session, document, "pair.create", pair.id, actor)
    await session.flush()
    await _sweep_paired_translations(session, document.bundle_id, unit_ids)
    # 확정 짝이라 settle_pairs가 다시 확정하거나 쓸지 않는다 — 운명은 위에서 막았다. 짝을 맺는 모든 길이 같은 끝을 지나게 부른다
    await settle_pairs(session, document.bundle_id, unit_ids, actor)
    return pair


async def _sweep_paired_translations(session: AsyncSession, bundle_id: int, unit_ids: Collection[int]) -> None:
    """짝이 확정되면 짝의 다른 언어 단위가 번역을 대신하므로, 묶인 단위를 출처로 둔 새 문장의 번역을 출처가 바뀐 것처럼 쓸어 낸다(제품 명세 §7.9).

    AI 번역은 지우고 확정 번역은 보류다(sweep_translations). 쓸리는 것은 기원이 번역(origin translation)인 행뿐이라 사람이 쓴
    다른 언어 새 문장(기원 units, 변경 종류 translated)은 그대로다. 제안 짝은 쓸지 않는다 — 풀면(Separate) 번역이 다시 필요하다.
    """
    source_target_ids = await session.scalars(
        select(TargetSource.target_id).where(TargetSource.unit_id.in_(unit_ids)).distinct()
    )
    await sweep_translations(session, bundle_id, list(source_target_ids))


async def _record_replaced_adoption(
    session: AsyncSession, suggestion_by_pair: Mapping[int, int], unit_ids: set[int], actor: str
) -> None:
    """사람이 만든 짝이 바꾸는 AI 제안 짝의 채택 — 단위 집합이 같으면 그대로, 다르면 버림이다. 짝 행이 지워지면 제안을 찾을 길이 없어 지우기 전에 쓴다."""
    if not suggestion_by_pair:
        return
    members: dict[int, set[int]] = defaultdict(set)
    rows = await session.execute(
        select(UnitPairMember.pair_id, UnitPairMember.unit_id).where(UnitPairMember.pair_id.in_(list(suggestion_by_pair)))
    )
    for pair_id, unit_id in rows:
        members[pair_id].add(unit_id)
    is_same = {pair_id: members[pair_id] == unit_ids for pair_id in suggestion_by_pair}
    await adopt_suggestions(
        session, [suggestion_by_pair[pair_id] for pair_id, same in is_same.items() if same], actor, now()
    )
    await reject_suggestions(
        session, [suggestion_by_pair[pair_id] for pair_id, same in is_same.items() if not same], actor
    )


async def confirm_pair(session: AsyncSession, document: Document, pair_id: int, actor: str) -> UnitPair:
    """제안 짝(코드·AI)을 확정한다 — 출처는 그대로 둔다. 이미 확정이면 아무것도 쓰지 않는다(revision·기록 그대로)."""
    pair = await _get_pair(session, document, pair_id)
    if pair.status != PAIR_CONFIRMED:
        await mark_pair_confirmed(session, document, pair, actor)
    return pair


async def delete_pair(session: AsyncSession, document: Document, pair_id: int, actor: str) -> None:
    """짝을 푼다(제안·확정 모두) — 단위는 짝 없이 남는다."""
    await dissolve_pair(session, document, await _get_pair(session, document, pair_id), actor)


async def mark_pair_confirmed(session: AsyncSession, document: Document, pair: UnitPair, actor: str) -> None:
    """제안 짝을 확정으로 바꾼다 — 사람의 확인(confirm_pair)과 줄 확정 뒤 서버(pair_settle)가 함께 쓴다.

    AI 제안 짝이면 그대로 채택으로 남긴다 — 짝은 글을 고칠 수 없어 확정이 곧 제안 그대로다(설계 §6.11).
    확정되는 순간 묶인 단위의 번역을 쓸어 낸다(_sweep_paired_translations).
    """
    pair.status = PAIR_CONFIRMED
    if pair.suggestion_id is not None:
        await adopt_suggestions(session, [pair.suggestion_id], actor, now())
    _record(session, document, "pair.confirm", pair.id, actor)
    await session.flush()
    unit_ids = await session.scalars(select(UnitPairMember.unit_id).where(UnitPairMember.pair_id == pair.id))
    await _sweep_paired_translations(session, document.bundle_id, list(unit_ids))


async def dissolve_pair(session: AsyncSession, document: Document, pair: UnitPair, actor: str) -> None:
    """짝 행을 지운다 — 사람이 푸는 것(delete_pair)과 판단이 갈려 서버가 푸는 것(pair_settle)이 함께 쓴다.

    아직 채택이 없는 AI 제안 짝을 풀면 버림으로 남긴다. 짝 행이 지워지면 제안을 찾을 길이 없어 지우기 전에 쓴다(이미 채택된 제안은 그대로).
    """
    pair_id = pair.id
    if pair.suggestion_id is not None:
        await reject_suggestions(session, [pair.suggestion_id], actor)
    await session.delete(pair)
    _record(session, document, "pair.delete", pair_id, actor)
    await session.flush()


async def build_pair_out(session: AsyncSession, pair: UnitPair) -> PairOut:
    unit_ids = await session.scalars(
        select(UnitPairMember.unit_id)
        .join(Unit, Unit.id == UnitPairMember.unit_id)
        .where(UnitPairMember.pair_id == pair.id)
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    return PairOut(id=pair.id, status=pair.status, source=pair.source, unit_ids=list(unit_ids))


async def _get_pair(session: AsyncSession, document: Document, pair_id: int) -> UnitPair:
    pair = await session.get(UnitPair, pair_id)
    if pair is None or pair.document_id != document.id:
        raise_rule(404, "pair_not_found", pair_id=pair_id)
    return pair


def _record(session: AsyncSession, document: Document, action: str, pair_id: int, actor: str) -> None:
    """짝 바꾸기는 문서 revision을 올리고 작업 기록을 남긴다(대상은 짝 id)."""
    document.revision += 1
    record_event(
        session, bundle_id=document.bundle_id, actor=actor, action=action, target_type="pair", target_ids=[pair_id]
    )
