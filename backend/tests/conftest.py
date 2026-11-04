"""Test fixtures — fresh sqlite DB per session, app client with lifespan (migrations)."""

import asyncio
import os
import pathlib
from collections.abc import Iterator

# app.settings import 전에 테스트 DB로 고정 — 개발용 dev.db를 건드리지 않는다.
# cwd와 무관하게 backend/ 아래 같은 파일을 쓰고(.gitignore의 test_*.db), 세션마다 새로 시작한다.
_TEST_DB = pathlib.Path(__file__).resolve().parent.parent / "test_sopa.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
_TEST_DB.unlink(missing_ok=True)

# backend/.env(로컬 개발값)가 테스트에 새지 않도록 baseline 고정. 환경 변수가 .env보다 우선한다.
# 권한 강제가 필요한 테스트는 enforce 픽스처가 런타임에 settings를 켠다.
os.environ["AUTH_MODE"] = "dev"
os.environ["DEV_USER"] = "dev.admin"
os.environ["DEV_ENFORCE_PERMISSIONS"] = "false"
os.environ["APP_SYSADMINS"] = ""
os.environ["AI_ENABLED"] = "false"
os.environ["N8N_HR_URL"] = ""
os.environ["N8N_HR_TOKEN"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import delete  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.dev_users import seed_demo_access, seed_dev_directory  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    AccessAuditEvent,
    AccessGrant,
    AiUsageEvent,
    BatchJobRun,
    Department,
    Employee,
    HrSyncRun,
    Role,
    RolePermission,
)
from app.settings import settings  # noqa: E402


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    # context manager 진입 시 lifespan 실행 → 마이그레이션 적용 + dev 디렉터리 시드
    with TestClient(app) as test_client:
        yield test_client


def _reset_directory() -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            for model in (Employee, Department, HrSyncRun, BatchJobRun):
                await session.execute(delete(model))
            await session.commit()
            await seed_dev_directory(session)

    asyncio.run(_run())


@pytest.fixture
def clean_directory(client: TestClient) -> Iterator[None]:
    """직원·부서·HR 이력을 dev 시드 직후 상태로 되돌린다.

    세션이 DB 하나를 공유하므로 직원/부서를 바꾸는 테스트는 앞뒤로 이 픽스처를 써서 실행 순서에 기대지 않게 한다.
    """
    _reset_directory()
    yield
    _reset_directory()


def _reset_access(*, seed: bool) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            # 부여가 역할을 RESTRICT로 붙잡으므로 부여부터 지운다(role_permissions는 역할 삭제에 CASCADE)
            for model in (AccessGrant, RolePermission, Role, AccessAuditEvent):
                await session.execute(delete(model))
            await session.commit()
            if seed:
                await seed_demo_access(session)

    asyncio.run(_run())


@pytest.fixture
def demo_access(client: TestClient) -> Iterator[None]:
    """권한 표를 공용 데모 상태(역할 2·부여 3, 기록 없음)로 두고, 끝나면 비운다.

    lifespan은 권한을 시드하지 않으므로 비운 상태가 이 픽스처를 안 쓰는 테스트가 보는 처음 상태다.
    역할·부여를 바꾸는 테스트도 이 픽스처 덕에 실행 순서에 기대지 않는다.
    """
    _reset_access(seed=True)
    yield
    _reset_access(seed=False)


def _reset_ai_usage() -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            await session.execute(delete(AiUsageEvent))
            await session.commit()

    asyncio.run(_run())


@pytest.fixture
def clean_ai_usage(client: TestClient) -> Iterator[None]:
    """AI 사용량 기록을 비운 채로 시작하고 끝낸다 — 세션이 DB 하나를 공유해 다른 테스트의 호출 기록이 집계에 새지 않게."""
    _reset_ai_usage()
    yield
    _reset_ai_usage()


@pytest.fixture
def enforce(monkeypatch: pytest.MonkeyPatch) -> None:
    """dev 모드에서도 실제 권한 판정을 켠다 — 테스트가 끝나면 원래 값으로 복원."""
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
