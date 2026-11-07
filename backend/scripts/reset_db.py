"""로컬 데모 DB 초기화 — Alembic base로 내렸다 head로 올린 뒤 지침·dev 디렉터리·데모 권한을 시드한다. 운영 실행 금지.

대상은 DATABASE_URL(기본 backend/dev.db sqlite). postgres에 HR 직원이 있으면 운영 DB로 보고 아무것도
지우지 않은 채 종료 코드 1로 멈춘다 — 운영 이미지에도 이 스크립트가 실려 있어, 접속 대상 하나만 틀려도
운영 DB가 지워질 수 있기 때문이다(bpm 리뷰 2026-10-19).

실행 (backend/ 에서):
    bash:       .venv/bin/python -m scripts.reset_db
    PowerShell: .venv\\Scripts\\python -m scripts.reset_db
"""

import asyncio
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import func, inspect, select

from app.db import SessionLocal, engine, run_migrations
from app.dev_users import seed_demo_access, seed_dev_directory
from app.models import AccessGrant, Department, Employee, Role, RolePermission
from app.sop.ai.guidelines import seed_guidelines
from app.sop.models import GuidelineVersion

_ALEMBIC_INI = Path(__file__).resolve().parent.parent / "alembic.ini"

# 리셋 뒤 행 수를 찍어 확인하는 테이블
_VERIFY_MODELS = (Employee, Department, Role, RolePermission, AccessGrant, GuidelineVersion)


def should_refuse_reset(is_postgres: bool, hr_rows: int) -> bool:
    """HR이 채운 직원이 있는 postgres는 운영으로 본다. 로컬 sqlite는 데모 리셋이 본래 용도라 막지 않는다."""
    return is_postgres and hr_rows > 0


async def count_hr_rows() -> int:
    async with engine.connect() as conn:
        has_employees = await conn.run_sync(lambda sync_conn: inspect(sync_conn).has_table("employees"))
        if not has_employees:
            return 0  # 마이그레이션 전 빈 DB
        return await conn.scalar(
            select(func.count()).select_from(Employee).where(Employee.source == "hr")
        ) or 0


def _rebuild_schema() -> None:
    # URL은 env.py가 settings.database_url에서 가져온다 — 앱 엔진과 같은 대상
    command.downgrade(Config(str(_ALEMBIC_INI)), "base")
    run_migrations()


async def main() -> int:
    try:
        hr_rows = await count_hr_rows()
        if should_refuse_reset(engine.dialect.name == "postgresql", hr_rows):
            target = engine.url.render_as_string(hide_password=True)
            print(
                f"refusing to reset: {hr_rows} HR employees in {target}"
                " - reset_db drops every table and is only for a local demo database",
                file=sys.stderr,
            )
            return 1
        # 열린 풀 연결이 스키마 재생성(별도 엔진, env.py의 asyncio.run이라 스레드에서)과 겹치지 않게 먼저 닫는다
        await engine.dispose()
        await asyncio.to_thread(_rebuild_schema)
        print("schema  alembic base -> head")

        async with SessionLocal() as session:
            # 지침은 앱 lifespan도 시드하지만 떠 있는 백엔드는 다시 돌지 않는다 — 비워 두면 재시작 전까지 export.xlsx가 500이다
            await seed_guidelines(session)
            await seed_dev_directory(session)
            await seed_demo_access(session)
            counts = {
                model.__tablename__: await session.scalar(select(func.count()).select_from(model))
                for model in _VERIFY_MODELS
            }
        print("verify  " + ", ".join(f"{table}={count}" for table, count in counts.items()))
        return 0
    finally:
        await engine.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
