"""원본 보기용 조회 — 활성 Unit마다 원본 블록의 XML 경로·쪽을 알려 준다(글자는 싣지 않는다)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.counterparts import BODY_PART
from app.sop.models import Document, DocumentFile, SourceBlock, SourceTable, Unit
from app.sop.schemas import OriginalPlaceBlock, OriginalPlace, OriginalPlaces
from app.sop.units import UNIT_ACTIVE, get_latest_extraction_id


async def load_original_places(session: AsyncSession, document: Document) -> OriginalPlaces:
    """원본 DOCX가 있을 때만 places를 채운다 — 파일이 없으면 none, PDF는 아직 자리를 주지 않는다."""
    has_file = await session.scalar(select(DocumentFile.document_id).where(DocumentFile.document_id == document.id))
    if has_file is None:
        return OriginalPlaces(file_format="none", page_basis=None, places=[])
    if document.file_format != "docx":
        return OriginalPlaces(file_format=document.file_format, page_basis=None, places=[])  # type: ignore[arg-type]
    extraction_id = await get_latest_extraction_id(session, document.id)
    if extraction_id is None:
        return OriginalPlaces(file_format="docx", page_basis=None, places=[])
    block_rows = await session.execute(
        select(SourceBlock.id, SourceBlock.seq, SourceBlock.part, SourceBlock.xml_path, SourceBlock.page, SourceBlock.page_basis)
        .where(SourceBlock.extraction_id == extraction_id)
    )
    blocks = {row.id: row for row in block_rows}
    by_seq = {row.seq: row for row in blocks.values()}
    table_paths = dict(
        (await session.execute(select(SourceTable.id, SourceTable.xml_path).where(SourceTable.extraction_id == extraction_id))).tuples().all()
    )
    body = [row for row in blocks.values() if row.part == BODY_PART]
    page_basis = min(body, key=lambda row: row.seq).page_basis if body else None
    units = await session.execute(
        select(Unit.id, Unit.spans, Unit.pos_seq, Unit.table_id)
        .where(Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE)
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    places: list[OriginalPlace] = []
    for unit_id, spans, pos_seq, table_id in units:
        seen: set[int] = set()
        listed: list[OriginalPlaceBlock] = []
        for block_id, _start, _end in spans:
            block = blocks.get(block_id)
            if block is None or block_id in seen:
                continue
            seen.add(block_id)
            listed.append(OriginalPlaceBlock(path=block.xml_path, page=block.page))
        if not listed:
            # 범위가 없는 Unit — 표는 표 전체(표 경로), 그림은 그림 블록. 둘 다 pos_seq가 첫 블록(표는 첫 칸)의 seq다
            anchor = by_seq.get(pos_seq)
            path = table_paths.get(table_id) if table_id is not None else anchor.xml_path if anchor is not None else None
            if path is not None:
                listed.append(OriginalPlaceBlock(path=path, page=anchor.page if anchor is not None else None))
        if listed:
            places.append(OriginalPlace(unit_id=unit_id, blocks=listed))
    return OriginalPlaces(file_format="docx", page_basis=page_basis, places=places)
