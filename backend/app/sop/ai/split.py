"""AI 복합 문장 나누기 — 단위 하나의 글을 조각으로 자르게 해 나눌 글자 위치(`SplitOp.at`)를 제안한다, 요청 범위 고르기와 load·compute·apply (설계 §7.11, 규칙 R03).

제안은 위치만 기록한다. 단위·판단·새 문장은 어디에도 쓰지 않아 단위는 미배정 그대로고, 나누기는 사람이 위치를 받아들여 나누기 편집(§7.5)을 해야 일어난다.
그래서 낡음은 단위가 살아 있는 미배정이고 글이 그대로인지만 본다. 응답은 정해진 필드만 읽어 검사하고 무효 제안에는 응답 원문을 남기지 않는다.
"""

import hashlib
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import Row, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.ai.apply import add_suggestion, can_receive_suggestion, load_fresh_decisions, load_open_decisions
from app.sop.ai.classify import AiWarning, build_warning, check_rule_ids, load_input_refs, load_latest_extractions
from app.sop.ai.constants import MAX_SPLIT_PARTS, MIN_SPLIT_CHARS
from app.sop.ai.context import UnitContext, load_unit_context
from app.sop.ai.guidelines import RULES_KEY, GuidelineRef, format_guideline_versions, load_active_guidelines
from app.sop.ai.jobs import JobItem, cap_job_items, ensure_units_found, find_active_unit_ids
from app.sop.ai.llm import AiStr, build_messages, call_llm, parse_reply
from app.sop.ai.runner import AiCallFailed
from app.sop.ai.schemas import SkippedOut, SkipReason
from app.sop.groups import select_in_chunks
from app.sop.models import AiJob, AiSuggestion, Unit, UnitDecision
from app.sop.segment import has_visible_char, trim_blank_range
from app.sop.units import UNIT_ACTIVE

SPLIT_KIND = "split"
_KINDS: tuple[str, ...] = ()  # 나누기 제안은 판단 위에 쓰지 않아 다시 받을 수 있는 AI 제안이 없다 — 미배정만 받는다
_PROMPT_KEY = "prompt.split"
_FEATURE = "sop.split"
_SPLIT_UNIT_KINDS = ("sentence", "cell_sentence")  # 제목·그림·표는 문장이 아니라 나누기 후보가 아니다


class SplitReply(BaseModel):
    """LLM 응답 — 글 칸은 모두 AiStr라 저장 전에 정리된다. 조각 수 상한을 넘거나 칸이 빠지면 형식이 틀린 응답이다."""

    parts: list[AiStr] = Field(max_length=MAX_SPLIT_PARTS)
    reason: AiStr
    rule_ids: list[AiStr]


# --- 나눌 위치 (순수) ---


def find_split_offsets(text: str, parts: Sequence[str]) -> list[int] | None:
    """조각을 text 안에서 차례로 찾아 둘째 조각부터의 시작 위치를 돌려준다 — 조각이 원문을 빈 글자만 빼고 순서대로 덮지 않으면 None.

    조각은 원문 글자 그대로여야 하고, 조각 사이와 첫 조각 앞·끝 조각 뒤는 빈 글자뿐이어야 한다(빈 글자 판정은 `has_visible_char` 하나).
    위치는 오른쪽 조각의 첫 보이는 글자라 `SplitOp.at`에 그대로 쓸 수 있고(조각 시작은 이음 글자 `" "`·`"\\n"`일 수 없다),
    오름차순이라 뒤쪽부터 적용하면 앞 위치가 그대로 맞다. 조각 하나가 문장 전체면 나누지 않는다는 뜻의 빈 목록이다.
    """
    pieces: list[str] = []
    for part in parts:
        trimmed = trim_blank_range(part, 0, len(part))
        if trimmed is None:
            return None  # 빈 조각은 나눌 자리가 아니다
        pieces.append(part[trimmed[0]:trimmed[1]])
    if not pieces:
        return None

    offsets: list[int] = []
    cursor = 0
    for index, piece in enumerate(pieces):
        start = text.find(piece, cursor)
        if start < 0 or has_visible_char(text[cursor:start]):
            return None  # 글자가 바뀌었거나 순서가 달라졌거나 조각 사이에 조각 아닌 글이 있다
        if index > 0:
            offsets.append(start)
        cursor = start + len(piece)
    return None if has_visible_char(text[cursor:]) else offsets


# --- 요청 ---


async def _load_scope_rows(
    session: AsyncSession, extraction_ids: Collection[int], unit_ids: Collection[int]
) -> list[Row[Any]]:
    """범위의 활성 단위와 판단 — 글은 읽지 않고 길이만 잰다. unit_ids가 비면 문서 범위라 나누기 후보(묶이지 않은 문장·칸 문장)만 읽고, 결과는 문서 안 순서다.

    고른 단위는 사람에게 이유를 알려야 해서 종류와 묶임을 가리지 않고 읽는다.
    """
    statement = (
        select(
            Unit.id, Unit.extraction_id, Unit.kind, Unit.group_unit_id, Unit.pos_seq, Unit.pos_start,
            func.length(Unit.text).label("n_chars"), UnitDecision.status, UnitDecision.disposition,
        )
        .join(UnitDecision, UnitDecision.unit_id == Unit.id)
        .where(Unit.extraction_id.in_(list(extraction_ids)), Unit.status == UNIT_ACTIVE)
    )
    if unit_ids:
        rows = await select_in_chunks(session, lambda chunk: statement.where(Unit.id.in_(chunk)), unit_ids)
    else:
        rows = list(
            (await session.execute(statement.where(Unit.kind.in_(_SPLIT_UNIT_KINDS), Unit.group_unit_id.is_(None)))).all()
        )
    return sorted(rows, key=lambda row: (row.extraction_id, row.pos_seq, row.pos_start, row.id))


async def _load_open_suggestions(
    session: AsyncSession, bundle_id: int, document_ids: Collection[int]
) -> list[AiSuggestion]:
    """문서들의 열린 나누기 제안 — 적용됐고 사람이 아직 채택을 남기지 않은 것. 단위는 content에만 있어 부르는 쪽이 거른다(문서당 수가 적다)."""
    rows = await session.scalars(
        select(AiSuggestion).where(
            AiSuggestion.bundle_id == bundle_id, AiSuggestion.kind == SPLIT_KIND, AiSuggestion.result == "applied",
            AiSuggestion.adoption.is_(None), AiSuggestion.document_id.in_(list(document_ids)),
        )
    )
    return list(rows)


def _find_skip_reason(
    row: Row[Any], queued: Collection[int], suggested: Collection[int], *, is_explicit: bool
) -> SkipReason | None:
    """길이 문턱과 열린 제안은 문서 범위만 건다 — 단위를 고른 사람은 짧은 문장도, 이미 제안이 있는 문장도 다시 물어볼 수 있다."""
    if row.kind not in _SPLIT_UNIT_KINDS:
        return "not_splittable"  # 제목·그림·표는 나누기 편집도 받지 않는다 — 문서 범위는 이런 단위를 읽지 않는다
    if row.group_unit_id is not None:
        return "bound_cell"  # 칸 문장의 처분은 그룹 단위가 담는다 — 문서 범위는 이런 칸을 읽지 않는다
    if not can_receive_suggestion(row.status, row.disposition, None, _KINDS):
        return "not_unassigned"
    if row.id in queued:
        return "already_queued"
    if not is_explicit and row.id in suggested:
        return "already_suggested"
    if not is_explicit and row.n_chars < MIN_SPLIT_CHARS:
        return "too_short"
    return None


async def select_split_items(
    session: AsyncSession, bundle_id: int, *, document_id: int | None, unit_ids: Sequence[int] | None
) -> tuple[list[JobItem], list[SkippedOut]]:
    """요청 범위를 작업 줄로 — 옛 문서 최신 추출의 묶이지 않은 문장·칸 문장 중 미배정만 받고 단위 하나에 작업 하나다(설계 §7.11).

    문서 범위는 열린 나누기 제안이 있는 문장을 already_suggested로, 문턱보다 짧은 문장을 too_short로 알린다. 제목·표·묶인 칸은 후보가 아니라
    알리지 않는다 — 건너뜀 목록은 사람이 볼 사유만 싣는다. 고른 단위는 묶인 칸이면 bound_cell, 제목·그림·표면 not_splittable로 단위마다 알리고
    요청 전체를 거절하지 않는다. 범위의 단위가 이 묶음 것이 아니면 다른 라우터처럼 404다.
    """
    documents = await load_latest_extractions(session, bundle_id, document_id)
    requested = set(unit_ids or ())
    rows = await _load_scope_rows(session, documents, requested)
    ensure_units_found(requested, {row.id for row in rows})

    queued = await find_active_unit_ids(session, bundle_id, (SPLIT_KIND,))
    suggested: set[int] = set()
    if not requested:
        open_suggestions = await _load_open_suggestions(session, bundle_id, set(documents.values()))
        suggested = {suggestion.content["unit_id"] for suggestion in open_suggestions}
    items: list[JobItem] = []
    skipped: list[SkippedOut] = []
    for row in rows:
        reason = _find_skip_reason(row, queued, suggested, is_explicit=bool(requested))
        if reason is None:
            items.append(JobItem(document_id=documents[row.extraction_id], unit_ids=[row.id]))
        else:
            skipped.append(SkippedOut(unit_id=row.id, reason=reason))
    return cap_job_items(items, skipped)


# --- load ---


@dataclass(frozen=True)
class _Loaded:
    """load가 읽어 둔 입력 — compute는 세션 없이 이 값만 본다. text는 나눌 위치를 계산하는 기준이다."""

    text: str
    payload: dict[str, object]
    guidelines: Mapping[str, GuidelineRef]
    input_refs: dict[str, object]


def _hash_text(text: str) -> str:
    """글자 해시 — 나눌 위치는 글자 위치라 글이 같을 때만 쓸 수 있다. 언어는 위치에 쓰이지 않아 해시에 넣지 않는다."""
    return hashlib.sha256(text.encode()).hexdigest()


def _build_payload(text: str, context: UnitContext) -> dict[str, object]:
    """LLM에 보내는 데이터 — 나눌 글과 맥락(소속 절·앞뒤 문장)뿐이다. 작업 요청자 같은 사람 정보는 넣지 않는다(설계 §8.5)."""
    return {
        "task": SPLIT_KIND,
        "text": text,
        "context": {"section": context.section, "before": list(context.before), "after": list(context.after)},
    }


# --- compute ---


@dataclass(frozen=True)
class _Verdict:
    """응답을 검사한 결과. reply가 None이면 무효 — warnings가 이유를 코드로 담고 응답 글은 어디에도 남기지 않는다.

    reply가 있는데 offsets가 비었으면 나누지 말라는 응답이라 제안할 것이 없다.
    """

    model: str
    reply: SplitReply | None = None
    offsets: tuple[int, ...] = ()
    rule_ids: tuple[str, ...] = ()
    warnings: tuple[AiWarning, ...] = ()


def _judge_reply(reply: SplitReply | None, loaded: _Loaded, model: str) -> _Verdict:
    """응답 검사 — 형식이 틀리거나 조각이 원문을 그대로 덮지 못하면 무효이고, 규칙 ID는 없는 것을 빼고 경고한다."""
    if reply is None:
        return _Verdict(model, warnings=(build_warning("invalid_format"),))
    offsets = find_split_offsets(loaded.text, reply.parts)
    if offsets is None:
        return _Verdict(model, warnings=(build_warning("parts_mismatch"),))
    rule_ids, unknown = check_rule_ids(reply.rule_ids, loaded.guidelines)
    return _Verdict(model, reply, tuple(offsets), rule_ids, tuple(unknown))


# --- apply ---


def _add_result(session: AsyncSession, job: AiJob, loaded: _Loaded, verdict: _Verdict, result: str) -> AiSuggestion:
    """제안 내용(API 계약 `split`) — 무효면 위치·이유가 비고 응답 글은 싣지 않는다."""
    content = {
        "unit_id": job.unit_ids[0],
        "offsets": list(verdict.offsets),
        "reason": verdict.reply.reason if verdict.reply is not None else "",
        "rule_ids": list(verdict.rule_ids),
    }
    return add_suggestion(
        session, job, content=content, warnings=verdict.warnings, result=result,
        guideline_versions=format_guideline_versions(loaded.guidelines), model=verdict.model,
        input_refs=loaded.input_refs,
    )


async def _is_stale(session: AsyncSession, job: AiJob) -> bool:
    """호출 동안 단위가 은퇴했거나 판단이 달라졌거나(미배정이 아니거나) 글이 바뀌었으면 위치를 쓸 수 없다."""
    decisions = await load_fresh_decisions(
        session, unit_ids=job.unit_ids, snapshot=job.input_snapshot["revisions"], kinds=_KINDS
    )
    if decisions is None:
        return True
    unit = await session.get_one(Unit, job.unit_ids[0])
    return _hash_text(unit.text) != job.input_snapshot["hashes"][str(unit.id)]


async def _retire_older_suggestions(session: AsyncSession, job: AiJob) -> None:
    """같은 단위의 열린 이전 제안을 낡음으로 — 나누라는 새 답도 나누지 말라는 새 답도 그 단위의 가장 새 답이라 이전 제안이 위에 쌓이지 않게 한다.

    사람이 채택을 남긴 제안은 열린 제안이 아니라 applied 그대로다. 묶음을 잠근 apply 안에서 돌고 문서당 열린 제안은 적어 content를 파이썬에서 거른다.
    """
    for suggestion in await _load_open_suggestions(session, job.bundle_id, [job.document_id]):
        if suggestion.content["unit_id"] == job.unit_ids[0]:
            suggestion.result = "stale"


class SplitHandler:
    """단위 하나 — 글을 조각으로 자르게 해 나눌 위치를 구하고, 낡지 않았을 때만 제안을 쓴다."""

    async def load(self, session: AsyncSession, job: AiJob) -> _Loaded | None:
        """입력을 읽고 작업 시작 시점의 스냅숏을 적는다 — 다시 시도도 이 단계를 지나므로 그때의 상태가 기준이 된다."""
        decisions = await load_open_decisions(session, unit_ids=job.unit_ids, kinds=_KINDS)
        if decisions is None:
            return None
        try:
            guidelines = await load_active_guidelines(session, (RULES_KEY, _PROMPT_KEY))
        except LookupError as exc:
            raise AiCallFailed("config") from exc
        unit = await session.get_one(Unit, job.unit_ids[0])
        contexts = await load_unit_context(session, job.unit_ids)
        job.input_snapshot = {
            "revisions": {str(unit_id): decision.revision for unit_id, decision in decisions.items()},
            "hashes": {str(unit.id): _hash_text(unit.text)},
        }
        return _Loaded(
            text=unit.text,
            payload=_build_payload(unit.text, contexts[unit.id]),
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
        return _judge_reply(parse_reply(reply.content, SplitReply), loaded, reply.model)

    async def apply(self, session: AsyncSession, job: AiJob, loaded: _Loaded, computed: _Verdict) -> str:
        if await _is_stale(session, job):
            _add_result(session, job, loaded, computed, "stale")
            return "stale"
        if computed.reply is None:  # 분류와 달리 보류하지 않는다 — 단위의 상태를 바꾸는 제안이 아니다. 무효 답은 이전 제안을 내리지 못한다
            _add_result(session, job, loaded, computed, "invalid")
            return "done"
        await _retire_older_suggestions(session, job)
        if computed.offsets:
            _add_result(session, job, loaded, computed, "applied")
        return "done"


SPLIT_HANDLER = SplitHandler()
