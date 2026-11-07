"""입구 2 짝 계획 — 묶음의 옛 단위와 새 문장을 임베딩(꺼졌거나 실패하면 글자 유사도)으로 묶어, 문장 그룹은 변경 종류 작업으로 쌓고 표·그림·남은 항목은 바로 제안을 쓴다 (설계 §6.7, §7.10, §8.4).

계획은 LLM을 부르지 않는다. 점수는 compute 안에서만 쓰고 제안·작업·응답·로그 어디에도 남기지 않는다(설계 §12).
입구 2 새 문장의 글은 새 문서 원문이라 제안이 건드리지 않는다(설계 §6.7).
"""

import asyncio
from collections import Counter, defaultdict
from collections.abc import Collection, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, NamedTuple, TypeVar

import numpy as np
from sqlalchemy import Row, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.ai.apply import AI_SUGGESTED, add_suggestion, can_receive_suggestion, clear_previous_suggestion
from app.sop.ai.candidates import RETRIEVAL_OF_UNAVAILABLE, Retrieval
from app.sop.ai.constants import MATCH_EMBED_THRESHOLD, MATCH_TEXT_THRESHOLD
from app.sop.ai.embeddings import EmbeddingUnavailable, embed_texts
from app.sop.ai.jobs import ACTIVE_JOB_STATUSES, JobItem, enqueue_jobs
from app.sop.ai.matching import MatchGroup, MatchItem, MatchProposal, build_text_scores, propose_groups
from app.sop.ai.schemas import SkippedOut
from app.sop.ai.similarity import cosine_matrix
from app.sop.checks import check_sentence
from app.sop.decisions import load_cell_positions, load_table_shapes
from app.sop.detach import ORIGIN_NEW_DOC, UNASSIGNED
from app.sop.errors import raise_rule
from app.sop.groups import TABLE_UNIT_KINDS, select_in_chunks
from app.sop.match import list_identical_candidates
from app.sop.models import (
    AiJob,
    AiSuggestion,
    Document,
    Extraction,
    TargetDoc,
    TargetSentence,
    TargetSource,
    Unit,
    UnitDecision,
)
from app.sop.segment import has_visible_char
from app.sop.units import UNIT_ACTIVE

MATCH_PLAN_KIND = "match_plan"
MATCH_KIND = "match"  # 계획이 쓴 제안도 이 종류다 — 화면·다시 받기는 계획과 변경 종류 작업을 가르지 않는다
_ACTIVE_KINDS = (MATCH_PLAN_KIND, MATCH_KIND)  # 계획은 묶음 전체를 다시 쓰므로 어느 쪽이 돌아도 새로 쌓지 않는다
_SUGGESTION_KINDS = (MATCH_KIND,)  # 같은 종류 제안 위에만 쓴다 — 분류 제안을 덮지 않는다(설계 §6.8)
_WHOLE_BUNDLE = 0  # 건너뜀 응답의 unit_id — 묶음 전체 요청이라 가리킬 단위가 없고, 0은 어떤 단위의 id도 아니다
_SENTENCE, _TABLE, _FIGURE = "sentence", "table", "figure"  # MatchItem.kind — 새 문장 종류와 같은 값
_CELL_SEPARATOR = " "  # 양쪽 표 글을 같게 이어야 점수가 뜻이 있다

_CellT = TypeVar("_CellT")
_CellKey = tuple[int, int, str, int]  # (행, 열, 언어, 칸 안 순서)


# --- 요청 ---


async def _has_target_doc(session: AsyncSession, bundle_id: int, entrance: str) -> bool:
    found = await session.scalar(
        select(TargetDoc.id).where(TargetDoc.bundle_id == bundle_id, TargetDoc.entrance == entrance).limit(1)
    )
    return found is not None


async def has_assign_documents(session: AsyncSession, bundle_id: int) -> bool:
    return await _has_target_doc(session, bundle_id, "assign")


async def select_match_items(session: AsyncSession, bundle_id: int) -> tuple[list[JobItem], list[SkippedOut]]:
    """요청을 작업 줄로 — 묶음 전체라 작업 하나다. 입구 2 문서가 없으면 409, 이전 계획이나 그 변경 종류 작업이 돌고 있으면 쌓지 않는다."""
    if not await _has_target_doc(session, bundle_id, "match"):
        raise_rule(409, "no_match_documents")
    active = await session.scalar(
        select(AiJob.id)
        .where(AiJob.bundle_id == bundle_id, AiJob.kind.in_(_ACTIVE_KINDS), AiJob.status.in_(ACTIVE_JOB_STATUSES))
        .limit(1)
    )
    if active is not None:
        return [], [SkippedOut(unit_id=_WHOLE_BUNDLE, reason="already_queued")]
    return [JobItem()], []


# --- load ---


@dataclass(frozen=True)
class _Entry:
    """후보 하나 — 짝 계산에 넘기는 모습, 낡음을 볼 revision, 제안 기록에 남길 문서."""

    item: MatchItem
    revision: int
    document_id: int
    input_refs: dict[str, object]


class _Candidates(NamedTuple):
    """{단위 id: 후보}, {새 문장 id: 후보} — compute는 세션 없이 이 값만 본다."""

    olds: dict[int, _Entry]
    news: dict[int, _Entry]


def _get_match_kind(unit_kind: str) -> str:
    """단위 종류를 새 문장 종류로 — 옛 제목·칸 문장도 글자를 견주는 문장이고, 행 단위는 한 행짜리 표다."""
    if unit_kind in TABLE_UNIT_KINDS:
        return _TABLE
    return _FIGURE if unit_kind == _FIGURE else _SENTENCE


def _join_cell_texts(rows: Iterable[Row[Any]]) -> dict[int, str]:
    """(표, 칸 글) 행 → 표 글 — 표 단위·표 새 문장에는 자기 글이 없다. 행은 칸 순서로 온다."""
    texts: dict[int, list[str]] = defaultdict(list)
    for parent_id, text in rows:
        texts[parent_id].append(text)
    return {parent_id: _CELL_SEPARATOR.join(cells) for parent_id, cells in texts.items()}


def _build_entry(row: Row[Any], kind: str, text: str) -> _Entry:
    return _Entry(
        MatchItem(row.id, row.lang, kind, text), row.revision, row.document_id,
        {"sha256": row.sha256, "extraction_id": row.extraction_id},
    )


async def _load_old_entries(session: AsyncSession, bundle_id: int) -> dict[int, _Entry]:
    """AI가 쓸 수 있는 옛 단위 — 미배정이거나 입구 2 제안 위. 입구 1로 간 단위는 상태에서 걸러지고, 칸 문장은 표·행 단위가 대신한다."""
    rows = (
        await session.execute(
            select(
                Unit.id, Unit.kind, Unit.lang, Unit.text, Unit.extraction_id, Document.id.label("document_id"),
                Document.sha256, UnitDecision.status, UnitDecision.disposition, UnitDecision.revision,
                AiSuggestion.kind.label("suggestion_kind"),
            )
            .join(UnitDecision, UnitDecision.unit_id == Unit.id)
            .join(Extraction, Extraction.id == Unit.extraction_id)
            .join(Document, Document.id == Extraction.document_id)
            .outerjoin(AiSuggestion, AiSuggestion.id == UnitDecision.suggestion_id)
            .where(
                Document.bundle_id == bundle_id, Document.side == "old", Unit.status == UNIT_ACTIVE,
                Unit.group_unit_id.is_(None),
            )
        )
    ).all()
    open_rows = [
        row for row in rows
        if can_receive_suggestion(row.status, row.disposition, row.suggestion_kind, _SUGGESTION_KINDS)
    ]
    cells = await select_in_chunks(
        session,
        lambda chunk: select(Unit.group_unit_id, Unit.text)
        .where(Unit.group_unit_id.in_(chunk), Unit.status == UNIT_ACTIVE)
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id),
        [row.id for row in open_rows if row.kind in TABLE_UNIT_KINDS],
    )
    table_texts = _join_cell_texts(cells)
    return {
        row.id: _build_entry(row, _get_match_kind(row.kind), table_texts.get(row.id, row.text)) for row in open_rows
    }


async def _load_new_entries(session: AsyncSession, bundle_id: int) -> dict[int, _Entry]:
    """AI가 쓸 수 있는 최상위 입구 2 새 문장 — 칸 새 문장은 표가 대신한다. 그림은 글이 비어 있어 캡션을 새 단위에서 읽는다."""
    rows = (
        await session.execute(
            select(
                TargetSentence.id, TargetSentence.kind, TargetSentence.lang, TargetSentence.confirmed_text,
                TargetSentence.status, TargetSentence.revision, Unit.text.label("unit_text"), Unit.extraction_id,
                Document.id.label("document_id"), Document.sha256, AiSuggestion.kind.label("suggestion_kind"),
            )
            .join(Unit, Unit.id == TargetSentence.new_unit_id)
            .join(Extraction, Extraction.id == Unit.extraction_id)
            .join(Document, Document.id == Extraction.document_id)
            .outerjoin(AiSuggestion, AiSuggestion.id == TargetSentence.suggestion_id)
            .where(
                TargetSentence.bundle_id == bundle_id, TargetSentence.origin == ORIGIN_NEW_DOC,
                TargetSentence.parent_target_id.is_(None),
            )
        )
    ).all()
    open_rows = [
        row for row in rows if can_receive_suggestion(row.status, UNASSIGNED, row.suggestion_kind, _SUGGESTION_KINDS)
    ]
    cells = await select_in_chunks(
        session,
        lambda chunk: select(TargetSentence.parent_target_id, TargetSentence.confirmed_text)
        .where(TargetSentence.parent_target_id.in_(chunk), TargetSentence.origin == ORIGIN_NEW_DOC)
        .order_by(TargetSentence.cell_row, TargetSentence.cell_col, TargetSentence.order_index, TargetSentence.id),
        [row.id for row in open_rows if row.kind == _TABLE],
    )
    table_texts = _join_cell_texts(cells)
    return {
        row.id: _build_entry(row, row.kind, table_texts.get(row.id, row.confirmed_text or row.unit_text))
        for row in open_rows
    }


async def _load_candidates(session: AsyncSession, bundle_id: int) -> _Candidates:
    return _Candidates(await _load_old_entries(session, bundle_id), await _load_new_entries(session, bundle_id))


# --- compute ---


class _Plan(NamedTuple):
    proposal: MatchProposal
    retrieval: Retrieval


def _list_items(entries: Mapping[int, _Entry]) -> list[MatchItem]:
    return [entry.item for entry in entries.values()]


def _list_embed_texts(items: Iterable[MatchItem]) -> list[str]:
    """임베딩에 보낼 글 — 글 없는 항목(캡션 없는 그림)은 빼고 점수 0으로 둔다. 빈 글을 서버가 거절하면 묶음 전체가 임베딩을 잃는다."""
    return sorted({item.text for item in items if has_visible_char(item.text)})


def _build_embedding_scores(
    olds: Sequence[MatchItem], news: Sequence[MatchItem], vectors: Mapping[str, np.ndarray]
) -> np.ndarray:
    """코사인 점수 행렬 (옛 수, 새 수) — 벡터 없는 글은 영벡터라 점수가 0이다. 같은 글의 벡터는 공유되니 새 행렬로 쌓는다(제자리 수정 금지)."""
    if not olds or not news:
        return np.zeros((len(olds), len(news)), dtype=np.float32)
    blank = np.zeros(next((len(vector) for vector in vectors.values()), 1), dtype=np.float32)
    return cosine_matrix(
        np.stack([vectors.get(item.text, blank) for item in olds]),
        np.stack([vectors.get(item.text, blank) for item in news]),
    )


# --- apply ---


class _TargetWrite(NamedTuple):
    target: TargetSentence
    change_type: str
    warnings: Sequence[dict[str, str]] = ()


@dataclass(frozen=True)
class _Write:
    """제안 하나가 쓸 것 — 제안 id가 flush 뒤에 생겨 미리 모아 둔다. disposition은 옛 단위 처분이고 unit_ids가 없으면 쓰이지 않는다."""

    entry: _Entry  # 제안을 붙일 문서
    shape: str
    change_type: str
    unit_ids: tuple[int, ...] = ()
    disposition: str = UNASSIGNED
    targets: tuple[_TargetWrite, ...] = ()
    links: tuple[tuple[int, int], ...] = ()  # (새 문장 id, 단위 id)


def _list_fresh(loaded: Mapping[int, _Entry], current: Mapping[int, _Entry], revisions: Mapping[str, int]) -> set[int]:
    """계획이 본 그대로이고 AI가 아직 쓸 수 있는 후보 — current에 없으면 은퇴했거나 사람이 정한 것이다.

    언어 고치기는 판단 revision을 올리지 않아 모습까지 견준다. 같은 언어 규칙은 적용할 때도 지켜져야 한다.
    """
    return {
        entry_id
        for entry_id, entry in loaded.items()
        if entry_id in current
        and current[entry_id].item == entry.item
        and current[entry_id].revision == revisions[str(entry_id)]
    }


async def _load_decisions(session: AsyncSession, unit_ids: Collection[int]) -> dict[int, UnitDecision]:
    rows = await select_in_chunks(
        session, lambda chunk: select(UnitDecision).where(UnitDecision.unit_id.in_(chunk)), unit_ids
    )
    return {row[0].unit_id: row[0] for row in rows}


async def _load_targets(session: AsyncSession, target_ids: Collection[int]) -> dict[int, TargetSentence]:
    rows = await select_in_chunks(
        session, lambda chunk: select(TargetSentence).where(TargetSentence.id.in_(chunk)), target_ids
    )
    return {row[0].id: row[0] for row in rows}


async def _load_cell_targets(session: AsyncSession, table_ids: Collection[int]) -> dict[int, list[TargetSentence]]:
    """표 새 문장 → 칸 새 문장(칸 순서) — 표 아래 번역 줄은 칸 새 문장이 아니다."""
    rows = await select_in_chunks(
        session,
        lambda chunk: select(TargetSentence)
        .where(TargetSentence.parent_target_id.in_(chunk), TargetSentence.origin == ORIGIN_NEW_DOC)
        .order_by(TargetSentence.cell_row, TargetSentence.cell_col, TargetSentence.order_index, TargetSentence.id),
        table_ids,
    )
    cells: dict[int, list[TargetSentence]] = defaultdict(list)
    for (cell,) in rows:
        cells[cell.parent_target_id].append(cell)
    return cells


async def _load_cell_units(session: AsyncSession, table_unit_ids: Collection[int]) -> dict[int, list[Unit]]:
    """표·행 단위 → 묶인 활성 칸 문장(문서 순서) — 호출 동안 바뀐 칸도 맞게 지금 읽는다."""
    rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit)
        .where(Unit.group_unit_id.in_(chunk), Unit.status == UNIT_ACTIVE)
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id),
        table_unit_ids,
    )
    cells: dict[int, list[Unit]] = defaultdict(list)
    for (cell,) in rows:
        cells[cell.group_unit_id].append(cell)
    return cells


def _number_cells(cells: Iterable[tuple[int, int, str, _CellT]]) -> dict[_CellKey, _CellT]:
    """(행, 열, 언어, 칸) → {칸 열쇠: 칸} — 한 칸의 같은 언어 문장은 넘긴 순서대로 번호를 받는다."""
    seen: Counter[tuple[int, int, str]] = Counter()
    numbered: dict[_CellKey, _CellT] = {}
    for row, col, lang, cell in cells:
        numbered[(row, col, lang, seen[(row, col, lang)])] = cell
        seen[(row, col, lang)] += 1
    return numbered


def _iter_old_cells(unit: Unit, cells: Iterable[Unit], positions: Mapping[int, tuple[int, int]]) -> Iterator[tuple[int, int, str, Unit]]:
    """칸 문장의 칸 자리 — 행 단위의 좌표는 새 문장처럼 그 행 기준이다."""
    first_row = (unit.row_index or 0) if unit.kind == "table_row" else 0
    for cell in cells:
        row_index, col_index = positions[cell.id]
        yield row_index - first_row, col_index, cell.lang, cell


def _build_cell_write(cell: TargetSentence, source: Unit | None) -> _TargetWrite:
    """칸 새 문장의 변경 종류 — 출처가 없으면 신규, 글자가 같으면 그대로, 다르면 고쳐 씀이고 사람 저장과 같은 문장 검사를 건다."""
    if source is None:
        return _TargetWrite(cell, "new")
    change_type = "as_is" if source.text == cell.confirmed_text else "rewritten"
    return _TargetWrite(cell, change_type, check_sentence([source.text], cell.confirmed_text))


def _plan_table(
    entry: _Entry,
    unit: Unit,
    target: TargetSentence,
    *,
    grid: dict[str, int],
    old_cells: Iterable[tuple[int, int, str, Unit]],
    new_cells: Sequence[TargetSentence],
) -> _Write:
    """격자가 같으면 (행, 열, 언어, 칸 안 순서)로 칸을 잇고, 다르면 표끼리만 잇는다.

    그대로인 표는 옛 칸 문장마다 칸 새 문장이 있어야 저장되므로(table_cells_missing) 옛 칸이 남으면 격자가 같아도 표 구성 변경이다.
    """
    links: dict[int, Unit] = {}
    is_as_is = False
    if grid == target.grid:
        olds = _number_cells(old_cells)
        news = _number_cells((cell.cell_row, cell.cell_col, cell.lang, cell) for cell in new_cells)
        links = {news[key].id: olds[key] for key in olds.keys() & news.keys()}
        is_as_is = olds.keys() <= news.keys()
    change_type = "as_is" if is_as_is else "table_restructured"
    return _Write(
        entry, _TABLE, change_type, unit_ids=(unit.id,), disposition="assigned",
        targets=(_TargetWrite(target, change_type), *(_build_cell_write(cell, links.get(cell.id)) for cell in new_cells)),
        links=((target.id, unit.id), *((target_id, source.id) for target_id, source in links.items())),
    )


async def _plan_tables(
    session: AsyncSession, groups: Sequence[MatchGroup], olds: Mapping[int, _Entry], targets: Mapping[int, TargetSentence]
) -> list[_Write]:
    """표 그룹마다 칸 연결까지 정한다 — 그룹은 표끼리 1:1이다."""
    if not groups:
        return []
    rows = await select_in_chunks(
        session, lambda chunk: select(Unit).where(Unit.id.in_(chunk)), [group.old_ids[0] for group in groups]
    )
    units = {row[0].id: row[0] for row in rows}
    shapes = await load_table_shapes(session, list(units.values()))
    cell_units = await _load_cell_units(session, units)
    positions = await load_cell_positions(session, [cell for cells in cell_units.values() for cell in cells])
    cell_targets = await _load_cell_targets(session, [group.target_ids[0] for group in groups])
    writes = []
    for group in groups:
        unit, target = units[group.old_ids[0]], targets[group.target_ids[0]]
        n_rows, n_cols = shapes[unit.table_id]
        writes.append(_plan_table(
            olds[unit.id], unit, target, grid={"rows": 1 if unit.kind == "table_row" else n_rows, "cols": n_cols},
            old_cells=_iter_old_cells(unit, cell_units[unit.id], positions), new_cells=cell_targets[target.id],
        ))
    return writes


def _plan_figure(group: MatchGroup, olds: Mapping[int, _Entry], targets: Mapping[int, TargetSentence]) -> _Write:
    (unit_id,), (target_id,) = group.old_ids, group.target_ids
    return _Write(
        olds[unit_id], _FIGURE, "as_is", unit_ids=(unit_id,), disposition="assigned",
        targets=(_TargetWrite(targets[target_id], "as_is"),), links=((target_id, unit_id),),
    )


async def _plan_new(
    session: AsyncSession, target_ids: Sequence[int], news: Mapping[int, _Entry], targets: Mapping[int, TargetSentence]
) -> list[_Write]:
    """짝 없는 새 문장은 신규 — 표는 칸 새 문장과 한 관계 묶음이라 함께 간다."""
    cells = await _load_cell_targets(session, target_ids)
    return [
        _Write(
            news[target_id], "new", "new",
            targets=tuple(_TargetWrite(row, "new") for row in (targets[target_id], *cells[target_id])),
        )
        for target_id in target_ids
    ]


def _build_content(write: _Write, retrieval: Retrieval) -> dict[str, object]:
    """제안 내용(API 계약 `match`) — 계획은 LLM을 거치지 않아 이유·규칙이 비고, 삭제 후보의 사유는 사람이 확정할 때 적는다(설계 §7.10)."""
    return {
        "unit_ids": list(write.unit_ids),
        "target_ids": [item.target.id for item in write.targets],
        "shape": write.shape,
        "change_type": write.change_type,
        "reason": "",
        "rule_ids": [],
        "retrieval": retrieval,
    }


def _add_suggestion(session: AsyncSession, job: AiJob, write: _Write, retrieval: Retrieval) -> AiSuggestion:
    """작업은 계획 하나지만 제안은 항목마다다 — 종류는 match이고, 문서는 작업이 아니라 그 항목의 것이다."""
    suggestion = add_suggestion(
        session, job, content=_build_content(write, retrieval), result="applied", input_refs=write.entry.input_refs
    )
    suggestion.kind, suggestion.document_id = MATCH_KIND, write.entry.document_id
    return suggestion


def _apply_write(write: _Write, suggestion_id: int, decisions: Mapping[int, UnitDecision]) -> None:
    for unit_id in write.unit_ids:
        decision = decisions[unit_id]
        decision.status, decision.disposition, decision.suggestion_id = AI_SUGGESTED, write.disposition, suggestion_id
        decision.revision += 1
    for target, change_type, warnings in write.targets:
        target.status, target.change_type, target.suggestion_id = AI_SUGGESTED, change_type, suggestion_id
        target.warnings = list(warnings)
        target.revision += 1


class MatchPlanHandler:
    """묶음 전체 — 후보를 읽어 짝을 고르고, 낡지 않은 항목만 쓴다. 바뀐 행 하나가 나머지를 막지 않는다."""

    async def load(self, session: AsyncSession, job: AiJob) -> _Candidates:
        """후보를 읽고 revision을 적는다 — 같은 글자 1:1 후보는 한 번에 확정할 몫이라 뺀다(설계 §7.7). 뺀 행은 짝 없음으로도 세지 않는다."""
        olds, news = await _load_candidates(session, job.bundle_id)
        for candidate in await list_identical_candidates(session, job.bundle_id):
            olds.pop(candidate.unit_id, None)
            news.pop(candidate.target_id, None)
        job.input_snapshot = {
            "unit_revisions": {str(unit_id): entry.revision for unit_id, entry in olds.items()},
            "target_revisions": {str(target_id): entry.revision for target_id, entry in news.items()},
        }
        return _Candidates(olds, news)

    async def compute(self, job: AiJob, loaded: _Candidates) -> _Plan:
        olds, news = _list_items(loaded.olds), _list_items(loaded.news)
        threshold, retrieval = MATCH_EMBED_THRESHOLD, "embedding"
        try:
            vectors = await embed_texts(_list_embed_texts((*olds, *news)), login_id=job.requested_by)
        except EmbeddingUnavailable as unavailable:
            threshold, retrieval = MATCH_TEXT_THRESHOLD, RETRIEVAL_OF_UNAVAILABLE[unavailable.reason]
            scores = await asyncio.to_thread(build_text_scores, olds, news)
        else:
            scores = await asyncio.to_thread(_build_embedding_scores, olds, news, vectors)
        return _Plan(await asyncio.to_thread(propose_groups, olds, news, scores, threshold), retrieval)

    async def apply(self, session: AsyncSession, job: AiJob, loaded: _Candidates, computed: _Plan) -> str:
        current = await _load_candidates(session, job.bundle_id)
        fresh_olds = _list_fresh(loaded.olds, current.olds, job.input_snapshot["unit_revisions"])
        fresh_news = _list_fresh(loaded.news, current.news, job.input_snapshot["target_revisions"])
        proposal, retrieval = computed
        groups = [
            group for group in proposal.groups
            if fresh_olds.issuperset(group.old_ids) and fresh_news.issuperset(group.target_ids)
        ]
        lone_olds = [unit_id for unit_id in proposal.unmatched_old_ids if unit_id in fresh_olds]
        lone_news = [target_id for target_id in proposal.unmatched_target_ids if target_id in fresh_news]

        decisions = await _load_decisions(session, {*lone_olds, *(unit_id for group in groups for unit_id in group.old_ids)})
        targets = await _load_targets(
            session, {*lone_news, *(target_id for group in groups for target_id in group.target_ids)}
        )
        replaced = [decision for decision in decisions.values() if decision.status == AI_SUGGESTED]
        await clear_previous_suggestion(session, decisions.values(), targets.values())
        for decision in replaced:  # 문장 그룹은 변경 종류 작업까지 미배정이라 새 상태가 대신 올려 주지 않는다
            decision.revision += 1

        by_kind: dict[str, list[MatchGroup]] = defaultdict(list)
        for group in groups:
            by_kind[loaded.olds[group.old_ids[0]].item.kind].append(group)
        enqueue_jobs(
            session, bundle_id=job.bundle_id, kind=MATCH_KIND, requested_by=job.requested_by,
            items=[
                JobItem(
                    document_id=loaded.olds[group.old_ids[0]].document_id, unit_ids=group.old_ids,
                    target_ids=group.target_ids, payload={"retrieval": retrieval},
                )
                for group in by_kind[_SENTENCE]
            ],
        )
        writes = [
            *await _plan_tables(session, by_kind[_TABLE], loaded.olds, targets),
            *(_plan_figure(group, loaded.olds, targets) for group in by_kind[_FIGURE]),
            *await _plan_new(session, lone_news, loaded.news, targets),
        ]
        if not await has_assign_documents(session, job.bundle_id):  # 입구 1이 있으면 분류가 받도록 미배정으로 남긴다(설계 §7.10)
            writes += [
                _Write(loaded.olds[unit_id], "delete_candidate", "deleted", unit_ids=(unit_id,), disposition="delete")
                for unit_id in lone_olds
            ]
        suggestions = [_add_suggestion(session, job, write, retrieval) for write in writes]
        await session.flush()  # 판단·새 문장이 제안 id를 가리킨다
        for write, suggestion in zip(writes, suggestions, strict=True):
            _apply_write(write, suggestion.id, decisions)
        links = [
            {"target_id": target_id, "unit_id": unit_id, "seq": 0} for write in writes for target_id, unit_id in write.links
        ]
        if links:
            await session.execute(insert(TargetSource), links)
        return "done"


MATCH_PLAN_HANDLER = MatchPlanHandler()
