"""AI 번역 — 배정된 단위의 새 문장을 고른 방향으로 옮겨 대상 언어의 번역 새 문장을 제안한다, 요청 범위 고르기와 load·compute·apply (설계 §7.9).

번역은 없어도 완료되는 덤이라(설계 §6.5) 단위의 판단을 건드리지 않고, 출처 연결도 없어 관계 묶음·닫힘에 끼지 않는다. 쓰는 곳은 ai_text뿐이다.
"""

from collections import defaultdict
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel
from sqlalchemy import Row, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.sop.ai.apply import add_suggestion
from app.sop.ai.classify import AiWarning, load_input_refs, load_latest_extractions
from app.sop.ai.guidelines import (
    RULES_KEY,
    GuidelineRef,
    format_guideline_versions,
    load_active_guidelines,
)
from app.sop.ai.jobs import JobItem, cap_job_items, ensure_units_found, find_active_unit_ids
from app.sop.ai.llm import AiStr, build_messages, call_llm, parse_reply
from app.sop.ai.runner import AiCallFailed
from app.sop.ai.schemas import SkippedOut, SkipReason
from app.sop.checks import check_sentence
from app.sop.constants import NUMBER_OMITTED
from app.sop.detach import (
    AI_SUGGESTED,
    CONFIRMED,
    ON_HOLD,
    ORIGIN_TRANSLATION,
    TRANSLATED_TARGET_ID,
    drop_translations,
)
from app.sop.groups import select_in_chunks
from app.sop.models import (
    AiJob,
    AiSuggestion,
    TargetDoc,
    TargetSentence,
    TargetSource,
    Unit,
    UnitDecision,
    UnitPairMember,
)
from app.sop.segment import has_visible_char
from app.sop.target_placement import insert_after
from app.sop.units import UNIT_ACTIVE

TRANSLATE_KIND = "translate"
_KINDS = (TRANSLATE_KIND,)
_PROMPT_KEY = "prompt.translate"
_FEATURE = "sop.translate"
_DIRECTIONS: dict[str, tuple[str, str]] = {"ko_to_en": ("ko", "en"), "en_to_ko": ("en", "ko")}  # 방향 → (출발, 도착) 언어
_INVALID_WARNING: AiWarning = {"kind": "invalid_format", "source": "", "target": ""}


class TranslateReply(BaseModel):
    """LLM 응답 — 글 칸은 AiStr라 저장 전에 정리되고 상한을 지킨다."""

    text: AiStr


# --- 요청 ---


async def _load_scope_rows(
    session: AsyncSession, extraction_ids: Collection[int], unit_ids: Collection[int]
) -> list[Row[Any]]:
    """범위의 활성 단위와 처분 — 묶인 칸 문장의 처분은 그룹 단위가 담는다. unit_ids가 비면 추출 전체이고, 결과는 문서 안 순서다."""
    group_decision = aliased(UnitDecision)
    statement = (
        select(
            Unit.id, Unit.extraction_id, Unit.lang, Unit.pos_seq, Unit.pos_start,
            func.coalesce(group_decision.disposition, UnitDecision.disposition).label("disposition"),
        )
        .join(UnitDecision, UnitDecision.unit_id == Unit.id)
        .outerjoin(group_decision, group_decision.unit_id == Unit.group_unit_id)
        .where(Unit.extraction_id.in_(list(extraction_ids)), Unit.status == UNIT_ACTIVE)
    )
    if unit_ids:
        rows = await select_in_chunks(session, lambda chunk: statement.where(Unit.id.in_(chunk)), unit_ids)
    else:
        rows = list((await session.execute(statement)).all())
    return sorted(rows, key=lambda row: (row.extraction_id, row.pos_seq, row.pos_start, row.id))


async def _load_paired_units(session: AsyncSession, unit_ids: Collection[int], to_lang: str) -> set[int]:
    """도착 언어 단위와 짝인 단위 — 제안 짝도 센다. 그 언어 글이 이미 원문에 있어 번역이 필요 없다."""
    mate = aliased(UnitPairMember)
    rows = await select_in_chunks(
        session,
        lambda chunk: select(UnitPairMember.unit_id)
        .join(mate, mate.pair_id == UnitPairMember.pair_id)
        .join(Unit, Unit.id == mate.unit_id)
        .where(UnitPairMember.unit_id.in_(chunk), Unit.lang == to_lang),
        unit_ids,
    )
    return {row[0] for row in rows}


async def _load_unit_targets(
    session: AsyncSession, unit_ids: Collection[int], to_lang: str
) -> tuple[dict[int, dict[int, set[int]]], set[int]]:
    """(단위 → {번역할 문장 새 문장: 그 새 문장의 출처 단위들}, 도착 언어 새 문장을 이미 출처로 둔 단위들).

    합친 새 문장은 어느 출처로 물어도 같은 번역이라 출처 전부가 필요하다. 언어 잠금이 없어 단위가 다른 언어 새 문장(사람이 쓴
    Write English, 입구 2 짝)을 출처로 둘 수 있다 — 그 문장은 번역할 것이 아니라 이미 도착 언어로 쓰인 것이라 따로 돌려준다.
    번역 행은 출처 연결이 없어 여기에 잡히지 않는다.
    """
    mate = aliased(TargetSource)
    rows = await select_in_chunks(
        session,
        lambda chunk: select(TargetSource.unit_id, TargetSource.target_id, mate.unit_id, TargetSentence.lang)
        .join(mate, mate.target_id == TargetSource.target_id)
        .join(TargetSentence, TargetSentence.id == TargetSource.target_id)
        .where(TargetSource.unit_id.in_(chunk), TargetSentence.kind == "sentence"),
        unit_ids,
    )
    targets: dict[int, dict[int, set[int]]] = defaultdict(lambda: defaultdict(set))
    written: set[int] = set()
    for unit_id, target_id, source_unit_id, lang in rows:
        if lang == to_lang:
            written.add(unit_id)
        else:
            targets[unit_id][target_id].add(source_unit_id)
    return targets, written


async def _load_settled(session: AsyncSession, bundle_id: int, to_lang: str) -> tuple[set[int], set[int]]:
    """사람이 확정·보류한 번역이 가리키는 (단위들, 출처 새 문장들) — 보류도 사람이 볼 차례라 AI가 옆에 새 번역을 놓지 않는다.

    합친 새 문장의 번역은 출처 하나만 가리켜서, 그 출처가 떨어져 나가면 남은 출처로는 단위가 맞지 않아 새 문장으로도 본다.
    """
    rows = await session.execute(
        select(TargetSentence.translation_source_unit_id, TRANSLATED_TARGET_ID)
        .join(AiSuggestion, AiSuggestion.id == TargetSentence.suggestion_id)
        .where(
            TargetSentence.bundle_id == bundle_id, TargetSentence.origin == ORIGIN_TRANSLATION,
            TargetSentence.lang == to_lang, TargetSentence.status.in_((CONFIRMED, ON_HOLD)),
        )
    )
    settled = rows.all()
    return {unit_id for unit_id, _ in settled}, {target_id for _, target_id in settled}


def _find_skip_reason(
    row: Row[Any], from_lang: str, source_units: set[int], *, paired: set[int], is_settled: bool, queued: set[int]
) -> SkipReason | None:
    """source_units는 번역할 새 문장들의 출처 전부다 — 비었으면 옮길 문장이 없는 단위(구성을 바꾼 표에서 빠진 칸)다."""
    if row.disposition != "assigned":
        return "not_assigned"
    if row.lang != from_lang:
        return "other_language"
    if row.id in paired:
        return "has_pair"
    if is_settled:
        return "already_translated"
    if not source_units:
        return "not_assigned"
    if source_units & queued:
        return "already_queued"
    return None


async def select_translate_items(
    session: AsyncSession, bundle_id: int, *, direction: str, document_id: int | None, unit_ids: Sequence[int] | None
) -> tuple[list[JobItem], list[SkippedOut]]:
    """요청 범위를 작업 줄로 — 출처 새 문장 하나에 작업 하나다(설계 §7.9).

    문서 범위는 출발 언어 단위만 본다. 다른 언어까지 건너뜀으로 알리면 한/영 문서의 절반이 목록을 채워 정작 볼 사유가 밀려난다.
    고른 단위는 언어가 달라도 고른 사람에게 이유를 알린다. 범위의 단위가 이 묶음 것이 아니면 다른 라우터처럼 404다.
    """
    from_lang, to_lang = _DIRECTIONS[direction]
    documents = await load_latest_extractions(session, bundle_id, document_id)
    requested = set(unit_ids or ())
    rows = await _load_scope_rows(session, documents, requested)
    ensure_units_found(requested, {row.id for row in rows})
    scope = rows if requested else [row for row in rows if row.lang == from_lang]

    ids = [row.id for row in scope]
    unit_targets, written = await _load_unit_targets(session, ids, to_lang)
    source_units = {
        row.id: {unit_id for sources in unit_targets[row.id].values() for unit_id in sources} for row in scope
    }
    paired = await _load_paired_units(session, ids, to_lang)
    settled_units, settled_targets = await _load_settled(session, bundle_id, to_lang)
    queued = await find_active_unit_ids(session, bundle_id, _KINDS)

    items: list[JobItem] = []
    skipped: list[SkippedOut] = []
    seen: set[int] = set()
    for row in scope:
        is_settled = bool(
            row.id in written or source_units[row.id] & settled_units or unit_targets[row.id].keys() & settled_targets
        )
        reason = _find_skip_reason(
            row, from_lang, source_units[row.id], paired=paired, is_settled=is_settled, queued=queued
        )
        if reason is not None:
            skipped.append(SkippedOut(unit_id=row.id, reason=reason))
            continue
        for target_id in sorted(unit_targets[row.id].keys() - seen):
            seen.add(target_id)
            items.append(
                JobItem(
                    document_id=documents[row.extraction_id], unit_ids=[row.id], target_ids=[target_id],
                    payload={"to": to_lang},
                )
            )
    return cap_job_items(items, skipped)


# --- load·compute ---


@dataclass(frozen=True)
class _Loaded:
    """load가 읽어 둔 입력 — compute는 세션 없이 이 값만 본다."""

    unit_text: str
    payload: dict[str, object]
    guidelines: Mapping[str, GuidelineRef]
    input_refs: dict[str, object]


@dataclass(frozen=True)
class _Verdict:
    """응답을 검사한 결과. text가 None이면 무효 — 응답 글은 어디에도 남기지 않는다."""

    model: str
    text: str | None = None
    warnings: tuple[AiWarning, ...] = (_INVALID_WARNING,)


async def _load_previous_translations(session: AsyncSession, job: AiJob) -> list[TargetSentence] | None:
    """이 출처 새 문장의 지금 번역들, 사람이 정한 번역이 있으면 None — AI는 그 옆에 또 놓지 않는다.

    나눈 단위는 조각마다 작업이 따로라 단위와 언어만으로 찾으면 앞 조각의 번역을 밀어낸다. 번역에는 출처 새 문장 칸이 없어 제안 기록으로 가린다.
    합친 새 문장의 번역은 어느 출처를 가리켜도 같은 번역이다. 출처 새 문장이 없어진 번역은 이 새 문장의 단위를 가리키면 이전 번역으로 본다.
    """
    source_id = job.target_ids[0]
    alive = aliased(TargetSentence)
    rows = await session.scalars(
        select(TargetSentence)
        .join(AiSuggestion, AiSuggestion.id == TargetSentence.suggestion_id)
        .outerjoin(alive, alive.id == TRANSLATED_TARGET_ID)
        .where(
            TargetSentence.bundle_id == job.bundle_id, TargetSentence.origin == ORIGIN_TRANSLATION,
            TargetSentence.lang == job.payload["to"],
            or_(
                TRANSLATED_TARGET_ID == source_id,
                and_(
                    alive.id.is_(None),
                    TargetSentence.translation_source_unit_id.in_(
                        select(TargetSource.unit_id).where(TargetSource.target_id == source_id)
                    ),
                ),
            ),
        )
    )
    previous = list(rows)
    return None if any(target.status != AI_SUGGESTED for target in previous) else previous


def _build_payload(job: AiJob, unit: Unit, source: TargetSentence, doc_type: str) -> dict[str, object]:
    """LLM에 보내는 데이터 — 번역할 글과 언어, 문체를 정할 문서 종류뿐이다. 사람 정보는 넣지 않는다(설계 §8.5)."""
    return {
        "task": TRANSLATE_KIND,
        "text": source.confirmed_text or source.ai_text,
        "from": unit.lang,
        "to": job.payload["to"],
        "doc_type": doc_type,
    }


# --- apply ---


def _build_content(job: AiJob, text: str, target_id: int | None = None) -> dict[str, object]:
    """제안 내용(API 계약 `translate`) — 밀려서 번역 행이 지워져도 번역 글이 기록에 남게 text를 더한다(설계 §6.11). 무효면 비어 있다."""
    return {
        "unit_id": job.unit_ids[0], "source_target_id": job.target_ids[0], "to": job.payload["to"], "target_id": target_id,
        "text": text,
    }


def _add_result(session: AsyncSession, job: AiJob, loaded: _Loaded, computed: _Verdict, result: str) -> AiSuggestion:
    return add_suggestion(
        session, job, content=_build_content(job, computed.text or ""), warnings=computed.warnings, result=result,
        guideline_versions=format_guideline_versions(loaded.guidelines), model=computed.model,
        input_refs=loaded.input_refs,
    )


def _build_translation(
    job: AiJob, source: TargetSentence, computed: _Verdict, suggestion_id: int, order_index: int
) -> TargetSentence:
    """번역 새 문장 — 자리·칸 자리는 출처 새 문장과 같고(설계 §7.9) 확정 글은 비워 둔다. 번호 표시는 생략으로 시작한다(출처 표시와 따로)."""
    return TargetSentence(
        bundle_id=job.bundle_id, target_doc_id=source.target_doc_id, slot_key=source.slot_key, wi_step=source.wi_step,
        wi_part=source.wi_part, section_path=source.section_path, order_index=order_index,
        indent_level=source.indent_level, number_style=NUMBER_OMITTED,
        lang=job.payload["to"], kind="sentence", confirmed_text="", ai_text=computed.text, change_type="translated",
        origin=ORIGIN_TRANSLATION, translation_source_unit_id=job.unit_ids[0], parent_target_id=source.parent_target_id,
        cell_row=source.cell_row, cell_col=source.cell_col, status=AI_SUGGESTED, warnings=list(computed.warnings),
        suggestion_id=suggestion_id, revision=1,
    )


class TranslateHandler:
    """출처 새 문장 하나 — 지금 글을 옮겨, 그 글이 그대로일 때만 번역 새 문장을 쓴다."""

    async def load(self, session: AsyncSession, job: AiJob) -> _Loaded | None:
        """입력을 읽고 작업 시작 시점의 revision을 적는다 — 다시 시도도 이 단계를 지나므로 그때의 상태가 기준이 된다."""
        source = await session.get(TargetSentence, job.target_ids[0])
        unit = await session.get(Unit, job.unit_ids[0])
        if source is None or unit is None or unit.status != UNIT_ACTIVE:
            return None
        if await _load_previous_translations(session, job) is None:
            return None
        try:
            guidelines = await load_active_guidelines(session, (RULES_KEY, _PROMPT_KEY))
        except LookupError as exc:
            raise AiCallFailed("config") from exc
        doc = await session.get_one(TargetDoc, source.target_doc_id)
        job.input_snapshot = {"revision": source.revision}
        return _Loaded(
            unit_text=unit.text,
            payload=_build_payload(job, unit, source, doc.doc_type),
            guidelines=guidelines,
            input_refs=await load_input_refs(session, unit.extraction_id),
        )

    async def compute(self, job: AiJob, loaded: _Loaded) -> _Verdict:
        reply = await call_llm(
            login_id=job.requested_by,
            feature=_FEATURE,
            messages=build_messages(list(loaded.guidelines.values()), loaded.payload),
            reasoning="low",
        )
        parsed = parse_reply(reply.content, TranslateReply)
        if parsed is None or not has_visible_char(parsed.text):
            return _Verdict(reply.model)
        return _Verdict(reply.model, parsed.text, tuple(check_sentence([loaded.unit_text], parsed.text)))

    async def apply(self, session: AsyncSession, job: AiJob, loaded: _Loaded, computed: _Verdict) -> str:
        source = await session.get(TargetSentence, job.target_ids[0])
        previous = await _load_previous_translations(session, job)
        if source is None or source.revision != job.input_snapshot["revision"] or previous is None:
            _add_result(session, job, loaded, computed, "stale")
            return "stale"

        if computed.text is None:  # 분류와 달리 보류가 없다 — 쓸 수 있는 이전 번역을 망가진 응답으로 걷지 않는다
            _add_result(session, job, loaded, computed, "invalid")
            return "done"

        await drop_translations(session, previous)
        suggestion = _add_result(session, job, loaded, computed, "applied")
        await session.flush()  # 새 문장이 제안 id를 가리킨다
        doc = await session.get_one(TargetDoc, source.target_doc_id)
        order_index = source.order_index
        if doc.manual_order and source.parent_target_id is None:  # 사람이 정한 순서의 문서는 출처 바로 뒤에 끼운다
            order_index = await insert_after(session, source)
        target = _build_translation(job, source, computed, suggestion.id, order_index)
        session.add(target)
        await session.flush()
        suggestion.content = _build_content(job, computed.text, target.id)
        return "done"


TRANSLATE_HANDLER = TranslateHandler()
