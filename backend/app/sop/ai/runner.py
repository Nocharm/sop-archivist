"""AI 작업 실행기 — 큐에서 꺼낸 작업을 load(짧은 세션) → compute(세션 없음) → apply(묶음 잠금) 세 단계로 돌린다 (설계 §8.2·§8.3).

AI 호출 동안 DB 연결을 잡지 않고, 늦게 온 결과는 묶음을 잠근 뒤 상태를 다시 보고서야 쓴다. 로그에는 작업 ID와 예외 클래스 이름만 남긴다.
"""

import asyncio
import logging
from collections.abc import Mapping
from typing import Protocol

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.db import SessionLocal
from app.settings import settings
from app.sop.ai.constants import AI_POLL_SECONDS, MAX_JOB_ATTEMPTS
from app.sop.models import AiJob, Bundle

logger = logging.getLogger(__name__)


class AiCallFailed(Exception):
    """AI 호출이 끝내 실패했다 — code는 작업 행과 상태 응답에 그대로 쓰는 정해진 실패 코드다."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class JobHandler(Protocol):
    """작업 종류 하나의 세 단계. load가 None이면 stale로 끝나고 compute는 세션 없이 돈다.

    apply는 묶음이 잠긴 세션에서 쓰고 최종 상태를 돌려준다. 커밋은 실행기가 해서 상태 전이와 한 트랜잭션이 된다.
    """

    async def load(self, session: AsyncSession, job: AiJob) -> object | None: ...

    async def compute(self, job: AiJob, loaded: object) -> object: ...

    async def apply(self, session: AsyncSession, job: AiJob, loaded: object, computed: object) -> str: ...


async def claim_next_job() -> int | None:
    """queued 중 가장 작은 id를 running으로 꺼낸다 — 단일 워커 전제라 꺼내는 쪽끼리는 겨루지 않고, 조건은 그사이 온 취소만 막는다."""
    async with SessionLocal() as session:
        job_id = await session.scalar(select(func.min(AiJob.id)).where(AiJob.status == "queued"))
        if job_id is None:
            return None
        result = await session.execute(
            update(AiJob)
            .where(AiJob.id == job_id, AiJob.status == "queued")
            .values(status="running", attempts=AiJob.attempts + 1, started_at=now())
        )
        await session.commit()
    return job_id if result.rowcount else None


async def _finish_running_job(job_id: int, status: str, error: str = "") -> None:
    """아직 running인 작업만 끝낸다 — 그사이 취소됐으면 취소가 남고, 묶음과 함께 지워졌으면 아무 일도 없다."""
    async with SessionLocal() as session:
        await session.execute(
            update(AiJob)
            .where(AiJob.id == job_id, AiJob.status == "running")
            .values(status=status, error=error, finished_at=now())
        )
        await session.commit()


async def _run_stages(job_id: int, handlers: Mapping[str, JobHandler]) -> None:
    """세 단계를 차례로 돈다. 세션은 단계마다 새로 열고, 예외는 호출부가 받는다."""
    async with SessionLocal() as session:
        job = await session.get(AiJob, job_id)
        if job is None or job.status != "running":  # 꺼낸 직후 취소됐거나 묶음이 지워졌다
            return
        handler = handlers[job.kind]
        loaded = await handler.load(session, job)
        await session.commit()
    if loaded is None:
        await _finish_running_job(job_id, "stale")
        return

    computed = await handler.compute(job, loaded)

    async with SessionLocal() as session:
        # lock_bundle의 refresh는 읽은 뒤 지워진 행에서 예외를 낸다 — 읽기와 잠금을 한 문장으로 해 삭제 경합도 None으로 받는다
        bundle = await session.get(Bundle, job.bundle_id, with_for_update=True)
        if bundle is None:
            return
        job = await session.get(AiJob, job_id)
        if job is None or job.status != "running":
            return
        if bundle.status == "in_progress":
            job.status = await handler.apply(session, job, loaded, computed)
        else:
            job.status = "cancelled"
        job.finished_at = now()
        await session.commit()


async def _record_failure(job_id: int, code: str) -> None:
    try:
        await _finish_running_job(job_id, "failed", code)
    except Exception as exc:  # noqa: BLE001 -- 기록도 못 하면 running으로 남아 재시작 때 회수된다. 워커 태스크로 새지 않게 여기서 끝낸다
        logger.error("AI job failure not recorded: job_id=%d error=%s", job_id, type(exc).__name__)


async def process_job(job_id: int) -> None:
    """작업 하나를 끝까지 돌린다 — 실패는 작업 행에 남기고 밖으로 내지 않는다. 취소(CancelledError)만 그대로 올라간다."""
    try:
        # 핸들러 모듈들이 이 모듈의 AiCallFailed·JobHandler를 쓰므로 맨 위에서 가져오면 순환 import다
        from app.sop.ai.handlers import HANDLERS

        await _run_stages(job_id, HANDLERS)
    except AiCallFailed as exc:
        await _record_failure(job_id, exc.code)
    except Exception as exc:  # noqa: BLE001 -- 어떤 예외든 그 작업의 실패로 끝낸다. 메시지·트레이스백에 원문이 실릴 수 있어 클래스 이름만 남긴다
        logger.error("AI job failed: job_id=%d error=%s", job_id, type(exc).__name__)
        await _record_failure(job_id, "internal")


async def run_ai_worker() -> None:
    """lifespan 백그라운드 루프 — 작업을 동시 상한까지 태스크로 띄운다. 종료 때 돌던 작업도 취소하고 재시작이 회수한다."""
    limit = max(1, settings.ai_max_concurrency)
    tasks: set[asyncio.Task[None]] = set()
    try:
        while True:
            job_id = None
            if len(tasks) < limit:
                try:
                    job_id = await claim_next_job()
                except Exception as exc:  # noqa: BLE001 -- DB가 잠깐 끊겨도 워커는 살아 다음 주기에 다시 꺼낸다
                    logger.error("AI worker could not claim a job: error=%s", type(exc).__name__)
            if job_id is not None:
                tasks.add(asyncio.create_task(process_job(job_id)))
            elif tasks:
                # 작업이 끝나면 주기를 기다리지 않고 바로 다음을 꺼낸다
                _, tasks = await asyncio.wait(tasks, timeout=AI_POLL_SECONDS, return_when=asyncio.FIRST_COMPLETED)
            else:
                await asyncio.sleep(AI_POLL_SECONDS)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def run_jobs_until_idle() -> None:
    """쌓인 작업을 하나씩 끝까지 돌린다 — 워커 없이 큐를 결정적으로 비우는 길(테스트)."""
    while (job_id := await claim_next_job()) is not None:
        await process_job(job_id)


async def requeue_running_jobs() -> None:
    """프로세스가 끊겨 running으로 남은 작업을 회수한다 — 시도를 다 쓴 작업은 다시 꺼내지 않고 실패로 끝낸다. 기동 때 워커보다 먼저 부른다."""
    async with SessionLocal() as session:
        await session.execute(
            update(AiJob)
            .where(AiJob.status == "running", AiJob.attempts >= MAX_JOB_ATTEMPTS)
            .values(status="failed", error="interrupted", finished_at=now())
        )
        await session.execute(update(AiJob).where(AiJob.status == "running").values(status="queued", started_at=None))
        await session.commit()
