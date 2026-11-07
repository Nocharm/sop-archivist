"""AI API — 분류 요청(작성자, AI가 켜져 있을 때)과 작업 현황(멤버)·취소·실패분 다시 시도(작성자, 작업 중 묶음만). 뒤의 세 경로는 AI가 꺼져 있어도 동작한다."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.settings import settings
from app.sop.ai.classify import CLASSIFY_KIND, select_classify_items
from app.sop.ai.jobs import (
    build_request_out,
    cancel_active_jobs,
    enqueue_jobs,
    load_job_breakdown,
    retry_failed_jobs,
)
from app.sop.ai.schemas import AiRequestOut, AiStatusOut, CancelOut, JobKindIn, RetryOut, ScopeIn
from app.sop.constants import MEMBER_ROLES
from app.sop.errors import raise_rule
from app.sop.events import record_event
from app.sop.membership import BundleContext, ensure_editable, lock_bundle, require_bundle_role

router = APIRouter(prefix="/api/bundles/{bundle_id}/ai", tags=["sop-ai"])

_require_author = require_bundle_role("author")
_require_member = require_bundle_role(*MEMBER_ROLES)


def require_ai_enabled() -> None:
    """LLM을 쓰는 요청(분류·번역·짝 맞추기·나누기)의 의존성 — 사람 경로는 AI가 꺼져 있어도 그대로라 여기에만 건다."""
    if not settings.ai_enabled:
        raise_rule(503, "ai_disabled")


@router.post("/classify", response_model=AiRequestOut, dependencies=[Depends(require_ai_enabled)])
async def request_classify(
    body: ScopeIn,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> AiRequestOut:
    await lock_bundle(session, ctx.bundle)
    ensure_editable(ctx.bundle)
    items, skipped = await select_classify_items(
        session, ctx.bundle.id, document_id=body.document_id, unit_ids=body.unit_ids
    )
    jobs = enqueue_jobs(session, bundle_id=ctx.bundle.id, kind=CLASSIFY_KIND, requested_by=ctx.login_id, items=items)
    if jobs:  # 쌓인 게 없으면 바뀐 것도 없으니 기록도 남기지 않는다
        await session.flush()
        record_event(
            session, bundle_id=ctx.bundle.id, actor=ctx.login_id, action="ai.request", target_type="ai_job",
            target_ids=[job.id for job in jobs], reason=CLASSIFY_KIND,
        )
    await session.commit()
    return build_request_out(len(jobs), skipped)


@router.get("/status", response_model=AiStatusOut)
async def get_ai_status(
    ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> AiStatusOut:
    breakdown = await load_job_breakdown(session, ctx.bundle.id)
    return AiStatusOut(
        ai_enabled=settings.ai_enabled,
        embed_enabled=settings.embed_enabled,
        jobs=breakdown.jobs,
        by_kind=breakdown.by_kind,
        failed_errors=breakdown.failed_errors,
        adoption={},  # 계획 2: 채택 기록이 생기면 kind별 채택률을 싣는다
    )


@router.post("/cancel", response_model=CancelOut)
async def cancel_jobs(
    body: JobKindIn = JobKindIn(),  # 계약이 {kind?}라 본문 없는 POST도 "모든 종류"다
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> CancelOut:
    await lock_bundle(session, ctx.bundle)
    ensure_editable(ctx.bundle)
    cancelled = await cancel_active_jobs(session, ctx.bundle.id, body.kind)
    record_event(
        session, bundle_id=ctx.bundle.id, actor=ctx.login_id, action="ai.cancel", target_type="ai_job",
        reason=f"count={cancelled}",
    )
    await session.commit()
    return CancelOut(cancelled=cancelled)


@router.post("/retry", response_model=RetryOut)
async def retry_jobs(
    body: JobKindIn = JobKindIn(),
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> RetryOut:
    await lock_bundle(session, ctx.bundle)
    ensure_editable(ctx.bundle)
    queued = await retry_failed_jobs(session, ctx.bundle.id, body.kind)
    record_event(
        session, bundle_id=ctx.bundle.id, actor=ctx.login_id, action="ai.retry", target_type="ai_job",
        reason=f"count={queued}",
    )
    await session.commit()
    return RetryOut(queued=queued)
