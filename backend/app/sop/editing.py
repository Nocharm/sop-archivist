"""쪼개기 편집 — 나누기·합치기·경계 옮기기·골라 만들기·언어 바꾸기와 서버 쪽 선형 되돌리기·다시 하기, 경계 확인 표시 (스펙 §6.4, §7.5).

단위는 제자리에서 바뀌지 않는다: 편집은 옛 단위를 은퇴시키고 새 단위를 만들며, 되돌리기는 은퇴한 단위를 원래 ID로 되살린다.
묶음 잠금·문서 revision·작업 중 검사와 커밋은 부르는 쪽(라우터)이 한다.
"""

from collections import Counter, defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Annotated, Literal, assert_never

from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.decisions import DbId
from app.sop.detach import (
    ORIGIN_NEW_DOC,
    UNASSIGNED,
    DetachReport,
    detach_units,
    find_units_needing_confirm,
    is_unassigned,
)
from app.sop.errors import raise_rule
from app.sop.events import record_event
from app.sop.groups import iter_chunks, select_in_chunks
from app.sop.match import sync_new_doc_targets
from app.sop.models import (
    Document,
    SourceBlock,
    TargetSentence,
    Unit,
    UnitDecision,
    UnitEdit,
    UnitPair,
    UnitPairMember,
)
from app.sop.segment import build_unit_text, detect_language, has_visible_char
from app.sop.spans import (
    Span,
    cut_spans,
    fill_languages,
    join_close_spans,
    locate_text_offset,
    overlaps,
    split_around,
    to_spans,
    trim_span,
)
from app.sop.tobe import MAX_DB_INT
from app.sop.units import UNIT_ACTIVE, get_latest_extraction_id, verify_document_coverage

UNIT_RETIRED = "retired"
EDIT_APPLIED = "applied"
EDIT_UNDONE = "undone"
# 글자 범위를 고칠 수 있는 단위 — 그림·표·행은 범위를 나누거나 잇지 않는다
TEXT_KINDS = ("sentence", "heading", "cell_sentence")
PAIR_LANGS = {"ko", "en"}  # 짝의 두 쪽 — 한쪽이 비면 짝을 지운다
MAX_EDIT_UNITS = 2000  # 합치기·언어 바꾸기·경계 확인이 한 번에 고르는 단위 수 상한

Offset = Annotated[int, Field(ge=0, le=MAX_DB_INT)]
ExtractionId = int | None  # 받지 않았거나 추출에 실패한 문서는 추출이 없다 — 단위·블록 조회가 비어 404가 된다


# --- 요청·응답 ---


class SplitOp(BaseModel):
    type: Literal["split"]
    unit_id: DbId
    # 단위 text 안 위치 — 오른쪽 조각의 첫 글자. 범위 사이 이음 글자(" "·"\n") 위는 안 된다
    at: Offset


class MergeOp(BaseModel):
    type: Literal["merge"]
    unit_ids: list[DbId] = Field(min_length=2, max_length=MAX_EDIT_UNITS)


class MoveBoundaryOp(BaseModel):
    type: Literal["move_boundary"]
    left_unit_id: DbId
    right_unit_id: DbId
    # 왼쪽 단위 마지막 범위와 오른쪽 단위 첫 범위가 함께 있는 블록 안 위치
    at: Offset


class CarveOp(BaseModel):
    type: Literal["carve"]
    block_id: DbId
    # 블록 안 [start, end)
    start: Offset
    end: Offset


class SetLanguageOp(BaseModel):
    type: Literal["set_language"]
    unit_ids: list[DbId] = Field(min_length=1, max_length=MAX_EDIT_UNITS)
    lang: Literal["ko", "en"]


EditOp = Annotated[SplitOp | MergeOp | MoveBoundaryOp | CarveOp | SetLanguageOp, Field(discriminator="type")]


class EditIn(BaseModel):
    revision: int = Field(ge=1)
    # 판단이 걸린 단위를 은퇴시키는 편집의 명시적 확인 — 없으면 409 confirm_required로 화면이 먼저 묻는다
    confirm: bool = False
    op: EditOp


class EditStepIn(BaseModel):
    """되돌리기·다시 하기 요청."""

    revision: int = Field(ge=1)
    confirm: bool = False


class BoundaryIn(BaseModel):
    unit_ids: list[DbId] = Field(min_length=1, max_length=MAX_EDIT_UNITS)
    confirmed: bool


class BoundaryOut(BaseModel):
    unit_ids: list[int]
    confirmed: bool


class EditResult(BaseModel):
    document_revision: int
    # 이 요청으로 활성이 된 단위(되살린 것은 id 순, 새로 만든 것은 원문 순)와 은퇴한 단위(id 순)
    created_unit_ids: list[int]
    retired_unit_ids: list[int]
    # 옛 문서는 은퇴한 단위의 떼어 내기, 새 문서는 새 문장 다시 맞추기 결과 — 은퇴가 없는 옛 문서 편집은 None
    detach: DetachReport | None


# --- 계획 ---


@dataclass(frozen=True)
class _Block:
    seq: int
    text: str
    kind: str


@dataclass
class _Draft:
    """만들 단위 하나 — lang이 ""면 글자로 언어를 알 수 없어 앞 단위 규칙으로 채운다."""

    kind: str
    spans: list[Span]
    text: str
    lang: str
    table_id: int | None
    row_index: int | None
    group_unit_id: int | None
    pos_seq: int
    pos_start: int


@dataclass
class _Change:
    """편집·되돌리기·다시 하기 한 번이 단위 집합에 하는 일 — langs는 단위 → (지금 언어, 바꿀 언어)."""

    retire: list[int] = field(default_factory=list)
    revive: list[int] = field(default_factory=list)
    drafts: list[_Draft] = field(default_factory=list)
    langs: dict[int, tuple[str, str]] = field(default_factory=dict)


def _get_position(unit: Unit) -> tuple[int, int, int]:
    return unit.pos_seq, unit.pos_start, unit.id


def _ensure_unique(unit_ids: Sequence[int]) -> None:
    repeated = sorted(unit_id for unit_id, count in Counter(unit_ids).items() if count > 1)
    if repeated:
        raise_rule(422, "duplicate_units", unit_ids=repeated)


def _ensure_text_kinds(units: Iterable[Unit]) -> None:
    wrong = sorted(unit.id for unit in units if unit.kind not in TEXT_KINDS)
    if wrong:
        raise_rule(422, "invalid_unit_kind", unit_ids=wrong)


async def _load_units(
    session: AsyncSession, extraction_id: ExtractionId, unit_ids: Collection[int]
) -> dict[int, Unit]:
    """문서 최신 추출의 활성 단위 — 아닌 id(다른 문서·은퇴한 단위)가 있으면 404."""
    rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit).where(
            Unit.id.in_(chunk), Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE
        ),
        unit_ids,
    )
    units = {row[0].id: row[0] for row in rows}
    missing = sorted(set(unit_ids) - set(units))
    if missing:
        raise_rule(404, "unit_not_found", unit_ids=missing)
    return units


async def _load_blocks(
    session: AsyncSession, extraction_id: ExtractionId, block_ids: Collection[int]
) -> dict[int, _Block]:
    rows = await select_in_chunks(
        session,
        lambda chunk: select(SourceBlock.id, SourceBlock.seq, SourceBlock.text, SourceBlock.kind).where(
            SourceBlock.id.in_(chunk), SourceBlock.extraction_id == extraction_id
        ),
        block_ids,
    )
    return {block_id: _Block(seq, text, kind) for block_id, seq, text, kind in rows}


async def _load_unit_blocks(
    session: AsyncSession, extraction_id: ExtractionId, units: Iterable[Unit]
) -> dict[int, _Block]:
    return await _load_blocks(session, extraction_id, {span[0] for unit in units for span in unit.spans})


def _build_draft(
    like: Unit, spans: list[Span], blocks: Mapping[int, _Block], *, kind: str | None = None, lang: str | None = None
) -> _Draft:
    """like의 표·행·묶음을 물려받는 새 단위 — 자리는 첫 범위의 블록·시작, 언어는 주지 않으면 글자로 판정한다."""
    text = build_unit_text(spans, _get_texts(blocks))
    return _Draft(
        kind=kind or like.kind, spans=spans, text=text, lang=lang or detect_language(text) or "",
        table_id=like.table_id, row_index=like.row_index, group_unit_id=like.group_unit_id,
        pos_seq=blocks[spans[0][0]].seq, pos_start=spans[0][1],
    )


def _get_texts(blocks: Mapping[int, _Block]) -> dict[int, str]:
    return {block_id: block.text for block_id, block in blocks.items()}


def _decide_merged_kind(units: Iterable[Unit]) -> str:
    """합친 단위의 종류 — 칸 문장끼리면 칸 문장, 아니면 하나라도 문장이면 문장, 모두 제목이면 제목."""
    kinds = {unit.kind for unit in units}
    if "cell_sentence" in kinds:
        return "cell_sentence"
    return "sentence" if "sentence" in kinds else "heading"


async def _plan_split(session: AsyncSession, extraction_id: ExtractionId, op: SplitOp) -> _Change:
    unit = (await _load_units(session, extraction_id, [op.unit_id]))[op.unit_id]
    _ensure_text_kinds([unit])
    spans = to_spans(unit.spans)
    located = locate_text_offset(spans, op.at) if 0 < op.at < len(unit.text) else None
    if located is None:
        raise_rule(422, "invalid_offset", unit_id=unit.id, at=op.at)
    blocks = await _load_unit_blocks(session, extraction_id, [unit])
    left, right = cut_spans(spans, *located, _get_texts(blocks))
    if not left or not right:
        raise_rule(422, "empty_part", unit_id=unit.id)
    return _Change(retire=[unit.id], drafts=[_build_draft(unit, left, blocks), _build_draft(unit, right, blocks)])


async def _plan_merge(session: AsyncSession, extraction_id: ExtractionId, op: MergeOp) -> _Change:
    """결과 범위는 원문 순서로 모으고 같은 블록에서 사이가 빈 글자뿐이면 한 범위로 잇는다. 언어는 합친 단위들의 같은 언어."""
    _ensure_unique(op.unit_ids)
    units = sorted((await _load_units(session, extraction_id, op.unit_ids)).values(), key=_get_position)
    _ensure_text_kinds(units)
    kinds = {unit.kind for unit in units}
    # 칸 문장은 같은 표·행 그룹(또는 모두 그룹 없음)끼리만 — 다른 그룹과 합치면 처분을 따를 곳이 둘이 된다
    if "cell_sentence" in kinds and (kinds != {"cell_sentence"} or len({unit.group_unit_id for unit in units}) > 1):
        raise_rule(422, "cannot_merge", unit_ids=[unit.id for unit in units])
    langs = sorted({unit.lang for unit in units})
    if len(langs) > 1:
        raise_rule(422, "mixed_language", langs=langs)
    blocks = await _load_unit_blocks(session, extraction_id, units)
    spans = sorted(
        (span for unit in units for span in to_spans(unit.spans)), key=lambda span: (blocks[span[0]].seq, span[1])
    )
    draft = _build_draft(
        units[0], join_close_spans(spans, _get_texts(blocks)), blocks, kind=_decide_merged_kind(units), lang=langs[0]
    )
    return _Change(retire=sorted(unit.id for unit in units), drafts=[draft])


async def _plan_move_boundary(session: AsyncSession, extraction_id: ExtractionId, op: MoveBoundaryOp) -> _Change:
    _ensure_unique([op.left_unit_id, op.right_unit_id])
    units = await _load_units(session, extraction_id, [op.left_unit_id, op.right_unit_id])
    left, right = units[op.left_unit_id], units[op.right_unit_id]
    _ensure_text_kinds([left, right])
    left_spans, right_spans = to_spans(left.spans), to_spans(right.spans)
    block_id, left_start, left_end = left_spans[-1]
    right_block_id, right_start, right_end = right_spans[0]
    blocks = await _load_unit_blocks(session, extraction_id, [left, right])
    text = blocks[block_id].text
    # 사이에 보이는 글자가 있으면 그 글자를 덮은 다른 단위가 끼어 있다(커버리지 불변식)
    if right_block_id != block_id or left_end > right_start or has_visible_char(text[left_end:right_start]):
        raise_rule(422, "not_adjacent", unit_ids=[left.id, right.id])
    if not left_start <= op.at <= right_end:
        raise_rule(422, "invalid_offset", at=op.at)
    head, tail = cut_spans([(block_id, left_start, right_end)], 0, op.at, {block_id: text})
    new_left, new_right = [*left_spans[:-1], *head], [*tail, *right_spans[1:]]
    if not new_left or not new_right:
        raise_rule(422, "empty_part", unit_ids=[left.id, right.id])
    return _Change(
        retire=sorted(units), drafts=[_build_draft(left, new_left, blocks), _build_draft(right, new_right, blocks)]
    )


async def _plan_carve(session: AsyncSession, extraction_id: ExtractionId, op: CarveOp) -> _Change:
    """범위와 겹치는 커버 단위(그림 제외)를 은퇴시키고, 범위 앞·뒤 나머지는 단위마다 새 단위로, 범위는 새 단위 하나로."""
    block = (await _load_blocks(session, extraction_id, [op.block_id])).get(op.block_id)
    if block is None:
        raise_rule(404, "block_not_found", block_id=op.block_id)
    if block.kind == "figure":  # 캡션은 그림 단위의 것이라 글자 단위로 떼어 내지 않는다
        raise_rule(422, "invalid_block", block_id=op.block_id)
    if not op.start < op.end <= len(block.text):
        raise_rule(422, "invalid_offset", start=op.start, end=op.end)
    carved = trim_span((op.block_id, op.start, op.end), {op.block_id: block.text})
    if carved is None:
        raise_rule(422, "empty_part", block_id=op.block_id)
    _, start, end = carved
    # 범위가 JSON이라 블록으로 거를 수 없다 — 활성 글자 단위의 범위만 읽어 겹치는 것을 고른다
    rows = await session.execute(
        select(Unit.id, Unit.spans).where(
            Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.kind.in_(TEXT_KINDS)
        )
    )
    hit_ids = [unit_id for unit_id, spans in rows if overlaps(to_spans(spans), op.block_id, start, end)]
    units = sorted((await _load_units(session, extraction_id, hit_ids)).values(), key=_get_position)
    blocks = await _load_unit_blocks(session, extraction_id, units)
    texts, seqs = _get_texts(blocks), {block_id: item.seq for block_id, item in blocks.items()}
    drafts = []
    for unit in units:
        before, after = split_around(to_spans(unit.spans), op.block_id, start, end, texts, seqs)
        drafts.extend(_build_draft(unit, part, blocks) for part in (before, after) if part)
    drafts.append(_build_draft(units[0], [carved], blocks, kind=_decide_merged_kind(units)))
    return _Change(retire=sorted(unit.id for unit in units), drafts=drafts)


async def _plan_set_language(session: AsyncSession, extraction_id: ExtractionId, op: SetLanguageOp) -> _Change:
    _ensure_unique(op.unit_ids)
    units = await _load_units(session, extraction_id, op.unit_ids)
    _ensure_text_kinds(units.values())
    changes = {unit_id: (unit.lang, op.lang) for unit_id, unit in sorted(units.items()) if unit.lang != op.lang}
    return _Change(langs=changes)


async def _plan(session: AsyncSession, extraction_id: ExtractionId, op: EditOp) -> _Change:
    match op:
        case SplitOp():
            return await _plan_split(session, extraction_id, op)
        case MergeOp():
            return await _plan_merge(session, extraction_id, op)
        case MoveBoundaryOp():
            return await _plan_move_boundary(session, extraction_id, op)
        case CarveOp():
            return await _plan_carve(session, extraction_id, op)
        case SetLanguageOp():
            return await _plan_set_language(session, extraction_id, op)
        case _:
            assert_never(op)


# --- 쓰기 ---


async def _find_decided_units(session: AsyncSession, document: Document, unit_ids: Collection[int]) -> list[int]:
    """언어를 바꾸면 사람의 결정과 어긋나는 단위(R31) — 옛 문서는 자기(묶인 칸 문장은 그룹 단위) 판단이 미배정이 아닌 것,
    새 문서는 입구 2 새 문장이 미배정이 아닌 것."""
    if document.side == "new":
        rows = await select_in_chunks(
            session,
            lambda chunk: select(TargetSentence.new_unit_id).where(
                TargetSentence.new_unit_id.in_(chunk), TargetSentence.origin == ORIGIN_NEW_DOC,
                TargetSentence.status != UNASSIGNED,
            ),
            unit_ids,
        )
        return sorted({row[0] for row in rows})
    groups = await select_in_chunks(
        session, lambda chunk: select(Unit.id, Unit.group_unit_id).where(Unit.id.in_(chunk)), unit_ids
    )
    decisions = {
        row[0].unit_id: row[0]
        for row in await select_in_chunks(
            session,
            lambda chunk: select(UnitDecision).where(UnitDecision.unit_id.in_(chunk)),
            {unit_id for row in groups for unit_id in row if unit_id is not None},
        )
    }
    return sorted(
        unit_id for unit_id, group_unit_id in groups
        if any(owner in decisions and not is_unassigned(decisions[owner]) for owner in (unit_id, group_unit_id))
    )


async def _fill_unknown_languages(
    session: AsyncSession, document: Document, extraction_id: ExtractionId, change: _Change
) -> None:
    """글자로 언어를 알 수 없는 새 단위(숫자·기호뿐)는 처음 쪼개기와 같이 앞 단위의 언어를 따른다."""
    if all(draft.lang for draft in change.drafts):
        return
    retiring = set(change.retire)
    rows = await session.execute(
        select(Unit.id, Unit.pos_seq, Unit.pos_start, Unit.lang).where(
            Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE
        )
    )
    entries: list[tuple[tuple[int, int, int, int], str, _Draft | None]] = [
        ((pos_seq, pos_start, 0, unit_id), lang, None)
        for unit_id, pos_seq, pos_start, lang in rows
        if unit_id not in retiring
    ]
    entries += [((draft.pos_seq, draft.pos_start, 1, n), draft.lang, draft) for n, draft in enumerate(change.drafts)]
    entries.sort(key=lambda entry: entry[0])
    default = "en" if document.language_layout == "en_only" else "ko"
    for (_, _, draft), lang in zip(entries, fill_languages([entry[1] for entry in entries], default), strict=True):
        if draft is not None:
            draft.lang = lang


async def _set_status(session: AsyncSession, unit_ids: Collection[int], old: str, new: str) -> None:
    """단위 상태를 old → new로 — 그 상태가 아닌 단위가 있으면 편집 기록과 단위가 어긋난 것이라 RuntimeError(버그 가드)."""
    changed = 0
    for chunk in iter_chunks(unit_ids):
        result = await session.execute(
            update(Unit).where(Unit.id.in_(chunk), Unit.status == old).values(status=new)
        )
        changed += result.rowcount
    if changed != len(set(unit_ids)):
        raise RuntimeError(f"unit edit history out of sync: {changed} of {len(set(unit_ids))} units were {old}")


async def _insert_units(
    session: AsyncSession, document: Document, extraction_id: ExtractionId, drafts: list[_Draft]
) -> list[int]:
    """새 단위를 원문 순서로 local_no 다음 번호부터 만든다 — 옛 문서는 미배정 판단 행도 함께(새 문서는 판단 행이 없다)."""
    if not drafts:
        return []
    last_no = await session.scalar(select(func.max(Unit.local_no)).where(Unit.extraction_id == extraction_id))
    units = [
        Unit(
            extraction_id=extraction_id, local_no=last_no + offset, kind=draft.kind,
            spans=[list(span) for span in draft.spans], text=draft.text, lang=draft.lang, table_id=draft.table_id,
            row_index=draft.row_index, group_unit_id=draft.group_unit_id, pos_seq=draft.pos_seq,
            pos_start=draft.pos_start,
        )
        for offset, draft in enumerate(sorted(drafts, key=lambda draft: (draft.pos_seq, draft.pos_start)), start=1)
    ]
    session.add_all(units)
    await session.flush()
    if document.side == "old":
        session.add_all(UnitDecision(unit_id=unit.id, bundle_id=document.bundle_id) for unit in units)
    return [unit.id for unit in units]


async def _set_languages(session: AsyncSession, langs: Mapping[int, tuple[str, str]]) -> None:
    by_lang: dict[str, list[int]] = defaultdict(list)
    for unit_id, (_, lang) in langs.items():
        by_lang[lang].append(unit_id)
    for lang, unit_ids in by_lang.items():
        for chunk in iter_chunks(unit_ids):
            await session.execute(update(Unit).where(Unit.id.in_(chunk)).values(lang=lang))


async def _leave_pairs(session: AsyncSession, unit_ids: Collection[int]) -> None:
    """은퇴하거나 언어가 바뀐 단위는 한/영 짝에서 빠지고, 남은 짝에 한쪽 언어가 없으면 짝을 지운다.

    되돌리기는 빠진 짝을 되살리지 않는다 — 짝은 단위 집합 기록(unit_edits) 밖의 제안·확인이다.
    """
    pair_ids = {
        row[0]
        for row in await select_in_chunks(
            session, lambda chunk: select(UnitPairMember.pair_id).where(UnitPairMember.unit_id.in_(chunk)), unit_ids
        )
    }
    if not pair_ids:
        return
    for chunk in iter_chunks(unit_ids):
        await session.execute(delete(UnitPairMember).where(UnitPairMember.unit_id.in_(chunk)))
    langs: dict[int, set[str]] = defaultdict(set)
    for pair_id, lang in await select_in_chunks(
        session,
        lambda chunk: select(UnitPairMember.pair_id, Unit.lang)
        .join(Unit, Unit.id == UnitPairMember.unit_id)
        .where(UnitPairMember.pair_id.in_(chunk)),
        pair_ids,
    ):
        langs[pair_id].add(lang)
    for chunk in iter_chunks([pair_id for pair_id in pair_ids if not PAIR_LANGS <= langs[pair_id]]):
        await session.execute(delete(UnitPair).where(UnitPair.id.in_(chunk)))


async def _write_change(
    session: AsyncSession,
    document: Document,
    extraction_id: ExtractionId,
    change: _Change,
    *,
    confirm: bool,
    actor: str,
) -> EditResult:
    """검사(판단 있는 단위의 언어·확인 플래그) → 단위 은퇴·되살리기·만들기·언어 → 짝 정리 → 떼어 내기(옛)·새 문장 맞추기(새)
    → 커버리지 가드 → 문서 revision +1. 편집·되돌리기·다시 하기가 함께 쓴다."""
    if change.langs:
        decided = await _find_decided_units(session, document, change.langs)
        if decided:
            raise_rule(409, "unit_has_decision", unit_ids=decided)
    if change.retire:
        needing = await find_units_needing_confirm(session, change.retire)
        if needing and not confirm:
            raise_rule(409, "confirm_required", unit_ids=needing)
    await _fill_unknown_languages(session, document, extraction_id, change)
    await _set_status(session, change.retire, UNIT_ACTIVE, UNIT_RETIRED)
    await _set_status(session, change.revive, UNIT_RETIRED, UNIT_ACTIVE)
    created = await _insert_units(session, document, extraction_id, change.drafts)
    await _set_languages(session, change.langs)
    await _leave_pairs(session, [*change.retire, *change.langs])
    await session.flush()
    activated = [*change.revive, *created]
    detach = None
    if document.side == "new":
        detach = await sync_new_doc_targets(
            session, document, created_unit_ids=activated, retired_unit_ids=change.retire, actor=actor
        )
    elif change.retire:
        detach = await detach_units(
            session, bundle_id=document.bundle_id, unit_ids=change.retire, cause="retired", actor=actor
        )
    await session.flush()
    await verify_document_coverage(session, document.id)
    document.revision += 1
    return EditResult(
        document_revision=document.revision, created_unit_ids=activated, retired_unit_ids=sorted(change.retire),
        detach=detach,
    )


def _record(
    session: AsyncSession, document: Document, action: str, op: str, result: EditResult, change: _Change, actor: str
) -> None:
    """작업 기록 — 대상은 은퇴한·활성이 된·언어가 바뀐 단위, 사유 칸에 편집 종류(split 등)."""
    unit_ids = sorted({*result.created_unit_ids, *result.retired_unit_ids, *change.langs})
    record_event(
        session, bundle_id=document.bundle_id, actor=actor, action=action, target_type="unit", target_ids=unit_ids,
        reason=op,
    )


async def apply_edit(
    session: AsyncSession, document: Document, op: EditOp, *, confirm: bool, actor: str
) -> EditResult:
    """편집 하나를 적용하고 기록한다 — 새 편집은 다시 하기 기록(undone)을 지운다. 바뀌는 게 없는 언어 바꾸기는 기록하지 않는다."""
    extraction_id = await get_latest_extraction_id(session, document.id)
    change = await _plan(session, extraction_id, op)
    if not (change.retire or change.drafts or change.langs):
        return EditResult(document_revision=document.revision, created_unit_ids=[], retired_unit_ids=[], detach=None)
    result = await _write_change(session, document, extraction_id, change, confirm=confirm, actor=actor)
    await session.execute(
        delete(UnitEdit).where(UnitEdit.document_id == document.id, UnitEdit.state == EDIT_UNDONE)
    )
    last_seq = await session.scalar(select(func.max(UnitEdit.seq)).where(UnitEdit.document_id == document.id))
    session.add(
        UnitEdit(
            document_id=document.id, seq=(last_seq or 0) + 1, op=op.type, payload=op.model_dump(),
            created_unit_ids=result.created_unit_ids, retired_unit_ids=result.retired_unit_ids,
            lang_changes={str(unit_id): list(langs) for unit_id, langs in change.langs.items()}, actor=actor,
        )
    )
    _record(session, document, "unit.edit", op.type, result, change, actor)
    await session.flush()
    return result


async def undo_edit(session: AsyncSession, document: Document, *, confirm: bool, actor: str) -> EditResult:
    """마지막 적용 편집을 거꾸로 — 만든 단위를 은퇴시키고 은퇴시킨 단위를 원래 ID로 되살린다(되살린 단위의 판단은 미배정)."""
    edit = await session.scalar(
        select(UnitEdit)
        .where(UnitEdit.document_id == document.id, UnitEdit.state == EDIT_APPLIED)
        .order_by(UnitEdit.seq.desc())
        .limit(1)
    )
    if edit is None:
        raise_rule(409, "nothing_to_undo")
    change = _Change(
        retire=list(edit.created_unit_ids), revive=list(edit.retired_unit_ids),
        langs={int(unit_id): (new, old) for unit_id, (old, new) in edit.lang_changes.items()},
    )
    result = await _write_change(
        session, document, await get_latest_extraction_id(session, document.id), change, confirm=confirm, actor=actor
    )
    edit.state = EDIT_UNDONE
    _record(session, document, "unit.undo", edit.op, result, change, actor)
    await session.flush()
    return result


async def redo_edit(session: AsyncSession, document: Document, *, confirm: bool, actor: str) -> EditResult:
    """가장 최근에 되돌린 편집을 같은 단위 ID로 다시 적용한다."""
    edit = await session.scalar(
        select(UnitEdit)
        .where(UnitEdit.document_id == document.id, UnitEdit.state == EDIT_UNDONE)
        .order_by(UnitEdit.seq)
        .limit(1)
    )
    if edit is None:
        raise_rule(409, "nothing_to_redo")
    change = _Change(
        retire=list(edit.retired_unit_ids), revive=list(edit.created_unit_ids),
        langs={int(unit_id): (old, new) for unit_id, (old, new) in edit.lang_changes.items()},
    )
    result = await _write_change(
        session, document, await get_latest_extraction_id(session, document.id), change, confirm=confirm, actor=actor
    )
    edit.state = EDIT_APPLIED
    _record(session, document, "unit.redo", edit.op, result, change, actor)
    await session.flush()
    return result


async def set_boundary_confirmed(
    session: AsyncSession, document: Document, unit_ids: Sequence[int], confirmed: bool
) -> list[int]:
    """경계 확인 표시를 켜거나 끈다 — 단위 집합은 그대로라 문서 revision·편집 기록과 무관하다."""
    _ensure_unique(unit_ids)
    units = await _load_units(session, await get_latest_extraction_id(session, document.id), unit_ids)
    for unit in units.values():
        unit.boundary_confirmed = confirmed
    await session.flush()
    return sorted(units)
