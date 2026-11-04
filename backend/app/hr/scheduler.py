"""내장 HR 동기화 스케줄러 — 마지막 회차(hr_sync_runs) 기준으로 주기를 잇는 lifespan 백그라운드 루프."""

import asyncio
import logging
from datetime import datetime

from sqlalchemy import func, select

from app.clock import KST
from app.clock import now as now_kst
from app.db import SessionLocal
from app.hr import service as hr_service
from app.models import HrSyncRun
from app.settings import settings

logger = logging.getLogger(__name__)

# 마지막 회차가 한 주기보다 오래됐을 때 기동 뒤 기다리는 시간(초) — 배포 직후 기동 부하와 겹치지 않게
HR_SYNC_STARTUP_GRACE_SECONDS = 300


def get_first_hr_sync_delay(last_ran_at: datetime | None, now: datetime, interval_seconds: float) -> float:
    """첫 자동 동기화까지 기다릴 초 — 마지막 회차 기준으로 주기를 잇는다.

    기동마다 한 주기를 새로 기다리면 배포가 주기보다 잦을 때 자동 동기화가 돌지 않는다.
    회차 기록이 없으면(첫 설치) 한 주기 뒤 — 첫 실동기화는 드라이런을 거친 수동 절차로 한다.
    """
    if last_ran_at is None:
        return interval_seconds
    if last_ran_at.tzinfo is None:  # sqlite는 시간대 없이 KST 벽시계로 돌려준다
        last_ran_at = last_ran_at.replace(tzinfo=KST)
    elapsed = (now - last_ran_at).total_seconds()
    return max(HR_SYNC_STARTUP_GRACE_SECONDS, interval_seconds - elapsed)


async def run_hr_sync_loop() -> None:
    """내장 HR 동기화 스케줄러 — 마지막 회차에서 한 주기마다. lifespan이 태스크로 띄우고 종료 때 취소한다."""
    interval = settings.hr_sync_interval_hours * 3600
    try:
        async with SessionLocal() as session:
            last_ran_at = await session.scalar(select(func.max(HrSyncRun.ran_at)))
        delay = get_first_hr_sync_delay(last_ran_at, now_kst(), interval)
    except Exception:  # noqa: BLE001 -- 기록을 못 읽어도 스케줄러는 한 주기 뒤 돈다
        logger.exception("HR sync scheduler could not read the last run - waiting one interval")
        delay = interval
    logger.info("HR sync scheduler: first run in %d s", int(delay))
    while True:
        await asyncio.sleep(delay)
        delay = interval
        try:
            async with SessionLocal() as session:
                summary = await hr_service.run_full_sync(session)
                logger.info("scheduled HR sync: %s", summary)
        except hr_service.SyncTooSoon:
            pass  # 수동 sync 직후 겹침 — 다음 주기로
        except Exception:  # noqa: BLE001 -- 주기 실패가 프로세스를 죽이면 안 됨
            logger.exception("scheduled HR sync failed - retrying next interval")
