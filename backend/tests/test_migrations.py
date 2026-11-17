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


def _read_outputs(db_path: pathlib.Path) -> tuple[Any, list[Any], list[list[str]]]:
    """앱 코드로 읽은 검토 조건·결과물 C 항목·Excel C 시트 글."""
    import asyncio
    from datetime import UTC, datetime

    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

    from app.sop.excel_export import ExportMeta
    from app.sop.outputs import build_output_c
    from app.sop.review import evaluate_readiness
    from app.sop.sheet_model import SHEET_NAMES, build_workbook_model
    from app.sop.models import CaptionRef
    from app.sop.snapshot import load_bundle_snapshot

    async def _load() -> Any:
        engine = create_async_engine(_async_url(db_path))
        try:
            # 앱 코드는 head 스키마를 읽는다 — 0021 앞 리비전에서는 빈 caption_refs 표를 잠시 두고 읽은 뒤 지운다
            async with engine.begin() as conn:
                created = not await conn.run_sync(lambda sync: sync.dialect.has_table(sync, CaptionRef.__tablename__))
                if created:
                    await conn.run_sync(CaptionRef.__table__.create)
            try:
                async with AsyncSession(engine) as session:
                    return await load_bundle_snapshot(session, 1)
            finally:
                if created:
                    async with engine.begin() as conn:
                        await conn.run_sync(CaptionRef.__table__.drop)
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
