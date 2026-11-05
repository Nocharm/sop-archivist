"""Async database engine, session factory, and Alembic migration runner."""

from collections.abc import AsyncGenerator
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.sop.models  # noqa: F401  (SOP 표를 Base.metadata에 등록)
from app.models import Base
from app.settings import settings

__all__ = ["Base", "SessionLocal", "engine", "get_session", "run_migrations"]

# alembic.ini는 패키지 위치 기준으로 찾는다 — 프로세스 cwd(컨테이너·서비스 매니저마다 다름)에 기대지 않는다.
_ALEMBIC_INI = Path(__file__).resolve().parent.parent / "alembic.ini"

# hide_parameters: DB 오류 메시지에 바인딩 값([parameters: …])을 싣지 않는다 — 값이 SOP 원문일 수 있고 500의 트레이스백은 로그에 남는다
engine = create_async_engine(settings.database_url, hide_parameters=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

if engine.dialect.name == "sqlite":

    @event.listens_for(engine.sync_engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection: object, _record: object) -> None:
        # sqlite는 연결마다 FK를 꺼 둔다 — 운영(PG)과 달리 cascade·참조 무결성이 조용히 빠진다.
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def run_migrations(database_url: str | None = None) -> None:
    """DB를 Alembic head까지 올린다. 비우면 settings.database_url.

    동기 함수다 — env.py가 asyncio.run을 쓰므로 실행 중인 이벤트 루프 안에서 직접 부르면 실패한다.
    lifespan에서는 asyncio.to_thread로 부른다.
    """
    config = Config(str(_ALEMBIC_INI))
    if database_url:
        # configparser 보간: URL의 % (인코딩된 비밀번호 등)는 %%로 이스케이프해야 한다.
        config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    # env.py의 fileConfig가 앱 로깅(uvicorn·루트 핸들러)을 덮어쓰지 않게 한다. CLI 실행은 그대로 적용.
    config.attributes["configure_logger"] = False
    command.upgrade(config, "head")


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
