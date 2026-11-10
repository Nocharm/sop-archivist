"""최근 AI 작업 목록 — 내가 멤버인 묶음의 대기·실행 중 작업과 하루 안에 끝난 작업, 요청별 진행 수. 상단 바 표시가 읽는다."""

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, Row, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.sop.ai.constants import MAX_RECENT_JOBS, MAX_RECENT_REQUESTS, RECENT_JOBS_WINDOW_HOURS
from app.sop.ai.jobs import ACTIVE_JOB_STATUSES
from app.sop.ai.schemas import AiJobCounts, RecentJobOut, RecentJobsOut, RecentRequestOut
from app.sop.bundle_code import format_bundle_code
from app.sop.models import AiJob, Bundle, BundleMember, Document


@dataclass
class _RequestTally:
    """요청 하나의 집계 — 그룹 행(종류·상태·실패 코드별)을 접어 만든다."""

    bundle_id: int
    requested_by: str
    first_id: int
    first_kind: str
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    kinds: set[str] = field(default_factory=set)
    statuses: Counter[str] = field(default_factory=Counter)
    errors: Counter[str] = field(default_factory=Counter)


def _build_window_filter(login_id: str, since: datetime) -> list[ColumnElement[bool]]:
    """멤버십(역할 무관)으로 묶음을 거르고, 끝난 작업은 since 뒤에 끝난 것만 남긴다."""
    member_bundles = select(BundleMember.bundle_id).where(BundleMember.login_id == login_id)
    return [
        AiJob.bundle_id.in_(member_bundles),
        or_(AiJob.status.in_(ACTIVE_JOB_STATUSES), AiJob.finished_at >= since),
    ]


def _fold_request_rows(rows: Sequence[Row]) -> dict[str, _RequestTally]:
    tallies: dict[str, _RequestTally] = {}
    for request_id, bundle_id, requested_by, kind, status, error, count, first_id, created, started, finished in rows:
        tally = tallies.get(request_id)
        if tally is None:
            tally = tallies[request_id] = _RequestTally(bundle_id, requested_by, first_id, kind, created)
        if first_id < tally.first_id:
            tally.first_id, tally.first_kind = first_id, kind
        tally.created_at = min(tally.created_at, created)
        if started is not None:
            tally.started_at = started if tally.started_at is None else min(tally.started_at, started)
        if finished is not None:
            tally.finished_at = finished if tally.finished_at is None else max(tally.finished_at, finished)
        tally.kinds.add(kind)
        tally.statuses[status] += count
        if status == "failed":
            tally.errors[error] += count
    return tallies


async def _load_requests(
    session: AsyncSession, login_id: str, window: list[ColumnElement[bool]]
) -> tuple[list[str], dict[str, _RequestTally]]:
    """범위에 걸친 요청들의 모든 작업을 센다 — 일부만 범위에 든 요청도 total이 줄지 않게 범위가 아니라 요청으로 고른다."""
    window_requests = select(AiJob.request_id).where(*window).distinct()
    member_bundles = select(BundleMember.bundle_id).where(BundleMember.login_id == login_id)
    rows = await session.execute(
        select(
            AiJob.request_id, AiJob.bundle_id, AiJob.requested_by, AiJob.kind, AiJob.status, AiJob.error,
            func.count(), func.min(AiJob.id), func.min(AiJob.created_at), func.min(AiJob.started_at),
            func.max(AiJob.finished_at),
        )
        .where(AiJob.request_id.in_(window_requests), AiJob.bundle_id.in_(member_bundles))
        .group_by(AiJob.request_id, AiJob.bundle_id, AiJob.requested_by, AiJob.kind, AiJob.status, AiJob.error)
    )
    tallies = _fold_request_rows(rows.all())
    ordered = sorted(tallies, key=lambda request_id: tallies[request_id].first_id, reverse=True)
    return ordered, tallies


async def list_recent_jobs(session: AsyncSession, login_id: str) -> RecentJobsOut:
    """질의 넷(작업·전체 수·요청 집계·묶음 제목) — 원문·제안·payload는 읽지 않는다."""
    current = now()
    window = _build_window_filter(login_id, current - timedelta(hours=RECENT_JOBS_WINDOW_HOURS))
    job_rows = (
        await session.execute(
            select(
                AiJob.id, AiJob.request_id, AiJob.bundle_id, Bundle.title, AiJob.kind, AiJob.status, AiJob.error,
                AiJob.document_id, Document.title, Document.file_name, AiJob.unit_ids, AiJob.target_ids,
                AiJob.attempts, AiJob.requested_by, AiJob.created_at, AiJob.started_at, AiJob.finished_at,
            )
            .join(Bundle, Bundle.id == AiJob.bundle_id)
            .outerjoin(Document, Document.id == AiJob.document_id)
            .where(*window)
            .order_by(AiJob.id.desc())
            .limit(MAX_RECENT_JOBS)
        )
    ).all()
    jobs_total = await session.scalar(select(func.count()).select_from(AiJob).where(*window)) or 0
    ordered, tallies = await _load_requests(session, login_id, window)
    shown = ordered[:MAX_RECENT_REQUESTS]
    bundle_ids = {tallies[request_id].bundle_id for request_id in shown}
    titles = (
        dict((await session.execute(select(Bundle.id, Bundle.title).where(Bundle.id.in_(bundle_ids)))).all())
        if bundle_ids else {}
    )
    return RecentJobsOut(
        server_time=current,
        jobs=[
            RecentJobOut(
                id=job_id, request_id=request_id, bundle_id=bundle_id, bundle_code=format_bundle_code(bundle_id),
                bundle_title=bundle_title, kind=kind, status=status, error=error, document_id=document_id,
                document_title=document_title or "", document_file_name=file_name or "",
                unit_count=len(unit_ids), target_count=len(target_ids), attempts=attempts,
                requested_by_me=requested_by == login_id, created_at=created, started_at=started, finished_at=finished,
            )
            for (
                job_id, request_id, bundle_id, bundle_title, kind, status, error, document_id, document_title,
                file_name, unit_ids, target_ids, attempts, requested_by, created, started, finished,
            ) in job_rows
        ],
        jobs_total=jobs_total,
        requests=[_build_request_out(request_id, tallies[request_id], titles, login_id) for request_id in shown],
        requests_total=len(ordered),
    )


def _build_request_out(
    request_id: str, tally: _RequestTally, titles: dict[int, str], login_id: str
) -> RecentRequestOut:
    is_active = any(tally.statuses[status] for status in ACTIVE_JOB_STATUSES)
    return RecentRequestOut(
        request_id=request_id,
        bundle_id=tally.bundle_id,
        bundle_code=format_bundle_code(tally.bundle_id),
        bundle_title=titles.get(tally.bundle_id, ""),
        kind=tally.first_kind,
        kinds=sorted(tally.kinds),
        requested_by_me=tally.requested_by == login_id,
        total=sum(tally.statuses.values()),
        jobs=AiJobCounts.model_validate(tally.statuses),
        error_counts=dict(tally.errors),
        created_at=tally.created_at,
        started_at=tally.started_at,
        finished_at=None if is_active else tally.finished_at,
    )
