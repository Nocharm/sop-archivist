"""입구 2 짝 — 묶음의 옛 단위와 새 문장을 임베딩(꺼졌거나 실패하면 글자 유사도)으로 묶는 계획 (설계 §6.7, §7.10, §8.4).

계획은 LLM을 부르지 않고 문장 묶음·표·그림·남은 항목의 제안을 바로 쓴다. 변경 종류는 구조와 글자 비교가 정한 값이 그대로 마지막이다
(설계 2026-11-20-change-type-two D6 — 말투·고침을 LLM에 묻던 `match` 작업은 걷었다). 다시 세운 계획은 살아 있는 제안과 같은 묶음을 그대로 두고 달라진 것만 밀어내고 다시 쓴다(설계 §4). 점수는 compute 안에서만 쓰고 제안·작업·응답·로그 어디에도 남기지 않는다(설계 §12).
제안은 제안 기록에만 쓴다 — 묶음(단위 ↔ 새 문장 연결)과 변경 종류를 content에 싣고, 판단·새 문장·출처 연결은 사람이 받을 때 사람의
저장이 쓴다(설계 2026-11-19-ai-suggest-only D1). 입구 2 새 문장의 글은 새 문서 원문이라 어느 쪽도 고치지 않는다(설계 §6.7).
"""

import asyncio
from collections import Counter, defaultdict
from collections.abc import Callable, Collection, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from itertools import product
from typing import Any, NamedTuple, TypeVar

import numpy as np
from sqlalchemy import Row, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.settings import settings
from app.sop.ai import constants
from app.sop.ai.apply import (
    add_suggestion,
    can_receive_suggestion,
    decide_ai_change_type,
    find_covering,
    list_covered_unit_ids,
    load_live_suggestions,
    mark_stale,
)
from app.sop.ai.candidates import RETRIEVAL_OF_UNAVAILABLE, Retrieval
from app.sop.ai.classify import CLASSIFY_KIND, load_units
from app.sop.ai.constants import MATCH_EMBED_THRESHOLD, MATCH_TEXT_THRESHOLD
from app.sop.ai.embeddings import EmbeddingUnavailable, embed_texts
from app.sop.ai.jobs import ACTIVE_JOB_STATUSES, JobItem, enqueue_jobs
from app.sop.ai.llm import ensure_llm_enabled
from app.sop.ai.matching import MatchGroup, MatchItem, MatchProposal, build_text_scores, propose_groups
from app.sop.ai.schemas import SkippedOut
from app.sop.ai.similarity import cosine_matrix
from app.sop.captions import CAPTION_KIND, is_caption_target
from app.sop.checks import check_sentence
from app.sop.constants import AI_PRIORITY_PLAN
from app.sop.decisions import load_cell_positions, load_table_shapes
from app.sop.detach import ORIGIN_NEW_DOC, UNASSIGNED
from app.sop.errors import raise_rule
from app.sop.groups import BUNDLE_UNIT_KINDS, TABLE_UNIT_KINDS, select_in_chunks
from app.sop.match import list_identical_candidates
from app.sop.models import (
    AiJob,
    AiSuggestion,
    Document,
    Extraction,
    TargetDoc,
    TargetSentence,
    Unit,
    UnitDecision,
)
from app.sop.segment import has_visible_char
from app.sop.units import UNIT_ACTIVE

MATCH_PLAN_KIND = "match_plan"
# 계획이 쓰는 제안의 종류. 같은 이름의 옛 LLM 작업 종류는 걷었고(설계 2026-11-20-change-type-two D6) 그 옛 행 때문에 AI_JOB_KINDS에만 남는다
MATCH_KIND = "match"
_WHOLE_BUNDLE = 0  # 건너뜀 응답의 unit_id — 묶음 전체 요청이라 가리킬 단위가 없고, 0은 어떤 단위의 id도 아니다
_SENTENCE, _TABLE, _FIGURE = "sentence", "table", "figure"  # MatchItem.kind — 새 문장 종류와 같은 값
_CELL_SEPARATOR = " "  # 양쪽 표 글을 같게 이어야 점수가 뜻이 있다
_CHANGE_ORDER = ("as_is", "rewritten", "split", "merged")  # 변화가 작은 순서 — 제안 기록의 한 칸을 정한다
# 계획 작업 payload["origin"] — 누가 세웠는지가 삭제 후보와 사람이 버린 묶음을 다시 쓸지를 정한다(설계 §4의 표). 값은 "user" | "prepare" | "upload"
PLAN_ORIGIN_USER = "user"  # Match 단추. 키가 없는 옛 계획도 이것으로 읽는다. 사람이 버린 묶음을 다시 쓰는 것은 이것뿐이다
PLAN_ORIGIN_PREPARE = "prepare"  # 배정 화면 첫 진입
PLAN_ORIGIN_UPLOAD = "upload"  # 파일 읽기 끝 — 새 문서 목록이 덜 찼을 수 있어 새 삭제 후보를 쓰지 않는다
_DELETE_CANDIDATE = "delete_candidate"  # 제안 모양

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
    """요청을 작업 줄로 — 묶음 전체라 작업 하나다. 입구 2 문서가 없으면 409, 이전 계획이 줄 서 있거나 돌고 있으면 쌓지 않는다."""
    if not await _has_target_doc(session, bundle_id, "match"):
        raise_rule(409, "no_match_documents")
    active = await session.scalar(
        select(AiJob.id)
        .where(AiJob.bundle_id == bundle_id, AiJob.kind == MATCH_PLAN_KIND, AiJob.status.in_(ACTIVE_JOB_STATUSES))
        .limit(1)
    )
    if active is not None:
        return [], [SkippedOut(unit_id=_WHOLE_BUNDLE, reason="already_queued")]
    return [JobItem(payload={"origin": PLAN_ORIGIN_USER})], []


async def _has_ready_document(session: AsyncSession, bundle_id: int, side: str) -> bool:
    """읽기가 끝난 문서가 있는지 — 새 문서는 입구 2(이미 쓴 문서)에 속한 것만 센다."""
    statement = select(Document.id).where(Document.bundle_id == bundle_id, Document.side == side, Document.status == "ready")
    if side == "new":
        statement = statement.join(TargetDoc, TargetDoc.id == Document.target_doc_id).where(TargetDoc.entrance == "match")
    return await session.scalar(statement.limit(1)) is not None


async def enqueue_auto_plan(session: AsyncSession, bundle_id: int, actor: str, *, origin: str) -> AiJob | None:
    """저절로 서는 계획 — 설정·AI가 켜져 있고 읽힌 옛 문서와 이미 쓴 새 문서가 있고 줄 선 계획이 없을 때만 하나 쌓는다. 돌고 있는 계획은 막지 않는다. 확인하고 쌓는 사이에 다른 요청이 끼지 않게 호출부가 묶음을 잠근 채로 부르고 커밋한다."""
    if not (settings.ai_auto_prepare and settings.ai_enabled):
        return None
    queued = await session.scalar(
        select(AiJob.id).where(AiJob.bundle_id == bundle_id, AiJob.kind == MATCH_PLAN_KIND, AiJob.status == "queued").limit(1)
    )
    if queued is not None:
        return None
    if not (await _has_ready_document(session, bundle_id, "old") and await _has_ready_document(session, bundle_id, "new")):
        return None
    (job,) = enqueue_jobs(
        session, bundle_id=bundle_id, kind=MATCH_PLAN_KIND, requested_by=actor,
        items=[JobItem(payload={"origin": origin})], priority=AI_PRIORITY_PLAN,
    )
    return job


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
    """단위 종류를 새 문장 종류로 — 옛 제목·칸 문장도 글자를 견주는 문장이다."""
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
    """AI가 쓸 수 있는 옛 단위 — 미배정이고 분류 제안이 살아 있지 않은 단위(분류 제안과 겹쳐 내지 않는다, 설계 §6.8). 자동 칸 추천을 숨긴
    동안(`AUTO_CLASSIFY`)은 분류 제안을 보지 않는다 — 사람이 치울 길이 없는 제안이 계획을 막지 않게(쪼개기 먼저 설계 §5 H4).
    입구 1로 간 단위는 상태에서 걸러지고, 칸 문장은 표 단위가 대신한다."""
    statement = (
        select(
            Unit.id, Unit.kind, Unit.lang, Unit.text, Unit.extraction_id, Document.id.label("document_id"),
            Document.sha256, UnitDecision.status, UnitDecision.disposition, UnitDecision.revision,
        )
        .join(UnitDecision, UnitDecision.unit_id == Unit.id)
        .join(Extraction, Extraction.id == Unit.extraction_id)
        .join(Document, Document.id == Extraction.document_id)
        .where(
            Document.bundle_id == bundle_id, Document.side == "old", Unit.status == UNIT_ACTIVE,
            # 잡음 표시 줄(목차)은 맞추지도 삭제 후보로 쓰지도 않는다
            Unit.group_unit_id.is_(None), Unit.noise_kind.is_(None),
        )
    )
    rows = (await session.execute(statement)).all()
    classified: set[int] = set()
    if constants.AUTO_CLASSIFY:
        classified = list_covered_unit_ids(await load_live_suggestions(session, bundle_id, (CLASSIFY_KIND,)))
    open_rows = [row for row in rows if can_receive_suggestion(row.status, row.disposition) and row.id not in classified]
    members = await select_in_chunks(
        session,
        lambda chunk: select(Unit.group_unit_id, Unit.kind, Unit.text)
        .where(Unit.group_unit_id.in_(chunk), Unit.status == UNIT_ACTIVE)
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id),
        [row.id for row in open_rows if row.kind in BUNDLE_UNIT_KINDS],
    )
    kinds = {row.id: row.kind for row in open_rows}
    # 표는 칸 글, 그림은 캡션 글로 견준다 — 표의 캡션은 표 글에 넣지 않는다
    bundle_texts = _join_cell_texts(
        (group_id, text) for group_id, kind, text in members if (kind == CAPTION_KIND) == (kinds[group_id] == _FIGURE)
    )
    return {
        row.id: _build_entry(row, _get_match_kind(row.kind), bundle_texts.get(row.id, row.text)) for row in open_rows
    }


async def _load_new_entries(session: AsyncSession, bundle_id: int) -> dict[int, _Entry]:
    """AI가 쓸 수 있는 최상위 입구 2 새 문장(미배정) — 칸 새 문장은 표가 대신한다. 그림은 글이 비어 있어 캡션을 새 단위(캡션 단위,
    예전 추출은 그림 단위 글)에서 읽는다."""
    statement = (
        select(
            TargetSentence.id, TargetSentence.kind, TargetSentence.lang, TargetSentence.confirmed_text,
            TargetSentence.status, TargetSentence.revision, Unit.id.label("unit_id"), Unit.text.label("unit_text"),
            Unit.extraction_id,
            Document.id.label("document_id"), Document.sha256,
        )
        .join(Unit, Unit.id == TargetSentence.new_unit_id)
        .join(Extraction, Extraction.id == Unit.extraction_id)
        .join(Document, Document.id == Extraction.document_id)
        .where(
            TargetSentence.bundle_id == bundle_id, TargetSentence.origin == ORIGIN_NEW_DOC,
            TargetSentence.parent_target_id.is_(None),
        )
    )
    rows = (await session.execute(statement)).all()
    open_rows = [row for row in rows if row.status == UNASSIGNED]
    cells = await select_in_chunks(
        session,
        lambda chunk: select(TargetSentence.parent_target_id, TargetSentence.confirmed_text)
        .where(
            # 표의 캡션 새 문장(칸 좌표 없음)은 옛 쪽처럼 표 글에 넣지 않는다
            TargetSentence.parent_target_id.in_(chunk), TargetSentence.origin == ORIGIN_NEW_DOC,
            TargetSentence.cell_row.is_not(None),
        )
        .order_by(TargetSentence.cell_row, TargetSentence.cell_col, TargetSentence.order_index, TargetSentence.id),
        [row.id for row in open_rows if row.kind == _TABLE],
    )
    table_texts = _join_cell_texts(cells)
    captions = await select_in_chunks(
        session,
        lambda chunk: select(Unit.group_unit_id, Unit.text)
        .where(Unit.group_unit_id.in_(chunk), Unit.kind == CAPTION_KIND, Unit.status == UNIT_ACTIVE)
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id),
        [row.unit_id for row in open_rows if row.kind == _FIGURE],
    )
    caption_texts = _join_cell_texts(captions)  # 그림 단위 → 캡션 글(새 추출은 그림 단위 글이 비었다)
    return {
        row.id: _build_entry(
            row, row.kind, table_texts.get(row.id) or caption_texts.get(row.unit_id) or row.confirmed_text or row.unit_text
        )
        for row in open_rows
    }


async def _load_candidates(session: AsyncSession, bundle_id: int) -> _Candidates:
    return _Candidates(await _load_old_entries(session, bundle_id), await _load_new_entries(session, bundle_id))


def _build_snapshot(olds: Mapping[int, _Entry], news: Mapping[int, _Entry]) -> dict[str, dict[str, int]]:
    """낡음을 볼 revision — JSON 칸이라 키는 글자로 된 id다."""
    return {
        "unit_revisions": {str(unit_id): entry.revision for unit_id, entry in olds.items()},
        "target_revisions": {str(target_id): entry.revision for target_id, entry in news.items()},
    }


def _keep_plannable(entries: Mapping[int, _Entry], identical: Collection[int]) -> dict[int, _Entry]:
    """계획이 다룰 후보 — 같은 글자 1:1 후보는 한 번에 확정할 몫이고(설계 §7.7), 글자 없는 항목(캡션 없는 그림)은 비교할 수 없어 사람 몫이다(설계 §7.10).

    뺀 행은 짝 없음으로도 세지 않아 삭제 후보·신규가 되지 않고 미배정으로 남는다.
    """
    return {
        entry_id: entry
        for entry_id, entry in entries.items()
        if entry_id not in identical and has_visible_char(entry.item.text)
    }


# --- compute ---


class _Plan(NamedTuple):
    proposal: MatchProposal
    retrieval: Retrieval


def _list_items(entries: Mapping[int, _Entry]) -> list[MatchItem]:
    return [entry.item for entry in entries.values()]


def _build_embedding_scores(
    olds: Sequence[MatchItem], news: Sequence[MatchItem], vectors: Mapping[str, np.ndarray]
) -> np.ndarray:
    """코사인 점수 행렬 (옛 수, 새 수) — 같은 글의 벡터는 공유되니 새 행렬로 쌓는다(제자리 수정 금지)."""
    if not olds or not news:
        return np.zeros((len(olds), len(news)), dtype=np.float32)
    return cosine_matrix(np.stack([vectors[item.text] for item in olds]), np.stack([vectors[item.text] for item in news]))


# --- apply ---


class _TargetWrite(NamedTuple):
    target: TargetSentence
    change_type: str
    warnings: Sequence[dict[str, str]] = ()


@dataclass(frozen=True)
class _Write:
    """제안 하나에 실을 묶음 — 모양으로 옛 단위의 처분이 정해진다(삭제 후보는 삭제, 나머지는 배정)."""

    entry: _Entry  # 제안을 붙일 문서
    shape: str
    change_type: str
    unit_ids: tuple[int, ...] = ()
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


async def _load_targets(session: AsyncSession, target_ids: Collection[int]) -> dict[int, TargetSentence]:
    rows = await select_in_chunks(
        session, lambda chunk: select(TargetSentence).where(TargetSentence.id.in_(chunk)), target_ids
    )
    return {row[0].id: row[0] for row in rows}


async def _load_cell_targets(session: AsyncSession, table_ids: Collection[int]) -> dict[int, list[TargetSentence]]:
    """표·그림 새 문장 → 자식 새 문장(칸 순서) — 칸 새 문장과 캡션 새 문장(칸 좌표 없음). 표 아래 번역 줄은 입구 2 새 문장이 아니다."""
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
    """표·그림 단위 → 묶인 활성 칸 문장·캡션(문서 순서) — 호출 동안 바뀐 칸도 맞게 지금 읽는다."""
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


def _iter_old_cells(cells: Iterable[Unit], positions: Mapping[int, tuple[int, int]]) -> Iterator[tuple[int, int, str, Unit]]:
    """칸 문장의 칸 자리."""
    for cell in cells:
        row_index, col_index = positions[cell.id]
        yield row_index, col_index, cell.lang, cell


def _build_cell_write(cell: TargetSentence, source: Unit | None) -> _TargetWrite:
    """칸·캡션 새 문장의 변경 종류 — 출처가 없으면 신규, 글자가 같으면 그대로, 다르면 고쳐 씀이고 사람 저장과 같은 문장 검사를 건다."""
    if source is None:
        return _TargetWrite(cell, "new")
    change_type = "as_is" if source.text == cell.confirmed_text else "rewritten"
    return _TargetWrite(cell, change_type, check_sentence([source.text], cell.confirmed_text))


def _split_captions(members: Iterable[_CellT], is_caption: Callable[[_CellT], bool]) -> tuple[list[_CellT], list[_CellT]]:
    """묶음의 자식을 (칸, 캡션)으로 — 캡션은 칸 좌표가 없어 칸 연결에 넣지 않는다."""
    cells: list[_CellT] = []
    captions: list[_CellT] = []
    for member in members:
        (captions if is_caption(member) else cells).append(member)
    return cells, captions


def _plan_captions(
    old_captions: Sequence[Unit], new_captions: Sequence[TargetSentence]
) -> tuple[list[_TargetWrite], list[tuple[int, int]]]:
    """캡션 새 문장을 옛 묶음의 캡션 단위에 잇는다 — 언어마다 문서 순서로 짝짓고, 짝이 없는 새 캡션은 신규다(옛 쪽은 원문 그대로)."""
    by_lang: dict[str, list[Unit]] = defaultdict(list)
    for caption in old_captions:
        by_lang[caption.lang].append(caption)
    links: dict[int, Unit] = {}
    for target in new_captions:
        sources = by_lang.get(target.lang)
        if sources:
            links[target.id] = sources.pop(0)
    writes = [_build_cell_write(target, links.get(target.id)) for target in new_captions]
    return writes, [(target_id, source.id) for target_id, source in links.items()]


def _plan_table(
    entry: _Entry,
    unit: Unit,
    target: TargetSentence,
    *,
    grid: dict[str, int],
    old_cells: Iterable[tuple[int, int, str, Unit]],
    new_cells: Sequence[TargetSentence],
    captions: tuple[list[_TargetWrite], list[tuple[int, int]]] = ([], []),
) -> _Write:
    """격자가 같으면 (행, 열, 언어, 칸 안 순서)로 칸을 잇고, 다르면 표끼리만 잇는다. 캡션은 격자와 상관없이 언어마다 잇는다.

    저장은 옛 칸 문장마다 칸 새 문장이 있어야 표를 그대로로 정하므로(decisions._keeps_table_shape) 옛 칸이 남으면 격자가 같아도 고침이다.
    """
    links: dict[int, Unit] = {}
    is_as_is = False
    if grid == target.grid:
        olds = _number_cells(old_cells)
        news = _number_cells((cell.cell_row, cell.cell_col, cell.lang, cell) for cell in new_cells)
        links = {news[key].id: olds[key] for key in olds.keys() & news.keys()}
        is_as_is = olds.keys() <= news.keys()
    change_type = "as_is" if is_as_is else "rewritten"
    caption_writes, caption_links = captions
    return _Write(
        entry, _TABLE, change_type, unit_ids=(unit.id,),
        targets=(
            _TargetWrite(target, change_type), *(_build_cell_write(cell, links.get(cell.id)) for cell in new_cells),
            *caption_writes,
        ),
        links=((target.id, unit.id), *((target_id, source.id) for target_id, source in links.items()), *caption_links),
    )


async def _plan_tables(
    session: AsyncSession, groups: Sequence[MatchGroup], olds: Mapping[int, _Entry], targets: Mapping[int, TargetSentence]
) -> list[_Write]:
    """표 그룹마다 칸·캡션 연결까지 정한다 — 그룹은 표끼리 1:1이다."""
    if not groups:
        return []
    rows = await select_in_chunks(
        session, lambda chunk: select(Unit).where(Unit.id.in_(chunk)), [group.old_ids[0] for group in groups]
    )
    units = {row[0].id: row[0] for row in rows}
    shapes = await load_table_shapes(session, list(units.values()))
    members = {
        unit_id: _split_captions(cells, lambda cell: cell.kind == CAPTION_KIND)
        for unit_id, cells in (await _load_cell_units(session, units)).items()
    }
    positions = await load_cell_positions(session, [cell for cells, _ in members.values() for cell in cells])
    children = {
        target_id: _split_captions(cells, is_caption_target)
        for target_id, cells in (await _load_cell_targets(session, [group.target_ids[0] for group in groups])).items()
    }
    writes = []
    for group in groups:
        unit, target = units[group.old_ids[0]], targets[group.target_ids[0]]
        n_rows, n_cols = shapes[unit.table_id]
        old_cells, old_captions = members.get(unit.id, ([], []))
        new_cells, new_captions = children.get(target.id, ([], []))
        writes.append(_plan_table(
            olds[unit.id], unit, target, grid={"rows": n_rows, "cols": n_cols},
            old_cells=_iter_old_cells(old_cells, positions), new_cells=new_cells,
            captions=_plan_captions(old_captions, new_captions),
        ))
    return writes


async def _plan_figures(
    session: AsyncSession, groups: Sequence[MatchGroup], olds: Mapping[int, _Entry], targets: Mapping[int, TargetSentence]
) -> list[_Write]:
    """그림 그룹마다 그림끼리 잇고 캡션 새 문장을 옛 그림의 캡션 단위에 잇는다 — 그룹은 그림끼리 1:1이고, 그림 짝은 캡션 글로 찾았다."""
    if not groups:
        return []
    old_captions = await _load_cell_units(session, [group.old_ids[0] for group in groups])
    new_captions = await _load_cell_targets(session, [group.target_ids[0] for group in groups])
    writes = []
    for group in groups:
        (unit_id,), (target_id,) = group.old_ids, group.target_ids
        caption_writes, caption_links = _plan_captions(old_captions.get(unit_id, []), new_captions.get(target_id, []))
        writes.append(_Write(
            olds[unit_id], _FIGURE, "as_is", unit_ids=(unit_id,),
            targets=(_TargetWrite(targets[target_id], "as_is"), *caption_writes),
            links=((target_id, unit_id), *caption_links),
        ))
    return writes


def _get_group_shape(unit_ids: Sequence[int], target_ids: Sequence[int]) -> str:
    """그룹은 한쪽이 늘 하나다 — 합침이 먼저인 순서는 decide_ai_change_type과 같다. 새 문서 둘에 걸친 1:N도 split이고 종류만 새 문장마다 따로다."""
    if len(unit_ids) >= 2:
        return "merged"
    return "split" if len(target_ids) >= 2 else "one_to_one"


def _plan_sentence(
    group: MatchGroup,
    sources: Sequence[Unit],
    olds: Mapping[int, _Entry],
    news: Mapping[int, _Entry],
    targets: Mapping[int, TargetSentence],
) -> _Write:
    """문장 묶음 — 변경 종류는 구조와 글이 정한다(사람 저장과 같은 규칙, 설계 2026-11-20-change-type-two D2). sources는 문서 순서다."""
    per_document = Counter(news[target_id].document_id for target_id in group.target_ids)  # 나눔은 같은 새 문서 안에서만이다
    change_types = {
        target_id: decide_ai_change_type(
            sources, news[target_id].item.text, sentence_count=per_document[news[target_id].document_id]
        )
        for target_id in group.target_ids
    }
    old_texts = [source.text for source in sources]
    return _Write(
        olds[group.old_ids[0]], _get_group_shape(group.old_ids, group.target_ids),
        max(change_types.values(), key=_CHANGE_ORDER.index), unit_ids=group.old_ids,
        targets=tuple(
            _TargetWrite(targets[target_id], change_types[target_id], check_sentence(old_texts, news[target_id].item.text))
            for target_id in group.target_ids
        ),
        links=tuple(product(group.target_ids, [source.id for source in sources])),
    )


async def _plan_sentences(
    session: AsyncSession,
    groups: Sequence[MatchGroup],
    olds: Mapping[int, _Entry],
    news: Mapping[int, _Entry],
    targets: Mapping[int, TargetSentence],
) -> list[_Write]:
    """문장 묶음마다 제안 — 출처는 문서 순서다(load_units). 사람이 받으면 그 순서대로 출처가 걸린다."""
    units = await load_units(session, {unit_id for group in groups for unit_id in group.old_ids})
    position = {unit.id: index for index, unit in enumerate(units)}
    by_id = {unit.id: unit for unit in units}
    return [
        _plan_sentence(
            group, [by_id[unit_id] for unit_id in sorted(group.old_ids, key=position.__getitem__)], olds, news, targets
        )
        for group in groups
    ]


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
    """제안 내용(API 계약 `match`) — 계획은 LLM을 거치지 않아 이유·규칙이 늘 비고, 삭제 후보의 사유는 사람이 확정할 때 적는다(설계 §7.10).

    links는 사람이 받으면 걸 출처 연결 [새 문장 id, 단위 id](표·그림은 칸·캡션 연결까지), target_change_types는 새 문장 id(글자) →
    변경 종류다. 옛 행에는 `provisional`(다듬기 대기) 칸이 남아 있을 수 있으나 읽는 곳은 없다(설계 2026-11-20-change-type-two D6).
    """
    return {
        "unit_ids": list(write.unit_ids),
        "target_ids": [item.target.id for item in write.targets],
        "shape": write.shape,
        "change_type": write.change_type,
        "links": [list(link) for link in write.links],
        "target_change_types": {str(item.target.id): item.change_type for item in write.targets},
        "reason": "",
        "rule_ids": [],
        "retrieval": retrieval,
    }


def _add_suggestion(session: AsyncSession, job: AiJob, write: _Write, retrieval: Retrieval) -> AiSuggestion:
    """작업은 계획 하나지만 제안은 항목마다다 — 종류는 match이고, 문서는 작업이 아니라 그 항목의 것이다."""
    content = _build_content(write, retrieval)
    suggestion = add_suggestion(
        session, job, content=content,
        warnings=[warning for item in write.targets for warning in item.warnings], result="applied",
        input_refs=write.entry.input_refs,
    )
    suggestion.kind, suggestion.document_id = MATCH_KIND, write.entry.document_id
    return suggestion


# --- 묶음이 그대로인가 (설계 §4) ---


_GroupKey = tuple[str, frozenset[int], frozenset[int]]  # (모양, 단위, 새 문장) — 다시 세운 계획이 "같은 묶음"을 가리는 열쇠


def _get_write_key(write: _Write) -> _GroupKey:
    return write.shape, frozenset(write.unit_ids), frozenset(item.target.id for item in write.targets)


def _get_suggestion_key(suggestion: AiSuggestion) -> _GroupKey:
    content = suggestion.content
    return content["shape"], frozenset(content["unit_ids"]), frozenset(content["target_ids"])


async def _load_rejected_keys(session: AsyncSession, bundle_id: int) -> set[_GroupKey]:
    """사람이 버린(Clear 등, 채택 rejected) 짝 맞추기 제안의 열쇠 — 저절로 선 계획은 이 묶음을 다시 쓰지 않는다(설계 §4)."""
    rows = await session.execute(
        select(AiSuggestion).where(
            AiSuggestion.bundle_id == bundle_id, AiSuggestion.kind == MATCH_KIND, AiSuggestion.adoption == "rejected"
        )
    )
    return {_get_suggestion_key(suggestion) for (suggestion,) in rows}


class MatchPlanHandler:
    """묶음 전체 — 후보를 읽어 짝을 고르고, 낡지 않은 항목만 쓴다. 바뀐 행 하나가 나머지를 막지 않는다."""

    async def load(self, session: AsyncSession, job: AiJob) -> _Candidates:
        """계획이 다룰 후보를 읽고 revision을 적는다."""
        candidates = await _load_candidates(session, job.bundle_id)
        identical = await list_identical_candidates(session, job.bundle_id)
        olds = _keep_plannable(candidates.olds, {candidate.unit_id for candidate in identical})
        news = _keep_plannable(candidates.news, {candidate.target_id for candidate in identical})
        job.input_snapshot = _build_snapshot(olds, news)
        return _Candidates(olds, news)

    async def compute(self, job: AiJob, loaded: _Candidates) -> _Plan:
        # 계획은 LLM을 부르지 않지만 요청(require_ai_enabled)처럼 AI가 꺼지면 멈춘다 — 꺼진 뒤 줄에 남은 계획이 묶음 전체를 임베딩하지 않게
        ensure_llm_enabled()
        olds, news = _list_items(loaded.olds), _list_items(loaded.news)
        threshold, retrieval = MATCH_EMBED_THRESHOLD, "embedding"
        try:
            vectors = await embed_texts(sorted({item.text for item in (*olds, *news)}), login_id=job.requested_by)
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

        unit_ids = {*lone_olds, *(unit_id for group in groups for unit_id in group.old_ids)}
        targets = await _load_targets(
            session, {*lone_news, *(target_id for group in groups for target_id in group.target_ids)}
        )

        by_kind: dict[str, list[MatchGroup]] = defaultdict(list)
        for group in groups:
            by_kind[loaded.olds[group.old_ids[0]].item.kind].append(group)
        sentences = await _plan_sentences(session, by_kind[_SENTENCE], loaded.olds, loaded.news, targets)
        writes = [
            *sentences,
            *await _plan_tables(session, by_kind[_TABLE], loaded.olds, targets),
            *await _plan_figures(session, by_kind[_FIGURE], loaded.olds, targets),
            *await _plan_new(session, lone_news, loaded.news, targets),
        ]
        # 입구 1이 있으면 분류가 받도록 미배정으로 남긴다(설계 §7.10). PLAN_DELETES를 끈 동안은 새로 쓰지 않으니(아래) 늘 견줘, 이미 있는
        # 삭제 후보가 숨긴 빈 문서의 유무에 따라 밀려나지 않게 한다
        if not constants.PLAN_DELETES or not await has_assign_documents(session, job.bundle_id):
            writes += [_Write(loaded.olds[unit_id], _DELETE_CANDIDATE, "deleted", unit_ids=(unit_id,)) for unit_id in lone_olds]

        # 모양·단위·새 문장이 살아 있는 제안과 같으면 밀어내지도 쓰지도 않는다 — 제안 id가 그대로라 사람이 보던 줄이 흔들리지 않는다(설계 §4)
        live = await load_live_suggestions(session, job.bundle_id, (MATCH_KIND,))
        live_by_key = {_get_suggestion_key(suggestion): suggestion for suggestion in live}
        judged = [(write, live_by_key.get(_get_write_key(write))) for write in writes]  # 쓸 것과 그대로 둔 제안
        origin = job.payload.get("origin", PLAN_ORIGIN_USER)
        left: list[_Write] = []  # 밀어내지도 쓰지도 않는다
        if origin != PLAN_ORIGIN_USER:  # 저절로 선 계획은 사람이 버린 묶음을 다시 제안하지 않는다 — Match를 누르면 다시 낸다
            rejected = await _load_rejected_keys(session, job.bundle_id)
            left = [write for write, kept in judged if kept is None and _get_write_key(write) in rejected]
            judged = [(write, kept) for write, kept in judged if kept is not None or _get_write_key(write) not in rejected]
        # 업로드 계획(과 PLAN_DELETES를 끈 동안의 모든 계획)은 새 삭제 후보만 쓰지 않는다 — 지금 규칙으로도 삭제 후보인 살아 있는
        # 제안은 위에서 그대로 두었다(§4)
        changed = [
            write for write, kept in judged
            if kept is None
            and not (write.shape == _DELETE_CANDIDATE and (origin == PLAN_ORIGIN_UPLOAD or not constants.PLAN_DELETES))
        ]
        untouched = [*(write for write, kept in judged if kept is not None), *left]
        kept_ids = {kept.id for _, kept in judged if kept is not None}
        cleared_unit_ids = unit_ids - {unit_id for write in untouched for unit_id in write.unit_ids}
        cleared_target_ids = targets.keys() - {item.target.id for write in untouched for item in write.targets}

        mark_stale(
            suggestion
            for suggestion in find_covering(live, unit_ids=cleared_unit_ids, target_ids=cleared_target_ids)
            if suggestion.id not in kept_ids
        )
        for write in changed:
            _add_suggestion(session, job, write, retrieval)
        return "done"


MATCH_PLAN_HANDLER = MatchPlanHandler()

