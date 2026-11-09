"""AI 문서 정보 제안 — 업로드 뒤 규칙(파일 이름·첫 장 머리글)이 비운 문서 번호·버전만 묻는다(load·compute·apply).

제안은 값만 기록한다. 문서 칸에는 쓰지 않아 사람이 문서 목록에서 눌러 저장해야 값이 된다(AI는 제안만 한다).
New 문서의 번호는 짝 문서 코드(To-Be 줄)와 엮여 있어 묻지 않고 버전만 묻는다. 응답은 형식 검사를 통과한 값만 쓰고 응답 원문은 남기지 않는다.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.settings import settings
from app.sop.ai.apply import add_suggestion
from app.sop.ai.classify import AiWarning, build_warning, load_input_refs
from app.sop.ai.guidelines import GuidelineRef, format_guideline_versions, load_active_guidelines
from app.sop.ai.jobs import JobItem, enqueue_jobs
from app.sop.ai.llm import AiStr, build_messages, call_llm, parse_reply
from app.sop.ai.runner import AiCallFailed
from app.sop.events import record_event
from app.sop.models import AiJob, AiSuggestion, Document, Extraction, SourceBlock

DOC_META_KIND = "doc_meta"
_PROMPT_KEY = "prompt.doc_meta"
_FEATURE = "sop.doc_meta"
# 보내는 글의 범위 — 머리글 전부와 본문 앞 줄. 첫 장 정보 칸만 보면 된다
_MAX_BODY_LINES = 40
_MAX_CHARS = 4000
# 받을 값의 형식 — 규칙 탐지(doc_meta.py)와 같은 모양만 받는다
_CODE_FORMAT = re.compile(r"[A-Z]{2,5}(?:-[A-Z0-9]{2,10}){1,3}")
_VERSION_FORMAT = re.compile(r"\d{1,3}(?:\.\d{1,3})?")

WantedField = str  # "doc_code" | "version"


class DocMetaReply(BaseModel):
    """LLM 응답 — 두 칸 모두 없으면 null이다. 칸 밖의 글은 읽지 않는다."""

    doc_code: AiStr | None = None
    version: AiStr | None = None


def list_wanted_fields(document: Document) -> list[WantedField]:
    """아직 비어 있어 물어볼 칸 — New 문서의 번호는 묻지 않는다."""
    wanted: list[WantedField] = []
    if document.side == "old" and not document.doc_code:
        wanted.append("doc_code")
    if not document.doc_version:
        wanted.append("version")
    return wanted


def enqueue_doc_meta(session: AsyncSession, document: Document, actor: str) -> bool:
    """업로드한 문서가 읽혔고 AI가 켜져 있고 빈 칸이 있으면 작업 하나를 쌓는다. 커밋은 호출부가 한다."""
    if not settings.ai_enabled or document.status != "ready" or not list_wanted_fields(document):
        return False
    enqueue_jobs(session, bundle_id=document.bundle_id, kind=DOC_META_KIND, requested_by=actor, items=[JobItem(document_id=document.id, unit_ids=[])])
    record_event(session, bundle_id=document.bundle_id, actor=actor, action="ai.request", target_type="document", target_ids=[document.id])
    return True


async def load_open_doc_meta(session: AsyncSession, document_ids: list[int]) -> dict[int, AiSuggestion]:
    """문서마다 가장 새 적용 제안 — 칸이 채워졌는지는 부르는 쪽이 문서와 견준다."""
    if not document_ids:
        return {}
    rows = await session.scalars(
        select(AiSuggestion)
        .where(AiSuggestion.kind == DOC_META_KIND, AiSuggestion.result == "applied", AiSuggestion.document_id.in_(document_ids))
        .order_by(AiSuggestion.id)
    )
    return {suggestion.document_id: suggestion for suggestion in rows if suggestion.document_id is not None}


def build_ai_meta(document: Document, suggestion: AiSuggestion | None) -> dict[str, object] | None:
    """화면에 보일 제안 — 이미 채운 칸은 비우고, 남는 값이 없으면 None."""
    if suggestion is None:
        return None
    code = suggestion.content.get("doc_code") if not document.doc_code else None
    version = suggestion.content.get("doc_version") if not document.doc_version else None
    if code is None and version is None:
        return None
    return {"doc_code": code, "doc_version": version, "suggestion_id": suggestion.id}


# --- load ---


@dataclass(frozen=True)
class _Loaded:
    payload: dict[str, object]
    guidelines: Mapping[str, GuidelineRef]
    input_refs: dict[str, object]


async def _load_lines(session: AsyncSession, extraction_id: int) -> list[str]:
    """머리글 전부 + 본문 앞 줄, 글자 상한까지. 빈 줄은 빼고 읽은 순서를 지킨다."""
    rows = await session.execute(
        select(SourceBlock.part, SourceBlock.text).where(SourceBlock.extraction_id == extraction_id).order_by(SourceBlock.seq)
    )
    headers: list[str] = []
    body: list[str] = []
    for part, text in rows:
        line = text.strip()
        if not line:
            continue
        if part == "header":
            headers.append(line)
        elif part == "body" and len(body) < _MAX_BODY_LINES:
            body.append(line)
    lines: list[str] = []
    used = 0
    for line in headers + body:
        if used + len(line) > _MAX_CHARS:
            break
        lines.append(line)
        used += len(line)
    return lines


# --- compute ---


@dataclass(frozen=True)
class _Verdict:
    """응답 검사 결과 — invalid면 이유만 남기고 값은 버린다. 둘 다 None이고 invalid가 아니면 문서에 적힌 값이 없다는 답이다."""

    model: str
    doc_code: str | None = None
    version: str | None = None
    invalid: bool = False
    warnings: tuple[AiWarning, ...] = ()


def _judge_reply(reply: DocMetaReply | None, wanted: list[WantedField], model: str) -> _Verdict:
    if reply is None:
        return _Verdict(model, invalid=True, warnings=(build_warning("invalid_format"),))
    code = (reply.doc_code or "").strip().upper()
    version = (reply.version or "").strip()
    good_code = code if "doc_code" in wanted and _CODE_FORMAT.fullmatch(code) else None
    good_version = version if "version" in wanted and _VERSION_FORMAT.fullmatch(version) else None
    said_something = bool(code) or bool(version)
    if said_something and good_code is None and good_version is None:
        return _Verdict(model, invalid=True, warnings=(build_warning("invalid_format"),))
    return _Verdict(model, doc_code=good_code, version=good_version)


# --- apply ---


async def _retire_older(session: AsyncSession, job: AiJob) -> None:
    """같은 문서의 이전 적용 제안을 낡음으로 — 채택이 남은 제안은 그대로 둔다."""
    rows = await session.scalars(
        select(AiSuggestion).where(
            AiSuggestion.kind == DOC_META_KIND, AiSuggestion.document_id == job.document_id,
            AiSuggestion.result == "applied", AiSuggestion.adoption.is_(None),
        )
    )
    for suggestion in rows:
        suggestion.result = "stale"


class DocMetaHandler:
    """문서 하나 — 첫 장 글로 번호·버전을 묻고, 그사이 사람이 채운 칸은 빼고 제안을 쓴다."""

    async def load(self, session: AsyncSession, job: AiJob) -> _Loaded | None:
        document = await session.get(Document, job.document_id) if job.document_id is not None else None
        if document is None:
            return None
        wanted = list_wanted_fields(document)
        if not wanted:
            return None  # 사람이 이미 다 채웠다
        try:
            guidelines = await load_active_guidelines(session, (_PROMPT_KEY,))
        except LookupError as exc:
            raise AiCallFailed("config") from exc
        extraction_id = await session.scalar(select(func.max(Extraction.id)).where(Extraction.document_id == document.id))
        if extraction_id is None:
            return None
        job.input_snapshot = {"want": wanted}
        return _Loaded(
            payload={"task": DOC_META_KIND, "lines": await _load_lines(session, extraction_id), "want": wanted},
            guidelines=guidelines,
            input_refs=await load_input_refs(session, extraction_id),
        )

    async def compute(self, job: AiJob, loaded: _Loaded) -> _Verdict:
        reply = await call_llm(
            login_id=job.requested_by,
            feature=_FEATURE,
            messages=build_messages(list(loaded.guidelines.values()), loaded.payload),
            reasoning="low",
        )
        return _judge_reply(parse_reply(reply.content, DocMetaReply), list(job.input_snapshot.get("want", [])), reply.model)

    async def apply(self, session: AsyncSession, job: AiJob, loaded: _Loaded, computed: _Verdict) -> str:
        document = await session.get(Document, job.document_id) if job.document_id is not None else None
        if document is None:
            return "stale"
        still_wanted = list_wanted_fields(document)
        common = {"guideline_versions": format_guideline_versions(loaded.guidelines), "model": computed.model, "input_refs": loaded.input_refs}
        if computed.invalid:
            add_suggestion(session, job, content={"doc_code": None, "doc_version": None}, warnings=computed.warnings, result="invalid", **common)
            return "done"
        code = computed.doc_code if "doc_code" in still_wanted else None
        version = computed.version if "version" in still_wanted else None
        if code is None and version is None:
            return "done"
        await _retire_older(session, job)
        add_suggestion(session, job, content={"doc_code": code, "doc_version": version}, result="applied", **common)
        return "done"


DOC_META_HANDLER = DocMetaHandler()
