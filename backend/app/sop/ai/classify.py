"""AI 분류·고쳐 쓰기 — 요청 범위를 작업으로 나누고, 단위(짝) 하나의 칸 고르기와 고쳐 쓰기를 load·compute·apply로 돌린다 (설계 §7.8).

AI는 제안만 한다: 새 문장의 `confirmed_text`를 쓰지 않고, 응답은 정해진 필드만 읽어 검사한 뒤 쓴다. 무효 제안에는 응답 원문을 남기지 않는다.
"""

import hashlib
from collections import defaultdict
from collections.abc import Collection, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from itertools import count, repeat
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy import Row, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.ai.apply import (
    AI_SUGGESTED,
    add_suggestion,
    can_receive_suggestion,
    clear_previous_suggestion,
    decide_ai_change_type,
    hold_invalid,
    load_fresh_decisions,
    load_open_decisions,
)
from app.sop.ai.candidates import DELETE_CANDIDATE, Candidate, Retrieval, list_candidates, rank_candidates
from app.sop.ai.constants import MAX_REWRITE_SENTENCES
from app.sop.ai.context import UnitContext, load_unit_context
from app.sop.ai.guidelines import (
    RULES_KEY,
    GuidelineRef,
    extract_rule_ids,
    format_guideline_versions,
    load_active_guidelines,
)
from app.sop.ai.jobs import JobItem, cap_job_items, ensure_units_found, find_active_unit_ids
from app.sop.ai.llm import AiStr, build_messages, call_llm, ensure_llm_enabled, parse_reply
from app.sop.ai.runner import AiCallFailed
from app.sop.ai.schemas import SkippedOut, SkipReason
from app.sop.checks import MAX_WARNING_VALUE_LEN, check_sentence
from app.sop.decisions import (
    NEUTRAL,
    ORIGIN_UNITS,
    SENTENCE_SOURCE_KINDS,
    load_cell_positions,
    load_table_shapes,
)
from app.sop.errors import raise_rule
from app.sop.groups import TABLE_UNIT_KINDS, select_in_chunks
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
    UnitPairMember,
)
from app.sop.segment import has_visible_char
from app.sop.snapshot import TargetDocInfo, load_target_docs
from app.sop.target_placement import NewTarget, arrange_new_targets
from app.sop.units import UNIT_ACTIVE

CLASSIFY_KIND = "classify"
_KINDS = (CLASSIFY_KIND,)  # 분류는 같은 종류 제안 위에만 쓴다 — 입구 2 제안을 덮지 않는다(설계 §6.8)
_PROMPT_KEY = "prompt.classify"
_FEATURE = "sop.classify"
_REWRITE_LANGS = ("ko", "en")

AiWarning = dict[str, str]
_Place = tuple[int | None, str | None, int | None, str | None]  # (새 문서, 칸, WI 단계, WI 부분)


class EvidenceQuote(BaseModel):
    unit_id: int
    quote: AiStr


class ClassifyReply(BaseModel):
    """LLM 응답 — 글 칸은 모두 AiStr라 저장 전에 정리되고 상한을 지킨다. 칸이 빠지면 형식이 틀린 응답이다."""

    candidate: AiStr
    reason: AiStr
    rule_ids: list[AiStr]
    evidence: list[EvidenceQuote]
    change_type: Literal["as_is", "tone", "rewritten"]
    rewrites: dict[Literal["ko", "en"], list[AiStr]]


# --- 요청 ---


async def _ensure_assign_documents(session: AsyncSession, bundle_id: int) -> None:
    has_assign = await session.scalar(
        select(TargetDoc.id).where(TargetDoc.bundle_id == bundle_id, TargetDoc.entrance == "assign").limit(1)
    )
    if has_assign is None:
        raise_rule(409, "no_assign_targets")


async def load_latest_extractions(session: AsyncSession, bundle_id: int, document_id: int | None) -> dict[int, int]:
    """옛 문서마다 최신 추출 {추출 id: 문서 id}. 문서를 짚었는데 이 묶음의 옛 문서가 아니면 404."""
    if document_id is not None:
        document = await session.get(Document, document_id)
        if document is None or document.bundle_id != bundle_id or document.side != "old":
            raise_rule(404, "document_not_found")
    scope = [] if document_id is None else [Document.id == document_id]
    rows = await session.execute(
        select(func.max(Extraction.id), Extraction.document_id)
        .join(Document, Document.id == Extraction.document_id)
        .where(Document.bundle_id == bundle_id, Document.side == "old", *scope)
        .group_by(Extraction.document_id)
    )
    return dict(rows.tuples().all())


async def _load_scope_rows(
    session: AsyncSession, extraction_ids: Collection[int], unit_ids: Collection[int]
) -> list[Row[Any]]:
    """범위의 활성 단위와 판단 — 글은 읽지 않는다. unit_ids가 비면 추출 전체이고, 결과는 문서 안 순서다."""
    statement = (
        select(
            Unit.id, Unit.extraction_id, Unit.group_unit_id, Unit.pos_seq, Unit.pos_start,
            UnitDecision.status, UnitDecision.disposition, AiSuggestion.kind.label("suggestion_kind"),
        )
        .join(UnitDecision, UnitDecision.unit_id == Unit.id)
        .outerjoin(AiSuggestion, AiSuggestion.id == UnitDecision.suggestion_id)
        .where(Unit.extraction_id.in_(list(extraction_ids)), Unit.status == UNIT_ACTIVE)
    )
    if unit_ids:
        rows = await select_in_chunks(session, lambda chunk: statement.where(Unit.id.in_(chunk)), unit_ids)
    else:
        rows = list((await session.execute(statement)).all())
    return sorted(rows, key=_get_row_order)


def _get_row_order(row: Row[Any]) -> tuple[int, int, int, int]:
    return (row.extraction_id, row.pos_seq, row.pos_start, row.id)


def _find_skip_reason(row: Row[Any], kinds: Collection[str], queued: Collection[int]) -> SkipReason | None:
    """kinds는 다시 받을 수 있는 제안 종류다 — 비우면 미배정만 받는다."""
    if row.group_unit_id is not None:
        return "bound_cell"  # 칸 문장의 처분은 그룹 단위가 담는다
    if not can_receive_suggestion(row.status, row.disposition, row.suggestion_kind, kinds):
        return "not_unassigned"
    if row.id in queued:
        return "already_queued"
    return None


async def _load_pair_ids(session: AsyncSession, unit_ids: Collection[int]) -> dict[int, int]:
    rows = await select_in_chunks(
        session,
        lambda chunk: select(UnitPairMember.unit_id, UnitPairMember.pair_id).where(UnitPairMember.unit_id.in_(chunk)),
        unit_ids,
    )
    return {unit_id: pair_id for unit_id, pair_id in rows}


async def _load_open_mates(
    session: AsyncSession, extraction_ids: Collection[int], rows: Sequence[Row[Any]], queued: Collection[int]
) -> list[Row[Any]]:
    """받아들인 단위의 짝 구성원 중 AI가 쓸 수 있는 단위 — 확정·보류 구성원은 빠진다. 고른 단위가 아니라 건너뜀으로 알리지 않는다."""
    chosen = {row.id for row in rows}
    pair_ids = set((await _load_pair_ids(session, chosen)).values())
    members = await select_in_chunks(
        session, lambda chunk: select(UnitPairMember.unit_id).where(UnitPairMember.pair_id.in_(chunk)), pair_ids
    )
    mate_ids = {member.unit_id for member in members} - chosen
    if not mate_ids:  # 빈 목록을 넘기면 _load_scope_rows가 추출 전체를 읽는다
        return []
    mates = await _load_scope_rows(session, extraction_ids, mate_ids)
    return [mate for mate in mates if _find_skip_reason(mate, _KINDS, queued) is None]


async def select_classify_items(
    session: AsyncSession, bundle_id: int, *, document_id: int | None, unit_ids: Sequence[int] | None
) -> tuple[list[JobItem], list[SkippedOut]]:
    """요청 범위를 작업 줄로 — 옛 문서 최신 추출의 활성 단위 중 묶이지 않은 커버 단위와 표·행 단위만 받는다(설계 §7.8).

    문서 범위는 미배정만 받는다. 끝난 앞쪽을 다시 받으면 상한을 넘는 문서의 뒤쪽이 영영 처리되지 않아, 같은 종류 제안을 다시 받는 것은
    단위를 고른 요청뿐이다. 고른 단위는 AI가 쓸 수 있는 짝 구성원을 함께 담고, 짝(제안 포함)은 한 작업이다.
    범위의 단위가 이 묶음 것이 아니면 다른 라우터처럼 404다.
    """
    await _ensure_assign_documents(session, bundle_id)
    documents = await load_latest_extractions(session, bundle_id, document_id)
    requested = set(unit_ids or ())
    rows = await _load_scope_rows(session, documents, requested)
    ensure_units_found(requested, {row.id for row in rows})

    queued = await find_active_unit_ids(session, bundle_id, _KINDS)
    kinds = _KINDS if requested else ()
    skipped: list[SkippedOut] = []
    accepted: list[Row[Any]] = []
    for row in rows:
        reason = _find_skip_reason(row, kinds, queued)
        if reason is None:
            accepted.append(row)
        else:
            skipped.append(SkippedOut(unit_id=row.id, reason=reason))

    if requested:
        accepted = sorted([*accepted, *await _load_open_mates(session, documents, accepted, queued)], key=_get_row_order)
    pair_ids = await _load_pair_ids(session, [row.id for row in accepted])
    grouped: dict[tuple[str, int], list[Row[Any]]] = {}
    for row in accepted:  # 사전은 넣은 순서를 지켜 작업도 첫 구성원의 문서 순서를 따른다
        pair_id = pair_ids.get(row.id)
        grouped.setdefault(("unit", row.id) if pair_id is None else ("pair", pair_id), []).append(row)
    items = [
        JobItem(document_id=documents[members[0].extraction_id], unit_ids=[member.id for member in members])
        for members in grouped.values()
    ]
    return cap_job_items(items, skipped)


# --- load ---


@dataclass(frozen=True)
class _Loaded:
    """load가 읽어 둔 입력 — compute는 세션 없이 이 값만 본다. units는 세션이 닫혀도 읽기만 하는 값이다."""

    units: tuple[Unit, ...]
    contexts: Mapping[int, UnitContext]
    candidates: tuple[Candidate, ...]
    docs: Mapping[int, TargetDocInfo]
    guidelines: Mapping[str, GuidelineRef]
    input_refs: dict[str, object]


async def load_units(session: AsyncSession, unit_ids: Collection[int]) -> list[Unit]:
    rows = await select_in_chunks(session, lambda chunk: select(Unit).where(Unit.id.in_(chunk)), set(unit_ids))
    return sorted((row[0] for row in rows), key=lambda unit: (unit.pos_seq, unit.pos_start, unit.id))


def _hash_unit(unit: Unit) -> str:
    """글자와 언어의 해시 — 언어 고치기는 판단 revision을 올리지 않지만 언어별 고쳐 쓰기를 어긋나게 한다."""
    return hashlib.sha256(f"{unit.lang}\n{unit.text}".encode()).hexdigest()


async def load_input_refs(session: AsyncSession, extraction_id: int) -> dict[str, object]:
    """제안 기록에 남기는 입력 문서 버전 — 파일 해시와 추출 id(설계 §6.11)."""
    sha256 = await session.scalar(
        select(Document.sha256).join(Extraction, Extraction.document_id == Document.id).where(Extraction.id == extraction_id)
    )
    return {"sha256": sha256, "extraction_id": extraction_id}


# --- compute ---


def _pick_rewrites(reply: ClassifyReply | None = None, units: Iterable[Unit] = ()) -> dict[str, list[str]]:
    """제안 기록에 남길 고쳐 쓴 문장 — 새 문장이 되는 언어만. 제안이 밀려 ai_text가 지워진 뒤에도 이 기록은 남는다(설계 §6.11)."""
    langs = {unit.lang for unit in units if unit.kind in SENTENCE_SOURCE_KINDS}
    return {lang: list(reply.rewrites.get(lang, [])) if reply and lang in langs else [] for lang in _REWRITE_LANGS}


@dataclass(frozen=True)
class _Verdict:
    """응답을 검사한 결과. reply가 None이면 무효 — warnings가 이유를 코드로 담고 응답 글은 어디에도 남기지 않는다."""

    model: str
    retrieval: Retrieval
    reply: ClassifyReply | None = None
    candidate: Candidate | None = None
    rule_ids: tuple[str, ...] = ()
    evidence: tuple[dict[str, object], ...] = ()
    warnings: tuple[AiWarning, ...] = ()
    rewrites: dict[str, list[str]] = field(default_factory=_pick_rewrites)


def build_warning(kind: str, value: str = "") -> AiWarning:
    """경고는 코드와 정리된 값만 담는다 — 모양은 check_sentence와 같아야 Excel이 읽는다. 값은 AI가 준 글이라 길이를 잘라 저장 JSON이 부풀지 않게 한다."""
    return {"kind": kind, "source": value[:MAX_WARNING_VALUE_LEN], "target": ""}


def check_rule_ids(
    rule_ids: Sequence[str], guidelines: Mapping[str, GuidelineRef]
) -> tuple[tuple[str, ...], list[AiWarning]]:
    """지금 규칙 문서에 있는 ID만 남긴다 — 없는 ID는 빼고 경고한다."""
    known_rules = extract_rule_ids(guidelines[RULES_KEY].content)
    kept = tuple(rule_id for rule_id in rule_ids if rule_id in known_rules)
    return kept, [build_warning("unknown_rule_id", rule_id) for rule_id in rule_ids if rule_id not in known_rules]


def _read_unit_text(unit: Unit, context: UnitContext) -> str:
    """단위의 글 — 표·행 단위는 자기 글이 없어 표 Markdown이 그 글이다."""
    return unit.text or context.table_markdown


def _build_query(loaded: _Loaded) -> str:
    """후보 검색 글 — 대상 단위 글을 잇는다. 캡션 없는 그림은 글이 없어 소속 절로 찾는다(빈 글의 유사도는 뜻이 없다)."""
    return "\n".join(
        _read_unit_text(unit, loaded.contexts[unit.id]) or loaded.contexts[unit.id].section for unit in loaded.units
    )


def _build_tobe(docs: Mapping[int, TargetDocInfo]) -> list[dict[str, object]]:
    ordered = sorted(docs.values(), key=lambda doc: (doc.order_index, doc.id))
    return [
        {
            "code": doc.code, "title": doc.title, "doc_type": doc.doc_type,
            "parent_code": docs[doc.parent_id].code if doc.parent_id in docs else None,
        }
        for doc in ordered
    ]


def _build_payload(loaded: _Loaded, ranked: Sequence[Candidate]) -> dict[str, object]:
    """LLM에 보내는 데이터 — 원문과 To-Be만 싣는다. 작업의 요청자 같은 사람 정보는 넣지 않는다(설계 §8.5)."""
    return {
        "task": CLASSIFY_KIND,
        "units": [{"id": unit.id, "kind": unit.kind, "lang": unit.lang, "text": unit.text} for unit in loaded.units],
        "context": [
            {
                "unit_id": unit.id,
                "section": loaded.contexts[unit.id].section,
                "before": list(loaded.contexts[unit.id].before),
                "after": list(loaded.contexts[unit.id].after),
                "table": loaded.contexts[unit.id].table_markdown,
            }
            for unit in loaded.units
        ],
        "candidates": [{"key": candidate.key, "label": candidate.label} for candidate in ranked],
        "tobe": _build_tobe(loaded.docs),
    }


def _find_rewrite_problem(units: Iterable[Unit], reply: ClassifyReply) -> AiWarning | None:
    """문장 단위가 있는 언어마다 고쳐 쓴 문장이 있어야 한다 — 빈 문장은 사람이 그대로 확정할 수 없다."""
    for lang in sorted({unit.lang for unit in units if unit.kind in SENTENCE_SOURCE_KINDS}):
        sentences = reply.rewrites.get(lang, [])
        if not sentences or not all(map(has_visible_char, sentences)):
            return build_warning("missing_rewrite", lang)
        if len(sentences) > MAX_REWRITE_SENTENCES:
            return build_warning("too_many_sentences", lang)
    return None


def _squeeze_spaces(text: str) -> str:
    return " ".join(text.split())


def _check_evidence(
    reply: ClassifyReply, texts: Mapping[int, str]
) -> tuple[list[dict[str, object]], list[AiWarning]]:
    """근거 인용은 그 단위 글 안에 있어야 한다(공백은 정규화해 비교). 없는 인용은 근거로 싣지 않고 경고로 남긴다."""
    found: list[dict[str, object]] = []
    warnings: list[AiWarning] = []
    for item in reply.evidence:
        quote = _squeeze_spaces(item.quote)
        if quote and quote in _squeeze_spaces(texts.get(item.unit_id, "")):
            found.append({"unit_id": item.unit_id, "quote": item.quote})
        else:
            warnings.append(build_warning("evidence_not_found", item.quote))
    return found, warnings


def _judge_reply(
    reply: ClassifyReply | None, loaded: _Loaded, ranked: Sequence[Candidate], retrieval: Retrieval, model: str
) -> _Verdict:
    """응답 검사 — 형식·후보 소속·고쳐 쓰기가 틀리면 무효이고, 규칙 ID·근거는 빼고 경고한다(설계 §7.8 4단계)."""
    if reply is None:
        return _Verdict(model, retrieval, warnings=(build_warning("invalid_format"),))
    candidate = next((item for item in ranked if item.key == reply.candidate), None)
    if candidate is None:
        return _Verdict(model, retrieval, warnings=(build_warning("unknown_candidate", reply.candidate),))
    if candidate != DELETE_CANDIDATE:
        problem = _find_rewrite_problem(loaded.units, reply)
        if problem is not None:
            return _Verdict(model, retrieval, warnings=(problem,))
    rule_ids, unknown = check_rule_ids(reply.rule_ids, loaded.guidelines)
    texts = {unit.id: _read_unit_text(unit, loaded.contexts[unit.id]) for unit in loaded.units}
    evidence, not_found = _check_evidence(reply, texts)
    rewrites = _pick_rewrites() if candidate == DELETE_CANDIDATE else _pick_rewrites(reply, loaded.units)
    return _Verdict(model, retrieval, reply, candidate, rule_ids, tuple(evidence), (*unknown, *not_found), rewrites)


# --- apply ---


def _get_disposition(candidate: Candidate) -> str:
    return "delete" if candidate == DELETE_CANDIDATE else "assigned"


def _build_content(job: AiJob, verdict: _Verdict, target_ids: Sequence[int] = ()) -> dict[str, object]:
    """제안 내용(API 계약 `classify`) — 무효면 자리·이유 칸이 비고 응답 글은 싣지 않는다."""
    reply, candidate = verdict.reply, verdict.candidate
    change_type: str | None = None
    if reply is not None and candidate is not None:
        change_type = "deleted" if candidate == DELETE_CANDIDATE else reply.change_type
    return {
        "unit_ids": list(job.unit_ids),
        "disposition": _get_disposition(candidate) if candidate is not None else None,
        "target_doc_id": candidate.target_doc_id if candidate is not None else None,
        "slot_key": candidate.slot_key if candidate is not None else None,
        "wi_step": candidate.wi_step if candidate is not None else None,
        "wi_part": candidate.wi_part if candidate is not None else None,
        "reason": reply.reason if reply is not None else "",
        "rule_ids": list(verdict.rule_ids),
        "evidence": list(verdict.evidence),
        "change_type": change_type,
        "rewrites": verdict.rewrites,
        "retrieval": verdict.retrieval,
        "target_ids": list(target_ids),
    }


def _get_place(candidate: Candidate) -> _Place:
    return (candidate.target_doc_id, candidate.slot_key, candidate.wi_step, candidate.wi_part)


def _is_place_alive(candidate: Candidate, docs: Mapping[int, TargetDocInfo]) -> bool:
    """고른 자리가 아직 후보인가 — 문서가 지워졌거나 칸이 N/A가 됐거나 WI 단계가 사라졌으면 아니다. 후보 목록과 같은 규칙으로 본다."""
    return _get_place(candidate) in {_get_place(item) for item in list_candidates(docs.values())}


def _build_target(job: AiJob, candidate: Candidate, suggestion_id: int, **fields: Any) -> TargetSentence:
    """AI 새 문장 — 확정 글은 비워 두고 ai_text에만 쓴다. 자리는 후보, 나머지는 종류별로 다르다."""
    return TargetSentence(
        bundle_id=job.bundle_id, target_doc_id=candidate.target_doc_id, slot_key=candidate.slot_key,
        wi_step=candidate.wi_step, wi_part=candidate.wi_part, confirmed_text="", origin=ORIGIN_UNITS,
        status=AI_SUGGESTED, suggestion_id=suggestion_id, revision=1, **fields,
    )


async def _load_next_order(session: AsyncSession, target_doc_id: int) -> int:
    """순서를 사람이 정한 새 문서에서 끝 다음 자리."""
    current = await session.scalar(
        select(func.max(TargetSentence.order_index)).where(TargetSentence.target_doc_id == target_doc_id)
    )
    return (current if current is not None else -1) + 1


async def _add_cell_targets(
    session: AsyncSession, job: AiJob, candidate: Candidate, suggestion_id: int, table_unit: Unit, table_target: TargetSentence
) -> list[tuple[TargetSentence, list[Unit]]]:
    """묶인 활성 칸마다 칸 글자 그대로의 칸 새 문장 — 지금 읽어 호출 동안 바뀐 칸도 맞는다. 행 단위의 칸 좌표는 그 행 기준이다."""
    rows = await session.scalars(
        select(Unit)
        .where(Unit.group_unit_id == table_unit.id, Unit.status == UNIT_ACTIVE)
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    cells = list(rows)
    positions = await load_cell_positions(session, cells)
    first_row = (table_unit.row_index or 0) if table_unit.kind == "table_row" else 0
    placed = []
    for cell in cells:
        row_index, col_index = positions[cell.id]
        target = _build_target(
            job, candidate, suggestion_id, kind="sentence", lang=cell.lang, ai_text=cell.text, change_type="as_is",
            parent_target_id=table_target.id, cell_row=row_index - first_row, cell_col=col_index,
        )
        session.add(target)
        placed.append((target, [cell]))
    return placed


async def _arrange_sentences(
    session: AsyncSession,
    sentences: Sequence[tuple[TargetSentence, list[Unit]]],
    candidate: Candidate,
    orders: Iterator[int],
) -> None:
    """문장 새 문장의 기본 번호 표시와 순서 — 짝 하나는 작업 하나라 두 언어가 한 번에 같은 칸에 놓인다(제품 명세 §7.13 섹션 번호 기본값 O10, 사람 저장과 같은 규칙).

    분류는 출처 언어로만 쓰므로 번역이 없고, 새 제안이라 같은 출처의 기존 새 문장도 없다(이전 제안은 apply가 먼저 걷었다).
    """
    if not sentences:
        return
    pair_ids = await _load_pair_ids(session, [sources[0].id for _, sources in sentences])
    arranged = arrange_new_targets([
        NewTarget(
            key=str(index), place=_get_place(candidate), meaning=pair_ids.get(sources[0].id, -sources[0].id),
            lang=target.lang, source_unit_id=sources[0].id, is_translation=False, source_placed=False,
        )
        for index, (target, sources) in enumerate(sentences)
    ])
    for item in arranged:  # 돌려받은 순서가 순서를 정한 문서에 붙일 순서다(영어 먼저)
        target = sentences[int(item.key)][0]
        target.number_style, target.order_index = item.number_style, next(orders)


def _add_result(session: AsyncSession, job: AiJob, loaded: _Loaded, verdict: _Verdict, result: str) -> AiSuggestion:
    return add_suggestion(
        session, job, content=_build_content(job, verdict), warnings=verdict.warnings, result=result,
        guideline_versions=format_guideline_versions(loaded.guidelines), model=verdict.model,
        input_refs=loaded.input_refs,
    )


async def _write_targets(
    session: AsyncSession,
    job: AiJob,
    suggestion_id: int,
    units: Sequence[Unit],
    *,
    rewrites: Mapping[str, Sequence[str]],
    requested_change_type: str,
    candidate: Candidate,
    warnings: Sequence[AiWarning],
    doc: TargetDocInfo,
) -> list[int]:
    """새 문장과 출처를 쓰고 id를 돌려준다 — 칸 새 문장은 표 새 문장 id가 생긴 뒤에 쓴다."""
    orders = count(await _load_next_order(session, doc.id)) if doc.manual_order else repeat(0)
    placed: list[tuple[TargetSentence, list[Unit]]] = []

    sources_by_lang: dict[str, list[Unit]] = defaultdict(list)
    for unit in units:
        if unit.kind in SENTENCE_SOURCE_KINDS:
            sources_by_lang[unit.lang].append(unit)
    for lang, sources in sources_by_lang.items():
        sentences = rewrites[lang]
        source_texts = [source.text for source in sources]
        for text in sentences:
            change_type = decide_ai_change_type(sources, text, requested_change_type, sentence_count=len(sentences))
            target = _build_target(
                job, candidate, suggestion_id, kind="sentence", lang=lang, ai_text=text, change_type=change_type,
                warnings=[*check_sentence(source_texts, text), *warnings],
            )
            placed.append((target, sources))
    await _arrange_sentences(session, placed, candidate, orders)

    table_units = [unit for unit in units if unit.kind in TABLE_UNIT_KINDS]
    shapes = await load_table_shapes(session, table_units)
    tables: list[tuple[Unit, TargetSentence]] = []
    for unit in table_units:
        n_rows, n_cols = shapes[unit.table_id]
        target = _build_target(
            job, candidate, suggestion_id, kind="table", lang=NEUTRAL, ai_text="", change_type="as_is",
            grid={"rows": 1 if unit.kind == "table_row" else n_rows, "cols": n_cols},
            order_index=next(orders), warnings=list(warnings),
        )
        placed.append((target, [unit]))
        tables.append((unit, target))

    for unit in units:
        if unit.kind == "figure":
            target = _build_target(
                job, candidate, suggestion_id, kind="figure", lang=NEUTRAL, ai_text="", change_type="as_is",
                order_index=next(orders), warnings=list(warnings),
            )
            placed.append((target, [unit]))

    session.add_all(target for target, _ in placed)
    await session.flush()  # 칸 새 문장이 부모 id를, 출처 연결이 새 문장 id를 알아야 한다
    for unit, target in tables:
        placed += await _add_cell_targets(session, job, candidate, suggestion_id, unit, target)
    await session.flush()
    await session.execute(
        insert(TargetSource),
        [
            {"target_id": target.id, "unit_id": source.id, "seq": seq}
            for target, sources in placed
            for seq, source in enumerate(sources)
        ],
    )
    return [target.id for target, _ in placed]


class ClassifyHandler:
    """단위(짝) 하나 — 칸 후보를 추려 LLM에 고르게 하고, 낡지 않았을 때만 제안을 쓴다."""

    async def load(self, session: AsyncSession, job: AiJob) -> _Loaded | None:
        """입력을 읽고 작업 시작 시점의 스냅숏을 적는다 — 다시 시도도 이 단계를 지나므로 그때의 상태가 기준이 된다."""
        decisions = await load_open_decisions(session, unit_ids=job.unit_ids, kinds=_KINDS)
        if decisions is None:
            return None
        try:
            guidelines = await load_active_guidelines(session, (RULES_KEY, _PROMPT_KEY))
        except LookupError as exc:
            raise AiCallFailed("config") from exc
        docs = await load_target_docs(session, job.bundle_id)
        # WI 부모 제목을 푸는 데 필요해 assign이 아닌 문서까지 넘긴다 — 후보는 list_candidates가 assign만 낸다
        candidates = list_candidates(docs.values())
        if not candidates:
            raise AiCallFailed("no_candidates")
        units = await load_units(session, job.unit_ids)
        job.input_snapshot = {
            "revisions": {str(unit_id): decision.revision for unit_id, decision in decisions.items()},
            "hashes": {str(unit.id): _hash_unit(unit) for unit in units},
        }
        return _Loaded(
            units=tuple(units),
            contexts=await load_unit_context(session, job.unit_ids),
            candidates=tuple(candidates),
            docs=docs,
            guidelines=guidelines,
            input_refs=await load_input_refs(session, units[0].extraction_id),
        )

    async def compute(self, job: AiJob, loaded: _Loaded) -> _Verdict:
        ensure_llm_enabled()  # 후보 추리기가 원문을 임베딩으로 보내기 전에 본다
        ranked, retrieval = await rank_candidates(_build_query(loaded), loaded.candidates, login_id=job.requested_by)
        reply = await call_llm(
            login_id=job.requested_by,
            feature=_FEATURE,
            messages=build_messages(list(loaded.guidelines.values()), _build_payload(loaded, ranked)),
            reasoning="high",
        )
        return _judge_reply(parse_reply(reply.content, ClassifyReply), loaded, ranked, retrieval, reply.model)

    async def apply(self, session: AsyncSession, job: AiJob, loaded: _Loaded, computed: _Verdict) -> str:
        decisions = await load_fresh_decisions(
            session, unit_ids=job.unit_ids, snapshot=job.input_snapshot["revisions"], kinds=_KINDS
        )
        units = await load_units(session, job.unit_ids)
        docs = await load_target_docs(session, job.bundle_id)
        reply, candidate = computed.reply, computed.candidate
        is_text_changed = any(_hash_unit(unit) != job.input_snapshot["hashes"].get(str(unit.id)) for unit in units)
        is_place_lost = candidate not in (None, DELETE_CANDIDATE) and not _is_place_alive(candidate, docs)
        if decisions is None or is_text_changed or is_place_lost:
            _add_result(session, job, loaded, computed, "stale")
            return "stale"

        await clear_previous_suggestion(session, decisions.values())
        if reply is None or candidate is None:
            hold_invalid(decisions.values())
            _add_result(session, job, loaded, computed, "invalid")
            return "done"

        suggestion = _add_result(session, job, loaded, computed, "applied")
        await session.flush()  # 새 문장·판단이 제안 id를 가리킨다
        if candidate != DELETE_CANDIDATE:
            target_ids = await _write_targets(
                session, job, suggestion.id, units, rewrites=computed.rewrites, requested_change_type=reply.change_type,
                candidate=candidate, warnings=computed.warnings, doc=docs[candidate.target_doc_id],
            )
            suggestion.content = _build_content(job, computed, target_ids)
        for decision in decisions.values():
            decision.status, decision.disposition = AI_SUGGESTED, _get_disposition(candidate)
            decision.suggestion_id = suggestion.id
            decision.revision += 1
        return "done"


CLASSIFY_HANDLER = ClassifyHandler()
