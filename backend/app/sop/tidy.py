"""개요의 남은 손질(참조 · 캡션)과 AI 제안 대기 — Assign 위쪽 줄의 표시와 같은 규칙을 묶음 전체로 센다(F3-R2).

진행 숫자(`snapshot.load_bundle_progress`)와 같은 줄이고 막는 조건이 아니다. 개요마다 불리므로 원문 글자는 글에서 참조를
제안하는 옛 추출이 있을 때만 읽는다.
"""

from collections import defaultdict
from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel
from sqlalchemy import Row, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from app.sop.ai.apply import load_live_suggestions
from app.sop.ai.constants import WAITING_KINDS
from app.sop.captions import CAPTION_KIND
from app.sop.decisions import find_captioned_units
from app.sop.detach import UNASSIGNED
from app.sop.groups import TABLE_UNIT_KINDS, select_in_chunks
from app.sop.models import TargetDoc, TargetSentence, TargetSource, Unit, UnitDecision, UnitRef
from app.sop.refs import REF_KINDS, load_proposing_extractions, read_ref_state
from app.sop.snapshot import FIGURE_KIND, ROW_KEY, select_judged_units
from app.sop.status import pick_row_status
from app.sop.units import UNIT_ACTIVE

_CAPTIONED_KINDS = (*TABLE_UNIT_KINDS, FIGURE_KIND)
_NO_CAPTION_DISPOSITIONS = ("delete", "move_external")  # 새 문서에 가지 않는 묶음은 캡션이 필요 없다(프런트 isCaptionNeeded)


class TidyCounts(BaseModel):
    refs: int  # 참조로 볼지 아직 정하지 않은 줄
    captions: int  # 캡션이 있어야 하는데 없는 표 · 그림의 줄
    ai_waiting: int  # 안 정한 줄에 남은 AI 제안(숨긴 종류는 세지 않는다)


async def load_tidy_counts(session: AsyncSession, bundle_id: int) -> TidyCounts:
    units = (
        await session.execute(
            select_judged_units(
                [bundle_id], Unit.id, Unit.kind, Unit.extraction_id, Unit.caption_figure_id, ROW_KEY.label("row_key"),
                UnitDecision.status, UnitDecision.disposition,
            )
        )
    ).all()
    return TidyCounts(
        refs=await _count_refs(session, bundle_id, {unit.extraction_id for unit in units}),
        captions=await _count_captions(session, units),
        ai_waiting=await _count_waiting(session, bundle_id, units),
    )


async def _count_refs(session: AsyncSession, bundle_id: int, extraction_ids: set[int]) -> int:
    proposing = await load_proposing_extractions(session, extraction_ids)
    if not proposing:  # 새 추출은 글을 보고 제안하지 않는다 — 글자를 읽지 않는다
        return 0
    rows = await session.execute(
        select_judged_units([bundle_id], Unit, UnitRef)
        .outerjoin(UnitRef, UnitRef.unit_id == Unit.id)
        .where(Unit.kind.in_(REF_KINDS), Unit.extraction_id.in_(proposing))
        .options(load_only(Unit.kind, Unit.lang, Unit.text), load_only(UnitRef.state, UnitRef.number))
    )
    states = [read_ref_state(unit, mark, propose=True) for unit, mark in rows]
    return sum(state is not None and state.state == "proposed" for state in states)


async def _count_captions(session: AsyncSession, units: Sequence[Row[Any]]) -> int:
    """Caption needed인 줄 수 — 프런트 `caption-model.listCaptionPendingRowKeys`와 같은 규칙."""
    bundles = [
        unit for unit in units if unit.kind in _CAPTIONED_KINDS and unit.disposition not in _NO_CAPTION_DISPOSITIONS
    ]
    if not bundles:
        return 0
    unit_ids = [unit.id for unit in bundles]
    # 첫 그림의 캡션을 같이 쓰는 그림은 그 첫 그림의 캡션이 제 캡션이다
    head_of = {unit.id: unit.caption_figure_id or unit.id for unit in bundles}
    bound = {
        head_id for (head_id,) in await select_in_chunks(
            session,
            lambda chunk: select(Unit.group_unit_id).where(
                Unit.group_unit_id.in_(chunk), Unit.status == UNIT_ACTIVE, Unit.kind == CAPTION_KIND
            ),
            set(head_of.values()),
        )
    }
    captioned = await find_captioned_units(session, unit_ids) | await _find_linked_to_written(session, unit_ids)
    return len({unit.row_key for unit in bundles if head_of[unit.id] not in bound and unit.id not in captioned})


async def _find_linked_to_written(session: AsyncSession, unit_ids: list[int]) -> set[int]:
    """이미 쓴 New 문서의 문장에 이은 단위 — 캡션은 그 문서가 정한다."""
    rows = await select_in_chunks(
        session,
        lambda chunk: select(TargetSource.unit_id)
        .join(TargetSentence, TargetSentence.id == TargetSource.target_id)
        .join(TargetDoc, TargetDoc.id == TargetSentence.target_doc_id)
        .where(
            TargetSource.unit_id.in_(chunk), TargetDoc.entrance == "match", TargetSentence.origin == "new_doc",
            TargetSentence.parent_target_id.is_(None),
        )
        .distinct(),
        unit_ids,
    )
    return {unit_id for (unit_id,) in rows}


async def _count_waiting(session: AsyncSession, bundle_id: int, units: Sequence[Row[Any]]) -> int:
    """살아 있는 제안 가운데 덮는 단위가 모두 활성이고 그 줄이 안 정함인 것 — 프런트 `countWaitingSuggestions`와 같은 규칙.

    Old 단위가 없는 제안(신규)은 안 정한 줄이 없어 세지 않는다.
    """
    live = await load_live_suggestions(session, bundle_id, WAITING_KINDS)
    if not live:
        return 0
    statuses: dict[int, list[str]] = defaultdict(list)
    for unit in units:
        statuses[unit.row_key].append(unit.status)
    open_ids = {unit.id for unit in units if pick_row_status(statuses[unit.row_key]) == UNASSIGNED}
    covered = [suggestion.content.get("unit_ids") for suggestion in live]
    return sum(bool(unit_ids) and open_ids.issuperset(unit_ids) for unit_ids in covered)
