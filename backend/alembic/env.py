"""Alembic environment — async engine; URL from the run_migrations argument or settings."""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

import app.sop.models  # noqa: F401  (SOP 표를 autogenerate 대상 메타데이터에 등록)
from app.models import Base
from app.settings import settings

config = context.config

# 앱이 부른 경우(run_migrations)에는 uvicorn·루트 로거 설정을 덮어쓰지 않도록 건너뛴다.
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def get_url() -> str:
    # run_migrations(url)로 넘긴 값이 우선, 없으면 앱 설정(DATABASE_URL)
    return config.get_main_option("sqlalchemy.url") or settings.database_url


def run_migrations_offline() -> None:
    """Run migrations without a DB connection, emitting SQL to stdout."""
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # SQLite는 ALTER가 제한적이라 배치(테이블 재생성)로 렌더
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,  # SQLite는 ALTER가 제한적이라 배치(테이블 재생성)로 렌더
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    # 마이그레이션 전용 일회성 엔진 — 앱 엔진(app.db.engine)과 풀을 공유하지 않는다. 오류 메시지에 바인딩 값을 싣지 않는 것은 같다.
    connectable = create_async_engine(get_url(), poolclass=pool.NullPool, hide_parameters=True)

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations against a live DB (asyncio.run — call from a thread if a loop is running)."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
