"""문서 API — 업로드(옛/새)·목록·정보 고치기·삭제·원문 대조 데이터(view)·원본과 그림 내려받기·추출 경고 확인·쪼개기 편집과
되돌리기·경계 확인·한/영 짝. 쓰기는 작성자가 작업 중일 때만 한다(편집 규칙은 app/sop/editing.py, 짝 규칙은 app/sop/pairs.py)."""

import asyncio
import zipfile
from collections.abc import Sequence
from io import BytesIO
from typing import Annotated, Literal, Self
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Path, Query, Response, UploadFile
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.db import get_session
from app.equis import service as equis_service
from app.equis.rules import normalize_number
from app.equis.view import EquisOut, build_equis_out
from app.routers.admin import KstDatetime
from app.routers.sop_equis import start_lookups
from app.sop.caption_refs import (
    CaptionRefIn,
    CaptionRefOut,
    CaptionRefResult,
    build_caption_ref_outs,
    find_covering_unit_ids,
    update_caption_ref,
)
from app.sop.constants import LANGUAGE_LAYOUTS, MEMBER_ROLES
from app.sop.counterparts import build_table_facts, count_table_langs
from app.sop.decision_steps import record_unit_edit_step
from app.sop.detach import detach_units, find_units_needing_confirm
from app.sop.editing import (
    EditIn,
    EditResult,
    EditStepResult,
    EditStepIn,
    apply_edit,
    load_active_units,
    redo_edit,
    undo_edit,
)
from app.sop.ai.adoption import record_doc_meta_adoption
from app.sop.ai.doc_meta_job import build_ai_meta, enqueue_doc_meta, load_open_doc_meta
from app.sop.ai.match_jobs import PLAN_ORIGIN_UPLOAD, enqueue_auto_plan
from app.sop.ai.split import load_open_split_suggestion_ids
from app.sop.filename import parse_file_name
from app.sop.errors import check_revision, raise_rule
from app.sop.excel_export import build_export_file_name
from app.sop.events import record_event
from app.sop.ingest import get_max_file_bytes, ingest_upload
from app.sop.numbering import (
    NUMBER_TYPED,
    NUMBERED_KINDS,
    get_content_start,
    get_hidden_len,
    get_number,
    has_number_ranges,
)
from app.sop.membership import BundleContext, ensure_editable, lock_bundle, require_bundle_role
from app.sop.models import (
    CaptionRef,
    Document,
    DocumentFile,
    Extraction,
    ExtractionWarning,
    SourceBlock,
    SourceTable,
    Unit,
    UnitDecision,
    UnitEdit,
    UnitPair,
    UnitPairMember,
    UnitRef,
)
from app.sop.paragraph_excel import build_paragraph_rows, build_paragraph_workbook, load_unit_lines, make_sheet_name
from app.sop.part_groups import build_part_groups, get_part_group_key
from app.sop.pairs import (
    PairIn,
    PairResult,
    PairRevisionIn,
    build_pair_out,
    confirm_pair,
    create_pair,
    delete_pair,
)
from app.sop.refs import RefState, build_ref_text, is_proposing_version, load_proposing_extractions, read_ref_state
from app.sop.schemas import NO_NUL, NoNulStr
from app.sop.segment import find_anchor_offset, is_band_table, read_table_place
from app.sop.status import get_cover_status
from app.sop.tobe import MAX_DB_INT, release_match_doc, rename_match_doc, temp_match_code
from app.sop.units import (
    UNIT_ACTIVE,
    compute_display_id,
    get_latest_extraction_id,
    refresh_code_pairs,
)

router = APIRouter(prefix="/api/bundles", tags=["sop-documents"])

_require_author = require_bundle_role("author")
_require_member = require_bundle_role(*MEMBER_ROLES)

# 경로의 문서·블록·경고 ID 범위 — 정수 범위를 넘는 값이 DB까지 가서 500이 되지 않게
IdPath = Annotated[int, Path(ge=1, le=MAX_DB_INT)]
MAX_ACK_NOTE_CHARS = 2000
_FILE_MEDIA_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}
_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
# 브라우저가 그대로 그리는 래스터 그림만 그 형식으로 낸다 — SVG 등은 스크립트를 담을 수 있어 내려받기 형식으로 낸다
_IMAGE_MEDIA_TYPES = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
    "bmp": "image/bmp", "tif": "image/tiff", "tiff": "image/tiff", "webp": "image/webp",
}


def _check_language_layout(value: str) -> str:
    if value not in LANGUAGE_LAYOUTS:
        raise ValueError(f"language_layout must be one of {LANGUAGE_LAYOUTS}")
    return value


class WarningOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    block_id: int | None
    detail: dict[str, object]
    needs_ack: bool
    acked_by: str | None
    acked_at: KstDatetime | None
    ack_note: str


class ExtractionOut(BaseModel):
    id: int
    aux_status: str
    warnings: list[WarningOut]


class DocumentBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    side: str
    file_name: str
    file_format: str
    size_bytes: int
    doc_code: str
    doc_version: str
    title: str
    language_layout: str
    status: str
    status_reason: str
    revision: int
    target_doc_id: int | None
    uploaded_by: str
    uploaded_at: KstDatetime


class AiMetaOut(BaseModel):
    doc_code: str | None
    doc_version: str | None
    suggestion_id: int


PrefillField = Literal["doc_code", "doc_version", "language_layout"]
PrefillSource = Literal["file_name", "content"]


class DocumentOut(DocumentBase):
    # 받지 않았거나(rejected) 추출에 실패한(failed) 문서는 추출이 없다
    extraction: ExtractionOut | None
    # 업로드 응답에서만 — 서버가 미리 채운 칸이 어디서 왔는지(화면의 출처 표). 목록 조회에서는 빈 객체
    prefill_sources: dict[PrefillField, PrefillSource] = {}
    # 비어 있는 번호·버전에 대한 AI 제안(문서에 쓰지 않은 값) — 사람이 눌러 저장한다
    ai_meta: AiMetaOut | None = None
    # 문서 번호의 EQUIS 표시 — 기능이 꺼졌거나 묻지 않는 번호(빈 칸·임시 번호)면 None
    equis: EquisOut | None = None


class DocumentUpdateIn(BaseModel):
    revision: int = Field(ge=1)
    doc_code: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100), NO_NUL] | None = None
    doc_version: Annotated[str, StringConstraints(strip_whitespace=True, max_length=50), NO_NUL] | None = None
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500), NO_NUL] | None = None
    language_layout: Annotated[str, AfterValidator(_check_language_layout)] | None = None

    @model_validator(mode="after")
    def check_something_to_change(self) -> Self:
        if self.doc_code is None and self.doc_version is None and self.title is None and self.language_layout is None:
            raise ValueError("doc_code, doc_version, title or language_layout is required")
        return self


class WarningAckIn(BaseModel):
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_ACK_NOTE_CHARS), NO_NUL] = ""


class ViewTableAnchorOut(BaseModel):
    """안쪽 표가 바깥 칸에서 놓인 자리 — 바깥 칸 블록과 그 글에서 표 앞 글자 수(F2, 신호 place). 벗긴 바깥 표의 칸 줄 사이에 그린다."""

    block_id: int
    at: int


class ViewTableOut(BaseModel):
    id: int
    table_index: int
    parent_table_id: int | None
    part: str
    n_rows: int
    n_cols: int
    is_layout: bool
    # 띠 표 신호가 있다 — 바깥 표를 벗기거나 다시 묶을 때 함께 제목 줄 ↔ 표로 바뀐다(F2 · F4)
    is_band: bool
    # 안쪽 표만, 추출기 5 전의 추출은 None
    anchor: ViewTableAnchorOut | None
    # 칸 줄 언어가 많은 쪽 — "ko" | "en" | None(두 언어 표 · 빈 표). 한/영 따로 문서의 대응 표 판정에 쓴다(F8a)
    lang: str | None = None


class ViewBlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    seq: int
    part: str
    kind: str
    text: str
    xml_path: str
    page: int | None
    page_basis: str
    section_label: str
    heading_level: int | None
    table_id: int | None
    row_index: int | None
    col_index: int | None
    grid_span: int
    row_span: int
    flags: list[str]
    # 그림 이미지(figures/{block_id})를 받을 수 있는지 — 미디어 경로 자체는 내보내지 않는다
    has_image: bool
    # 이 블록이 속한 부분 묶음(DocumentViewOut.part_groups의 key) — 머리말·꼬리말은 부분 파일마다("header2"), 나머지는 part와 같다
    part_group: str


class ViewUnitRefOut(BaseModel):
    """참조 줄 상태 — proposed는 앱의 제안(사람이 번호 영역을 확인하기 전), confirmed는 REF로 확정된 것."""

    state: Literal["proposed", "confirmed"]
    number: str


class UnitRefDetailOut(BaseModel):
    """고른 단위의 참조 상태와 그 번호의 EQUIS 표시 — 참조가 아니면 state가 null이다."""

    state: Literal["proposed", "confirmed"] | None
    number: str = ""
    equis: EquisOut | None = None
    # 그 줄의 글을 EQUIS의 지금 번호·정식 이름으로 맞춘 글 — 새 문장에 쓸 제안. EQUIS가 모르는 번호거나 이미 같으면 null
    suggested_text: str | None = None


class ViewNumberOut(BaseModel):
    """문단 번호 칸(numbering.py) — 값·내용 경계는 서버가 정하고 화면은 읽기만 한다."""

    value: str | None  # 번호 칸에 보일 값 — 사람이 고친 값, 없으면 읽은 값(자동 번호·번호 칸). 없으면 null
    read: str | None  # 추출기가 읽은 값 — 타자로 친 번호는 번호로 삼기 전에도 여기 있다
    source: str | None  # auto | typed | cell
    is_set: bool  # 사람이 고쳤다(번호 없음 포함)
    content_start: int  # text에서 내용이 시작하는 자리 — 번호가 번호 칸으로 갔으면 그 뒤, 아니면 0
    typed_len: int  # 번호로 삼을 수 있는 글 앞 타자 번호의 글자 수 — 없거나 이미 번호면 0


class ViewUnitOut(BaseModel):
    id: int
    display_id: str
    kind: str
    spans: list[tuple[int, int, int]]
    text: str
    lang: str
    # 번호 칸이 없는 단위(그림·표·캡션·목차 줄)는 null
    number: ViewNumberOut | None
    table_id: int | None
    row_index: int | None
    group_unit_id: int | None
    # 커버 단위 상태(get_cover_status) — 판단이 없는 새 문서 단위는 null
    status: str | None
    pair_id: int | None
    # 사람이 나누거나 합쳐 생긴 단위(되돌리지 않은 편집이 만든 단위) — Split 종이의 "나눔·합침" 표시
    is_edited: bool
    # 합치기로 생겨 그 뒤 바뀌지 않은 단위 — 합치기 전 단위들로 되돌릴 수 있다(편집 unmerge)
    can_unmerge: bool
    # 단위 자리의 블록 — 범위가 없는 표·캡션 없는 그림도 어느 블록(그림 이미지)인지 알 수 있게
    pos_seq: int
    block_id: int
    # 이 단위에 걸린 열린 AI 나누기 제안(적용됐고 사람이 아직 채택·거절하지 않은 것) — 없으면 null
    split_suggestion_id: int | None
    # 참조 줄 제안·확정 — 참조가 아니면 null
    ref: ViewUnitRefOut | None = None
    # 이 단위의 글 안 표·그림 참조(그 자리를 덮는 단위에 싣는다) — 나눈 뒤에도 참조가 든 쪽 단위가 갖는다
    caption_refs: list[CaptionRefOut] = []
    # 잡음 표시(noise.py) — "toc"면 목차 줄: 배정 줄이 없고 Assign 용지가 목차 블록으로 접는다. 편집 clear_noise가 비운다
    noise_kind: str | None = None
    # 제목 스타일 줄을 문장으로 바꾼 문장(F8b) — Assign의 "제목으로 되돌리기"와 묶음 머리 "[제목 → 문장]"이 읽는다. 편집 set_heading이 오간다
    from_heading: bool = False
    # 캡션 하나를 같이 쓰는 그림 묶음(F7 ⑥)의 첫 그림 — 이 그림이 그 그림의 캡션을 같이 쓴다. 첫 그림 자신·묶이지 않은 단위는 null
    caption_figure_id: int | None = None


def _to_ref_out(state: RefState | None) -> ViewUnitRefOut | None:
    return ViewUnitRefOut(state=state.state, number=state.number) if state else None


class ViewPartRefOut(BaseModel):
    section: int  # 구역 번호(1부터, 문서 순서)
    type: Literal["default", "first", "even"]


class ViewPartGroupOut(BaseModel):
    """부분 묶음 — 쪼개기 화면의 Body/Header/Footer 탭과 그 안의 묶음 제목이 읽는다."""

    key: str
    part: str
    # 이 머리말·꼬리말을 쓰는 구역 — 본문 등 다른 부분, 옛 추출(구역 표시 없음), PDF는 빈 목록
    refs: list[ViewPartRefOut]
    block_count: int
    # 같은 부분에서 내용(블록 종류·글)이 같은 앞 묶음의 key — 화면이 되풀이되는 머리말을 한 번만 보여 준다. 블록·단위는 그대로 있다
    same_as: str | None


class ViewPairOut(BaseModel):
    id: int
    status: str
    source: str
    unit_ids: list[int]


class ViewEditsOut(BaseModel):
    can_undo: bool
    can_redo: bool


class DocumentViewOut(BaseModel):
    document: DocumentBase
    extraction: ExtractionOut | None
    # 추출이 번호 범위 신호를 남겼다(추출기 5부터) — 거짓이면 화면이 옛 방식(절 첫 줄의 번호만 가림)으로 그린다
    has_number_ranges: bool
    tables: list[ViewTableOut]
    blocks: list[ViewBlockOut]
    part_groups: list[ViewPartGroupOut]
    units: list[ViewUnitOut]
    pairs: list[ViewPairOut]
    edits: ViewEditsOut


async def build_documents_out(session: AsyncSession, documents: Sequence[Document]) -> list[DocumentOut]:
    """문서마다 최신 추출·그 경고·경계 확인이 남은 단위 수를 붙인다 — 문서 수와 무관하게 쿼리 세 번이다(한 묶음의 문서들)."""
    doc_ids = [document.id for document in documents]
    extraction_by_doc: dict[int, Extraction] = {}
    if doc_ids:
        rows = await session.scalars(
            select(Extraction).where(Extraction.document_id.in_(doc_ids)).order_by(Extraction.id)
        )
        for extraction in rows:
            extraction_by_doc[extraction.document_id] = extraction  # id 순이라 가장 새 회차가 남는다
    warnings: dict[int, list[WarningOut]] = {extraction.id: [] for extraction in extraction_by_doc.values()}
    if warnings:
        rows = await session.scalars(
            select(ExtractionWarning)
            .where(ExtractionWarning.extraction_id.in_(list(warnings)))
            .order_by(ExtractionWarning.id)
        )
        for warning in rows:
            warnings[warning.extraction_id].append(WarningOut.model_validate(warning))
    ai_suggestions = await load_open_doc_meta(session, doc_ids)
    lookups = await equis_service.load_lookups(session, [document.doc_code for document in documents])
    read_at = now()
    out = []
    for document in documents:
        extraction = extraction_by_doc.get(document.id)
        ai_meta = build_ai_meta(document, ai_suggestions.get(document.id))
        out.append(
            DocumentOut(
                **DocumentBase.model_validate(document).model_dump(),
                extraction=None if extraction is None else ExtractionOut(
                    id=extraction.id, aux_status=extraction.aux_status, warnings=warnings[extraction.id]
                ),
                ai_meta=None if ai_meta is None else AiMetaOut.model_validate(ai_meta),
                equis=build_equis_out(
                    document.doc_code, "old" if document.side == "old" else "new", document.doc_version, lookups, read_at
                ),
            )
        )
    return out


async def _get_document(session: AsyncSession, bundle_id: int, doc_id: int) -> Document:
    document = await session.get(Document, doc_id)
    if document is None or document.bundle_id != bundle_id:
        raise_rule(404, "document_not_found")
    return document


async def _build_view_tables(
    session: AsyncSession, document: Document, extraction_id: int, tables: Sequence[SourceTable],
    blocks: Sequence[ViewBlockOut], units: Sequence[Unit],
) -> list[ViewTableOut]:
    """표 목록 — 안쪽 표는 바깥 칸 블록의 문단 시작 자리(블록 신호 paras)로 놓인 글자 자리를 함께 싣는다(F2).

    표마다 칸 줄 언어도 싣는다(F8a) — 단위는 이미 읽은 활성 단위다(쿼리를 더하지 않는다).
    """
    facts = build_table_facts(tables, count_table_langs((unit.table_id, unit.lang) for unit in units))
    lang_by_table = {table.id: table.lang for table in facts}
    places = {table.id: place for table in tables if (place := read_table_place(table.signals)) is not None}
    parents = {table.parent_table_id for table in tables if table.id in places}
    cells: dict[tuple[int, int, int], tuple[int, dict | None]] = {}
    if parents:
        rows = await session.execute(
            select(SourceBlock.id, SourceBlock.table_id, SourceBlock.row_index, SourceBlock.col_index, SourceBlock.signals)
            .where(
                SourceBlock.extraction_id == extraction_id, SourceBlock.table_id.in_(parents),
                SourceBlock.kind == "table_cell",
            )
        )
        cells = {(table_id, row, col): (block_id, signals) for block_id, table_id, row, col, signals in rows}
    texts = {block.id: block.text for block in blocks}
    out: list[ViewTableOut] = []
    for table in tables:
        anchor = None
        place = places.get(table.id)
        cell = cells.get((table.parent_table_id, place[0], place[1])) if place is not None else None
        if place is not None and cell is not None:
            block_id, signals = cell
            anchor = ViewTableAnchorOut(block_id=block_id, at=find_anchor_offset(texts[block_id], signals, place[2]))
        out.append(
            ViewTableOut(
                id=table.id, table_index=table.table_index, parent_table_id=table.parent_table_id, part=table.part,
                n_rows=table.n_rows, n_cols=table.n_cols, is_layout=table.is_layout,
                is_band=is_band_table(table.signals), anchor=anchor, lang=lang_by_table[table.id],
            )
        )
    return out


async def build_document_view(session: AsyncSession, document: Document) -> DocumentViewOut:
    """최신 추출의 표·블록과 활성 단위·짝 — DB 표마다 한 번씩만 읽어 단위 수와 무관하게 쿼리 수가 같다."""
    document_out = DocumentBase.model_validate(document)
    extraction = (await build_documents_out(session, [document]))[0].extraction
    edit_states = set(await session.scalars(select(UnitEdit.state).where(UnitEdit.document_id == document.id).distinct()))
    # 쪼개기 편집 기록 — 되돌릴 편집(applied)·다시 할 편집(undone)이 남아 있는지
    edits = ViewEditsOut(can_undo="applied" in edit_states, can_redo="undone" in edit_states)
    if extraction is None:  # 받지 않았거나 추출에 실패한 문서
        return DocumentViewOut(
            document=document_out, extraction=None, has_number_ranges=False, tables=[], blocks=[], part_groups=[],
            units=[], pairs=[], edits=edits,
        )
    tables = list(await session.scalars(
        select(SourceTable).where(SourceTable.extraction_id == extraction.id).order_by(SourceTable.table_index)
    ))
    block_rows = await session.execute(
        select(
            SourceBlock.id, SourceBlock.seq, SourceBlock.part, SourceBlock.kind, SourceBlock.text, SourceBlock.xml_path,
            SourceBlock.page, SourceBlock.page_basis, SourceBlock.section_label, SourceBlock.heading_level,
            SourceBlock.table_id, SourceBlock.row_index, SourceBlock.col_index, SourceBlock.grid_span,
            SourceBlock.row_span, SourceBlock.flags, SourceBlock.image_part.is_not(None).label("has_image"),
        )
        .where(SourceBlock.extraction_id == extraction.id)
        .order_by(SourceBlock.seq)
    )
    blocks = [
        ViewBlockOut(**row._mapping, part_group=get_part_group_key(row.part, row.xml_path)) for row in block_rows
    ]
    block_id_by_seq = {block.seq: block.id for block in blocks}
    units = (await session.scalars(
        select(Unit)
        .where(Unit.extraction_id == extraction.id, Unit.status == UNIT_ACTIVE)
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )).all()
    decisions: dict[int, UnitDecision] = {}
    if document.side == "old":
        rows = await session.scalars(
            select(UnitDecision).join(Unit, Unit.id == UnitDecision.unit_id).where(Unit.extraction_id == extraction.id)
        )
        decisions = {decision.unit_id: decision for decision in rows}
    pairs = await _load_view_pairs(session, document.id)
    created_lists = (
        await session.execute(
            select(UnitEdit.op, UnitEdit.created_unit_ids).where(
                UnitEdit.document_id == document.id, UnitEdit.state == "applied"
            )
        )
    ).all()
    # 합치기 해제가 되살린 단위는 원래 모습이라 "나눔·합침" 표시를 하지 않는다(그 전 편집이 만든 단위면 그 기록이 표시한다)
    edited_ids = {unit_id for op, created in created_lists if op != "unmerge" for unit_id in created}
    merged_ids = {created[0] for op, created in created_lists if op == "merge" and len(created) == 1}
    pair_by_unit = {unit_id: pair.id for pair in pairs for unit_id in pair.unit_ids}
    split_suggestions = await load_open_split_suggestion_ids(session, document)
    ref_marks = {
        mark.unit_id: mark
        for mark in await session.scalars(
            select(UnitRef).join(Unit, Unit.id == UnitRef.unit_id).where(Unit.extraction_id == extraction.id)
        )
    }
    ref_rows = (await session.scalars(
        select(CaptionRef).where(CaptionRef.extraction_id == extraction.id).order_by(CaptionRef.block_id, CaptionRef.start)
    )).all()
    ref_outs = {
        ref.id: out for ref, out in zip(ref_rows, await build_caption_ref_outs(session, ref_rows, units), strict=True)
    }
    refs_by_unit: dict[int, list[CaptionRefOut]] = {}
    for ref_id, unit_id in find_covering_unit_ids(ref_rows, units).items():
        refs_by_unit.setdefault(unit_id, []).append(ref_outs[ref_id])
    extractor_version = await session.scalar(select(Extraction.extractor_version).where(Extraction.id == extraction.id)) or ""
    return DocumentViewOut(
        document=document_out,
        extraction=extraction,
        has_number_ranges=has_number_ranges(extractor_version),
        tables=await _build_view_tables(session, document, extraction.id, list(tables), blocks, units),
        blocks=blocks,
        part_groups=[
            ViewPartGroupOut(
                key=group.key,
                part=group.part,
                refs=[ViewPartRefOut(section=section, type=ref_type) for section, ref_type in group.refs],
                block_count=group.block_count,
                same_as=group.same_as,
            )
            for group in build_part_groups(blocks)
        ],
        units=[
            ViewUnitOut(
                id=unit.id,
                display_id=compute_display_id(document, unit),
                kind=unit.kind,
                spans=unit.spans,
                text=unit.text,
                lang=unit.lang,
                number=_to_number_out(unit),
                table_id=unit.table_id,
                row_index=unit.row_index,
                group_unit_id=unit.group_unit_id,
                status=get_cover_status(unit, decisions) if document.side == "old" else None,
                pair_id=pair_by_unit.get(unit.id),
                is_edited=unit.id in edited_ids,
                can_unmerge=unit.id in merged_ids,
                pos_seq=unit.pos_seq,
                block_id=unit.spans[0][0] if unit.spans else block_id_by_seq[unit.pos_seq],
                split_suggestion_id=split_suggestions.get(unit.id),
                ref=_to_ref_out(read_ref_state(unit, ref_marks.get(unit.id), propose=is_proposing_version(extractor_version))),
                caption_refs=refs_by_unit.get(unit.id, []),
                noise_kind=unit.noise_kind,
                from_heading=unit.from_heading,
                caption_figure_id=unit.caption_figure_id,
            )
            for unit in units
        ],
        pairs=pairs,
        edits=edits,
    )


async def _load_view_pairs(session: AsyncSession, document_id: int) -> list[ViewPairOut]:
    """문서의 짝과 그 단위 — 짝 안 단위는 원문 순서로 한 쿼리에 읽는다."""
    rows = await session.execute(
        select(UnitPair.id, UnitPair.status, UnitPair.source, UnitPairMember.unit_id)
        .join(UnitPairMember, UnitPairMember.pair_id == UnitPair.id)
        .join(Unit, Unit.id == UnitPairMember.unit_id)
        .where(UnitPair.document_id == document_id)
        .order_by(UnitPair.id, Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    pairs: dict[int, ViewPairOut] = {}
    for pair_id, status, source, unit_id in rows:
        pair = pairs.setdefault(pair_id, ViewPairOut(id=pair_id, status=status, source=source, unit_ids=[]))
        pair.unit_ids.append(unit_id)
    return list(pairs.values())


def build_content_disposition(file_name: str) -> str:
    """RFC 6266·5987 — 옛 클라이언트용 ASCII 이름(못 쓰는 글자·따옴표·줄바꿈은 _)과 UTF-8 이름(filename*)을 함께 싣는다."""
    fallback = "".join(char if " " <= char <= "~" and char not in '"\\' else "_" for char in file_name)
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(file_name, safe='')}"


def _read_zip_entry(content: bytes, name: str) -> bytes | None:
    """저장된 DOCX에서 항목 하나 — 업로드 때 안전 검사를 통과한 파일이지만 선언 크기까지만 푼다."""
    with zipfile.ZipFile(BytesIO(content)) as archive:
        try:
            info = archive.getinfo(name)
        except KeyError:
            return None
        with archive.open(info) as entry:
            return entry.read(info.file_size)


@router.post("/{bundle_id}/documents", response_model=DocumentOut, status_code=201)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(),
    side: Literal["old", "new"] = Form(),
    # 새 문서(side=new)일 때만 쓴다 — 옛 문서에서는 무시한다
    doc_type: NoNulStr | None = Form(None),
    parent_code: NoNulStr | None = Form(None),
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> DocumentOut:
    # 파일을 읽기 전에 막는다 — 작업 중이 아닌 묶음의 파일을 수십 초 파싱하지 않게(쓰기 직전에 다시 확인한다)
    ensure_editable(ctx.bundle)
    # 상한보다 1바이트 더 읽어 넘었는지만 안다 — 큰 파일을 통째로 메모리에 올리지 않는다
    data = await file.read(get_max_file_bytes() + 1)
    document = await ingest_upload(
        session,
        bundle=ctx.bundle,
        side=side,
        file_name=file.filename or "",
        data=data,
        actor=ctx.login_id,
        doc_type=doc_type or None,
        # 빈 칸은 "부모 없음" — To-Be 목록 쓰기와 같은 뜻
        parent_code=(parent_code or "").strip() or None,
    )
    # 규칙이 비운 번호·버전이 있으면 AI에게 묻는다(켜져 있을 때만) — 제안은 문서 목록에 따로 보인다
    if enqueue_doc_meta(session, document, ctx.login_id):
        await session.commit()
    # 옛 문서와 이미 쓴 새 문서가 둘 다 읽혔으면 묶기 계획이 저절로 선다 — 기록은 남기지 않는다(사람 요청이 아니다)
    # 줄 선 계획이 있는지 보고 쌓는 사이에 다른 업로드가 끼지 않게 묶음을 잠근다 — 업로드는 이미 끝났으니 검사로 거절하지 않는다
    if document.status == "ready":
        await lock_bundle(session, ctx.bundle)
        await enqueue_auto_plan(session, ctx.bundle.id, ctx.login_id, origin=PLAN_ORIGIN_UPLOAD)
        await session.commit()  # 쌓지 않았어도 잠금을 바로 놓는다 — 아래 조회 동안 묶음을 잡고 있지 않게
    # 번호가 채워졌으면 EQUIS에 묻는다(켜져 있을 때만) — 응답 뒤에 돌아 업로드를 늦추지 않는다
    await start_lookups(session, background_tasks, ctx.bundle, [document.doc_code])
    out = (await build_documents_out(session, [document]))[0]
    out.prefill_sources = _find_prefill_sources(file.filename or "", document)
    return out


def _find_prefill_sources(file_name: str, document: Document) -> dict[PrefillField, PrefillSource]:
    """채운 값이 파일 이름에서 왔는지 본문에서 왔는지 — 파일 이름이 늘 먼저라 다시 읽어 가른다."""
    if document.status != "ready":
        return {}
    parsed = parse_file_name(file_name)
    sources: dict[PrefillField, PrefillSource] = {"language_layout": "content"}
    for field, from_name in (("doc_code", parsed.doc_code), ("doc_version", parsed.version)):
        value = getattr(document, field)
        if value:
            sources[field] = "file_name" if from_name else "content"
    return sources


@router.get("/{bundle_id}/documents", response_model=list[DocumentOut])
async def list_documents(
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> list[DocumentOut]:
    documents = list(
        await session.scalars(
            select(Document).where(Document.bundle_id == ctx.bundle.id).order_by(Document.id)  # 올린 순서
        )
    )
    # 아직 묻지 않았거나 하루가 지난 번호는 응답 뒤에 다시 조회한다 — 있던 값은 그대로 보여 준다
    await start_lookups(
        session, background_tasks, ctx.bundle, [document.doc_code for document in documents], sync_titles=False
    )
    return await build_documents_out(session, documents)


@router.patch("/{bundle_id}/documents/{doc_id}", response_model=DocumentOut)
async def update_document(
    body: DocumentUpdateIn,
    doc_id: IdPath,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> DocumentOut:
    bundle = ctx.bundle
    await lock_bundle(session, bundle)
    document = await _get_document(session, bundle.id, doc_id)
    check_revision("document", document.id, body.revision, document.revision)
    ensure_editable(bundle)
    changes = {
        name: value
        for name, value in body.model_dump(exclude={"revision"}, exclude_none=True).items()
        if getattr(document, name) != value
    }
    if "title" in changes:
        # EQUIS에 있는 문서의 제목은 EQUIS가 정한다 — 번호를 함께 바꾸는 요청은 새 번호로 본다
        number = normalize_number(changes.get("doc_code", document.doc_code))
        lookup = (await equis_service.load_lookups(session, [number])).get(number)
        if equis_service.is_title_locked(lookup, now()):
            raise_rule(409, "title_locked", document_id=document.id)
    if changes:  # 바뀐 게 없으면 revision을 올리지 않고 기록도 남기지 않는다
        # 비어 있던 칸을 AI 제안이 있는 채로 채우면 채택을 남긴다(같은 값 as_is, 다른 값 edited) — 처음 정한 판정이 남는다
        empty_before = [name for name in ("doc_code", "doc_version") if not getattr(document, name)]
        suggestion = (await load_open_doc_meta(session, [document.id])).get(document.id)
        record_doc_meta_adoption(suggestion, changes, empty_before, ctx.login_id)
        if "doc_code" in changes and document.target_doc_id is not None:
            # 새 문서의 번호는 To-Be 목록 줄 번호이기도 하다 — 비우면 다시 임시 번호로 돌아간다
            await rename_match_doc(
                session, bundle, document.target_doc_id, changes["doc_code"] or temp_match_code(document.id)
            )
        for name, value in changes.items():
            setattr(document, name, value)
        if "language_layout" in changes:  # 코드 짝은 연달아 배치에서만 제안한다
            await refresh_code_pairs(session, document, ctx.login_id)
        document.revision += 1
        record_event(
            session, bundle_id=bundle.id, actor=ctx.login_id, action="document.update",
            target_type="document", target_ids=[document.id],
        )
        await session.commit()
        if "doc_code" in changes:
            # 새 번호를 EQUIS에 묻는다. 이미 받아 둔 번호면 제목을 바로 맞춘다
            await start_lookups(session, background_tasks, bundle, [document.doc_code])
    return (await build_documents_out(session, [document]))[0]


@router.delete("/{bundle_id}/documents/{doc_id}", status_code=204)
async def delete_document(
    doc_id: IdPath,
    revision: int = Query(ge=1),
    # 사람의 판단이 걸린 문서를 지울 때의 명시적 확인 — 없으면 409 confirm_required로 화면이 먼저 묻는다
    confirm: bool = Query(False),
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> Response:
    bundle = ctx.bundle
    await lock_bundle(session, bundle)
    document = await _get_document(session, bundle.id, doc_id)
    check_revision("document", document.id, revision, document.revision)
    ensure_editable(bundle)
    unit_ids = list(
        await session.scalars(
            select(Unit.id).join(Extraction, Extraction.id == Unit.extraction_id).where(Extraction.document_id == document.id)
        )
    )
    decided = await find_units_needing_confirm(session, unit_ids)
    if decided and not confirm:
        raise_rule(409, "confirm_required", unit_ids=decided)
    # 단위가 CASCADE로 사라지기 전에 떼어 낸다 — 다른 문서 단위와 합쳐졌던 새 문장이 조용히 확정으로 남지 않고 보류가 되게
    await detach_units(session, bundle_id=bundle.id, unit_ids=unit_ids, cause="retired", actor=ctx.login_id)
    if document.target_doc_id is not None:
        await release_match_doc(session, bundle, document.target_doc_id, document_id=document.id)
    # 원본·추출·표·블록·경고(와 그 위의 단위)는 DB의 ON DELETE CASCADE가 지운다
    await session.delete(document)
    record_event(
        session, bundle_id=bundle.id, actor=ctx.login_id, action="document.delete",
        target_type="document", target_ids=[document.id],
    )
    await session.commit()
    return Response(status_code=204)


@router.get("/{bundle_id}/documents/{doc_id}/view", response_model=DocumentViewOut)
async def get_document_view(
    doc_id: IdPath,
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> DocumentViewOut:
    document = await _get_document(session, ctx.bundle.id, doc_id)
    return await build_document_view(session, document)


@router.get("/{bundle_id}/documents/{doc_id}/units/{unit_id}/ref", response_model=UnitRefDetailOut)
async def get_unit_ref(
    doc_id: IdPath,
    unit_id: IdPath,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> UnitRefDetailOut:
    """고른 단위가 가리키는 문서 번호와 그 번호의 EQUIS 표시 — 번호는 단위의 글에서만 나온다(자유 검색이 아니다)."""
    document = await _get_document(session, ctx.bundle.id, doc_id)
    extraction_id = await get_latest_extraction_id(session, document.id)
    unit = (await load_active_units(session, extraction_id, [unit_id]))[unit_id]
    proposing = await load_proposing_extractions(session, [extraction_id])
    state = read_ref_state(unit, await session.get(UnitRef, unit.id), propose=extraction_id in proposing)
    if state is None or not state.number:
        return UnitRefDetailOut(state=state.state if state else None)
    lookups = await equis_service.load_lookups(session, [state.number])
    # 참조 문서는 이 묶음의 옛·새 문서가 아니다 — 올린 판과 견줄 것이 없어 새 문서 쪽 판정(폐기만 본다)을 쓴다
    equis = build_equis_out(state.number, "new", "", lookups, now())
    await start_lookups(session, background_tasks, ctx.bundle, [state.number], sync_titles=False)
    suggested = (
        build_ref_text(unit.text, state.number, equis.number, equis.name)
        if equis is not None and equis.state == "found" and equis.retired is None
        else None
    )
    return UnitRefDetailOut(state=state.state, number=state.number, equis=equis, suggested_text=suggested)


def _to_number_out(unit: Unit) -> ViewNumberOut | None:
    if unit.kind not in NUMBERED_KINDS or unit.noise_kind is not None:  # 목차 줄은 번호 칸이 없다
        return None
    hidden = get_hidden_len(unit)
    is_typed_text = unit.number_source == NUMBER_TYPED and not hidden and unit.number_set is None
    return ViewNumberOut(
        value=get_number(unit), read=unit.number_read, source=unit.number_source, is_set=unit.number_set is not None,
        content_start=get_content_start(unit.text, hidden), typed_len=unit.number_len if is_typed_text else 0,
    )


async def _lock_editable_document(
    session: AsyncSession, ctx: BundleContext, doc_id: int, revision: int | None
) -> Document:
    """쪼개기 편집 앞 검사 — 묶음을 잠그고 문서를 읽어 revision(주면)과 작업 중인지 본다. 편집과 같은 트랜잭션이다."""
    await lock_bundle(session, ctx.bundle)
    document = await _get_document(session, ctx.bundle.id, doc_id)
    if revision is not None:
        check_revision("document", document.id, revision, document.revision)
    ensure_editable(ctx.bundle)
    return document


@router.post("/{bundle_id}/documents/{doc_id}/edits", response_model=EditResult)
async def edit_units(
    body: EditIn,
    doc_id: IdPath,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> EditResult:
    document = await _lock_editable_document(session, ctx, doc_id, body.revision)
    revision = document.revision
    result = await apply_edit(session, document, body.op, confirm=body.confirm, actor=ctx.login_id)
    # 바뀐 것이 없는 편집은 Split 기록도 revision도 그대로라 Assign 단계도 남기지 않는다(언어 바꾸기는 단위를 만들지 않는다)
    if body.undo is not None and result.document_revision != revision:
        await record_unit_edit_step(session, ctx.bundle, ctx.login_id, body.undo, document.id)
    await session.commit()
    return result


@router.post("/{bundle_id}/documents/{doc_id}/edits/undo", response_model=EditStepResult)
async def undo_unit_edit(
    body: EditStepIn,
    doc_id: IdPath,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> EditStepResult:
    document = await _lock_editable_document(session, ctx, doc_id, body.revision)
    result = await undo_edit(session, document, confirm=body.confirm, actor=ctx.login_id)
    await session.commit()
    return result


@router.post("/{bundle_id}/documents/{doc_id}/edits/redo", response_model=EditStepResult)
async def redo_unit_edit(
    body: EditStepIn,
    doc_id: IdPath,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> EditStepResult:
    document = await _lock_editable_document(session, ctx, doc_id, body.revision)
    result = await redo_edit(session, document, confirm=body.confirm, actor=ctx.login_id)
    await session.commit()
    return result


@router.post("/{bundle_id}/documents/{doc_id}/pairs", response_model=PairResult, status_code=201)
async def create_unit_pair(
    body: PairIn,
    doc_id: IdPath,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> PairResult:
    document = await _lock_editable_document(session, ctx, doc_id, body.revision)
    pair = await create_pair(session, document, body.unit_ids, ctx.login_id)
    result = PairResult(document_revision=document.revision, pair=await build_pair_out(session, pair))
    await session.commit()
    return result


@router.post("/{bundle_id}/documents/{doc_id}/pairs/{pair_id}/confirm", response_model=PairResult)
async def confirm_unit_pair(
    body: PairRevisionIn,
    doc_id: IdPath,
    pair_id: IdPath,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> PairResult:
    document = await _lock_editable_document(session, ctx, doc_id, body.revision)
    pair = await confirm_pair(session, document, pair_id, ctx.login_id)
    result = PairResult(document_revision=document.revision, pair=await build_pair_out(session, pair))
    await session.commit()
    return result


@router.delete("/{bundle_id}/documents/{doc_id}/pairs/{pair_id}", response_model=PairResult)
async def delete_unit_pair(
    doc_id: IdPath,
    pair_id: IdPath,
    revision: int = Query(ge=1),
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> PairResult:
    # 짝을 풀어도 문서 revision이 오르므로 204 대신 새 revision을 돌려준다
    document = await _lock_editable_document(session, ctx, doc_id, revision)
    await delete_pair(session, document, pair_id, ctx.login_id)
    result = PairResult(document_revision=document.revision, pair=None)
    await session.commit()
    return result


@router.patch("/{bundle_id}/documents/{doc_id}/caption-refs/{ref_id}", response_model=CaptionRefResult)
async def edit_caption_ref(
    body: CaptionRefIn,
    doc_id: IdPath,
    ref_id: IdPath,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> CaptionRefResult:
    document = await _lock_editable_document(session, ctx, doc_id, body.revision)
    ref = await update_caption_ref(session, ctx.bundle, document, ref_id, body, ctx.login_id)
    result = CaptionRefResult(document_revision=document.revision, ref=ref)
    await session.commit()
    return result


@router.get("/{bundle_id}/documents/{doc_id}/file")
async def download_document_file(
    doc_id: IdPath,
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> Response:
    document = await _get_document(session, ctx.bundle.id, doc_id)
    stored = await session.get(DocumentFile, document.id)
    if stored is None:  # 받지 않았거나 추출에 실패한 문서는 바이트를 남기지 않았다
        raise_rule(404, "file_not_found")
    return Response(
        content=stored.content,
        media_type=_FILE_MEDIA_TYPES[document.file_format],
        headers={"Content-Disposition": build_content_disposition(document.file_name)},
    )


async def _respond_paragraphs(
    session: AsyncSession, bundle_id: int, documents: Sequence[Document], include_tables: bool, file_title: str
) -> Response:
    """문서마다 시트 하나인 문단 Excel 응답 — 시트 이름은 문서 번호(없으면 제목)."""
    taken: set[str] = set()
    sheets = [
        (make_sheet_name(document.doc_code or document.title, taken),
         build_paragraph_rows(await load_unit_lines(session, document), include_tables))
        for document in documents
    ]
    content = await asyncio.to_thread(build_paragraph_workbook, sheets)
    headers = {"Content-Disposition": build_content_disposition(build_export_file_name(bundle_id, file_title, now()))}
    return Response(content=content, media_type=_XLSX_MEDIA_TYPE, headers=headers)


@router.get("/{bundle_id}/documents/{doc_id}/paragraphs.xlsx")
async def download_document_paragraphs(
    doc_id: IdPath,
    tables: bool = Query(True),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """문서 하나의 문단 Excel — 쪼갠 단위 한 줄씩 한 열(Assign 문서 대시보드). tables=false면 표 칸 문장을 뺀다."""
    document = await _get_document(session, ctx.bundle.id, doc_id)
    title = f"{document.doc_code or document.title}_paragraphs"
    return await _respond_paragraphs(session, ctx.bundle.id, [document], tables, title)


@router.get("/{bundle_id}/old-paragraphs.xlsx")
async def download_old_paragraphs(
    tables: bool = Query(True),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Bundle의 Old 문서 모두의 문단 Excel — 올린 순서대로 문서마다 시트 하나."""
    documents = (await session.scalars(
        select(Document).where(Document.bundle_id == ctx.bundle.id, Document.side == "old").order_by(Document.id)
    )).all()
    return await _respond_paragraphs(session, ctx.bundle.id, documents, tables, "Old_paragraphs")


@router.get("/{bundle_id}/documents/{doc_id}/figures/{block_id}")
async def get_figure_image(
    doc_id: IdPath,
    block_id: IdPath,
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> Response:
    document = await _get_document(session, ctx.bundle.id, doc_id)
    image_part = await session.scalar(
        select(SourceBlock.image_part)
        .join(Extraction, Extraction.id == SourceBlock.extraction_id)
        .where(SourceBlock.id == block_id, SourceBlock.kind == "figure", Extraction.document_id == document.id)
    )
    if image_part is None:
        raise_rule(404, "figure_not_found")
    stored = await session.get_one(DocumentFile, document.id)  # 그림 블록은 ready 문서에만 있고 ready는 바이트를 남긴다
    content = await asyncio.to_thread(_read_zip_entry, stored.content, image_part)
    if content is None:  # 외부 링크 그림처럼 파일 안에 없는 대상
        raise_rule(404, "figure_not_found")
    extension = image_part.rsplit(".", 1)[-1].lower()
    return Response(
        content=content,
        media_type=_IMAGE_MEDIA_TYPES.get(extension, "application/octet-stream"),
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.post("/{bundle_id}/warnings/{warning_id}/ack", response_model=WarningOut)
async def ack_warning(
    body: WarningAckIn,
    warning_id: IdPath,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> WarningOut:
    bundle = ctx.bundle
    await lock_bundle(session, bundle)
    ensure_editable(bundle)
    warning = await session.scalar(
        select(ExtractionWarning)
        .join(Extraction, Extraction.id == ExtractionWarning.extraction_id)
        .join(Document, Document.id == Extraction.document_id)
        .where(ExtractionWarning.id == warning_id, Document.bundle_id == bundle.id)
    )
    if warning is None:
        raise_rule(404, "warning_not_found")
    if warning.acked_by is not None:  # 처음 확인한 사람·메모를 덮어쓰지 않는다
        raise_rule(409, "warning_already_acked")
    warning.acked_by, warning.acked_at, warning.ack_note = ctx.login_id, now(), body.note
    record_event(
        session, bundle_id=bundle.id, actor=ctx.login_id, action="warning.ack",
        target_type="warning", target_ids=[warning.id],
    )
    await session.commit()
    return WarningOut.model_validate(warning)
