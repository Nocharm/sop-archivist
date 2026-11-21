"""Alembic migrations — upgrade works from any cwd, and models never drift from revisions."""

import json
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
from app.sop.outline import TEMPLATE_OUTLINE, TEMPLATE_SUGGESTIONS, DocOutline, OutlineItemInfo


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
    # 0011이 더하고 0022가 넓힌 CHECK를 마이그레이션된 DB에 직접 부딪쳐 본다 — 지난 행은 server_default로 번호 줄이다
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
            conn.execute(text("UPDATE target_sentences SET number_style = 'bullet' WHERE id = 1"))  # 0022가 더한 값
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(text("UPDATE target_sentences SET number_style = 'hidden' WHERE id = 1"))
        check_names = {ck["name"] for ck in inspect(engine).get_check_constraints("target_sentences")}
        assert check_names == {"ck_target_sentences_status", "ck_target_sentences_number_style"}
    finally:
        engine.dispose()


def test_target_kind_fits_slot_heading_in_migrated_db(tmp_path: pathlib.Path) -> None:
    # kind에는 CHECK가 없고 길이가 제약이다 — 8자면 Postgres가 slot_heading(12자)을 거절한다. 0014가 넓힌 길이를 본다
    db_path = tmp_path / "slot_heading.db"
    run_migrations(_async_url(db_path))
    engine = create_engine(_sync_url(db_path))
    try:
        (kind,) = [column for column in inspect(engine).get_columns("target_sentences") if column["name"] == "kind"]
        assert kind["type"].length == 12
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


def test_request_id_backfills_existing_jobs_as_their_own_requests(tmp_path: pathlib.Path) -> None:
    # 0012 이전 작업은 어느 요청에서 왔는지 몰라 저마다 한 요청('job-<id>')이 된다
    db_path = tmp_path / "request_id.db"
    run_migrations(_async_url(db_path))
    config = Config(str(pathlib.Path(__file__).resolve().parent.parent / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", _async_url(db_path))
    config.attributes["configure_logger"] = False
    command.downgrade(config, "0011")
    engine = create_engine(_sync_url(db_path))  # FK를 켜지 않아 묶음 행 없이 작업 행만 넣는다
    try:
        with engine.begin() as conn:
            for _ in range(2):
                conn.execute(text(
                    "INSERT INTO ai_jobs (bundle_id, kind, status, unit_ids, target_ids, payload, input_snapshot,"
                    " attempts, error, requested_by, created_at)"
                    " VALUES (1, 'classify', 'done', '[]', '[]', '{}', '{}', 0, '', 'qa.member', '2026-11-10 00:00:00')"
                ))

        command.upgrade(config, "head")

        with engine.connect() as conn:
            rows = conn.execute(text("SELECT id, request_id FROM ai_jobs ORDER BY id")).all()
        assert [request_id for _, request_id in rows] == [f"job-{job_id}" for job_id, _ in rows]
    finally:
        engine.dispose()


def test_0019_gives_existing_jobs_user_priority(tmp_path: pathlib.Path) -> None:
    # 0019 이전 작업은 모두 사람이 누른 요청(priority 1)이고 미리 돌리기가 아니다
    db_path = tmp_path / "priority.db"
    run_migrations(_async_url(db_path))
    config = Config(str(pathlib.Path(__file__).resolve().parent.parent / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", _async_url(db_path))
    config.attributes["configure_logger"] = False
    command.downgrade(config, "0018")
    engine = create_engine(_sync_url(db_path))  # FK를 켜지 않아 묶음 행 없이 작업 행만 넣는다
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO ai_jobs (bundle_id, kind, status, unit_ids, target_ids, payload, input_snapshot,"
                " attempts, error, requested_by, request_id, created_at)"
                " VALUES (1, 'classify', 'queued', '[]', '[]', '{}', '{}', 0, '', 'qa.member', 'job-1',"
                " '2026-11-15 00:00:00')"
            ))

        command.upgrade(config, "0019")

        with engine.connect() as conn:
            row = conn.execute(text("SELECT priority, background FROM ai_jobs")).one()
        assert (row.priority, bool(row.background)) == (1, False)
    finally:
        engine.dispose()


# --- 0020: 옛 그림 캡션을 캡션 단위·캡션 새 문장으로 ---

_CAPTION = "그림 1 로터"


def _downgrade_to(db_path: pathlib.Path, revision: str) -> Config:
    config = Config(str(pathlib.Path(__file__).resolve().parent.parent / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", _async_url(db_path))
    config.attributes["configure_logger"] = False
    run_migrations(_async_url(db_path))
    command.downgrade(config, revision)
    return config


def _insert_row(conn: Any, table: str, **values: Any) -> int:
    columns = ", ".join(values)
    params = ", ".join(f":{name}" for name in values)
    return conn.execute(text(f"INSERT INTO {table} ({columns}) VALUES ({params}) RETURNING id"), values).scalar_one()


def _insert_document(conn: Any, side: str, extractor_versions: tuple[str, ...]) -> tuple[int, list[int]]:
    """문서 하나와 추출들(뒤가 최신) — 추출마다 단락 블록(seq 0)과 캡션을 품은 그림 블록(seq 1)."""
    now = "2026-11-10 09:00:00"
    document_id = _insert_row(
        conn, "documents", bundle_id=1, side=side, file_name=f"SYNTHETIC_{side}.docx", file_format="docx",
        size_bytes=1, sha256=side[0] * 64, doc_code=f"{side.upper()}-1", doc_version="1.0", title="", status="ready",
        language_layout="ko_only", status_reason="", revision=1, uploaded_by="qa.member", uploaded_at=now,
    )
    extraction_ids = []
    for version in extractor_versions:
        extraction_id = _insert_row(
            conn, "extractions", document_id=document_id, extractor_version=version, created_at=now,
            aux_status="ok", aux_detail="",
        )
        for seq, kind, body in ((0, "paragraph", "운전 전 점검한다."), (1, "figure", _CAPTION)):
            _insert_row(
                conn, "source_blocks", extraction_id=extraction_id, seq=seq, part="body", kind=kind, text=body,
                xml_path=f"/p[{seq}]", page_basis="estimated", section_label="", grid_span=1, row_span=1, flags="[]",
            )
        extraction_ids.append(extraction_id)
    return document_id, extraction_ids


def _insert_unit(conn: Any, extraction_id: int, local_no: int, kind: str, body: str, lang: str, seq: int) -> int:
    block_id = conn.execute(
        text("SELECT id FROM source_blocks WHERE extraction_id = :e AND seq = :s"), {"e": extraction_id, "s": seq}
    ).scalar_one()
    return _insert_row(
        conn, "units", extraction_id=extraction_id, local_no=local_no, kind=kind,
        spans=f"[[{block_id}, 0, {len(body)}]]", text=body, lang=lang, status="active", boundary_confirmed=False,
        pos_seq=seq, pos_start=0,
    )


def _insert_target(conn: Any, target_doc_id: int, kind: str, body: str, status: str, **extra: Any) -> int:
    values = {
        "bundle_id": 1, "target_doc_id": target_doc_id, "wi_step": 1, "wi_part": "instruction", "section_path": "",
        "order_index": 0, "indent_level": 0, "number_style": "numbered", "lang": "ko", "kind": kind,
        "confirmed_text": body if status == "confirmed" else "", "ai_text": "", "change_type": "as_is",
        "origin": "units", "status": status, "hold_reason": "", "remark": "", "warnings": "[]", "revision": 1,
        "updated_at": "2026-11-10 09:00:00",
    }
    if status == "confirmed":
        values |= {"confirmed_by": "qa.member", "confirmed_at": "2026-11-10 09:00:00"}
    return _insert_row(conn, "target_sentences", **(values | extra))


def _insert_old_bundle(conn: Any) -> dict[str, int]:
    """0019 모양의 묶음 — 옛 문서(추출 2)의 문장·그림(글 = 캡션)을 WI 한 단계에 그대로 보내 모두 확정했다."""
    now = "2026-11-10 09:00:00"
    conn.execute(text(
        "INSERT INTO bundles (id, title, description, status, is_synthetic, semantic_checks, revision, created_by,"
        " created_at, updated_at) VALUES (1, 'SYNTHETIC', '', 'in_progress', 1, '{}', 1, 'qa.member', :now, :now)"
    ), {"now": now})
    target_doc_id = _insert_row(
        conn, "target_docs", bundle_id=1, code="WI-01", title="", doc_type="wi", entrance="assign",
        is_equipment_sop=False, order_index=0, manual_order=False,
    )
    conn.execute(text("INSERT INTO wi_steps (target_doc_id, step_no, title) VALUES (:d, 1, '운전')"), {"d": target_doc_id})
    _, (extraction_id,) = _insert_document(conn, "old", ("2",))
    sentence_id = _insert_unit(conn, extraction_id, 1, "sentence", "운전 전 점검한다.", "ko", 0)
    figure_id = _insert_unit(conn, extraction_id, 2, "figure", _CAPTION, "neutral", 1)
    for unit_id in (sentence_id, figure_id):
        conn.execute(text(
            "INSERT INTO unit_decisions (unit_id, bundle_id, disposition, move_target_code, reason, status, hold_reason,"
            " confirmed_by, confirmed_at, revision, updated_at)"
            " VALUES (:u, 1, 'assigned', '', '', 'confirmed', '', 'qa.member', :now, 1, :now)"
        ), {"u": unit_id, "now": now})
    sentence_target_id = _insert_target(conn, target_doc_id, "sentence", "운전 전 점검한다.", "confirmed")
    figure_target_id = _insert_target(conn, target_doc_id, "figure", "", "confirmed", order_index=1)
    for target_id, unit_id in ((sentence_target_id, sentence_id), (figure_target_id, figure_id)):
        conn.execute(text("INSERT INTO target_sources (target_id, unit_id, seq) VALUES (:t, :u, 0)"),
                     {"t": target_id, "u": unit_id})
    return {"target_doc_id": target_doc_id, "extraction_id": extraction_id, "figure_id": figure_id,
            "figure_target_id": figure_target_id}


_UNIT_NUMBER_COLUMNS = {
    "number_read": "VARCHAR(40)", "number_source": "VARCHAR(5)", "number_len": "INTEGER NOT NULL DEFAULT 0",
    "number_set": "VARCHAR(40)",
    # 바꾼 조항 표시(0029)도 그 앞 리비전에서는 잠시 더했다 뺀다
    "from_heading": "BOOLEAN NOT NULL DEFAULT 0",
    # 그림 캡션 묶음(0030)도 그 앞 리비전에서는 잠시 더했다 뺀다
    "caption_figure_id": "INTEGER",
    # 짝 카드 안 순서(0033)도 그 앞 리비전에서는 잠시 더했다 뺀다
    "pair_seq": "INTEGER",
    # 벗긴 표 줄 순서(0034)도 그 앞 리비전에서는 잠시 더했다 뺀다
    "unwrap_seq": "INTEGER",
    # 들여쓰기 차이(0036)도 그 앞 리비전에서는 잠시 더했다 뺀다
    "indent_shift": "INTEGER NOT NULL DEFAULT 0",
}


def _read_outputs(db_path: pathlib.Path) -> tuple[Any, list[Any], list[list[str]]]:
    """앱 코드로 읽은 검토 조건·결과물 C 항목·Excel C 시트 글."""
    import asyncio
    from datetime import UTC, datetime

    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

    from app.sop.excel_export import ExportMeta
    from app.sop.outputs import build_output_c
    from app.sop.review import evaluate_readiness
    from app.sop.sheet_model import SHEET_NAMES, build_workbook_model
    from app.sop.models import CaptionRef, TargetDocOutlineItem
    from app.sop.snapshot import load_bundle_snapshot

    async def _load() -> Any:
        engine = create_async_engine(_async_url(db_path))
        try:
            # 앱 코드는 head 스키마를 읽는다 — 그 표가 생기기 앞 리비전(caption_refs는 0021, 골격 사본은 0023)에서는 빈 표를 잠시 두고 읽은 뒤 지운다
            async with engine.begin() as conn:
                created = [
                    model.__table__
                    for model in (CaptionRef, TargetDocOutlineItem)
                    if not await conn.run_sync(lambda sync, name=model.__tablename__: sync.dialect.has_table(sync, name))
                ]
                for table in created:
                    await conn.run_sync(table.create)
                # 단위의 번호 열(0028)도 같다 — 스냅숏이 단위 행을 통째로 읽는다
                unit_columns = {row[1] for row in await conn.execute(text("PRAGMA table_info(units)"))}
                added = [name for name in _UNIT_NUMBER_COLUMNS if name not in unit_columns]
                for name in added:
                    await conn.execute(text(f"ALTER TABLE units ADD COLUMN {name} {_UNIT_NUMBER_COLUMNS[name]}"))
                # 단위의 잡음 표시 열(0027)도 그 앞 리비전에서는 잠시 더했다 뺀다
                unit_columns = await conn.run_sync(lambda sync: {column["name"] for column in inspect(sync).get_columns("units")})
                added_noise = "noise_kind" not in unit_columns
                if added_noise:
                    await conn.execute(text("ALTER TABLE units ADD COLUMN noise_kind VARCHAR(8)"))
            try:
                async with AsyncSession(engine) as session:
                    return await load_bundle_snapshot(session, 1)
            finally:
                async with engine.begin() as conn:
                    for table in created:
                        await conn.run_sync(table.drop)
                    for name in added:
                        await conn.execute(text(f"ALTER TABLE units DROP COLUMN {name}"))
                    if added_noise:
                        await conn.execute(text("ALTER TABLE units DROP COLUMN noise_kind"))
        finally:
            await engine.dispose()

    snap = asyncio.run(_load())
    readiness = evaluate_readiness(snap, semantic_checks={}, unacked_missing_text=0, reviewer_count=1)
    items = [item for doc in build_output_c(snap, "ko").docs for section in doc.sections for item in section.items]
    meta = ExportMeta(exported_by="qa.member", exported_at=datetime(2026, 11, 16, tzinfo=UTC), guideline_version="")
    sheet = next(sheet for sheet in build_workbook_model(snap, meta, {}).sheets if sheet.name == SHEET_NAMES[2])
    return readiness, items, [[cell.text for cell in row.cells] for row in sheet.rows]


def test_0020_moves_figure_caption_to_its_own_unit_and_target(tmp_path: pathlib.Path) -> None:
    # 올리기 전에 확정한 그림 — 이행 뒤에도 그림 새 문장·판단은 그대로, 캡션은 제 단위·새 문장으로 결과물 C·Excel에 나온다
    db_path = tmp_path / "captions.db"
    config = _downgrade_to(db_path, "0019")
    engine = _create_fk_engine(db_path)
    try:
        with engine.begin() as conn:
            ids = _insert_old_bundle(conn)
        readiness_before, items_before, _ = _read_outputs(db_path)

        command.upgrade(config, "0020")

        with engine.connect() as conn:
            figure_row = conn.execute(text("SELECT spans, text FROM units WHERE id = :id"), {"id": ids["figure_id"]}).one()
            caption_row = conn.execute(text(
                "SELECT id, kind, group_unit_id, text, lang, local_no, pos_seq FROM units WHERE kind = 'caption'"
            )).one()
            child = conn.execute(text(
                "SELECT id, parent_target_id, confirmed_text, ai_text, status, change_type, lang, wi_step, wi_part,"
                " new_unit_id FROM target_sentences WHERE parent_target_id IS NOT NULL"
            )).one()
            child_sources = conn.execute(
                text("SELECT unit_id, seq FROM target_sources WHERE target_id = :id"), {"id": child.id}
            ).all()
            figure_target = conn.execute(
                text("SELECT status, confirmed_text, change_type FROM target_sentences WHERE id = :id"),
                {"id": ids["figure_target_id"]},
            ).one()
            decision_of_figure = conn.execute(
                text("SELECT status, disposition FROM unit_decisions WHERE unit_id = :id"), {"id": ids["figure_id"]}
            ).one()
            decision_of_caption = conn.execute(
                text("SELECT bundle_id, status, disposition FROM unit_decisions WHERE unit_id = :id"),
                {"id": caption_row.id},
            ).one()
        readiness_after, items, sheet_rows = _read_outputs(db_path)
    finally:
        engine.dispose()

    assert figure_row.spans == "[]" and figure_row.text == ""
    assert caption_row.kind == "caption" and caption_row.group_unit_id == ids["figure_id"]
    assert (caption_row.text, caption_row.lang, caption_row.local_no, caption_row.pos_seq) == (_CAPTION, "ko", 3, 1)
    assert child.parent_target_id == ids["figure_target_id"] and child.status == "confirmed"
    assert (child.confirmed_text, child.ai_text, child.change_type, child.lang) == (_CAPTION, _CAPTION, "as_is", "ko")
    assert (child.wi_step, child.wi_part, child.new_unit_id) == (1, "instruction", None)
    assert [tuple(row) for row in child_sources] == [(caption_row.id, 0)]
    assert tuple(figure_target) == ("confirmed", "", "as_is")  # 그림 새 문장은 그대로
    assert tuple(decision_of_figure) == ("confirmed", "assigned")  # 그림 판단은 그대로
    assert tuple(decision_of_caption) == (1, "unassigned", "unassigned")  # 캡션 상태는 그림의 판단을 따른다
    assert readiness_after == readiness_before
    assert [item.children for item in items_before if item.kind == "figure"] == [[]]  # 이행 앞 C에는 캡션 줄이 없었다
    (figure_item,) = [item for item in items if item.kind == "figure"]
    assert [child.text for child in figure_item.children] == [_CAPTION]
    assert any(_CAPTION in row for row in sheet_rows)


def test_0020_covers_entrance_two_and_earlier_extractions(tmp_path: pathlib.Path) -> None:
    # 입구 2 새 문서의 그림은 판단 행 없이 new_unit_id로 잇고, 최신이 아닌 추출의 그림도 옮긴다
    db_path = tmp_path / "captions_new.db"
    config = _downgrade_to(db_path, "0019")
    engine = _create_fk_engine(db_path)
    try:
        with engine.begin() as conn:
            ids = _insert_old_bundle(conn)
            _, (old_extraction_id, new_extraction_id) = _insert_document(conn, "new", ("1", "2"))
            earlier_figure_id = _insert_unit(conn, old_extraction_id, 1, "figure", "Figure 1 Rotor", "neutral", 1)
            new_figure_id = _insert_unit(conn, new_extraction_id, 4, "figure", "Figure 1 Rotor", "neutral", 1)
            _insert_target(
                conn, ids["target_doc_id"], "figure", "", "ai_suggested", origin="new_doc", new_unit_id=new_figure_id,
                change_type=None,
            )

        command.upgrade(config, "0020")

        with engine.connect() as conn:
            captions = {
                row.group_unit_id: row for row in conn.execute(text(
                    "SELECT id, group_unit_id, lang, local_no FROM units WHERE kind = 'caption'"
                ))
            }
            child = conn.execute(text(
                "SELECT new_unit_id, status, confirmed_text, ai_text, origin FROM target_sentences"
                " WHERE parent_target_id IS NOT NULL AND origin = 'new_doc'"
            )).one()
            new_side_decisions = conn.execute(text(
                "SELECT count(*) FROM unit_decisions WHERE unit_id IN (:a, :b)"
            ), {"a": captions[earlier_figure_id].id, "b": captions[new_figure_id].id}).scalar()
    finally:
        engine.dispose()

    assert set(captions) == {ids["figure_id"], earlier_figure_id, new_figure_id}
    assert (captions[new_figure_id].lang, captions[new_figure_id].local_no) == ("en", 5)
    assert captions[earlier_figure_id].local_no == 2
    assert tuple(child) == (captions[new_figure_id].id, "ai_suggested", "", "Figure 1 Rotor", "new_doc")
    assert new_side_decisions == 0


def test_0020_downgrade_puts_caption_back_into_figure(tmp_path: pathlib.Path) -> None:
    db_path = tmp_path / "captions_down.db"
    config = _downgrade_to(db_path, "0019")
    engine = _create_fk_engine(db_path)
    try:
        with engine.begin() as conn:
            ids = _insert_old_bundle(conn)
            before = conn.execute(text("SELECT spans, text FROM units WHERE id = :id"), {"id": ids["figure_id"]}).one()
        command.upgrade(config, "0020")

        command.downgrade(config, "0019")

        with engine.connect() as conn:
            after = conn.execute(text("SELECT spans, text FROM units WHERE id = :id"), {"id": ids["figure_id"]}).one()
            leftovers = conn.execute(text(
                "SELECT (SELECT count(*) FROM units WHERE kind = 'caption'),"
                " (SELECT count(*) FROM target_sentences WHERE parent_target_id IS NOT NULL),"
                " (SELECT count(*) FROM unit_decisions), (SELECT count(*) FROM target_sources)"
            )).one()
    finally:
        engine.dispose()

    assert (after.text, json.loads(after.spans)) == (before.text, json.loads(before.spans))
    assert tuple(leftovers) == (0, 0, 2, 2)


def test_0021_backfills_references_for_old_documents(tmp_path: pathlib.Path) -> None:
    # 올리기 전의 옛 문서 — 최신 추출의 번호 참조·자리 참조만 채우고, 지난 추출은 건드리지 않는다
    db_path = tmp_path / "caption_refs.db"
    config = _downgrade_to(db_path, "0020")
    engine = _create_fk_engine(db_path)
    sentence = "운전은 표 3을 따르고 아래 표를 본다."
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO bundles (id, title, description, status, is_synthetic, semantic_checks, revision,"
                " created_by, created_at, updated_at) VALUES (1, 'SYNTHETIC', '', 'in_progress', 1, '{}', 1,"
                " 'qa.member', '2026-11-10 09:00:00', '2026-11-10 09:00:00')"
            ))
            _, (old_extraction, latest) = _insert_document(conn, "old", ("2", "3"))
            for extraction_id in (old_extraction, latest):
                conn.execute(
                    text("UPDATE source_blocks SET text = :t WHERE extraction_id = :e AND seq = 0"),
                    {"t": sentence, "e": extraction_id},
                )
                _insert_unit(conn, extraction_id, 1, "sentence", sentence, "ko", 0)
            table_id = _insert_row(
                conn, "source_tables", extraction_id=latest, table_index=0, part="body", xml_path="/tbl[0]",
                n_rows=1, n_cols=1, is_layout=False,
            )
            conn.execute(
                text("UPDATE source_blocks SET kind = 'paragraph', text = '' WHERE extraction_id = :e AND seq = 1"),
                {"e": latest},
            )
            _insert_row(
                conn, "source_blocks", extraction_id=latest, seq=2, part="body", kind="table_cell", text="값",
                xml_path="/tbl[0]/c", page_basis="estimated", section_label="", grid_span=1, row_span=1,
                flags="[]", table_id=table_id, row_index=0, col_index=0,
            )
            _insert_row(
                conn, "source_blocks", extraction_id=latest, seq=3, part="body", kind="paragraph", text="표 3. 운전",
                xml_path="/p[3]", page_basis="estimated", section_label="", grid_span=1, row_span=1, flags="[]",
            )
            table_unit = _insert_row(
                conn, "units", extraction_id=latest, local_no=3, kind="table", spans="[]", text="", lang="neutral",
                table_id=table_id, status="active", boundary_confirmed=False, pos_seq=2, pos_start=-1,
            )
            caption_block = conn.execute(
                text("SELECT id FROM source_blocks WHERE extraction_id = :e AND seq = 3"), {"e": latest}
            ).scalar_one()
            _insert_row(
                conn, "units", extraction_id=latest, local_no=4, kind="caption", spans=f"[[{caption_block}, 0, 7]]",
                text="표 3. 운전", lang="ko", group_unit_id=table_unit, status="active", boundary_confirmed=False,
                pos_seq=3, pos_start=0,
            )
            # 언어마다 따로 단 캡션 — 같은 묶음이면 모호하지 않다
            english_block = _insert_row(
                conn, "source_blocks", extraction_id=latest, seq=4, part="body", kind="paragraph",
                text="Table 3 Run", xml_path="/p[4]", page_basis="estimated", section_label="", grid_span=1,
                row_span=1, flags="[]",
            )
            _insert_row(
                conn, "units", extraction_id=latest, local_no=5, kind="caption", spans=f"[[{english_block}, 0, 11]]",
                text="Table 3 Run", lang="en", group_unit_id=table_unit, status="active", boundary_confirmed=False,
                pos_seq=4, pos_start=0,
            )

        command.upgrade(config, "0021")

        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT extraction_id, block_id, start, \"end\", kind, number, target_table_id, target_block_id, state, origin"
                " FROM caption_refs ORDER BY start"
            )).all()
            block_id = conn.execute(
                text("SELECT id FROM source_blocks WHERE extraction_id = :e AND seq = 0"), {"e": latest}
            ).scalar_one()
    finally:
        engine.dispose()

    number_start = sentence.index("3")
    place_start = sentence.index("아래 표")
    assert [tuple(row) for row in rows] == [
        (latest, block_id, number_start, number_start + 1, "table", 3, table_id, None, "linked", "auto"),
        (latest, block_id, place_start, place_start + len("아래 표"), "table", None, table_id, None, "linked", "auto"),
    ]


def test_0021_backfill_freezes_caption_number_and_row_split_rules(tmp_path: pathlib.Path) -> None:
    # 얼린 규칙: 복합 번호 머리("Table 3-1")는 잇지 않고, 괄호 캡션("<표 5>")은 그 번호로 잇고, 행으로 나눈 표도 자리 참조 대상이다
    db_path = tmp_path / "caption_refs_rules.db"
    config = _downgrade_to(db_path, "0020")
    engine = _create_fk_engine(db_path)
    sentence = "아래 표를 보고 Table 3 및 표 5를 따른다."
    block = {"part": "body", "page_basis": "estimated", "section_label": "", "grid_span": 1, "row_span": 1, "flags": "[]"}
    unit = {"status": "active", "boundary_confirmed": False}
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO bundles (id, title, description, status, is_synthetic, semantic_checks, revision,"
                " created_by, created_at, updated_at) VALUES (1, 'SYNTHETIC', '', 'in_progress', 1, '{}', 1,"
                " 'qa.member', '2026-11-10 09:00:00', '2026-11-10 09:00:00')"
            ))
            _, (extraction,) = _insert_document(conn, "old", ("3",))
            conn.execute(text("UPDATE source_blocks SET text = :t WHERE extraction_id = :e AND seq = 0"), {"t": sentence, "e": extraction})
            conn.execute(
                text("UPDATE source_blocks SET kind = 'paragraph', text = 'Table 3-1. Flow' WHERE extraction_id = :e AND seq = 1"),
                {"e": extraction},
            )
            _insert_unit(conn, extraction, 1, "sentence", sentence, "en", 0)
            split = _insert_row(
                conn, "source_tables", extraction_id=extraction, table_index=0, part="body", xml_path="/tbl[0]",
                n_rows=2, n_cols=1, is_layout=False,
            )
            other = _insert_row(
                conn, "source_tables", extraction_id=extraction, table_index=1, part="body", xml_path="/tbl[1]",
                n_rows=1, n_cols=1, is_layout=False,
            )
            for seq, row in ((2, 0), (3, 1)):
                _insert_row(conn, "source_blocks", extraction_id=extraction, seq=seq, kind="table_cell", text="값",
                            xml_path=f"/tbl[0]/r{row}", table_id=split, row_index=row, col_index=0, **block)
            caption_block = _insert_row(conn, "source_blocks", extraction_id=extraction, seq=4, kind="paragraph",
                                        text="<표 5> 운전", xml_path="/p[4]", **block)
            _insert_row(conn, "source_blocks", extraction_id=extraction, seq=5, kind="table_cell", text="값",
                        xml_path="/tbl[1]/c", table_id=other, row_index=0, col_index=0, **block)
            first_row = _insert_row(
                conn, "units", extraction_id=extraction, local_no=2, kind="table_row", spans="[]", text="",
                lang="neutral", table_id=split, row_index=0, pos_seq=2, pos_start=-1, **unit,
            )
            _insert_row(
                conn, "units", extraction_id=extraction, local_no=3, kind="table_row", spans="[]", text="",
                lang="neutral", table_id=split, row_index=1, pos_seq=3, pos_start=-1, **unit,
            )
            compound_block = conn.execute(
                text("SELECT id FROM source_blocks WHERE extraction_id = :e AND seq = 1"), {"e": extraction}
            ).scalar_one()
            _insert_row(
                conn, "units", extraction_id=extraction, local_no=4, kind="caption", spans=f"[[{compound_block}, 0, 15]]",
                text="Table 3-1. Flow", lang="en", group_unit_id=first_row, pos_seq=1, pos_start=0, **unit,
            )
            other_unit = _insert_row(
                conn, "units", extraction_id=extraction, local_no=5, kind="table", spans="[]", text="", lang="neutral",
                table_id=other, pos_seq=5, pos_start=-1, **unit,
            )
            _insert_row(
                conn, "units", extraction_id=extraction, local_no=6, kind="caption", spans=f"[[{caption_block}, 0, 8]]",
                text="<표 5> 운전", lang="ko", group_unit_id=other_unit, pos_seq=4, pos_start=0, **unit,
            )

        command.upgrade(config, "0021")

        with engine.connect() as conn:
            rows = conn.execute(text("SELECT start, kind, number, target_table_id FROM caption_refs ORDER BY start")).all()
    finally:
        engine.dispose()

    assert [tuple(row) for row in rows] == [
        (0, "table", None, split),
        (sentence.index("3"), "table", 3, None),
        (sentence.index("5"), "table", 5, other),
    ]


def test_caption_refs_index_their_foreign_keys(tmp_path: pathlib.Path) -> None:
    # 블록·표를 지우면 CASCADE가 caption_refs를 FK로 찾는다 — 색인이 없으면 PG가 표 전체를 훑는다
    db_path = tmp_path / "caption_ref_indexes.db"
    run_migrations(_async_url(db_path))
    engine = create_engine(_sync_url(db_path))
    try:
        indexed = {tuple(index["column_names"]) for index in inspect(engine).get_indexes("caption_refs")}
    finally:
        engine.dispose()

    assert {("extraction_id",), ("block_id",), ("target_table_id",), ("target_block_id",)} <= indexed


# --- 0023: SOP 골격 표와 기존 SOP 문서의 사본 ---

_OUTLINE_COLUMNS = (
    "key", "order_index", "title_en", "title_ko", "kind", "is_required", "default_style", "child_prefix", "origin",
    "is_removed", "deviation_reason",
)
# 0023 때의 고정 15칸: (키, 영문 제목, 종류) — 그 뒤 앱의 표준은 회사 템플릿으로 바뀌었다(0024)
_LEGACY_SLOTS = (
    ("purpose", "Purpose", "general"),
    ("scope", "Scope", "general"),
    ("definitions", "Definitions", "general"),
    ("responsibilities", "Responsibilities", "general"),
    ("general_requirements", "General Requirements", "named_children"),
    ("general_requirements.safety", "Safety", "general"),
    ("general_requirements.operation", "Operation", "general"),
    ("procedures", "Procedures", "named_children"),
    ("procedures.procedure", "Procedure", "general"),
    ("procedures.electronic_record_control", "Electronic Record Control", "general"),
    ("procedures.troubleshooting", "Troubleshooting", "general"),
    ("procedures.maintenance", "Maintenance", "general"),
    ("document_relationships", "Document Relationships", "named_children"),
    ("document_relationships.attachments", "Attachments", "general"),
    ("document_relationships.appendices", "Appendices", "general"),
)
_LEGACY_ROWS = [
    (key, position, title, "", kind, True, "numbered", "", "standard", False, None)
    for position, (key, title, kind) in enumerate(_LEGACY_SLOTS)
]


def test_0023_backfills_sop_docs(tmp_path: pathlib.Path) -> None:
    # 0023 이전의 SOP 문서는 그때의 고정 15칸을 사본으로 받고 WI는 받지 않는다
    db_path = tmp_path / "outline.db"
    config = _downgrade_to(db_path, "0022")
    engine = _create_fk_engine(db_path)
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO bundles (id, title, description, status, is_synthetic, semantic_checks, revision, created_by,"
                " created_at, updated_at) VALUES (1, 'SYNTHETIC', '', 'in_progress', 1, '{}', 1, 'qa.member',"
                " '2026-11-10 09:00:00', '2026-11-10 09:00:00')"
            ))
            sop_id = _insert_row(
                conn, "target_docs", bundle_id=1, code="SOP-01", title="", doc_type="sop", entrance="match",
                is_equipment_sop=False, order_index=0, manual_order=False,
            )
            wi_id = _insert_row(
                conn, "target_docs", bundle_id=1, code="WI-01", title="", doc_type="wi", parent_id=sop_id,
                entrance="assign", is_equipment_sop=False, order_index=1, manual_order=False,
            )

        command.upgrade(config, "0023")

        with engine.begin() as conn:
            rows = conn.execute(text(
                f"SELECT target_doc_id, {', '.join(_OUTLINE_COLUMNS)} FROM target_doc_outline_items"
                " ORDER BY target_doc_id, order_index"
            )).all()
            standard_count = conn.execute(text("SELECT COUNT(*) FROM outline_standard_items")).scalar()
            # 문서를 지우면 사본도 함께 지워진다(FK CASCADE)
            conn.execute(text("DELETE FROM target_docs WHERE id = :id"), {"id": wi_id})
            conn.execute(text("DELETE FROM target_docs WHERE id = :id"), {"id": sop_id})
            left = conn.execute(text("SELECT COUNT(*) FROM target_doc_outline_items")).scalar()
    finally:
        engine.dispose()

    assert {row.target_doc_id for row in rows} == {sop_id}
    assert [
        (*row[1:6], bool(row.is_required), *row[7:10], bool(row.is_removed), row.deviation_reason) for row in rows
    ] == _LEGACY_ROWS
    assert standard_count == 0  # 0023은 표준 표를 비워 둔다 — 그때의 앱이 기동 때 시드했다
    assert left == 0


def test_outline_checks_hold_in_migrated_db(tmp_path: pathlib.Path) -> None:
    # 0023의 CHECK를 마이그레이션된 DB에 직접 부딪쳐 본다 — compare_metadata는 CHECK 차이를 못 잡는다
    db_path = tmp_path / "outline_checks.db"
    run_migrations(_async_url(db_path))
    engine = create_engine(_sync_url(db_path))  # FK를 켜지 않아 문서 행 없이 사본 한 행만 넣는다
    # 표준 표에는 0024가 넣은 템플릿 줄이 있다 — 키가 겹치면 CHECK가 아니라 PK로 거절되니 템플릿에 없는 키를 쓴다
    standard = {
        "key": "records", "order_index": 99, "title_en": "Records", "title_ko": "", "kind": "general",
        "is_required": True, "default_style": "bullet", "child_prefix": "", "suggestions": "[]",
    }
    doc_item = {
        **{name: value for name, value in standard.items() if name != "suggestions"},
        "target_doc_id": 1, "origin": "declared", "is_removed": False,
    }
    try:
        with engine.begin() as conn:
            _insert_values(conn, "outline_standard_items", standard)
            _insert_values(conn, "target_doc_outline_items", doc_item)
        for table, row, bad in (
            ("outline_standard_items", standard, {"key": "other", "kind": "chapter"}),
            ("outline_standard_items", standard, {"key": "other", "default_style": "dots"}),
            ("target_doc_outline_items", doc_item, {"key": "other", "kind": "chapter"}),
            ("target_doc_outline_items", doc_item, {"key": "other", "default_style": "dots"}),
            ("target_doc_outline_items", doc_item, {"key": "other", "origin": "imported"}),
        ):
            with pytest.raises(IntegrityError), engine.begin() as conn:
                _insert_values(conn, table, {**row, **bad})
        inspector = inspect(engine)
        check_names = {
            table: {ck["name"] for ck in inspector.get_check_constraints(table)}
            for table in ("outline_standard_items", "target_doc_outline_items")
        }
    finally:
        engine.dispose()

    assert check_names == {
        "outline_standard_items": {"ck_outline_standard_items_kind", "ck_outline_standard_items_default_style"},
        "target_doc_outline_items": {
            "ck_target_doc_outline_items_kind", "ck_target_doc_outline_items_default_style",
            "ck_target_doc_outline_items_origin",
        },
    }


def _insert_values(conn: Any, table: str, values: dict[str, Any]) -> None:
    columns = ", ".join(values)
    params = ", ".join(f":{name}" for name in values)
    conn.execute(text(f"INSERT INTO {table} ({columns}) VALUES ({params})"), values)


# --- 0024: 표준을 회사 템플릿으로, 옛 칸 키를 새 자리로 ---

_NOW = "2026-11-10 09:00:00"
_ASSOCIATED = "document_relationships.associated_documents"


def _insert_legacy_sop(conn: Any, code: str = "SOP-01", order_index: int = 0) -> int:
    """0023 모양의 SOP 문서 하나(옛 15칸 사본) — 묶음 1이 없으면 함께 만든다."""
    if conn.execute(text("SELECT COUNT(*) FROM bundles")).scalar() == 0:
        conn.execute(text(
            "INSERT INTO bundles (id, title, description, status, is_synthetic, semantic_checks, revision, created_by,"
            " created_at, updated_at) VALUES (1, 'SYNTHETIC', '', 'in_progress', 1, '{}', 1, 'qa.member', :now, :now)"
        ), {"now": _NOW})
    sop_id = _insert_row(
        conn, "target_docs", bundle_id=1, code=code, title="", doc_type="sop", entrance="assign",
        is_equipment_sop=False, order_index=order_index, manual_order=False,
    )
    for row in _LEGACY_ROWS:
        _insert_values(conn, "target_doc_outline_items", {"target_doc_id": sop_id, **dict(zip(_OUTLINE_COLUMNS, row, strict=True))})
    return sop_id


def _insert_sop_line(conn: Any, sop_id: int, slot_key: str, **extra: Any) -> int:
    """SOP 칸의 확정 줄 하나 — 글은 칸 키로 가려낸다."""
    fields = {"wi_step": None, "wi_part": None, "slot_key": slot_key, **extra}
    return _insert_target(conn, sop_id, fields.pop("kind", "sentence"), f"합성 줄 {slot_key}", "confirmed", **fields)


def _insert_na(
    conn: Any, sop_id: int, slot_key: str, reason: str = "합성 사유", set_by: str = "qa.member", set_at: str = _NOW
) -> None:
    _insert_values(conn, "target_doc_na_slots", {
        "target_doc_id": sop_id, "slot_key": slot_key, "reason": reason, "set_by": set_by, "set_at": set_at,
    })


def _read_na_rows(conn: Any, sop_id: int) -> dict[str, tuple[str, str, str]]:
    """그 문서의 N/A — 칸 키 → (사유, 표시한 사람, 시각 글자)."""
    rows = conn.execute(
        text("SELECT slot_key, reason, set_by, set_at FROM target_doc_na_slots WHERE target_doc_id = :d"), {"d": sop_id}
    )
    return {row.slot_key: (row.reason, row.set_by, str(row.set_at)) for row in rows}


def _read_doc_outline(conn: Any, target_doc_id: int) -> DocOutline:
    """마이그레이션된 사본을 앱의 값 객체로 읽는다 — 번호·라벨이 앱이 보는 그대로다."""
    rows = conn.execute(
        text(f"SELECT {', '.join(_OUTLINE_COLUMNS)} FROM target_doc_outline_items WHERE target_doc_id = :d"),
        {"d": target_doc_id},
    ).mappings().all()
    return DocOutline([
        OutlineItemInfo(**{**row, "is_required": bool(row["is_required"]), "is_removed": bool(row["is_removed"])})
        for row in rows
    ])


def _read_slot_keys(conn: Any) -> dict[int, str | None]:
    return dict(conn.execute(text("SELECT id, slot_key FROM target_sentences")).all())


def _read_na_keys(conn: Any) -> set[tuple[int, str]]:
    return {tuple(row) for row in conn.execute(text("SELECT target_doc_id, slot_key FROM target_doc_na_slots"))}


def test_0024_moves_legacy_keys(tmp_path: pathlib.Path) -> None:
    db_path = tmp_path / "template.db"
    config = _downgrade_to(db_path, "0023")
    engine = _create_fk_engine(db_path)
    legacy_keys = (
        "purpose", "general_requirements", "general_requirements.safety", "general_requirements.operation", "procedures",
        "procedures.procedure", "document_relationships", "document_relationships.attachments",
        "document_relationships.appendices",
    )
    try:
        with engine.begin() as conn:
            sop_id = _insert_legacy_sop(conn)
            wi_id = _insert_row(
                conn, "target_docs", bundle_id=1, code="WI-01", title="", doc_type="wi", parent_id=sop_id,
                entrance="assign", is_equipment_sop=False, order_index=1, manual_order=False,
            )
            lines = {key: _insert_sop_line(conn, sop_id, key) for key in legacy_keys}
            heading_id = _insert_sop_line(
                conn, sop_id, "document_relationships.attachments", kind="slot_heading", change_type="heading",
                confirmed_text="Document Relationships › Attachments",
            )
            wi_line = _insert_target(conn, wi_id, "sentence", "합성 WI 줄", "confirmed")
            _insert_na(conn, sop_id, "procedures.maintenance")
            # 줄이 하나도 없는 SOP — N/A만 옛 키를 가리킨다
            empty_id = _insert_legacy_sop(conn, "SOP-02", 2)
            _insert_na(conn, empty_id, "general_requirements.operation")
            _insert_na(conn, empty_id, "document_relationships")

        command.upgrade(config, "0024")

        with engine.begin() as conn:
            slot_keys = _read_slot_keys(conn)
            na_keys = _read_na_keys(conn)
            outline, empty_outline = _read_doc_outline(conn, sop_id), _read_doc_outline(conn, empty_id)
            wi_rows = conn.execute(
                text("SELECT COUNT(*) FROM target_doc_outline_items WHERE target_doc_id = :d"), {"d": wi_id}
            ).scalar()
            heading_text = conn.execute(
                text("SELECT confirmed_text FROM target_sentences WHERE id = :id"), {"id": heading_id}
            ).scalar()
            standard = conn.execute(text(
                "SELECT key, title_en, kind, is_required, default_style, child_prefix, suggestions"
                " FROM outline_standard_items ORDER BY order_index"
            )).all()
    finally:
        engine.dispose()

    # 옛 키는 대응표대로 옮겨지고, 이름이 같은 키와 6장에 직접 놓인 줄(머리 글)은 그대로다
    assert {key: slot_keys[target_id] for key, target_id in lines.items()} == {
        "purpose": "purpose", "general_requirements": "general_requirements",
        "general_requirements.safety": "general_requirements.safety",
        "general_requirements.operation": "general_requirements.work",
        "procedures": "procedures", "procedures.procedure": "procedures.procedure",
        "document_relationships": "document_relationships.references",
        "document_relationships.attachments": "attachments",
        "document_relationships.appendices": "appendices.a1",
    }
    assert (slot_keys[heading_id], heading_text) == ("attachments", "Attachments")  # 칸 제목의 글은 새 칸의 라벨
    assert slot_keys[wi_line] is None
    # 옛 7장의 N/A는 줄과 달리 7장(묶음 제목)에 남고 8·9장에도 달린다(test_0024_keeps_a_chapter_na_on_chapter_seven)
    assert na_keys == {
        (sop_id, "procedures.maintenance"), (empty_id, "general_requirements.work"),
        (empty_id, "document_relationships"), (empty_id, "attachments"), (empty_id, "appendices"),
    }
    # 사본은 템플릿 + 그 문서가 쓰던 옛 하위 칸(선언 항목) — 쓰지 않던 ERC·Troubleshooting은 생기지 않는다
    template_keys = [item.key for item in TEMPLATE_OUTLINE]
    declared = {item.key: item for item in outline.items if item.origin == "declared"}
    assert sorted(declared) == [
        "appendices.a1", "general_requirements.safety", "general_requirements.work", "procedures.maintenance",
        "procedures.procedure",
    ]
    assert [item.key for item in outline.items if item.origin == "standard"] == template_keys
    assert {key: (item.title_en, item.kind, item.is_required, item.default_style) for key, item in declared.items()} == {
        "general_requirements.safety": ("Safety", "general", True, "bullet"),
        "general_requirements.work": ("Work", "general", True, "bullet"),
        "procedures.procedure": ("Procedure", "general", True, "numbered"),
        "procedures.maintenance": ("Maintenance", "general", True, "numbered"),  # N/A만 지니던 칸도 선언 항목으로 남는다
        "appendices.a1": ("Appendices", "general", True, "numbered"),  # 옛 Appendices 칸의 이름을 지닌 첫 부록
    }
    assert [outline.get_number(key) for key in ("procedures.procedure", "procedures.maintenance", "attachments")] == [
        "6.1", "6.2", "8",
    ]
    assert (outline.get_number("general_requirements.safety"), outline.get_label("appendices.a1")) == (
        None, "Appendix 1. Appendices",
    )
    # 6장에 선언 항목이 하나도 없는 문서는 첫 절차를 받는다
    assert [item.key for item in empty_outline.items if item.origin == "declared"] == [
        "general_requirements.work", "procedures.p1",
    ]
    assert wi_rows == 0
    # 표준은 템플릿이고, 리비전이 얼려 둔 값이 지금 앱의 기본 표준과 같다
    assert [tuple(row[:6]) for row in standard] == [
        (item.key, item.title_en, item.kind, item.is_required, item.default_style, item.child_prefix)
        for item in TEMPLATE_OUTLINE
    ]
    assert {row.key: tuple(json.loads(row.suggestions)) for row in standard if json.loads(row.suggestions)} == (
        TEMPLATE_SUGGESTIONS
    )


def test_0024_keeps_a_chapter_na_on_chapter_seven(tmp_path: pathlib.Path) -> None:
    # 옛 7장의 N/A는 Attachments·Appendices까지 덮던 장 전체의 N/A다 — 새 7장(묶음 제목)에 남기고 8·9장에도 같은 사유로 단다
    db_path = tmp_path / "chapter_na.db"
    config = _downgrade_to(db_path, "0023")
    engine = _create_fk_engine(db_path)
    chapter = ("합성: 관련 문서 없음", "qa.lead", "2026-11-12 10:30:00")
    own_attachments, own_appendices = "합성: 첨부 없음", "합성: 부록 없음"
    try:
        with engine.begin() as conn:
            whole_id = _insert_legacy_sop(conn)
            _insert_na(conn, whole_id, "document_relationships", *chapter)
            # 하위 칸에 따로 둔 N/A는 대응표대로 옮겨지고, 이미 N/A가 있는 장(8장)에는 다시 달지 않는다
            mixed_id = _insert_legacy_sop(conn, "SOP-02", 1)
            _insert_na(conn, mixed_id, "document_relationships", *chapter)
            _insert_na(conn, mixed_id, "document_relationships.attachments", own_attachments)
            _insert_na(conn, mixed_id, "document_relationships.appendices", own_appendices)
            # N/A가 없는 문서의 옛 7장 줄은 지금처럼 7.3으로 간다
            line_id = _insert_legacy_sop(conn, "SOP-03", 2)
            line = _insert_sop_line(conn, line_id, "document_relationships")
            before = {doc_id: _read_na_rows(conn, doc_id) for doc_id in (whole_id, mixed_id, line_id)}

        command.upgrade(config, "0024")

        with engine.begin() as conn:
            whole, mixed = _read_na_rows(conn, whole_id), _read_na_rows(conn, mixed_id)
            line_na, line_key = _read_na_rows(conn, line_id), _read_slot_keys(conn)[line]
            mixed_outline = _read_doc_outline(conn, mixed_id)

        command.downgrade(config, "0023")

        with engine.begin() as conn:
            restored = {doc_id: _read_na_rows(conn, doc_id) for doc_id in (whole_id, mixed_id, line_id)}
    finally:
        engine.dispose()

    kept = before[whole_id]["document_relationships"]  # 사유·표시한 사람·시각 그대로
    assert kept[:2] == chapter[:2]
    assert whole == {"document_relationships": kept, "attachments": kept, "appendices": kept}
    assert mixed == {
        "document_relationships": kept,
        "attachments": before[mixed_id]["document_relationships.attachments"],  # 자기 사유가 남는다
        "appendices.a1": before[mixed_id]["document_relationships.appendices"],
        "appendices": kept,
    }
    assert mixed_outline.get_label("appendices.a1") == "Appendix 1. Appendices"
    assert (line_na, line_key) == ({}, "document_relationships.references")
    # 되돌리면 달았던 줄이 걷히고 옛 모습 그대로다
    assert restored == before


def test_migration_rewrites_keys_in_json(tmp_path: pathlib.Path) -> None:
    # 되돌리기 기록과 AI 제안에 든 옛 키도 옮긴다 — 옮기지 않으면 되돌린 줄이 없는 칸에 놓여 결과물에서 사라진다
    db_path = tmp_path / "json.db"
    config = _downgrade_to(db_path, "0023")
    engine = create_engine(_sync_url(db_path))  # FK를 켜지 않아 작업·단위 행 없이 기록만 넣는다
    row = {"id": 7, "target_doc_id": None, "slot_key": "document_relationships.attachments", "wi_step": None}
    history = {"disposition": "assigned", "targets": [{"id": 7, "text": "합성 줄"}]}
    try:
        with engine.begin() as conn:
            sop_id = _insert_legacy_sop(conn)
            row["target_doc_id"] = sop_id
            before = {"target_sentences": {"7": row}, "unit_decisions": {"3": {"unit_id": 3, "status": "confirmed"}}}
            # 지금은 줄이 없는 옛 하위 칸 — 되돌리면 줄이 여기로 돌아온다
            after = {"target_sentences": {"7": {**row, "slot_key": "procedures.troubleshooting"}}}
            _insert_values(conn, "decision_steps", {
                "id": 1, "bundle_id": 1, "actor": "qa.member", "session_key": "s", "seq": 1, "op": "save", "kind": "snapshot",
                "state": "done", "focus": "{}", "unit_ids": "[3]", "before": json.dumps(before), "after": json.dumps(after),
                "created_at": _NOW,
            })
            content = {"unit_ids": [3], "target_doc_id": sop_id, "slot_key": "document_relationships.attachments", "wi_step": None}
            _insert_values(conn, "ai_suggestions", {
                "id": 1, "job_id": 1, "bundle_id": 1, "kind": "classify", "content": json.dumps(content), "warnings": "[]",
                "result": "applied", "input_refs": "{}", "guideline_versions": "{}", "model": "", "created_at": _NOW,
            })
            _insert_values(conn, "unit_decision_history", {
                "id": 1, "unit_id": 3, "snapshot": json.dumps(history), "cause": "detach", "actor": "qa.member",
                "created_at": _NOW,
            })

        command.upgrade(config, "0024")

        with engine.begin() as conn:
            step = conn.execute(text("SELECT before, after FROM decision_steps")).one()
            new_content = json.loads(conn.execute(text("SELECT content FROM ai_suggestions")).scalar_one())
            new_history = json.loads(conn.execute(text("SELECT snapshot FROM unit_decision_history")).scalar_one())
            outline = _read_doc_outline(conn, sop_id)
    finally:
        engine.dispose()

    new_before, new_after = json.loads(step.before), json.loads(step.after)
    assert new_before["target_sentences"]["7"] == {**row, "slot_key": "attachments"}
    assert new_before["unit_decisions"] == before["unit_decisions"]  # 칸 키가 없는 곳은 그대로
    assert new_after == after  # 이름이 그대로인 키
    assert new_content == {**content, "slot_key": "attachments"}
    assert new_history == history
    # 기록만 가리키는 옛 하위 칸도 선언 항목으로 살아 있어, 되돌린 줄이 놓일 자리가 있다
    assert outline.find("procedures.troubleshooting") is not None and outline.find("attachments") is not None
    assert outline.find("procedures.p1") is None


def test_0024_turns_numbered_into_bullets(tmp_path: pathlib.Path) -> None:
    db_path = tmp_path / "bullets.db"
    config = _downgrade_to(db_path, "0023")
    engine = _create_fk_engine(db_path)
    cases = (  # (옛 칸 키, 저장된 표시, 올린 뒤 표시)
        ("purpose", "numbered", "bullet"),
        ("purpose", "omitted", "omitted"),
        ("purpose", "note", "note"),
        ("general_requirements.operation", "numbered", "bullet"),
        ("document_relationships", "numbered", "bullet"),
        ("document_relationships.attachments", "numbered", "bullet"),
        ("procedures", "numbered", "numbered"),  # 6장과 부록은 번호가 기본이라 그대로
        ("procedures.procedure", "numbered", "numbered"),
        ("document_relationships.appendices", "numbered", "numbered"),
    )
    try:
        with engine.begin() as conn:
            sop_id = _insert_legacy_sop(conn)
            wi_id = _insert_row(
                conn, "target_docs", bundle_id=1, code="WI-01", title="", doc_type="wi", parent_id=sop_id,
                entrance="assign", is_equipment_sop=False, order_index=1, manual_order=False,
            )
            ids = [_insert_sop_line(conn, sop_id, key, number_style=style) for key, style, _ in cases]
            heading_id = _insert_sop_line(conn, sop_id, "purpose", kind="slot_heading", change_type="heading")
            wi_line = _insert_target(conn, wi_id, "sentence", "합성 WI 줄", "confirmed")

        command.upgrade(config, "0024")

        with engine.begin() as conn:
            styles = dict(conn.execute(text("SELECT id, number_style FROM target_sentences")).all())
    finally:
        engine.dispose()

    assert [styles[target_id] for target_id in ids] == [expected for _, _, expected in cases]
    assert (styles[heading_id], styles[wi_line]) == ("numbered", "numbered")  # 칸 제목과 WI 줄은 건드리지 않는다


def test_0024_downgrade_restores_legacy_slots(tmp_path: pathlib.Path) -> None:
    db_path = tmp_path / "template_down.db"
    config = _downgrade_to(db_path, "0023")
    engine = _create_fk_engine(db_path)
    new_keys = {  # 새 키 → 되돌린 뒤의 옛 칸(옛 칸에 없는 선언 항목은 가까운 옛 칸으로)
        "purpose": "purpose", "general_requirements.work": "general_requirements.operation",
        "general_requirements.account": "general_requirements", "procedures.p1": "procedures.procedure",
        "procedures.maintenance": "procedures.maintenance", "attachments": "document_relationships.attachments",
        "appendices.a2": "document_relationships.appendices",
        "document_relationships.references": "document_relationships",
        f"{_ASSOCIATED}.form": "document_relationships",
    }
    try:
        with engine.begin() as conn:
            sop_id = _insert_legacy_sop(conn)
        command.upgrade(config, "0024")
        with engine.begin() as conn:
            lines = {key: _insert_sop_line(conn, sop_id, key) for key in new_keys}
            # 같은 옛 칸으로 모이는 N/A 둘은 하나만 남는다
            _insert_na(conn, sop_id, "appendices")
            _insert_na(conn, sop_id, "appendices.a1")

        command.downgrade(config, "0023")

        with engine.begin() as conn:
            slot_keys = _read_slot_keys(conn)
            na_keys = _read_na_keys(conn)
            rows = conn.execute(text(
                f"SELECT {', '.join(_OUTLINE_COLUMNS)} FROM target_doc_outline_items WHERE target_doc_id = :d"
                " ORDER BY order_index"
            ), {"d": sop_id}).all()
            standard_count = conn.execute(text("SELECT COUNT(*) FROM outline_standard_items")).scalar()
    finally:
        engine.dispose()

    assert {key: slot_keys[target_id] for key, target_id in lines.items()} == new_keys
    assert na_keys == {(sop_id, "document_relationships.appendices")}
    assert [
        (*row[0:5], bool(row.is_required), *row[6:9], bool(row.is_removed), row.deviation_reason) for row in rows
    ] == _LEGACY_ROWS
    assert standard_count == 0  # 0023 상태의 앱이 기동 때 옛 15칸을 시드한다


def _insert_decision(conn: Any, unit_id: int, status: str, disposition: str, hold_reason: str = "") -> None:
    conn.execute(text(
        "INSERT INTO unit_decisions (unit_id, bundle_id, disposition, move_target_code, reason, status, hold_reason,"
        " revision, updated_at) VALUES (:u, 1, :d, '', '', :s, :h, 2, '2026-11-10 09:00:00')"
    ), {"u": unit_id, "d": disposition, "s": status, "h": hold_reason})


def test_0031_takes_back_what_ai_wrote_into_decisions_and_targets(tmp_path: pathlib.Path) -> None:
    # AI 분류·묶기가 쓴 판단·새 문장을 걷는다 — 입구 1 AI 새 문장과 그 AI 번역은 지우고, 입구 2 새 문장은 미배정으로, 판단은 미배정으로
    db_path = tmp_path / "ai_suggest_only.db"
    config = _downgrade_to(db_path, "0030")
    engine = _create_fk_engine(db_path)
    try:
        with engine.begin() as conn:
            ids = _insert_old_bundle(conn)
            doc = ids["target_doc_id"]
            suggested = _insert_unit(conn, ids["extraction_id"], 3, "sentence", "AI가 고른 문장.", "ko", 0)
            held = _insert_unit(conn, ids["extraction_id"], 4, "sentence", "AI 답이 무효였다.", "ko", 0)
            _insert_decision(conn, suggested, "ai_suggested", "assigned")
            _insert_decision(conn, held, "on_hold", "unassigned", "system:ai_invalid_response")
            ai_target = _insert_target(conn, doc, "sentence", "", "ai_suggested", ai_text="AI가 고친 문장.")
            conn.execute(text("INSERT INTO target_sources (target_id, unit_id, seq) VALUES (:t, :u, 0)"),
                         {"t": ai_target, "u": suggested})
            ai_translation = _insert_target(
                conn, doc, "sentence", "", "ai_suggested", origin="translation", lang="en",
                translation_source_unit_id=suggested, change_type="translated",
            )
            human_translation = _insert_target(
                conn, doc, "sentence", "Checked.", "confirmed", origin="translation", lang="en",
                translation_source_unit_id=suggested, change_type="translated",
            )
            _, (new_extraction,) = _insert_document(conn, "new", ("2",))
            new_unit = _insert_unit(conn, new_extraction, 1, "sentence", "운전 전 점검한다.", "ko", 0)
            new_doc_target = _insert_target(
                conn, doc, "sentence", "", "ai_suggested", origin="new_doc", new_unit_id=new_unit,
                confirmed_text="운전 전 점검한다.", change_type="tone", warnings='[{"kind": "x"}]',
            )
            conn.execute(text("INSERT INTO target_sources (target_id, unit_id, seq) VALUES (:t, :u, 0)"),
                         {"t": new_doc_target, "u": suggested})
            heading = _insert_target(conn, doc, "slot_heading", "", "ai_suggested", order_index=2)
            # AI가 쓴 표와 그 칸, 그 칸을 사람이 번역해 확정한 줄 — 칸 번역은 칸 단위를 가리켜 판단 조건으로는 잡히지 않는다
            table_target = _insert_target(conn, doc, "table", "", "ai_suggested", order_index=3)
            cell_target = _insert_target(conn, doc, "sentence", "", "ai_suggested", parent_target_id=table_target)
            cell_translation = _insert_target(
                conn, doc, "sentence", "Cell.", "confirmed", origin="translation", lang="en",
                parent_target_id=table_target, change_type="translated",
            )
            job = _insert_row(
                conn, "ai_jobs", bundle_id=1, kind="match", status="done", unit_ids="[]", target_ids="[]", payload="{}",
                input_snapshot="{}", attempts=1, error="", requested_by="qa.member", request_id="r" * 32, priority=1,
                background=False, created_at="2026-11-10 09:00:00",
            )
            suggestion_row = {
                "job_id": job, "bundle_id": 1, "warnings": "[]", "result": "applied", "input_refs": "{}",
                "guideline_versions": "{}", "model": "", "created_at": "2026-11-10 09:00:00",
            }
            classify = _insert_row(
                conn, "ai_suggestions", kind="classify", **suggestion_row,
                content=f'{{"unit_ids": [{suggested}], "target_ids": [{ai_target}], "disposition": "assigned"}}',
            )
            match = _insert_row(
                conn, "ai_suggestions", kind="match", **suggestion_row,
                content=f'{{"unit_ids": [{suggested}], "target_ids": [{new_doc_target}], "shape": "one_to_one"}}',
            )

        command.upgrade(config, "0031")

        with engine.connect() as conn:
            targets = {row.id: row for row in conn.execute(text(
                "SELECT id, status, change_type, warnings, confirmed_text, revision FROM target_sentences"
            ))}
            sources = {tuple(row) for row in conn.execute(text("SELECT target_id, unit_id FROM target_sources"))}
            decisions = {row.unit_id: row for row in conn.execute(text(
                "SELECT unit_id, status, disposition, hold_reason, revision FROM unit_decisions"
            ))}
            contents = {row.id: json.loads(row.content) for row in conn.execute(text("SELECT id, content FROM ai_suggestions"))}
    finally:
        engine.dispose()

    assert ai_target not in targets and ai_translation not in targets
    # 따를 출처 새 문장이 사라지는 번역은 확정했어도 지운다(실제 사용 전) — 걷는 판단의 번역, 지우는 AI 표 아래 칸 번역
    assert human_translation not in targets and cell_translation not in targets
    assert table_target not in targets and cell_target not in targets
    # 살아 있는 제안은 새 모양으로 남는다 — 분류는 지운 새 문장 id를 빼고, 묶기는 지운 출처 연결·변경 종류를 옮겨 싣는다
    assert contents[classify] == {"unit_ids": [suggested], "disposition": "assigned"}
    assert contents[match]["links"] == [[new_doc_target, suggested]]
    assert contents[match]["target_change_types"] == {str(new_doc_target): "tone"}
    new_doc_row = targets[new_doc_target]
    assert (new_doc_row.status, new_doc_row.change_type, new_doc_row.warnings) == ("unassigned", None, "[]")
    assert (new_doc_row.confirmed_text, new_doc_row.revision) == ("운전 전 점검한다.", 2)  # 원문은 남는다
    assert targets[heading].status == "unassigned"  # 칸 제목은 지우지 않고 상태만 다시 정한다
    assert all(target_id != new_doc_target and target_id != ai_target for target_id, _ in sources)
    for unit_id in (suggested, held):
        row = decisions[unit_id]
        assert (row.status, row.disposition, row.hold_reason, row.revision) == ("unassigned", "unassigned", "", 3)
    assert decisions[ids["figure_id"]].status == "confirmed"  # 사람이 정한 판단은 그대로


def test_0032_folds_tone_and_table_restructured_into_rewritten(tmp_path: pathlib.Path) -> None:
    # 변경 종류는 그대로·고침 둘 — 새 문장과 JSON 속 옛 값(제안 내용, 되돌리기 기록)을 고침으로, 대기·실행 중 LLM match 작업은 취소
    db_path = tmp_path / "change_type_two.db"
    config = _downgrade_to(db_path, "0031")
    engine = _create_fk_engine(db_path)
    try:
        with engine.begin() as conn:
            ids = _insert_old_bundle(conn)
            doc = ids["target_doc_id"]
            tone = _insert_target(conn, doc, "sentence", "점검하여야 한다.", "confirmed", change_type="tone", order_index=2)
            table = _insert_target(conn, doc, "table", "", "confirmed", change_type="table_restructured", order_index=3)
            split = _insert_target(conn, doc, "sentence", "나눈 글.", "confirmed", change_type="split", order_index=4)
            jobs = {
                (kind, status): _insert_row(
                    conn, "ai_jobs", bundle_id=1, kind=kind, status=status, unit_ids="[]", target_ids="[]", payload="{}",
                    input_snapshot="{}", attempts=0, error="", requested_by="qa.member", request_id="r" * 32, priority=1,
                    background=False, created_at=_NOW,
                )
                for kind, status in (("match", "queued"), ("match", "running"), ("match", "done"), ("classify", "queued"))
            }
            suggestion_row = {
                "job_id": jobs[("match", "done")], "bundle_id": 1, "warnings": "[]", "result": "applied",
                "input_refs": "{}", "guideline_versions": "{}", "model": "", "created_at": _NOW,
            }
            match_content = {
                "shape": "table", "change_type": "table_restructured", "reason": "말투 tone",
                "target_change_types": {str(table): "table_restructured", str(tone): "tone", str(split): "split"},
            }
            match = _insert_row(conn, "ai_suggestions", kind="match", content=json.dumps(match_content), **suggestion_row)
            classify_content = {"disposition": "assigned", "change_type": "tone", "rewrites": {"ko": ["고친 글."]}}
            classify = _insert_row(
                conn, "ai_suggestions", kind="classify", content=json.dumps(classify_content), **suggestion_row
            )
            untouched_content = {"disposition": "assigned", "change_type": "rewritten"}
            untouched = _insert_row(
                conn, "ai_suggestions", kind="classify", content=json.dumps(untouched_content), **suggestion_row
            )
            before = {"target_sentences": {str(tone): {"id": tone, "change_type": "tone", "remark": "tone"}}}
            after = {"target_sentences": {str(table): {"id": table, "change_type": "table_restructured"}}, "groups": [
                {"targets": [{"change_type": "as_is"}, {"change_type": "tone"}]},
            ]}
            _insert_values(conn, "decision_steps", {
                "id": 1, "bundle_id": 1, "actor": "qa.member", "session_key": "s", "seq": 1, "op": "save",
                "kind": "snapshot", "state": "applied", "focus": "{}", "unit_ids": "[]", "before": json.dumps(before),
                "after": json.dumps(after), "created_at": _NOW,
            })

        command.upgrade(config, "0032")

        with engine.connect() as conn:
            types = dict(conn.execute(text("SELECT id, change_type FROM target_sentences")).tuples().all())
            contents = {row.id: json.loads(row.content) for row in conn.execute(text("SELECT id, content FROM ai_suggestions"))}
            step = conn.execute(text("SELECT before, after FROM decision_steps")).one()
            job_rows = {row.id: row for row in conn.execute(text("SELECT id, status, finished_at FROM ai_jobs"))}
    finally:
        engine.dispose()

    assert (types[tone], types[table], types[split], types[ids["figure_target_id"]]) == (
        "rewritten", "rewritten", "split", "as_is",
    )
    # 이유 같은 다른 글 칸은 그대로 — 바꾸는 것은 change_type 키와 target_change_types의 값뿐이다
    assert contents[match] == {
        **match_content, "change_type": "rewritten",
        "target_change_types": {str(table): "rewritten", str(tone): "rewritten", str(split): "split"},
    }
    assert contents[classify] == {**classify_content, "change_type": "rewritten"}
    assert contents[untouched] == untouched_content
    assert json.loads(step.before) == {"target_sentences": {str(tone): {"id": tone, "change_type": "rewritten", "remark": "tone"}}}
    assert json.loads(step.after) == {"target_sentences": {str(table): {"id": table, "change_type": "rewritten"}}, "groups": [
        {"targets": [{"change_type": "as_is"}, {"change_type": "rewritten"}]},
    ]}
    for kind, status in (("match", "queued"), ("match", "running")):
        row = job_rows[jobs[(kind, status)]]
        assert row.status == "cancelled" and row.finished_at is not None
    assert job_rows[jobs[("match", "done")]].status == "done"
    assert job_rows[jobs[("classify", "queued")]].status == "queued"  # 분류 작업은 그대로 돈다


def test_0034_adds_unwrap_order_with_empty_history_and_drops_it_back(tmp_path: pathlib.Path) -> None:
    # 벗긴 표 줄 순서 — 지난 단위는 원문 순서(NULL), 지난 편집 기록은 순서를 바꾸지 않았다(빈 객체). 내리면 두 열이 빠진다
    db_path = tmp_path / "unwrap_seq.db"
    config = _downgrade_to(db_path, "0033")
    engine = _create_fk_engine(db_path)
    try:
        with engine.begin() as conn:
            ids = _insert_old_bundle(conn)
            document_id = conn.execute(
                text("SELECT document_id FROM extractions WHERE id = :e"), {"e": ids["extraction_id"]}
            ).scalar_one()
            _insert_values(conn, "unit_edits", {
                "document_id": document_id, "seq": 1, "op": "split", "payload": "{}", "created_unit_ids": "[]",
                "retired_unit_ids": "[]", "regrouped": "{}", "lang_changes": "{}", "layout_changes": "{}",
                "noise_changes": "{}", "figure_changes": "{}", "pair_seq_changes": "{}", "state": "applied",
                "actor": "qa.member", "created_at": _NOW,
            })

        command.upgrade(config, "0034")

        with engine.connect() as conn:
            seqs = conn.execute(text("SELECT unwrap_seq FROM units")).scalars().all()
            history = conn.execute(text("SELECT unwrap_seq_changes FROM unit_edits")).scalars().all()
        assert seqs and set(seqs) == {None}
        assert [json.loads(value) for value in history] == [{}]

        command.downgrade(config, "0033")

        with engine.connect() as conn:
            unit_columns = {column["name"] for column in inspect(conn).get_columns("units")}
            edit_columns = {column["name"] for column in inspect(conn).get_columns("unit_edits")}
        assert "unwrap_seq" not in unit_columns and "unwrap_seq_changes" not in edit_columns
    finally:
        engine.dispose()


def test_0035_turns_line_breaks_in_unit_text_into_spaces_and_keeps_length(tmp_path: pathlib.Path) -> None:
    # 박스 하나는 한 줄(항목 6-a) — 저장된 단위 글의 줄바꿈만 띄어쓰기로, 길이는 그대로, 새 문장 글은 사람 글이라 그대로
    db_path = tmp_path / "unit_text_spaces.db"
    config = _downgrade_to(db_path, "0034")
    engine = _create_fk_engine(db_path)
    try:
        with engine.begin() as conn:
            ids = _insert_old_bundle(conn)
            sentence_id = conn.execute(text("SELECT id FROM units WHERE id != :f"), {"f": ids["figure_id"]}).scalar_one()
            target_id = conn.execute(text("SELECT id FROM target_sentences WHERE id != :f"),
                                     {"f": ids["figure_target_id"]}).scalar_one()
            joined, plain = "7\n세척 노즐을\r\n점검한다.", "줄바꿈 없는 글."
            conn.execute(text("UPDATE units SET text = :t WHERE id = :u"), {"t": joined, "u": sentence_id})
            conn.execute(text("UPDATE units SET text = :t WHERE id = :u"), {"t": plain, "u": ids["figure_id"]})
            conn.execute(text("UPDATE target_sentences SET confirmed_text = :t WHERE id = :s"),
                         {"t": joined, "s": target_id})

        command.upgrade(config, "0035")

        with engine.connect() as conn:
            texts = dict(conn.execute(text("SELECT id, text FROM units")).tuples().all())
            target = conn.execute(
                text("SELECT confirmed_text FROM target_sentences WHERE id = :s"), {"s": target_id}
            ).scalar_one()
    finally:
        engine.dispose()

    assert texts[sentence_id] == "7 세척 노즐을  점검한다."
    assert len(texts[sentence_id]) == len(joined)
    assert texts[ids["figure_id"]] == plain
    assert target == joined


def test_0036_adds_indent_shift_with_zero_and_empty_history_and_drops_it_back(tmp_path: pathlib.Path) -> None:
    # 들여쓰기 차이 — 지난 단위는 셈한 단계 그대로(0), 지난 편집 기록은 들여쓰기를 바꾸지 않았다(빈 객체). 내리면 두 열이 빠진다
    db_path = tmp_path / "indent_shift.db"
    config = _downgrade_to(db_path, "0035")
    engine = _create_fk_engine(db_path)
    try:
        with engine.begin() as conn:
            ids = _insert_old_bundle(conn)
            document_id = conn.execute(
                text("SELECT document_id FROM extractions WHERE id = :e"), {"e": ids["extraction_id"]}
            ).scalar_one()
            _insert_values(conn, "unit_edits", {
                "document_id": document_id, "seq": 1, "op": "split", "payload": "{}", "created_unit_ids": "[]",
                "retired_unit_ids": "[]", "regrouped": "{}", "lang_changes": "{}", "layout_changes": "{}",
                "noise_changes": "{}", "figure_changes": "{}", "pair_seq_changes": "{}", "unwrap_seq_changes": "{}",
                "state": "applied", "actor": "qa.member", "created_at": _NOW,
            })

        command.upgrade(config, "0036")

        with engine.connect() as conn:
            shifts = conn.execute(text("SELECT indent_shift FROM units")).scalars().all()
            history = conn.execute(text("SELECT indent_changes FROM unit_edits")).scalars().all()
        assert shifts and set(shifts) == {0}
        assert [json.loads(value) for value in history] == [{}]

        command.downgrade(config, "0035")

        with engine.connect() as conn:
            unit_columns = {column["name"] for column in inspect(conn).get_columns("units")}
            edit_columns = {column["name"] for column in inspect(conn).get_columns("unit_edits")}
        assert "indent_shift" not in unit_columns and "indent_changes" not in edit_columns
    finally:
        engine.dispose()
