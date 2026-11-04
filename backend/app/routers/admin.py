"""관리 운영 API — HR 동기화 실행·프리뷰·이력과 배치 작업 상태.

엔드포인트마다 필요한 권한이 달라 라우터 단 게이트를 두지 않는다. 새 엔드포인트는 자기 권한을
의존성으로 직접 걸어야 하고, 빠뜨리면 test_admin_ops의 라우트 순회 테스트가 잡는다.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AfterValidator, BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.deps import require_permission
from app.clock import KST
from app.db import get_session
from app.hr.service import SyncTooSoon, build_sync_preview, run_full_sync
from app.models import BatchJobRun, HrSyncRun
from app.settings import settings

_require_directory_sync = require_permission("directory.sync")
_require_system_view = require_permission("system.view")

router = APIRouter(prefix="/api/admin", tags=["admin"])

# 회차 이력 한 번에 돌려주는 기본·최대 건수 — 큰 limit은 거부하지 않고 최대로 자른다
DEFAULT_HR_RUNS_LIMIT = 20
MAX_HR_RUNS_LIMIT = 200


def _normalize_to_kst(value: datetime) -> datetime:
    # sqlite는 시간대 없이 KST 벽시계로, Postgres(asyncpg)는 UTC로 돌려준다 — 응답은 어느 DB든 KST 오프셋으로 맞춘다
    return value.replace(tzinfo=KST) if value.tzinfo is None else value.astimezone(KST)


KstDatetime = Annotated[datetime, AfterValidator(_normalize_to_kst)]


class HrSyncSummaryOut(BaseModel):
    """HR 전체 동기화 요약 — HrSyncSummary 필드 그대로. 변경 인원 목록(changes)은 회차 이력 전용이라 뺀다."""

    model_config = ConfigDict(from_attributes=True)

    scanned: int
    upserted: int
    deactivated: int
    deleted: int
    skipped: int
    org_mismatches: int
    truncated_levels: int
    departments_upserted: int
    aborted_reason: str | None
    created: int
    reactivated: int
    duplicates: int
    managed: int
    mass_departure: bool


class HrSyncPreviewOut(BaseModel):
    """이행 드라이런 리포트 — HrSyncPreview 필드 그대로(샘플 리스트는 서비스가 50개로 자른다)."""

    model_config = ConfigDict(from_attributes=True)

    scanned: int
    skipped: int
    would_upsert: int
    would_deactivate: int
    would_delete: int
    org_mismatches: int
    truncated_levels: int
    korean_overwrites: int
    new_login_ids: list[str]
    delete_login_ids: list[str]
    case_mismatches: list[str]


class HrSyncRunOut(BaseModel):
    """HR 동기화 회차 요약 — 바뀐 사람 목록(changes)은 수천 명일 수 있어 목록에 싣지 않는다."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    ran_at: KstDatetime
    outcome: str
    detail: str | None
    scanned: int
    created: int
    deactivated: int
    reactivated: int
    deleted: int
    skipped: int
    duplicates: int
    managed: int
    mass_departure: bool


class BatchRunOut(BaseModel):
    """배치 작업 실행 기록 — (job, outcome)별 최신 1행."""

    model_config = ConfigDict(from_attributes=True)

    job: str
    outcome: str
    ran_at: KstDatetime
    detail: str | None


async def _require_hr_sync(login_id: str = Depends(_require_directory_sync)) -> str:
    """directory.sync 보유자에게만, HR이 설정돼 있을 때 hr-sync 계열을 연다.

    권한 판정이 설정 판정보다 먼저 돈다(의존성 순서) — 권한 없는 사람은 설정 상태를 알 수 없다.
    """
    if not settings.hr_enabled:
        raise HTTPException(status_code=503, detail="HR sync is not configured")
    return login_id


@router.post("/hr-sync", response_model=HrSyncSummaryOut, dependencies=[Depends(_require_hr_sync)])
async def run_hr_sync(session: AsyncSession = Depends(get_session)) -> HrSyncSummaryOut:
    # 중단(aborted_reason)은 오류가 아니라 요약으로 돌려준다. 상류 HR 오류는 서비스가 실패 기록을 남기고 그대로 올린다.
    try:
        summary = await run_full_sync(session)
    except SyncTooSoon as exc:
        raise HTTPException(status_code=409, detail="sync ran too recently") from exc
    return HrSyncSummaryOut.model_validate(summary)


@router.get("/hr-sync/preview", response_model=HrSyncPreviewOut, dependencies=[Depends(_require_hr_sync)])
async def get_hr_sync_preview(session: AsyncSession = Depends(get_session)) -> HrSyncPreviewOut:
    """DB 무변경 드라이런 — 5분 가드를 쓰지 않는다."""
    return HrSyncPreviewOut.model_validate(await build_sync_preview(session))


@router.get("/hr-sync/runs", response_model=list[HrSyncRunOut], dependencies=[Depends(_require_hr_sync)])
async def list_hr_sync_runs(
    limit: int = Query(DEFAULT_HR_RUNS_LIMIT, ge=1),
    session: AsyncSession = Depends(get_session),
) -> list[HrSyncRun]:
    # 시각이 같은 회차가 있어도 순서가 흔들리지 않게 autoincrement id로 최신순을 정한다
    rows = await session.scalars(
        select(HrSyncRun).order_by(HrSyncRun.id.desc()).limit(min(limit, MAX_HR_RUNS_LIMIT))
    )
    return list(rows)


@router.get("/batch-runs", response_model=list[BatchRunOut], dependencies=[Depends(_require_system_view)])
async def list_batch_runs(session: AsyncSession = Depends(get_session)) -> list[BatchJobRun]:
    rows = await session.scalars(select(BatchJobRun).order_by(BatchJobRun.job, BatchJobRun.outcome))
    return list(rows)
