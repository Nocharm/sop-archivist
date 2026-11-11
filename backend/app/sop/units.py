"""단위 서비스 — 추출 블록을 규칙으로 쪼개 단위·판단 행·코드 짝을 쓰고, 언어 배치가 바뀌면 짝을 다시 제안하고, 커버리지를 지킨다."""

import asyncio
from collections.abc import Sequence

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import COVER_KINDS
from app.sop.coverage import find_coverage_problems
from app.sop.models import (
    Document,
    Extraction,
    SourceBlock,
    SourceTable,
    Unit,
    UnitDecision,
    UnitPair,
    UnitPairMember,
)
from app.sop.segment import (
    NEUTRAL,
    BlockView,
    TableView,
    UnitDraft,
    build_unit_drafts,
    build_unit_text,
    count_pair_directions,
    suggest_interleaved_pairs,
)

UNIT_ACTIVE = "active"
PAIR_SUGGESTED = "suggested"
PAIR_SOURCE_CODE = "code"
INTERLEAVED_LAYOUT = "ko_en_interleaved"
# 블록 안 줄바꿈에서도 단위를 나누는 형식 — DOCX의 줄바꿈은 글쓴이가 넣은 것이고, PDF 블록의 줄바꿈은 폭에 따라 접힌 줄이다
LINE_SPLIT_FORMAT = "docx"
MAX_REPORTED_PROBLEMS = 5  # 커버리지 예외 메시지에 싣는 문제 수 — 나머지는 개수만


def compute_display_id(document: Document, unit: Unit) -> str:
    """화면·결과물용 표시 ID — 문서 번호(없으면 D{문서 id})와 추출 안 순번."""
    return f"{document.doc_code or f'D{document.id}'}-{unit.local_no:03d}"


async def create_initial_units(session: AsyncSession, document: Document, extraction: Extraction) -> None:
    """추출 직후 단위를 만든다(커밋은 부르는 쪽). local_no는 정렬 키 순서로 1부터.

    옛 문서는 단위마다 미배정 판단 행을, 새 문서는 입구 2 새 문장을, 한/영 연달아 배치면 코드 짝(제안)을 함께 만든다.
    10만 블록 문서도 묶음 INSERT로 쓴다.
    """
    block_rows = await session.execute(
        select(
            SourceBlock.id, SourceBlock.seq, SourceBlock.kind, SourceBlock.part, SourceBlock.text,
            SourceBlock.heading_level, SourceBlock.flags, SourceBlock.table_id, SourceBlock.row_index,
        )
        .where(SourceBlock.extraction_id == extraction.id)
        .order_by(SourceBlock.seq)
    )
    table_rows = await session.execute(
        select(SourceTable.id, SourceTable.is_layout).where(SourceTable.extraction_id == extraction.id)
    )
    # 200만 자 쪼개기는 수 초까지 걸린다 — 단일 워커 backend가 묶음 잠금을 쥔 채 이벤트 루프를 막지 않게 스레드에서 돈다
    drafts, unit_rows = await asyncio.to_thread(
        _build_unit_rows, extraction.id, block_rows.all(), table_rows.all(), document.language_layout,
        document.file_format == LINE_SPLIT_FORMAT,
    )
    if not drafts:
        return
    unit_ids = list(await session.scalars(insert(Unit).returning(Unit.id, sort_by_parameter_order=True), unit_rows))
    # 표 단위 id는 INSERT 뒤에야 알므로 칸 문장의 묶음은 한 번 더 쓴다
    groups = [
        {"id": unit_id, "group_unit_id": unit_ids[draft.group_index]}
        for unit_id, draft in zip(unit_ids, drafts, strict=True)
        if draft.group_index is not None
    ]
    if groups:
        await session.execute(update(Unit), groups)
    if document.side == "old":
        await session.execute(
            insert(UnitDecision), [{"unit_id": unit_id, "bundle_id": document.bundle_id} for unit_id in unit_ids]
        )
    else:
        # match → detach → groups → units로 이어지는 순환 import라 여기서 부른다
        from app.sop.match import create_new_doc_targets

        await create_new_doc_targets(session, document)
    if document.language_layout == INTERLEAVED_LAYOUT:
        await _create_code_pairs(session, document.id, extraction.id)


def _build_unit_rows(
    extraction_id: int,
    block_rows: Sequence[Sequence[object]],
    table_rows: Sequence[Sequence[object]],
    layout: str,
    split_lines: bool,
) -> tuple[list[UnitDraft], list[dict[str, object]]]:
    """블록·표 행 → 단위 초안과 INSERT 행(local_no는 1부터) — DB를 쓰지 않는 순수 계산이라 스레드에서 돌린다."""
    blocks = [BlockView(*row) for row in block_rows]
    drafts = build_unit_drafts(blocks, [TableView(*row) for row in table_rows], layout, split_lines=split_lines)
    block_texts = {block.id: block.text for block in blocks}
    rows = [
        {
            "extraction_id": extraction_id, "local_no": local_no, "kind": draft.kind,
            "spans": [list(span) for span in draft.spans], "text": build_unit_text(draft.spans, block_texts),
            "lang": draft.lang, "table_id": draft.table_id, "row_index": draft.row_index,
            "pos_seq": draft.pos_seq, "pos_start": draft.pos_start,
        }
        for local_no, draft in enumerate(drafts, start=1)
    ]
    return drafts, rows


async def refresh_code_pairs(session: AsyncSession, document: Document) -> None:
    """제안 상태의 코드 짝을 지우고 배치가 연달아면 다시 만든다 — 확정 짝(과 다른 출처의 짝)은 두고 그 단위는 다시 짝짓지 않는다."""
    await session.execute(
        delete(UnitPair).where(
            UnitPair.document_id == document.id,
            UnitPair.status == PAIR_SUGGESTED,
            UnitPair.source == PAIR_SOURCE_CODE,
        )
    )
    if document.language_layout != INTERLEAVED_LAYOUT:
        return
    extraction_id = await get_latest_extraction_id(session, document.id)
    if extraction_id is not None:
        await _create_code_pairs(session, document.id, extraction_id)


async def _create_code_pairs(session: AsyncSession, document_id: int, extraction_id: int) -> None:
    """활성 단위 중 표·행에 묶이지 않은 것을 순서대로 이웃 짝짓는다.

    묶인 칸 문장은 표의 판단을 따르고, 넣으면 표 앞뒤 문단과 칸이 엇갈려 짝지어지므로 뺀다. 이미 짝이 있는 단위와 부분(본문·머리말·
    각주…)이 바뀌는 자리에서 순서를 끊는다 — 건너뛰면 그 너머의 단위끼리, 본문 끝 문장과 머리말이 짝지어진다.
    글자 단위의 표(표 밖은 None, 칸 안의 표는 그 표)가 바뀌는 자리에서도 끊는다(R34) — 레이아웃 표의 한/영 두 열은 행마다 짝이고
    표 앞뒤 문단과 섞이지 않는다. 그림·표 단위 같은 중립 단위는 짝을 맺지 않으므로 표 경계로 세지 않는다.
    """
    rows = await session.execute(
        select(Unit.id, Unit.lang, Unit.text, Unit.table_id, SourceBlock.part, UnitPairMember.pair_id)
        # 단위 자리(pos_seq)의 블록이 그 단위의 부분이다
        .join(SourceBlock, (SourceBlock.extraction_id == Unit.extraction_id) & (SourceBlock.seq == Unit.pos_seq))
        .outerjoin(UnitPairMember, UnitPairMember.unit_id == Unit.id)
        .where(Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.group_unit_id.is_(None))
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    segments: list[list[tuple[int, str, str]]] = [[]]
    previous_part = None
    previous_table: int | None = None
    for unit_id, lang, text, table_id, part, pair_id in rows:
        is_table_change = lang != NEUTRAL and table_id != previous_table
        if (pair_id is not None or part != previous_part or is_table_change) and segments[-1]:
            segments.append([])
        if pair_id is None:
            segments[-1].append((unit_id, lang, text))
        previous_part = part
        if lang != NEUTRAL:
            previous_table = table_id
    # 번호·숫자가 없어 두 방향이 같은 수로 잡히는 구간은 문서 전체에서 더 많이 잡힌 순서를 따른다
    totals = [count_pair_directions(segment) for segment in segments]
    ko_en_total, en_ko_total = sum(t[0] for t in totals), sum(t[1] for t in totals)
    preferred = "en_ko" if en_ko_total > ko_en_total else "ko_en"
    await _insert_pairs(
        session, document_id, [pair for segment in segments for pair in suggest_interleaved_pairs(segment, preferred)]
    )


async def _insert_pairs(
    session: AsyncSession, document_id: int, pairs: Sequence[tuple[Sequence[int], Sequence[int]]]
) -> None:
    if not pairs:
        return
    pair_ids = await session.scalars(
        insert(UnitPair).returning(UnitPair.id, sort_by_parameter_order=True),
        [{"document_id": document_id, "status": PAIR_SUGGESTED, "source": PAIR_SOURCE_CODE} for _ in pairs],
    )
    await session.execute(
        insert(UnitPairMember),
        [
            {"pair_id": pair_id, "unit_id": unit_id}
            for pair_id, (left, right) in zip(pair_ids, pairs, strict=True)
            for unit_id in (*left, *right)
        ],
    )


async def get_latest_extraction_id(session: AsyncSession, document_id: int) -> int | None:
    """문서의 가장 새 추출 — 다시 추출하면 이전 추출은 읽기 전용으로 남는다(설계 §6.3)."""
    return await session.scalar(select(func.max(Extraction.id)).where(Extraction.document_id == document_id))


async def verify_document_coverage(session: AsyncSession, document_id: int) -> None:
    """활성 커버 단위가 블록을 겹침 없이 빠짐없이 덮는지 — 어기면 RuntimeError(편집 코드의 버그 가드, 메시지에 원문 없음)."""
    extraction_id = await get_latest_extraction_id(session, document_id)
    if extraction_id is None:
        return
    block_rows = await session.execute(
        select(SourceBlock.id, SourceBlock.text).where(SourceBlock.extraction_id == extraction_id)
    )
    cover_spans = await session.scalars(
        select(Unit.spans)
        .where(Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.kind.in_(COVER_KINDS))
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    problems = find_coverage_problems(dict(block_rows.tuples().all()), list(cover_spans))
    if problems:
        shown = "; ".join(problems[:MAX_REPORTED_PROBLEMS])
        raise RuntimeError(f"coverage check failed for document {document_id}: {len(problems)} problem(s): {shown}")
