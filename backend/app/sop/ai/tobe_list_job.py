"""새 문서 목록 AI 읽기 — 템플릿에 맞지 않는 계획 파일이나 붙여 넣은 글에서 새 SOP·WI 목록을 읽어 제안한다(load·compute·apply).

AI는 제안만 한다: 목록에는 쓰지 않고, 사람이 미리 보기에서 줄을 고르고 고쳐 **Add** 를 눌러야 목록의 쓰기 길로 저장된다.
번호는 입력 글 안에 있는 것만 받는다 — 글에 없는 번호를 답하면 그 줄을 버린다(AI가 번호를 지어내지 못하게).
입력 글은 SOP 원문과 같은 취급이다: 요청 때 작업의 payload에 싣고, 읽은 뒤(apply) 비운다. 응답 원문은 남기지 않는다.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.sop.ai.apply import add_suggestion
from app.sop.ai.classify import AiWarning, build_warning
from app.sop.ai.guidelines import GuidelineRef, format_guideline_versions, load_active_guidelines
from app.sop.ai.jobs import JobItem, enqueue_jobs
from app.sop.ai.llm import AiStr, build_messages, call_llm, parse_reply
from app.sop.ai.runner import AiCallFailed
from app.sop.ai.tobe_list_text import ListText
from app.sop.errors import raise_rule
from app.sop.models import AiJob, AiSuggestion, TargetDoc

TOBE_LIST_KIND = "tobe_list"
_PROMPT_KEY = "prompt.tobe_list"
_FEATURE = "sop.tobe_list"
# 제안 한 번의 줄 수 상한 — 넘는 줄은 버리고 잘렸다고 알린다
MAX_PROPOSED_DOCS = 300
_MAX_STEPS = 50
_MAX_CODE_CHARS = 100
_MAX_TITLE_CHARS = 500
_SPACES = re.compile(r"\s+")


class ProposedDocIn(BaseModel):
    """LLM 응답의 문서 한 줄 — 칸 밖의 글은 읽지 않는다. 종류·상위는 검사에서 다시 거른다."""

    code: AiStr = ""
    title: AiStr = ""
    doc_type: AiStr | None = None
    parent_code: AiStr | None = None
    is_equipment_sop: bool = False
    steps: list[AiStr] = Field(default_factory=list)


class TobeListReply(BaseModel):
    docs: list[ProposedDocIn] = Field(default_factory=list)


class ProposedDoc(BaseModel):
    """제안에 남기는 줄 — 화면의 미리 보기 표가 읽는다."""

    code: str
    title: str
    # 글이 종류를 말하지 않으면 null — 사람이 고른다
    doc_type: Literal["sop", "wi"] | None
    parent_code: str | None
    is_equipment_sop: bool
    steps: list[str]


class ProposalOut(BaseModel):
    """아직 정하지 않은 가장 새 제안 — 없으면 응답 전체가 null이다."""

    suggestion_id: int
    docs: list[ProposedDoc]
    # 이미 목록에 있는 번호(읽는 지금 기준) — 화면이 "이미 있음"으로 표시하고 기본으로 뺀다
    listed_codes: list[str]
    # 입력 글이 길어 앞부분만 읽었다 / 제안이 많아 앞쪽만 남겼다
    truncated: bool
    # 응답을 읽지 못했다 — 줄이 없다
    invalid: bool


def enqueue_tobe_list(session: AsyncSession, bundle_id: int, text: ListText, actor: str) -> AiJob:
    """작업 하나를 쌓는다 — 뽑은 글은 payload에 싣는다(문서도 Unit도 없는 작업이다). 커밋과 기록은 호출부가 한다."""
    (job,) = enqueue_jobs(
        session, bundle_id=bundle_id, kind=TOBE_LIST_KIND, requested_by=actor,
        items=[JobItem(payload={"text": text.text, "truncated": text.truncated})],
    )
    return job


def _fold(text: str) -> str:
    """번호가 글 안에 있는지 견줄 때의 모양 — 공백을 걷고 대소문자를 가리지 않는다."""
    return _SPACES.sub("", text).casefold()


@dataclass(frozen=True)
class _Verdict:
    model: str
    docs: tuple[ProposedDoc, ...] = ()
    truncated: bool = False
    invalid: bool = False
    warnings: tuple[AiWarning, ...] = field(default=())


def judge_reply(reply: TobeListReply | None, text: str, listed_sops: frozenset[str], model: str) -> _Verdict:
    """응답을 거른다 — 번호가 글 안에 없거나 너무 긴 줄, 같은 번호의 둘째 줄은 버린다. 종류는 sop·wi만(아니면 null),
    상위 SOP는 같은 제안의 SOP이거나 지금 목록의 SOP일 때만(아니면 null), 단계는 WI만."""
    if reply is None:
        return _Verdict(model, invalid=True, warnings=(build_warning("invalid_format"),))
    haystack = _fold(text)
    rows: list[ProposedDocIn] = []
    seen: set[str] = set()
    for item in reply.docs:
        code = item.code.strip()
        if not code or len(code) > _MAX_CODE_CHARS or code in seen or _fold(code) not in haystack:
            continue
        seen.add(code)
        rows.append(item.model_copy(update={"code": code}))
    types = {row.code: (row.doc_type or "").strip().lower() for row in rows}
    sops = {code for code, doc_type in types.items() if doc_type == "sop"} | listed_sops
    docs: list[ProposedDoc] = []
    for row in rows[:MAX_PROPOSED_DOCS]:
        doc_type = types[row.code] if types[row.code] in ("sop", "wi") else None
        parent = (row.parent_code or "").strip()
        is_wi = doc_type == "wi"
        docs.append(
            ProposedDoc(
                code=row.code,
                title=row.title.strip()[:_MAX_TITLE_CHARS],
                doc_type=doc_type,
                parent_code=parent if is_wi and parent in sops and parent != row.code else None,
                is_equipment_sop=row.is_equipment_sop and doc_type == "sop",
                steps=[step.strip()[:_MAX_TITLE_CHARS] for step in row.steps if step.strip()][:_MAX_STEPS] if is_wi else [],
            )
        )
    return _Verdict(model, docs=tuple(docs), truncated=len(rows) > MAX_PROPOSED_DOCS)


@dataclass(frozen=True)
class _Loaded:
    payload: dict[str, object]
    guidelines: Mapping[str, GuidelineRef]
    text: str
    truncated: bool
    listed_sops: frozenset[str]


async def _load_listed(session: AsyncSession, bundle_id: int) -> list[TargetDoc]:
    return list(
        await session.scalars(select(TargetDoc).where(TargetDoc.bundle_id == bundle_id).order_by(TargetDoc.order_index, TargetDoc.id))
    )


async def _retire_older(session: AsyncSession, job: AiJob) -> None:
    """이 묶음의 이전 제안 가운데 아직 정하지 않은 것을 낡음으로 — 미리 보기는 가장 새 것 하나만 보인다."""
    rows = await session.scalars(
        select(AiSuggestion).where(
            AiSuggestion.bundle_id == job.bundle_id, AiSuggestion.kind == TOBE_LIST_KIND,
            AiSuggestion.result.in_(("applied", "invalid")), AiSuggestion.adoption.is_(None),
        )
    )
    for suggestion in rows:
        suggestion.result = "stale"


class TobeListHandler:
    """글 한 덩어리 — 새 문서 목록을 읽어 제안으로 남긴다. 목록에는 쓰지 않는다."""

    async def load(self, session: AsyncSession, job: AiJob) -> _Loaded | None:
        text = job.payload.get("text")
        if not isinstance(text, str) or not text:
            return None  # 이미 읽고 비운 작업이다
        try:
            guidelines = await load_active_guidelines(session, (_PROMPT_KEY,))
        except LookupError as exc:
            raise AiCallFailed("config") from exc
        listed = await _load_listed(session, job.bundle_id)
        return _Loaded(
            payload={
                "task": TOBE_LIST_KIND,
                "text": text,
                "listed": [{"code": doc.code, "doc_type": doc.doc_type} for doc in listed],
            },
            guidelines=guidelines,
            text=text,
            truncated=bool(job.payload.get("truncated")),
            listed_sops=frozenset(doc.code for doc in listed if doc.doc_type == "sop"),
        )

    async def compute(self, job: AiJob, loaded: _Loaded) -> _Verdict:
        reply = await call_llm(
            login_id=job.requested_by,
            feature=_FEATURE,
            messages=build_messages(list(loaded.guidelines.values()), loaded.payload),
            reasoning="low",
        )
        return judge_reply(parse_reply(reply.content, TobeListReply), loaded.text, loaded.listed_sops, reply.model)

    async def apply(self, session: AsyncSession, job: AiJob, loaded: _Loaded, computed: _Verdict) -> str:
        # 입력 글은 읽었으니 비운다 - 작업 기록에 계획 파일의 글이 남지 않게
        job.payload = {}
        await _retire_older(session, job)
        add_suggestion(
            session, job,
            content={
                "docs": [doc.model_dump() for doc in computed.docs],
                "truncated": loaded.truncated or computed.truncated,
            },
            warnings=computed.warnings,
            result="invalid" if computed.invalid else "applied",
            guideline_versions=format_guideline_versions(loaded.guidelines),
            model=computed.model,
        )
        return "done"


TOBE_LIST_HANDLER = TobeListHandler()


async def load_open_proposal(session: AsyncSession, bundle_id: int) -> ProposalOut | None:
    """아직 정하지 않은 가장 새 제안 — 읽지 못한 응답(invalid)도 보여 사람이 알고 닫게 한다."""
    suggestion = await session.scalar(
        select(AiSuggestion)
        .where(
            AiSuggestion.bundle_id == bundle_id, AiSuggestion.kind == TOBE_LIST_KIND,
            AiSuggestion.result.in_(("applied", "invalid")), AiSuggestion.adoption.is_(None),
        )
        .order_by(AiSuggestion.id.desc())
        .limit(1)
    )
    if suggestion is None:
        return None
    docs = [ProposedDoc.model_validate(item) for item in suggestion.content.get("docs", [])]
    proposed = {doc.code for doc in docs}
    listed = [doc.code for doc in await _load_listed(session, bundle_id) if doc.code in proposed]
    return ProposalOut(
        suggestion_id=suggestion.id, docs=docs, listed_codes=listed,
        truncated=bool(suggestion.content.get("truncated")), invalid=suggestion.result == "invalid",
    )


async def close_proposal(session: AsyncSession, bundle_id: int, suggestion_id: int, adoption: str, actor: str) -> None:
    """미리 보기를 닫는다 — 줄을 더했으면 as_is(전부 그대로)·edited(고치거나 일부만), 버렸으면 rejected. 이미 정했으면 409."""
    suggestion = await session.scalar(
        select(AiSuggestion).where(
            AiSuggestion.id == suggestion_id, AiSuggestion.bundle_id == bundle_id, AiSuggestion.kind == TOBE_LIST_KIND
        )
    )
    if suggestion is None:
        raise_rule(404, "suggestion_not_found", suggestion_id=suggestion_id)
    if suggestion.adoption is not None:
        raise_rule(409, "not_manual_adoption")
    suggestion.adoption = adoption
    suggestion.adopted_by = actor
    suggestion.adopted_at = now()
