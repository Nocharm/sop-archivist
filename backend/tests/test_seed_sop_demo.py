"""scripts.seed_sop_demo — 가드 판정, 임시 sqlite 자식 프로세스로 세 단계 묶음 만들기·재실행 건너뛰기, 실패한 묶음 정리."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from scripts.seed_sop_demo import DemoStage, drive_stage, find_seed_refusal
from scripts.synthetic_sop import BALANCE, LEVEL_BENCH, build_synthetic_bundle
from tests.sop_helpers import AUTHOR

BACKEND_DIR = Path(__file__).resolve().parent.parent
EXPECTED_BUNDLES = [
    ("SYNTHETIC 1 쪼개기 직후", "in_progress"),
    ("SYNTHETIC 2 분류 절반", "in_progress"),
    ("SYNTHETIC 3 검토 대기", "in_review"),
]
DOCUMENTS_PER_BUNDLE = 6  # 옛 문서 5개 + 입구 2 새 문서 1개


def _run_seed(database_path: Path, **overrides: str) -> subprocess.CompletedProcess[str]:
    """시드를 자식 프로세스로 돌린다 — DB는 임시 sqlite로 바꾸고 .env·이 세션이 정한 값이 새지 않게 고정한다."""
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite+aiosqlite:///{database_path}",
        "AUTH_MODE": "dev",
        "DEV_ENFORCE_PERMISSIONS": "false",
        "APP_SYSADMINS": "",
        "AI_ENABLED": "false",
        "N8N_HR_URL": "",
        "N8N_HR_TOKEN": "",
        "PYTHONIOENCODING": "utf-8",
        **overrides,
    }
    return subprocess.run(
        [sys.executable, "-m", "scripts.seed_sop_demo"],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True, encoding="utf-8", timeout=300, check=False,
    )


def _query(database_path: Path, sql: str) -> list[tuple]:
    with sqlite3.connect(database_path) as connection:
        return connection.execute(sql).fetchall()


def test_seed_refuses_on_production_like_db() -> None:
    reason = find_seed_refusal("dev", is_postgres=True, hr_rows=3)
    assert reason is not None and "HR" in reason  # HR 직원이 든 postgres는 운영으로 본다
    assert find_seed_refusal("keycloak", is_postgres=False, hr_rows=0) is not None  # 로컬 우회 인증이 아니면 멈춘다
    assert find_seed_refusal("dev", is_postgres=False, hr_rows=3) is None  # 로컬 sqlite는 데모 용도
    assert find_seed_refusal("dev", is_postgres=True, hr_rows=0) is None  # 새로 만든 빈 postgres


def test_seed_refuses_outside_dev_auth_mode(tmp_path: Path) -> None:
    database_path = tmp_path / "refused.db"

    result = _run_seed(database_path, AUTH_MODE="keycloak")

    assert result.returncode == 1
    assert "AUTH_MODE" in result.stderr
    assert not database_path.exists()  # 인증 모드를 먼저 보고 DB는 건드리지 않는다


def test_seed_creates_three_bundles_at_stages(tmp_path: Path) -> None:
    database_path = tmp_path / "demo.db"

    first = _run_seed(database_path)

    assert first.returncode == 0, first.stderr
    bundles = _query(database_path, "SELECT id, title, status FROM bundles ORDER BY id")
    assert [(title, status) for _, title, status in bundles] == EXPECTED_BUNDLES
    ids = [bundle_id for bundle_id, _, _ in bundles]
    documents = _query(database_path, "SELECT bundle_id, count(*) FROM documents GROUP BY bundle_id ORDER BY bundle_id")
    assert documents == [(bundle_id, DOCUMENTS_PER_BUNDLE) for bundle_id in ids]
    confirmed = dict(_query(
        database_path,
        "SELECT bundle_id, count(*) FROM unit_decisions WHERE status = 'confirmed' GROUP BY bundle_id",
    ))
    # 쪼개기 직후는 판단 없음, 절반은 일부, 검토 대기는 전부 — 단계가 갈수록 확정이 늘어난다
    assert confirmed.get(ids[0], 0) == 0 < confirmed[ids[1]] < confirmed[ids[2]]
    members = _query(
        database_path, f"SELECT login_id, role FROM bundle_members WHERE bundle_id = {ids[2]} ORDER BY login_id"
    )
    assert members == [("qa.lead", "reviewer"), ("qa.member", "author")]
    # 출력은 제목·상태·진행 숫자뿐 — 원문 글자는 싣지 않는다
    for title, status in EXPECTED_BUNDLES:
        assert title in first.stdout and status in first.stdout
    assert LEVEL_BENCH not in first.stdout and BALANCE not in first.stdout

    second = _run_seed(database_path)

    assert second.returncode == 0, second.stderr
    assert _query(database_path, "SELECT id, title, status FROM bundles ORDER BY id") == bundles
    assert second.stdout.count("skipped") == len(EXPECTED_BUNDLES)


@pytest.mark.usefixtures("clean_sop")
def test_failed_stage_leaves_no_half_built_bundle(client: TestClient, tmp_path: Path) -> None:
    def fail_midway(driver: object) -> None:
        raise RuntimeError("stage broke")

    stage = DemoStage("SYNTHETIC failing stage", fail_midway)

    with pytest.raises(RuntimeError, match="stage broke"):
        drive_stage(client, build_synthetic_bundle(tmp_path / "synthetic"), stage)

    response = client.get("/api/bundles", headers=AUTHOR)
    assert response.status_code == 200, response.text
    assert [bundle["title"] for bundle in response.json()] == []  # 제목만 남은 반쪽 묶음이 다음 실행을 막지 않는다
