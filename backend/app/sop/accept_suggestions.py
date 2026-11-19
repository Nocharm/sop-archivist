"""AI 제안 일괄 수락 — 종류(분류·묶기)마다 남은 살아 있는 제안을 사람의 저장 경로로 한 번에 받는다.

설계 2026-11-19-ai-suggest-only D3, §5 3-2~3-5. AI는 제안 기록에만 쓰고(D1), 받는 것은 늘 사람이 누른 저장이다 — 제안마다 관계 묶음 저장
(`check_group` → `save_group`)을 `suggestion_id`를 실어 부르므로 `confirmed_by`는 누른 사람, 채택은 제안 모양 그대로면 "그대로"다.
신규(입구 2, 짝 없는 새 문장)는 `match.confirm_in_bulk`의 신규 길로 받는다. 되돌리기 한 단계로 묶는 것은 라우터(`record_snapshot_step`)다.
이 모듈은 사람의 저장 경로라 `app/sop/ai/` 밖에 둔다(불변식: AI 핸들러는 판단·새 문장을 쓰지 않는다).
"""

from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.ai.adoption import build_rewrite_shapes
from app.sop.ai.apply import load_live_suggestions
from app.sop.ai.classify import hash_unit
from app.sop.decision_steps import UndoMetaIn
from app.sop.decisions import (
    DbId,
    GroupSaveIn,
    TargetIn,
    UnitDecisionIn,
    check_group,
    load_cell_positions,
    load_table_shapes,
    save_group,
)
from app.sop.detach import ORIGIN_NEW_DOC, UNASSIGNED
from app.sop.errors import raise_rule
from app.sop.groups import TABLE_UNIT_KINDS, select_in_chunks
from app.sop.match import MAX_BULK_MATCH, NEW_SHAPE, BulkMatchIn, NewItemIn, confirm_in_bulk
from app.sop.membership import ensure_editable, lock_bundle
from app.sop.models import AiJob, AiSuggestion, Bundle, TargetSentence, TargetSource, Unit, UnitDecision, UnitPairMember
from app.sop.numbering import strip_number
from app.sop.schemas import NO_NUL
from app.sop.units import UNIT_ACTIVE

AcceptKind = Literal["classify", "match"]
MAX_ACCEPT = 2000  # 한 번에 받는 제안 수 상한 — 제안마다 관계 묶음 저장 하나라 요청 한 번의 시간을 막는다
DELETE_SHAPE = "delete"  # 분류의 삭제 처분 — 묶기의 삭제 후보(delete_candidate)와 함께 확인 창에서 따로 체크한다(§5 3-4)
_DELETE_CANDIDATE = "delete_candidate"
_ASSIGNED_SHAPE = "assigned"  # 분류가 고른 칸·WI 단계에 놓기
_TEXT_TYPES = ("tone", "rewritten")
_LINK_TYPES = ("as_is", "tone", "rewritten", "table_restructured")  # 사람이 보낼 수 있는 변경 종류 — 합침·나눔·신규·번역은 구조에서 서버가 정한다
# 받지 않는 까닭 — 확인 창이 따로 센다(§5 3-3). changed는 AI가 본 뒤 단위·새 문장·짝이 바뀌어 사람이 다시 볼 몫이고,
# manual은 받으려면 사람이 더 적어야 하는 제안이다(표 구성 변경·두 New 문서에 걸친 나눔의 사유, 캡션 없는 표·그림의 캡션)
SKIP_WARNINGS, SKIP_PROVISIONAL, SKIP_CHANGED, SKIP_MANUAL = "warnings", "provisional", "changed", "manual"


class AcceptItemOut(BaseModel):
    suggestion_id: int
    shape: str  # 분류는 assigned·delete, 묶기는 제안 모양(one_to_one·merged·split·table·figure·new·delete_candidate)
    is_delete: bool


class AcceptPreviewOut(BaseModel):
    """지금 받을 수 있는 제안과 빼는 제안의 수 — 확인 창이 모양별 건수를 보이고 고른 id만 보낸다."""

    kind: AcceptKind
    document_id: int | None
    items: list[AcceptItemOut]
    excluded_warnings: int
    excluded_provisional: int
    excluded_changed: int
    excluded_manual: int


class AcceptIn(BaseModel):
    kind: AcceptKind
    suggestion_ids: list[DbId] = Field(min_length=1, max_length=MAX_ACCEPT)
    # 삭제 제안을 함께 받을 때 모든 삭제 줄에 남기는 Remark — 삭제는 사유가 있어야 확정된다(§5 3-4)
    delete_reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000), NO_NUL] = ""
    undo: UndoMetaIn | None = None


class AcceptOut(BaseModel):
    accepted: int
    skipped: int  # 미리 보기 뒤 바뀌었거나 저장 검사에 걸려 받지 않은 제안 — 그 줄은 미배정으로 남아 사람이 본다


@dataclass(frozen=True)
class _Loaded:
    """제안을 받을지 가리는 데 쓰는 지금 모습 — 판단·단위(칸·캡션 포함)·새 문장·출처·짝·작업 스냅숏."""

    decisions: Mapping[int, UnitDecision]
    units: Mapping[int, Unit]
    children: Mapping[int, Sequence[Unit]]  # 표·행·그림 단위 → 묶인 칸 문장·캡션
    targets: Mapping[int, TargetSentence]
    sourced_target_ids: Collection[int]
    mates: Mapping[int, int]  # 단위 → 짝 id
    pair_members: Mapping[int, Collection[int]]  # 짝 id → 단위들
    snapshots: Mapping[int, Mapping[str, Any]]  # 작업 id → input_snapshot(분류의 단위 해시)


def get_shape(suggestion: AiSuggestion) -> str:
    content = suggestion.content
    if suggestion.kind == "match":
        return str(content.get("shape"))
    return DELETE_SHAPE if content.get("disposition") == "delete" else _ASSIGNED_SHAPE


def is_delete_shape(shape: str) -> bool:
    return shape in (DELETE_SHAPE, _DELETE_CANDIDATE)


async def _load(session: AsyncSession, suggestions: Sequence[AiSuggestion]) -> _Loaded:
    unit_ids = {unit_id for suggestion in suggestions for unit_id in suggestion.content.get("unit_ids", ())}
    target_ids = {target_id for suggestion in suggestions for target_id in suggestion.content.get("target_ids", ())}
    unit_rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit).where(or_(Unit.id.in_(chunk), Unit.group_unit_id.in_(chunk)), Unit.status == UNIT_ACTIVE),
        unit_ids,
    )
    units: dict[int, Unit] = {}
    children: dict[int, list[Unit]] = defaultdict(list)
    for (unit,) in unit_rows:
        if unit.id in unit_ids:
            units[unit.id] = unit
        if unit.group_unit_id in unit_ids:
            children[unit.group_unit_id].append(unit)
    decisions = {
        row.unit_id: row
        for (row,) in await select_in_chunks(session, lambda chunk: select(UnitDecision).where(UnitDecision.unit_id.in_(chunk)), units)
    }
    targets = {
        row.id: row
        for (row,) in await select_in_chunks(session, lambda chunk: select(TargetSentence).where(TargetSentence.id.in_(chunk)), target_ids)
    }
    sourced = {
        target_id
        for (target_id,) in await select_in_chunks(
            session, lambda chunk: select(TargetSource.target_id).where(TargetSource.target_id.in_(chunk)), target_ids
        )
    }
    mates = {
        unit_id: pair_id
        for unit_id, pair_id in await select_in_chunks(
            session, lambda chunk: select(UnitPairMember.unit_id, UnitPairMember.pair_id).where(UnitPairMember.unit_id.in_(chunk)), units
        )
    }
    pair_members: dict[int, set[int]] = defaultdict(set)
    for unit_id, pair_id in await select_in_chunks(
        session,
        lambda chunk: select(UnitPairMember.unit_id, UnitPairMember.pair_id).where(UnitPairMember.pair_id.in_(chunk)),
        set(mates.values()),
    ):
        pair_members[pair_id].add(unit_id)
    snapshots = {
        job_id: snapshot or {}
        for job_id, snapshot in await select_in_chunks(
            session, lambda chunk: select(AiJob.id, AiJob.input_snapshot).where(AiJob.id.in_(chunk)),
            {suggestion.job_id for suggestion in suggestions},
        )
    }
    return _Loaded(decisions, units, children, targets, sourced, mates, pair_members, snapshots)


def _is_open_unit(unit_id: int, loaded: _Loaded) -> bool:
    """아직 미배정인 활성 단위 — 글을 고치면 단위가 은퇴하니 활성이면 원문 그대로다. revision은 보지 않는다(되돌리기도 올린다)."""
    decision = loaded.decisions.get(unit_id)
    return (
        unit_id in loaded.units and decision is not None
        and decision.status == UNASSIGNED and decision.disposition == UNASSIGNED
    )


def _is_open_target(target_id: int, loaded: _Loaded) -> bool:
    """출처 없는 미배정 입구 2 새 문장."""
    target = loaded.targets.get(target_id)
    return (
        target is not None and target.origin == ORIGIN_NEW_DOC and target.status == UNASSIGNED
        and target_id not in loaded.sourced_target_ids
    )


def _list_left_mates(unit_ids: Collection[int], loaded: _Loaded) -> list[int]:
    """제안 밖에 남는 짝 상대 — 분류 작업은 짝을 한 덩어리로 다루지만 묶기 계획은 언어마다 따로 묶는다."""
    wanted = set(unit_ids)
    return sorted({
        mate for unit_id in wanted if unit_id in loaded.mates for mate in loaded.pair_members[loaded.mates[unit_id]]
    } - wanted)


def _needs_person(suggestion: AiSuggestion, loaded: _Loaded) -> bool:
    """받으면 저장 검사가 늘 거절하는 제안 — 사유(표 구성 변경, 두 New 문서에 걸친 나눔)나 캡션을 사람이 적어야 한다.

    캡션을 같이 쓰는 그림(F7 ⑥)도 여기서는 캡션 없음으로 본다 — 사람이 하나씩 받으면 된다.
    """
    content = suggestion.content
    if suggestion.kind == "classify":
        if content.get("disposition") != _ASSIGNED_SHAPE:
            return False
        return any(
            loaded.units[unit_id].kind in (*TABLE_UNIT_KINDS, "figure")
            and not any(child.kind == "caption" for child in loaded.children.get(unit_id, ()))
            for unit_id in content["unit_ids"]
        )
    if "table_restructured" in content.get("target_change_types", {}).values():
        return True
    docs = {loaded.targets[target_id].target_doc_id for target_id in content.get("target_ids", ())}
    return content.get("shape") == "split" and len(docs) >= 2


def find_skip_reason(suggestion: AiSuggestion, loaded: _Loaded) -> str | None:
    """받지 않는 까닭, 받을 수 있으면 None — 경고·다듬기 대기(§5 3-3)와, 사람이 정했거나 원문·언어·짝이 AI가 본 것과 달라진 제안."""
    content = suggestion.content
    if suggestion.warnings:
        return SKIP_WARNINGS
    if suggestion.kind == "match" and content.get("provisional"):
        return SKIP_PROVISIONAL
    unit_ids, target_ids = content.get("unit_ids", ()), content.get("target_ids", ())
    is_fresh = all(_is_open_unit(unit_id, loaded) for unit_id in unit_ids) and all(
        _is_open_target(target_id, loaded) for target_id in target_ids
    )
    if suggestion.kind == "classify":
        # 언어 고치기는 단위를 은퇴시키지 않는다 — 분류 작업이 남긴 해시(언어+글자)로 고쳐 쓴 글의 언어가 아직 맞는지 본다
        hashes = loaded.snapshots.get(suggestion.job_id, {}).get("hashes", {})
        is_fresh = is_fresh and bool(unit_ids) and all(
            hash_unit(loaded.units[unit_id]) == hashes.get(str(unit_id)) for unit_id in unit_ids
        )
    # 분류 작업은 짝 전체가 한 작업이다 — 한쪽만 덮은 분류 제안은 그 사이 짝이 바뀐 것이다
    if not is_fresh or (suggestion.kind == "classify" and _list_left_mates(unit_ids, loaded)):
        return SKIP_CHANGED
    if _needs_person(suggestion, loaded):
        return SKIP_MANUAL
    return None


async def preview_accept(
    session: AsyncSession, bundle_id: int, kind: AcceptKind, document_id: int | None
) -> AcceptPreviewOut:
    """지금 받을 수 있는 제안 — 문서 범위는 그 Old 문서의 제안만(신규는 Old 문서가 없어 Bundle 범위에만 든다)."""
    suggestions = await load_live_suggestions(session, bundle_id, (kind,), document_id=document_id)
    loaded = await _load(session, suggestions)
    items: list[AcceptItemOut] = []
    excluded: dict[str, int] = defaultdict(int)
    for suggestion in suggestions:
        reason = find_skip_reason(suggestion, loaded)
        if reason is not None:
            excluded[reason] += 1
            continue
        shape = get_shape(suggestion)
        items.append(AcceptItemOut(suggestion_id=suggestion.id, shape=shape, is_delete=is_delete_shape(shape)))
    return AcceptPreviewOut(
        kind=kind, document_id=document_id, items=items, excluded_warnings=excluded[SKIP_WARNINGS],
        excluded_provisional=excluded[SKIP_PROVISIONAL], excluded_changed=excluded[SKIP_CHANGED],
        excluded_manual=excluded[SKIP_MANUAL],
    )


# --- 저장 요청 만들기 ---


def _pick_text_type(text: str, sources: Sequence[Unit], suggested: object) -> str:
    """새 문장의 글자 비교 종류 — 원문(번호를 뺀 내용 포함)과 같으면 그대로, 아니면 제안의 종류. 합침·나눔은 서버가 구조에서 정해 이 값을 보지 않는다."""
    if len(sources) == 1 and text in (sources[0].text, strip_number(sources[0].text, sources[0])):
        return "as_is"
    return suggested if isinstance(suggested, str) and suggested in _TEXT_TYPES else "rewritten"


async def _build_bundle_targets(
    session: AsyncSession, unit: Unit, children: Sequence[Unit], place: Mapping[str, Any]
) -> list[TargetIn]:
    """표·행·그림 하나 — 원문 그대로의 표·그림 새 문장과 칸·캡션 새 문장(화면 buildGroupSave의 표·그림과 같은 모양)."""
    key = f"u{unit.id}"
    targets: list[TargetIn] = []
    if unit.kind in TABLE_UNIT_KINDS:
        is_row = unit.kind == "table_row"
        rows, cols = (await load_table_shapes(session, [unit])).get(unit.table_id, (1, 1)) if unit.table_id is not None else (1, 1)
        targets.append(TargetIn(
            key=key, **place, kind="table", lang="neutral", change_type="as_is", source_unit_ids=[unit.id],
            grid={"rows": 1 if is_row else rows, "cols": cols},
        ))
        cells = [child for child in children if child.kind == "cell_sentence"]
        positions = await load_cell_positions(session, cells)
        first_row = (unit.row_index or 0) if is_row else 0  # 행 단위는 그 행 하나짜리 표다
        for cell in cells:
            cell_row, cell_col = positions.get(cell.id, (0, 0))
            targets.append(TargetIn(
                key=f"c{cell.id}", **place, kind="sentence", lang=cell.lang, text=cell.text, change_type="as_is",
                source_unit_ids=[cell.id], parent_key=key, cell_row=cell_row - first_row, cell_col=cell_col,
            ))
    else:
        targets.append(TargetIn(key=key, **place, kind="figure", lang="neutral", change_type="as_is", source_unit_ids=[unit.id]))
    for caption in (child for child in children if child.kind == "caption"):
        targets.append(TargetIn(
            key=f"cap{caption.id}", **place, kind="sentence", lang=caption.lang, text=caption.text, change_type="as_is",
            source_unit_ids=[caption.id], parent_key=key,
        ))
    return targets


async def _build_classify_targets(session: AsyncSession, suggestion: AiSuggestion, loaded: _Loaded) -> list[TargetIn]:
    """분류 제안의 자리에 놓을 새 문장 — 채택 판정(adoption._build_suggested_shape)과 같은 모양이라 받으면 "그대로"다.

    AI가 나누거나 합친 고쳐 쓰기도 그 모양 그대로 저장한다(화면 Use는 칸 수가 맞을 때만 채운다).
    """
    content = suggestion.content
    place = {
        "target_doc_id": content["target_doc_id"], "slot_key": content["slot_key"],
        "wi_step": content["wi_step"], "wi_part": content["wi_part"],
    }
    units = sorted((loaded.units[unit_id] for unit_id in content["unit_ids"]), key=lambda unit: (unit.pos_seq, unit.pos_start, unit.id))
    targets: list[TargetIn] = []
    by_lang: dict[str, list[Unit]] = defaultdict(list)
    for unit in units:
        if unit.kind in (*TABLE_UNIT_KINDS, "figure"):
            targets += await _build_bundle_targets(session, unit, loaded.children.get(unit.id, ()), place)
        else:
            by_lang[unit.lang].append(unit)
    for lang, lang_units in by_lang.items():
        by_id = {unit.id: unit for unit in lang_units}
        shapes = build_rewrite_shapes((None, None, None, None), lang_units, content["rewrites"].get(lang))
        for index, shape in enumerate(shapes):
            sources = sorted(shape.sources)
            targets.append(TargetIn(
                key=f"{lang}{index}", **place, kind="sentence", lang=lang, text=shape.text,
                change_type=_pick_text_type(shape.text, [by_id[unit_id] for unit_id in sources], content.get("change_type")),
                source_unit_ids=sources,
            ))
    return targets


def _build_match_targets(suggestion: AiSuggestion, loaded: _Loaded) -> list[TargetIn]:
    """묶기 제안의 이미 쓴 새 문장 — 글·자리는 잠겨 있고 출처(links)와 변경 종류만 보낸다."""
    content = suggestion.content
    sources: dict[int, list[int]] = defaultdict(list)
    for target_id, unit_id in content.get("links", ()):
        sources[target_id].append(unit_id)
    types = content.get("target_change_types", {})
    targets: list[TargetIn] = []
    for target_id in content["target_ids"]:
        row = loaded.targets[target_id]
        change_type = types.get(str(target_id))
        targets.append(TargetIn(
            key=f"t{target_id}", id=target_id, revision=row.revision, kind=row.kind, source_unit_ids=sources[target_id],
            change_type=change_type if change_type in _LINK_TYPES else None,
        ))
    return targets


async def build_save(session: AsyncSession, suggestion: AiSuggestion, loaded: _Loaded, delete_reason: str) -> GroupSaveIn:
    """제안 하나를 사람이 Use로 받아 확정한 것과 같은 관계 묶음 저장 요청으로 — 신규는 이 길이 아니다(confirm_in_bulk)."""
    unit_ids = suggestion.content["unit_ids"]
    is_delete = is_delete_shape(get_shape(suggestion))
    units = [
        UnitDecisionIn(
            unit_id=unit_id, revision=loaded.decisions[unit_id].revision,
            disposition="delete" if is_delete else "assigned", reason=delete_reason if is_delete else "",
        )
        for unit_id in unit_ids
    ]
    if is_delete:
        targets: list[TargetIn] = []
    elif suggestion.kind == "classify":
        targets = await _build_classify_targets(session, suggestion, loaded)
    else:
        targets = _build_match_targets(suggestion, loaded)
    # 묶기는 언어마다 따로 묶어 짝의 한쪽만 담을 수 있다 — 화면 Use처럼 남는 쪽을 따로 줄로 풀어 보낸다(classify-model listLinkLeftovers).
    # 상대 쪽 제안도 같은 요청에 있으면 그 저장이 제 줄로 받는다(이미 풀린 짝의 release는 settle_pairs가 지나친다)
    release = _list_left_mates(unit_ids, loaded) if suggestion.kind == "match" else []
    return GroupSaveIn(action="confirm", units=units, targets=targets, release_unit_ids=release, suggestion_id=suggestion.id)


# --- 받기 ---


async def _load_requested(session: AsyncSession, bundle_id: int, payload: AcceptIn) -> list[AiSuggestion]:
    """보낸 id 가운데 지금도 살아 있는 그 종류의 제안 — 다른 묶음·종류·이미 정한 제안은 건너뛴 것으로 센다."""
    wanted = set(payload.suggestion_ids)
    live = await load_live_suggestions(session, bundle_id, (payload.kind,))
    return [suggestion for suggestion in live if suggestion.id in wanted]


def _check_delete_reason(suggestions: Iterable[AiSuggestion], payload: AcceptIn) -> None:
    if not payload.delete_reason and any(is_delete_shape(get_shape(suggestion)) for suggestion in suggestions):
        raise_rule(422, "delete_reason_required")


async def accept_suggestions(session: AsyncSession, bundle: Bundle, payload: AcceptIn, actor: str) -> AcceptOut:
    """고른 제안을 받는다 — 제안마다 지금 모습이 AI가 본 그대로일 때만, 사람의 저장 경로로. 커밋은 호출부가 한다.

    저장 검사에 걸린 제안(그 사이 칸이 N/A가 됐거나 캡션이 없는 표 등)은 건너뛰고 수만 돌려준다. 저장 단계의 오류는 요청 전체를 물린다.
    """
    await lock_bundle(session, bundle)
    ensure_editable(bundle)
    if len(set(payload.suggestion_ids)) != len(payload.suggestion_ids):
        raise_rule(422, "duplicate_items")
    suggestions = await _load_requested(session, bundle.id, payload)
    _check_delete_reason(suggestions, payload)
    loaded = await _load(session, suggestions)
    accepted = 0
    new_batches: list[list[NewItemIn]] = [[]]
    for suggestion in suggestions:
        if find_skip_reason(suggestion, loaded) is not None:
            continue
        if get_shape(suggestion) == NEW_SHAPE:
            items = [NewItemIn(target_id=target_id, revision=loaded.targets[target_id].revision) for target_id in suggestion.content["target_ids"]]
            if len(items) > MAX_BULK_MATCH:
                continue  # 한 번에 확정 요청 하나에 다 들지 않는 표 — 사람이 하나씩 받는다
            # 표의 칸·캡션은 같은 요청에 함께 담아야 한다(confirm_in_bulk의 not_new) — 제안을 쪼개지 않고 상한씩 나눈다
            if len(new_batches[-1]) + len(items) > MAX_BULK_MATCH:
                new_batches.append([])
            new_batches[-1] += items
            accepted += 1
            continue
        try:
            checked = await check_group(session, bundle, await build_save(session, suggestion, loaded, payload.delete_reason))
        except HTTPException:
            continue  # 검사는 쓰지 않으니 거절된 제안은 아무것도 바꾸지 않았다
        await save_group(session, bundle, checked, actor)
        accepted += 1
    for batch in new_batches:
        # 신규는 한 번에 확정 길로 — 살아 있는 신규 제안을 그대로 받은 것으로 남긴다(§5 3-5)
        if batch:
            await confirm_in_bulk(session, bundle, BulkMatchIn(new=batch), actor)
    return AcceptOut(accepted=accepted, skipped=len(payload.suggestion_ids) - accepted)
