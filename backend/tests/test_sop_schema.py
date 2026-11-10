"""SOP 코어 스키마(리비전 0005) — 제약과 CASCADE를 마이그레이션이 만든 DB에 직접 부딪쳐 확인한다."""

import pathlib
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from sqlalchemy import Engine, create_engine, delete, event, func, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import run_migrations
from app.sop.models import (
    Bundle,
    BundleDeletionRecord,
    BundleEvent,
    BundleMember,
    Document,
    DocumentFile,
    Extraction,
    ExtractionWarning,
    SourceBlock,
    SourceTable,
    TargetDoc,
    TargetDocNaSlot,
    TargetSentence,
    TargetSource,
    TargetTextHistory,
    Unit,
    UnitDecision,
    UnitDecisionHistory,
    UnitEdit,
    UnitPair,
    UnitPairMember,
    WiStep,
)

SHA_A = "a" * 64
SHA_B = "b" * 64


@pytest.fixture
def engine(tmp_path: pathlib.Path) -> Iterator[Engine]:
    """마이그레이션된 임시 sqlite + 연결마다 FK를 켠 동기 엔진 — RESTRICT·CASCADE를 운영 PG와 같게 본다."""
    db_path = tmp_path / "sop.db"
    run_migrations(f"sqlite+aiosqlite:///{db_path}")
    sync_engine = create_engine(f"sqlite:///{db_path}")

    @event.listens_for(sync_engine, "connect")
    def _enable_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    yield sync_engine
    sync_engine.dispose()


def _add_bundle(session: Session, **overrides: Any) -> Bundle:
    bundle = Bundle(title="합성 묶음", is_synthetic=True, created_by="qa.member", **overrides)
    session.add(bundle)
    session.flush()
    return bundle


def _add_document(
    session: Session, bundle: Bundle, *, side: str = "old", sha256: str = SHA_A, **overrides: Any
) -> Document:
    document = Document(
        bundle_id=bundle.id,
        side=side,
        file_name="synthetic.docx",
        file_format="docx",
        size_bytes=10,
        sha256=sha256,
        status="ready",
        uploaded_by="qa.member",
        **overrides,
    )
    session.add(document)
    session.flush()
    return document


def _add_extraction(session: Session, document: Document) -> Extraction:
    extraction = Extraction(document_id=document.id, extractor_version="1", aux_status="ok")
    session.add(extraction)
    session.flush()
    return extraction


def _add_unit(session: Session, extraction: Extraction, local_no: int = 1, **overrides: Any) -> Unit:
    values: dict[str, Any] = {
        "kind": "sentence",
        "spans": [],
        "text": "합성 문장",
        "lang": "ko",
        "pos_seq": local_no,
        "pos_start": 0,
    }
    unit = Unit(extraction_id=extraction.id, local_no=local_no, **{**values, **overrides})
    session.add(unit)
    session.flush()
    return unit


def _add_target_doc(session: Session, bundle: Bundle, code: str = "SOP-001", **overrides: Any) -> TargetDoc:
    values: dict[str, Any] = {"doc_type": "sop", "entrance": "assign"}
    target_doc = TargetDoc(bundle_id=bundle.id, code=code, **{**values, **overrides})
    session.add(target_doc)
    session.flush()
    return target_doc


def _build_sentence(bundle: Bundle, target_doc: TargetDoc, **overrides: Any) -> TargetSentence:
    values: dict[str, Any] = {"lang": "ko", "kind": "sentence", "origin": "units", "status": "unassigned"}
    return TargetSentence(bundle_id=bundle.id, target_doc_id=target_doc.id, **{**values, **overrides})


def test_status_checks_reject_unknown_values(engine: Engine) -> None:
    def build_bad_bundle(session: Session) -> object:
        return Bundle(title="합성", created_by="qa.member", status="archived")

    def build_bad_member(session: Session) -> object:
        return BundleMember(bundle_id=_add_bundle(session).id, login_id="qa.member", role="owner", added_by="x")

    def build_bad_decision(session: Session) -> object:
        bundle = _add_bundle(session)
        unit = _add_unit(session, _add_extraction(session, _add_document(session, bundle)))
        return UnitDecision(unit_id=unit.id, bundle_id=bundle.id, status="done")

    def build_bad_sentence(session: Session) -> object:
        bundle = _add_bundle(session)
        return _build_sentence(bundle, _add_target_doc(session, bundle), status="done")

    builders: list[Callable[[Session], object]] = [
        build_bad_bundle,
        build_bad_member,
        build_bad_decision,
        build_bad_sentence,
    ]
    for build in builders:
        with Session(engine) as session:
            session.add(build(session))
            with pytest.raises(IntegrityError, match="CHECK constraint failed"):
                session.commit()


def test_unique_constraints(engine: Engine) -> None:
    with Session(engine) as session:
        bundle = _add_bundle(session)
        document = _add_document(session, bundle)
        _add_target_doc(session, bundle, code="SOP-001")
        unit = _add_unit(session, _add_extraction(session, document))
        pairs = [UnitPair(document_id=document.id, status="confirmed", source="user") for _ in range(2)]
        session.add_all(pairs)
        session.flush()
        session.add(UnitPairMember(pair_id=pairs[0].id, unit_id=unit.id))
        session.commit()
        bundle_id, second_pair_id, unit_id = bundle.id, pairs[1].id, unit.id

    # 같은 묶음에 같은 sha256 문서 두 번
    with Session(engine) as session:
        session.add(Document(
            bundle_id=bundle_id, side="new", file_name="again.docx", file_format="docx",
            size_bytes=1, sha256=SHA_A, status="ready", uploaded_by="qa.member",
        ))
        with pytest.raises(IntegrityError, match="UNIQUE constraint failed: documents"):
            session.commit()

    # 같은 sha256이라도 다른 묶음이면 허용된다(유일성은 묶음 안에서만)
    with Session(engine) as session:
        _add_document(session, _add_bundle(session))
        session.commit()

    # 같은 묶음에 같은 code 새 문서 두 번
    with Session(engine) as session:
        session.add(TargetDoc(bundle_id=bundle_id, code="SOP-001", doc_type="wi", entrance="match"))
        with pytest.raises(IntegrityError, match="UNIQUE constraint failed: target_docs"):
            session.commit()

    # 한 단위를 두 짝에 넣기
    with Session(engine) as session:
        session.add(UnitPairMember(pair_id=second_pair_id, unit_id=unit_id))
        with pytest.raises(IntegrityError, match="UNIQUE constraint failed: unit_pair_members"):
            session.commit()


def _seed_full_bundle(session: Session) -> int:
    """묶음에 딸린 21개 표에 한 행씩 넣는다. 자기 참조·교차 FK(부모 SOP→WI, 문장→새 문서, 그룹 단위)를 모두 쓴다."""
    bundle = _add_bundle(session)
    session.add(BundleMember(bundle_id=bundle.id, login_id="qa.member", role="author", added_by="qa.member"))
    session.add(BundleEvent(bundle_id=bundle.id, actor="qa.member", action="create"))

    # 부모 SOP가 WI보다 먼저(id가 작게) 들어가야 즉시 검사(RESTRICT)였다면 묶음 삭제 때 부모부터 지워져 실패한다
    sop = _add_target_doc(session, bundle, code="SOP-001")
    wi = _add_target_doc(session, bundle, code="WI-001", doc_type="wi", parent_id=sop.id)
    session.add(TargetDocNaSlot(target_doc_id=sop.id, slot_key="scope", reason="해당 없음", set_by="qa.member"))
    session.add(WiStep(target_doc_id=wi.id, step_no=1))

    old = _add_document(session, bundle, side="old", sha256=SHA_A)
    session.add(DocumentFile(document_id=old.id, content=b"synthetic"))
    new = _add_document(session, bundle, side="new", sha256=SHA_B, target_doc_id=wi.id)
    extraction = _add_extraction(session, old)
    new_extraction = _add_extraction(session, new)

    table = SourceTable(
        extraction_id=extraction.id, table_index=0, part="body", xml_path="/t", n_rows=1, n_cols=1
    )
    session.add(table)
    session.flush()
    session.add(SourceTable(
        extraction_id=extraction.id, table_index=1, part="body", xml_path="/t2", n_rows=1, n_cols=1,
        parent_table_id=table.id,
    ))
    block = SourceBlock(
        extraction_id=extraction.id, seq=1, part="body", kind="table_cell", text="합성", xml_path="/b",
        page_basis="none", table_id=table.id, row_index=0, col_index=0,
    )
    session.add(block)
    session.flush()
    session.add(ExtractionWarning(extraction_id=extraction.id, kind="empty", block_id=block.id, needs_ack=False))

    table_unit = _add_unit(session, extraction, 1, kind="table", table_id=table.id, pos_start=-1)
    cell_unit = _add_unit(
        session, extraction, 2, kind="cell_sentence", table_id=table.id, group_unit_id=table_unit.id
    )
    new_unit = _add_unit(session, new_extraction, 1)
    session.add(UnitEdit(document_id=old.id, seq=1, op="split", payload={}, actor="qa.member"))
    pair = UnitPair(document_id=old.id, status="confirmed", source="user")
    session.add(pair)
    session.flush()
    session.add(UnitPairMember(pair_id=pair.id, unit_id=cell_unit.id))
    session.add(UnitDecision(unit_id=cell_unit.id, bundle_id=bundle.id))
    session.add(UnitDecisionHistory(unit_id=cell_unit.id, snapshot={}, cause="user", actor="qa.member"))

    parent_sentence = _build_sentence(bundle, sop)
    session.add(parent_sentence)
    session.flush()
    child_sentence = _build_sentence(
        bundle, sop, origin="new_doc", new_unit_id=new_unit.id, parent_target_id=parent_sentence.id
    )
    session.add(child_sentence)
    session.flush()
    session.add(TargetSource(target_id=child_sentence.id, unit_id=cell_unit.id, seq=1))
    session.add(TargetTextHistory(target_id=child_sentence.id, previous_text="이전", changed_by="qa.member"))
    session.add(BundleDeletionRecord(bundle_id=bundle.id, title="합성 묶음", actor="qa.member"))
    session.flush()
    return bundle.id


_BUNDLE_OWNED = (
    BundleMember, BundleEvent, TargetDoc, TargetDocNaSlot, WiStep, Document, DocumentFile, Extraction,
    SourceTable, SourceBlock, ExtractionWarning, Unit, UnitEdit, UnitPair, UnitPairMember, UnitDecision,
    UnitDecisionHistory, TargetSentence, TargetSource, TargetTextHistory,
)


def _count_rows(session: Session, model: type) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_bundle_delete_cascades(engine: Engine) -> None:
    with Session(engine) as session:
        bundle_id = _seed_full_bundle(session)
        session.commit()
    with Session(engine) as session:
        # 시드가 모든 표에 실제로 행을 넣었는지 먼저 확인한다(0 == 0 으로 공허하게 통과하지 않게)
        assert all(_count_rows(session, model) >= 1 for model in (Bundle, *_BUNDLE_OWNED))

    with Session(engine) as session:
        session.execute(delete(Bundle).where(Bundle.id == bundle_id))
        session.commit()

    with Session(engine) as session:
        assert _count_rows(session, Bundle) == 0
        remaining = {model.__tablename__: _count_rows(session, model) for model in _BUNDLE_OWNED}
        assert {name: count for name, count in remaining.items() if count} == {}
        # 삭제 기록은 FK 없이 묶음보다 오래 남는다
        assert _count_rows(session, BundleDeletionRecord) == 1


def test_check_constraint_names(engine: Engine) -> None:
    expected = {
        "bundles": {"ck_bundles_status"},
        "bundle_members": {"ck_bundle_members_role"},
        "unit_decisions": {"ck_unit_decisions_status"},
        "target_sentences": {"ck_target_sentences_status", "ck_target_sentences_number_style"},
    }
    inspector = inspect(engine)
    for table, names in expected.items():
        assert {ck["name"] for ck in inspector.get_check_constraints(table)} == names


def test_target_doc_fks_leave_ondelete_unset(engine: Engine) -> None:
    # RESTRICT는 즉시 검사라 묶음 CASCADE가 부모 SOP·새 문서를 자식보다 먼저 지우면 실패한다.
    # sqlite는 문장을 먼저 지워 cascade 테스트로는 이 절반이 안 잡히므로 FK 옵션을 직접 확인한다.
    inspector = inspect(engine)
    for table, column in (("target_docs", "parent_id"), ("target_sentences", "target_doc_id")):
        foreign_keys = [fk for fk in inspector.get_foreign_keys(table) if fk["constrained_columns"] == [column]]
        assert len(foreign_keys) == 1
        assert foreign_keys[0]["options"].get("ondelete") is None


def test_fk_columns_hit_by_cascades_are_indexed(engine: Engine) -> None:
    # 캐스케이드·역조회가 인덱스 없는 FK를 Postgres에서 순차 스캔하지 않게 한다(PK 둘째 열은 PK를 못 탄다)
    expected = {
        "bundle_members": {"ix_bundle_members_login_id"},
        "units": {"ix_units_group_unit_id", "ix_units_table_id"},
        "source_blocks": {"ix_source_blocks_table_id"},
        "extraction_warnings": {"ix_extraction_warnings_block_id"},
        "target_sentences": {"ix_target_sentences_new_unit_id", "ix_target_sentences_parent_target_id"},
        "target_sources": {"ix_target_sources_unit_id"},
    }
    inspector = inspect(engine)
    for table, names in expected.items():
        assert names <= {index["name"] for index in inspector.get_indexes(table)}, table
