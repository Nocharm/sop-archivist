"""표·그림 참조 연결 — 올릴 때 원문 글의 "표 3"·"아래 표"를 대상 표·그림 묶음에 잇고, 사람이 다시 잇거나 뗀다."""

from bisect import bisect_left, bisect_right
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, model_validator
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.captions import CAPTION_KIND
from app.sop.decisions import DbId
from app.sop.errors import raise_rule
from app.sop.events import record_event
from app.sop.groups import BUNDLE_UNIT_KINDS, TABLE_UNIT_KINDS
from app.sop.models import Bundle, CaptionRef, Document, SourceBlock, Unit
from app.sop.renumber import find_number_tokens, find_place_tokens, read_caption_number
from app.sop.units import UNIT_ACTIVE, get_latest_extraction_id

REF_TEXT_KINDS = ("sentence", "heading", "cell_sentence", CAPTION_KIND)
REF_LINKED, REF_DETACHED = "linked", "detached"
ORIGIN_AUTO, ORIGIN_HUMAN = "auto", "human"
_FIGURE_KIND = "figure"
_TABLE_KIND = "table"


class CaptionRefIn(BaseModel):
    """고칠 값 — state만 주면 잇기·떼기, target_unit_id를 주면 그 묶음에 다시 잇는다(state를 비우면 linked)."""

    revision: int
    state: Literal["linked", "detached"] | None = None
    target_unit_id: DbId | None = None

    @model_validator(mode="after")
    def _require_a_change(self) -> "CaptionRefIn":
        if self.state is None and self.target_unit_id is None:
            raise ValueError("state or target_unit_id is required")
        return self


class CaptionRefOut(BaseModel):
    id: int
    kind: str
    number: int | None
    target_unit_id: int | None
    state: str
    origin: str


class CaptionRefResult(BaseModel):
    document_revision: int
    ref: CaptionRefOut


@dataclass(frozen=True)
class RefDraft:
    block_id: int
    start: int
    end: int
    kind: str
    number: int | None
    target_table_id: int | None
    target_block_id: int | None


@dataclass(frozen=True)
class _Target:
    table_id: int | None
    block_id: int | None


def _get_group_target(group: Unit, block_id_by_seq: Mapping[int, int]) -> _Target | None:
    """묶음 단위가 가리키는 대상 — 표(행)는 표 id, 그림은 그림 블록 id."""
    if group.kind in TABLE_UNIT_KINDS and group.table_id is not None:
        return _Target(group.table_id, None)
    if group.kind == _FIGURE_KIND and group.pos_seq in block_id_by_seq:
        return _Target(None, block_id_by_seq[group.pos_seq])
    return None


def build_ref_drafts(blocks: Mapping[int, tuple[int, str]], units: Iterable[Unit]) -> list[RefDraft]:
    """활성 단위의 범위 글자에서 번호·자리 참조를 찾아 대상과 함께 돌려준다 — DB를 쓰지 않는 순수 계산.

    blocks는 블록 id → (seq, 글). 번호 참조는 같은 (종류, 번호) 캡션 단위가 정확히 하나일 때만 그 묶음에 잇고,
    없거나 둘 이상이면 대상 없이 연결만 남긴다(경고는 결과물 쪽). 캡션 단위 자기 머리 번호와 같은 번호 표기는 참조가 아니다.
    """
    active = [unit for unit in units if unit.status == UNIT_ACTIVE]
    by_id = {unit.id: unit for unit in active}
    block_id_by_seq = {seq: block_id for block_id, (seq, _) in blocks.items()}
    captions: dict[tuple[str, int], list[Unit]] = defaultdict(list)
    for unit in active:
        head = read_caption_number(unit.text) if unit.kind == CAPTION_KIND else None
        if head is not None:
            captions[(head.kind, head.number)].append(unit)
    # 자리 참조의 대상 — 종류마다 (pos_seq, pos_start) 순으로 늘어놓은 묶음
    groups: dict[str, list[Unit]] = {_TABLE_KIND: [], _FIGURE_KIND: []}
    for unit in active:
        if unit.kind in groups:
            groups[unit.kind].append(unit)
    keys: dict[str, list[tuple[int, int]]] = {}
    for kind, members in groups.items():
        members.sort(key=lambda unit: (unit.pos_seq, unit.pos_start, unit.id))
        keys[kind] = [(unit.pos_seq, unit.pos_start) for unit in members]

    drafts: list[RefDraft] = []
    for unit in active:
        if unit.kind not in REF_TEXT_KINDS:
            continue
        head = read_caption_number(unit.text) if unit.kind == CAPTION_KIND else None
        for block_id, span_start, span_end in unit.spans:
            seq, block_text = blocks[block_id]
            text = block_text[span_start:span_end]
            for token in find_number_tokens(text):
                if head is not None and (token.kind, token.number) == (head.kind, head.number):
                    continue
                target = _find_numbered_target(captions.get((token.kind, token.number), ()), by_id, block_id_by_seq)
                drafts.append(RefDraft(
                    block_id, span_start + token.start, span_start + token.end, token.kind, token.number,
                    target.table_id if target else None, target.block_id if target else None,
                ))
            for place in find_place_tokens(text):
                position = (seq, span_start + place.start)
                members, member_keys = groups[place.kind], keys[place.kind]
                index = (bisect_right(member_keys, position) if place.direction == "next"
                         else bisect_left(member_keys, position) - 1)
                target = _get_group_target(members[index], block_id_by_seq) if 0 <= index < len(members) else None
                drafts.append(RefDraft(
                    block_id, span_start + place.start, span_start + place.end, place.kind, None,
                    target.table_id if target else None, target.block_id if target else None,
                ))
    return drafts


def _find_numbered_target(
    captions: Sequence[Unit], by_id: Mapping[int, Unit], block_id_by_seq: Mapping[int, int]
) -> _Target | None:
    """같은 (종류, 번호) 캡션이 달린 묶음이 정확히 하나일 때만 그 묶음 — 언어마다 캡션이 따로여도 묶음은 하나다."""
    group_ids = {caption.group_unit_id for caption in captions if caption.group_unit_id in by_id}
    if len(group_ids) != 1:
        return None
    return _get_group_target(by_id[group_ids.pop()], block_id_by_seq)


async def detect_caption_refs(session: AsyncSession, extraction_id: int) -> int:
    """추출 하나의 참조를 찾아 쓴다(커밋은 부르는 쪽) — 쓴 줄 수."""
    block_rows = await session.execute(
        select(SourceBlock.id, SourceBlock.seq, SourceBlock.text).where(SourceBlock.extraction_id == extraction_id)
    )
    blocks = {block_id: (seq, text) for block_id, seq, text in block_rows}
    units = (await session.scalars(
        select(Unit).where(Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE)
    )).all()
    drafts = build_ref_drafts(blocks, units)
    if drafts:
        await session.execute(insert(CaptionRef), [
            {
                "extraction_id": extraction_id, "block_id": draft.block_id, "start": draft.start, "end": draft.end,
                "kind": draft.kind, "number": draft.number, "target_table_id": draft.target_table_id,
                "target_block_id": draft.target_block_id, "state": REF_LINKED, "origin": ORIGIN_AUTO,
            }
            for draft in drafts
        ])
    return len(drafts)


async def _load_block_seqs(session: AsyncSession, block_ids: Iterable[int]) -> dict[int, int]:
    ids = sorted(set(block_ids))
    if not ids:
        return {}
    return dict((await session.execute(select(SourceBlock.id, SourceBlock.seq).where(SourceBlock.id.in_(ids)))).all())


def _pick_target_unit(refs_target: tuple[int | None, int | None], bundles: Sequence[Unit], seq_of: Mapping[int, int]) -> int | None:
    """대상 표·그림 블록에 해당하는 활성 묶음 단위 — 표는 표 단위(행으로 나눴으면 가장 작은 행), 그림은 그 블록의 그림 단위."""
    table_id, block_id = refs_target
    if table_id is not None:
        tables = [unit for unit in bundles if unit.kind == _TABLE_KIND and unit.table_id == table_id]
        if tables:
            return tables[0].id
        rows = sorted(
            (unit for unit in bundles if unit.kind == "table_row" and unit.table_id == table_id),
            key=lambda unit: (unit.row_index if unit.row_index is not None else 0, unit.id),
        )
        return rows[0].id if rows else None
    if block_id is not None and block_id in seq_of:
        figures = [unit for unit in bundles if unit.kind == _FIGURE_KIND and unit.pos_seq == seq_of[block_id]]
        return figures[0].id if figures else None
    return None


async def build_caption_ref_outs(
    session: AsyncSession, refs: Sequence[CaptionRef], units: Iterable[Unit]
) -> list[CaptionRefOut]:
    """참조 행들의 응답 — 대상은 지금 활성인 묶음 단위 id로 푼다. units는 그 추출의 활성 단위(묶음 종류만 쓴다)."""
    bundles = [unit for unit in units if unit.kind in BUNDLE_UNIT_KINDS and unit.status == UNIT_ACTIVE]
    seq_of = await _load_block_seqs(session, (ref.target_block_id for ref in refs if ref.target_block_id is not None))
    return [
        CaptionRefOut(
            id=ref.id, kind=ref.kind, number=ref.number,
            target_unit_id=_pick_target_unit((ref.target_table_id, ref.target_block_id), bundles, seq_of),
            state=ref.state, origin=ref.origin,
        )
        for ref in refs
    ]


def find_covering_unit_ids(refs: Sequence[CaptionRef], units: Iterable[Unit]) -> dict[int, int]:
    """참조 id → 그 자리(시작 글자)를 덮는 활성 글 단위 id — 나누기·합치기 뒤에도 참조 문장을 따라간다. 캡션 자기 머리 번호 참조는 뺀다."""
    units_list = list(units)
    spans: dict[int, list[tuple[int, int, int]]] = defaultdict(list)
    for unit in units_list:
        if unit.status == UNIT_ACTIVE and unit.kind in REF_TEXT_KINDS:
            for block_id, start, end in unit.spans:
                spans[block_id].append((start, end, unit.id))
    heads = {
        unit.id: read_caption_number(unit.text)
        for unit in units_list if unit.kind == CAPTION_KIND and unit.status == UNIT_ACTIVE
    }
    covering: dict[int, int] = {}
    for ref in refs:
        for start, end, unit_id in spans.get(ref.block_id, ()):
            if start <= ref.start < end:
                head = heads.get(unit_id)
                # 올린 뒤 캡션이 된 문장의 머리 번호는 참조가 아니다 — 올릴 때만 잡은 행을 읽을 때 거른다
                if head is None or (ref.kind, ref.number) != (head.kind, head.number):
                    covering[ref.id] = unit_id
                break
    return covering


async def update_caption_ref(
    session: AsyncSession, bundle: Bundle, document: Document, ref_id: int, payload: CaptionRefIn, actor: str
) -> CaptionRefOut:
    """사람이 참조를 다시 잇거나 뗀다 — 고치면 origin이 human이 된다. 문서 revision을 올리고 기록을 남긴다(되돌리기 줄에는 서지 않는다)."""
    extraction_id = await get_latest_extraction_id(session, document.id)
    ref = await session.get(CaptionRef, ref_id)
    if ref is None or extraction_id is None or ref.extraction_id != extraction_id:
        raise_rule(404, "caption_ref_not_found")
    if payload.target_unit_id is not None:
        target = await session.get(Unit, payload.target_unit_id)
        allowed = TABLE_UNIT_KINDS if ref.kind == _TABLE_KIND else (_FIGURE_KIND,)
        if (
            target is None or target.extraction_id != extraction_id or target.status != UNIT_ACTIVE
            or target.kind not in allowed
        ):
            raise_rule(422, "invalid_caption_ref_target")
        if ref.kind == _TABLE_KIND:
            ref.target_table_id, ref.target_block_id = target.table_id, None
        else:
            block_id = await session.scalar(
                select(SourceBlock.id).where(SourceBlock.extraction_id == extraction_id, SourceBlock.seq == target.pos_seq)
            )
            ref.target_table_id, ref.target_block_id = None, block_id
        ref.state = payload.state or REF_LINKED
    elif payload.state is not None:
        ref.state = payload.state
    ref.origin = ORIGIN_HUMAN
    document.revision += 1
    record_event(
        session, bundle_id=bundle.id, actor=actor, action="caption_ref.update", target_type="caption_ref",
        target_ids=[ref.id],
    )
    await session.flush()
    units = (await session.scalars(
        select(Unit).where(Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.kind.in_(BUNDLE_UNIT_KINDS))
    )).all()
    return (await build_caption_ref_outs(session, [ref], units))[0]
