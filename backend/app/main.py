"""FastAPI app entrypoint — routes are mounted under /api (nginx pass-through)."""

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import engine, run_migrations
from app.routers import auth as auth_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    # Alembic env.py가 asyncio.run을 쓰므로 실행 중인 루프를 막지 않게 스레드에서 돌린다.
    await asyncio.to_thread(run_migrations)
    yield
    await engine.dispose()


app = FastAPI(title="SOP Archivist", lifespan=lifespan)
app.include_router(auth_router.router)


@app.get("/api/health")
async def check_health() -> dict[str, str]:
    return {"status": "ok"}
