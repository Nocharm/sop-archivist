"""scripts.reset_db — 거부 판정(직원 데이터가 든 postgres, 운영 의심은 지우지 않는다), 임시 sqlite 자식 프로세스로 지침 시드."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from app.sop.constants import GUIDELINE_KEYS
from scripts.reset_db import should_refuse_reset

BACKEND_DIR = Path(__file__).resolve().parent.parent


def test_reset_refuses_postgres_with_hr_rows() -> None:
    assert should_refuse_reset(is_postgres=True, hr_rows=3) is True
    assert should_refuse_reset(is_postgres=False, hr_rows=3) is False  # 로컬 sqlite는 데모 리셋이 본래 용도
    assert should_refuse_reset(is_postgres=True, hr_rows=0) is False  # 새로 만든 빈 postgres


def test_reset_seeds_the_guidelines(tmp_path: Path) -> None:
    # 지침 표를 비운 채 끝나면 떠 있는 백엔드의 export.xlsx가 재시작 전까지 500이다(정보 시트가 활성 규칙 버전을 읽는다)
    database_path = tmp_path / "reset.db"

    result = subprocess.run(
        [sys.executable, "-m", "scripts.reset_db"],
        cwd=BACKEND_DIR, env={**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{database_path}"},
        capture_output=True, text=True, encoding="utf-8", timeout=120, check=False,
    )

    assert result.returncode == 0, result.stderr
    with sqlite3.connect(database_path) as connection:
        rows = connection.execute("SELECT key FROM guideline_versions WHERE is_active = 1").fetchall()
    assert sorted(key for key, in rows) == sorted(GUIDELINE_KEYS)
