"""DB engine — sqlite connections enforce foreign keys like production Postgres."""

import asyncio

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
