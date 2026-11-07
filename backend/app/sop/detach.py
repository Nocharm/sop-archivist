"""떼어 내기 — 판단을 미배정으로, 출처 연결을 떼고, 같은 관계 묶음의 나머지와 그 단위의 번역을 정리한다(배정 지우기·쪼개기 편집·문서 삭제 공용, 새 문장 쪽은 칸 다시 묶기, 스펙 §7.5)."""

from collections import defaultdict
from collections.abc import Collection, Iterable
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import SYSTEM_HOLD_RELATED_CHANGED
from app.sop.groups import collect_component, iter_chunks, select_in_chunks
from app.sop.models import AiSuggestion, TargetSentence, TargetSource, Unit, UnitDecision, UnitDecisionHistory

UNASSIGNED = "unassigned"
AI_SUGGESTED = "ai_suggested"
CONFIRMED = "confirmed"
ON_HOLD = "on_hold"
ORIGIN_NEW_DOC = "new_doc"
ORIGIN_TRANSLATION = "translation"
# 번역이 옮긴 출처 새 문장 — 번역 행에는 이 칸이 없어 제안 기록에서 읽는다. 스키마를 늘리지 않으려는 선택이고 sqlite·Postgres가 같은 식을 쓴다
TRANSLATED_TARGET_ID = AiSuggestion.content["source_target_id"].as_integer()


class DetachReport(BaseModel):
    # 판단을 미배정으로 되돌린 단위(이미 미배정이던 단위는 빠진다)
    reset_unit_ids: list[int]
    # 지운 새 문장(지운 표 새 문장 아래 칸 새 문장, 출처가 바뀐 AI 번역 포함)
    deleted_target_ids: list[int]
    # 같은 관계 묶음이라, 또는 출처가 바뀐 번역이라 보류(관련 단위가 바뀜)로 돌린 단위·새 문장
    held_unit_ids: list[int]
    held_target_ids: list[int]


def is_unassigned(decision: UnitDecision) -> bool:
    return decision.status == UNASSIGNED and decision.disposition == UNASSIGNED


def reset_decision(decision: UnitDecision) -> None:
    decision.disposition, decision.move_target_code, decision.reason = UNASSIGNED, "", ""
    decision.status, decision.hold_reason = UNASSIGNED, ""
    decision.confirmed_by, decision.confirmed_at = None, None
    decision.suggestion_id = None
    decision.revision += 1


def reset_target(target: TargetSentence) -> None:
    """출처가 다 빠진 입구 2 새 문장 — 새 문서 원문 그대로라 지우지 않고 미배정으로 돌린다."""
    target.status, target.change_type, target.hold_reason, target.warnings = UNASSIGNED, None, "", []
    target.confirmed_by, target.confirmed_at = None, None
    target.suggestion_id = None
    target.revision += 1


def _hold(item: UnitDecision | TargetSentence) -> None:
    item.status, item.hold_reason = ON_HOLD, SYSTEM_HOLD_RELATED_CHANGED
    item.revision += 1


def _should_hold(target: TargetSentence) -> bool:
    """같은 관계 묶음의 나머지 중 보류할 새 문장 — 미배정은 뺀다.

    AI 번역도 뺀다. 출처가 바뀐 번역은 이미 지웠으니 여기 남은 것은 표 아래라 딸려 온, 자기 출처가 그대로인 제안이다. 보류하면 확정
    글이 빈 보류가 되어 결과물에 빈 줄로 나가고 다시 번역도 못 받는다. 표를 다시 저장할 때 닫힘이 함께 담아 사람이 정한다.
    """
    if target.status == UNASSIGNED:
        return False
    return not (target.origin == ORIGIN_TRANSLATION and target.status == AI_SUGGESTED)


async def _load_translations(
    session: AsyncSession, bundle_id: int, *, target_ids: Collection[int], unit_ids: Collection[int] = ()
) -> dict[TargetSentence, int]:
    """출처 새 문장이나 번역 출처 단위로 찾은 {번역 새 문장: 출처 새 문장 id} — 번역 출처 단위는 합친 새 문장의 출처 하나일 뿐이라 둘이 다르다."""
    translations = (
        select(TargetSentence, TRANSLATED_TARGET_ID)
        .join(AiSuggestion, AiSuggestion.id == TargetSentence.suggestion_id)
        .where(TargetSentence.bundle_id == bundle_id, TargetSentence.origin == ORIGIN_TRANSLATION)
    )
    rows = [
        *await select_in_chunks(session, lambda chunk: translations.where(TRANSLATED_TARGET_ID.in_(chunk)), target_ids),
        *await select_in_chunks(
            session, lambda chunk: translations.where(TargetSentence.translation_source_unit_id.in_(chunk)), unit_ids
        ),
    ]
    return {row[0]: row[1] for row in rows}


async def _mark_suggestions_stale(session: AsyncSession, targets: Iterable[TargetSentence]) -> None:
    """지워지는 AI 번역의 제안 — ai_suggested 번역은 사람이 아직 정하지 않았으니 채택 기록을 덮을 일이 없다."""
    for chunk in iter_chunks({target.suggestion_id for target in targets}):
        await session.execute(
            update(AiSuggestion)
            .where(AiSuggestion.id.in_(chunk))
            .values(result="stale")
            .execution_options(synchronize_session=False)
        )


async def drop_translations(session: AsyncSession, targets: Collection[TargetSentence]) -> None:
    """AI 번역을 지우고 제안을 stale로 둔다."""
    await _mark_suggestions_stale(session, targets)
    for target in targets:
        await session.delete(target)


async def load_source_target_ids(session: AsyncSession, translation_ids: Collection[int]) -> dict[int, int]:
    """번역 새 문장 → 출처 새 문장 id — 기록에서 읽으므로 출처가 지워졌어도 나온다."""
    rows = await select_in_chunks(
        session,
        lambda chunk: select(TargetSentence.id, TRANSLATED_TARGET_ID)
        .join(AiSuggestion, AiSuggestion.id == TargetSentence.suggestion_id)
        .where(TargetSentence.id.in_(chunk)),
        translation_ids,
    )
    return {target_id: source_id for target_id, source_id in rows}


def _follow_source(target: TargetSentence, source: TargetSentence) -> None:
    target.target_doc_id, target.slot_key = source.target_doc_id, source.slot_key
    target.wi_step, target.wi_part, target.section_path = source.wi_step, source.wi_part, source.section_path
    target.cell_row, target.cell_col, target.parent_target_id = source.cell_row, source.cell_col, source.parent_target_id


async def sweep_translations(
    session: AsyncSession, bundle_id: int, target_ids: Collection[int], *, exempt: Collection[int] = ()
) -> set[int]:
    """글·자리·출처 단위가 바뀌었거나 사라진 출처 새 문장의 번역을 다시 보게 한다 — ai_suggested는 지우고 나머지는 보류다(스펙 §7.5, §7.9).

    옛 글의 번역이 확정인 채 결과물로 나가지 않게 하는 규칙이다. 지운 번역 id를 돌려준다. exempt는 같은 저장에서 사람이 글을 고친
    번역이다 — 사람이 본 것이라 보류하지 않되 자리는 따른다. 묶음을 되보내느라 함께 온 번역은 본 것이 아니라 여기 들지 않는다.
    남긴 번역은 출처가 남아 있으면 그 자리로 옮긴다 — 번역의 자리는 출처와 같아야 하고 잠겨 있어, 옛 자리에 두면 사람이 고친 글을
    지우고 다시 받는 수밖에 없다. 그래서 호출부는 출처를 쓴 뒤에 부른다. 출처가 없어졌으면 자리는 그대로다.
    """
    translations = await _load_translations(session, bundle_id, target_ids=target_ids)
    dropped = [target for target in translations if target.status == AI_SUGGESTED and target.id not in exempt]
    await drop_translations(session, dropped)
    rows = await select_in_chunks(
        session, lambda chunk: select(TargetSentence).where(TargetSentence.id.in_(chunk)), set(translations.values())
    )
    sources = {row[0].id: row[0] for row in rows}
    for target, source_id in translations.items():
        if target.status == AI_SUGGESTED:
            continue
        if target.id not in exempt:
            _hold(target)
        if source_id in sources:
            _follow_source(target, sources[source_id])
    return {target.id for target in dropped}


async def find_units_needing_confirm(session: AsyncSession, unit_ids: Collection[int]) -> list[int]:
    """떼어 내면 사람의 결정이 사라지는 단위 — 미배정이 아닌 판단, 확정 새 문장의 출처, 확정 번역의 출처, 미배정이 아닌 입구 2 새 문장의 새 단위."""
    decided = await select_in_chunks(
        session,
        lambda chunk: select(UnitDecision.unit_id).where(
            UnitDecision.unit_id.in_(chunk),
            or_(UnitDecision.status != UNASSIGNED, UnitDecision.disposition != UNASSIGNED),
        ),
        unit_ids,
    )
    sourced = await select_in_chunks(
        session,
        lambda chunk: select(TargetSource.unit_id)
        .join(TargetSentence, TargetSentence.id == TargetSource.target_id)
        .where(TargetSource.unit_id.in_(chunk), TargetSentence.status == CONFIRMED),
        unit_ids,
    )
    translated = await select_in_chunks(
        session,
        lambda chunk: select(TargetSentence.translation_source_unit_id).where(
            TargetSentence.translation_source_unit_id.in_(chunk), TargetSentence.status == CONFIRMED
        ),
        unit_ids,
    )
    carried = await select_in_chunks(
        session,
        lambda chunk: select(TargetSentence.new_unit_id).where(
            TargetSentence.new_unit_id.in_(chunk), TargetSentence.status != UNASSIGNED
        ),
        unit_ids,
    )
    return sorted({row[0] for row in (*decided, *sourced, *translated, *carried)})


async def detach_units(
    session: AsyncSession,
    *,
    bundle_id: int,
    unit_ids: Collection[int],
    cause: Literal["retired", "cleared", "regrouped"],
    actor: str,
) -> DetachReport:
    """단위(와 묶인 칸 문장)를 관계 묶음에서 떼어 낸다. 커밋은 호출부가 한다.

    1) 연결 요소를 먼저 구하고 2) 판단이 있던 단위는 스냅숏을 남겨 미배정으로, 3) 출처 연결을 떼고(은퇴하는 새 문서 단위면 그
    입구 2 새 문장도 지운다), 4) 출처가 다 빠진 새 문장은 옛 단위에서 온 것이면 지우고 입구 2 것이면 미배정으로, 5) 나머지는 보류.
    다른 작성자가 확정한 것을 조용히 날리지 않고 사람이 다시 보게 하려는 규칙이다. cause는 이력에 남는 이유다(regrouped는 칸
    문장이 다른 표·행으로 다시 묶인 것).

    번역은 출처 연결이 없어 따로 찾는다 — 건드린 단위를 옮긴 번역과, 지워지거나 출처를 잃은 새 문장의 번역이다. ai_suggested는
    제안째 지우고 나머지는 4)가 아닌 5)를 탄다. 출처가 그대로인 ai_suggested 번역은 표에 딸려 와도 그대로 둔다(_should_hold).
    """
    given = set(unit_ids)
    cell_rows = await select_in_chunks(
        session, lambda chunk: select(Unit.id, Unit.group_unit_id).where(Unit.group_unit_id.in_(chunk)), given
    )
    cells_by_group: dict[int, set[int]] = defaultdict(set)
    for cell_id, group_unit_id in cell_rows:
        cells_by_group[group_unit_id].add(cell_id)
    touched = given | {cell_id for cell_id, _ in cell_rows}
    own_targets: set[int] = set()
    if cause == "retired":
        rows = await select_in_chunks(
            session,
            lambda chunk: select(TargetSentence.id).where(
                TargetSentence.new_unit_id.in_(chunk), TargetSentence.bundle_id == bundle_id
            ),
            touched,
        )
        own_targets = {row[0] for row in rows}
    component_units, component_targets = await collect_component(session, unit_ids=touched, target_ids=own_targets)

    targets = {
        row[0].id: row[0]
        for row in await select_in_chunks(
            session, lambda chunk: select(TargetSentence).where(TargetSentence.id.in_(chunk)), component_targets
        )
    }
    sources: dict[int, set[int]] = defaultdict(set)
    for target_id, unit_id in await select_in_chunks(
        session,
        lambda chunk: select(TargetSource.target_id, TargetSource.unit_id).where(TargetSource.target_id.in_(chunk)),
        component_targets,
    ):
        sources[target_id].add(unit_id)
    decisions = {
        row[0].unit_id: row[0]
        for row in await select_in_chunks(
            session, lambda chunk: select(UnitDecision).where(UnitDecision.unit_id.in_(chunk)), component_units
        )
    }

    reset_unit_ids = []
    for unit_id in sorted(touched):
        decision = decisions.get(unit_id)
        if decision is None or is_unassigned(decision):
            continue
        members = {unit_id, *cells_by_group.get(unit_id, ())}
        linked = [targets[target_id] for target_id in sorted(targets) if sources[target_id] & members]
        session.add(
            UnitDecisionHistory(unit_id=unit_id, snapshot=_build_snapshot(decision, linked), cause=cause, actor=actor)
        )
        reset_decision(decision)
        reset_unit_ids.append(unit_id)

    for chunk in iter_chunks(touched):
        await session.execute(delete(TargetSource).where(TargetSource.unit_id.in_(chunk)))
    deleted = set(own_targets)
    emptied: set[int] = set()
    for target in targets.values():
        if target.id in deleted or target.origin == ORIGIN_TRANSLATION or sources[target.id] - touched:
            continue
        if target.origin != ORIGIN_NEW_DOC:
            deleted.add(target.id)
        elif sources[target.id]:
            emptied.add(target.id)
    # 지운 표 새 문장 아래 칸 새 문장은 DB의 ON DELETE CASCADE가 함께 지운다
    deleted |= {
        target.id for target in targets.values()
        if target.parent_target_id in deleted and target.origin != ORIGIN_TRANSLATION
    }
    changed = deleted | {target_id for target_id, unit_ids in sources.items() if unit_ids & touched}
    translations = await _load_translations(session, bundle_id, target_ids=changed, unit_ids=touched)
    suggested = [target for target in translations if target.status == AI_SUGGESTED]
    await _mark_suggestions_stale(session, suggested)
    targets.update({target.id: target for target in translations})
    deleted |= {target.id for target in suggested}
    # 남길 칸 번역은 표에서 떼어야 CASCADE로 같이 지워지지 않는다
    for target in targets.values():
        if target.origin == ORIGIN_TRANSLATION and target.id not in deleted and target.parent_target_id in deleted:
            target.parent_target_id, target.cell_row, target.cell_col = None, None, None
    await session.flush()
    for chunk in iter_chunks(deleted):
        await session.execute(
            delete(TargetSentence).where(TargetSentence.id.in_(chunk)).execution_options(synchronize_session=False)
        )
    for target_id in emptied:
        reset_target(targets[target_id])

    held_unit_ids = [
        unit_id for unit_id in sorted(component_units - touched)
        if unit_id in decisions and decisions[unit_id].status != UNASSIGNED
    ]
    held_target_ids = [
        target_id for target_id in sorted(targets)
        if target_id not in deleted and target_id not in emptied and _should_hold(targets[target_id])
    ]
    for unit_id in held_unit_ids:
        _hold(decisions[unit_id])
    for target_id in held_target_ids:
        _hold(targets[target_id])
    for target_id in deleted:
        # 지운 행을 세션이 계속 붙잡고 있으면 뒤의 flush가 없는 행을 고치려 한다
        if target_id in targets:
            session.expunge(targets[target_id])
    return DetachReport(
        reset_unit_ids=reset_unit_ids, deleted_target_ids=sorted(deleted),
        held_unit_ids=held_unit_ids, held_target_ids=held_target_ids,
    )


async def detach_targets(session: AsyncSession, *, bundle_id: int, target_ids: Collection[int]) -> DetachReport:
    """새 문장 쪽 떼어 내기(R32) — 출처 연결을 떼고 미배정이 아닌 것은 미배정으로, 같은 관계 묶음의 나머지는 보류. 커밋은 호출부가 한다.

    새 문서 칸 문장이 다른 표·행으로 다시 묶이면 그 칸 새 문장은 새 부모 아래로 옮겨진다. 확정된 채 옮기면 표를 반만 확정한
    꼴이 되므로 미배정으로 돌리고, 이어져 있던 옛 단위·새 문장은 지우지 않고 사람이 다시 보게 보류로 둔다.
    그 새 문장들의 번역은 출처가 바뀌었으니 먼저 쓸어 낸다. 다른 칸의 AI 번역은 출처가 그대로라 그대로 둔다(_should_hold).
    """
    given = set(target_ids)
    swept = await sweep_translations(session, bundle_id, given)
    component_units, component_targets = await collect_component(session, unit_ids=(), target_ids=given)
    targets = {
        row[0].id: row[0]
        for row in await select_in_chunks(
            session, lambda chunk: select(TargetSentence).where(TargetSentence.id.in_(chunk)), component_targets
        )
    }
    decisions = {
        row[0].unit_id: row[0]
        for row in await select_in_chunks(
            session, lambda chunk: select(UnitDecision).where(UnitDecision.unit_id.in_(chunk)), component_units
        )
    }
    for chunk in iter_chunks(given):
        await session.execute(delete(TargetSource).where(TargetSource.target_id.in_(chunk)))
    for target_id in sorted(given):
        if targets[target_id].status != UNASSIGNED:
            reset_target(targets[target_id])
    held_unit_ids = [
        unit_id for unit_id in sorted(component_units)
        if unit_id in decisions and decisions[unit_id].status != UNASSIGNED
    ]
    held_target_ids = [target_id for target_id in sorted(component_targets - given) if _should_hold(targets[target_id])]
    for unit_id in held_unit_ids:
        _hold(decisions[unit_id])
    for target_id in held_target_ids:
        _hold(targets[target_id])
    return DetachReport(
        reset_unit_ids=[], deleted_target_ids=sorted(swept), held_unit_ids=held_unit_ids, held_target_ids=held_target_ids
    )


def _build_snapshot(decision: UnitDecision, linked: list[TargetSentence]) -> dict[str, object]:
    """되돌리기 직전 판단 — 처분·사유·상태·보류 사유와 이어져 있던 새 문장 id·글자."""
    return {
        "disposition": decision.disposition,
        "move_target_code": decision.move_target_code,
        "reason": decision.reason,
        "status": decision.status,
        "hold_reason": decision.hold_reason,
        "targets": [{"id": target.id, "text": target.confirmed_text} for target in linked],
    }
