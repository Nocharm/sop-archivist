"""입구 2 — 새 문서 단위에서 새 문장 만들기(절 경로·표·그림), 같은 글자 1:1 후보, 같은 글자 짝·신규 한 번에 확정 (스펙 §6.7, §7.7)."""

from collections import Counter, defaultdict
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Self

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import Row, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.clock import now
from app.sop.ai.adoption import adopt_suggestions
from app.sop.checks import check_sentence
from app.sop.decisions import NEUTRAL, SENTENCE_SOURCE_KINDS, DbId
from app.sop.detach import CONFIRMED, ORIGIN_NEW_DOC, UNASSIGNED, DetachReport, detach_units, is_unassigned
from app.sop.errors import raise_rule
from app.sop.events import record_event
from app.sop.groups import TABLE_UNIT_KINDS, GroupOut, build_group_out, select_in_chunks
from app.sop.membership import ensure_editable, lock_bundle
from app.sop.models import (
    Bundle,
    Document,
    Extraction,
    SourceBlock,
    SourceTable,
    TargetDoc,
    TargetSentence,
    TargetSource,
    Unit,
    UnitDecision,
)
from app.sop.units import UNIT_ACTIVE, get_latest_extraction_id

# 머리말·꼬리말은 양식 반복이라 새 문장을 만들지 않고 절 경로에도 넣지 않는다(스펙 §6.7)
REPEATED_PARTS = ("header", "footer")
# 본문 흐름 뒤에 오는 부분 — 이 부분이 처음 나오면 본문 절이 끝난다(추출기가 본문을 먼저 다 낸다)
TRAILING_PARTS = ("header", "footer", "footnote", "endnote")
SECTION_SEPARATOR = " › "
MAX_BULK_MATCH = 1000  # 한 번에 확정 요청의 같은 글자 짝 + 신규 항목 합계 상한


# --- 요청·응답 ---


class IdenticalCandidate(BaseModel):
    unit_id: int
    target_id: int
    lang: str
    text: str


class IdenticalItemIn(BaseModel):
    unit_id: DbId
    unit_revision: DbId
    target_id: DbId
    target_revision: DbId


class NewItemIn(BaseModel):
    target_id: DbId
    revision: DbId


class BulkMatchIn(BaseModel):
    identical: list[IdenticalItemIn] = Field(default_factory=list, max_length=MAX_BULK_MATCH)
    new: list[NewItemIn] = Field(default_factory=list, max_length=MAX_BULK_MATCH)

    @model_validator(mode="after")
    def check_size(self) -> Self:
        if not 1 <= len(self.identical) + len(self.new) <= MAX_BULK_MATCH:
            raise ValueError(f"send 1 to {MAX_BULK_MATCH} items in identical and new together")
        return self


# --- 새 문서 단위 → 새 문장 ---


@dataclass(frozen=True)
class _Want:
    """단위 하나가 가져야 할 입구 2 새 문장의 모습 — 부모 id는 표 새 문장이 생긴 뒤에 정한다."""

    unit_id: int
    rank: int  # 새 문장을 갖는 단위 사이의 문서 순서
    kind: str
    lang: str
    text: str
    grid: dict[str, int] | None
    section_path: str
    group_unit_id: int | None  # 묶인 칸 문장이면 그 표·행 단위(그 단위도 새 문장을 가질 때만)
    cell_row: int | None
    cell_col: int | None


def _build_want(row: Row[Any], rank: int, path: str, units: dict[int, Row[Any]], targeted: set[int]) -> _Want:
    """표·그림은 언어 중립에 글자 없음, 묶인 칸 문장은 칸 자리를 갖는다. 그룹 단위가 새 문장을 갖지 않으면 보통 문장이다."""
    kind, lang, text, grid = "sentence", row.lang, row.text, None
    group_unit_id = cell_row = cell_col = None
    if row.kind in TABLE_UNIT_KINDS:
        # 행 단위의 표는 그 행 하나짜리 격자다 — 관계 묶음 저장의 "그대로" 표 모양(R27)과 같다
        rows_in_grid = 1 if row.kind == "table_row" else row.n_rows
        kind, lang, text, grid = "table", NEUTRAL, "", {"rows": rows_in_grid, "cols": row.n_cols}
    elif row.kind == "figure":
        kind, lang, text = "figure", NEUTRAL, ""
    elif row.group_unit_id in targeted:
        group = units[row.group_unit_id]
        # 행 단위에 묶인 칸은 그 행 기준 좌표다
        first_row = (group.unit_row_index or 0) if group.kind == "table_row" else 0
        group_unit_id, cell_row, cell_col = row.group_unit_id, row.block_row_index - first_row, row.block_col_index
    return _Want(row.id, rank, kind, lang, text, grid, path, group_unit_id, cell_row, cell_col)


def _plan_targets(rows: Sequence[Row[Any]]) -> list[_Want]:
    """정렬 키 순 활성 단위 → 새 문장을 가져야 할 단위와 그 모습(머리말·꼬리말과 제목은 새 문장이 없다).

    절 경로는 본문 흐름(본문과 그 안의 글 상자)의 제목을 단계로 쌓아 " › "로 이은 것이다. 추출기는 본문 → 머리말·꼬리말 →
    각주·미주 순으로 블록을 내므로 본문 뒤 부분이 처음 나오면 흐름이 끝나고, 각주·미주는 마지막 본문 절을 물려받지 않고 빈
    경로다. 제목 단계가 하나도 없는 문서는 조항 번호만 있는 제목을 1단계로 보고, 단계가 있는 문서의 단계 없는 조항 번호 줄은
    경로에 넣지 않는다(스타일 제목이 이미 절을 정한다).
    """
    in_flow = []
    has_ended = False
    for row in rows:
        has_ended = has_ended or row.part in TRAILING_PARTS
        in_flow.append(not has_ended)
    has_levels = any(
        is_body and row.kind == "heading" and row.heading_level is not None for row, is_body in zip(rows, in_flow)
    )
    units = {row.id: row for row in rows}
    targeted = {row.id for row in rows if row.part not in REPEATED_PARTS and row.kind != "heading"}
    stack: list[tuple[int, str]] = []
    wants: list[_Want] = []
    for row, is_body in zip(rows, in_flow, strict=True):
        if row.id in targeted:
            path = SECTION_SEPARATOR.join(text for _, text in stack) if is_body else ""
            wants.append(_build_want(row, len(wants), path, units, targeted))
            continue
        level = row.heading_level if row.heading_level is not None else (None if has_levels else 1)
        if row.kind != "heading" or not is_body or level is None:
            continue
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, row.text))
    return wants


async def _load_wants(session: AsyncSession, document: Document) -> list[_Want]:
    """문서의 지금 활성 단위로 새 문장 계획을 세운다 — 질의 한 번(과 최신 추출 찾기)."""
    extraction_id = await get_latest_extraction_id(session, document.id)
    if extraction_id is None:
        return []
    rows = (
        await session.execute(
            select(
                Unit.id, Unit.kind, Unit.text, Unit.lang, Unit.group_unit_id, Unit.row_index.label("unit_row_index"),
                SourceBlock.part, SourceBlock.heading_level, SourceBlock.row_index.label("block_row_index"),
                SourceBlock.col_index.label("block_col_index"), SourceTable.n_rows, SourceTable.n_cols,
            )
            # 단위 자리(pos_seq)의 블록이 부분·제목 단계·칸 자리를 준다(표 단위는 첫 칸, 칸 문장은 자기 칸)
            .join(SourceBlock, (SourceBlock.extraction_id == Unit.extraction_id) & (SourceBlock.seq == Unit.pos_seq))
            .outerjoin(SourceTable, SourceTable.id == Unit.table_id)
            .where(Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE)
            .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
        )
    ).all()
    return _plan_targets(rows)


async def _load_doc_targets(session: AsyncSession, document: Document) -> list[TargetSentence]:
    return list(
        await session.scalars(
            select(TargetSentence).where(
                TargetSentence.target_doc_id == document.target_doc_id, TargetSentence.origin == ORIGIN_NEW_DOC
            )
        )
    )


async def _is_manual_order(session: AsyncSession, document: Document) -> bool:
    return (await session.get_one(TargetDoc, document.target_doc_id)).manual_order


def _decide_new_orders(missing: list[_Want], targets: list[TargetSentence], is_manual: bool) -> dict[int, int]:
    """새로 만들 새 문장의 order_index — 순서를 사람이 정한(manual_order) 문서면 지금 최댓값 + 1부터 단위 순서대로, 아니면 단위 순서."""
    if not is_manual:
        return {want.unit_id: want.rank for want in missing}
    start = max((target.order_index for target in targets), default=-1) + 1
    return {want.unit_id: start + offset for offset, want in enumerate(missing)}


async def _insert_targets(
    session: AsyncSession, document: Document, missing: list[_Want], ids_by_unit: dict[int, int], orders: dict[int, int]
) -> list[int]:
    """미배정 새 문장을 묶음 INSERT로 쓴다 — 표 새 문장을 먼저 써야 칸 새 문장이 부모 id를 안다. ids_by_unit에 만든 것을 더한다."""
    created: list[tuple[int, int]] = []  # (order_index, 새 문장 id)
    for is_cell in (False, True):
        batch = [want for want in missing if (want.group_unit_id is not None) == is_cell]
        if not batch:
            continue
        rows = [
            {
                "bundle_id": document.bundle_id, "target_doc_id": document.target_doc_id, "origin": ORIGIN_NEW_DOC,
                "new_unit_id": want.unit_id, "status": UNASSIGNED, "order_index": orders[want.unit_id],
                "section_path": want.section_path, "kind": want.kind, "lang": want.lang, "confirmed_text": want.text,
                "grid": want.grid, "cell_row": want.cell_row, "cell_col": want.cell_col,
                "parent_target_id": ids_by_unit[want.group_unit_id] if want.group_unit_id is not None else None,
            }
            for want in batch
        ]
        target_ids = await session.scalars(
            insert(TargetSentence).returning(TargetSentence.id, sort_by_parameter_order=True), rows
        )
        for want, target_id in zip(batch, target_ids, strict=True):
            ids_by_unit[want.unit_id] = target_id
            created.append((orders[want.unit_id], target_id))
    return [target_id for _, target_id in sorted(created)]


async def create_new_doc_targets(
    session: AsyncSession, document: Document, unit_ids: Collection[int] | None = None
) -> list[int]:
    """새 문서(입구 2)의 단위 중 새 문장이 없는 것마다 미배정 새 문장을 만든다 — 확정 글자는 원문 그대로. 커밋은 호출부가 한다.

    unit_ids를 주면 그 단위들(과 묶인 칸 문장의 표·행 단위)만 만들고, 절 경로·순서는 문서 전체의 지금 단위로 계산한다.
    이미 있는 새 문장은 고치지 않는다(편집 뒤 전체 맞추기는 sync_new_doc_targets). 만든 새 문장 id를 순서대로 돌려준다.
    """
    if unit_ids is not None and not unit_ids:
        return []
    wants = await _load_wants(session, document)
    targets = await _load_doc_targets(session, document)
    ids_by_unit = {target.new_unit_id: target.id for target in targets}
    selected = None if unit_ids is None else set(unit_ids)
    if selected is not None:
        # 칸 새 문장은 부모가 있어야 하므로 표 새 문장이 없으면 함께 만든다
        selected |= {
            want.group_unit_id for want in wants if want.unit_id in selected and want.group_unit_id is not None
        }
    missing = [
        want for want in wants if want.unit_id not in ids_by_unit and (selected is None or want.unit_id in selected)
    ]
    if not missing:
        return []
    orders = _decide_new_orders(missing, targets, await _is_manual_order(session, document))
    return await _insert_targets(session, document, missing, ids_by_unit, orders)


def _refresh_targets(
    targets: list[TargetSentence], wants: dict[int, _Want], ids_by_unit: dict[int, int], is_manual: bool
) -> None:
    """남은 새 문장의 자리를 지금 단위에 맞춘다.

    절 경로·언어·칸 부모와 좌표가 바뀌면 revision을 올린다(낡은 화면이 덮어쓰지 않게). 순서는 사람이 정한 문서가 아니면 단위
    순서로 다시 매기고, 순서만 바뀐 것은 revision을 올리지 않는다(편집마다 문서의 모든 새 문장이 409가 되지 않게).
    """
    for target in targets:
        want = wants[target.new_unit_id]
        parent_id = ids_by_unit[want.group_unit_id] if want.group_unit_id is not None else None
        placement = (want.section_path, want.lang, parent_id, want.cell_row, want.cell_col)
        if placement != (target.section_path, target.lang, target.parent_target_id, target.cell_row, target.cell_col):
            target.section_path, target.lang, target.parent_target_id, target.cell_row, target.cell_col = placement
            target.revision += 1
        if not is_manual and target.order_index != want.rank:
            target.order_index = want.rank


async def sync_new_doc_targets(
    session: AsyncSession,
    document: Document,
    *,
    created_unit_ids: Collection[int],
    retired_unit_ids: Collection[int],
    actor: str,
) -> DetachReport:
    """쪼개기 편집 뒤 새 문서 하나의 새 문장 전체를 지금 단위에 맞춘다. 커밋은 호출부가 한다(묶음 잠금은 호출부가 쥔다).

    1) 단위가 은퇴했거나 새 문장을 갖지 않게 된 새 문장은 떼어 내며 지우고(detach_units, 표가 지워지면 칸도 함께)
    2) 새 문장이 없는 단위마다 만들고(표 먼저 — 칸이 다시 묶이면 부모가 있어야 한다) 3) 남은 새 문장의 절 경로·언어·칸 부모와
    좌표·순서를 고친다. 제목 편집·언어 바꾸기·표 묶음 바꾸기는 단위를 제자리에서 바꾸므로 만든·은퇴한 단위만 보면 낡는다.
    created_unit_ids는 전체를 다시 맞추므로 참고만 한다. 질의 수는 단위 수와 무관하다(수정은 바뀐 칸 묶음별 executemany).
    """
    wants = {want.unit_id: want for want in await _load_wants(session, document)}
    current = await session.scalars(
        select(TargetSentence.new_unit_id).where(
            TargetSentence.target_doc_id == document.target_doc_id, TargetSentence.origin == ORIGIN_NEW_DOC
        )
    )
    stale = {unit_id for unit_id in current if unit_id not in wants} | set(retired_unit_ids)
    report = await detach_units(session, bundle_id=document.bundle_id, unit_ids=stale, cause="retired", actor=actor)
    targets = await _load_doc_targets(session, document)
    ids_by_unit = {target.new_unit_id: target.id for target in targets}
    missing = [want for want in wants.values() if want.unit_id not in ids_by_unit]
    is_manual = await _is_manual_order(session, document)
    await _insert_targets(session, document, missing, ids_by_unit, _decide_new_orders(missing, targets, is_manual))
    _refresh_targets(targets, wants, ids_by_unit, is_manual)
    await session.flush()
    return report


# --- 같은 글자 후보 ---


async def list_identical_candidates(session: AsyncSession, bundle_id: int) -> list[IdenticalCandidate]:
    """옛 미배정·새 문장 없는 단위와 출처 없는 미배정 입구 2 문장 새 문장 중 (언어, 글자)가 양쪽에 딱 하나씩인 짝 — 옛 단위 순.

    묶인 칸 문장과 칸 새 문장도 같은 글자 수를 세지만(어느 쪽인지 모호하면 빠진다) 후보로는 내지 않는다 — 표의 한 칸만
    확정하면 표를 반만 확정하게 된다. 질의는 두 번이다.
    """
    group_decision = aliased(UnitDecision)
    old_rows = (
        await session.execute(
            select(Unit.id, Unit.lang, Unit.text, Unit.group_unit_id)
            .join(Extraction, Extraction.id == Unit.extraction_id)
            .join(Document, Document.id == Extraction.document_id)
            .join(UnitDecision, UnitDecision.unit_id == Unit.id)
            .outerjoin(group_decision, group_decision.unit_id == Unit.group_unit_id)
            .where(
                Document.bundle_id == bundle_id, Document.side == "old", Unit.status == UNIT_ACTIVE,
                Unit.kind.in_(SENTENCE_SOURCE_KINDS),
                # 묶인 칸 문장은 그룹 단위의 판단을 따른다(get_cover_status와 같은 규칙)
                func.coalesce(group_decision.status, UnitDecision.status) == UNASSIGNED,
                func.coalesce(group_decision.disposition, UnitDecision.disposition) == UNASSIGNED,
                ~select(TargetSource.unit_id).where(TargetSource.unit_id == Unit.id).exists(),
            )
            .order_by(Document.id, Unit.pos_seq, Unit.pos_start, Unit.id)
        )
    ).all()
    new_rows = (
        await session.execute(
            select(TargetSentence.id, TargetSentence.lang, TargetSentence.confirmed_text, TargetSentence.parent_target_id)
            .where(
                TargetSentence.bundle_id == bundle_id, TargetSentence.origin == ORIGIN_NEW_DOC,
                TargetSentence.kind == "sentence", TargetSentence.status == UNASSIGNED,
                ~select(TargetSource.target_id).where(TargetSource.target_id == TargetSentence.id).exists(),
            )
            .order_by(TargetSentence.id)
        )
    ).all()
    olds: dict[tuple[str, str], list[Row[Any]]] = defaultdict(list)
    for row in old_rows:
        olds[(row.lang, row.text)].append(row)
    news: dict[tuple[str, str], list[Row[Any]]] = defaultdict(list)
    for row in new_rows:
        news[(row.lang, row.confirmed_text)].append(row)
    candidates = []
    for (lang, text), old_matches in olds.items():
        new_matches = news.get((lang, text), [])
        if len(old_matches) != 1 or len(new_matches) != 1:
            continue
        old, new = old_matches[0], new_matches[0]
        if old.group_unit_id is None and new.parent_target_id is None:
            candidates.append(IdenticalCandidate(unit_id=old.id, target_id=new.id, lang=lang, text=text))
    return candidates


# --- 한 번에 확정 ---


@dataclass
class _BulkState:
    units: dict[int, tuple[Unit, UnitDecision]]  # 요청한 단위 중 이 묶음 옛 문서의 활성 단위와 그 판단
    targets: dict[int, TargetSentence]  # 요청한 새 문장 중 이 묶음 것
    sourced_unit_ids: set[int]  # 요청한 단위 중 어느 새 문장의 출처인 것
    sourced_target_ids: set[int]  # 요청한 새 문장 중 출처가 있는 것
    children: dict[int, set[int]]  # 신규로 요청한 표 새 문장 → 그 칸 새 문장


def _find_duplicates(values: list[int]) -> list[int]:
    return sorted(value for value, count in Counter(values).items() if count > 1)


async def _load_bulk_state(
    session: AsyncSession, bundle_id: int, payload: BulkMatchIn, unit_ids: list[int], target_ids: list[int]
) -> _BulkState:
    """검사에 쓸 지금 모습 — 질의 수는 항목 수와 무관하다(긴 IN 목록은 select_in_chunks가 나눈다)."""
    units = {
        unit.id: (unit, decision)
        for unit, decision in await select_in_chunks(
            session,
            lambda chunk: select(Unit, UnitDecision)
            .join(UnitDecision, UnitDecision.unit_id == Unit.id)
            .join(Extraction, Extraction.id == Unit.extraction_id)
            .join(Document, Document.id == Extraction.document_id)
            .where(Unit.id.in_(chunk), Document.bundle_id == bundle_id, Document.side == "old", Unit.status == UNIT_ACTIVE),
            unit_ids,
        )
    }
    targets = {
        row[0].id: row[0]
        for row in await select_in_chunks(
            session,
            lambda chunk: select(TargetSentence).where(TargetSentence.id.in_(chunk), TargetSentence.bundle_id == bundle_id),
            target_ids,
        )
    }
    sourced_units = await select_in_chunks(
        session, lambda chunk: select(TargetSource.unit_id).where(TargetSource.unit_id.in_(chunk)), unit_ids
    )
    sourced_targets = await select_in_chunks(
        session, lambda chunk: select(TargetSource.target_id).where(TargetSource.target_id.in_(chunk)), target_ids
    )
    tables = [item.target_id for item in payload.new if item.target_id in targets and targets[item.target_id].kind == "table"]
    children: dict[int, set[int]] = defaultdict(set)
    for child_id, parent_id in await select_in_chunks(
        session,
        lambda chunk: select(TargetSentence.id, TargetSentence.parent_target_id).where(
            TargetSentence.parent_target_id.in_(chunk)
        ),
        tables,
    ):
        children[parent_id].add(child_id)
    return _BulkState(
        units=units, targets=targets, sourced_unit_ids={row[0] for row in sourced_units},
        sourced_target_ids={row[0] for row in sourced_targets}, children=children,
    )


def _check_bulk_revisions(payload: BulkMatchIn, state: _BulkState) -> None:
    """낡은 단위 판단·새 문장을 모두 모아 409 하나로 — 없는 id는 다음 검사(422)가 맡는다."""
    conflicts = [
        {"entity": "unit", "id": item.unit_id, "current_revision": state.units[item.unit_id][1].revision}
        for item in payload.identical
        if item.unit_id in state.units and item.unit_revision != state.units[item.unit_id][1].revision
    ]
    revisions = [(item.target_id, item.target_revision) for item in payload.identical]
    revisions += [(item.target_id, item.revision) for item in payload.new]
    conflicts += [
        {"entity": "target", "id": target_id, "current_revision": state.targets[target_id].revision}
        for target_id, revision in revisions
        if target_id in state.targets and revision != state.targets[target_id].revision
    ]
    if conflicts:
        raise_rule(409, "revision_conflict", conflicts=conflicts)


def _is_identical_pair(item: IdenticalItemIn, state: _BulkState) -> bool:
    """옛 단위는 미배정·새 문장 없음, 새 문장은 출처 없는 미배정 입구 2 문장, (언어, 글자)가 정확히 같다.

    칸 문장·칸 새 문장은 표와 한 관계 묶음이라 1:1로 확정하지 않는다(표를 반만 확정하게 된다).
    """
    loaded, target = state.units.get(item.unit_id), state.targets.get(item.target_id)
    if loaded is None or target is None:
        return False
    unit, decision = loaded
    is_free_unit = (
        unit.kind in SENTENCE_SOURCE_KINDS and unit.group_unit_id is None and is_unassigned(decision)
        and unit.id not in state.sourced_unit_ids
    )
    is_free_target = (
        target.origin == ORIGIN_NEW_DOC and target.kind == "sentence" and target.parent_target_id is None
        and target.status == UNASSIGNED and target.id not in state.sourced_target_ids
    )
    return is_free_unit and is_free_target and (unit.lang, unit.text) == (target.lang, target.confirmed_text)


def _check_bulk_items(payload: BulkMatchIn, state: _BulkState) -> None:
    """같은 글자 짝은 422 not_identical, 신규는 출처 없는 입구 2 새 문장이 아니거나 표·칸을 반만 담으면 422 not_new — 첫 항목."""
    for item in payload.identical:
        if not _is_identical_pair(item, state):
            raise_rule(422, "not_identical", unit_id=item.unit_id, target_id=item.target_id)
    listed = {item.target_id for item in payload.new}
    for item in payload.new:
        target = state.targets.get(item.target_id)
        # 표와 칸은 한 관계 묶음이라 함께 담아야 한다(관계 묶음 저장의 닫힘과 같은 이유)
        is_new = (
            target is not None and target.origin == ORIGIN_NEW_DOC and target.id not in state.sourced_target_ids
            and (target.parent_target_id is None or target.parent_target_id in listed)
            and state.children[target.id] <= listed
        )
        if not is_new:
            raise_rule(422, "not_new", target_id=item.target_id)


def _confirm(item: UnitDecision | TargetSentence, actor: str, stamp: datetime) -> None:
    item.status, item.hold_reason, item.confirmed_by, item.confirmed_at = CONFIRMED, "", actor, stamp
    item.revision += 1


async def _write_bulk(session: AsyncSession, payload: BulkMatchIn, state: _BulkState, actor: str) -> None:
    """같은 글자 짝은 출처 연결·그대로·양쪽 확정, 신규는 신규 확정(AI 제안이었으면 그대로 채택). 글자가 같아도 쓰기 길은 관계 묶음 저장처럼 문장 검사를 거친다."""
    stamp = now()
    links = []
    for item in payload.identical:
        unit, decision = state.units[item.unit_id]
        target = state.targets[item.target_id]
        links.append({"target_id": target.id, "unit_id": unit.id, "seq": 0})
        target.change_type = "as_is"
        target.warnings = check_sentence([unit.text], target.confirmed_text)
        _confirm(target, actor, stamp)
        decision.disposition, decision.move_target_code, decision.reason = "assigned", "", ""
        _confirm(decision, actor, stamp)
    for item in payload.new:
        target = state.targets[item.target_id]
        target.change_type, target.warnings = "new", []
        _confirm(target, actor, stamp)
    if links:
        await session.execute(insert(TargetSource), links)
    suggestion_ids = {state.targets[item.target_id].suggestion_id for item in payload.new}
    await adopt_suggestions(session, suggestion_ids - {None}, actor, stamp)


async def confirm_in_bulk(session: AsyncSession, bundle: Bundle, payload: BulkMatchIn, actor: str) -> GroupOut:
    """같은 글자 1:1 짝(그대로)과 출처 없는 입구 2 새 문장(신규)을 한 트랜잭션으로 확정한다. 커밋은 호출부가 한다.

    항목마다 서버가 다시 확인하고 하나라도 어긋나면 아무것도 쓰지 않는다. AI 제안 짝은 이 길로 확정하지 않는다(스펙 §7.7) —
    같은 글자 짝은 미배정만 받고, 신규는 코드가 확인할 수 있어 AI 제안이어도 받는다.
    """
    await lock_bundle(session, bundle)
    ensure_editable(bundle)
    unit_ids = [item.unit_id for item in payload.identical]
    target_ids = [item.target_id for item in payload.identical] + [item.target_id for item in payload.new]
    # 한 단위·새 문장은 요청에 한 번만 — 겹치면 1:1 짝이 아니다
    repeated_units, repeated_targets = _find_duplicates(unit_ids), _find_duplicates(target_ids)
    if repeated_units or repeated_targets:
        raise_rule(422, "duplicate_items", unit_ids=repeated_units, target_ids=repeated_targets)
    state = await _load_bulk_state(session, bundle.id, payload, unit_ids, target_ids)
    _check_bulk_revisions(payload, state)
    _check_bulk_items(payload, state)
    await _write_bulk(session, payload, state, actor)
    record_event(
        session, bundle_id=bundle.id, actor=actor, action="match.bulk_confirm", target_type="target",
        target_ids=target_ids,
    )
    await session.flush()
    return await build_group_out(session, unit_ids=unit_ids, target_ids=target_ids)
