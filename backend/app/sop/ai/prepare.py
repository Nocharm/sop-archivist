"""배정 화면 첫 진입 prepare — 묶기 계획이 한 번도 없었으면 먼저 쌓고, 남은 줄의 미리 분류 작업을 문서마다 한 번만 쌓는다(설계 §5.2)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.settings import settings
from app.sop.ai.classify import CLASSIFY_KIND, select_classify_items
from app.sop.ai.jobs import JobItem, enqueue_jobs
from app.sop.ai.match_jobs import (
    MATCH_PLAN_KIND,
    PLAN_ORIGIN_PREPARE,
    PLAN_ORIGIN_USER,
    enqueue_auto_plan,
    has_assign_documents,
)
from app.sop.constants import AI_PRIORITY_PRE_CLASSIFY
from app.sop.match import list_identical_candidates
from app.sop.models import AiJob, Document

_HUMAN_PLAN_ORIGINS = (PLAN_ORIGIN_PREPARE, PLAN_ORIGIN_USER)  # 키 없는 옛 계획은 user로 읽는다


async def _has_run_plan_before(session: AsyncSession, bundle_id: int) -> bool:
    """origin이 prepare나 user인 계획 행이 상태와 상관없이 있는지."""
    payloads = await session.scalars(
        select(AiJob.payload).where(AiJob.bundle_id == bundle_id, AiJob.kind == MATCH_PLAN_KIND)
    )
    return any(payload.get("origin", PLAN_ORIGIN_USER) in _HUMAN_PLAN_ORIGINS for payload in payloads)


async def _list_unprepared_documents(session: AsyncSession, bundle_id: int, first: int | None) -> list[int]:
    """미리 돌린 분류 작업이 한 번도 없던 읽힌 Old 문서 — 문서 목록 순서이고 first는 맨 앞."""
    seen = set(
        await session.scalars(
            select(AiJob.document_id).where(
                AiJob.bundle_id == bundle_id, AiJob.kind == CLASSIFY_KIND, AiJob.background.is_(True),
                AiJob.document_id.is_not(None),
            )
        )
    )
    ready = await session.scalars(
        select(Document.id)
        .where(Document.bundle_id == bundle_id, Document.side == "old", Document.status == "ready")
        .order_by(Document.id)
    )
    documents = [document_id for document_id in ready if document_id not in seen]
    if first in documents:
        documents.remove(first)
        documents.insert(0, first)
    return documents


async def queue_prepare(session: AsyncSession, bundle_id: int, actor: str, *, document_id: int | None) -> list[AiJob]:
    """쌓은 분류 작업만 돌려준다(계획은 세지 않는다). 호출부가 묶음을 잠근 채 부르고 커밋한다."""
    if not (settings.ai_auto_prepare and settings.ai_enabled):
        return []
    if not await _has_run_plan_before(session, bundle_id):
        await enqueue_auto_plan(session, bundle_id, actor, origin=PLAN_ORIGIN_PREPARE)
    if not await has_assign_documents(session, bundle_id):
        return []
    documents = await _list_unprepared_documents(session, bundle_id, document_id)
    if not documents:
        return []
    # 글이 똑같은 1:1 후보는 사람이 한 번에 확정한다 — 짝이면 어느 쪽이든 후보일 때 줄 전체를 뺀다
    identical = {candidate.unit_id for candidate in await list_identical_candidates(session, bundle_id)}
    items: list[JobItem] = []
    for old_document_id in documents:
        selected, _ = await select_classify_items(session, bundle_id, document_id=old_document_id, unit_ids=None)
        items.extend(item for item in selected if identical.isdisjoint(item.unit_ids))
    return enqueue_jobs(
        session, bundle_id=bundle_id, kind=CLASSIFY_KIND, requested_by=actor, items=items,
        priority=AI_PRIORITY_PRE_CLASSIFY, background=True,
    )
