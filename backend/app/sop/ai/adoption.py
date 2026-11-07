"""AI 제안 채택 기록 — 사람의 저장을 제안과 견줘 그대로·고쳐서·버림을 정하고, 제안을 읽고 채택률을 센다 (설계 §6.11, §7.8, §13).

쓰기는 사람의 저장 트랜잭션 안에서 하고 커밋은 호출부가 한다. 처음 정한 판정이 남는다 — 뒤의 저장은 제안이 아니라 사람의 글을 고친다.
"""

from collections import Counter, defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import case, exists, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.sop.ai.schemas import AdoptionStats, SuggestionOut, SuggestionsPageOut
from app.sop.detach import ORIGIN_NEW_DOC, ORIGIN_TRANSLATION
from app.sop.errors import raise_rule
from app.sop.groups import TABLE_UNIT_KINDS, iter_chunks, select_in_chunks
from app.sop.models import AiSuggestion, TargetSentence, Unit, UnitDecision
from app.sop.units import UNIT_ACTIVE

if TYPE_CHECKING:  # decisions가 이 모듈을 불러 쓰므로 타입만 가져온다
    from app.sop.decisions import GroupSaveIn, _Plan

Place = tuple[int | None, str | None, int | None, str | None]  # (새 문서, 칸, WI 단계, WI 부분)

_MATCH_KIND = "match"
# 저장과 견줄 수 있는 종류 — classify는 content의 처분·자리·고쳐 쓴 글, translate는 새 문장의 ai_text, match는 content의 출처와 견준다
_JUDGED_KINDS = ("classify", "translate", _MATCH_KIND)
_NO_TEXT_KINDS = (*TABLE_UNIT_KINDS, "figure")  # 새 문장에 글자가 없는 단위
_LOCKED_PLACE: Place = (None, None, None, None)  # 입구 2 새 문장은 자리·글이 잠겨 있어 판정 재료에 넣지 않는다
# 변경 종류까지 견주는 입구 2 모습 — 짝 하나에서 LLM이 내는 것은 종류뿐이고(설계 §7.10) 채택률이 지침을 고치는 근거다(설계 §13). 나머지는 종류가 구조에서 나온다
_TYPED_SHAPES = ("one_to_one", "table")


@dataclass(frozen=True)
class TargetShape:
    """새 문장 하나의 판정 재료 — 자리·글자·출처·표 구성. 순서는 뜻이 없고 글자 비교 종류는 글자에서 나온다."""

    place: Place
    text: str
    sources: frozenset[int]
    # 사람이 표 구성을 바꿨다 — 칸 글이 같아도 그대로가 아니다(설계 §6.7). AI 표는 늘 그대로라 제안 쪽은 False다
    restructured: bool = False
    # 입구 2 짝 하나와 표의 변경 종류 — 나머지 모습과 입구 1은 비워 견주지 않는다
    change_type: str | None = None


@dataclass(frozen=True)
class SuggestedShape:
    disposition: str
    targets: tuple[TargetShape, ...]
    # 입구 2 제안 — 새 문장의 글·자리가 잠겨 있고 사람이 바꿀 수 있는 것은 출처와 변경 종류뿐이다
    is_locked: bool = False


@dataclass(frozen=True)
class SavedShape:
    dispositions: frozenset[str]  # 짝을 한 저장에서 따로 처분하면 둘이다
    targets: tuple[TargetShape, ...]


def decide_adoption(suggested: SuggestedShape, saved: SavedShape) -> str:
    """제안을 버렸는가(처분이 다르거나 새 문장이 모두 사라졌거나 모두 다른 자리), 그대로인가, 고쳤는가.

    입구 2 제안은 출처(짝 하나와 표는 변경 종류까지)만 본다 — 같으면 그대로, 출처가 모두 비면 버림, 그 밖은 고침이다. 옛 단위의 처분은 사람이 출처를 바꾸면
    따라 바뀌어 보지 않는다.
    """
    is_same = Counter(suggested.targets) == Counter(saved.targets)
    if suggested.is_locked:
        if is_same:
            return "as_is"
        return "edited" if any(target.sources for target in saved.targets) else "rejected"
    if suggested.disposition not in saved.dispositions:
        return "rejected"
    places = {target.place for target in suggested.targets}
    if places and not any(target.place in places for target in saved.targets):
        return "rejected"
    return "as_is" if is_same else "edited"


def _list_matched_targets(content: Mapping[str, Any]) -> Sequence[int]:
    """출처를 견줄 새 문장 — 제안 기록에 칸 연결이 없어 표는 표 새 문장만 본다.

    칸 자리를 지키는 저장 검사는 그대로인 표에만 걸린다. 표 구성 변경 제안에서 사람이 칸 연결만 고친 저장은 일부러 그대로 채택으로 둔다.
    """
    target_ids = content["target_ids"]
    return target_ids[:1] if content["shape"] == "table" else target_ids


def _read_compared_type(content: Mapping[str, Any], change_type: str | None) -> str | None:
    return change_type if content["shape"] in _TYPED_SHAPES else None


def _build_match_shape(content: Mapping[str, Any]) -> SuggestedShape:
    """짝이면 새 문장마다 제안의 단위 전부가 출처고, 신규는 단위가 없어 출처가 비어 있다. 삭제 후보는 처분만 견준다."""
    if content["shape"] == "delete_candidate":
        return SuggestedShape("delete", ())
    sources = frozenset(content["unit_ids"])
    change_type = _read_compared_type(content, content["change_type"])
    targets = tuple(
        TargetShape(_LOCKED_PLACE, "", sources, change_type=change_type) for _ in _list_matched_targets(content)
    )
    return SuggestedShape("assigned", targets, is_locked=True)


def _build_suggested_shape(suggestion: AiSuggestion, units: Iterable[Unit]) -> SuggestedShape:
    """제안 기록에서 이 저장에 담긴 단위 몫만 꺼낸다. 표·그림과 칸은 기록에 글이 없고 적용 때 원문 그대로 만들어진다."""
    content = suggestion.content
    if suggestion.kind == _MATCH_KIND:
        return _build_match_shape(content)
    disposition = content["disposition"]
    if disposition != "assigned":
        return SuggestedShape(disposition, ())
    place = (content["target_doc_id"], content["slot_key"], content["wi_step"], content["wi_part"])
    targets: list[TargetShape] = []
    sources_by_lang: dict[str, set[int]] = defaultdict(set)
    for unit in units:
        if unit.group_unit_id is not None:
            targets.append(TargetShape(place, unit.text, frozenset((unit.id,))))
        elif unit.kind in _NO_TEXT_KINDS:
            targets.append(TargetShape(place, "", frozenset((unit.id,))))
        else:
            sources_by_lang[unit.lang].add(unit.id)
    for lang, sources in sources_by_lang.items():
        targets += [TargetShape(place, text, frozenset(sources)) for text in content["rewrites"][lang]]
    return SuggestedShape(disposition, tuple(targets))


def _build_saved_shape(
    plans: Sequence["_Plan"], suggestion: AiSuggestion, unit_ids: Collection[int], dispositions: Iterable[str]
) -> SavedShape:
    """이 제안의 단위에서 나온 새 문장만 — 칸 새 문장은 출처가 칸 문장이라 부모 표 새 문장의 출처로 가린다. 표 아래 칸 번역은 자기 제안이 따로 있다.

    입구 2 제안은 단위가 아니라 제안의 새 문장으로 가린다 — 사람이 출처를 바꾸거나 비운 새 문장도 판정에 들어야 한다.
    """
    if suggestion.kind == _MATCH_KIND:
        content = suggestion.content
        matched = set(_list_matched_targets(content))
        return SavedShape(
            frozenset(dispositions),
            tuple(
                TargetShape(
                    _LOCKED_PLACE, "", frozenset(plan.sources), change_type=_read_compared_type(content, plan.change_type)
                )
                for plan in plans if plan.row.id in matched
            ),
        )
    scope = set(unit_ids)
    targets = tuple(
        TargetShape(
            (plan.doc.id, plan.item.slot_key, plan.item.wi_step, plan.item.wi_part), plan.text, frozenset(plan.sources),
            restructured=plan.change_type == "table_restructured",
        )
        for plan in plans
        if plan.origin != ORIGIN_TRANSLATION and scope.intersection((plan.parent or plan).sources)
    )
    return SavedShape(frozenset(dispositions), targets)


async def _load_units_with_cells(session: AsyncSession, unit_ids: Collection[int]) -> dict[int, list[Unit]]:
    """단위 → 그 단위와 묶인 활성 칸 문장."""
    rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit).where(
            or_(Unit.id.in_(chunk), Unit.group_unit_id.in_(chunk)), Unit.status == UNIT_ACTIVE
        ),
        unit_ids,
    )
    units: dict[int, list[Unit]] = defaultdict(list)
    for (unit,) in rows:
        units[unit.group_unit_id if unit.group_unit_id is not None else unit.id].append(unit)
    return units


def _set_adoption(suggestion: AiSuggestion, adoption: str, actor: str, stamp: datetime) -> None:
    suggestion.adoption, suggestion.adopted_by, suggestion.adopted_at = adoption, actor, stamp


async def record_unit_adoption(
    session: AsyncSession,
    *,
    plans: Sequence["_Plan"],
    dispositions: Mapping[int, str],
    decisions: Mapping[int, UnitDecision],
    actor: str,
    stamp: datetime,
) -> None:
    """사람이 확정한 단위들의 제안 채택을 정한다 — dispositions는 단위 → 저장한 처분, plans는 쓴 새 문장 계획.

    짝이 제안 하나를 나눠 쓰므로 이 저장에 담긴 단위 몫만 견주고, 먼저 확정한 쪽의 판정이 그 제안의 채택이 된다.
    밀려서 stale이 된 제안도 보류해 둔 단위가 가리킬 수 있어 결과로 거르지 않는다.
    """
    unit_ids_by_suggestion: dict[int, list[int]] = defaultdict(list)
    for unit_id in dispositions:
        suggestion_id = decisions[unit_id].suggestion_id
        if suggestion_id is not None:
            unit_ids_by_suggestion[suggestion_id].append(unit_id)
    rows = await select_in_chunks(
        session,
        lambda chunk: select(AiSuggestion).where(
            AiSuggestion.id.in_(chunk), AiSuggestion.adoption.is_(None), AiSuggestion.kind.in_(_JUDGED_KINDS)
        ),
        unit_ids_by_suggestion,
    )
    if not rows:
        return
    units = await _load_units_with_cells(session, [unit_id for ids in unit_ids_by_suggestion.values() for unit_id in ids])
    for (suggestion,) in rows:
        unit_ids = unit_ids_by_suggestion[suggestion.id]
        suggested = _build_suggested_shape(suggestion, (unit for unit_id in unit_ids for unit in units[unit_id]))
        saved = _build_saved_shape(plans, suggestion, unit_ids, (dispositions[unit_id] for unit_id in unit_ids))
        _set_adoption(suggestion, decide_adoption(suggested, saved), actor, stamp)


async def record_group_adoption(
    session: AsyncSession,
    *,
    plans: Sequence["_Plan"],
    payload: "GroupSaveIn",
    decisions: Mapping[int, UnitDecision],
    actor: str,
    stamp: datetime,
) -> None:
    """관계 묶음 저장의 채택 기록 — 보류는 아직 결정이 아니라 남기지 않는다(설계 §7.8 6단계)."""
    if payload.action != "confirm":
        return
    dispositions = {item.unit_id: item.disposition for item in payload.units}
    await record_unit_adoption(
        session, plans=plans, dispositions=dispositions, decisions=decisions, actor=actor, stamp=stamp
    )
    await _record_translation_adoption(session, plans, actor, stamp)
    await _record_new_target_adoption(session, plans, actor, stamp)


async def _record_new_target_adoption(
    session: AsyncSession, plans: Sequence["_Plan"], actor: str, stamp: datetime
) -> None:
    """판단이 가리키지 않는 입구 2 제안(신규)은 새 문장에서 찾는다 — 짝 제안은 앞의 단위 쪽 기록이 이미 정했다."""
    suggestion_ids = {plan.row.suggestion_id for plan in plans if plan.origin == ORIGIN_NEW_DOC} - {None}
    rows = await select_in_chunks(
        session,
        lambda chunk: select(AiSuggestion).where(
            AiSuggestion.id.in_(chunk), AiSuggestion.adoption.is_(None), AiSuggestion.kind == _MATCH_KIND
        ),
        suggestion_ids,
    )
    for (suggestion,) in rows:
        adoption = decide_adoption(_build_suggested_shape(suggestion, ()), _build_saved_shape(plans, suggestion, (), ()))
        _set_adoption(suggestion, adoption, actor, stamp)


async def _record_translation_adoption(
    session: AsyncSession, plans: Sequence["_Plan"], actor: str, stamp: datetime
) -> None:
    """번역 제안은 판단 행이 아니라 새 문장에 이어져 있다 — 확정한 글이 제안 글 그대로면 as_is, 고쳤으면 edited."""
    plan_by_suggestion = {plan.row.suggestion_id: plan for plan in plans if plan.origin == ORIGIN_TRANSLATION}
    rows = await select_in_chunks(
        session,
        lambda chunk: select(AiSuggestion).where(
            AiSuggestion.id.in_(chunk), AiSuggestion.adoption.is_(None), AiSuggestion.kind.in_(_JUDGED_KINDS)
        ),
        plan_by_suggestion,
    )
    for (suggestion,) in rows:
        plan = plan_by_suggestion[suggestion.id]
        _set_adoption(suggestion, "as_is" if plan.text == plan.row.ai_text else "edited", actor, stamp)


async def _write_adoption(
    session: AsyncSession, suggestion_ids: Collection[int], adoption: str, actor: str, stamp: datetime
) -> None:
    for chunk in iter_chunks(suggestion_ids):
        await session.execute(
            update(AiSuggestion)
            .where(AiSuggestion.id.in_(chunk), AiSuggestion.adoption.is_(None))
            .values(adoption=adoption, adopted_by=actor, adopted_at=stamp)
            .execution_options(synchronize_session=False)
        )


async def adopt_suggestions(
    session: AsyncSession, suggestion_ids: Collection[int], actor: str, stamp: datetime
) -> None:
    """입구 2 신규 제안을 한 번에 확정한 것 — 그 경로는 글·자리를 고칠 수 없어 그대로 채택이다."""
    await _write_adoption(session, suggestion_ids, "as_is", actor, stamp)


async def reject_suggestions(session: AsyncSession, suggestion_ids: Collection[int], actor: str) -> None:
    """사람이 배정을 지우거나 번역을 지워 제안을 버렸다 — 이미 정해진 제안은 그대로 둔다."""
    await _write_adoption(session, suggestion_ids, "rejected", actor, now())


async def load_adoption_stats(session: AsyncSession, bundle_id: int) -> dict[str, AdoptionStats]:
    """종류별 채택 집계 — 제안이 적용된 적 없는 종류는 빠진다.

    applied는 지금 살아 있는 제안이고, 채택은 밀린 제안(보류한 짝)에 기록돼도 사람의 결정이라 함께 센다. pending은 사람이 아직
    정할 수 있는 제안뿐이다 — 단위가 편집으로 은퇴해 아무 판단·새 문장도 가리키지 않는 제안은 영영 줄지 않는 대기가 된다.
    """
    can_decide = or_(
        exists().where(UnitDecision.suggestion_id == AiSuggestion.id),
        exists().where(TargetSentence.suggestion_id == AiSuggestion.id),
    )
    rows = await session.execute(
        select(
            AiSuggestion.kind, AiSuggestion.result, AiSuggestion.adoption, func.count(),
            func.sum(case((can_decide, 1), else_=0)),
        )
        .where(AiSuggestion.bundle_id == bundle_id)
        .group_by(AiSuggestion.kind, AiSuggestion.result, AiSuggestion.adoption)
    )
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    for kind, result, adoption, total, decidable in rows:
        if result == "applied":
            counts[kind]["applied"] += total
        if adoption is not None:
            counts[kind][adoption] += total
        elif result == "applied":
            counts[kind]["pending"] += decidable
    return {kind: _build_stats(count) for kind, count in counts.items()}


def _build_stats(count: Counter[str]) -> AdoptionStats:
    decided = count["as_is"] + count["edited"] + count["rejected"]
    return AdoptionStats(
        applied=count["applied"], as_is=count["as_is"], edited=count["edited"], rejected=count["rejected"],
        pending=count["pending"], adoption_rate=count["as_is"] / decided if decided else None,
    )


async def list_suggestions(
    session: AsyncSession,
    bundle_id: int,
    *,
    kind: str | None,
    document_id: int | None,
    result: str | None,
    limit: int,
    offset: int,
) -> SuggestionsPageOut:
    """묶음의 제안 — 쌓인 순서라 작업이 도는 동안에도 쪽이 밀리지 않는다."""
    conditions = [AiSuggestion.bundle_id == bundle_id]
    if kind is not None:
        conditions.append(AiSuggestion.kind == kind)
    if document_id is not None:
        conditions.append(AiSuggestion.document_id == document_id)
    if result is not None:
        conditions.append(AiSuggestion.result == result)
    total = await session.scalar(select(func.count()).select_from(AiSuggestion).where(*conditions))
    rows = await session.scalars(
        select(AiSuggestion).where(*conditions).order_by(AiSuggestion.id).limit(limit).offset(offset)
    )
    return SuggestionsPageOut(total=total or 0, items=[SuggestionOut.model_validate(row) for row in rows])


async def load_suggestion(session: AsyncSession, bundle_id: int, suggestion_id: int) -> AiSuggestion:
    """이 묶음의 제안 하나 — 다른 묶음 것이면 없는 것과 같다."""
    suggestion = await session.get(AiSuggestion, suggestion_id)
    if suggestion is None or suggestion.bundle_id != bundle_id:
        raise_rule(404, "suggestion_not_found")
    return suggestion
