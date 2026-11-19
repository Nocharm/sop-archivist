"""단위 서비스 — 추출 블록을 규칙으로 쪼개 단위·판단 행·코드 짝을 쓰고, 언어 배치가 바뀌면 짝을 다시 제안하고, 커버리지를 지킨다."""

import asyncio
from collections.abc import Sequence

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import COVER_KINDS
from app.sop.counterparts import (
    TableFacts,
    build_row_pairs,
    build_table_facts,
    count_table_langs,
    match_unwrapped_tables,
)
from app.sop.coverage import find_coverage_problems
from app.sop.models import (
    Document,
    Extraction,
    ExtractionWarning,
    SourceBlock,
    SourceTable,
    Unit,
    UnitDecision,
    UnitPair,
    UnitPairMember,
)
from app.sop.numbering import (
    NUMBER_PAIR,
    ClauseLine,
    build_number_columns,
    find_inherited_numbers,
    read_draft_number,
)
from app.sop.segment import (
    NEUTRAL,
    BlockView,
    TableView,
    UnitDraft,
    build_unit_drafts,
    build_unit_text,
    count_pair_directions,
    is_band_table,
    is_certain_band,
    suggest_interleaved_pairs,
)

UNIT_ACTIVE = "active"
PAIR_SUGGESTED = "suggested"
PAIR_SOURCE_CODE = "code"
INTERLEAVED_LAYOUT = "ko_en_interleaved"
SEPARATE_LAYOUT = "ko_en_separate"
# 행 수가 달라 한/영 짝을 세우지 않은 대응 표(F8a) — 추출 경고 종류(확인 없이 보이기만, 검토 요청을 막지 않는다)
PAIR_ROWS_DIFFER = "pair_rows_differ"
ROWS_WARNING_KEYS = ("ko_table", "en_table", "ko_rows", "en_rows")  # 그 경고의 detail 칸 — 표 번호(1부터)와 행 수
# 블록 안 줄바꿈에서도 단위를 나누는 형식 — DOCX의 줄바꿈은 글쓴이가 넣은 것이고, PDF 블록의 줄바꿈은 폭에 따라 접힌 줄이다
LINE_SPLIT_FORMAT = "docx"
MAX_REPORTED_PROBLEMS = 5  # 커버리지 예외 메시지에 싣는 문제 수 — 나머지는 개수만


def compute_display_id(document: Document, unit: Unit) -> str:
    """화면·결과물용 표시 ID — 문서 번호(없으면 D{문서 id})와 추출 안 순번."""
    return format_display_id(document.doc_code, document.id, unit.local_no)


def format_display_id(doc_code: str | None, doc_id: int, local_no: int) -> str:
    """compute_display_id의 꼴을 값으로 — ORM 객체 없이 열만 읽는 질의(참조 지도의 줄 문장)가 같은 꼴을 쓴다."""
    return f"{doc_code or f'D{doc_id}'}-{local_no:03d}"


async def create_initial_units(session: AsyncSession, document: Document, extraction: Extraction) -> None:
    """추출 직후 단위를 만든다(커밋은 부르는 쪽). local_no는 정렬 키 순서로 1부터.

    옛 문서는 단위마다 미배정 판단 행을, 새 문서는 입구 2 새 문장을, 한/영 연달아 배치면 코드 짝(제안)을 함께 만든다.
    10만 블록 문서도 묶음 INSERT로 쓴다.
    """
    block_rows = await session.execute(
        select(
            SourceBlock.id, SourceBlock.seq, SourceBlock.kind, SourceBlock.part, SourceBlock.text,
            SourceBlock.heading_level, SourceBlock.flags, SourceBlock.table_id, SourceBlock.row_index,
            SourceBlock.signals,
        )
        .where(SourceBlock.extraction_id == extraction.id)
        .order_by(SourceBlock.seq)
    )
    tables = (
        await session.execute(
            select(
                SourceTable.id, SourceTable.is_layout, SourceTable.signals, SourceTable.parent_table_id, SourceTable.part
            ).where(SourceTable.extraction_id == extraction.id)
        )
    ).all()
    # 꼴이 확실한 띠 표는 올리자마자 벗긴 표(레이아웃)로 둔다 — 제목 줄이 되고, "표로 되돌리기"(set_layout_table)가 반대 길이다
    # (F4 · §11-1). 띠 표는 표형 옛 SOP의 절 제목 표라 옛 문서만 본다
    bands = (
        {table_id for table_id, _, signals, parent, part in tables if is_certain_band(signals, parent, part)}
        if document.side == "old" else set()
    )
    if bands:
        await session.execute(update(SourceTable).where(SourceTable.id.in_(bands)).values(is_layout=True))
    table_rows = [
        (table_id, is_layout or table_id in bands, is_band_table(signals)) for table_id, is_layout, signals, _, _ in tables
    ]
    # 200만 자 쪼개기는 수 초까지 걸린다 — 단일 워커 backend가 묶음 잠금을 쥔 채 이벤트 루프를 막지 않게 스레드에서 돈다
    drafts, unit_rows = await asyncio.to_thread(
        _build_unit_rows, extraction.id, block_rows.all(), table_rows, document.language_layout,
        document.file_format == LINE_SPLIT_FORMAT, document.side == "old",
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
        # 옛 문서의 표·그림 참조를 잇는다 — caption_refs → units 순환 import라 여기서 부른다
        from app.sop.caption_refs import detect_caption_refs

        await detect_caption_refs(session, extraction.id)
    else:
        # match → detach → groups → units로 이어지는 순환 import라 여기서 부른다
        from app.sop.match import create_new_doc_targets

        await create_new_doc_targets(session, document)
    if document.language_layout == INTERLEAVED_LAYOUT:
        # 막 만든 단위는 모두 미배정이라 운명을 볼 것이 없다
        await _insert_pairs(session, document.id, await _find_code_pairs(session, extraction.id))


def _build_unit_rows(
    extraction_id: int,
    block_rows: Sequence[Sequence[object]],
    table_rows: Sequence[Sequence[object]],
    layout: str,
    split_lines: bool,
    shift_headings: bool = False,
) -> tuple[list[UnitDraft], list[dict[str, object]]]:
    """블록·표 행 → 단위 초안과 INSERT 행(local_no는 1부터) — DB를 쓰지 않는 순수 계산이라 스레드에서 돌린다.

    shift_headings(옛 문서)면 제목답지 않은 제목 줄을 문장으로 바꾸고(F8b), 번호 없는 번역 조항의 첫 문장이 앞 조항의 번호를 물려받는다.
    """
    blocks = [BlockView(*row) for row in block_rows]
    drafts = build_unit_drafts(
        blocks, [TableView(*row) for row in table_rows], layout, split_lines=split_lines, shift_headings=shift_headings
    )
    block_texts = {block.id: block.text for block in blocks}
    signals = {block.id: block.signals for block in blocks if block.signals}
    rows = [
        {
            "extraction_id": extraction_id, "local_no": local_no, "kind": draft.kind,
            "spans": [list(span) for span in draft.spans], "text": build_unit_text(draft.spans, block_texts),
            "lang": draft.lang, "table_id": draft.table_id, "row_index": draft.row_index,
            "pos_seq": draft.pos_seq, "pos_start": draft.pos_start, "noise_kind": draft.noise_kind,
            "from_heading": draft.from_heading,
            # 목차 줄은 번호 칸이 없다 — 줄 앞 번호도 목차 글이다
            **build_number_columns(draft.kind if draft.noise_kind is None else "", draft.spans, signals, block_texts),
        }
        for local_no, draft in enumerate(drafts, start=1)
    ]
    lines = [
        ClauseLine(
            draft.pos_seq, draft.lang, draft.kind, draft.from_heading,
            read_draft_number(draft.kind, draft.from_heading, row) if draft.noise_kind is None else None,
        )
        for draft, row in zip(drafts, rows, strict=True)
    ]
    for index, number in find_inherited_numbers(lines).items():
        rows[index].update(number_read=number, number_source=NUMBER_PAIR, number_len=0)
    return drafts, rows


async def refresh_code_pairs(
    session: AsyncSession, document: Document, actor: str
) -> None:
    """제안 상태의 코드 짝을 지우고 다시 만든다 — 확정 짝(과 다른 출처의 짝)은 두고 그 단위는 다시 짝짓지 않는다.

    연달아 배치는 이웃 짝, 따로 배치는 둘 다 벗긴 대응 표의 같은 행 · 같은 순서 짝(F8a, _find_table_pairs)이다. 이미 판단한 단위가 있으니 서로 다른 곳으로 보낸 단위끼리는 짝짓지 않고, 만든 짝은 settle_pairs에 넘겨 모두 같은
    곳으로 확정된 짝은 바로 확정한다(한 줄의 처분은 하나다, pair_settle). 행 수가 달라 짝을 세우지 않은 대응 표는 추출 경고
    (pair_rows_differ)로 남긴다.
    """
    # pair_settle → units로 이어지는 순환 import라 여기서 부른다
    from app.sop.pair_settle import has_diverging_fates, load_decided_fates, settle_pairs

    await session.execute(
        delete(UnitPair).where(
            UnitPair.document_id == document.id,
            UnitPair.status == PAIR_SUGGESTED,
            UnitPair.source == PAIR_SOURCE_CODE,
        )
    )
    extraction_id = await get_latest_extraction_id(session, document.id)
    if extraction_id is None:
        return
    differ: list[tuple[int, int]] = []
    if document.language_layout == INTERLEAVED_LAYOUT:
        pairs = await _find_code_pairs(session, extraction_id)
    elif document.language_layout == SEPARATE_LAYOUT:
        pairs, differ = await _find_table_pairs(session, extraction_id)
    else:
        pairs = []
    await _sync_rows_warnings(session, extraction_id, differ)
    if not pairs:
        return
    unit_ids = [unit_id for left, right in pairs for unit_id in (*left, *right)]
    fates = await load_decided_fates(session, unit_ids)
    await _insert_pairs(
        session, document.id, [(left, right) for left, right in pairs if not has_diverging_fates(fates, [*left, *right])]
    )
    await settle_pairs(session, document.bundle_id, unit_ids, actor)


async def load_table_facts(session: AsyncSession, extraction_id: int) -> list[TableFacts]:
    """추출의 원문 표와 표마다 칸 줄 언어 수 → 대응 표 판정의 표 사실(표 순번 순)."""
    tables = (
        await session.execute(
            select(
                SourceTable.id, SourceTable.table_index, SourceTable.parent_table_id, SourceTable.part,
                SourceTable.n_rows, SourceTable.n_cols, SourceTable.is_layout, SourceTable.signals,
            ).where(SourceTable.extraction_id == extraction_id)
        )
    ).all()
    langs = await session.execute(
        select(Unit.table_id, Unit.lang).where(
            Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.table_id.is_not(None)
        )
    )
    return build_table_facts(tables, count_table_langs(langs.tuples().all()))


async def _find_table_pairs(
    session: AsyncSession, extraction_id: int
) -> tuple[list[tuple[list[int], list[int]]], list[tuple[int, int]]]:
    """한/영 따로 문서의 둘 다 벗긴 대응 표에서 같은 행 · 같은 순서의 칸 줄 짝과, 행 수가 달라 짝을 세우지 않은 대응 표.

    벗긴 한글 표는 같은 꼴인 가장 비슷한 벗긴 영어 표와 맺는다(counterparts.match_unwrapped_tables). 칸 줄은 표의 언어인 묶이지 않은 칸 문장 가운데 이미 짝(확정 · 사람 · AI)에
    들지 않고 목차 표시가 없는 것이다 — 확정한 짝 하나가 그 행의 다른 줄 제안을 막지 않게 줄만 뺀다.
    """
    facts = await load_table_facts(session, extraction_id)
    layout = {table.id: table for table in facts if table.is_layout}
    if len(layout) < 2:
        return [], []
    matches = match_unwrapped_tables(facts)
    if not matches:
        return [], []
    matched = {table_id for match in matches for table_id in match}
    rows = await session.execute(
        select(Unit.id, Unit.table_id, Unit.row_index, Unit.lang, UnitPairMember.pair_id, Unit.noise_kind)
        .outerjoin(UnitPairMember, UnitPairMember.unit_id == Unit.id)
        .where(
            Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.group_unit_id.is_(None),
            Unit.kind == "cell_sentence", Unit.table_id.in_(matched),
        )
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    lines: dict[int, dict[int, list[int]]] = {table_id: {} for table_id in matched}
    for unit_id, table_id, row_index, lang, pair_id, noise_kind in rows:
        if pair_id is None and noise_kind is None and lang == layout[table_id].lang:
            lines[table_id].setdefault(row_index, []).append(unit_id)
    pairs: list[tuple[list[int], list[int]]] = []
    differ: list[tuple[int, int]] = []
    for korean, english in matches:
        if layout[korean].n_rows != layout[english].n_rows:
            differ.append((korean, english))
        else:
            pairs.extend(build_row_pairs(lines[korean], lines[english]))
    return pairs, differ


async def _sync_rows_warnings(session: AsyncSession, extraction_id: int, differ: Sequence[tuple[int, int]]) -> None:
    """행 수가 다른 대응 표를 추출 경고(확인 없이 보이기만)로 맞춘다 — 그대로인 경고는 두고, 풀리거나 다시 묶인 표의 것은 지운다.

    경고 칸은 표 번호(문서 안 표 순번, 1부터)와 행 수이고 자리는 한글 표의 첫 칸 블록이다.
    """
    existing = list(
        await session.scalars(
            select(ExtractionWarning).where(
                ExtractionWarning.extraction_id == extraction_id, ExtractionWarning.kind == PAIR_ROWS_DIFFER
            )
        )
    )
    if not differ and not existing:
        return
    tables = {
        table_id: (index, n_rows)
        for table_id, index, n_rows in await session.execute(
            select(SourceTable.id, SourceTable.table_index, SourceTable.n_rows).where(
                SourceTable.id.in_({table_id for pair in differ for table_id in pair})
            )
        )
    }
    wanted = {
        (str(tables[korean][0] + 1), str(tables[english][0] + 1), str(tables[korean][1]), str(tables[english][1])): korean
        for korean, english in differ
    }
    kept: set[tuple[str, ...]] = set()
    for warning in existing:
        key = tuple(str(warning.detail.get(name, "")) for name in ROWS_WARNING_KEYS)
        if key in wanted:
            kept.add(key)
        else:
            await session.delete(warning)
    for key, korean in wanted.items():
        if key in kept:
            continue
        first_cell = await session.scalar(
            select(SourceBlock.id).where(SourceBlock.table_id == korean).order_by(SourceBlock.seq).limit(1)
        )
        session.add(
            ExtractionWarning(
                extraction_id=extraction_id, kind=PAIR_ROWS_DIFFER, block_id=first_cell, needs_ack=False,
                detail=dict(zip(ROWS_WARNING_KEYS, key, strict=True)),
            )
        )


async def _find_code_pairs(session: AsyncSession, extraction_id: int) -> list[tuple[list[int], list[int]]]:
    """활성 단위 중 표·행에 묶이지 않은 것을 순서대로 이웃 짝지을 쌍을 고른다 — 쓰기는 부르는 쪽이 한다.

    묶인 칸 문장은 표의 판단을 따르고, 넣으면 표 앞뒤 문단과 칸이 엇갈려 짝지어지므로 뺀다. 이미 짝이 있는 단위와 부분(본문·머리말·
    각주…)이 바뀌는 자리에서 순서를 끊는다 — 건너뛰면 그 너머의 단위끼리, 본문 끝 문장과 머리말이 짝지어진다.
    글자 단위의 표(표 밖은 None, 칸 안의 표는 그 표)가 바뀌는 자리에서도 끊는다(R34) — 레이아웃 표의 한/영 두 열은 행마다 짝이고
    표 앞뒤 문단과 섞이지 않는다. 그림·표 단위 같은 중립 단위는 짝을 맺지 않으므로 표 경계로 세지 않는다.
    잡음 표시가 붙은 단위(목차 줄)는 짝을 맺지 않고 짝이 있는 단위처럼 순서를 끊는다 — 한글 목차와 영어 목차가 짝지어지지 않게.
    """
    rows = await session.execute(
        select(
            Unit.id, Unit.lang, Unit.text, Unit.table_id, SourceBlock.part, UnitPairMember.pair_id, Unit.noise_kind,
            Unit.from_heading, Unit.pos_seq,
        )
        # 단위 자리(pos_seq)의 블록이 그 단위의 부분이다
        .join(SourceBlock, (SourceBlock.extraction_id == Unit.extraction_id) & (SourceBlock.seq == Unit.pos_seq))
        .outerjoin(UnitPairMember, UnitPairMember.unit_id == Unit.id)
        .where(Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.group_unit_id.is_(None))
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    segments: list[list[tuple[int, str, str]]] = [[]]
    # 제목에서 바꾼 조항의 문장 → 조항 블록 — 조항마다 덩어리가 되어 문장 수가 같은 한/영 조항은 문장마다 1:1 짝이다(F8b)
    clauses: dict[int, int] = {}
    previous_part = None
    previous_table: int | None = None
    for unit_id, lang, text, table_id, part, pair_id, noise_kind, from_heading, pos_seq in rows:
        if from_heading:
            clauses[unit_id] = pos_seq
        is_table_change = lang != NEUTRAL and table_id != previous_table
        is_closed = pair_id is not None or noise_kind is not None
        if (is_closed or part != previous_part or is_table_change) and segments[-1]:
            segments.append([])
        if not is_closed:
            segments[-1].append((unit_id, lang, text))
        previous_part = part
        if lang != NEUTRAL:
            previous_table = table_id
    # 번호·숫자가 없어 두 방향이 같은 수로 잡히는 구간은 문서 전체에서 더 많이 잡힌 순서를 따른다
    totals = [count_pair_directions(segment, clauses) for segment in segments]
    ko_en_total, en_ko_total = sum(t[0] for t in totals), sum(t[1] for t in totals)
    preferred = "en_ko" if en_ko_total > ko_en_total else "ko_en"
    return [pair for segment in segments for pair in suggest_interleaved_pairs(segment, preferred, clauses)]


async def pair_new_units(session: AsyncSession, document: Document, unit_ids: Sequence[int], actor: str) -> None:
    """막 활성이 된 단위(제목 ↔ 문장 편집과 그 되돌리기)가 든 코드 짝만 새로 제안한다 — 다른 줄의 짝·사람이 푼 짝은 건드리지 않는다.

    은퇴한 단위는 편집 쓰기 길이 이미 짝에서 뺐다(editing._leave_pairs). 판단이 서로 다른 곳으로 간 단위끼리는 짝짓지 않는다.
    """
    # pair_settle → units로 이어지는 순환 import라 여기서 부른다
    from app.sop.pair_settle import has_diverging_fates, load_decided_fates, settle_pairs

    if document.language_layout != INTERLEAVED_LAYOUT or not unit_ids:
        return
    extraction_id = await get_latest_extraction_id(session, document.id)
    if extraction_id is None:
        return
    touched = set(unit_ids)
    pairs = [(left, right) for left, right in await _find_code_pairs(session, extraction_id) if touched & {*left, *right}]
    paired_ids = [unit_id for left, right in pairs for unit_id in (*left, *right)]
    fates = await load_decided_fates(session, paired_ids)
    await _insert_pairs(
        session, document.id, [(left, right) for left, right in pairs if not has_diverging_fates(fates, [*left, *right])]
    )
    await settle_pairs(session, document.bundle_id, paired_ids, actor)


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
