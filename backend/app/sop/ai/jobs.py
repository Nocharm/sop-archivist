"""AI 작업 큐의 DB 쪽 — 쌓기·취소·다시 시도·집계. 실행은 runner가 하고, 커밋은 모두 호출부가 해서 요청 기록과 한 트랜잭션으로 묶인다."""

from collections import Counter
from collections.abc import Collection, Sequence
from dataclasses import dataclass, field
from typing import NamedTuple

from sqlalchemy import ColumnElement, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.sop.ai.schemas import AiJobCounts
from app.sop.models import AiJob

ACTIVE_JOB_STATUSES = ("queued", "running")


@dataclass(frozen=True)
class JobItem:
    """쌓을 작업 한 줄 — 무엇을 하는지는 kind가 정하고 이 값은 대상과 종류별 인자만 담는다."""

    document_id: int | None = None
    unit_ids: Sequence[int] = field(default_factory=list)
    target_ids: Sequence[int] = field(default_factory=list)
    payload: dict[str, object] = field(default_factory=dict)


class JobBreakdown(NamedTuple):
    """상태 응답의 작업 집계."""

    jobs: AiJobCounts
    by_kind: dict[str, AiJobCounts]
    failed_errors: dict[str, int]


def _build_job_filter(bundle_id: int, kind: str | None) -> list[ColumnElement[bool]]:
    conditions = [AiJob.bundle_id == bundle_id]
    if kind is not None:
        conditions.append(AiJob.kind == kind)
    return conditions


def enqueue_jobs(
    session: AsyncSession, *, bundle_id: int, kind: str, requested_by: str, items: Sequence[JobItem]
) -> list[AiJob]:
    """행만 추가한다 — id는 flush 뒤에 생긴다."""
    jobs = [
        AiJob(
            bundle_id=bundle_id,
            kind=kind,
            status="queued",
            document_id=item.document_id,
            unit_ids=list(item.unit_ids),
            target_ids=list(item.target_ids),
            payload=item.payload,
            requested_by=requested_by,
        )
        for item in items
    ]
    session.add_all(jobs)
    return jobs


async def find_active_unit_ids(session: AsyncSession, bundle_id: int, kinds: Collection[str]) -> set[int]:
    """대기·실행 중 작업이 잡고 있는 단위들 — 같은 단위를 두 번 쌓지 않게 요청이 거른다."""
    rows = await session.scalars(
        select(AiJob.unit_ids).where(
            AiJob.bundle_id == bundle_id, AiJob.kind.in_(kinds), AiJob.status.in_(ACTIVE_JOB_STATUSES)
        )
    )
    return {unit_id for unit_ids in rows for unit_id in unit_ids}


async def cancel_active_jobs(session: AsyncSession, bundle_id: int, kind: str | None = None) -> int:
    """대기·실행 중 작업을 취소하고 건수를 돌려준다 — 실행 중이던 작업의 결과는 실행기가 버린다.

    UPDATE 한 문장이라 행도 원문도 읽지 않는다(검토 요청이 잠근 채 부른다).
    """
    result = await session.execute(
        update(AiJob)
        .where(*_build_job_filter(bundle_id, kind), AiJob.status.in_(ACTIVE_JOB_STATUSES))
        .values(status="cancelled", finished_at=now())
        .execution_options(synchronize_session=False)
    )
    return result.rowcount


async def retry_failed_jobs(session: AsyncSession, bundle_id: int, kind: str | None = None) -> int:
    """실패한 작업만 다시 쌓고 건수를 돌려준다 — 낡음·취소는 사람이 새로 요청한다."""
    result = await session.execute(
        update(AiJob)
        .where(*_build_job_filter(bundle_id, kind), AiJob.status == "failed")
        .values(status="queued", attempts=0, error="", started_at=None, finished_at=None)
        .execution_options(synchronize_session=False)
    )
    return result.rowcount


async def load_job_counts(session: AsyncSession, bundle_id: int) -> AiJobCounts:
    rows = await session.execute(
        select(AiJob.status, func.count()).where(AiJob.bundle_id == bundle_id).group_by(AiJob.status)
    )
    return AiJobCounts.model_validate({status: count for status, count in rows})


async def load_job_breakdown(session: AsyncSession, bundle_id: int) -> JobBreakdown:
    """전체·종류별 상태 수와 실패 코드별 수를 질의 한 번으로 읽는다."""
    rows = await session.execute(
        select(AiJob.kind, AiJob.status, AiJob.error, func.count())
        .where(AiJob.bundle_id == bundle_id)
        .group_by(AiJob.kind, AiJob.status, AiJob.error)
    )
    totals: Counter[str] = Counter()
    by_kind: dict[str, Counter[str]] = {}
    failed_errors: Counter[str] = Counter()
    for kind, status, error, count in rows:
        totals[status] += count
        by_kind.setdefault(kind, Counter())[status] += count
        if status == "failed":
            failed_errors[error] += count
    return JobBreakdown(
        jobs=AiJobCounts.model_validate(totals),
        by_kind={kind: AiJobCounts.model_validate(counts) for kind, counts in by_kind.items()},
        failed_errors=dict(failed_errors),
    )
