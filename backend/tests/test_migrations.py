"""Alembic migrations — upgrade works from any cwd, and models never drift from revisions."""

import pathlib
from typing import Any

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Column, Integer, MetaData, Table, create_engine, inspect, text

from app.db import Base, run_migrations


def _async_url(db_path: pathlib.Path) -> str:
    return f"sqlite+aiosqlite:///{db_path}"


def _sync_url(db_path: pathlib.Path) -> str:
    return f"sqlite:///{db_path}"


def _get_script_head() -> str | None:
    ini = pathlib.Path(__file__).resolve().parent.parent / "alembic.ini"
    return ScriptDirectory.from_config(Config(str(ini))).get_current_head()


def test_upgrade_head_on_empty_sqlite(tmp_path: pathlib.Path) -> None:
    db_path = tmp_path / "m.db"

    run_migrations(_async_url(db_path))

    engine = create_engine(_sync_url(db_path))
    try:
        assert "alembic_version" in inspect(engine).get_table_names()
        with engine.connect() as conn:
            stamped = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        assert stamped == _get_script_head()
    finally:
        engine.dispose()


def test_upgrade_ignores_working_directory(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 컨테이너·서비스 매니저의 cwd는 backend/ 가 아닐 수 있다 — ini 위치는 패키지 기준이어야 한다.
    monkeypatch.chdir(tmp_path)
    db_path = tmp_path / "cwd.db"

    run_migrations(_async_url(db_path))

    engine = create_engine(_sync_url(db_path))
    try:
        assert "alembic_version" in inspect(engine).get_table_names()
    finally:
        engine.dispose()


def _compare_to_head(db_path: pathlib.Path, metadata: MetaData) -> list[Any]:
    engine = create_engine(_sync_url(db_path))
    try:
        with engine.connect() as conn:
            context = MigrationContext.configure(conn, opts={"compare_type": True})
            return compare_metadata(context, metadata)
    finally:
        engine.dispose()


def test_models_match_migrations(tmp_path: pathlib.Path) -> None:
    # 모델을 고치고 리비전을 빠뜨리면 여기서 실패한다 — 운영 DB에 컬럼이 없어 500이 나는 사고를 막는 가드.
    db_path = tmp_path / "match.db"
    run_migrations(_async_url(db_path))

    assert _compare_to_head(db_path, Base.metadata) == []


def test_drift_guard_detects_model_without_revision(tmp_path: pathlib.Path) -> None:
    # 위 가드가 빈 모델이라서 공허하게 통과하는 게 아님을 증명한다: 리비전 없는 테이블은 diff로 잡혀야 한다.
    db_path = tmp_path / "drift.db"
    run_migrations(_async_url(db_path))
    drifted = MetaData()
    # 실제 모델은 그대로 두고 리비전 없는 테이블 하나만 더한다 — 그래야 diff가 그 한 건만 남는다.
    for table in Base.metadata.tables.values():
        table.to_metadata(drifted)
    Table("probe_without_revision", drifted, Column("id", Integer, primary_key=True))

    diff = _compare_to_head(db_path, drifted)

    assert [op for op, *_ in diff] == ["add_table"]
