"""DB engine — sqlite connections enforce foreign keys like production Postgres, and DB errors carry no bound values."""

import asyncio

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db import engine


def test_sqlite_foreign_keys_on() -> None:
    async def read_pragma() -> int | None:
        try:
            async with engine.connect() as conn:
                return (await conn.exec_driver_sql("PRAGMA foreign_keys")).scalar()
        finally:
            # 이 asyncio.run 루프 밖으로 풀 연결이 새지 않게 닫는다.
            await engine.dispose()

    assert asyncio.run(read_pragma()) == 1


def test_db_error_message_hides_bound_values() -> None:
    """DB 오류 메시지에 바인딩 값이 실리지 않는다 — 값은 SOP 원문일 수 있고, 500의 트레이스백은 메시지째 로그에 남는다."""
    sentinel = "SYNTHETIC sentence that must not reach the log"

    async def provoke() -> DBAPIError:
        try:
            async with engine.connect() as conn:
                with pytest.raises(DBAPIError) as caught:
                    await conn.execute(text("SELECT * FROM no_such_table WHERE note = :note"), {"note": sentinel})
                return caught.value
        finally:
            await engine.dispose()

    error = asyncio.run(provoke())

    assert "no_such_table" in str(error)  # 질의는 남아 원인을 찾을 수 있다
    assert sentinel not in str(error)
