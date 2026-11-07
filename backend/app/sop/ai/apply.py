"""AI 결과 적용의 공용 조각 — 낡음 판정, 밀린 제안 걷기, 제안 행, 무효 보류, 변경 종류 (설계 §6.8, §7.8, §8.3).

묶음을 잠근 세션에서 쓰고 커밋은 실행기가 해서 작업 상태 전이와 한 트랜잭션이 된다.
"""

from collections.abc import Collection, Iterable, Mapping, Sequence

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import SYSTEM_HOLD_AI_INVALID
from app.sop.detach import ON_HOLD, UNASSIGNED
from app.sop.groups import iter_chunks, select_in_chunks
from app.sop.models import AiJob, AiSuggestion, TargetSentence, Unit, UnitDecision
from app.sop.units import UNIT_ACTIVE

AI_SUGGESTED = "ai_suggested"


def can_receive_suggestion(status: str, disposition: str, suggestion_kind: str | None, kinds: Collection[str]) -> bool:
    """AI가 쓸 수 있는 판단인가 — 미배정이거나 같은 종류 AI 제안 위뿐이다. 확정·보류는 사람이 먼저 지운다(설계 §6.8)."""
    if status == UNASSIGNED:
        return disposition == UNASSIGNED
    return status == AI_SUGGESTED and suggestion_kind in kinds


async def load_open_decisions(
    session: AsyncSession, *, unit_ids: Collection[int], kinds: Collection[str]
) -> dict[int, UnitDecision] | None:
    """단위가 모두 활성이고 AI가 쓸 수 있는 판단이면 {단위 id: 판단}, 하나라도 아니면 None — 작업은 짝을 한 덩어리로 다룬다."""
    rows = await select_in_chunks(
        session,
        lambda chunk: select(UnitDecision, AiSuggestion.kind)
        .join(Unit, Unit.id == UnitDecision.unit_id)
        .outerjoin(AiSuggestion, AiSuggestion.id == UnitDecision.suggestion_id)
        .where(UnitDecision.unit_id.in_(chunk), Unit.status == UNIT_ACTIVE),
        set(unit_ids),
    )
    if len(rows) != len(set(unit_ids)):
        return None
    if not all(can_receive_suggestion(row[0].status, row[0].disposition, row[1], kinds) for row in rows):
        return None
    return {row[0].unit_id: row[0] for row in rows}


async def load_fresh_decisions(
    session: AsyncSession, *, unit_ids: Collection[int], snapshot: Mapping[str, int], kinds: Collection[str]
) -> dict[int, UnitDecision] | None:
    """결과를 써도 되는 판단 — 단위가 활성이고 revision이 스냅숏과 같고 AI가 쓸 수 있을 때만, 아니면 None(낡은 결과).

    snapshot의 키는 JSON 칸이라 글자로 된 단위 id다.
    """
    decisions = await load_open_decisions(session, unit_ids=unit_ids, kinds=kinds)
    if decisions is None:
        return None
    if any(decision.revision != snapshot.get(str(unit_id)) for unit_id, decision in decisions.items()):
        return None
    return decisions


def _clear_decision(decision: UnitDecision) -> None:
    """제안이 채운 처분을 비운다 — 사람이 정한 값은 AI가 쓸 수 있는 판단에 없으므로 사유·이동 대상은 건드리지 않는다."""
    decision.status, decision.disposition, decision.suggestion_id = UNASSIGNED, UNASSIGNED, None


async def clear_previous_suggestion(session: AsyncSession, decisions: Iterable[UnitDecision]) -> None:
    """밀리는 AI 제안을 걷는다 — 제안은 stale, 그 ai_suggested 새 문장은 삭제(출처·칸 새 문장은 DB CASCADE), 판단은 비운 상태로.

    제안 하나가 짝 전체를 덮으므로 일부 단위만 다시 받아도 제안을 통째로 걷는다. 남기면 새 문장 없는 ai_suggested 판단이 생긴다.
    사람이 확정·보류한 구성원의 판단과 새 문장은 같은 제안을 가리켜도 그대로 둔다 — 아래 두 상태 조건이 그 경계다.
    넘긴 판단의 revision은 곧 쓸 새 상태가 올리므로 여기서 올리지 않고, 함께 걷힌 다른 단위의 판단만 올린다.
    """
    given = list(decisions)
    replaced = {
        decision.suggestion_id
        for decision in given
        if decision.status == AI_SUGGESTED and decision.suggestion_id is not None
    }
    for decision in given:
        _clear_decision(decision)
    if not replaced:
        return
    await session.flush()  # 넘긴 판단은 제안에서 떨어졌으니 아래 질의에는 함께 덮인 다른 단위만 나온다
    siblings = await select_in_chunks(
        session,
        lambda chunk: select(UnitDecision).where(UnitDecision.suggestion_id.in_(chunk), UnitDecision.status == AI_SUGGESTED),
        replaced,
    )
    for (sibling,) in siblings:
        _clear_decision(sibling)
        sibling.revision += 1
    for chunk in iter_chunks(replaced):
        await session.execute(
            update(AiSuggestion)
            .where(AiSuggestion.id.in_(chunk))
            .values(result="stale")
            .execution_options(synchronize_session=False)
        )
        await session.execute(
            delete(TargetSentence)
            .where(TargetSentence.suggestion_id.in_(chunk), TargetSentence.status == AI_SUGGESTED)
            .execution_options(synchronize_session=False)
        )


def add_suggestion(
    session: AsyncSession,
    job: AiJob,
    *,
    content: dict[str, object],
    warnings: Sequence[dict[str, str]] = (),
    result: str,
    guideline_versions: dict[str, int] | None = None,
    model: str = "",
    input_refs: dict[str, object] | None = None,
) -> AiSuggestion:
    """제안 행을 더한다 — id는 flush 뒤에 생긴다."""
    suggestion = AiSuggestion(
        job_id=job.id,
        bundle_id=job.bundle_id,
        kind=job.kind,
        document_id=job.document_id,
        content=content,
        warnings=list(warnings),
        result=result,
        guideline_versions=guideline_versions or {},
        model=model,
        input_refs=input_refs or {},
    )
    session.add(suggestion)
    return suggestion


def hold_invalid(decisions: Iterable[UnitDecision]) -> None:
    """규칙을 어긴 응답의 단위를 보류로 — 그 단위만 사람이 보게 하고 나머지 작업은 그대로 간다."""
    for decision in decisions:
        decision.status, decision.hold_reason = ON_HOLD, SYSTEM_HOLD_AI_INVALID
        decision.revision += 1


def decide_ai_change_type(sources: Sequence[Unit], text: str, requested: str, *, sentence_count: int) -> str:
    """AI 새 문장의 변경 종류 — 구조에서 나오는 합침·나눔이 먼저, 그다음 글자 비교다(사람 저장의 판정과 같은 순서).

    원문과 다른 글을 AI가 그대로라고 해도 결과물에 그대로라고 적히면 안 되므로 고쳐 씀으로 둔다.
    """
    if len(sources) >= 2:
        return "merged"
    if sentence_count >= 2:
        return "split"
    if text == sources[0].text:
        return "as_is"
    return "rewritten" if requested == "as_is" else requested
