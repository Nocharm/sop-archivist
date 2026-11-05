"""쪼개기 편집 — 나누기·합치기·경계 옮기기·골라 만들기·언어 바꾸기·표 행 나누기·다시 합치기·레이아웃 표 바꾸기와 서버 쪽
선형 되돌리기·다시 하기, 경계 확인 표시 (스펙 §6.4, §7.5).

단위는 제자리에서 바뀌지 않는다: 편집은 옛 단위를 은퇴시키고 새 단위를 만들며, 되돌리기는 은퇴한 단위를 원래 ID로 되살린다.
칸 문장은 제자리에 두고 묶음(group_unit_id)만 바꾸며, 그 바뀜과 레이아웃 표 표시도 기록해 되돌린다.
묶음 잠금·문서 revision·작업 중 검사와 커밋은 부르는 쪽(라우터)이 한다.
"""

from collections import Counter, defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Annotated, Literal, TypeVar, assert_never

from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.decisions import DbId
from app.sop.detach import (
    ORIGIN_NEW_DOC,
    UNASSIGNED,
    DetachReport,
    detach_targets,
    detach_units,
    find_units_needing_confirm,
    is_unassigned,
)
from app.sop.errors import raise_rule
from app.sop.events import record_event
from app.sop.groups import TABLE_UNIT_KINDS, iter_chunks, select_in_chunks
from app.sop.match import sync_new_doc_targets
from app.sop.models import (
    Document,
    SourceBlock,
    SourceTable,
    TargetSentence,
    Unit,
    UnitDecision,
    UnitEdit,
    UnitPair,
    UnitPairMember,
)
from app.sop.segment import build_unit_text, detect_language, has_visible_char
from app.sop.spans import (
    NEUTRAL,
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
from app.sop.units import UNIT_ACTIVE, get_latest_extraction_id, refresh_code_pairs, verify_document_coverage

UNIT_RETIRED = "retired"
EDIT_APPLIED = "applied"
EDIT_UNDONE = "undone"
# 글자 범위를 고칠 수 있는 단위 — 그림·표·행은 범위를 나누거나 잇지 않는다
TEXT_KINDS = ("sentence", "heading", "cell_sentence")
PAIR_LANGS = {"ko", "en"}  # 짝의 두 쪽 — 한쪽이 비면 짝을 지운다
MAX_EDIT_UNITS = 2000  # 합치기·언어 바꾸기·경계 확인이 한 번에 고르는 단위 수 상한

Offset = Annotated[int, Field(ge=0, le=MAX_DB_INT)]
T = TypeVar("T")
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


class SplitTableRowsOp(BaseModel):
    type: Literal["split_table_rows"]
    table_unit_id: DbId


class MergeTableRowsOp(BaseModel):
    type: Literal["merge_table_rows"]
    table_id: DbId  # 원문 표(source_tables) — 그 표의 활성 행 단위를 모두 합친다


class SetLayoutTableOp(BaseModel):
    type: Literal["set_layout_table"]
    table_id: DbId
    is_layout: bool


EditOp = Annotated[
    SplitOp | MergeOp | MoveBoundaryOp | CarveOp | SetLanguageOp | SplitTableRowsOp | MergeTableRowsOp
    | SetLayoutTableOp,
    Field(discriminator="type"),
]


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
    # 옛 문서는 은퇴하거나 다시 묶인 단위의 떼어 내기, 새 문서는 새 문장 다시 맞추기 결과 — 둘 다 없는 옛 문서 편집은 None
    detach: DetachReport | None


# --- 계획 ---


@dataclass(frozen=True)
class _Block:
    seq: int
    text: str
    kind: str
    table_id: int | None
    row_index: int | None


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
    # 표·행 단위만 — 이 단위에 묶을 칸 문장 → 지금 묶음(만든 뒤 _Change.regroup으로 옮긴다)
    cells: dict[int, int | None] = field(default_factory=dict)


Move = tuple[int | None, int | None]  # 칸 문장의 (지금 묶음, 바꿀 묶음)


@dataclass
class _Change:
    """편집·되돌리기·다시 하기 한 번이 단위 집합에 하는 일 — langs는 단위 → (지금 언어, 바꿀 언어)."""

    retire: list[int] = field(default_factory=list)
    revive: list[int] = field(default_factory=list)
    drafts: list[_Draft] = field(default_factory=list)
    langs: dict[int, tuple[str, str]] = field(default_factory=dict)
    # 칸 문장 → 묶음 옮김. 만들 표·행 단위에 묶는 칸은 draft.cells에 있다가 그 단위를 쓴 뒤 여기 채워진다(기록용)
    regroup: dict[int, Move] = field(default_factory=dict)
    # 원문 표 → (지금 is_layout, 바꿀 is_layout)
    layouts: dict[int, tuple[bool, bool]] = field(default_factory=dict)
    # 은퇴시킬 단위들의 범위 — 앞으로 가는 편집만 채운다(is_unchanged가 새 단위 범위와 견준다)
    retired_spans: list[tuple[Span, ...]] = field(default_factory=list)

    def list_regrouped_cells(self) -> list[int]:
        return sorted({*self.regroup, *(cell_id for draft in self.drafts for cell_id in draft.cells)})

    def is_unchanged(self) -> bool:
        """새 단위들의 범위가 은퇴시킬 단위들의 범위와 (모음으로) 같고 언어·칸 묶음·표 표시도 그대로면 바뀌는 게 없다.

        경계를 처음 자리나 사이 빈 글자에 다시 놓거나 단위 하나의 범위를 그대로 골라 만든 경우다 — 단위는 범위 그 자체라
        (스펙 §6.4) 같은 범위를 새 ID로 다시 만들면 표시 ID가 바뀌고 확정 판단이 이유 없이 떼어진다. 표·행 단위는 범위가
        없어 범위로는 견줄 수 없으므로 묶음·표 표시가 바뀌면 바뀐 것이다.
        """
        if self.revive or self.langs or self.layouts or self.list_regrouped_cells():
            return False
        return Counter(tuple(draft.spans) for draft in self.drafts) == Counter(self.retired_spans)


def _build_replacement(units: Iterable[Unit], drafts: list[_Draft]) -> _Change:
    """옛 단위들을 은퇴시키고 drafts를 만드는 변경."""
    replaced = list(units)
    return _Change(
        retire=sorted(unit.id for unit in replaced), drafts=drafts,
        retired_spans=[tuple(to_spans(unit.spans)) for unit in replaced],
    )


def _get_position(unit: Unit) -> tuple[int, int, int]:
    return unit.pos_seq, unit.pos_start, unit.id


def ensure_unique_units(unit_ids: Sequence[int]) -> None:
    repeated = sorted(unit_id for unit_id, count in Counter(unit_ids).items() if count > 1)
    if repeated:
        raise_rule(422, "duplicate_units", unit_ids=repeated)


def _ensure_text_kinds(units: Iterable[Unit]) -> None:
    wrong = sorted(unit.id for unit in units if unit.kind not in TEXT_KINDS)
    if wrong:
        raise_rule(422, "invalid_unit_kind", unit_ids=wrong)


async def load_active_units(
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
        lambda chunk: select(
            SourceBlock.id, SourceBlock.seq, SourceBlock.text, SourceBlock.kind, SourceBlock.table_id,
            SourceBlock.row_index,
        ).where(SourceBlock.id.in_(chunk), SourceBlock.extraction_id == extraction_id),
        block_ids,
    )
    return {block_id: _Block(*fields) for block_id, *fields in rows}


async def _load_unit_blocks(
    session: AsyncSession, extraction_id: ExtractionId, units: Iterable[Unit]
) -> dict[int, _Block]:
    return await _load_blocks(session, extraction_id, {span[0] for unit in units for span in unit.spans})


def _build_draft(
    like: Unit, spans: list[Span], blocks: Mapping[int, _Block], *, kind: str | None = None, lang: str | None = None
) -> _Draft:
    """like의 묶음(그룹 단위)을 물려받는 새 단위 — 자리는 첫 범위의 블록·시작, 언어는 주지 않으면 글자로 판정한다.

    칸 문장의 표·행 번호는 첫 범위 칸 블록의 것이다(R33) — 행을 넘어 합친 칸을 다시 나누면 조각마다 자기 행을 가져야
    표를 행 단위로 나눌 때(Task 14) 칸이 제 행에 묶인다. 문장·제목은 like를 따른다(표 밖이라 없음).
    """
    kind = kind or like.kind
    first = blocks[spans[0][0]]
    is_cell = kind == "cell_sentence"
    table_id, row_index = (first.table_id, first.row_index) if is_cell else (like.table_id, like.row_index)
    text = build_unit_text(spans, _get_texts(blocks))
    return _Draft(
        kind=kind, spans=spans, text=text, lang=lang or detect_language(text) or "", table_id=table_id,
        row_index=row_index, group_unit_id=like.group_unit_id, pos_seq=first.seq, pos_start=spans[0][1],
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
    unit = (await load_active_units(session, extraction_id, [op.unit_id]))[op.unit_id]
    _ensure_text_kinds([unit])
    spans = to_spans(unit.spans)
    located = locate_text_offset(spans, op.at) if 0 < op.at < len(unit.text) else None
    if located is None:
        raise_rule(422, "invalid_offset", unit_id=unit.id, at=op.at)
    blocks = await _load_unit_blocks(session, extraction_id, [unit])
    left, right = cut_spans(spans, *located, _get_texts(blocks))
    if not left or not right:
        raise_rule(422, "empty_part", unit_id=unit.id)
    return _build_replacement([unit], [_build_draft(unit, left, blocks), _build_draft(unit, right, blocks)])


async def _plan_merge(session: AsyncSession, extraction_id: ExtractionId, op: MergeOp) -> _Change:
    """결과 범위는 원문 순서로 모으고 같은 블록에서 사이가 빈 글자뿐이면 한 범위로 잇는다. 언어는 합친 단위들의 같은 언어."""
    ensure_unique_units(op.unit_ids)
    units = sorted((await load_active_units(session, extraction_id, op.unit_ids)).values(), key=_get_position)
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
    return _build_replacement(units, [draft])


async def _plan_move_boundary(session: AsyncSession, extraction_id: ExtractionId, op: MoveBoundaryOp) -> _Change:
    ensure_unique_units([op.left_unit_id, op.right_unit_id])
    units = await load_active_units(session, extraction_id, [op.left_unit_id, op.right_unit_id])
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
    return _build_replacement(
        [left, right], [_build_draft(left, new_left, blocks), _build_draft(right, new_right, blocks)]
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
    units = sorted((await load_active_units(session, extraction_id, hit_ids)).values(), key=_get_position)
    blocks = await _load_unit_blocks(session, extraction_id, units)
    texts, seqs = _get_texts(blocks), {block_id: item.seq for block_id, item in blocks.items()}
    drafts = []
    for unit in units:
        before, after = split_around(to_spans(unit.spans), op.block_id, start, end, texts, seqs)
        drafts.extend(_build_draft(unit, part, blocks) for part in (before, after) if part)
    drafts.append(_build_draft(units[0], [carved], blocks, kind=_decide_merged_kind(units)))
    return _build_replacement(units, drafts)


async def _plan_set_language(session: AsyncSession, extraction_id: ExtractionId, op: SetLanguageOp) -> _Change:
    ensure_unique_units(op.unit_ids)
    units = await load_active_units(session, extraction_id, op.unit_ids)
    _ensure_text_kinds(units.values())
    changes = {unit_id: (unit.lang, op.lang) for unit_id, unit in sorted(units.items()) if unit.lang != op.lang}
    return _Change(langs=changes)


async def _load_table(session: AsyncSession, extraction_id: ExtractionId, table_id: int) -> SourceTable:
    table = await session.scalar(
        select(SourceTable).where(SourceTable.id == table_id, SourceTable.extraction_id == extraction_id)
    )
    if table is None:
        raise_rule(404, "table_not_found", table_id=table_id)
    return table


async def _load_table_units(
    session: AsyncSession, extraction_id: ExtractionId, table_id: int, kinds: Collection[str]
) -> list[Unit]:
    """원문 표 하나의 활성 표·행 단위(원문 순) — 칸 안의 표는 table_id가 달라 섞이지 않는다."""
    rows = await session.scalars(
        select(Unit)
        .where(
            Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.table_id == table_id,
            Unit.kind.in_(kinds),
        )
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    return list(rows)


async def _load_grouped_cells(session: AsyncSession, group_unit_ids: Collection[int]) -> list[Unit]:
    """표·행 단위들에 묶인 활성 칸 문장(원문 순)."""
    rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit).where(Unit.group_unit_id.in_(chunk), Unit.status == UNIT_ACTIVE),
        group_unit_ids,
    )
    return sorted((row[0] for row in rows), key=_get_position)


async def _load_first_cell_seqs(session: AsyncSession, extraction_id: ExtractionId, table_id: int) -> dict[int, int]:
    """원문 표의 행 → 그 행 첫 칸 블록 seq — 표·행 단위의 자리(처음 쪼개기처럼 빈 칸 블록도 센다)."""
    rows = await session.execute(
        select(SourceBlock.row_index, func.min(SourceBlock.seq))
        .where(
            SourceBlock.extraction_id == extraction_id, SourceBlock.table_id == table_id,
            SourceBlock.kind == "table_cell",
        )
        .group_by(SourceBlock.row_index)
    )
    return dict(rows.tuples().all())


def _build_group_draft(
    kind: str, table_id: int, row_index: int | None, pos_seq: int, cells: Mapping[int, int | None]
) -> _Draft:
    """표·행 단위 — 범위·글자 없음, 중립, 자리는 첫 칸 블록의 칸 문장보다 앞(pos_start=-1). cells는 칸 문장 → 지금 묶음."""
    return _Draft(
        kind=kind, spans=[], text="", lang=NEUTRAL, table_id=table_id, row_index=row_index, group_unit_id=None,
        pos_seq=pos_seq, pos_start=-1, cells=dict(cells),
    )


async def _plan_split_table_rows(session: AsyncSession, extraction_id: ExtractionId, op: SplitTableRowsOp) -> _Change:
    """표 단위를 은퇴시키고 칸 문장이 있는 행마다 행 단위를 만들어 칸 문장을 자기 행(칸 블록의 행, R33)에 묶는다."""
    table_unit = (await load_active_units(session, extraction_id, [op.table_unit_id]))[op.table_unit_id]
    if table_unit.kind != "table":
        raise_rule(422, "invalid_unit_kind", unit_ids=[table_unit.id])
    cells = await _load_grouped_cells(session, [table_unit.id])
    if not cells:  # 행 단위가 하나도 없으면 표가 처분할 곳 없이 사라진다
        raise_rule(422, "empty_table", unit_id=table_unit.id)
    blocks = await _load_unit_blocks(session, extraction_id, cells)
    # 표 안에서 행을 넘어 합친 칸 문장은 자기 행이 없다 — 먼저 나눠야 한다
    crossing = [cell.id for cell in cells if any(blocks[span[0]].row_index != cell.row_index for span in cell.spans)]
    if crossing:
        raise_rule(422, "cell_spans_rows", unit_ids=sorted(crossing))
    by_row: dict[int, dict[int, int | None]] = defaultdict(dict)
    for cell in cells:
        by_row[cell.row_index][cell.id] = cell.group_unit_id
    first_seqs = await _load_first_cell_seqs(session, extraction_id, table_unit.table_id)
    drafts = [
        _build_group_draft("table_row", table_unit.table_id, row, first_seqs[row], row_cells)
        for row, row_cells in sorted(by_row.items())
    ]
    return _build_replacement([table_unit], drafts)


async def _plan_merge_table_rows(session: AsyncSession, extraction_id: ExtractionId, op: MergeTableRowsOp) -> _Change:
    """그 표의 활성 행 단위를 모두 은퇴시키고 새 표 단위 하나에 칸 문장을 다시 묶는다."""
    table = await _load_table(session, extraction_id, op.table_id)
    rows = await _load_table_units(session, extraction_id, table.id, ["table_row"])
    if not rows:
        raise_rule(422, "table_not_split", table_id=table.id)
    cells = await _load_grouped_cells(session, [row.id for row in rows])
    first_seqs = await _load_first_cell_seqs(session, extraction_id, table.id)
    draft = _build_group_draft(
        "table", table.id, None, min(first_seqs.values()), {cell.id: cell.group_unit_id for cell in cells}
    )
    return _build_replacement(rows, [draft])


async def _find_crossing_cells(
    session: AsyncSession, extraction_id: ExtractionId, table_id: int
) -> tuple[list[int], list[int]]:
    """묶이지 않은 활성 칸 문장 중 (이 표의 것, 표 경계를 넘은 것) — 레이아웃 칸은 다른 표 칸과도 합칠 수 있다.

    이 표의 칸 문장(첫 범위 블록이 이 표, R33)이 다른 블록에 걸치거나 다른 표의 칸 문장이 이 표 블록에 걸치면 넘은 것이다.
    """
    table_blocks = set(
        await session.scalars(
            select(SourceBlock.id).where(SourceBlock.extraction_id == extraction_id, SourceBlock.table_id == table_id)
        )
    )
    rows = await session.execute(
        select(Unit.id, Unit.table_id, Unit.spans)
        .where(
            Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.kind == "cell_sentence",
            Unit.group_unit_id.is_(None),
        )
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    own: list[int] = []
    crossing: list[int] = []
    for unit_id, unit_table_id, spans in rows:
        is_own = unit_table_id == table_id
        if is_own:
            own.append(unit_id)
        if any((block_id in table_blocks) != is_own for block_id, _, _ in spans):
            crossing.append(unit_id)
    return own, sorted(crossing)


async def _plan_set_layout_table(session: AsyncSession, extraction_id: ExtractionId, op: SetLayoutTableOp) -> _Change:
    """데이터 → 레이아웃: 표·행 단위를 은퇴시키고 칸 문장의 묶음을 푼다. 레이아웃 → 데이터: 새 표 단위에 칸 문장을 묶는다.

    칸 안의 표는 따로 바뀐다(table_id가 다르다). 이미 그 표시면 바뀌는 게 없다.
    """
    table = await _load_table(session, extraction_id, op.table_id)
    if table.is_layout == op.is_layout:
        return _Change()
    if op.is_layout:
        groups = await _load_table_units(session, extraction_id, table.id, TABLE_UNIT_KINDS)
        change = _build_replacement(groups, [])
        cells = await _load_grouped_cells(session, [group.id for group in groups])
        change.regroup = {cell.id: (cell.group_unit_id, None) for cell in cells}
    else:
        own, crossing = await _find_crossing_cells(session, extraction_id, table.id)
        if crossing:
            raise_rule(422, "cell_crosses_table", unit_ids=crossing)
        first_seqs = await _load_first_cell_seqs(session, extraction_id, table.id)
        # 칸 블록이 없는 표는 처음 쪼개기처럼 표 단위를 만들지 않는다
        change = _Change(
            drafts=[_build_group_draft("table", table.id, None, min(first_seqs.values()), dict.fromkeys(own))]
            if first_seqs else []
        )
    change.layouts = {table.id: (table.is_layout, op.is_layout)}
    return change


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
        case SplitTableRowsOp():
            return await _plan_split_table_rows(session, extraction_id, op)
        case MergeTableRowsOp():
            return await _plan_merge_table_rows(session, extraction_id, op)
        case SetLayoutTableOp():
            return await _plan_set_layout_table(session, extraction_id, op)
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
) -> list[tuple[_Draft, int]]:
    """새 단위를 원문 순서로 local_no 다음 번호부터 만든다 — 옛 문서는 미배정 판단 행도 함께(새 문서는 판단 행이 없다).

    (초안, 만든 단위 id)를 원문 순서로 돌려준다.
    """
    if not drafts:
        return []
    last_no = await session.scalar(select(func.max(Unit.local_no)).where(Unit.extraction_id == extraction_id))
    ordered = sorted(drafts, key=lambda draft: (draft.pos_seq, draft.pos_start))
    units = [
        Unit(
            extraction_id=extraction_id, local_no=last_no + offset, kind=draft.kind,
            spans=[list(span) for span in draft.spans], text=draft.text, lang=draft.lang, table_id=draft.table_id,
            row_index=draft.row_index, group_unit_id=draft.group_unit_id, pos_seq=draft.pos_seq,
            pos_start=draft.pos_start,
        )
        for offset, draft in enumerate(ordered, start=1)
    ]
    session.add_all(units)
    await session.flush()
    if document.side == "old":
        session.add_all(UnitDecision(unit_id=unit.id, bundle_id=document.bundle_id) for unit in units)
    return [(draft, unit.id) for draft, unit in zip(ordered, units, strict=True)]


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


async def _apply_regroup(session: AsyncSession, regroup: Mapping[int, Move]) -> None:
    """칸 문장 묶음을 옮긴다 — 지금 묶음이 기록과 다른 칸이 있으면 편집 기록과 어긋난 것이라 RuntimeError(버그 가드)."""
    by_move: dict[Move, list[int]] = defaultdict(list)
    for cell_id, move in regroup.items():
        by_move[move].append(cell_id)
    changed = 0
    for (old, new), cell_ids in by_move.items():
        current = Unit.group_unit_id.is_(None) if old is None else Unit.group_unit_id == old
        for chunk in iter_chunks(cell_ids):
            result = await session.execute(update(Unit).where(Unit.id.in_(chunk), current).values(group_unit_id=new))
            changed += result.rowcount
    if changed != len(regroup):
        raise RuntimeError(f"unit edit history out of sync: {changed} of {len(regroup)} cells had the recorded group")


async def _apply_layouts(session: AsyncSession, layouts: Mapping[int, tuple[bool, bool]]) -> None:
    """레이아웃 표 표시를 바꾼다 — 지금 표시가 기록과 다르면 RuntimeError(버그 가드)."""
    for table_id, (old, new) in layouts.items():
        result = await session.execute(
            update(SourceTable).where(SourceTable.id == table_id, SourceTable.is_layout == old).values(is_layout=new)
        )
        if result.rowcount != 1:
            raise RuntimeError(f"unit edit history out of sync: table {table_id} was not is_layout={old}")


async def _find_new_doc_targets(session: AsyncSession, unit_ids: Collection[int]) -> list[int]:
    rows = await select_in_chunks(
        session,
        lambda chunk: select(TargetSentence.id).where(
            TargetSentence.new_unit_id.in_(chunk), TargetSentence.origin == ORIGIN_NEW_DOC
        ),
        unit_ids,
    )
    return sorted(row[0] for row in rows)


def _merge_reports(first: DetachReport, second: DetachReport) -> DetachReport:
    """새 문장 쪽 떼어 내기(R32)와 다시 맞추기 결과를 하나로 — 나중에 지운 새 문장은 보류 목록에서 뺀다."""
    deleted = {*first.deleted_target_ids, *second.deleted_target_ids}
    return DetachReport(
        reset_unit_ids=sorted({*first.reset_unit_ids, *second.reset_unit_ids}),
        deleted_target_ids=sorted(deleted),
        held_unit_ids=sorted({*first.held_unit_ids, *second.held_unit_ids}),
        held_target_ids=sorted({*first.held_target_ids, *second.held_target_ids} - deleted),
    )


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
    와 칸 묶음·레이아웃 표 바꾸기 → 짝 다시 제안(표 표시가 바뀌면) → 커버리지 가드 → 문서 revision +1.
    편집·되돌리기·다시 하기가 함께 쓴다.

    다시 묶이는 칸 문장도 확인 대상이다 — 옛 문서는 레이아웃 칸이 가진 자기 판단이 표에 묶이며 떼어지고, 새 문서는 미배정이
    아닌 칸·표 새 문장이 새 부모 아래로 옮겨지지 않게 먼저 미배정으로 돌린다(R32).
    """
    if change.langs:
        decided = await _find_decided_units(session, document, change.langs)
        if decided:
            raise_rule(409, "unit_has_decision", unit_ids=decided)
    regrouped = change.list_regrouped_cells()
    if change.retire or regrouped:
        needing = await find_units_needing_confirm(session, [*change.retire, *regrouped])
        if needing and not confirm:
            raise_rule(409, "confirm_required", unit_ids=needing)
    await _fill_unknown_languages(session, document, extraction_id, change)
    await _set_status(session, change.retire, UNIT_ACTIVE, UNIT_RETIRED)
    await _set_status(session, change.revive, UNIT_RETIRED, UNIT_ACTIVE)
    inserted = await _insert_units(session, document, extraction_id, change.drafts)
    for draft, unit_id in inserted:
        change.regroup.update({cell_id: (group_id, unit_id) for cell_id, group_id in draft.cells.items()})
    await _set_languages(session, change.langs)
    await _leave_pairs(session, [*change.retire, *change.langs])
    await session.flush()
    activated = [*change.revive, *(unit_id for _, unit_id in inserted)]
    detach = None
    if document.side == "new":
        reset = None
        if change.regroup:
            reset = await detach_targets(
                session, target_ids=await _find_new_doc_targets(session, [*change.retire, *change.regroup])
            )
        await _apply_regroup(session, change.regroup)
        await _apply_layouts(session, change.layouts)
        detach = await sync_new_doc_targets(
            session, document, created_unit_ids=activated, retired_unit_ids=change.retire, actor=actor
        )
        if reset is not None:
            detach = _merge_reports(reset, detach)
    else:
        if change.retire or change.regroup:
            # 묶음을 옮기기 전에 떼어 낸다 — 은퇴하는 표의 칸 새 문장 연결이 표 판단 이력에 함께 남게
            detach = await detach_units(
                session, bundle_id=document.bundle_id, unit_ids=[*change.retire, *change.regroup],
                cause="retired" if change.retire else "regrouped", actor=actor,
            )
        await _apply_regroup(session, change.regroup)
        await _apply_layouts(session, change.layouts)
    if change.layouts:
        # 레이아웃 표의 칸 문장은 묶이지 않아 한/영 두 열이 이웃 짝으로 제안되고, 다시 데이터 표가 되면 그 제안이 빠진다
        await session.flush()
        await refresh_code_pairs(session, document)
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
    """작업 기록 — 대상은 은퇴한·활성이 된·언어가 바뀐·다시 묶인 단위, 사유 칸에 편집 종류(split 등)."""
    unit_ids = sorted({*result.created_unit_ids, *result.retired_unit_ids, *change.langs, *change.regroup})
    record_event(
        session, bundle_id=document.bundle_id, actor=actor, action=action, target_type="unit", target_ids=unit_ids,
        reason=op,
    )


async def apply_edit(
    session: AsyncSession, document: Document, op: EditOp, *, confirm: bool, actor: str
) -> EditResult:
    """편집 하나를 적용하고 기록한다 — 새 편집은 다시 하기 기록(undone)을 지운다.

    바뀌는 게 없는 편집(같은 언어로 바꾸기, 범위가 그대로인 경계 옮기기·골라 만들기)은 아무것도 쓰지 않는다 — 확인도
    묻지 않고 revision·기록·다시 하기 기록도 그대로다.
    """
    extraction_id = await get_latest_extraction_id(session, document.id)
    change = await _plan(session, extraction_id, op)
    if change.is_unchanged():
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
            regrouped={str(cell_id): list(move) for cell_id, move in change.regroup.items()},
            lang_changes={str(unit_id): list(langs) for unit_id, langs in change.langs.items()},
            layout_changes={str(table_id): list(flags) for table_id, flags in change.layouts.items()}, actor=actor,
        )
    )
    _record(session, document, "unit.edit", op.type, result, change, actor)
    await session.flush()
    return result


def _orient(before_after: Sequence[T], *, backwards: bool) -> tuple[T, T]:
    """기록된 (전, 후) 값 — 되돌리기면 (후, 전)."""
    before, after = before_after
    return (after, before) if backwards else (before, after)


def _replay(edit: UnitEdit, *, backwards: bool) -> _Change:
    """기록된 편집을 되돌리기(backwards) 또는 다시 하기로 — 같은 단위 ID·같은 칸 묶음·같은 표 표시로 뒤집거나 되풀이한다."""
    created, retired = list(edit.created_unit_ids), list(edit.retired_unit_ids)
    return _Change(
        retire=created if backwards else retired,
        revive=retired if backwards else created,
        langs={int(unit_id): _orient(langs, backwards=backwards) for unit_id, langs in edit.lang_changes.items()},
        regroup={int(cell_id): _orient(move, backwards=backwards) for cell_id, move in edit.regrouped.items()},
        layouts={
            int(table_id): _orient(flags, backwards=backwards) for table_id, flags in edit.layout_changes.items()
        },
    )


async def undo_edit(session: AsyncSession, document: Document, *, confirm: bool, actor: str) -> EditResult:
    """마지막 적용 편집을 거꾸로 — 만든 단위를 은퇴시키고 은퇴시킨 단위를 원래 ID로 되살린다(되살린 단위의 판단은 미배정).
    칸 묶음과 레이아웃 표 표시도 편집 전으로 돌린다."""
    edit = await session.scalar(
        select(UnitEdit)
        .where(UnitEdit.document_id == document.id, UnitEdit.state == EDIT_APPLIED)
        .order_by(UnitEdit.seq.desc())
        .limit(1)
    )
    if edit is None:
        raise_rule(409, "nothing_to_undo")
    change = _replay(edit, backwards=True)
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
    change = _replay(edit, backwards=False)
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
    ensure_unique_units(unit_ids)
    units = await load_active_units(session, await get_latest_extraction_id(session, document.id), unit_ids)
    for unit in units.values():
        unit.boundary_confirmed = confirmed
    await session.flush()
    return sorted(units)
