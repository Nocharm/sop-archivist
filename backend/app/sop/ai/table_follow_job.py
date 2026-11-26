"""AI 한글 표처럼 하기 제안 — 영어 표의 줄 맞춤이 규칙으로 안 풀릴 때 한글 표에서 한 일을 보고 영어 줄마다 순서·삭제·합치기·들여쓰기·번호를 제안한다 (11-23 명세 D2-R9 · R10).

제안은 저장하지 않는 규칙 제안과 같은 꼴(`FollowItemOut`)로 기록만 한다 — 줄·글·판단은 어디에도 쓰지 않아 사람이 `follow_table` 편집을 눌러야 일어난다.
판단·New 문장은 쓰지 않는다. 짝 표가 무엇인지는 규칙과 같은 판정(table_follow.answer_follow, 임베딩 없이)이 정한다 — 이 작업은 그 판정이 "AI 길"일 때만 쌓는다.
낡음은 영어 표 줄과 한글 표의 손본 결과의 해시로 본다 — 사람이 덩이 순서만 바꿨다면 여전히 같은 줄이라 유효하다.
응답은 정해진 필드만 읽어 검사하고 무효 제안에는 응답 원문을 남기지 않는다.
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.ai.apply import add_suggestion
from app.sop.ai.classify import AiWarning, build_warning, load_input_refs
from app.sop.ai.guidelines import GuidelineRef, format_guideline_versions, load_active_guidelines
from app.sop.ai.jobs import ACTIVE_JOB_STATUSES, JobItem
from app.sop.ai.llm import AiStr, build_messages, call_llm, parse_reply
from app.sop.ai.runner import AiCallFailed
from app.sop.editing import IndentShift
from app.sop.errors import raise_rule
from app.sop.models import AiJob, AiSuggestion, Document
from app.sop.numbering import MAX_NUMBER_CHARS
from app.sop.table_follow import FollowInputs, FollowLine, answer_follow, load_follow_inputs

TABLE_FOLLOW_KIND = "table_follow"
_PROMPT_KEY = "prompt.table_follow"
_FEATURE = "sop.table_follow"


class FollowAction(BaseModel):
    """응답 한 줄 — 영어 줄 하나에 할 일. order는 맞춘 뒤 자리(1부터), 모르는 칸은 읽지 않는다."""

    id: int
    order: int
    delete: bool = False
    merge_with: int | None = None
    indent_shift: IndentShift | None = None
    number: AiStr | None = None


class TableFollowReply(BaseModel):
    """LLM 응답 — 모양이 틀리거나 칸이 빠지면 형식이 틀린 응답이다."""

    actions: list[FollowAction]
    reason: AiStr


# --- 요청 ---


async def _find_active_table_ids(session: AsyncSession, bundle_id: int, document_id: int) -> set[int]:
    """그 문서에서 대기·실행 중인 따라 하기 작업이 맡은 표들 — 표는 payload에만 있어 읽은 뒤 거른다(문서당 작업이 적다)."""
    payloads = await session.scalars(
        select(AiJob.payload).where(
            AiJob.bundle_id == bundle_id, AiJob.kind == TABLE_FOLLOW_KIND, AiJob.document_id == document_id,
            AiJob.status.in_(ACTIVE_JOB_STATUSES),
        )
    )
    return {payload["table_id"] for payload in payloads}


async def _get_document(session: AsyncSession, bundle_id: int, document_id: int) -> Document:
    document = await session.get(Document, document_id)
    if document is None or document.bundle_id != bundle_id:
        raise_rule(404, "document_not_found")
    return document


async def select_table_follow_items(
    session: AsyncSession, bundle_id: int, *, document_id: int, table_id: int
) -> list[JobItem]:
    """요청 표를 작업 한 줄로 — 규칙이 못 푸는(AI 길) 벗긴 영어 Old 표일 때만 받는다.

    New 문서는 422 invalid_side, 이 문서의 표가 아니면 404 table_not_found, 규칙이 풀거나 제안할 것이 없으면 422 follow_not_needed다.
    같은 표의 작업이 이미 줄에 있으면 쌓지 않는다(빈 목록).
    """
    document = await _get_document(session, bundle_id, document_id)
    inputs = await load_follow_inputs(session, document, table_id)
    if answer_follow(inputs, None).mode != "ai":
        raise_rule(422, "follow_not_needed", table_id=table_id)
    if table_id in await _find_active_table_ids(session, bundle_id, document_id):
        return []
    return [JobItem(document_id=document_id, payload={"table_id": table_id})]


# --- load ---


@dataclass(frozen=True)
class _Block:
    """작업 시점의 두 표 — 영어 줄은 지금 덩이 차례, 한글 줄도 그렇다."""

    extraction_id: int
    source_table_id: int
    lines: tuple[FollowLine, ...]
    source: tuple[FollowLine, ...]


@dataclass(frozen=True)
class _Loaded:
    """load가 읽어 둔 입력 — compute는 세션 없이 이 값만 본다."""

    payload: dict[str, object]
    block: _Block
    guidelines: Mapping[str, GuidelineRef]
    input_refs: dict[str, object]


def _hash_lines(lines: Sequence[FollowLine]) -> str:
    """영어 줄의 해시 — 줄 id와 글 · 번호 · 들여쓰기 · 삭제 여부, 차례와 상관없다. 이 가운데 하나라도 바뀌면 제안이 가리킨 줄이 달라진 것이다."""
    rows = [asdict(line) for line in sorted(lines, key=lambda line: line.unit_id)]
    return hashlib.sha256(json.dumps(rows, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def _hash_source(source: Sequence[FollowLine]) -> str:
    """한글 표를 손본 결과의 해시 — 차례까지 본다(제안은 그 차례를 따라 한다)."""
    return hashlib.sha256(json.dumps([asdict(line) for line in source], ensure_ascii=False, sort_keys=True).encode()).hexdigest()


async def _load_block(session: AsyncSession, job: AiJob) -> _Block | None:
    """작업 표의 두 줄 모음 — 표가 없어졌거나 더는 AI 길이 아니면 None(규칙이 풀게 됐거나 짝 · 손본 한글 표가 사라졌다)."""
    if job.document_id is None:
        return None
    document = await session.get(Document, job.document_id)
    if document is None:
        return None
    inputs: FollowInputs = await load_follow_inputs(session, document, job.payload["table_id"])
    answer = answer_follow(inputs, None)
    if answer.mode != "ai" or answer.source_table_id is None or inputs.lines is None:
        return None
    return _Block(
        extraction_id=inputs.counterpart.extraction_id, source_table_id=answer.source_table_id,
        lines=tuple(inputs.lines), source=tuple(inputs.sources[answer.source_table_id][0]),
    )


def _build_payload(block: _Block) -> dict[str, object]:
    """LLM에 보내는 데이터 — 한글 표(손본 결과)와 영어 줄뿐이다. 사람 정보는 넣지 않는다(설계 §8.5)."""
    source = [
        {
            "text": line.text, "disposition": "delete" if line.deleted else "keep", "order": index + 1,
            "indent_shift": line.indent_shift, "number": line.number, "merged_texts": list(line.pieces),
        }
        for index, line in enumerate(block.source)
    ]
    lines = [
        {"id": line.unit_id, "text": line.text, "indent_shift": line.indent_shift, "number": line.number} for line in block.lines
    ]
    return {"task": TABLE_FOLLOW_KIND, "source": source, "lines": lines}


# --- compute ---


@dataclass(frozen=True)
class _Verdict:
    """응답을 검사한 결과. items가 None이면 무효 — warnings가 이유를 코드로 담고 응답 글은 어디에도 남기지 않는다."""

    model: str
    items: tuple[dict[str, object], ...] | None = None
    reason: str = ""
    warnings: tuple[AiWarning, ...] = ()


def _find_root(merge_with: Mapping[int, int | None], line_id: int) -> int | None:
    """합칠 줄이 닿는 마지막 줄(남는 줄) — 고리를 만나면 None."""
    seen = {line_id}
    current = line_id
    while (parent := merge_with[current]) is not None:
        if parent in seen:
            return None
        seen.add(parent)
        current = parent
    return current


def _check_actions(actions: Sequence[FollowAction], line_ids: Sequence[int]) -> str | None:
    """응답 줄들이 영어 줄 집합과 한 번씩 같고 합치기 · 번호가 쓸 수 있는 값인지 — 틀린 곳이 있으면 경고 종류를 돌려준다."""
    if sorted(action.id for action in actions) != sorted(line_ids):
        return "order_mismatch"
    if sorted(action.order for action in actions) != list(range(1, len(actions) + 1)):
        return "order_mismatch"
    merge_with = {action.id: action.merge_with for action in actions}
    for action in actions:
        if action.merge_with is not None and (action.merge_with not in merge_with or action.merge_with == action.id):
            return "invalid_format"
        if action.delete and (action.merge_with is not None or any(other.merge_with == action.id for other in actions)):
            return "invalid_format"
        if action.number is not None and (len(action.number) > MAX_NUMBER_CHARS or "\n" in action.number or "\r" in action.number):
            return "invalid_format"
    if any(_find_root(merge_with, action.id) is None for action in actions):
        return "invalid_format"
    return None


def _build_items(actions: Sequence[FollowAction], lines: Sequence[FollowLine]) -> tuple[dict[str, object], ...]:
    """응답 → 규칙 제안과 같은 일 목록(영어 표 덩이 차례, 칩이 없는 줄도 싣는다) — order는 맞춘 뒤 자리(1부터, 같으면 None).

    합친 줄은 그 줄의 지금 차례 순으로 묶고 자리는 구성원 가운데 가장 앞 자리를 따른다. 지우는 줄은 다른 일 없이 지우기만 한다.
    """
    by_id = {action.id: action for action in actions}
    line_of = {line.unit_id: line for line in lines}
    merge_with = {action.id: action.merge_with for action in actions}
    groups: list[list[int]] = []  # 영어 줄 차례로 첫 구성원이 앞선 것부터
    roots: list[int] = []  # 묶음마다 남는 줄 — 번호 · 들여쓰기는 그 줄의 응답을 읽는다
    for line in lines:
        root = _find_root(merge_with, line.unit_id)
        if root not in roots:
            roots.append(root)  # type: ignore[arg-type]
            groups.append([])
        groups[roots.index(root)].append(line.unit_id)  # type: ignore[arg-type]
    keys = [min(by_id[unit_id].order for unit_id in group) for group in groups]
    place = {group: position for position, group in enumerate(sorted(range(len(groups)), key=lambda index: keys[index]))}
    items: list[dict[str, object]] = []
    for index, group in enumerate(groups):
        head = line_of[group[0]]
        action = by_id[roots[index]]
        order = place[index] + 1 if place[index] != index else None
        if action.delete:
            items.append({
                "unit_ids": group, "order": order, "number": None, "indent": False, "indent_shift": None,
                "delete": not head.deleted,
            })
            continue
        number = action.number.strip() if action.number is not None else None
        number = number if number and number.rstrip(".") != (head.number or "").strip().rstrip(".") else None
        shift = action.indent_shift if action.indent_shift is not None and action.indent_shift != head.indent_shift else None
        items.append({
            "unit_ids": group, "order": order, "number": number, "indent": shift is not None, "indent_shift": shift,
            "delete": False,
        })
    return tuple(items)


def _judge_reply(reply: TableFollowReply | None, lines: Sequence[FollowLine], model: str) -> _Verdict:
    """응답 검사 — 영어 줄 전부를 한 번씩 담고 자리가 순열이며 합치기에 고리가 없어야 한다. 일은 follow_table 편집이 받는 값과 같은 조건이다."""
    if reply is None:
        return _Verdict(model, warnings=(build_warning("invalid_format"),))
    failure = _check_actions(reply.actions, [line.unit_id for line in lines])
    if failure is not None:
        return _Verdict(model, warnings=(build_warning(failure),))
    return _Verdict(model, _build_items(reply.actions, lines), reply.reason)


# --- apply ---


def _add_result(session: AsyncSession, job: AiJob, loaded: _Loaded, verdict: _Verdict, result: str) -> AiSuggestion:
    """제안 내용(`{table_id, source_table_id, items, lines, reason}`) — 무효·낡음이면 일이 비고 응답 글은 싣지 않는다."""
    valid = verdict.items is not None
    content = {
        "table_id": job.payload["table_id"],
        "source_table_id": loaded.block.source_table_id,
        "items": list(verdict.items or ()),
        "lines": [line.unit_id for line in loaded.block.lines] if valid else [],
        "reason": verdict.reason if valid else "",
    }
    return add_suggestion(
        session, job, content=content, warnings=verdict.warnings, result=result,
        guideline_versions=format_guideline_versions(loaded.guidelines), model=verdict.model,
        input_refs=loaded.input_refs,
    )


async def _is_stale(session: AsyncSession, job: AiJob) -> bool:
    """호출 동안 영어 줄이나 한글 표의 손본 결과가 바뀌었거나 더는 AI 길이 아니면 쓸 수 없다 — 영어 줄의 순서만 바뀐 것은 낡음이 아니다."""
    block = await _load_block(session, job)
    snapshot = job.input_snapshot
    return (
        block is None
        or block.extraction_id != snapshot["extraction_id"]
        or block.source_table_id != snapshot["source_table_id"]
        or _hash_lines(block.lines) != snapshot["hash"]
        or _hash_source(block.source) != snapshot["source_hash"]
    )


async def _retire_older_suggestions(session: AsyncSession, job: AiJob) -> None:
    """같은 문서 같은 표의 열린 이전 제안을 낡음으로 — 새 답이 그 표의 가장 새 답이라 이전 제안이 위에 쌓이지 않게 한다.

    사람이 채택을 남긴 제안은 열린 제안이 아니라 applied 그대로다. 묶음을 잠근 apply 안에서 돌고 문서당 열린 제안은 적어 content를 파이썬에서 거른다.
    """
    older = await session.scalars(
        select(AiSuggestion).where(
            AiSuggestion.bundle_id == job.bundle_id, AiSuggestion.kind == TABLE_FOLLOW_KIND,
            AiSuggestion.result == "applied", AiSuggestion.adoption.is_(None), AiSuggestion.document_id == job.document_id,
        )
    )
    for suggestion in older:
        if suggestion.content["table_id"] == job.payload["table_id"]:
            suggestion.result = "stale"


class TableFollowHandler:
    """벗긴 영어 표 하나 — 한글 표에서 한 일을 보고 영어 줄마다 할 일을 구하고, 낡지 않았을 때만 제안을 쓴다."""

    async def load(self, session: AsyncSession, job: AiJob) -> _Loaded | None:
        """입력을 읽고 작업 시작 시점의 스냅숏을 적는다 — 다시 시도도 이 단계를 지나므로 그때의 상태가 기준이 된다."""
        block = await _load_block(session, job)
        if block is None:
            return None
        try:
            guidelines = await load_active_guidelines(session, (_PROMPT_KEY,))
        except LookupError as exc:
            raise AiCallFailed("config") from exc
        job.input_snapshot = {
            "extraction_id": block.extraction_id,
            "table_id": job.payload["table_id"],
            "source_table_id": block.source_table_id,
            "unit_ids": [line.unit_id for line in block.lines],
            "hash": _hash_lines(block.lines),
            "source_hash": _hash_source(block.source),
        }
        return _Loaded(
            payload=_build_payload(block), block=block, guidelines=guidelines,
            input_refs=await load_input_refs(session, block.extraction_id),
        )

    async def compute(self, job: AiJob, loaded: _Loaded) -> _Verdict:
        reply = await call_llm(
            login_id=job.requested_by,
            feature=_FEATURE,
            messages=build_messages(list(loaded.guidelines.values()), loaded.payload),
            reasoning="low",
        )
        return _judge_reply(parse_reply(reply.content, TableFollowReply), loaded.block.lines, reply.model)

    async def apply(self, session: AsyncSession, job: AiJob, loaded: _Loaded, computed: _Verdict) -> str:
        if await _is_stale(session, job):
            _add_result(session, job, loaded, computed, "stale")
            return "stale"
        if computed.items is None:  # 무효 답은 이전 제안을 내리지 못한다
            _add_result(session, job, loaded, computed, "invalid")
            return "done"
        await _retire_older_suggestions(session, job)
        _add_result(session, job, loaded, computed, "applied")
        return "done"


TABLE_FOLLOW_HANDLER = TableFollowHandler()
