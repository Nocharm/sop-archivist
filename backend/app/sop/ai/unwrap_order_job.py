"""AI 벗긴 표 순서 제안 — 벗긴 표 덩이 하나의 줄을 읽는 순서로 다시 늘어놓게 해 줄 id 순서를 제안한다, 요청 고르기와 load·compute·apply (B11).

제안은 순서만 기록한다. 줄·글·판단은 어디에도 쓰지 않아 순서 바꾸기 편집(`reorder_unwrapped`)을 사람이 눌러야 일어난다.
낡음은 문서 revision이 아니라 덩이 자체로 본다 — 문서 어디를 고쳐도 revision이 오르는데 그때마다 제안이 낡으면 쓸 수 없다.
덩이의 줄 집합과 글이 그대로면 사람이 그 사이 순서를 바꿨어도 제안은 여전히 같은 줄의 순열이라 유효하다.
응답은 정해진 필드만 읽어 검사하고 무효 제안에는 응답 원문을 남기지 않는다.
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.ai.apply import add_suggestion
from app.sop.ai.classify import AiWarning, build_warning, load_input_refs, load_latest_extractions
from app.sop.ai.context import _render_table_context
from app.sop.ai.guidelines import GuidelineRef, format_guideline_versions, load_active_guidelines
from app.sop.ai.jobs import ACTIVE_JOB_STATUSES, JobItem
from app.sop.ai.llm import AiStr, build_messages, call_llm, parse_reply
from app.sop.ai.runner import AiCallFailed
from app.sop.editing import _get_position, _load_table, _load_unwrap_lines, _load_unwrap_tables
from app.sop.errors import raise_rule
from app.sop.groups import select_in_chunks
from app.sop.models import AiJob, AiSuggestion, Extraction, SourceBlock, Unit
from app.sop.unwrap_order import order_unwrapped

UNWRAP_ORDER_KIND = "unwrap_order"
_PROMPT_KEY = "prompt.unwrap_order"
_FEATURE = "sop.unwrap_order"
_MIN_LINES = 2  # 줄이 하나면 순서를 바꿀 것이 없다


class UnwrapOrderReply(BaseModel):
    """LLM 응답 — order는 줄 id 순서이고 모양이 틀리거나 칸이 빠지면 형식이 틀린 응답이다."""

    order: list[int]
    reason: AiStr


# --- 요청 ---


async def _find_active_table_ids(session: AsyncSession, bundle_id: int, document_id: int) -> set[int]:
    """그 문서에서 대기·실행 중인 순서 작업이 맡은 표들 — 표는 payload에만 있어 읽은 뒤 거른다(문서당 작업이 적다)."""
    payloads = await session.scalars(
        select(AiJob.payload).where(
            AiJob.bundle_id == bundle_id, AiJob.kind == UNWRAP_ORDER_KIND, AiJob.document_id == document_id,
            AiJob.status.in_(ACTIVE_JOB_STATUSES),
        )
    )
    return {payload["table_id"] for payload in payloads}


async def select_unwrap_order_items(
    session: AsyncSession, bundle_id: int, *, document_id: int, table_id: int
) -> list[JobItem]:
    """요청 표를 작업 한 줄로 — Old · New 문서 최신 추출의 벗긴 표이고 줄이 둘 이상일 때만 받는다.

    아니면 422(unwrap_not_unwrapped · unwrap_too_few_lines), 문서·표가 이 묶음 것이 아니면 404다. 같은 표의 작업이
    이미 줄에 있으면 쌓지 않는다(빈 목록).
    """
    documents = await load_latest_extractions(session, bundle_id, document_id, sides=("old", "new"))
    extraction_id = next(iter(documents), None)
    if extraction_id is None:
        raise_rule(404, "document_not_found")
    table = await _load_table(session, extraction_id, table_id)
    tables = await _load_unwrap_tables(session, extraction_id)
    if not tables[table.id].is_unwrapped:
        raise_rule(422, "unwrap_not_unwrapped", table_id=table.id)
    if len(await _load_unwrap_lines(session, extraction_id, table.id, tables)) < _MIN_LINES:
        raise_rule(422, "unwrap_too_few_lines", table_id=table.id)
    if table.id in await _find_active_table_ids(session, bundle_id, document_id):
        return []
    return [JobItem(document_id=document_id, payload={"table_id": table.id})]


# --- load ---


@dataclass(frozen=True)
class _Block:
    """덩이의 현재 상태 — 줄은 지금 보이는 순서다."""

    extraction_id: int
    table_id: int
    lines: tuple[Unit, ...]


@dataclass(frozen=True)
class _Loaded:
    """load가 읽어 둔 입력 — compute는 세션 없이 이 값만 본다."""

    payload: dict[str, object]
    line_ids: frozenset[int]
    guidelines: Mapping[str, GuidelineRef]
    input_refs: dict[str, object]


def _hash_lines(lines: Sequence[Unit]) -> str:
    """줄 id와 글의 해시 — 순서와 상관없다. 줄이 늘거나 줄거나 글이 바뀌면 달라진다."""
    pairs = sorted((unit.id, unit.text) for unit in lines)
    return hashlib.sha256(json.dumps(pairs, ensure_ascii=False).encode()).hexdigest()


async def _load_block(session: AsyncSession, job: AiJob) -> _Block | None:
    """작업 문서의 최신 추출에서 덩이를 읽는다 — 표가 없어졌거나 더는 벗긴 표가 아니거나 줄이 둘 미만이면 None."""
    if job.document_id is None:
        return None
    extraction_id = await session.scalar(select(func.max(Extraction.id)).where(Extraction.document_id == job.document_id))
    if extraction_id is None:
        return None
    table_id = job.payload["table_id"]
    tables = await _load_unwrap_tables(session, extraction_id)
    if table_id not in tables or not tables[table_id].is_unwrapped:
        return None
    found = await _load_unwrap_lines(session, extraction_id, table_id, tables)
    lines = order_unwrapped(found, lambda unit: unit.unwrap_seq, _get_position)
    if len(lines) < _MIN_LINES:
        return None
    return _Block(extraction_id, table_id, tuple(lines))


async def _load_line_cells(session: AsyncSession, block: _Block) -> dict[int, tuple[int | None, int | None]]:
    """줄 id → 원문 표 안 (행, 열) — 줄의 첫 블록이 그 표의 칸일 때만 있다(안쪽 표 줄·표 단위는 None)."""
    first_block_ids = {unit.id: unit.spans[0][0] for unit in block.lines if unit.spans}
    cells = {
        row.id: (row.row_index, row.col_index)
        for row in await select_in_chunks(
            session,
            lambda chunk: select(SourceBlock.id, SourceBlock.table_id, SourceBlock.row_index, SourceBlock.col_index)
            .where(SourceBlock.id.in_(chunk), SourceBlock.table_id == block.table_id),
            set(first_block_ids.values()),
        )
    }
    return {unit_id: cells.get(block_id, (None, None)) for unit_id, block_id in first_block_ids.items()}


async def _render_original_table(session: AsyncSession, block: _Block) -> str:
    """원문 표의 칸 격자 Markdown — 줄의 행·열이 이 표에서 어디인지 보이게 한다."""
    cells = await session.execute(
        select(SourceBlock.row_index, SourceBlock.col_index, SourceBlock.text).where(
            SourceBlock.extraction_id == block.extraction_id, SourceBlock.table_id == block.table_id
        )
    )
    return _render_table_context(cells.all())


def _build_payload(table: str, block: _Block, cells: Mapping[int, tuple[int | None, int | None]]) -> dict[str, object]:
    """LLM에 보내는 데이터 — 표 Markdown과 지금 순서의 줄뿐이다. 사람 정보는 넣지 않는다(설계 §8.5)."""
    lines = []
    for unit in block.lines:
        row, col = cells.get(unit.id, (None, None))
        lines.append({"id": unit.id, "text": unit.text, "row": row, "col": col})
    return {"task": UNWRAP_ORDER_KIND, "table": table, "lines": lines}


# --- compute ---


@dataclass(frozen=True)
class _Verdict:
    """응답을 검사한 결과. order가 None이면 무효 — warnings가 이유를 코드로 담고 응답 글은 어디에도 남기지 않는다."""

    model: str
    order: tuple[int, ...] | None = None
    reason: str = ""
    warnings: tuple[AiWarning, ...] = ()


def _judge_reply(reply: UnwrapOrderReply | None, line_ids: frozenset[int], model: str) -> _Verdict:
    """응답 검사 — order가 덩이 줄 전부를 한 번씩 담은 순열이어야 한다. 순서 바꾸기 편집이 받는 값과 같은 조건이다."""
    if reply is None:
        return _Verdict(model, warnings=(build_warning("invalid_format"),))
    if len(reply.order) != len(line_ids) or set(reply.order) != line_ids:
        return _Verdict(model, warnings=(build_warning("order_mismatch"),))
    return _Verdict(model, tuple(reply.order), reply.reason)


# --- apply ---


def _add_result(session: AsyncSession, job: AiJob, loaded: _Loaded, verdict: _Verdict, result: str) -> AiSuggestion:
    """제안 내용(`{table_id, unit_ids, reason}`) — 무효·낡음이면 순서가 비고 응답 글은 싣지 않는다."""
    content = {
        "table_id": job.payload["table_id"],
        "unit_ids": list(verdict.order or ()),
        "reason": verdict.reason if verdict.order is not None else "",
    }
    return add_suggestion(
        session, job, content=content, warnings=verdict.warnings, result=result,
        guideline_versions=format_guideline_versions(loaded.guidelines), model=verdict.model,
        input_refs=loaded.input_refs,
    )


async def _is_stale(session: AsyncSession, job: AiJob) -> bool:
    """호출 동안 덩이의 줄 집합이나 글이 바뀌었거나 표가 풀림 상태를 잃었으면 순서를 쓸 수 없다 — 순서만 바뀐 것은 낡음이 아니다."""
    block = await _load_block(session, job)
    snapshot = job.input_snapshot
    return (
        block is None
        or block.extraction_id != snapshot["extraction_id"]
        or _hash_lines(block.lines) != snapshot["hash"]
    )


async def _retire_older_suggestions(session: AsyncSession, job: AiJob) -> None:
    """같은 문서 같은 표의 열린 이전 제안을 낡음으로 — 새 답이 그 표의 가장 새 답이라 이전 제안이 위에 쌓이지 않게 한다.

    사람이 채택을 남긴 제안은 열린 제안이 아니라 applied 그대로다. 묶음을 잠근 apply 안에서 돌고 문서당 열린 제안은 적어 content를 파이썬에서 거른다.
    """
    older = await session.scalars(
        select(AiSuggestion).where(
            AiSuggestion.bundle_id == job.bundle_id, AiSuggestion.kind == UNWRAP_ORDER_KIND,
            AiSuggestion.result == "applied", AiSuggestion.adoption.is_(None), AiSuggestion.document_id == job.document_id,
        )
    )
    for suggestion in older:
        if suggestion.content["table_id"] == job.payload["table_id"]:
            suggestion.result = "stale"


class UnwrapOrderHandler:
    """벗긴 표 덩이 하나 — 줄을 읽는 순서로 늘어놓게 해 순서를 구하고, 낡지 않았을 때만 제안을 쓴다."""

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
            "table_id": block.table_id,
            "unit_ids": [unit.id for unit in block.lines],
            "hash": _hash_lines(block.lines),
        }
        return _Loaded(
            payload=_build_payload(await _render_original_table(session, block), block, await _load_line_cells(session, block)),
            line_ids=frozenset(unit.id for unit in block.lines),
            guidelines=guidelines,
            input_refs=await load_input_refs(session, block.extraction_id),
        )

    async def compute(self, job: AiJob, loaded: _Loaded) -> _Verdict:
        reply = await call_llm(
            login_id=job.requested_by,
            feature=_FEATURE,
            messages=build_messages(list(loaded.guidelines.values()), loaded.payload),
            reasoning="low",
        )
        return _judge_reply(parse_reply(reply.content, UnwrapOrderReply), loaded.line_ids, reply.model)

    async def apply(self, session: AsyncSession, job: AiJob, loaded: _Loaded, computed: _Verdict) -> str:
        if await _is_stale(session, job):
            _add_result(session, job, loaded, computed, "stale")
            return "stale"
        if computed.order is None:  # 무효 답은 이전 제안을 내리지 못한다
            _add_result(session, job, loaded, computed, "invalid")
            return "done"
        await _retire_older_suggestions(session, job)
        _add_result(session, job, loaded, computed, "applied")
        return "done"


UNWRAP_ORDER_HANDLER = UnwrapOrderHandler()
