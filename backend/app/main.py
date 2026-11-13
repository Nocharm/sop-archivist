"""FastAPI app entrypoint — routes are mounted under /api (nginx pass-through)."""

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.db import SessionLocal, engine, run_migrations
from app.dev_users import seed_dev_directory
from app.hr.scheduler import run_hr_sync_loop
from app.routers import access as access_router
from app.routers import admin as admin_router
from app.routers import auth as auth_router
from app.routers import directory as directory_router
from app.routers import me as me_router
from app.routers import sop_admin as sop_admin_router
from app.routers import sop_ai as sop_ai_router
from app.routers import sop_bundles as sop_bundles_router
from app.routers import sop_decisions as sop_decisions_router
from app.routers import sop_documents as sop_documents_router
from app.routers import sop_guidelines as sop_guidelines_router
from app.routers import sop_outputs as sop_outputs_router
from app.routers import sop_tobe as sop_tobe_router
from app.settings import settings
from app.sop.ai.guidelines import seed_guidelines
from app.sop.ai.runner import requeue_running_jobs, run_ai_worker


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    # Alembic env.py가 asyncio.run을 쓰므로 실행 중인 루프를 막지 않게 스레드에서 돌린다.
    await asyncio.to_thread(run_migrations)
    # 지침·프롬프트의 첫 버전 — 버전이 없는 키만 저장소 시드 파일로 만든다(운영·dev 모두, AI가 꺼져 있어도 Excel 정보 시트가 읽는다)
    async with SessionLocal() as session:
        await seed_guidelines(session)
    # dev 모드만 가짜 부서·사용자를 시드한다 — 실 인증(keycloak)은 HR 동기화로 채운 실제 디렉터리를 쓴다.
    if settings.resolved_auth_mode() == "dev":
        async with SessionLocal() as session:
            await seed_dev_directory(session)
    # 끊긴 작업은 AI가 꺼져 있어도 회수한다 — 꺼낼 워커가 다시 떴을 때 running으로 남아 있으면 영영 돌지 않는다
    await requeue_running_jobs()
    hr_task: asyncio.Task[None] | None = None
    if settings.hr_enabled and settings.hr_sync_interval_hours > 0:
        hr_task = asyncio.create_task(run_hr_sync_loop())
    ai_task: asyncio.Task[None] | None = None
    if settings.ai_enabled or settings.embed_enabled:
        ai_task = asyncio.create_task(run_ai_worker())
    yield
    for task in (hr_task, ai_task):
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task  # 취소가 끝나길 기다려 종료 때 "Task was destroyed" 경고를 막는다
    await engine.dispose()


app = FastAPI(title="SOP Archivist", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """422 본문에는 type·loc·msg만 싣는다 — 기본 핸들러의 input·ctx는 요청 원문을 응답과 로그로 되돌리고, 짝 없는 서로게이트가 있으면 응답 인코딩에서 500이 된다."""
    detail = [{"type": error["type"], "loc": list(error["loc"]), "msg": error["msg"]} for error in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": detail})


app.include_router(auth_router.router)
app.include_router(directory_router.router)
app.include_router(me_router.router)
app.include_router(access_router.router)
app.include_router(admin_router.router)
app.include_router(sop_bundles_router.router)
app.include_router(sop_tobe_router.router)
app.include_router(sop_documents_router.router)
app.include_router(sop_decisions_router.router)
app.include_router(sop_decisions_router.remarks_router)
app.include_router(sop_outputs_router.router)
app.include_router(sop_admin_router.router)
app.include_router(sop_guidelines_router.router)
app.include_router(sop_ai_router.router)
app.include_router(sop_ai_router.jobs_router)


@app.get("/api/health")
async def check_health() -> dict[str, str]:
    return {"status": "ok"}
