"""Alembic migrations — upgrade works from any cwd, and models never drift from revisions."""

import pathlib
from typing import Any

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Column, Engine, Integer, MetaData, Table, create_engine, event, inspect, text
from sqlalchemy.exc import IntegrityError

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


def _create_fk_engine(db_path: pathlib.Path) -> Engine:
    """앱 엔진처럼 연결마다 FK를 켠 동기 엔진 — RESTRICT·CASCADE를 운영 PG와 같게 본다."""
    engine = create_engine(_sync_url(db_path))

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    return engine


_INSERT_GRANT = text(
    "INSERT INTO access_grants (subject_type, subject_id, role_id, permission, created_by, created_at)"
    " VALUES ('user', 'someone', :role_id, :permission, 'test', '2026-11-04 09:00:00')"
)


def test_access_grant_constraints_hold_in_migrated_db(tmp_path: pathlib.Path) -> None:
    # compare_metadata는 CheckConstraint 차이를 못 잡는다 — 리비전이 실제로 만든 제약을 DB에 직접 부딪쳐 본다.
    db_path = tmp_path / "access.db"
    run_migrations(_async_url(db_path))
    engine = _create_fk_engine(db_path)
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO roles (id, name, description, created_at, updated_at)"
                " VALUES (1, 'R', '', '2026-11-04 09:00:00', '2026-11-04 09:00:00')"
            ))
            conn.execute(text("INSERT INTO role_permissions (role_id, permission) VALUES (1, 'system.view')"))
            conn.execute(_INSERT_GRANT, {"role_id": 1, "permission": None})
            conn.execute(_INSERT_GRANT, {"role_id": None, "permission": "system.view"})

        # 역할·권한 중 정확히 하나 — 둘 다 비거나 둘 다 찬 부여는 DB가 거부한다
        for role_id, permission in ((None, None), (1, "system.view")):
            with pytest.raises(IntegrityError), engine.begin() as conn:
                conn.execute(_INSERT_GRANT, {"role_id": role_id, "permission": permission})
        # 부여가 남은 역할은 지울 수 없다(RESTRICT)
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(text("DELETE FROM roles WHERE id = 1"))

        with engine.begin() as conn:
            conn.execute(text("DELETE FROM access_grants WHERE role_id = 1"))
            conn.execute(text("DELETE FROM roles WHERE id = 1"))
            remaining = conn.execute(text("SELECT count(*) FROM role_permissions")).scalar()
        assert remaining == 0  # 역할을 지우면 묶인 권한 행은 CASCADE로 따라 지워진다
        check_names = {ck["name"] for ck in inspect(engine).get_check_constraints("access_grants")}
        assert check_names == {"ck_access_grants_role_xor_permission"}
    finally:
        engine.dispose()


def test_target_number_style_check_holds_in_migrated_db(tmp_path: pathlib.Path) -> None:
    # 0011이 더한 CHECK를 마이그레이션된 DB에 직접 부딪쳐 본다 — 지난 행은 server_default로 번호 줄이다
    db_path = tmp_path / "number_style.db"
    run_migrations(_async_url(db_path))
    engine = create_engine(_sync_url(db_path))  # FK를 켜지 않아 부모 행 없이 새 문장 한 행만 넣는다
    try:
        with engine.begin() as conn:
            columns = conn.execute(text("PRAGMA table_info(target_sentences)")).all()
            # (cid, name, type, notnull, dflt_value, pk) — 기본값 없는 필수 칸만 채운다
            values = {
                name: ("confirmed" if name == "status" else 1 if "INT" in type_.upper() else "x")
                for _, name, type_, notnull, default, pk in columns
                if notnull and default is None and not pk
            }
            names = ", ".join(values)
            conn.execute(
                text(f"INSERT INTO target_sentences (id, {names}) VALUES (1, {', '.join(':' + n for n in values)})"),
                values,
            )
            assert conn.execute(text("SELECT number_style FROM target_sentences WHERE id = 1")).scalar() == "numbered"
            conn.execute(text("UPDATE target_sentences SET number_style = 'note' WHERE id = 1"))
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(text("UPDATE target_sentences SET number_style = 'hidden' WHERE id = 1"))
        check_names = {ck["name"] for ck in inspect(engine).get_check_constraints("target_sentences")}
        assert check_names == {"ck_target_sentences_status", "ck_target_sentences_number_style"}
    finally:
        engine.dispose()


def test_downgrade_to_base_and_back(tmp_path: pathlib.Path) -> None:
    # scripts.reset_db가 base로 내렸다 head로 올린다 — 모든 리비전의 downgrade가 실제로 돌아야 한다.
    db_path = tmp_path / "roundtrip.db"
    run_migrations(_async_url(db_path))
    config = Config(str(pathlib.Path(__file__).resolve().parent.parent / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", _async_url(db_path))
    config.attributes["configure_logger"] = False

    command.downgrade(config, "base")
    engine = create_engine(_sync_url(db_path))
    try:
        assert set(inspect(engine).get_table_names()) == {"alembic_version"}
    finally:
        engine.dispose()

    run_migrations(_async_url(db_path))
    assert _compare_to_head(db_path, Base.metadata) == []
