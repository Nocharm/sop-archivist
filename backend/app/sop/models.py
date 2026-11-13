"""SOP 재구성 ORM 모델 — 묶음·문서·추출·단위·판단·새 문서 문장, AI 작업·제안·지침·임베딩 (모델을 바꾸면 Alembic 리비전이 필요하다)."""

from collections.abc import Sequence
from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base, _now
from app.sop.bundle_code import format_bundle_code
from app.sop.constants import (
    AI_ADOPTIONS,
    AI_JOB_KINDS,
    AI_JOB_STATUSES,
    AI_SUGGESTION_RESULTS,
    BUNDLE_STATUSES,
    MEMBER_ROLES,
    NUMBER_STYLES,
    NUMBERED,
    STATUSES,
)


def _build_in_check(column: str, values: Sequence[str]) -> str:
    """`column IN ('a', 'b')` 조건식 — 코드 값 튜플이 CHECK 제약의 단일 소스가 되게 한다."""
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


# --- 묶음 ---


class Bundle(Base):
    """묶음 — 옛 SOP들과 새 문서들을 함께 다루는 작업 단위. 멤버만 열 수 있다."""

    __tablename__ = "bundles"
    __table_args__ = (CheckConstraint(_build_in_check("status", BUNDLE_STATUSES), name="status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="in_progress")
    # 합성 데이터 묶음 표시 — 실제 SOP와 섞이지 않게 한다
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    # 의미 검토 확인 상태({SEMANTIC_CHECK_KEYS 키: 확인 정보})
    semantic_checks: Mapped[dict] = mapped_column(JSON, default=dict)
    # 낙관적 동시성 — 올리는 변경의 범위는 설계 §6.13
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    @property
    def code(self) -> str:
        """화면·API가 쓰는 순차 코드(BND-0013) — id에서 만든다."""
        return format_bundle_code(self.id)


class BundleMember(Base):
    """묶음 멤버 — (묶음, loginId)가 키, 역할은 author|reviewer."""

    __tablename__ = "bundle_members"
    __table_args__ = (CheckConstraint(_build_in_check("role", MEMBER_ROLES), name="role"),)

    bundle_id: Mapped[int] = mapped_column(ForeignKey("bundles.id", ondelete="CASCADE"), primary_key=True)
    # "내 묶음" 조회는 (bundle_id, login_id) PK를 못 타서 login_id 단독 인덱스가 필요하다
    login_id: Mapped[str] = mapped_column(String(100), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(10))
    added_by: Mapped[str] = mapped_column(String(100))
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class BundleEvent(Base):
    """묶음 변경 기록 — 멤버·상태·삭제 판단 같은 사람이 남긴 결정의 이력(원문 글자는 담지 않는다)."""

    __tablename__ = "bundle_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bundle_id: Mapped[int] = mapped_column(ForeignKey("bundles.id", ondelete="CASCADE"), index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    actor: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(40))
    target_type: Mapped[str] = mapped_column(String(30), default="")
    target_ids: Mapped[list] = mapped_column(JSON, default=list)
    reason: Mapped[str] = mapped_column(Text, default="")
    # 바뀐 값의 전/후(이름·설명·시험용 표시, 멤버) — SOP 원문 글자는 담지 않는다. 지난 사건은 빈 객체
    detail: Mapped[dict] = mapped_column(JSON, default=dict)


class BundleDeletionRecord(Base):
    """묶음 삭제 기록 — 묶음이 지워져도 남아야 하므로 bundle_id는 FK가 아니다."""

    __tablename__ = "bundle_deletion_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bundle_id: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    actor: Mapped[str] = mapped_column(String(100))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# --- 새 문서(To-Be) 목록 ---


class TargetDoc(Base):
    """새 문서 — 묶음 안의 SOP 또는 WI. WI는 부모 SOP를 가리킬 수 있다."""

    __tablename__ = "target_docs"
    __table_args__ = (UniqueConstraint("bundle_id", "code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bundle_id: Mapped[int] = mapped_column(ForeignKey("bundles.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(100))
    title: Mapped[str] = mapped_column(String(500), default="")
    doc_type: Mapped[str] = mapped_column(String(3))
    # ondelete 미지정(NO ACTION) — RESTRICT는 즉시 검사라 묶음 CASCADE가 부모 SOP를 WI보다 먼저 지우면 실패한다
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("target_docs.id"), default=None)
    entrance: Mapped[str] = mapped_column(String(6))
    is_equipment_sop: Mapped[bool] = mapped_column(Boolean, default=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    # 사람이 순서를 직접 바꿨으면 자동 정렬이 덮어쓰지 않는다
    manual_order: Mapped[bool] = mapped_column(Boolean, default=False)


class TargetDocNaSlot(Base):
    """SOP 일곱 칸 중 사람이 "해당 없음"으로 표시한 칸 — 사유와 표시한 사람을 남긴다."""

    __tablename__ = "target_doc_na_slots"

    target_doc_id: Mapped[int] = mapped_column(ForeignKey("target_docs.id", ondelete="CASCADE"), primary_key=True)
    slot_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    reason: Mapped[str] = mapped_column(Text)
    set_by: Mapped[str] = mapped_column(String(100))
    set_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class WiStep(Base):
    """WI 단계(번호별 제목) — 단계 안의 문장은 target_sentences.wi_step이 가리킨다."""

    __tablename__ = "wi_steps"

    target_doc_id: Mapped[int] = mapped_column(ForeignKey("target_docs.id", ondelete="CASCADE"), primary_key=True)
    step_no: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(500), default="")


# --- 문서·추출 ---


class Document(Base):
    """업로드한 문서 한 건. side=old(옛 SOP)|new(이미 있는 새 문서). 같은 묶음에 같은 파일 내용은 한 번만."""

    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("bundle_id", "sha256"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bundle_id: Mapped[int] = mapped_column(ForeignKey("bundles.id", ondelete="CASCADE"), index=True)
    side: Mapped[str] = mapped_column(String(3))
    file_name: Mapped[str] = mapped_column(String(255))
    file_format: Mapped[str] = mapped_column(String(4))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    doc_code: Mapped[str] = mapped_column(String(100), default="")
    doc_version: Mapped[str] = mapped_column(String(50), default="")
    title: Mapped[str] = mapped_column(String(500), default="")
    language_layout: Mapped[str] = mapped_column(String(20), default="ko_en_interleaved")
    status: Mapped[str] = mapped_column(String(10))
    status_reason: Mapped[str] = mapped_column(String(40), default="")
    # 새 문서(side=new)가 가리키는 새 문서 목록 항목 — 목록 항목이 먼저 지워져도 문서는 남는다
    target_doc_id: Mapped[int | None] = mapped_column(
        ForeignKey("target_docs.id", ondelete="SET NULL"), unique=True, default=None
    )
    revision: Mapped[int] = mapped_column(Integer, default=1)
    uploaded_by: Mapped[str] = mapped_column(String(100))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DocumentFile(Base):
    """원본 파일 바이트 — 만든 뒤 바꾸지 않는다. 목록 조회가 바이트를 끌고 오지 않게 documents와 분리했다."""

    __tablename__ = "document_files"

    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True)
    content: Mapped[bytes] = mapped_column(LargeBinary)


class Extraction(Base):
    """추출 한 회차 — 문서를 블록·표로 풀어낸 결과의 묶음. 추출기 버전을 남겨 재추출을 구분한다."""

    __tablename__ = "extractions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    extractor_version: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # 머리글·바닥글·각주 같은 보조 영역 추출 결과 상태
    aux_status: Mapped[str] = mapped_column(String(10))
    aux_detail: Mapped[str] = mapped_column(String(100), default="")


class SourceTable(Base):
    """원문 표 — 중첩 표는 parent_table_id로 이어진다. is_layout은 레이아웃용 표(표마다 전환)."""

    __tablename__ = "source_tables"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    extraction_id: Mapped[int] = mapped_column(ForeignKey("extractions.id", ondelete="CASCADE"), index=True)
    table_index: Mapped[int] = mapped_column(Integer)
    parent_table_id: Mapped[int | None] = mapped_column(
        ForeignKey("source_tables.id", ondelete="CASCADE"), default=None
    )
    part: Mapped[str] = mapped_column(String(10))
    xml_path: Mapped[str] = mapped_column(String(500))
    n_rows: Mapped[int] = mapped_column(Integer)
    n_cols: Mapped[int] = mapped_column(Integer)
    is_layout: Mapped[bool] = mapped_column(Boolean, default=False)


class SourceBlock(Base):
    """원문 블록 — 문단·표 칸·그림 하나. text는 만든 뒤 바꾸지 않는다(원문 불변)."""

    __tablename__ = "source_blocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    extraction_id: Mapped[int] = mapped_column(ForeignKey("extractions.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    part: Mapped[str] = mapped_column(String(10))
    kind: Mapped[str] = mapped_column(String(12))
    text: Mapped[str] = mapped_column(Text)
    xml_path: Mapped[str] = mapped_column(String(500))
    page: Mapped[int | None] = mapped_column(Integer, default=None)
    # 쪽 번호를 어떻게 알았는지(문서가 적은 값인지 추정인지) — 화면이 신뢰도를 다르게 보인다
    page_basis: Mapped[str] = mapped_column(String(10))
    section_label: Mapped[str] = mapped_column(String(200), default="")
    heading_level: Mapped[int | None] = mapped_column(Integer, default=None)
    table_id: Mapped[int | None] = mapped_column(
        ForeignKey("source_tables.id", ondelete="CASCADE"), index=True, default=None
    )
    row_index: Mapped[int | None] = mapped_column(Integer, default=None)
    col_index: Mapped[int | None] = mapped_column(Integer, default=None)
    grid_span: Mapped[int] = mapped_column(Integer, default=1)
    row_span: Mapped[int] = mapped_column(Integer, default=1)
    image_part: Mapped[str | None] = mapped_column(String(200), default=None)
    flags: Mapped[list] = mapped_column(JSON, default=list)


class ExtractionWarning(Base):
    """추출 경고 — needs_ack인 경고는 사람이 확인해야 다음 단계로 넘어간다."""

    __tablename__ = "extraction_warnings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    extraction_id: Mapped[int] = mapped_column(ForeignKey("extractions.id", ondelete="CASCADE"), index=True)
    # 0006에서 20 → 40 — 누락 의심이 잘렸다는 경고 "missing_text_truncated"(22자)가 들어가게
    kind: Mapped[str] = mapped_column(String(40))
    block_id: Mapped[int | None] = mapped_column(
        ForeignKey("source_blocks.id", ondelete="CASCADE"), index=True, default=None
    )
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    needs_ack: Mapped[bool] = mapped_column(Boolean)
    acked_by: Mapped[str | None] = mapped_column(String(100), default=None)
    acked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    ack_note: Mapped[str] = mapped_column(Text, default="")


# --- 단위·판단 ---


class Unit(Base):
    """원문 블록 위의 범위 단위 — 문장·제목·그림·표·표 행·칸 문장. local_no는 추출 안에서 다시 쓰지 않는다."""

    __tablename__ = "units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    extraction_id: Mapped[int] = mapped_column(ForeignKey("extractions.id", ondelete="CASCADE"), index=True)
    local_no: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(14))
    spans: Mapped[list] = mapped_column(JSON)
    text: Mapped[str] = mapped_column(Text)
    lang: Mapped[str] = mapped_column(String(7))
    table_id: Mapped[int | None] = mapped_column(
        ForeignKey("source_tables.id", ondelete="CASCADE"), index=True, default=None
    )
    row_index: Mapped[int | None] = mapped_column(Integer, default=None)
    # 칸 문장이 따르는 표·행 단위 — 그 단위가 지워지면 그룹만 풀린다
    group_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("units.id", ondelete="SET NULL"), index=True, default=None
    )
    status: Mapped[str] = mapped_column(String(8), default="active")
    boundary_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    # 정렬 키 — 첫 범위의 블록 seq와 블록 안 시작 위치(표 단위는 pos_start=-1)
    pos_seq: Mapped[int] = mapped_column(Integer)
    pos_start: Mapped[int] = mapped_column(Integer)


class UnitEdit(Base):
    """쪼개기 편집 이력 — 되돌리기·다시 하기가 이 기록을 거꾸로/앞으로 적용한다."""

    __tablename__ = "unit_edits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    op: Mapped[str] = mapped_column(String(24))
    payload: Mapped[dict] = mapped_column(JSON)
    created_unit_ids: Mapped[list] = mapped_column(JSON, default=list)
    retired_unit_ids: Mapped[list] = mapped_column(JSON, default=list)
    regrouped: Mapped[dict] = mapped_column(JSON, default=dict)
    lang_changes: Mapped[dict] = mapped_column(JSON, default=dict)
    layout_changes: Mapped[dict] = mapped_column(JSON, default=dict)
    state: Mapped[str] = mapped_column(String(8), default="applied")
    actor: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DecisionStep(Base):
    """Assign 되돌리기 한 단계 — 판단 저장 전후의 바뀐 행 스냅숏(snapshot) 또는 Split 편집 기록 가리키기(unit_edit)."""

    __tablename__ = "decision_steps"
    __table_args__ = (Index("ix_decision_steps_session", "bundle_id", "actor", "session_key", "seq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bundle_id: Mapped[int] = mapped_column(ForeignKey("bundles.id", ondelete="CASCADE"))
    actor: Mapped[str] = mapped_column(String(100))
    # 화면 세션(탭)마다 기록이 따로다
    session_key: Mapped[str] = mapped_column(String(64))
    seq: Mapped[int] = mapped_column(Integer)
    op: Mapped[str] = mapped_column(String(24))
    kind: Mapped[str] = mapped_column(String(10))
    state: Mapped[str] = mapped_column(String(8), default="applied")
    # 여러 요청으로 나뉜 한 동작(같은 글자 일괄 확정)을 한 단계로 합치는 키
    step_key: Mapped[str | None] = mapped_column(String(64), default=None)
    focus: Mapped[dict] = mapped_column(JSON, default=dict)
    unit_ids: Mapped[list] = mapped_column(JSON, default=list)
    scope_label: Mapped[str | None] = mapped_column(String(200), default=None)
    before: Mapped[dict] = mapped_column(JSON, default=dict)
    after: Mapped[dict] = mapped_column(JSON, default=dict)
    document_id: Mapped[int | None] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, default=None
    )
    unit_edit_id: Mapped[int | None] = mapped_column(
        ForeignKey("unit_edits.id", ondelete="SET NULL"), index=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class UnitPair(Base):
    """한/영 짝 — 같은 뜻의 두 언어 단위 묶음. 한쪽 최대 단위 수는 MAX_PAIR_SIDE."""

    __tablename__ = "unit_pairs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(10))
    source: Mapped[str] = mapped_column(String(5))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # 이 짝을 만든 AI 제안 — 제안이 지워져도 짝은 남는다(SET NULL이 이 칸을 찾으므로 인덱스)
    suggestion_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_suggestions.id", ondelete="SET NULL"), index=True, default=None
    )


class UnitPairMember(Base):
    """짝에 든 단위 — 한 단위는 하나의 짝에만 들어간다(unit_id 유일)."""

    __tablename__ = "unit_pair_members"

    pair_id: Mapped[int] = mapped_column(ForeignKey("unit_pairs.id", ondelete="CASCADE"), primary_key=True)
    unit_id: Mapped[int] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"), primary_key=True, unique=True)


class UnitDecision(Base):
    """옛 문서 단위의 처분과 상태 — 단위마다 정확히 한 행. disposition은 무엇을 하는지, status는 사람이 정했는지."""

    __tablename__ = "unit_decisions"
    __table_args__ = (CheckConstraint(_build_in_check("status", STATUSES), name="status"),)

    unit_id: Mapped[int] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"), primary_key=True)
    bundle_id: Mapped[int] = mapped_column(ForeignKey("bundles.id", ondelete="CASCADE"), index=True)
    disposition: Mapped[str] = mapped_column(String(14), default="unassigned")
    move_target_code: Mapped[str] = mapped_column(String(100), default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(12), default="unassigned")
    hold_reason: Mapped[str] = mapped_column(Text, default="")
    confirmed_by: Mapped[str | None] = mapped_column(String(100), default=None)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    # 이 처분을 채운 AI 제안 — 채택 여부를 사람이 저장할 때 이 제안에 기록한다(SET NULL이 이 칸을 찾으므로 인덱스)
    suggestion_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_suggestions.id", ondelete="SET NULL"), index=True, default=None
    )
    revision: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class UnitDecisionHistory(Base):
    """판단이 바뀌기 직전 모습의 스냅숏 — 되돌아보기용."""

    __tablename__ = "unit_decision_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    unit_id: Mapped[int] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"), index=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    cause: Mapped[str] = mapped_column(String(10))
    actor: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# --- 새 문서 문장 ---


class TargetSentence(Base):
    """새 문서 안의 문장·표·그림 한 건. confirmed_text는 사람이 확정한 글, ai_text는 AI 제안(확정과 분리)."""

    __tablename__ = "target_sentences"
    __table_args__ = (
        CheckConstraint(_build_in_check("status", STATUSES), name="status"),
        CheckConstraint(_build_in_check("number_style", NUMBER_STYLES), name="number_style"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bundle_id: Mapped[int] = mapped_column(ForeignKey("bundles.id", ondelete="CASCADE"), index=True)
    # ondelete 미지정(NO ACTION) — RESTRICT는 즉시 검사라 묶음 CASCADE가 새 문서를 문장보다 먼저 지우면 실패한다
    target_doc_id: Mapped[int] = mapped_column(ForeignKey("target_docs.id"), index=True)
    slot_key: Mapped[str | None] = mapped_column(String(100), default=None)
    wi_step: Mapped[int | None] = mapped_column(Integer, default=None)
    wi_part: Mapped[str | None] = mapped_column(String(11), default=None)
    section_path: Mapped[str] = mapped_column(Text, default="")
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    # 칸 안 들여쓰기 깊이(0 = 맨 바깥) — 사람이 정한 값 그대로 두고, 결과물 번호를 셀 때 앞줄 깊이 + 1로 눌러 읽는다
    indent_level: Mapped[int] = mapped_column(Integer, default=0)
    # 번호 표시(NUMBER_STYLES) — 생략·주석 줄은 번호를 받지 않는다. 표 칸 새 문장은 이 값 대신 표의 값을 따른다
    number_style: Mapped[str] = mapped_column(String(8), default=NUMBERED)
    lang: Mapped[str] = mapped_column(String(7))
    kind: Mapped[str] = mapped_column(String(8))
    confirmed_text: Mapped[str] = mapped_column(Text, default="")
    ai_text: Mapped[str] = mapped_column(Text, default="")
    change_type: Mapped[str | None] = mapped_column(String(20), default=None)
    origin: Mapped[str] = mapped_column(String(11))
    # 이미 있는 새 문서(side=new)에서 가져온 단위
    new_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("units.id", ondelete="CASCADE"), index=True, default=None
    )
    # 번역 새 문장이 번역한 옛 단위 — TargetSource(관계 묶음의 근거)와 따로 둬서 번역이 묶음·닫힘 검사를 흔들지 않는다
    translation_source_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("units.id", ondelete="CASCADE"), index=True, default=None
    )
    parent_target_id: Mapped[int | None] = mapped_column(
        ForeignKey("target_sentences.id", ondelete="CASCADE"), index=True, default=None
    )
    cell_row: Mapped[int | None] = mapped_column(Integer, default=None)
    cell_col: Mapped[int | None] = mapped_column(Integer, default=None)
    # 표 문장의 칸 격자 — none_as_null로 비어 있으면 JSON null이 아니라 SQL NULL로 저장한다
    grid: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), default=None)
    status: Mapped[str] = mapped_column(String(12))
    hold_reason: Mapped[str] = mapped_column(Text, default="")
    # 사람이 적는 메모(Remark) — 출처가 없는 새 문장(입구 2 신규)은 단위 판단이 없어 메모를 여기 담는다
    remark: Mapped[str] = mapped_column(Text, default="")
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    confirmed_by: Mapped[str | None] = mapped_column(String(100), default=None)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    # 이 문장을 채운 AI 제안 — 제안이 지워져도 문장은 남는다(SET NULL이 이 칸을 찾으므로 인덱스)
    suggestion_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_suggestions.id", ondelete="SET NULL"), index=True, default=None
    )
    revision: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class TargetSource(Base):
    """새 문장이 근거로 삼은 옛 단위 — seq는 문장 안의 출처 순서."""

    __tablename__ = "target_sources"

    target_id: Mapped[int] = mapped_column(ForeignKey("target_sentences.id", ondelete="CASCADE"), primary_key=True)
    # 복합 PK의 둘째 열이라 단위 쪽 삭제 캐스케이드·역조회가 PK를 못 탄다
    unit_id: Mapped[int] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"), primary_key=True, index=True)
    seq: Mapped[int] = mapped_column(Integer)


class TargetTextHistory(Base):
    """확정 글이 바뀌기 직전 글 — 누가 언제 바꿨는지와 함께 남긴다."""

    __tablename__ = "target_text_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    target_id: Mapped[int] = mapped_column(ForeignKey("target_sentences.id", ondelete="CASCADE"), index=True)
    previous_text: Mapped[str] = mapped_column(Text)
    changed_by: Mapped[str] = mapped_column(String(100))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# --- AI 층 ---


class GuidelineVersion(Base):
    """AI 지침 한 버전 — 키마다 활성은 하나(부분 유일 인덱스), 지난 버전은 이력으로 남는다. 묶음과 무관한 전역 표."""

    __tablename__ = "guideline_versions"
    __table_args__ = (
        UniqueConstraint("key", "version"),
        # 활성 행만 키당 하나 — 비활성 이력은 제한이 없다. sqlite·Postgres 둘 다 부분 인덱스를 받는다
        Index(
            "uq_guideline_active",
            "key",
            unique=True,
            sqlite_where=text("is_active"),
            postgresql_where=text("is_active"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(40))
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    note: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    activated_by: Mapped[str | None] = mapped_column(String(100), default=None)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


def generate_request_id() -> str:
    """요청 한 번을 가리키는 값 — 작업 id는 flush 뒤에야 생겨 요청 쪽에서 미리 만든다."""
    return uuid4().hex


class AiJob(Base):
    """AI 작업 — 요청이 쌓는 큐 한 줄. 실행기가 (status, id) 순으로 다음 작업을 꺼낸다."""

    __tablename__ = "ai_jobs"
    __table_args__ = (
        CheckConstraint(_build_in_check("kind", AI_JOB_KINDS), name="kind"),
        CheckConstraint(_build_in_check("status", AI_JOB_STATUSES), name="status"),
        Index("ix_ai_jobs_status_id", "status", "id"),
        # 최근 작업 목록이 묶음마다 하루 안에 끝난 작업을 찾는다(대기·실행 중은 위 (status, id)가 찾는다)
        Index("ix_ai_jobs_bundle_id_finished_at", "bundle_id", "finished_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bundle_id: Mapped[int] = mapped_column(ForeignKey("bundles.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(12))
    status: Mapped[str] = mapped_column(String(10))
    # 문서가 지워져도 작업 기록은 남는다
    document_id: Mapped[int | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), index=True, default=None
    )
    unit_ids: Mapped[list] = mapped_column(JSON, default=list)
    target_ids: Mapped[list] = mapped_column(JSON, default=list)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    # 작업이 읽은 입력의 상태(revision·글자 해시 등) — 적용 때 낡았는지 다시 확인하는 기준
    input_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    # 실패 코드(원문·서버 메시지 없이 정해진 짧은 코드만)
    error: Mapped[str] = mapped_column(String(40), default="")
    requested_by: Mapped[str] = mapped_column(String(100))
    # 요청 한 번이 쌓은 작업들의 묶음 값 — 화면이 "n / N"으로 묶어 보인다. 입구 2 계획 작업이 쌓는 변경 종류 작업은
    # 계획 작업의 값을 잇는다. 0012 이전 행은 'job-<id>'로 채워 저마다 한 요청이다
    request_id: Mapped[str] = mapped_column(String(32), index=True, default=generate_request_id)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class AiSuggestion(Base):
    """AI 제안 — 작업 한 건이 낸 결과 한 덩어리. 적용 여부(result)와 사람의 채택 결과(adoption)를 따로 남긴다."""

    __tablename__ = "ai_suggestions"
    __table_args__ = (
        CheckConstraint(_build_in_check("result", AI_SUGGESTION_RESULTS), name="result"),
        # adoption이 NULL(아직 사람이 안 정함)이면 CHECK는 통과한다
        CheckConstraint(_build_in_check("adoption", AI_ADOPTIONS), name="adoption"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("ai_jobs.id", ondelete="CASCADE"), index=True)
    bundle_id: Mapped[int] = mapped_column(ForeignKey("bundles.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(12))
    document_id: Mapped[int | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), index=True, default=None
    )
    content: Mapped[dict] = mapped_column(JSON)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    result: Mapped[str] = mapped_column(String(8))
    input_refs: Mapped[dict] = mapped_column(JSON, default=dict)
    # 제안을 만들 때 쓴 지침 버전({키: 버전}) — 어느 지침이 어떤 결과를 냈는지 되짚는다
    guideline_versions: Mapped[dict] = mapped_column(JSON, default=dict)
    model: Mapped[str] = mapped_column(String(200), default="")
    adoption: Mapped[str | None] = mapped_column(String(8), default=None)
    adopted_by: Mapped[str | None] = mapped_column(String(100), default=None)
    adopted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class EmbeddingCache(Base):
    """임베딩 캐시 — (모델, 글 해시)가 키. 같은 글을 같은 모델로 다시 보내지 않는다(글 자체는 담지 않는다)."""

    __tablename__ = "embedding_cache"

    model: Mapped[str] = mapped_column(String(200), primary_key=True)
    text_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    dim: Mapped[int] = mapped_column(Integer)
    vector: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
