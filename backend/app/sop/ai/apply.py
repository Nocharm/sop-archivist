"""AI 결과 적용의 공용 조각 — 낡음 판정, 살아 있는 제안 찾기·밀어내기, 제안 행, 변경 종류 (설계 §6.8, §7.8, §8.3).

AI는 제안 기록(`ai_suggestions`)에만 쓴다 — 판단·새 문장·출처 연결·revision은 사람이 제안을 받을 때 사람의 저장이 쓴다
(설계 2026-11-19-ai-suggest-only D1). 묶음을 잠근 세션에서 쓰고 커밋은 실행기가 해서 작업 상태 전이와 한 트랜잭션이 된다.
"""

from collections.abc import Collection, Iterable, Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.detach import UNASSIGNED
from app.sop.groups import select_in_chunks
from app.sop.models import AiJob, AiSuggestion, Unit, UnitDecision
from app.sop.units import UNIT_ACTIVE

SUGGESTION_APPLIED = "applied"
SUGGESTION_STALE = "stale"
OFFERED_KINDS = ("classify", "match")  # 사람이 받아 판단에 잇는 제안 — 분류·묶기 모듈이 이 모듈을 불러 이름만 둔다


def can_receive_suggestion(status: str, disposition: str) -> bool:
    """AI가 제안할 수 있는 판단인가 — 미배정뿐이다. 판단은 늘 사람이 쓰므로 확정·보류는 사람의 것이다."""
    return status == UNASSIGNED and disposition == UNASSIGNED


async def load_open_decisions(session: AsyncSession, *, unit_ids: Collection[int]) -> dict[int, UnitDecision] | None:
    """단위가 모두 활성이고 미배정이면 {단위 id: 판단}, 하나라도 아니면 None — 작업은 짝을 한 덩어리로 다룬다."""
    rows = await select_in_chunks(
        session,
        lambda chunk: select(UnitDecision)
        .join(Unit, Unit.id == UnitDecision.unit_id)
        .where(UnitDecision.unit_id.in_(chunk), Unit.status == UNIT_ACTIVE),
        set(unit_ids),
    )
    if len(rows) != len(set(unit_ids)):
        return None
    if not all(can_receive_suggestion(row[0].status, row[0].disposition) for row in rows):
        return None
    return {row[0].unit_id: row[0] for row in rows}


async def load_fresh_decisions(
    session: AsyncSession, *, unit_ids: Collection[int], snapshot: Mapping[str, int]
) -> dict[int, UnitDecision] | None:
    """결과를 써도 되는 판단 — 단위가 활성·미배정이고 revision이 스냅숏과 같을 때만, 아니면 None(낡은 결과).

    AI는 revision을 올리지 않으니 revision이 달라졌으면 사람이 그 사이에 정했거나 지운 것이다. snapshot의 키는 JSON 칸이라 글자로 된 단위 id다.
    """
    decisions = await load_open_decisions(session, unit_ids=unit_ids)
    if decisions is None:
        return None
    if any(decision.revision != snapshot.get(str(unit_id)) for unit_id, decision in decisions.items()):
        return None
    return decisions


async def load_live_suggestions(
    session: AsyncSession, bundle_id: int, kinds: Collection[str], *, document_id: int | None = None
) -> list[AiSuggestion]:
    """살아 있는 제안 — 적용됐고 사람이 아직 정하지 않은(채택 없음) 그 종류의 제안. 어느 단위·새 문장의 것인지는 content에 있다.

    content가 JSON이라 문서로 좁혀 읽은 뒤 파이썬에서 가린다(find_covering). 받거나 버린 제안은 사람의 결정이라 다시 걷지 않는다.
    """
    conditions = [
        AiSuggestion.bundle_id == bundle_id, AiSuggestion.kind.in_(list(kinds)),
        AiSuggestion.result == SUGGESTION_APPLIED, AiSuggestion.adoption.is_(None),
    ]
    if document_id is not None:
        conditions.append(AiSuggestion.document_id == document_id)
    return list(await session.scalars(select(AiSuggestion).where(*conditions).order_by(AiSuggestion.id)))


def find_covering(
    suggestions: Iterable[AiSuggestion], *, unit_ids: Collection[int] = (), target_ids: Collection[int] = ()
) -> list[AiSuggestion]:
    """단위나 새 문장 하나라도 겹치는 제안 — 제안 하나가 짝·묶음 전체를 덮으므로 일부만 겹쳐도 통째로 그 제안이다."""
    units, targets = set(unit_ids), set(target_ids)
    return [
        suggestion for suggestion in suggestions
        if not units.isdisjoint(suggestion.content.get("unit_ids", ()))
        or not targets.isdisjoint(suggestion.content.get("target_ids", ()))
    ]


def list_covered_unit_ids(suggestions: Iterable[AiSuggestion]) -> set[int]:
    return {unit_id for suggestion in suggestions for unit_id in suggestion.content.get("unit_ids", ())}


def mark_stale(suggestions: Iterable[AiSuggestion]) -> None:
    """밀린 제안 — 같은 단위의 새 제안이 대신한다. 살아 있는 제안만 넘어오므로 채택이 남은 제안은 건드리지 않는다."""
    for suggestion in suggestions:
        suggestion.result = SUGGESTION_STALE


async def close_unused_suggestions(
    session: AsyncSession, bundle_id: int, *, unit_ids: Collection[int] = (), target_ids: Collection[int] = ()
) -> None:
    """사람이 제안을 받지 않고 확정한 줄의 살아 있는 분류·묶기 제안을 밀어낸다(stale) — 채택은 남기지 않는다(받은 것이 아니다).

    남기면 그 줄을 나중에 지웠을 때 문서 범위 분류가 `already_suggested`로 건너뛰고 짝 계획도 그 단위를 다루지 않는다. 받은 제안은
    저장이 이미 채택을 남겨 살아 있지 않다 — 채택 기록 뒤에 부른다.
    """
    if not unit_ids and not target_ids:
        return
    await session.flush()  # 같은 저장이 방금 남긴 채택이 살아 있는 제안 질의에 보이게
    live = await load_live_suggestions(session, bundle_id, OFFERED_KINDS)
    mark_stale(find_covering(live, unit_ids=unit_ids, target_ids=target_ids))


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
