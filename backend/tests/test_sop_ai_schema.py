"""AI 스키마(리비전 0007) — 제약·인덱스·CASCADE·SET NULL을 마이그레이션이 만든 DB에 직접 부딪쳐 확인한다."""

import pathlib
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from sqlalchemy import Engine, create_engine, delete, event, func, inspect, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateIndex

from app.db import run_migrations
from app.sop.constants import (
    AI_ADOPTIONS,
    AI_JOB_KINDS,
    AI_JOB_STATUSES,
    AI_SUGGESTION_RESULTS,
    GUIDELINE_KEYS,
    SYSTEM_HOLD_AI_INVALID,
)
from app.sop.models import (
    AiJob,
    AiSuggestion,
    Bundle,
    Document,
    EmbeddingCache,
    Extraction,
    GuidelineVersion,
    TargetDoc,
    TargetSentence,
    Unit,
    UnitDecision,
    UnitPair,
)


@pytest.fixture
def engine(tmp_path: pathlib.Path) -> Iterator[Engine]:
    """마이그레이션된 임시 sqlite + 연결마다 FK를 켠 동기 엔진 — CASCADE·SET NULL을 운영 PG와 같게 본다."""
    db_path = tmp_path / "sop-ai.db"
    run_migrations(f"sqlite+aiosqlite:///{db_path}")
    sync_engine = create_engine(f"sqlite:///{db_path}")

    @event.listens_for(sync_engine, "connect")
    def _enable_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    yield sync_engine
    sync_engine.dispose()


def _add_version(session: Session, key: str, version: int, *, is_active: bool = False) -> None:
    session.add(GuidelineVersion(key=key, version=version, content="합성 지침", is_active=is_active, created_by="qa.lead"))


def _seed_ai_world(session: Session) -> dict[str, int]:
    """묶음 하나에 작업·제안과, 그 제안·원본 단위를 가리키는 판단·새 문장·짝을 한 행씩 넣는다."""
    bundle = Bundle(title="합성 묶음", is_synthetic=True, created_by="qa.member")
    session.add(bundle)
    session.flush()
    document = Document(
        bundle_id=bundle.id, side="old", file_name="synthetic.docx", file_format="docx", size_bytes=10,
        sha256="a" * 64, status="ready", uploaded_by="qa.member",
    )
    session.add(document)
    session.flush()
    extraction = Extraction(document_id=document.id, extractor_version="1", aux_status="ok")
    session.add(extraction)
    session.flush()
    unit = Unit(
        extraction_id=extraction.id, local_no=1, kind="sentence", spans=[], text="합성 문장", lang="ko",
        pos_seq=1, pos_start=0,
    )
    target_doc = TargetDoc(bundle_id=bundle.id, code="SOP-001", doc_type="sop", entrance="assign")
    job = AiJob(
        bundle_id=bundle.id, kind="classify", status="done", document_id=document.id, requested_by="qa.member"
    )
    session.add_all([unit, target_doc, job])
    session.flush()
    suggestion = AiSuggestion(
        job_id=job.id, bundle_id=bundle.id, kind="classify", document_id=document.id, content={}, result="applied"
    )
    session.add(suggestion)
    session.flush()
    decision = UnitDecision(unit_id=unit.id, bundle_id=bundle.id, suggestion_id=suggestion.id)
    sentence = TargetSentence(
        bundle_id=bundle.id, target_doc_id=target_doc.id, lang="en", kind="sentence", origin="translation",
        status="ai_suggested", suggestion_id=suggestion.id, translation_source_unit_id=unit.id,
    )
    pair = UnitPair(document_id=document.id, status="suggested", source="ai", suggestion_id=suggestion.id)
    session.add_all([decision, sentence, pair])
    session.flush()
    return {
        "bundle": bundle.id, "document": document.id, "unit": unit.id, "job": job.id,
        "suggestion": suggestion.id, "sentence": sentence.id, "pair": pair.id,
    }


def _count_rows(session: Session, model: type) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_only_one_active_version_per_key(engine: Engine) -> None:
    with Session(engine) as session:
        _add_version(session, "rules", 1, is_active=True)
        session.commit()

    # 버전 번호가 달라 UNIQUE(key, version)이 아니라 부분 유일 인덱스만 이 거절을 만들 수 있다
    with Session(engine) as session:
        _add_version(session, "rules", 2, is_active=True)
        with pytest.raises(IntegrityError, match="UNIQUE constraint failed"):
            session.commit()

    # 활성은 키마다 하나이고, 비활성 이력은 얼마든지 쌓인다
    with Session(engine) as session:
        _add_version(session, "prompt.classify", 1, is_active=True)
        _add_version(session, "rules", 2)
        _add_version(session, "rules", 3)
        session.commit()
        assert _count_rows(session, GuidelineVersion) == 4


def test_guideline_version_numbers_are_unique_per_key(engine: Engine) -> None:
    with Session(engine) as session:
        _add_version(session, "rules", 1)
        _add_version(session, "prompt.classify", 1)
        session.commit()

    with Session(engine) as session:
        _add_version(session, "rules", 1)
        with pytest.raises(IntegrityError, match="UNIQUE constraint failed"):
            session.commit()


def test_guideline_active_index_is_partial_on_both_dialects(engine: Engine) -> None:
    index = next(
        item for item in inspect(engine).get_indexes("guideline_versions") if item["name"] == "uq_guideline_active"
    )
    assert index["unique"]
    assert index["column_names"] == ["key"]
    assert str(index["dialect_options"]["sqlite_where"]) == "is_active"

    # 운영은 Postgres다 — 모델이 postgresql_where도 실어야 거기서도 활성 행만 유일하다
    index_model = next(item for item in GuidelineVersion.__table__.indexes if item.name == "uq_guideline_active")
    ddl = str(CreateIndex(index_model).compile(dialect=postgresql.dialect()))
    assert "UNIQUE INDEX uq_guideline_active" in ddl
    assert ddl.endswith("WHERE is_active")


def test_deleting_a_bundle_removes_jobs_and_suggestions(engine: Engine) -> None:
    with Session(engine) as session:
        world = _seed_ai_world(session)
        # 지침·임베딩 캐시는 묶음 밖 전역 표라 묶음 삭제와 무관하게 남는다
        _add_version(session, "rules", 1, is_active=True)
        session.add(EmbeddingCache(model="synthetic-embed", text_hash="c" * 64, dim=3, vector=b"\x00" * 12))
        session.commit()
    with Session(engine) as session:
        # 시드가 실제로 행을 넣었는지 먼저 확인한다(0 == 0 으로 공허하게 통과하지 않게)
        assert _count_rows(session, AiJob) == 1
        assert _count_rows(session, AiSuggestion) == 1

    with Session(engine) as session:
        session.execute(delete(Bundle).where(Bundle.id == world["bundle"]))
        session.commit()

    with Session(engine) as session:
        assert _count_rows(session, AiJob) == 0
        assert _count_rows(session, AiSuggestion) == 0
        assert _count_rows(session, GuidelineVersion) == 1
        assert _count_rows(session, EmbeddingCache) == 1


def test_deleting_a_suggestion_clears_every_reference_to_it(engine: Engine) -> None:
    with Session(engine) as session:
        world = _seed_ai_world(session)
        session.commit()

    with Session(engine) as session:
        session.execute(delete(AiSuggestion).where(AiSuggestion.id == world["suggestion"]))
        session.commit()

    with Session(engine) as session:
        # 판단·새 문장·짝은 남고 제안을 가리키던 칸만 비는다
        assert session.get(UnitDecision, world["unit"]).suggestion_id is None
        assert session.get(TargetSentence, world["sentence"]).suggestion_id is None
        assert session.get(UnitPair, world["pair"]).suggestion_id is None
        assert _count_rows(session, AiJob) == 1


def test_deleting_a_document_keeps_its_jobs_and_suggestions(engine: Engine) -> None:
    with Session(engine) as session:
        world = _seed_ai_world(session)
        session.commit()

    with Session(engine) as session:
        session.execute(delete(Document).where(Document.id == world["document"]))
        session.commit()

    with Session(engine) as session:
        assert session.get(AiJob, world["job"]).document_id is None
        assert session.get(AiSuggestion, world["suggestion"]).document_id is None


def test_deleting_the_source_unit_removes_its_translation_sentence(engine: Engine) -> None:
    with Session(engine) as session:
        world = _seed_ai_world(session)
        session.commit()

    with Session(engine) as session:
        session.execute(delete(Unit).where(Unit.id == world["unit"]))
        session.commit()

    with Session(engine) as session:
        assert session.get(TargetSentence, world["sentence"]) is None


def test_unknown_job_status_is_refused(engine: Engine) -> None:
    with Session(engine) as session:
        bundle = Bundle(title="합성 묶음", is_synthetic=True, created_by="qa.member")
        session.add(bundle)
        session.flush()
        session.add(AiJob(bundle_id=bundle.id, kind="classify", status="paused", requested_by="qa.member"))
        with pytest.raises(IntegrityError, match="CHECK constraint failed"):
            session.commit()


def test_other_unknown_ai_values_are_refused(engine: Engine) -> None:
    def build_bad_job_kind(session: Session, bundle: Bundle, job: AiJob) -> object:
        return AiJob(bundle_id=bundle.id, kind="summarize", status="queued", requested_by="qa.member")

    def build_bad_result(session: Session, bundle: Bundle, job: AiJob) -> object:
        return AiSuggestion(job_id=job.id, bundle_id=bundle.id, kind="classify", content={}, result="pending")

    def build_bad_adoption(session: Session, bundle: Bundle, job: AiJob) -> object:
        return AiSuggestion(
            job_id=job.id, bundle_id=bundle.id, kind="classify", content={}, result="applied", adoption="ignored"
        )

    builders: list[Callable[[Session, Bundle, AiJob], object]] = [
        build_bad_job_kind,
        build_bad_result,
        build_bad_adoption,
    ]
    for build in builders:
        with Session(engine) as session:
            bundle = Bundle(title="합성 묶음", is_synthetic=True, created_by="qa.member")
            session.add(bundle)
            session.flush()
            job = AiJob(bundle_id=bundle.id, kind="classify", status="queued", requested_by="qa.member")
            session.add(job)
            session.flush()
            session.add(build(session, bundle, job))
            with pytest.raises(IntegrityError, match="CHECK constraint failed"):
                session.commit()


def test_every_allowed_ai_value_is_accepted(engine: Engine) -> None:
    # CHECK가 코드 값 튜플에서 만들어지므로, 튜플의 모든 값이 실제로 저장되는지 한 번씩 본다
    with Session(engine) as session:
        bundle = Bundle(title="합성 묶음", is_synthetic=True, created_by="qa.member")
        session.add(bundle)
        session.flush()
        jobs = [
            AiJob(bundle_id=bundle.id, kind=kind, status=status, requested_by="qa.member")
            for kind in AI_JOB_KINDS
            for status in AI_JOB_STATUSES
        ]
        session.add_all(jobs)
        session.flush()
        for result in AI_SUGGESTION_RESULTS:
            session.add(AiSuggestion(job_id=jobs[0].id, bundle_id=bundle.id, kind="split", content={}, result=result))
        for adoption in AI_ADOPTIONS:
            session.add(AiSuggestion(
                job_id=jobs[0].id, bundle_id=bundle.id, kind="split", content={}, result="applied", adoption=adoption
            ))
        session.commit()
        assert _count_rows(session, AiJob) == len(AI_JOB_KINDS) * len(AI_JOB_STATUSES)
        assert _count_rows(session, AiSuggestion) == len(AI_SUGGESTION_RESULTS) + len(AI_ADOPTIONS)


def test_check_constraint_names_and_older_checks_survive(engine: Engine) -> None:
    expected = {
        "ai_jobs": {"ck_ai_jobs_kind", "ck_ai_jobs_status"},
        "ai_suggestions": {"ck_ai_suggestions_result", "ck_ai_suggestions_adoption"},
        # 0007이 sqlite 배치로 다시 만드는 표 — 기존 CHECK가 빠지지 않아야 한다
        "unit_decisions": {"ck_unit_decisions_status"},
        "target_sentences": {"ck_target_sentences_status", "ck_target_sentences_number_style"},
    }
    inspector = inspect(engine)
    for table, names in expected.items():
        assert {ck["name"] for ck in inspector.get_check_constraints(table)} == names, table


def test_ai_tables_are_indexed_for_their_lookups(engine: Engine) -> None:
    # 작업 큐는 (status, id)로 다음 작업을 고르고, CASCADE가 닿는 FK는 인덱스가 있어야 PG에서 순차 스캔하지 않는다
    expected = {
        "ai_jobs": {
            "ix_ai_jobs_bundle_id", "ix_ai_jobs_status_id", "ix_ai_jobs_document_id",
            # 최근 작업 목록: 요청별 집계와 묶음마다 하루 안에 끝난 작업 찾기
            "ix_ai_jobs_request_id", "ix_ai_jobs_bundle_id_finished_at",
        },
        "ai_suggestions": {"ix_ai_suggestions_job_id", "ix_ai_suggestions_bundle_id", "ix_ai_suggestions_document_id"},
        # 제안·문서가 지워질 때 SET NULL이 이 칸들을 찾는다 — 묶음 삭제가 제안 행마다 표 전체를 훑지 않게
        "unit_decisions": {"ix_unit_decisions_suggestion_id"},
        "unit_pairs": {"ix_unit_pairs_suggestion_id"},
        "target_sentences": {
            "ix_target_sentences_translation_source_unit_id",
            "ix_target_sentences_suggestion_id",
        },
    }
    inspector = inspect(engine)
    for table, names in expected.items():
        assert names <= {index["name"] for index in inspector.get_indexes(table)}, table
    status_index = next(i for i in inspector.get_indexes("ai_jobs") if i["name"] == "ix_ai_jobs_status_id")
    assert status_index["column_names"] == ["status", "id"]
    window_index = next(i for i in inspector.get_indexes("ai_jobs") if i["name"] == "ix_ai_jobs_bundle_id_finished_at")
    assert window_index["column_names"] == ["bundle_id", "finished_at"]


def test_embedding_cache_is_keyed_by_model_and_text_hash(engine: Engine) -> None:
    vector = bytes(range(12))
    with Session(engine) as session:
        session.add(EmbeddingCache(model="synthetic-embed-a", text_hash="d" * 64, dim=3, vector=vector))
        # 같은 글이라도 모델이 다르면 다른 벡터다
        session.add(EmbeddingCache(model="synthetic-embed-b", text_hash="d" * 64, dim=3, vector=vector))
        session.commit()
        assert session.get(EmbeddingCache, ("synthetic-embed-a", "d" * 64)).vector == vector

    with Session(engine) as session:
        session.add(EmbeddingCache(model="synthetic-embed-a", text_hash="d" * 64, dim=3, vector=vector))
        with pytest.raises(IntegrityError, match="UNIQUE constraint failed"):
            session.commit()


def test_code_values_fit_their_columns() -> None:
    # sqlite는 길이를 강제하지 않아 넘치는 코드 값이 운영 Postgres에서만 500이 된다 — 튜플과 컬럼 길이를 맞춰 둔다
    cases = {
        "ai_jobs.kind": (AI_JOB_KINDS, AiJob.kind),
        "ai_suggestions.kind": (AI_JOB_KINDS, AiSuggestion.kind),
        "ai_jobs.status": (AI_JOB_STATUSES, AiJob.status),
        "ai_suggestions.result": (AI_SUGGESTION_RESULTS, AiSuggestion.result),
        "ai_suggestions.adoption": (AI_ADOPTIONS, AiSuggestion.adoption),
        "guideline_versions.key": (GUIDELINE_KEYS, GuidelineVersion.key),
    }
    for name, (values, column) in cases.items():
        assert max(len(value) for value in values) <= column.type.length, name
    assert SYSTEM_HOLD_AI_INVALID.startswith("system:")  # 시스템 보류 사유 접두 — 사람이 쓴 사유와 구분된다
