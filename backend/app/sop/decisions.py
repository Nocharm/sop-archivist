"""사람의 판단 — 관계 묶음 저장(닫힘·위치·언어·글자·변경 종류·중복 배정 검사), 일괄 처분, 배정 지우기, 단위 목록 (스펙 §6.7–6.9, §7.7)."""

from collections import Counter, defaultdict
from collections.abc import Collection, Hashable, Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any, Literal, NamedTuple, NoReturn, Self

from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import Select, delete, func, insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlalchemy.orm.util import AliasedClass

from app.clock import now
from app.sop.ai.adoption import record_group_adoption, record_unit_adoption, reject_suggestions
from app.sop.checks import check_sentence
from app.sop.constants import SLOT_KEYS
from app.sop.detach import (
    AI_SUGGESTED,
    CONFIRMED,
    ON_HOLD,
    ORIGIN_NEW_DOC,
    ORIGIN_TRANSLATION,
    DetachReport,
    detach_units,
    is_unassigned,
    load_source_target_ids,
    reset_target,
    sweep_translations,
)
from app.sop.errors import check_revision, raise_rule
from app.sop.events import record_event
from app.sop.groups import (
    TABLE_UNIT_KINDS,
    DecisionOut,
    GroupOut,
    build_group_out,
    collect_component,
    select_in_chunks,
)
from app.sop.membership import ensure_editable, lock_bundle
from app.sop.models import (
    AiJob,
    Bundle,
    Document,
    Extraction,
    SourceBlock,
    SourceTable,
    TargetDoc,
    TargetDocNaSlot,
    TargetSentence,
    TargetSource,
    TargetTextHistory,
    Unit,
    UnitDecision,
    UnitPairMember,
    WiStep,
)
from app.sop.schemas import NO_NUL, NoNulStr
from app.sop.segment import has_visible_char
from app.sop.status import get_cover_status
from app.sop.tobe import MAX_DB_INT, is_within_slot
from app.sop.units import UNIT_ACTIVE, compute_display_id

DbId = Annotated[int, Field(ge=1, le=MAX_DB_INT)]
CellIndex = Annotated[int, Field(ge=0, le=MAX_DB_INT)]
DEFAULT_UNITS_PAGE = 200
MAX_UNITS_PAGE = 1000
MAX_BULK_UNITS = 2000  # 머리말·구조 제목 정리를 한 번에(R4)
ORIGIN_UNITS = "units"
NEUTRAL = "neutral"
# 문장 새 문장의 출처가 될 수 있는 단위 — 그림은 그림 새 문장, 표·행은 표 새 문장으로만 간다(R28)
SENTENCE_SOURCE_KINDS = ("sentence", "heading", "cell_sentence")
TEXT_CHANGE_TYPES = ("tone", "rewritten")  # 글자가 출처와 다를 때 사람이 고르는 종류


# --- 요청·응답 ---


class UnitDecisionIn(BaseModel):
    unit_id: DbId
    revision: DbId
    # unassigned는 보낼 곳 없는 보류 — action이 hold일 때만 된다(_check_dispositions)
    disposition: Literal["assigned", "delete", "move_external", "unassigned"]
    move_target_code: NoNulStr = Field("", max_length=100)
    reason: NoNulStr = Field("", max_length=2000)


class GridIn(BaseModel):
    rows: int = Field(ge=1, le=500)
    cols: int = Field(ge=1, le=100)


class TargetIn(BaseModel):
    """새 문장 하나의 저장 뒤 모습. 기존 새 문장에서 비운(None) 문서·글자·언어·격자·칸 자리는 지금 값을 둔다.

    자리(칸 키·WI 단계·부분)는 None도 뜻이 있는 값(WI의 칸 없음, 단계 없음)이라 보낸 그대로 쓴다.
    """

    key: str = Field(min_length=1, max_length=40)  # 요청 안 식별자 — 칸 새 문장이 parent_key로 표 새 문장을 가리킨다
    id: DbId | None = None
    revision: DbId | None = None
    target_doc_id: DbId | None = None  # 새로 만들 때 필수
    slot_key: str | None = Field(None, max_length=100)
    wi_step: DbId | None = None
    wi_part: Literal["instruction", "why"] | None = None
    kind: Literal["sentence", "table", "figure"] = "sentence"
    lang: Literal["ko", "en", "neutral"] | None = None
    text: Annotated[str, StringConstraints(max_length=20000), NO_NUL] | None = None
    change_type: Literal["as_is", "tone", "rewritten", "table_restructured"] | None = None
    source_unit_ids: list[DbId] = Field(max_length=200)
    parent_key: str | None = Field(None, max_length=40)
    cell_row: CellIndex | None = None
    cell_col: CellIndex | None = None
    grid: GridIn | None = None

    @model_validator(mode="after")
    def check_id_with_revision(self) -> Self:
        if (self.id is None) != (self.revision is None):
            raise ValueError("an existing target needs both id and revision")
        return self


class GroupSaveIn(BaseModel):
    action: Literal["confirm", "hold"]
    hold_reason: NoNulStr = Field("", max_length=2000)
    units: list[UnitDecisionIn] = Field(max_length=500)
    targets: list[TargetIn] = Field(max_length=2000)
    removed_target_ids: list[DbId] = Field(default_factory=list, max_length=2000)


class BulkUnitIn(BaseModel):
    unit_id: DbId
    revision: DbId


class BulkDecisionIn(BaseModel):
    action: Literal["delete", "move_external"]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000), NO_NUL]
    move_target_code: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100), NO_NUL] = ""
    units: list[BulkUnitIn] = Field(min_length=1, max_length=MAX_BULK_UNITS)

    @model_validator(mode="after")
    def check_move_target(self) -> Self:
        if self.action == "move_external" and not self.move_target_code:
            raise ValueError("move_target_code is required to move units to another document")
        return self


class ClearIn(BaseModel):
    unit_id: DbId
    revision: DbId


class ResetIn(BaseModel):
    revision: DbId  # 묶음 revision
    document_id: DbId | None = None  # 없으면 묶음 전체
    dry_run: bool = False  # true면 건수만 계산하고 아무것도 바꾸지 않는다


class ResetOut(BaseModel):
    """초기화가 (dry_run이면 하게 될) 바꾼 건수 — 확인 창이 이 건수를 그대로 보인다."""

    dry_run: bool
    unassigned_units: int  # 미배정으로 돌아간 단위
    deleted_targets: int  # 지운 새 문장
    held_units: int  # 같은 관계 묶음이라 보류로 간 단위(다른 문서 것 포함)
    held_targets: int  # 보류로 간 새 문장


class UnitDecisionRowOut(BaseModel):
    unit_id: int
    decision: DecisionOut


class UnitRowOut(BaseModel):
    unit_id: int
    document_id: int
    display_id: str
    kind: str
    lang: str
    text: str
    table_id: int | None
    row_index: int | None
    group_unit_id: int | None
    # 한/영 짝 — /documents/{id}/view의 units[].pair_id와 같은 뜻(제안·확정 짝 모두), 짝이 없으면 None
    pair_id: int | None
    # 커버 상태 — 묶인 칸 문장은 그룹 단위의 상태(get_cover_status)
    status: str
    # 단위 자신의 판단 행 — 묶인 칸 문장의 판단 행은 늘 미배정이다(처분은 그룹 단위가 담는다)
    decision: DecisionOut
    target_ids: list[int]


class UnitsPageOut(BaseModel):
    total: int
    items: list[UnitRowOut]


# --- 검사에 쓰는 지금 모습 ---


@dataclass
class _State:
    units: dict[int, Unit]  # 보낸 단위와 그 칸 문장(U*)
    decisions: dict[int, UnitDecision]  # 보낸 단위의 판단
    cells: dict[int, list[int]]  # 표·행 단위 → 묶인 활성 칸 문장
    group_of: dict[int, int]  # 칸 문장 → 표·행 단위
    existing: dict[int, TargetSentence]  # 보낸 기존 새 문장과 지울 새 문장
    removed: set[int]  # 지울 새 문장
    sources: dict[int, set[int]]  # 기존 새 문장 → 지금 출처 단위
    translation_sources: dict[int, TargetSentence]  # 번역 → 그 출처 새 문장(지금 값). 출처가 이미 없어진 번역은 빠진다
    translation_texts: dict[int, str]  # 번역 출처 단위 → 글자 — 번역의 문장 검사가 읽는다. 은퇴한 단위도 든다
    member_unit_ids: set[int]  # 보낸 단위와 묶인 칸 문장 전부(은퇴한 칸 포함) — 닫힘 검사의 경계
    # U*와 기존 새 문장에서 출발한 지금의 연결 요소(collect_component — 묶음 읽기·떼어 내기와 같은 그래프)
    component_units: set[int]
    component_targets: set[int]
    docs: dict[int, TargetDoc]
    na_slots: dict[int, list[str]]
    steps: dict[int, set[int]]
    table_shapes: dict[int, tuple[int, int]]  # 원문 표 id → (행 수, 열 수)
    cell_positions: dict[int, tuple[int, int]]  # 칸 문장 → 블록의 (행, 열)


class _Place(NamedTuple):
    """새 문장의 자리 — 번역이 출처를 따르는 범위다. 절 경로는 저장이 바꾸지 않아 여기 없고 sweep_translations가 옮긴다."""

    doc_id: int
    slot_key: str | None
    wi_step: int | None
    wi_part: str | None
    cell_row: int | None
    cell_col: int | None
    parent_id: int | None


@dataclass
class _Plan:
    """새 문장 하나의 저장 뒤 모습 — 검사가 채우고 쓰기가 그대로 옮긴다."""

    item: TargetIn
    row: TargetSentence | None
    doc: TargetDoc
    origin: str
    sources: list[int]
    lang: str
    text: str
    grid: dict[str, int] | None
    cell_row: int | None
    cell_col: int | None
    parent: "_Plan | None" = None
    is_cell: bool = False
    change_type: str | None = None


def _reject(reason: str, **context: object) -> NoReturn:
    """관계 묶음 저장 거절 — 422 invalid_group{reason, 문맥(keys·unit_ids·target_ids)}."""
    raise_rule(422, "invalid_group", reason=reason, **context)


def _find_duplicates(values: Iterable[Hashable]) -> list[Any]:
    return sorted(value for value, count in Counter(values).items() if count > 1)


async def _load_old_units(
    session: AsyncSession, bundle_id: int, unit_ids: Collection[int]
) -> dict[int, tuple[Unit, UnitDecision]]:
    """이 묶음 옛 문서의 활성 단위와 그 판단 — 아닌 id는 빠진다."""
    rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit, UnitDecision)
        .join(UnitDecision, UnitDecision.unit_id == Unit.id)
        .join(Extraction, Extraction.id == Unit.extraction_id)
        .join(Document, Document.id == Extraction.document_id)
        .where(Unit.id.in_(chunk), Document.bundle_id == bundle_id, Document.side == "old", Unit.status == UNIT_ACTIVE),
        unit_ids,
    )
    return {unit.id: (unit, decision) for unit, decision in rows}


async def _load_decision_units(
    session: AsyncSession, bundle_id: int, unit_ids: Collection[int]
) -> dict[int, tuple[Unit, UnitDecision]]:
    """일괄 처분·배정 지우기의 단위 — 없으면 404, 묶인 칸 문장이면 422(처분은 그룹 단위가 담는다)."""
    loaded = await _load_old_units(session, bundle_id, unit_ids)
    missing = sorted(set(unit_ids) - set(loaded))
    if missing:
        raise_rule(404, "unit_not_found", unit_ids=missing)
    bound = sorted(unit_id for unit_id, (unit, _) in loaded.items() if unit.group_unit_id is not None)
    if bound:
        raise_rule(422, "bound_cell_sentence", unit_ids=bound)
    return loaded


async def _load_state(session: AsyncSession, bundle_id: int, payload: GroupSaveIn) -> _State:
    """검사 1(보낸 단위·새 문장이 이 묶음 것인가)을 하며 검사에 쓸 지금 모습을 읽는다 — 질의 수는 단위 수와 무관하다."""
    sent_ids = [item.unit_id for item in payload.units]
    loaded = await _load_old_units(session, bundle_id, sent_ids)
    missing = sorted(set(sent_ids) - set(loaded))
    if missing:
        _reject("unknown_unit", unit_ids=missing)
    bound = sorted(unit_id for unit_id, (unit, _) in loaded.items() if unit.group_unit_id is not None)
    if bound:
        _reject("bound_cell_sentence", unit_ids=bound)
    units = {unit_id: unit for unit_id, (unit, _) in loaded.items()}
    decisions = {unit_id: decision for unit_id, (_, decision) in loaded.items()}

    table_unit_ids = [unit_id for unit_id, unit in units.items() if unit.kind in TABLE_UNIT_KINDS]
    cell_rows = await select_in_chunks(
        session, lambda chunk: select(Unit).where(Unit.group_unit_id.in_(chunk)), table_unit_ids
    )
    member_unit_ids = set(units) | {cell.id for (cell,) in cell_rows}
    cells: dict[int, list[int]] = defaultdict(list)
    group_of: dict[int, int] = {}
    for (cell,) in sorted(cell_rows, key=lambda row: (row[0].pos_seq, row[0].pos_start, row[0].id)):
        if cell.status != UNIT_ACTIVE:  # 은퇴한 칸 문장은 출처가 될 수 없다(연결은 떼어 내기가 이미 뗐다)
            continue
        cells[cell.group_unit_id].append(cell.id)
        group_of[cell.id] = cell.group_unit_id
        units[cell.id] = cell

    existing_ids = [item.id for item in payload.targets if item.id is not None] + payload.removed_target_ids
    existing = {
        row[0].id: row[0]
        for row in await select_in_chunks(
            session,
            lambda chunk: select(TargetSentence).where(
                TargetSentence.id.in_(chunk), TargetSentence.bundle_id == bundle_id
            ),
            existing_ids,
        )
    }
    unknown = sorted(set(existing_ids) - set(existing))
    if unknown:
        _reject("unknown_target", target_ids=unknown)
    component_units, component_targets = await collect_component(session, unit_ids=units, target_ids=existing)
    sources: dict[int, set[int]] = defaultdict(set)
    for target_id, unit_id in await select_in_chunks(
        session,
        lambda chunk: select(TargetSource.target_id, TargetSource.unit_id).where(TargetSource.target_id.in_(chunk)),
        existing,
    ):
        sources[target_id].add(unit_id)
    translation_unit_ids = {row.translation_source_unit_id for row in existing.values()} - {None}
    translation_rows = await select_in_chunks(
        session, lambda chunk: select(Unit.id, Unit.text).where(Unit.id.in_(chunk)), translation_unit_ids
    )
    source_ids = await load_source_target_ids(
        session, [row.id for row in existing.values() if row.origin == ORIGIN_TRANSLATION]
    )
    source_rows = await select_in_chunks(
        session, lambda chunk: select(TargetSentence).where(TargetSentence.id.in_(chunk)), set(source_ids.values())
    )
    source_by_id = {row[0].id: row[0] for row in source_rows}

    docs ={doc.id: doc for doc in await session.scalars(select(TargetDoc).where(TargetDoc.bundle_id == bundle_id))}
    na_slots: dict[int, list[str]] = defaultdict(list)
    for doc_id, slot_key in await session.execute(
        select(TargetDocNaSlot.target_doc_id, TargetDocNaSlot.slot_key)
        .join(TargetDoc, TargetDoc.id == TargetDocNaSlot.target_doc_id)
        .where(TargetDoc.bundle_id == bundle_id)
    ):
        na_slots[doc_id].append(slot_key)
    steps: dict[int, set[int]] = defaultdict(set)
    for doc_id, step_no in await session.execute(
        select(WiStep.target_doc_id, WiStep.step_no)
        .join(TargetDoc, TargetDoc.id == WiStep.target_doc_id)
        .where(TargetDoc.bundle_id == bundle_id)
    ):
        steps[doc_id].add(step_no)
    return _State(
        units=units, decisions=decisions, cells=cells, group_of=group_of, existing=existing,
        removed=set(payload.removed_target_ids), sources=sources,
        translation_sources={
            target_id: source_by_id[source_id] for target_id, source_id in source_ids.items() if source_id in source_by_id
        },
        translation_texts={unit_id: text for unit_id, text in translation_rows},
        member_unit_ids=member_unit_ids, component_units=component_units, component_targets=component_targets,
        docs=docs, na_slots=na_slots, steps=steps,
        table_shapes=await load_table_shapes(session, [units[unit_id] for unit_id in table_unit_ids]),
        cell_positions=await load_cell_positions(session, [units[cell_id] for cell_id in group_of]),
    )


async def load_table_shapes(session: AsyncSession, table_units: list[Unit]) -> dict[int, tuple[int, int]]:
    table_ids = {unit.table_id for unit in table_units if unit.table_id is not None}
    if not table_ids:
        return {}
    rows = await session.execute(
        select(SourceTable.id, SourceTable.n_rows, SourceTable.n_cols).where(SourceTable.id.in_(table_ids))
    )
    return {table_id: (n_rows, n_cols) for table_id, n_rows, n_cols in rows}


async def load_cell_positions(session: AsyncSession, cell_units: list[Unit]) -> dict[int, tuple[int, int]]:
    """칸 문장 → 그 칸 블록의 (행, 열). 칸 문장은 칸 블록 하나 안의 범위다."""
    cells_by_block: dict[int, list[int]] = defaultdict(list)
    for cell in cell_units:
        cells_by_block[cell.spans[0][0]].append(cell.id)
    rows = await select_in_chunks(
        session,
        lambda chunk: select(SourceBlock.id, SourceBlock.row_index, SourceBlock.col_index).where(
            SourceBlock.id.in_(chunk)
        ),
        cells_by_block,
    )
    return {
        cell_id: (row_index, col_index)
        for block_id, row_index, col_index in rows
        for cell_id in cells_by_block[block_id]
    }


# --- 검사 ---


def _check_request_shape(payload: GroupSaveIn) -> None:
    if not (payload.units or payload.targets or payload.removed_target_ids):
        _reject("empty")
    duplicate_units = _find_duplicates(item.unit_id for item in payload.units)
    if duplicate_units:
        _reject("duplicate_unit", unit_ids=duplicate_units)
    duplicate_keys = _find_duplicates(item.key for item in payload.targets)
    if duplicate_keys:
        _reject("duplicate_key", keys=duplicate_keys)
    duplicate_targets = _find_duplicates(
        [item.id for item in payload.targets if item.id is not None] + payload.removed_target_ids
    )
    if duplicate_targets:
        _reject("duplicate_target", target_ids=duplicate_targets)
    repeated = [item.key for item in payload.targets if _find_duplicates(item.source_unit_ids)]
    if repeated:
        _reject("duplicate_source", keys=repeated)


def _check_revisions(payload: GroupSaveIn, state: _State) -> None:
    """낡은 단위 판단·새 문장을 모두 모아 409 하나로 — 하나라도 낡으면 묶음의 어느 행도 바꾸지 않는다."""
    conflicts = [
        {"entity": "unit", "id": item.unit_id, "current_revision": state.decisions[item.unit_id].revision}
        for item in payload.units
        if item.revision != state.decisions[item.unit_id].revision
    ]
    conflicts += [
        {"entity": "target", "id": item.id, "current_revision": state.existing[item.id].revision}
        for item in payload.targets
        if item.id is not None and item.revision != state.existing[item.id].revision
    ]
    if conflicts:
        raise_rule(409, "revision_conflict", conflicts=conflicts)


def _check_closure(payload: GroupSaveIn, state: _State) -> None:
    """닫힘 — 지금의 연결 요소(출처 연결과 표·칸 연결)에 든 새 문장은 모두 보냈고 단위는 모두 보낸 단위(와 칸 문장)이며,
    저장 뒤 출처도 보낸 단위 안이다.

    묶음 읽기·떼어 내기와 같은 그래프(collect_component)로 보므로 합침이나 표·칸을 반만 확정하거나 다른 단위의 새 문장을
    몰래 바꾸는 저장이 생기지 않는다(스펙 §6.8).
    """
    listed = {item.id for item in payload.targets if item.id is not None} | set(payload.removed_target_ids)
    outside_targets = state.component_targets - listed
    outside_units = state.component_units - state.member_unit_ids
    foreign_keys = [item.key for item in payload.targets if set(item.source_unit_ids) - state.units.keys()]
    if outside_targets or outside_units or foreign_keys:
        _reject(
            "not_closed", target_ids=sorted(outside_targets), unit_ids=sorted(outside_units), keys=foreign_keys
        )


def _check_dispositions(payload: GroupSaveIn, state: _State) -> None:
    """배정이면 그 단위(표는 칸 문장 포함)를 출처로 갖는 새 문장이 있고, 삭제·이동이면 없으며 사유가 있다.

    보낼 곳 없는 보류(unassigned)는 보류 저장에서만, 새 문장 없이 된다. 사유는 hold_reason이 맡는다.
    """
    sourced = {unit_id for item in payload.targets for unit_id in item.source_unit_ids}
    for item in payload.units:
        unit_ids = [item.unit_id]
        has_targets = bool({item.unit_id, *state.cells.get(item.unit_id, ())} & sourced)
        if item.disposition == "unassigned":
            if payload.action != "hold":
                _reject("hold_required", unit_ids=unit_ids)
            if has_targets:
                _reject("disposed_with_targets", unit_ids=unit_ids)
            continue
        if item.disposition == "assigned":
            if not has_targets:
                _reject("assigned_without_targets", unit_ids=unit_ids)
            continue
        if has_targets:
            _reject("disposed_with_targets", unit_ids=unit_ids)
        if not item.reason.strip():
            _reject("reason_required", unit_ids=unit_ids)
        if item.disposition == "move_external" and not item.move_target_code.strip():
            _reject("move_target_code_required", unit_ids=unit_ids)


def _check_location(item: TargetIn, doc: TargetDoc, state: _State) -> None:
    """SOP는 N/A가 아닌 칸(상위 칸 N/A는 하위 칸도 덮는다, R8), WI는 부분과 선언된 단계(또는 단계 없음)."""
    keys = [item.key]
    if doc.doc_type == "sop":
        if item.wi_step is not None or item.wi_part is not None:
            _reject("invalid_location", keys=keys)
        if item.slot_key not in SLOT_KEYS:
            _reject("unknown_slot", keys=keys)
        if any(is_within_slot(item.slot_key, na_slot) for na_slot in state.na_slots.get(doc.id, ())):
            _reject("na_slot", keys=keys)
        return
    if item.slot_key is not None:
        _reject("invalid_location", keys=keys)
    if item.wi_part is None:
        _reject("wi_part_required", keys=keys)
    if item.wi_step is not None and item.wi_step not in state.steps.get(doc.id, ()):
        _reject("unknown_wi_step", keys=keys)


def _check_locked(item: TargetIn, row: TargetSentence) -> None:
    """입구 2 새 문장은 새 문서 원문 그대로다 — 출처와 변경 종류만 바꾸고 자리·글자·언어·격자·칸 자리를 바꾸면 422."""
    is_changed = (
        (item.target_doc_id is not None and item.target_doc_id != row.target_doc_id)
        or (item.slot_key, item.wi_step, item.wi_part) != (row.slot_key, row.wi_step, row.wi_part)
        or (item.text is not None and item.text != row.confirmed_text)
        or (item.lang is not None and item.lang != row.lang)
        or (item.grid is not None and item.grid.model_dump() != row.grid)
        or (item.cell_row is not None and item.cell_row != row.cell_row)
        or (item.cell_col is not None and item.cell_col != row.cell_col)
    )
    if is_changed:
        _reject("match_target_locked", keys=[item.key])


def _read_place(row: TargetSentence) -> _Place:
    return _Place(row.target_doc_id, row.slot_key, row.wi_step, row.wi_part, row.cell_row, row.cell_col, row.parent_target_id)


def _get_saved_place(plan: _Plan) -> _Place:
    """기존 새 문장의 저장 뒤 자리 — 입구 2 새 문장은 자리가 잠겨 있어 지금 자리다."""
    if plan.origin == ORIGIN_NEW_DOC:
        return _read_place(plan.row)
    item = plan.item
    parent_id = plan.parent.row.id if plan.parent is not None and plan.parent.row is not None else None
    return _Place(plan.doc.id, item.slot_key, item.wi_step, item.wi_part, plan.cell_row, plan.cell_col, parent_id)


def _is_sent_at(item: TargetIn, place: _Place) -> bool:
    """보낸 자리가 place인가 — 비운 칸은 어느 자리와도 맞는다. 칸 키·단계·부분은 함께 비우거나 함께 맞아야 한다."""
    return (
        item.target_doc_id in (None, place.doc_id)
        and (item.slot_key, item.wi_step, item.wi_part) in ((None, None, None), place[1:4])
        and item.cell_row in (None, place.cell_row)
        and item.cell_col in (None, place.cell_col)
    )


def _settle_translation_place(plan: _Plan, by_row_id: dict[int, _Plan], state: _State) -> None:
    """번역의 저장 뒤 자리를 정한다 — 출처가 있으면 출처의 저장 뒤 자리다(스펙 §7.9). 사람은 글만 고치고, 행에 쓰는 것은 sweep_translations다.

    보내는 자리는 비었거나 지금 자리이거나 출처의 저장 뒤 자리여야 한다. 표를 옮기는 저장이 칸 번역을 묶음째 되보내면 셋 다 나온다.
    칸 부모 검사가 끝자리를 보도록 _link_cell_target보다 먼저 돈다.
    """
    row = plan.row
    places = [_read_place(row)]
    source = state.translation_sources.get(row.id)
    if source is not None:
        source_plan = by_row_id.get(source.id)
        places.append(_get_saved_place(source_plan) if source_plan is not None else _read_place(source))
    if plan.item.source_unit_ids or not any(_is_sent_at(plan.item, place) for place in places):
        _reject("translation_locked", keys=[plan.item.key])
    plan.doc, plan.cell_row, plan.cell_col = state.docs[places[-1].doc_id], places[-1].cell_row, places[-1].cell_col


def _check_source_kinds(item: TargetIn, state: _State) -> None:
    """문장은 문장·제목·칸 문장에서, 표는 표·행 단위 하나에서, 그림은 그림 단위 하나에서 온다(R28)."""
    kinds = [state.units[unit_id].kind for unit_id in item.source_unit_ids]
    if item.kind == "sentence":
        if any(kind not in SENTENCE_SOURCE_KINDS for kind in kinds):
            _reject("kind_mismatch", keys=[item.key])
        return
    allowed = TABLE_UNIT_KINDS if item.kind == "table" else ("figure",)
    if len(kinds) > 1 or any(kind not in allowed for kind in kinds):
        _reject(f"invalid_{item.kind}_target", keys=[item.key])


def _resolve_lang(item: TargetIn, row: TargetSentence | None, state: _State) -> str:
    """문장 새 문장의 언어는 모든 출처 단위의 언어(출처가 없는 번역은 행의 언어), 표·그림은 중립."""
    if item.kind != "sentence":
        expected = NEUTRAL
    else:
        langs = {state.units[unit_id].lang for unit_id in item.source_unit_ids}
        if len(langs) > 1:
            _reject("lang_mismatch", keys=[item.key])
        expected = langs.pop() if langs else (row.lang if row is not None else NEUTRAL)
    is_locked_mismatch = row is not None and row.origin == ORIGIN_NEW_DOC and row.lang != expected
    if is_locked_mismatch or (item.lang is not None and item.lang != expected):
        _reject("lang_mismatch", keys=[item.key])
    return expected


def _resolve_text(item: TargetIn, row: TargetSentence | None, state: _State) -> str:
    """확정 글자 — 비운 새 새 문장에 출처가 하나면 원문 그대로(그대로 보내기, 스펙 §7.7). 표·그림은 글자가 없다.

    비운 기존 새 문장은 지금 글을 두고, 아직 확정 글이 없는 AI 새 문장이면 제안 글로 확정한다.
    """
    keys = [item.key]
    if item.kind != "sentence":
        if item.text:
            _reject(f"invalid_{item.kind}_target", keys=keys)
        return row.confirmed_text if row is not None else ""
    if item.text is not None:
        text = item.text
    elif row is not None:
        text = row.confirmed_text or row.ai_text
    elif len(item.source_unit_ids) == 1:
        text = state.units[item.source_unit_ids[0]].text
    else:
        _reject("empty_text", keys=keys)
    if not has_visible_char(text):
        _reject("empty_text", keys=keys)
    return text


def _resolve_grid(item: TargetIn, row: TargetSentence | None) -> dict[str, int] | None:
    if item.kind != "table":
        if item.grid is not None:
            _reject("unexpected_grid", keys=[item.key])
        return None
    grid = item.grid.model_dump() if item.grid is not None else (row.grid if row is not None else None)
    if grid is None:
        _reject("invalid_table_target", keys=[item.key])
    return grid


def _plan_target(item: TargetIn, state: _State) -> _Plan:
    """검사 5–8(위치·언어·종류·글자) — 새 문장은 assign 문서에만 만들고, 입구 2 새 문장은 출처·변경 종류만, 번역 새 문장은 글만 바뀐다."""
    keys = [item.key]
    row = state.existing[item.id] if item.id is not None else None
    origin = row.origin if row is not None else ORIGIN_UNITS
    if row is not None and item.kind != row.kind:
        _reject("match_target_locked" if origin == ORIGIN_NEW_DOC else "kind_locked", keys=keys)
    doc_id = item.target_doc_id if item.target_doc_id is not None else (row.target_doc_id if row is not None else None)
    if doc_id is None:
        _reject("target_doc_required", keys=keys)
    doc = state.docs.get(doc_id)
    if doc is None:
        _reject("unknown_target_doc", keys=keys)
    if row is not None and origin == ORIGIN_NEW_DOC:
        _check_locked(item, row)
    elif origin != ORIGIN_TRANSLATION:  # 번역의 자리는 출처를 봐야 해서 모든 계획이 선 뒤에 본다(_settle_translation_place)
        if doc.entrance == "match":
            _reject("match_doc_new_target", keys=keys)
        if not item.source_unit_ids:
            _reject("sources_required", keys=keys)
        _check_location(item, doc, state)
    _check_source_kinds(item, state)
    return _Plan(
        item=item, row=row, doc=doc, origin=origin, sources=list(item.source_unit_ids),
        lang=_resolve_lang(item, row, state), text=_resolve_text(item, row, state), grid=_resolve_grid(item, row),
        cell_row=item.cell_row if item.cell_row is not None else (row.cell_row if row is not None else None),
        cell_col=item.cell_col if item.cell_col is not None else (row.cell_col if row is not None else None),
    )


def _link_cell_target(plan: _Plan, by_key: dict[str, _Plan], state: _State) -> None:
    """검사 7 — 칸 새 문장은 같은 요청의 표 새 문장 아래, 같은 새 문서·자리, 격자 안, 출처는 그 표 단위에 묶인 칸 문장 하나.

    기존 칸 새 문장의 부모는 바뀌지 않는다. 입구 2 칸 새 문장은 구조가 새 문서 그대로라 parent_key를 비워도 된다.
    칸 번역도 자리가 정해져 있어 비워도 되지만, 함께 지워질 표 아래에는 남을 수 없다(부모를 지우면 DB CASCADE로 같이 사라진다).
    """
    item, row = plan.item, plan.row
    keys = [item.key]
    current_parent = row.parent_target_id if row is not None else None
    if item.parent_key is None:
        is_kept = plan.origin == ORIGIN_NEW_DOC or (
            plan.origin == ORIGIN_TRANSLATION and current_parent not in state.removed
        )
        if current_parent is not None and not is_kept:
            _reject("invalid_cell_target", keys=keys)
        plan.is_cell = current_parent is not None
        if not plan.is_cell and (plan.cell_row is not None or plan.cell_col is not None):
            _reject("invalid_cell_target", keys=keys)
        return
    parent = by_key.get(item.parent_key)
    if parent is None or parent.item.kind != "table" or item.kind != "sentence" or parent.doc.id != plan.doc.id:
        _reject("invalid_cell_target", keys=keys)
    if row is not None and (parent.row is None or parent.row.id != current_parent):
        _reject("invalid_cell_target", keys=keys)
    if plan.cell_row is None or plan.cell_col is None or parent.grid is None:
        _reject("invalid_cell_target", keys=keys)
    if plan.cell_row >= parent.grid["rows"] or plan.cell_col >= parent.grid["cols"]:
        _reject("invalid_cell_target", keys=keys)
    if plan.origin not in (ORIGIN_NEW_DOC, ORIGIN_TRANSLATION):
        location = (item.slot_key, item.wi_step, item.wi_part)
        parent_location = (parent.item.slot_key, parent.item.wi_step, parent.item.wi_part)
        table_unit_id = parent.sources[0] if parent.sources else None
        if location != parent_location or len(plan.sources) != 1 or state.group_of.get(plan.sources[0]) != table_unit_id:
            _reject("invalid_cell_target", keys=keys)
    plan.parent, plan.is_cell = parent, True


def _decide_change_type(
    plan: _Plan, spread: Counter[tuple[int, int]], reasons: dict[int, str], state: _State
) -> str:
    """검사 9 — 구조에서 나오는 종류(번역·신규·합침·나눔)가 먼저, 그다음 사람이 고른 글자 비교 종류."""
    keys = [plan.item.key]
    requested = plan.item.change_type
    if plan.origin == ORIGIN_TRANSLATION:
        return "translated"
    if not plan.sources:
        return "new"
    if plan.item.kind == "table":
        if requested in (None, "as_is"):
            return "as_is"
        if requested != "table_restructured":
            _reject("invalid_change_type", keys=keys)
        if not reasons.get(plan.sources[0]):
            _reject("reason_required", keys=keys, unit_ids=[plan.sources[0]])
        return requested
    if plan.item.kind == "figure":
        if requested not in (None, "as_is"):
            _reject("invalid_change_type", keys=keys)
        return "as_is"
    if len(plan.sources) >= 2:
        return "merged"
    source_id = plan.sources[0]
    if not plan.is_cell and spread[(source_id, plan.doc.id)] >= 2:
        return "split"
    if plan.text == state.units[source_id].text:
        return "as_is"
    if requested is None and plan.item.text is None and plan.row is not None and (
        plan.row.ai_text or (plan.row.suggestion_id is not None and set(plan.sources) == state.sources[plan.row.id])
    ):
        # 글을 비워 제안을 받으면 그 제안의 종류도 받는다 — 입구 2는 글이 잠겨 ai_text가 없어 제안의 출처 그대로일 때 받는다.
        # 사람이 쓴 새 문장의 종류는 사람이 고르고(스펙 §6.7), 나눔·합침은 구조에서 나와 지금 구조와 어긋날 수 있어 받지 않는다
        requested = plan.row.change_type if plan.row.change_type in TEXT_CHANGE_TYPES else None
    if requested is None:
        _reject("change_type_required", keys=keys)
    # 글자가 다른데 "그대로"라고 하면 결과물이 원문과 다른 글을 그대로라고 적는다
    if requested not in TEXT_CHANGE_TYPES:
        _reject("invalid_change_type", keys=keys)
    return requested


def _find_parent_plan(plan: _Plan, by_row_id: dict[int, _Plan]) -> _Plan | None:
    """칸 새 문장의 표 새 문장 — 입구 2 칸 새 문장은 parent_key 없이 지금 부모로 묶이므로 행의 부모도 본다."""
    if plan.parent is None and plan.row is not None and plan.row.parent_target_id is not None:
        return by_row_id.get(plan.row.parent_target_id)
    return plan.parent


def _check_as_is_table(plan: _Plan, by_row_id: dict[int, _Plan], state: _State) -> None:
    """그대로인 표는 원문 표 모양(행 단위면 한 행)을 지키고, 그 칸 새 문장은 원래 칸 자리에 있다(R27)."""
    keys = [plan.item.key]
    if plan.item.kind == "table" and plan.change_type == "as_is":
        unit = state.units[plan.sources[0]]
        n_rows, n_cols = state.table_shapes[unit.table_id]
        if plan.grid != {"rows": 1 if unit.kind == "table_row" else n_rows, "cols": n_cols}:
            _reject("grid_mismatch", keys=keys)
    parent = _find_parent_plan(plan, by_row_id)
    if parent is None or parent.change_type != "as_is" or len(plan.sources) != 1:
        return
    table_unit = state.units[parent.sources[0]]
    if state.group_of.get(plan.sources[0]) != table_unit.id:  # 입구 2 칸 새 문장이 칸 아닌 문장과 짝지어진 경우
        return
    row_index, col_index = state.cell_positions[plan.sources[0]]
    if table_unit.kind == "table_row":
        row_index -= table_unit.row_index or 0
    if (plan.cell_row, plan.cell_col) != (row_index, col_index):
        _reject("cell_position_mismatch", keys=keys)


def _check_as_is_table_cells(plans: list[_Plan], by_row_id: dict[int, _Plan], state: _State) -> None:
    """그대로인 표는 묶인 활성 칸 문장마다 칸 새 문장이 정확히 하나다 — 빠지면 그 칸 글이 결과물에 "그대로"로 적힌 채 사라진다(R27).

    표 구성 변경(사유 필수)은 칸을 빼거나 바꿔 담을 수 있다.
    """
    cell_sources: dict[str, Counter[int]] = defaultdict(Counter)  # 표 새 문장 key → 칸 문장 → 그것을 출처로 둔 칸 새 문장 수
    for plan in plans:
        parent = _find_parent_plan(plan, by_row_id)
        if parent is not None:
            cell_sources[parent.item.key].update(plan.sources)
    for plan in plans:
        if plan.item.kind == "table" and plan.change_type == "as_is":
            counts = cell_sources[plan.item.key]
            missing = sorted(cell_id for cell_id in state.cells.get(plan.sources[0], ()) if counts[cell_id] != 1)
            if missing:
                _reject("table_cells_missing", unit_ids=missing)


def _check_duplicates(payload: GroupSaveIn, plans: list[_Plan], state: _State) -> None:
    """검사 10 — 한 단위(칸 새 문장은 부모 표로 접어)의 새 문장이 서로 다른 새 문서 둘 이상이면 사유가 있어야 한다(스펙 §6.9)."""
    docs_by_unit: dict[int, set[int]] = defaultdict(set)
    for plan in plans:
        for unit_id in plan.sources:
            docs_by_unit[state.group_of.get(unit_id, unit_id)].add(plan.doc.id)
    offenders = sorted(
        item.unit_id for item in payload.units if len(docs_by_unit[item.unit_id]) >= 2 and not item.reason.strip()
    )
    if offenders:
        _reject("duplicate_without_reason", unit_ids=offenders)


# --- 쓰기 ---


def _set_human_status(
    item: UnitDecision | TargetSentence, action: str, hold_reason: str, actor: str, stamp: datetime
) -> None:
    """사람의 확정·보류 — 보류는 확정한 사람·시각을 비운다(지금은 확정 상태가 아니다)."""
    if action == "confirm":
        item.status, item.hold_reason, item.confirmed_by, item.confirmed_at = CONFIRMED, "", actor, stamp
    else:
        item.status, item.hold_reason, item.confirmed_by, item.confirmed_at = ON_HOLD, hold_reason, None, None


async def _load_next_orders(session: AsyncSession, plans: list[_Plan]) -> dict[int, int]:
    """순서를 사람이 정한(manual_order) 새 문서에 새로 들어오는 새 문장의 다음 순서 — 그 문서 최댓값 + 1부터."""
    doc_ids = {
        plan.doc.id for plan in plans
        if plan.doc.manual_order and not plan.is_cell and (plan.row is None or plan.row.target_doc_id != plan.doc.id)
    }
    if not doc_ids:
        return {}
    rows = await session.execute(
        select(TargetSentence.target_doc_id, func.max(TargetSentence.order_index))
        .where(TargetSentence.target_doc_id.in_(doc_ids))
        .group_by(TargetSentence.target_doc_id)
    )
    current = dict(rows.tuples().all())
    return {doc_id: current.get(doc_id, -1) + 1 for doc_id in doc_ids}


def _is_text_changed(plan: _Plan) -> bool:
    """이 저장이 지금 글을 바꾸는가 — AI 글을 그대로 확정하는 것은 바뀐 것이 아니다. 쓰기 전에 견준다."""
    return plan.text != (plan.row.confirmed_text or plan.row.ai_text)


def _is_source_changed(plan: _Plan, state: _State) -> bool:
    """이 저장이 기존 새 문장의 글·자리·출처 단위를 바꾸는가 — 번역은 그것을 옮긴 것이라 다시 봐야 한다. 쓰기 전에 견준다."""
    if plan.row is None or plan.origin == ORIGIN_TRANSLATION:
        return False
    return (
        _is_text_changed(plan)
        or _get_saved_place(plan) != _read_place(plan.row)
        or set(plan.sources) != state.sources[plan.row.id]
    )


def _is_echoed(plan: _Plan, changed: set[int], state: _State) -> bool:
    """출처가 바뀌었는데 글을 고치지 않은 번역인가 — 표 저장은 닫힘 때문에 칸 번역을 늘 담으므로 되보냄은 사람이 본 것이 아니다."""
    if plan.origin != ORIGIN_TRANSLATION or _is_text_changed(plan):
        return False
    source = state.translation_sources.get(plan.row.id)
    return source is not None and source.id in changed


def _list_check_texts(plan: _Plan, state: _State) -> list[str]:
    """문장 검사의 원문 — 번역은 출처 연결이 없어 번역 출처 단위의 글과 언어를 넘어 비교한다(스펙 §7.12)."""
    if plan.origin == ORIGIN_TRANSLATION:
        return [state.translation_texts[plan.row.translation_source_unit_id]]
    return [state.units[unit_id].text for unit_id in plan.sources]


def _apply_plan(
    session: AsyncSession,
    plan: _Plan,
    state: _State,
    next_orders: dict[int, int],
    *,
    bundle_id: int,
    action: str,
    hold_reason: str,
    actor: str,
    stamp: datetime,
) -> TargetSentence:
    target = plan.row
    if target is None:
        target = TargetSentence(bundle_id=bundle_id, origin=ORIGIN_UNITS, section_path="", ai_text="", revision=0)
        session.add(target)
    elif target.confirmed_text and plan.text != target.confirmed_text:  # 첫 확정의 AI 새 문장은 이전 확정 글이 없다
        session.add(TargetTextHistory(target_id=target.id, previous_text=target.confirmed_text, changed_by=actor))
    if plan.origin == ORIGIN_TRANSLATION:
        target.confirmed_text = plan.text
    elif plan.origin != ORIGIN_NEW_DOC:
        if target.target_doc_id != plan.doc.id:
            # 순서를 사람이 정한 문서면 끝에, 아니면 결과물이 출처 위치로 정렬하므로 0
            is_appended = plan.doc.manual_order and not plan.is_cell
            target.order_index = next_orders[plan.doc.id] if is_appended else 0
            if is_appended:
                next_orders[plan.doc.id] += 1
        place = (plan.doc.id, plan.item.slot_key, plan.item.wi_step, plan.item.wi_part)
        if place != (target.target_doc_id, target.slot_key, target.wi_step, target.wi_part):
            target.indent_level = 0  # 깊이는 그 칸 앞뒤 줄에 기댄 값이라 다른 칸으로 가면 맨 바깥에서 다시 시작한다
        target.target_doc_id = plan.doc.id
        target.slot_key, target.wi_step, target.wi_part = plan.item.slot_key, plan.item.wi_step, plan.item.wi_part
        target.kind, target.lang, target.confirmed_text, target.grid = plan.item.kind, plan.lang, plan.text, plan.grid
        target.cell_row, target.cell_col = (plan.cell_row, plan.cell_col) if plan.is_cell else (None, None)
        target.parent_target_id = plan.parent.row.id if plan.parent is not None and plan.parent.row else None
    target.change_type = plan.change_type
    check_texts = _list_check_texts(plan, state)
    target.warnings = check_sentence(check_texts, plan.text) if plan.item.kind == "sentence" and check_texts else []
    _set_human_status(target, action, hold_reason, actor, stamp)
    target.revision += 1
    plan.row = target
    return target


async def _write_group(
    session: AsyncSession, bundle_id: int, payload: GroupSaveIn, plans: list[_Plan], state: _State, actor: str
) -> list[int]:
    """검사를 모두 통과한 묶음을 쓴다 — 지울 새 문장, 새 문장(표 먼저, 칸은 부모 id를 안 뒤), 출처, 판단, 글·자리가 바뀐 새 문장의 번역, 기록. 쓴 새 문장 id를 돌려준다."""
    stamp = now()
    hold_reason = payload.hold_reason.strip() if payload.action == "hold" else ""
    changed = state.removed | {plan.row.id for plan in plans if _is_source_changed(plan, state)}
    echoed = {plan.row.id for plan in plans if _is_echoed(plan, changed, state)}
    edited = {plan.row.id for plan in plans if plan.origin == ORIGIN_TRANSLATION and _is_text_changed(plan)}
    # 되보낸 번역은 쓰지 않는다 — 쓰면 AI 번역이 확정이 되고 채택이 남는다. 정리는 아래 sweep_translations가 한다
    plans = [plan for plan in plans if plan.row is None or plan.row.id not in echoed]
    removed = [state.existing[target_id] for target_id in payload.removed_target_ids]
    # 지운 번역과 판단 없는 입구 2 제안(신규)은 사람이 버린 제안이다 — 지우면 제안을 가리키는 칸이 사라지므로 먼저 남긴다.
    # 판단이 가리키는 짝 제안은 지운 새 문장이 있어도 뒤의 채택 기록이 정한다
    await reject_suggestions(
        session,
        {target.suggestion_id for target in removed if target.origin != ORIGIN_UNITS}
        - {decision.suggestion_id for decision in state.decisions.values()} - {None},
        actor,
    )
    if removed:
        await session.execute(delete(TargetSource).where(TargetSource.target_id.in_([t.id for t in removed])))
    dropped = [target for target in removed if target.origin != ORIGIN_NEW_DOC]
    for target in removed:
        if target.origin == ORIGIN_NEW_DOC:  # 입구 2 새 문장은 새 문서 원문이라 지우지 않고 미배정으로
            reset_target(target)
    if dropped:
        await session.execute(
            delete(TargetSentence)
            .where(TargetSentence.id.in_([target.id for target in dropped]))
            .execution_options(synchronize_session=False)
        )
        for target in dropped:
            session.expunge(target)

    next_orders = await _load_next_orders(session, plans)
    written: list[TargetSentence] = []
    for is_cell in (False, True):
        for plan in plans:
            if plan.is_cell == is_cell:
                written.append(_apply_plan(
                    session, plan, state, next_orders, bundle_id=bundle_id, action=payload.action,
                    hold_reason=hold_reason, actor=actor, stamp=stamp,
                ))
        await session.flush()  # 칸 새 문장이 부모 id를, 출처 연결이 새 문장 id를 알아야 한다

    rewritten = [plan.item.id for plan in plans if plan.item.id is not None]
    if rewritten:
        await session.execute(delete(TargetSource).where(TargetSource.target_id.in_(rewritten)))
    links = [
        {"target_id": plan.row.id, "unit_id": unit_id, "seq": seq}
        for plan in plans if plan.row is not None
        for seq, unit_id in enumerate(plan.sources)
    ]
    if links:
        await session.execute(insert(TargetSource), links)

    for item in payload.units:
        decision = state.decisions[item.unit_id]
        decision.disposition = item.disposition
        decision.move_target_code = item.move_target_code.strip() if item.disposition == "move_external" else ""
        decision.reason = item.reason.strip()
        _set_human_status(decision, payload.action, hold_reason, actor, stamp)
        decision.revision += 1
    await record_group_adoption(
        session, plans=plans, payload=payload, decisions=state.decisions, actor=actor, stamp=stamp
    )
    swept = await sweep_translations(session, bundle_id, changed, exempt=edited)
    unit_ids = [item.unit_id for item in payload.units]
    record_event(
        session, bundle_id=bundle_id, actor=actor, action=f"group.{payload.action}",
        target_type="unit" if unit_ids else "target",
        target_ids=unit_ids or [*(target.id for target in written), *payload.removed_target_ids], reason=hold_reason,
    )
    await session.flush()
    return [*(target.id for target in written), *(echoed - swept)]


# --- 진입점 ---


async def save_group(session: AsyncSession, bundle: Bundle, payload: GroupSaveIn, actor: str) -> GroupOut:
    """관계 묶음(한 요청에 여럿 가능)을 검사 1–11 순서로 모두 확인한 뒤 한 트랜잭션으로 쓴다. 커밋은 호출부가 한다.

    검사가 쓰기 전에 모두 끝나므로 거절된 요청은 아무것도 바꾸지 않는다(낡은 revision 하나도 전체 409).
    """
    await lock_bundle(session, bundle)
    ensure_editable(bundle)
    _check_request_shape(payload)
    state = await _load_state(session, bundle.id, payload)
    _check_revisions(payload, state)
    _check_closure(payload, state)
    _check_dispositions(payload, state)
    plans = [_plan_target(item, state) for item in payload.targets]
    by_key = {plan.item.key: plan for plan in plans}
    by_row_id = {plan.row.id: plan for plan in plans if plan.row is not None}
    for plan in plans:
        if plan.origin == ORIGIN_TRANSLATION:
            _settle_translation_place(plan, by_row_id, state)
    for plan in plans:
        _link_cell_target(plan, by_key, state)
    reasons = {item.unit_id: item.reason.strip() for item in payload.units}
    spread = Counter(
        (unit_id, plan.doc.id)
        for plan in plans if plan.item.kind == "sentence" and not plan.is_cell
        for unit_id in plan.sources
    )
    for plan in plans:
        plan.change_type = _decide_change_type(plan, spread, reasons, state)
    for plan in plans:
        _check_as_is_table(plan, by_row_id, state)
    _check_as_is_table_cells(plans, by_row_id, state)
    _check_duplicates(payload, plans, state)
    if payload.action == "hold" and not payload.hold_reason.strip():
        _reject("hold_reason_required")
    target_ids = await _write_group(session, bundle.id, payload, plans, state, actor)
    return await build_group_out(session, unit_ids=[item.unit_id for item in payload.units], target_ids=target_ids)


async def _find_units_with_targets(session: AsyncSession, unit_ids: Collection[int]) -> list[int]:
    """새 문장의 출처인 단위 — 표·행 단위는 칸 문장이 출처여도 센다."""
    wanted = set(unit_ids)
    rows = await select_in_chunks(
        session,
        lambda chunk: select(TargetSource.unit_id, Unit.group_unit_id)
        .join(Unit, Unit.id == TargetSource.unit_id)
        .where(or_(TargetSource.unit_id.in_(chunk), Unit.group_unit_id.in_(chunk))),
        unit_ids,
    )
    return sorted({unit_id if unit_id in wanted else group_unit_id for unit_id, group_unit_id in rows})


async def dispose_units(
    session: AsyncSession, bundle: Bundle, payload: BulkDecisionIn, actor: str
) -> list[UnitDecisionRowOut]:
    """여러 단위를 같은 삭제·이동 사유로 확정한다 — 단위마다 따로 저장한 것과 같고, 새 문장이 달린 단위가 섞이면 409.

    AI 제안 단위가 섞여도 409다 — AI 제안은 사람이 줄마다 본다(스펙 §7.7). 사람이 보류해 둔 제안 단위는 지날 수 있어 채택을 남긴다.
    """
    await lock_bundle(session, bundle)
    ensure_editable(bundle)
    unit_ids = [item.unit_id for item in payload.units]
    duplicates = _find_duplicates(unit_ids)
    if duplicates:
        raise_rule(422, "duplicate_units", unit_ids=duplicates)
    loaded = await _load_decision_units(session, bundle.id, unit_ids)
    conflicts = [
        {"entity": "unit", "id": item.unit_id, "current_revision": loaded[item.unit_id][1].revision}
        for item in payload.units
        if item.revision != loaded[item.unit_id][1].revision
    ]
    if conflicts:
        raise_rule(409, "revision_conflict", conflicts=conflicts)
    suggested = sorted(unit_id for unit_id, (_, decision) in loaded.items() if decision.status == AI_SUGGESTED)
    if suggested:
        raise_rule(409, "ai_suggested_units", unit_ids=suggested)
    with_targets = await _find_units_with_targets(session, unit_ids)
    if with_targets:
        raise_rule(409, "unit_has_targets", unit_ids=with_targets)
    stamp = now()
    for unit_id in unit_ids:
        decision = loaded[unit_id][1]
        decision.disposition, decision.reason = payload.action, payload.reason
        decision.move_target_code = payload.move_target_code if payload.action == "move_external" else ""
        _set_human_status(decision, "confirm", "", actor, stamp)
        decision.revision += 1
    await record_unit_adoption(
        session, plans=(), dispositions=dict.fromkeys(unit_ids, payload.action),
        decisions={unit_id: loaded[unit_id][1] for unit_id in unit_ids}, actor=actor, stamp=stamp,
    )
    record_event(
        session, bundle_id=bundle.id, actor=actor, action="decision.bulk", target_type="unit", target_ids=unit_ids,
        reason=payload.reason,
    )
    await session.flush()
    return [UnitDecisionRowOut(unit_id=unit_id, decision=DecisionOut.model_validate(loaded[unit_id][1])) for unit_id in unit_ids]


async def clear_unit(session: AsyncSession, bundle: Bundle, payload: ClearIn, actor: str) -> DetachReport:
    """배정 지우기 — 단위 하나를 떼어 내 미배정으로 돌리고 같은 관계 묶음의 나머지는 보류로 둔다(detach_units)."""
    await lock_bundle(session, bundle)
    ensure_editable(bundle)
    loaded = await _load_decision_units(session, bundle.id, [payload.unit_id])
    decision = loaded[payload.unit_id][1]
    check_revision("unit", payload.unit_id, payload.revision, decision.revision)
    if decision.suggestion_id is not None:  # 떼어 내기가 이 칸을 비우므로 먼저 남긴다
        await reject_suggestions(session, [decision.suggestion_id], actor)
    report = await detach_units(session, bundle_id=bundle.id, unit_ids=[payload.unit_id], cause="cleared", actor=actor)
    if report.reset_unit_ids or report.deleted_target_ids or report.held_unit_ids or report.held_target_ids:
        record_event(
            session, bundle_id=bundle.id, actor=actor, action="decision.clear", target_type="unit",
            target_ids=[payload.unit_id],
        )
    await session.flush()
    return report


async def reset_assignments(session: AsyncSession, bundle: Bundle, payload: ResetIn, actor: str) -> ResetOut:
    """배정 초기화 — 문서(또는 묶음 전체)의 배정된 단위를 detach_units 한 번으로 미배정으로 돌린다.

    dry_run은 같은 길을 끝까지 돌린 뒤 롤백해 건수를 얻는다 — 미리 보기와 실제 건수가 어긋날 수 없다. 커밋은 호출부가 하되
    dry_run이면 이 함수가 이미 되돌렸다. 다른 문서와 묶인 문장은 detach_units 규칙대로 보류로 간다.
    """
    await lock_bundle(session, bundle)
    ensure_editable(bundle)
    check_revision("bundle", bundle.id, payload.revision, bundle.revision)
    if payload.document_id is not None:
        document = await session.get(Document, payload.document_id)
        if document is None or document.bundle_id != bundle.id or document.side != "old":
            raise_rule(404, "document_not_found")
    active_jobs = await session.scalar(
        select(func.count()).select_from(AiJob).where(AiJob.bundle_id == bundle.id, AiJob.status.in_(("queued", "running")))
    )
    if active_jobs:
        raise_rule(409, "ai_job_active", jobs=active_jobs)
    statement = (
        select(UnitDecision)
        .join(Unit, Unit.id == UnitDecision.unit_id)
        .join(Extraction, Extraction.id == Unit.extraction_id)
        .join(Document, Document.id == Extraction.document_id)
        .where(
            Document.bundle_id == bundle.id, Document.side == "old", Unit.status == UNIT_ACTIVE,
            Unit.group_unit_id.is_(None),
        )
    )
    if payload.document_id is not None:
        statement = statement.where(Document.id == payload.document_id)
    decisions = [row for row in (await session.scalars(statement)).all() if not is_unassigned(row)]
    suggestion_ids = sorted({row.suggestion_id for row in decisions if row.suggestion_id is not None})
    if suggestion_ids:  # 떼어 내기가 칸을 비우므로 먼저 남긴다
        await reject_suggestions(session, suggestion_ids, actor)
    report = DetachReport(reset_unit_ids=[], deleted_target_ids=[], held_unit_ids=[], held_target_ids=[])
    if decisions:
        report = await detach_units(
            session, bundle_id=bundle.id, unit_ids=[row.unit_id for row in decisions], cause="cleared", actor=actor
        )
    out = ResetOut(
        dry_run=payload.dry_run, unassigned_units=len(report.reset_unit_ids), deleted_targets=len(report.deleted_target_ids),
        held_units=len(report.held_unit_ids), held_targets=len(report.held_target_ids),
    )
    if payload.dry_run:
        await session.rollback()
        return out
    if decisions:
        record_event(
            session, bundle_id=bundle.id, actor=actor, action="decision.reset",
            target_type="bundle" if payload.document_id is None else "document",
            target_ids=[bundle.id if payload.document_id is None else payload.document_id],
            detail=out.model_dump(exclude={"dry_run"}),
        )
    await session.flush()
    return out


def _join_unit_decisions(statement: Select[Any], group_decision: AliasedClass[UnitDecision]) -> Select[Any]:
    """단위 → 문서·자기 판단, 그리고 묶인 칸 문장이면 그룹 단위의 판단(바깥 조인)."""
    return (
        statement.join(Extraction, Extraction.id == Unit.extraction_id)
        .join(Document, Document.id == Extraction.document_id)
        .join(UnitDecision, UnitDecision.unit_id == Unit.id)
        .outerjoin(group_decision, group_decision.unit_id == Unit.group_unit_id)
    )


async def list_units(
    session: AsyncSession,
    bundle_id: int,
    *,
    lang: str | None,
    status: str | None,
    document_id: int | None,
    target_doc_id: int | None,
    limit: int,
    offset: int,
) -> UnitsPageOut:
    """옛 문서 활성 단위(판단 가능 단위 전부) — 판단·새 문장 id·짝·커버 상태. 정렬 키 순이고 질의는 넷(개수·쪽·새 문장·짝)이다."""
    group_decision = aliased(UnitDecision)
    # 상태로 거르려면 SQL이 커버 상태를 알아야 한다 — get_cover_status와 같은 규칙(그룹 단위 판단이 먼저)
    cover_status = func.coalesce(group_decision.status, UnitDecision.status)
    conditions = [Document.bundle_id == bundle_id, Document.side == "old", Unit.status == UNIT_ACTIVE]
    if lang is not None:
        conditions.append(Unit.lang == lang)
    if status is not None:
        conditions.append(cover_status == status)
    if document_id is not None:
        conditions.append(Document.id == document_id)
    if target_doc_id is not None:
        conditions.append(
            Unit.id.in_(
                select(TargetSource.unit_id)
                .join(TargetSentence, TargetSentence.id == TargetSource.target_id)
                .where(TargetSentence.target_doc_id == target_doc_id)
            )
        )
    total = await session.scalar(
        _join_unit_decisions(select(func.count()).select_from(Unit), group_decision).where(*conditions)
    )
    rows = (
        await session.execute(
            _join_unit_decisions(select(Unit, Document, UnitDecision, group_decision), group_decision)
            .where(*conditions)
            .order_by(Document.id, Unit.pos_seq, Unit.pos_start, Unit.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    target_ids: dict[int, list[int]] = defaultdict(list)
    if rows:
        links = await session.execute(
            select(TargetSource.unit_id, TargetSource.target_id)
            .where(TargetSource.unit_id.in_([unit.id for unit, *_ in rows]))
            .order_by(TargetSource.target_id)
        )
        for unit_id, target_id in links:
            target_ids[unit_id].append(target_id)
    pair_rows = await select_in_chunks(
        session,
        lambda chunk: select(UnitPairMember.unit_id, UnitPairMember.pair_id).where(UnitPairMember.unit_id.in_(chunk)),
        [unit.id for unit, *_ in rows],
    )
    pair_ids = {unit_id: pair_id for unit_id, pair_id in pair_rows}
    items = []
    for unit, document, decision, group in rows:
        decisions = {unit.id: decision} if group is None else {unit.id: decision, group.unit_id: group}
        items.append(
            UnitRowOut(
                unit_id=unit.id, document_id=document.id, display_id=compute_display_id(document, unit),
                kind=unit.kind, lang=unit.lang, text=unit.text, table_id=unit.table_id, row_index=unit.row_index,
                group_unit_id=unit.group_unit_id, pair_id=pair_ids.get(unit.id), status=get_cover_status(unit, decisions),
                decision=DecisionOut.model_validate(decision), target_ids=target_ids.get(unit.id, []),
            )
        )
    return UnitsPageOut(total=total or 0, items=items)
