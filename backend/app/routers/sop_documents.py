"""문서 API — 업로드(옛/새)·목록·정보 고치기·삭제·원문 대조 데이터(view)·원본과 그림 내려받기·추출 경고 확인·쪼개기 편집과
되돌리기·경계 확인·한/영 짝. 쓰기는 작성자가 작업 중일 때만 한다(편집 규칙은 app/sop/editing.py, 짝 규칙은 app/sop/pairs.py)."""

import asyncio
import zipfile
from collections.abc import Sequence
from io import BytesIO
from typing import Annotated, Literal, Self
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Path, Query, Response, UploadFile
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.db import get_session
from app.routers.admin import KstDatetime
from app.sop.constants import LANGUAGE_LAYOUTS, MEMBER_ROLES
from app.sop.detach import detach_units, find_units_needing_confirm
from app.sop.editing import (
    BoundaryIn,
    BoundaryOut,
    EditIn,
    EditResult,
    EditStepIn,
    apply_edit,
    redo_edit,
    set_boundary_confirmed,
    undo_edit,
)
from app.sop.ai.adoption import record_doc_meta_adoption
from app.sop.ai.doc_meta_job import build_ai_meta, enqueue_doc_meta, load_open_doc_meta
from app.sop.filename import parse_file_name
from app.sop.errors import check_revision, raise_rule
from app.sop.events import record_event
from app.sop.ingest import get_max_file_bytes, ingest_upload
from app.sop.membership import BundleContext, ensure_editable, lock_bundle, require_bundle_role
from app.sop.models import (
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
)
from app.sop.pairs import (
    PairIn,
    PairResult,
    PairRevisionIn,
    build_pair_out,
    confirm_pair,
    create_pair,
    delete_pair,
)
from app.sop.schemas import NO_NUL, NoNulStr
from app.sop.status import get_cover_status
from app.sop.tobe import MAX_DB_INT, remove_match_doc, rename_match_doc, temp_match_code
from app.sop.units import UNIT_ACTIVE, compute_display_id, refresh_code_pairs

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


class ViewTableOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    table_index: int
    parent_table_id: int | None
    part: str
    n_rows: int
    n_cols: int
    is_layout: bool


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


class ViewUnitOut(BaseModel):
    id: int
    display_id: str
    kind: str
    spans: list[tuple[int, int, int]]
    text: str
    lang: str
    table_id: int | None
    row_index: int | None
    group_unit_id: int | None
    boundary_confirmed: bool
    # 커버 단위 상태(get_cover_status) — 판단이 없는 새 문서 단위는 null
    status: str | None
    pair_id: int | None
    # 사람이 나누거나 합쳐 생긴 단위(되돌리지 않은 편집이 만든 단위) — Split 종이의 "나눔·합침" 표시
    is_edited: bool
    # 단위 자리의 블록 — 범위가 없는 표·행·캡션 없는 그림도 어느 블록(그림 이미지)인지 알 수 있게
    pos_seq: int
    block_id: int


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
    tables: list[ViewTableOut]
    blocks: list[ViewBlockOut]
    units: list[ViewUnitOut]
    pairs: list[ViewPairOut]
    edits: ViewEditsOut


async def build_documents_out(session: AsyncSession, documents: Sequence[Document]) -> list[DocumentOut]:
    """문서마다 최신 추출과 그 경고를 붙인다 — 문서 수와 무관하게 쿼리 두 번(추출·경고)이다."""
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
            )
        )
    return out


async def _get_document(session: AsyncSession, bundle_id: int, doc_id: int) -> Document:
    document = await session.get(Document, doc_id)
    if document is None or document.bundle_id != bundle_id:
        raise_rule(404, "document_not_found")
    return document


async def build_document_view(session: AsyncSession, document: Document) -> DocumentViewOut:
    """최신 추출의 표·블록과 활성 단위·짝 — DB 표마다 한 번씩만 읽어 단위 수와 무관하게 쿼리 수가 같다."""
    document_out = DocumentBase.model_validate(document)
    extraction = (await build_documents_out(session, [document]))[0].extraction
    edit_states = set(await session.scalars(select(UnitEdit.state).where(UnitEdit.document_id == document.id).distinct()))
    # 쪼개기 편집 기록 — 되돌릴 편집(applied)·다시 할 편집(undone)이 남아 있는지
    edits = ViewEditsOut(can_undo="applied" in edit_states, can_redo="undone" in edit_states)
    if extraction is None:  # 받지 않았거나 추출에 실패한 문서
        return DocumentViewOut(
            document=document_out, extraction=None, tables=[], blocks=[], units=[], pairs=[], edits=edits
        )
    tables = await session.scalars(
        select(SourceTable).where(SourceTable.extraction_id == extraction.id).order_by(SourceTable.table_index)
    )
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
    blocks = [ViewBlockOut.model_validate(row) for row in block_rows]
    block_id_by_seq = {block.seq: block.id for block in blocks}
    units = await session.scalars(
        select(Unit)
        .where(Unit.extraction_id == extraction.id, Unit.status == UNIT_ACTIVE)
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    decisions: dict[int, UnitDecision] = {}
    if document.side == "old":
        rows = await session.scalars(
            select(UnitDecision).join(Unit, Unit.id == UnitDecision.unit_id).where(Unit.extraction_id == extraction.id)
        )
        decisions = {decision.unit_id: decision for decision in rows}
    pairs = await _load_view_pairs(session, document.id)
    created_lists = await session.scalars(
        select(UnitEdit.created_unit_ids).where(UnitEdit.document_id == document.id, UnitEdit.state == "applied")
    )
    edited_ids = {unit_id for created in created_lists for unit_id in created}
    pair_by_unit = {unit_id: pair.id for pair in pairs for unit_id in pair.unit_ids}
    return DocumentViewOut(
        document=document_out,
        extraction=extraction,
        tables=[ViewTableOut.model_validate(table) for table in tables],
        blocks=blocks,
        units=[
            ViewUnitOut(
                id=unit.id,
                display_id=compute_display_id(document, unit),
                kind=unit.kind,
                spans=unit.spans,
                text=unit.text,
                lang=unit.lang,
                table_id=unit.table_id,
                row_index=unit.row_index,
                group_unit_id=unit.group_unit_id,
                boundary_confirmed=unit.boundary_confirmed,
                status=get_cover_status(unit, decisions) if document.side == "old" else None,
                pair_id=pair_by_unit.get(unit.id),
                is_edited=unit.id in edited_ids,
                pos_seq=unit.pos_seq,
                block_id=unit.spans[0][0] if unit.spans else block_id_by_seq[unit.pos_seq],
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
    ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> list[DocumentOut]:
    documents = await session.scalars(
        select(Document).where(Document.bundle_id == ctx.bundle.id).order_by(Document.id)  # 올린 순서
    )
    return await build_documents_out(session, list(documents))


@router.patch("/{bundle_id}/documents/{doc_id}", response_model=DocumentOut)
async def update_document(
    body: DocumentUpdateIn,
    doc_id: IdPath,
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
            await refresh_code_pairs(session, document)
        document.revision += 1
        record_event(
            session, bundle_id=bundle.id, actor=ctx.login_id, action="document.update",
            target_type="document", target_ids=[document.id],
        )
        await session.commit()
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
        await remove_match_doc(session, bundle, document.target_doc_id)
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
    result = await apply_edit(session, document, body.op, confirm=body.confirm, actor=ctx.login_id)
    await session.commit()
    return result


@router.post("/{bundle_id}/documents/{doc_id}/edits/undo", response_model=EditResult)
async def undo_unit_edit(
    body: EditStepIn,
    doc_id: IdPath,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> EditResult:
    document = await _lock_editable_document(session, ctx, doc_id, body.revision)
    result = await undo_edit(session, document, confirm=body.confirm, actor=ctx.login_id)
    await session.commit()
    return result


@router.post("/{bundle_id}/documents/{doc_id}/edits/redo", response_model=EditResult)
async def redo_unit_edit(
    body: EditStepIn,
    doc_id: IdPath,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> EditResult:
    document = await _lock_editable_document(session, ctx, doc_id, body.revision)
    result = await redo_edit(session, document, confirm=body.confirm, actor=ctx.login_id)
    await session.commit()
    return result


@router.post("/{bundle_id}/documents/{doc_id}/units/boundary", response_model=BoundaryOut)
async def confirm_unit_boundaries(
    body: BoundaryIn,
    doc_id: IdPath,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> BoundaryOut:
    # 경계 확인은 단위 집합을 바꾸지 않아 문서 revision을 싣지 않고 되돌리기 대상도 아니다
    document = await _lock_editable_document(session, ctx, doc_id, None)
    unit_ids = await set_boundary_confirmed(session, document, body.unit_ids, body.confirmed)
    await session.commit()
    return BoundaryOut(unit_ids=unit_ids, confirmed=body.confirmed)


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
