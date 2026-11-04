"""FastAPI app entrypoint — routes are mounted under /api (nginx pass-through)."""

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from app.db import SessionLocal, engine, run_migrations
from app.dev_users import seed_dev_directory
from app.hr.scheduler import run_hr_sync_loop
from app.routers import access as access_router
from app.routers import admin as admin_router
from app.routers import auth as auth_router
from app.routers import directory as directory_router
from app.routers import me as me_router
from app.settings import settings


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    # Alembic env.py가 asyncio.run을 쓰므로 실행 중인 루프를 막지 않게 스레드에서 돌린다.
    await asyncio.to_thread(run_migrations)
    # dev 모드만 가짜 부서·사용자를 시드한다 — 실 인증(keycloak)은 HR 동기화로 채운 실제 디렉터리를 쓴다.
    if settings.resolved_auth_mode() == "dev":
        async with SessionLocal() as session:
            await seed_dev_directory(session)
    hr_task: asyncio.Task[None] | None = None
    if settings.hr_enabled and settings.hr_sync_interval_hours > 0:
        hr_task = asyncio.create_task(run_hr_sync_loop())
    yield
    if hr_task is not None:
        hr_task.cancel()
        with suppress(asyncio.CancelledError):
            await hr_task  # 취소가 끝나길 기다려 종료 때 "Task was destroyed" 경고를 막는다
    await engine.dispose()


app = FastAPI(title="SOP Archivist", lifespan=lifespan)
app.include_router(auth_router.router)
app.include_router(directory_router.router)
app.include_router(me_router.router)
app.include_router(access_router.router)
app.include_router(admin_router.router)


@app.get("/api/health")
async def check_health() -> dict[str, str]:
    return {"status": "ok"}
