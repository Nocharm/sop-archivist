"""Test fixtures — fresh sqlite DB per session, app client with lifespan (migrations)."""

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
os.environ["DEV_ENFORCE_PERMISSIONS"] = "false"
os.environ["APP_SYSADMINS"] = ""
os.environ["AI_ENABLED"] = "false"
os.environ["N8N_HR_URL"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.settings import settings  # noqa: E402


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    # context manager 진입 시 lifespan 실행 → 마이그레이션 적용
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def enforce(monkeypatch: pytest.MonkeyPatch) -> None:
    """dev 모드에서도 실제 권한 판정을 켠다 — 테스트가 끝나면 원래 값으로 복원."""
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
