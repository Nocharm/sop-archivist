"""scripts.seed_sop_demo — 가드 판정, 임시 sqlite 자식 프로세스로 네 단계 묶음 만들기·재실행 건너뛰기, 가짜 AI 세션, 실패한 묶음 정리."""

import asyncio
import os
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.settings import settings
from app.sop.refs import is_document_number
from scripts.seed_sop_demo import (
    NESTED_TITLE,
    TOC_AFTER,
    TOC_EN,
    TOC_KO,
    TOC_TITLE,
    DemoStage,
    drive_stage,
    find_seed_refusal,
    main,
)
from scripts.synthetic_sop import BALANCE, LEVEL_BENCH, MOVE_TARGET_CODE, build_synthetic_bundle
from tests.fake_ai import fake_ai_session
from tests.sop_helpers import AUTHOR

BACKEND_DIR = Path(__file__).resolve().parent.parent
AI_STAGE_TITLE = "SYNTHETIC 4 AI 제안"
EXPECTED_BUNDLES = [
    ("SYNTHETIC 1 쪼개기 직후", "in_progress"),
    ("SYNTHETIC 2 분류 절반", "in_progress"),
    ("SYNTHETIC 3 검토 대기", "in_review"),
    (AI_STAGE_TITLE, "in_progress"),
    ("SYNTHETIC 5 UV 분광광도계", "in_progress"),
    ("SYNTHETIC 6 문서 관리", "in_progress"),
    (TOC_TITLE, "in_progress"),
    (NESTED_TITLE, "in_progress"),
]
DOCUMENTS_PER_BUNDLE = 9  # 옛 문서 7개 + 입구 2 새 문서 2개


class SeedRuns(NamedTuple):
    database_path: Path
    first: subprocess.CompletedProcess[str]
    second: subprocess.CompletedProcess[str]
    bundles_after_first: list[tuple]


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


def _query_bundles(database_path: Path) -> list[tuple]:
    return _query(database_path, "SELECT id, title, status FROM bundles ORDER BY id")


@pytest.fixture(scope="module")
def seed_runs(tmp_path_factory: pytest.TempPathFactory) -> SeedRuns:
    """시드를 두 번 돌린 임시 DB — 시드 한 번이 수십 초라 단계 시험들이 나눠 본다."""
    database_path = tmp_path_factory.mktemp("seed") / "demo.db"
    first = _run_seed(database_path)
    assert first.returncode == 0, first.stderr
    bundles = _query_bundles(database_path)
    second = _run_seed(database_path)
    assert second.returncode == 0, second.stderr
    return SeedRuns(database_path, first, second, bundles)


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


def test_seed_creates_bundles_at_stages(seed_runs: SeedRuns) -> None:
    database_path, first, second, bundles = seed_runs

    assert [(title, status) for _, title, status in bundles] == EXPECTED_BUNDLES
    ids = [bundle_id for bundle_id, _, _ in bundles]
    documents = _query(database_path, "SELECT bundle_id, count(*) FROM documents GROUP BY bundle_id ORDER BY bundle_id")
    assert documents == [(bundle_id, DOCUMENTS_PER_BUNDLE) for bundle_id in ids[:4]] + [(bundle_id, 1) for bundle_id in ids[4:]]
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

    assert _query_bundles(database_path) == bundles
    assert second.stdout.count("skipped") == len(EXPECTED_BUNDLES)


def test_seed_links_bundles_for_the_map(seed_runs: SeedRuns) -> None:
    database_path, first, _, bundles = seed_runs
    ids = [bundle_id for bundle_id, _, _ in bundles]

    members = {
        bundle_id: _query(
            database_path, f"SELECT login_id, role FROM bundle_members WHERE bundle_id = {bundle_id} ORDER BY login_id"
        )
        for bundle_id in ids[4:6]
    }
    assert members == {ids[4]: [("qa.lead", "reviewer"), ("qa.member", "author")], ids[5]: [("prod.member", "author")]}
    documents = set(_query(database_path, "SELECT bundle_id, doc_code FROM documents"))
    assert {(ids[4], "SOP-ABC-1016"), (ids[5], "SOP-ABC-1020")} <= documents
    targets = set(_query(database_path, "SELECT bundle_id, code FROM target_docs"))
    assert {(ids[4], "SOP-UV"), (ids[4], "WI-11"), (ids[5], MOVE_TARGET_CODE)} <= targets
    refs = _query(
        database_path,
        "SELECT r.number FROM unit_refs r JOIN units u ON u.id = r.unit_id JOIN extractions e ON e.id = u.extraction_id"
        f" JOIN documents d ON d.id = e.document_id WHERE r.state = 'confirmed' AND d.bundle_id IN ({ids[4]}, {ids[5]})",
    )
    assert len(refs) == 2
    # 지도는 문서 번호 꼴만 Bundle을 건너 맞춘다 — 선을 그어야 할 번호가 모두 그 꼴이어야 지도에 나온다
    edge_numbers = [number for (number,) in refs] + ["SOP-ABC-1016", "SOP-ABC-1020", MOVE_TARGET_CODE, "OLD-3"]
    assert all(is_document_number(number) for number in edge_numbers), edge_numbers
    # 출력은 제목과 결과뿐 — 문장 글은 싣지 않는다
    assert "SYNTHETIC 5 UV 분광광도계" in first.stdout and "SYNTHETIC 6 문서 관리" in first.stdout
    assert "Warm up the lamp" not in first.stdout


def test_toc_bundle_marks_its_contents_lines(seed_runs: SeedRuns) -> None:
    """목차 묶음 — 목차 스타일 줄과 그 뒤 점 끌기 줄이 목차 표시를 받고 판단은 없다(Assign 목차 블록 스모크가 쓴다)."""
    database_path, first, _, bundles = seed_runs
    (bundle_id,) = [bundle_id for bundle_id, title, _ in bundles if title == TOC_TITLE]

    marked = _query(database_path, f"""
        SELECT count(*) FROM units u JOIN extractions e ON e.id = u.extraction_id
        JOIN documents d ON d.id = e.document_id
        WHERE d.bundle_id = {bundle_id} AND u.status = 'active' AND u.noise_kind = 'toc'
    """)

    assert marked == [(len(TOC_KO) + len(TOC_EN) + 1,)]
    decided = f"SELECT count(*) FROM unit_decisions WHERE bundle_id = {bundle_id} AND status != 'unassigned'"
    assert _query(database_path, decided) == [(0,)]
    assert TOC_AFTER not in first.stdout


def test_nested_bundle_has_inner_tables_in_one_work_table(seed_runs: SeedRuns) -> None:
    """표 안 표 묶음 — 작업 표 하나의 칸 안에 띠 표 · 값 표 · 권한 표가 들고(안쪽 표 자리 신호 포함) 판단은 없다(Assign 표 안 표 스모크가 쓴다)."""
    database_path, _, _, bundles = seed_runs
    (bundle_id,) = [bundle_id for bundle_id, title, _ in bundles if title == NESTED_TITLE]

    tables = _query(database_path, f"""
        SELECT t.table_index, t.parent_table_id IS NOT NULL, t.signals LIKE '%"place"%', t.is_layout FROM source_tables t
        JOIN extractions e ON e.id = t.extraction_id JOIN documents d ON d.id = e.document_id
        WHERE d.bundle_id = {bundle_id} ORDER BY t.table_index
    """)

    assert tables == [(0, 0, 0, 0), (1, 1, 1, 0), (2, 1, 1, 0), (3, 1, 1, 0)]
    decided = f"SELECT count(*) FROM unit_decisions WHERE bundle_id = {bundle_id} AND status != 'unassigned'"
    assert _query(database_path, decided) == [(0,)]


def test_half_stage_leaves_a_captionless_table_unassigned(seed_runs: SeedRuns) -> None:
    """분류 절반 묶음에는 캡션 없는 OLD-7 표가 미배정으로 남는다 — 캡션 필수 확정을 화면 스모크가 시험한다."""
    database_path, _, _, bundles = seed_runs
    (bundle_id,) = [bundle_id for bundle_id, title, _ in bundles if title == "SYNTHETIC 2 분류 절반"]

    rows = _query(database_path, f"""
        SELECT ud.disposition, ud.status FROM units u
        JOIN extractions e ON e.id = u.extraction_id
        JOIN documents d ON d.id = e.document_id
        JOIN unit_decisions ud ON ud.unit_id = u.id
        WHERE d.bundle_id = {bundle_id} AND d.file_name LIKE '%OLD-7%' AND u.kind = 'table' AND u.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM units c WHERE c.group_unit_id = u.id AND c.kind = 'caption' AND c.status = 'active'
          )
    """)

    assert rows == [("unassigned", "unassigned")]


def test_seed_creates_the_ai_stage(seed_runs: SeedRuns) -> None:
    database_path, first, second, bundles = seed_runs
    (bundle_id,) = [bundle_id for bundle_id, title, _ in bundles if title == AI_STAGE_TITLE]

    statuses = dict(_query(
        database_path, f"SELECT status, count(*) FROM unit_decisions WHERE bundle_id = {bundle_id} GROUP BY status"
    ))
    assert statuses["ai_suggested"] > 0 and statuses["on_hold"] > 0  # 정답은 제안으로, 합침·중복 배정·표는 보류로 간다
    assert _query(database_path, "SELECT DISTINCT bundle_id FROM ai_jobs") == [(bundle_id,)]
    jobs = dict(_query(database_path, "SELECT status, count(*) FROM ai_jobs GROUP BY status"))
    assert jobs.keys() == {"done"}
    kinds = {kind for (kind,) in _query(database_path, "SELECT DISTINCT kind FROM ai_suggestions")}
    assert kinds == {"classify", "match"}
    # 프런트 분류 화면용이라 확정하지 않는다
    assert _query(database_path, "SELECT count(*) FROM ai_suggestions WHERE adoption IS NOT NULL") == [(0,)]
    assert f"{AI_STAGE_TITLE}  created" in first.stdout
    assert f"{AI_STAGE_TITLE}  skipped" in second.stdout


def test_seed_keeps_the_ai_worker_off(monkeypatch: pytest.MonkeyPatch) -> None:
    # 로컬 .env가 AI를 켜 둔 경우 — 워커가 뜨면 run_jobs_until_idle과 작업을 다투고, 남은 작업이 가짜 전송이 풀린 뒤 실제 주소로 나간다
    started: list[bool] = []

    async def record_worker() -> None:
        started.append(True)

    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "embed_enabled", True)
    monkeypatch.setattr("app.main.run_ai_worker", record_worker)
    monkeypatch.setattr("scripts.seed_sop_demo.DEMO_STAGES", ())
    monkeypatch.setattr("scripts.seed_sop_demo.MAP_BUNDLES", ())

    assert asyncio.run(main()) == 0

    assert started == []


def test_fake_ai_session_undoes_itself() -> None:
    real_client = httpx2.AsyncClient

    with fake_ai_session():
        assert settings.ai_enabled and settings.embed_enabled
        assert httpx2.AsyncClient is not real_client

    assert not settings.ai_enabled and not settings.embed_enabled
    assert httpx2.AsyncClient is real_client


def test_fake_ai_session_keeps_auto_prepare_off(monkeypatch: pytest.MonkeyPatch) -> None:
    # 시드의 작업·제안 수가 저절로 서는 계획·분류로 조용히 바뀌지 않게 — 설정이 켜진 .env에서도 안에서는 꺼진다
    monkeypatch.setattr(settings, "ai_auto_prepare", True)

    with fake_ai_session():
        assert settings.ai_auto_prepare is False

    assert settings.ai_auto_prepare is True


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
