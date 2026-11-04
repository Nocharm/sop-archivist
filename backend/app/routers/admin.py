"""관리 운영 API — HR 동기화 실행·프리뷰·이력, 배치 작업 상태, 사내 AI 연결 점검(ping)·일별 사용량.

엔드포인트마다 필요한 권한이 달라 라우터 단 게이트를 두지 않는다. 새 엔드포인트는 자기 권한을
의존성으로 직접 걸어야 하고, 빠뜨리면 test_admin_ops의 라우트 순회 테스트가 잡는다.
"""

import json
import logging
import time
from collections.abc import Iterable
from datetime import date, datetime, timedelta
from typing import Annotated

import httpx2
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AfterValidator, BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.deps import require_permission
from app.ai_client import resolve_endpoint
from app.ai_usage import call_ai_recorded
from app.clock import KST, now
from app.db import get_session
from app.hr.service import SyncTooSoon, build_sync_preview, get_upstream_status, run_full_sync
from app.models import AiUsageEvent, BatchJobRun, HrSyncRun
from app.settings import settings

logger = logging.getLogger(__name__)

_require_directory_sync = require_permission("directory.sync")
_require_system_view = require_permission("system.view")
_require_ai_admin = require_permission("ai.admin")

router = APIRouter(prefix="/api/admin", tags=["admin"])

# 회차 이력 한 번에 돌려주는 기본·최대 건수 — 큰 limit은 거부하지 않고 최대로 자른다
DEFAULT_HR_RUNS_LIMIT = 20
MAX_HR_RUNS_LIMIT = 200

# 일별 사용량 조회 기간(일) 기본·최대 — 범위 밖은 422
DEFAULT_AI_USAGE_DAYS = 30
MAX_AI_USAGE_DAYS = 365

# ping 요청 — 직원 정보 없이 고정 문구만 보낸다. 사고는 최소(low)로, 응답 상한 256이면 사고 토큰 포함해도 충분하다
AI_PING_FEATURE = "ping"
AI_PING_SYSTEM_PROMPT = 'Reply with the JSON object {"ok": true}.'
AI_PING_USER_MESSAGE = "ping"
AI_PING_MAX_TOKENS = 256


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


class AiPingOut(BaseModel):
    """AI 연결 점검 결과 — ok는 연결 성공(응답을 받았다), reply_ok는 모델이 요청대로 {"ok": true}를 돌려줬는지."""

    ok: bool
    model: str
    latency_ms: int
    reply_ok: bool


class AiUsageDayOut(BaseModel):
    """KST 하루치 AI 호출 집계 — failed는 ok=False 호출 수, 토큰이 없던 호출은 0으로 합산."""

    date: date
    calls: int
    failed: int
    prompt_tokens: int
    completion_tokens: int


def _build_hr_source_error(exc: httpx2.HTTPError) -> HTTPException:
    """상류 HR 호출 실패 -> 502. 문구는 상태 코드나 예외 클래스명만 — 예외 메시지에는 웹훅 주소가 들어 있다."""
    logger.exception("HR source request failed")  # 원문은 서버 로그에만
    status = get_upstream_status(exc)
    return HTTPException(
        status_code=502, detail=f"HR source error: {type(exc).__name__ if status is None else status}"
    )


async def _require_hr_sync(login_id: str = Depends(_require_directory_sync)) -> str:
    """directory.sync 보유자에게만, HR이 설정돼 있을 때 hr-sync 계열을 연다.

    권한 판정이 설정 판정보다 먼저 돈다(의존성 순서) — 권한 없는 사람은 설정 상태를 알 수 없다.
    """
    if not settings.hr_enabled:
        raise HTTPException(status_code=503, detail="HR sync is not configured")
    return login_id


@router.post("/hr-sync", response_model=HrSyncSummaryOut, dependencies=[Depends(_require_hr_sync)])
async def run_hr_sync(session: AsyncSession = Depends(get_session)) -> HrSyncSummaryOut:
    # 중단(aborted_reason)은 오류가 아니라 요약으로 돌려준다. 상류 HR 오류는 서비스가 실패 기록을 남긴 뒤 올라오고 502가 된다.
    try:
        summary = await run_full_sync(session)
    except SyncTooSoon as exc:
        raise HTTPException(status_code=409, detail="sync ran too recently") from exc
    except httpx2.HTTPError as exc:
        raise _build_hr_source_error(exc) from exc
    return HrSyncSummaryOut.model_validate(summary)


@router.get("/hr-sync/preview", response_model=HrSyncPreviewOut, dependencies=[Depends(_require_hr_sync)])
async def get_hr_sync_preview(session: AsyncSession = Depends(get_session)) -> HrSyncPreviewOut:
    """DB 무변경 드라이런 — 5분 가드를 쓰지 않고, 실패해도 기록을 남기지 않는다."""
    try:
        preview = await build_sync_preview(session)
    except httpx2.HTTPError as exc:
        raise _build_hr_source_error(exc) from exc
    return HrSyncPreviewOut.model_validate(preview)


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


def _build_ai_error(exc: Exception) -> HTTPException:
    """상류 AI 호출 실패 -> 502. 문구는 HTTP 상태 코드나 예외 클래스명만 — 예외 메시지에는 AI 주소가 들어 있다."""
    logger.exception("AI endpoint request failed")  # 원문은 서버 로그에만 (토큰은 헤더에만 있어 메시지에 없다)
    status = get_upstream_status(exc)
    return HTTPException(
        status_code=502, detail=f"AI endpoint error: {type(exc).__name__ if status is None else status}"
    )


def _is_ping_reply_ok(content: str) -> bool:
    """답이 JSON 객체이고 ok가 정확히 true인가 — 문자열 "true"나 1은 아니다."""
    try:
        parsed = json.loads(content)
    except ValueError:
        return False
    return isinstance(parsed, dict) and parsed.get("ok") is True


def _sum_usage_by_kst_day(
    rows: Iterable[tuple[datetime, bool, int | None, int | None]],
) -> list[AiUsageDayOut]:
    """(시각, ok, 프롬프트 토큰, 응답 토큰) 행을 KST 날짜별로 합산해 날짜 오름차순으로 돌려준다.

    날짜 묶기는 DB의 date()가 아니라 여기서 한다 — sqlite는 KST 벽시계로, Postgres는 UTC로 돌려줘 SQL로는 갈라진다.
    """
    totals: dict[date, list[int]] = {}
    for occurred_at, ok, prompt_tokens, completion_tokens in rows:
        day = totals.setdefault(_normalize_to_kst(occurred_at).date(), [0, 0, 0, 0])
        day[0] += 1
        day[1] += 0 if ok else 1
        day[2] += prompt_tokens or 0
        day[3] += completion_tokens or 0
    return [
        AiUsageDayOut(date=day, calls=calls, failed=failed, prompt_tokens=prompt, completion_tokens=completion)
        for day, (calls, failed, prompt, completion) in sorted(totals.items())
    ]


async def _require_ai_enabled(login_id: str = Depends(_require_ai_admin)) -> str:
    """ai.admin 보유자에게만, AI가 켜져 있을 때 ping을 연다 — 권한 판정이 먼저라 권한 없는 사람은 설정 상태를 알 수 없다."""
    if not settings.ai_enabled:
        raise HTTPException(status_code=503, detail="AI is disabled")
    return login_id


@router.post("/ai/ping", response_model=AiPingOut)
async def ping_ai(
    login_id: str = Depends(_require_ai_enabled), session: AsyncSession = Depends(get_session)
) -> AiPingOut:
    """사내 AI에 고정 문구 한 번을 보내 연결을 점검한다 — 성공·실패 모두 사용량 행이 남는다."""
    started = time.perf_counter()
    try:
        reply = await call_ai_recorded(
            session,
            login_id=login_id,
            feature=AI_PING_FEATURE,
            messages=[
                {"role": "system", "content": AI_PING_SYSTEM_PROMPT},
                {"role": "user", "content": AI_PING_USER_MESSAGE},
            ],
            reasoning="low",
            max_tokens=AI_PING_MAX_TOKENS,
        )
    except SQLAlchemyError:
        raise  # 사용량 저장 실패는 AI 오류가 아니다 — 502로 둔갑시키지 않고 500으로 드러낸다
    except Exception as exc:  # noqa: BLE001 -- HTTP·설정·응답 형식 오류 모두 "AI 연결 문제"로 502 변환
        raise _build_ai_error(exc) from exc
    # 사용량 기록 커밋 시간이 포함된다(수 ms) — 연결 점검 용도라 분리하지 않는다
    latency_ms = round((time.perf_counter() - started) * 1000)
    _endpoint, model_id = resolve_endpoint(None)
    return AiPingOut(ok=True, model=model_id, latency_ms=latency_ms, reply_ok=_is_ping_reply_ok(reply.content))


@router.get("/ai/usage", response_model=list[AiUsageDayOut], dependencies=[Depends(_require_ai_admin)])
async def list_ai_usage(
    days: int = Query(DEFAULT_AI_USAGE_DAYS, ge=1, le=MAX_AI_USAGE_DAYS),
    session: AsyncSession = Depends(get_session),
) -> list[AiUsageDayOut]:
    """오늘을 포함한 최근 days개 KST 날짜별 호출 집계(오름차순). 호출이 없던 날은 줄이 없다."""
    # 첫 날을 KST 자정부터 잡아 맨 앞 날짜가 부분 집계로 어긋나지 않게 한다
    since = datetime.combine(now().date() - timedelta(days=days - 1), datetime.min.time(), tzinfo=KST)
    rows = await session.execute(
        select(
            AiUsageEvent.occurred_at, AiUsageEvent.ok, AiUsageEvent.prompt_tokens, AiUsageEvent.completion_tokens
        ).where(AiUsageEvent.occurred_at >= since)
    )
    return _sum_usage_by_kst_day(rows.all())
