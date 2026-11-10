"""최근 AI 작업 목록 — 내가 멤버인 묶음의 대기·실행 중 작업과 하루 안에 끝난 작업, 요청별 진행 수. 상단 바 표시가 읽는다."""

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import CompoundSelect, Row, func, select, union
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


def _build_window_ids(login_id: str, since: datetime) -> CompoundSelect:
    """범위 안 작업 id — 대기·실행 중과 since 뒤에 끝난 작업을 따로 골라 합친다.

    OR 한 조건으로 쓰면 인덱스를 못 탄다. 앞쪽은 (status, id), 뒤쪽은 (bundle_id, finished_at) 인덱스가 찾는다.
    멤버십(역할 무관)으로 묶음을 거른다. 바깥 질의가 같은 표라 자동 상관을 끈다.
    """
    member_bundles = select(BundleMember.bundle_id).where(BundleMember.login_id == login_id)
    active = select(AiJob.id).where(AiJob.status.in_(ACTIVE_JOB_STATUSES), AiJob.bundle_id.in_(member_bundles))
    finished = select(AiJob.id).where(AiJob.bundle_id.in_(member_bundles), AiJob.finished_at >= since)
    return union(active.correlate(None), finished.correlate(None))


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


async def _load_requests(session: AsyncSession, window_ids: CompoundSelect) -> tuple[list[str], int, dict[str, _RequestTally]]:
    """범위에 걸친 요청 중 최신 MAX_RECENT_REQUESTS개(범위 안 첫 작업 id 순)를 SQL에서 자른 뒤, 그 요청들의 모든 작업을 센다.

    일부만 범위에 든 요청도 total이 줄지 않게 범위가 아니라 요청 id로 센다(request_id 인덱스).
    """
    in_window = AiJob.id.in_(window_ids)
    shown = list(
        await session.scalars(
            select(AiJob.request_id)
            .where(in_window)
            .group_by(AiJob.request_id)
            .order_by(func.min(AiJob.id).desc())
            .limit(MAX_RECENT_REQUESTS)
        )
    )
    total = await session.scalar(select(func.count(AiJob.request_id.distinct())).where(in_window)) or 0
    if not shown:
        return [], total, {}
    rows = await session.execute(
        select(
            AiJob.request_id, AiJob.bundle_id, AiJob.requested_by, AiJob.kind, AiJob.status, AiJob.error,
            func.count(), func.min(AiJob.id), func.min(AiJob.created_at), func.min(AiJob.started_at),
            func.max(AiJob.finished_at),
        )
        .where(AiJob.request_id.in_(shown))
        .group_by(AiJob.request_id, AiJob.bundle_id, AiJob.requested_by, AiJob.kind, AiJob.status, AiJob.error)
    )
    return shown, total, _fold_request_rows(rows.all())


async def list_recent_jobs(session: AsyncSession, login_id: str) -> RecentJobsOut:
    """질의 여섯(작업 쪽·작업 수·요청 쪽·요청 수·요청 집계·묶음 제목), 모두 인덱스로 범위를 찾는다 — 원문·제안·payload는 읽지 않는다."""
    current = now()
    window_ids = _build_window_ids(login_id, current - timedelta(hours=RECENT_JOBS_WINDOW_HOURS))
    job_rows = (
        await session.execute(
            select(
                AiJob.id, AiJob.request_id, AiJob.bundle_id, Bundle.title, AiJob.kind, AiJob.status, AiJob.error,
                AiJob.document_id, Document.title, Document.file_name, AiJob.unit_ids, AiJob.target_ids,
                AiJob.attempts, AiJob.requested_by, AiJob.created_at, AiJob.started_at, AiJob.finished_at,
            )
            .join(Bundle, Bundle.id == AiJob.bundle_id)
            .outerjoin(Document, Document.id == AiJob.document_id)
            .where(AiJob.id.in_(window_ids))
            .order_by(AiJob.id.desc())
            .limit(MAX_RECENT_JOBS)
        )
    ).all()
    jobs_total = await session.scalar(select(func.count()).select_from(AiJob).where(AiJob.id.in_(window_ids))) or 0
    shown, requests_total, tallies = await _load_requests(session, window_ids)
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
        requests_total=requests_total,
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
