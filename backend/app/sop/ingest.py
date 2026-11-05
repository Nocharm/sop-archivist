"""문서 업로드 — 파일 검사·중복 확인·격리 추출·누락 대조 뒤 문서·원본·추출(표·블록·경고)을 한 쓰기 트랜잭션으로 저장한다."""

import asyncio
import hashlib
import logging
from collections.abc import Sequence

from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.settings import settings
from app.sop.errors import raise_rule
from app.sop.events import record_event
from app.sop.extract.aux_compare import MAX_MISSING_ITEMS, MissingText, find_missing_text
from app.sop.extract.types import EXTRACTOR_VERSION, ExtractedBlock, ExtractedTable, ExtractLimits, ExtractResult
from app.sop.extract.worker import WorkerResult, extract_in_subprocess
from app.sop.filename import parse_file_name
from app.sop.membership import ensure_editable
from app.sop.models import (
    Bundle,
    Document,
    DocumentFile,
    Extraction,
    ExtractionWarning,
    SourceBlock,
    SourceTable,
)
from app.sop.tobe import add_match_doc, check_match_doc, ensure_code_free

logger = logging.getLogger(__name__)

MIB = 1024 * 1024
# 업무 상수 — ZIP 안전 검사 기준(설계 §7.1이 빌더에게 맡긴 값). 정상 DOCX는 항목 수십 개, 압축 비율 한두 자리라 여유가 크다
MAX_ZIP_ENTRIES = 2000
MAX_COMPRESSION_RATIO = 200
MAX_FILE_NAME_CHARS = 255  # documents.file_name 길이 — 넘는 이름이 Postgres에서 500이 되지 않게
_FORMAT_BY_EXTENSION = {".docx": "docx", ".pdf": "pdf"}
_STATUS_BY_OUTCOME = {"ok": "ready", "rejected": "rejected", "failed": "failed"}

WARNING_MISSING_TEXT = "missing_text"
# 누락 의심이 상한(MAX_MISSING_ITEMS)에서 멈췄다 — 더 있을 수 있음을 알릴 뿐이라 확인을 요구하지 않는다
WARNING_MISSING_TEXT_TRUNCATED = "missing_text_truncated"


def get_max_file_bytes() -> int:
    return settings.sop_max_file_mb * MIB


def build_limits() -> ExtractLimits:
    """Settings의 거절 기준을 추출기 입력으로 — 요청마다 읽어 env를 바꾼 뒤 재기동만으로 반영된다."""
    return ExtractLimits(
        max_unzipped_bytes=settings.sop_max_docx_unzipped_mb * MIB,
        max_zip_entries=MAX_ZIP_ENTRIES,
        max_compression_ratio=MAX_COMPRESSION_RATIO,
        max_pdf_pages=settings.sop_max_pdf_pages,
        max_chars=settings.sop_max_doc_chars,
    )


async def ingest_upload(
    session: AsyncSession,
    *,
    bundle: Bundle,
    side: str,
    file_name: str,
    data: bytes,
    actor: str,
    doc_type: str | None,
    parent_code: str | None,
) -> Document:
    """올린 파일 하나를 문서로 만든다. data는 상한보다 1바이트 더 읽은 바이트까지다(넘으면 too_large).

    받지 않는 파일(형식·크기·추출 거절)과 추출 실패도 사유와 함께 문서 행으로 남기고, 원본 바이트·추출은 ready만 저장한다.
    같은 묶음에 같은 내용이면 409 duplicate_file(행 없음). 새 문서(side=new)는 To-Be 목록에 입구 2 줄을 만들어 잇는다.
    파싱은 수십 초 걸릴 수 있어 그동안 DB 연결을 놓고, 쓰기 직전에 묶음을 잠근 뒤 모든 검사를 다시 한다.
    """
    if len(file_name) > MAX_FILE_NAME_CHARS:
        raise_rule(422, "file_name_too_long", max_chars=MAX_FILE_NAME_CHARS)
    bundle_id = bundle.id  # rollback 뒤에는 만료된 속성을 읽을 수 없다(비동기 지연 로드 금지)
    parsed = parse_file_name(file_name)
    file_format = _detect_format(file_name)
    sha256 = hashlib.sha256(data).hexdigest()
    await _ensure_new_file(session, bundle_id, sha256)
    if side == "new":
        await check_match_doc(session, bundle_id, code=parsed.doc_code, doc_type=doc_type, parent_code=parent_code)
    await session.rollback()  # 파싱하는 동안 DB 연결을 붙잡지 않는다

    outcome = await _extract(data, file_format)
    missing = await _find_missing(outcome)

    # --- 쓰기 트랜잭션: 파싱하는 동안 바뀌었을 수 있어 묶음을 잠그고 다시 검사한다 ---
    locked = await session.get(Bundle, bundle_id, with_for_update=True, populate_existing=True)
    if locked is None:  # 파싱하는 동안 묶음이 지워졌다
        raise_rule(404, "bundle_not_found")
    ensure_editable(locked)
    await _ensure_new_file(session, bundle_id, sha256)
    parent_id = None
    if side == "new":
        parent_id = await check_match_doc(
            session, bundle_id, code=parsed.doc_code, doc_type=doc_type, parent_code=parent_code
        )

    document = Document(
        bundle_id=bundle_id, side=side, file_name=file_name, file_format=file_format, size_bytes=len(data),
        sha256=sha256, doc_code=parsed.doc_code, doc_version=parsed.version, title=parsed.title,
        status=_STATUS_BY_OUTCOME[outcome.outcome], status_reason=outcome.code, uploaded_by=actor,
    )
    session.add(document)
    try:
        await session.flush()
    except IntegrityError:  # 잠금이 없는 sqlite에서 같은 파일 두 요청이 함께 검사를 통과한 경우
        await session.rollback()
        raise_rule(409, "duplicate_file")
    if side == "new":
        code = parsed.doc_code or f"NEW-{document.id}"  # 번호를 지어내지 않고 사람이 고칠 임시 번호를 목록에만 둔다
        if not parsed.doc_code:
            await ensure_code_free(session, bundle_id, code)
        target = await add_match_doc(
            session, locked, code=code, title=parsed.title, doc_type=doc_type, parent_id=parent_id
        )
        document.target_doc_id = target.id
    block_count = warning_count = 0
    if outcome.result is not None:
        session.add(DocumentFile(document_id=document.id, content=data))
        block_count, warning_count = await _write_extraction(
            session, document.id, outcome.result, outcome.aux_error, missing
        )
        # 단위 만들기 자리 — 블록 id가 정해진 이 트랜잭션 안, 커밋 직전에 추출 결과로 단위(옛 문서는 판단 행까지)를 만든다
    record_event(
        session, bundle_id=bundle_id, actor=actor, action="document.upload",
        target_type="document", target_ids=[document.id],
    )
    await session.commit()
    logger.info(
        "document upload: bundle=%d document=%d side=%s status=%s reason=%s blocks=%d warnings=%d aux=%s error=%s",
        bundle_id, document.id, side, document.status, document.status_reason or "-", block_count,
        warning_count, outcome.aux_error or "-", outcome.error_class or "-",
    )
    return document


def _detect_format(file_name: str) -> str:
    """확장자(대소문자 무시)로 형식을 정한다 — docx|pdf, 그 밖은 ""(invalid_format으로 거절된다)."""
    lowered = file_name.lower()
    return next((fmt for extension, fmt in _FORMAT_BY_EXTENSION.items() if lowered.endswith(extension)), "")


async def _ensure_new_file(session: AsyncSession, bundle_id: int, sha256: str) -> None:
    """같은 묶음에 같은 내용의 파일이 있으면 409 duplicate_file — 거절·실패로 남은 행도 같은 파일로 본다."""
    taken = await session.scalar(select(Document.id).where(Document.bundle_id == bundle_id, Document.sha256 == sha256))
    if taken is not None:
        raise_rule(409, "duplicate_file")


async def _extract(data: bytes, file_format: str) -> WorkerResult:
    """크기·형식 거절은 자식을 띄우지 않고 정하고, 나머지는 격리 추출에 맡긴다."""
    if len(data) > get_max_file_bytes():
        return WorkerResult("rejected", "too_large", None, None, None)
    if not file_format:
        return WorkerResult("rejected", "invalid_format", None, None, None)
    return await extract_in_subprocess(
        data, file_format, build_limits(),
        timeout_s=settings.sop_parse_timeout_seconds, memory_mb=settings.sop_parse_memory_mb,
    )


async def _find_missing(outcome: WorkerResult) -> list[MissingText]:
    """보조 변환이 있으면 메인 블록 글과 대조한다 — 200만 자까지 훑으므로 이벤트 루프 밖에서."""
    if outcome.result is None or outcome.aux_markdown is None:
        return []
    texts = [block.text for block in outcome.result.blocks]
    return await asyncio.to_thread(find_missing_text, texts, outcome.aux_markdown)


async def _write_extraction(
    session: AsyncSession,
    document_id: int,
    result: ExtractResult,
    aux_error: str | None,
    missing: Sequence[MissingText],
) -> tuple[int, int]:
    """추출 한 회차와 표·블록·경고를 쓴다. 추출기의 표 순번·블록 seq를 이 트랜잭션에서 DB id로 바꾼다. (블록 수, 경고 수)."""
    extraction = Extraction(
        document_id=document_id, extractor_version=EXTRACTOR_VERSION,
        aux_status="ok" if aux_error is None else "failed", aux_detail=aux_error or "",
    )
    session.add(extraction)
    await session.flush()
    table_ids = await _insert_tables(session, extraction.id, result.tables)
    block_ids = await _insert_blocks(session, extraction.id, result.blocks, table_ids)

    warnings = [
        {
            "extraction_id": extraction.id, "kind": warning.kind, "detail": dict(warning.detail), "needs_ack": False,
            "block_id": block_ids[warning.block_seq] if warning.block_seq is not None else None,
        }
        for warning in result.warnings
    ]
    for item in missing:
        # after_block_index는 대조에 넘긴 블록 목록의 번호다 — 그 블록의 seq로 DB id를 찾는다
        block_id = (
            block_ids[result.blocks[item.after_block_index].seq] if item.after_block_index is not None else None
        )
        warnings.append({
            "extraction_id": extraction.id, "kind": WARNING_MISSING_TEXT, "block_id": block_id,
            "detail": {"snippet": item.snippet}, "needs_ack": True,
        })
    if len(missing) >= MAX_MISSING_ITEMS:
        warnings.append({
            "extraction_id": extraction.id, "kind": WARNING_MISSING_TEXT_TRUNCATED, "block_id": None,
            "detail": {}, "needs_ack": False,
        })
    if warnings:
        await session.execute(insert(ExtractionWarning), warnings)
    return len(block_ids), len(warnings)


async def _insert_tables(
    session: AsyncSession, extraction_id: int, tables: Sequence[ExtractedTable]
) -> dict[int, int]:
    """표를 한 번에 넣고 {표 순번: id}. 안쪽 표의 부모는 모든 표의 id가 정해진 뒤 채운다(읽은 순서와 무관하게)."""
    if not tables:
        return {}
    ids = await session.scalars(
        insert(SourceTable).returning(SourceTable.id, sort_by_parameter_order=True),
        [
            {
                "extraction_id": extraction_id, "table_index": table.index, "part": table.part,
                "xml_path": table.xml_path, "n_rows": table.n_rows, "n_cols": table.n_cols,
            }
            for table in tables
        ],
    )
    id_by_index = dict(zip((table.index for table in tables), ids, strict=True))
    nested = [
        {"id": id_by_index[table.index], "parent_table_id": id_by_index[table.parent_index]}
        for table in tables
        if table.parent_index is not None
    ]
    if nested:
        await session.execute(update(SourceTable), nested)
    return id_by_index


async def _insert_blocks(
    session: AsyncSession, extraction_id: int, blocks: Sequence[ExtractedBlock], table_ids: dict[int, int]
) -> dict[int, int]:
    """블록을 한 번에 넣고 {seq: id} — 10만 블록 문서도 객체 단위 flush 없이 묶음 INSERT로 쓴다."""
    ids = await session.scalars(
        insert(SourceBlock).returning(SourceBlock.id, sort_by_parameter_order=True),
        [
            {
                "extraction_id": extraction_id, "seq": block.seq, "part": block.part, "kind": block.kind,
                "text": block.text, "xml_path": block.xml_path, "page": block.page, "page_basis": block.page_basis,
                "section_label": block.section_label, "heading_level": block.heading_level,
                "table_id": table_ids[block.table_index] if block.table_index is not None else None,
                "row_index": block.row_index, "col_index": block.col_index, "grid_span": block.grid_span,
                "row_span": block.row_span, "image_part": block.image_part, "flags": list(block.flags),
            }
            for block in blocks
        ],
    )
    return dict(zip((block.seq for block in blocks), ids, strict=True))
