"""문서 API — 업로드(옛/새)·목록·정보 고치기·삭제·원본과 그림 내려받기·추출 경고 확인. 쓰기는 작성자가 작업 중일 때만 한다."""

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
from app.sop.errors import check_revision, raise_rule
from app.sop.events import record_event
from app.sop.ingest import get_max_file_bytes, ingest_upload
from app.sop.membership import BundleContext, ensure_editable, lock_bundle, require_bundle_role
from app.sop.models import Document, DocumentFile, Extraction, ExtractionWarning, SourceBlock
from app.sop.tobe import MAX_DB_INT, remove_match_doc

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


class DocumentOut(DocumentBase):
    # 받지 않았거나(rejected) 추출에 실패한(failed) 문서는 추출이 없다
    extraction: ExtractionOut | None


class DocumentUpdateIn(BaseModel):
    revision: int = Field(ge=1)
    doc_code: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None
    doc_version: Annotated[str, StringConstraints(strip_whitespace=True, max_length=50)] | None = None
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    language_layout: Annotated[str, AfterValidator(_check_language_layout)] | None = None

    @model_validator(mode="after")
    def check_something_to_change(self) -> Self:
        if self.doc_code is None and self.doc_version is None and self.title is None and self.language_layout is None:
            raise ValueError("doc_code, doc_version, title or language_layout is required")
        return self


class WarningAckIn(BaseModel):
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_ACK_NOTE_CHARS)] = ""


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
    out = []
    for document in documents:
        extraction = extraction_by_doc.get(document.id)
        out.append(
            DocumentOut(
                **DocumentBase.model_validate(document).model_dump(),
                extraction=None if extraction is None else ExtractionOut(
                    id=extraction.id, aux_status=extraction.aux_status, warnings=warnings[extraction.id]
                ),
            )
        )
    return out


async def _get_document(session: AsyncSession, bundle_id: int, doc_id: int) -> Document:
    document = await session.get(Document, doc_id)
    if document is None or document.bundle_id != bundle_id:
        raise_rule(404, "document_not_found")
    return document


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
    doc_type: str | None = Form(None),
    parent_code: str | None = Form(None),
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
    return (await build_documents_out(session, [document]))[0]


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
        for name, value in changes.items():
            setattr(document, name, value)
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
    # 확정된 판단이 붙은 문서를 지울 때의 명시적 확인 — 판단은 단위가 생긴 뒤에 붙으므로 지금은 받기만 한다
    confirm: bool = Query(False),
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> Response:
    bundle = ctx.bundle
    await lock_bundle(session, bundle)
    document = await _get_document(session, bundle.id, doc_id)
    check_revision("document", document.id, revision, document.revision)
    ensure_editable(bundle)
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
