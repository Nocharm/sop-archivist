"""Assign 되돌리기 스냅숏 엔진 — 묶음의 판단 상태 표를 덤프·비교·되쓴다 (설계: docs/superpowers/specs/2026-11-13-assign-undo-design.md §5.2·§5.3)."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Annotated, Literal, TypeVar

from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import ColumnElement, DateTime, Select, Table, and_, delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.sop.membership import lock_bundle
from app.sop.models import (
    AiSuggestion,
    Bundle,
    DecisionStep,
    Document,
    TargetSentence,
    TargetSource,
    UnitDecision,
    UnitEdit,
    UnitPair,
    UnitPairMember,
)
from app.sop.schemas import NO_NUL
from app.sop.tobe import MAX_DB_INT

# 표 이름 → 행 키 문자열 → 열 값(JSON에 담을 수 있는 값, 시각은 ISO 문자열)
Snapshot = dict[str, dict[str, dict]]

# 어긋남 비교와 되쓰기에서 빼는 열 — revision은 되쓸 때 "지금 값 + 1"로 따로 정하고 updated_at은 DB가 채운다
_UNCOMPARED_COLUMNS = frozenset({"revision", "updated_at"})
# 행에 unit_id가 없어 어느 줄인지 못 대는 어긋남의 표시(호출하는 쪽이 걸러 낸다)
UNKNOWN_UNIT_ID = -1


@dataclass(frozen=True)
class _TableSpec:
    """추적하는 판단 상태 표 하나 — 묶음 거르기·행 키·찍는 열·고치기만 하는지."""

    table: Table
    key_columns: tuple[str, ...]
    scope: Callable[[Select, int], Select]
    columns: tuple[str, ...] | None = None  # None이면 모든 열
    is_update_only: bool = False

    @property
    def name(self) -> str:
        return self.table.name

    def get_column_names(self) -> tuple[str, ...]:
        return self.columns or tuple(column.name for column in self.table.columns)


_DECISIONS = UnitDecision.__table__
_TARGETS = TargetSentence.__table__
_SOURCES = TargetSource.__table__
_PAIRS = UnitPair.__table__
_MEMBERS = UnitPairMember.__table__
_SUGGESTIONS = AiSuggestion.__table__
_DOCUMENTS = Document.__table__

# 덤프·비교 순서. 되쓰기 순서는 write_state가 FK에 맞춰 따로 정한다.
TRACKED_TABLES: tuple[_TableSpec, ...] = (
    _TableSpec(_DECISIONS, ("unit_id",), lambda query, bundle_id: query.where(_DECISIONS.c.bundle_id == bundle_id)),
    _TableSpec(_TARGETS, ("id",), lambda query, bundle_id: query.where(_TARGETS.c.bundle_id == bundle_id)),
    _TableSpec(
        _SOURCES,
        ("target_id", "unit_id"),
        lambda query, bundle_id: query.join(_TARGETS, _TARGETS.c.id == _SOURCES.c.target_id).where(
            _TARGETS.c.bundle_id == bundle_id
        ),
    ),
    _TableSpec(
        _PAIRS,
        ("id",),
        lambda query, bundle_id: query.join(_DOCUMENTS, _DOCUMENTS.c.id == _PAIRS.c.document_id).where(
            _DOCUMENTS.c.bundle_id == bundle_id
        ),
    ),
    _TableSpec(
        _MEMBERS,
        ("pair_id", "unit_id"),
        lambda query, bundle_id: query.join(_PAIRS, _PAIRS.c.id == _MEMBERS.c.pair_id)
        .join(_DOCUMENTS, _DOCUMENTS.c.id == _PAIRS.c.document_id)
        .where(_DOCUMENTS.c.bundle_id == bundle_id),
    ),
    _TableSpec(
        _SUGGESTIONS,
        ("id",),
        lambda query, bundle_id: query.where(_SUGGESTIONS.c.bundle_id == bundle_id),
        columns=("id", "result", "adoption", "adopted_by", "adopted_at"),
        is_update_only=True,
    ),
)
_SPECS = {spec.name: spec for spec in TRACKED_TABLES}


def _format_key(row: dict, key_columns: tuple[str, ...]) -> str:
    return ",".join(str(row[name]) for name in key_columns)


def _to_json_value(value: object) -> object:
    return value.isoformat() if isinstance(value, datetime) else value


def _from_json_value(table: Table, name: str, value: object) -> object:
    if isinstance(value, str) and isinstance(table.c[name].type, DateTime):
        return datetime.fromisoformat(value)
    return value


async def dump_bundle_state(session: AsyncSession, bundle_id: int) -> Snapshot:
    """묶음의 판단 상태 표를 전부 읽어 스냅숏으로 — 표마다 질의 한 번."""
    state: Snapshot = {}
    for spec in TRACKED_TABLES:
        names = spec.get_column_names()
        query = spec.scope(select(*(spec.table.c[name] for name in names)), bundle_id)
        rows = (await session.execute(query)).mappings().all()
        state[spec.name] = {
            _format_key(row, spec.key_columns): {name: _to_json_value(row[name]) for name in names} for row in rows
        }
    return state


def diff_states(before: Snapshot, after: Snapshot) -> tuple[Snapshot, Snapshot]:
    """바뀐 행(값이 다르거나 한쪽에만 있는 행)만 남긴 (before, after) — 한쪽에 없는 행은 그쪽에 싣지 않는다."""
    before_diff: Snapshot = {}
    after_diff: Snapshot = {}
    for name in _SPECS:
        old_rows, new_rows = before.get(name, {}), after.get(name, {})
        changed = {key for key in old_rows.keys() | new_rows.keys() if old_rows.get(key) != new_rows.get(key)}
        before_diff[name] = {key: old_rows[key] for key in changed if key in old_rows}
        after_diff[name] = {key: new_rows[key] for key in changed if key in new_rows}
    return before_diff, after_diff


def _strip_uncompared(row: dict) -> dict:
    return {name: value for name, value in row.items() if name not in _UNCOMPARED_COLUMNS}


def find_mismatches(expected: Snapshot, current: Snapshot, *, other: Snapshot | None = None) -> list[int]:
    """기대한 행이 지금과 다른 줄의 unit_id들(revision·updated_at은 보지 않는다).

    expected의 행은 지금도 같은 값으로 있어야 하고, other(단계의 반대쪽)에만 있는 행은 지금 없어야 한다.
    unit_id가 없는 행의 어긋남은 UNKNOWN_UNIT_ID 하나로만 알린다.
    """
    unit_ids: set[int] = set()
    for name in _SPECS:
        expected_rows, current_rows = expected.get(name, {}), current.get(name, {})
        for key, row in expected_rows.items():
            now = current_rows.get(key)
            if now is None or _strip_uncompared(now) != _strip_uncompared(row):
                unit_ids.add(row.get("unit_id", UNKNOWN_UNIT_ID))
        for key, row in (other or {}).get(name, {}).items():
            if key not in expected_rows and key in current_rows:
                unit_ids.add(row.get("unit_id", UNKNOWN_UNIT_ID))
    return sorted(unit_ids)


def _build_key_condition(spec: _TableSpec, row: dict) -> ColumnElement[bool]:
    return and_(*(spec.table.c[name] == row[name] for name in spec.key_columns))


def _build_values(spec: _TableSpec, row: dict) -> dict:
    return {
        name: _from_json_value(spec.table, name, value)
        for name, value in row.items()
        if name not in _UNCOMPARED_COLUMNS
    }


def _has_revision(spec: _TableSpec) -> bool:
    return "revision" in spec.table.c and "revision" in spec.get_column_names()


async def write_state(
    session: AsyncSession, bundle_id: int, target: Snapshot, current: Snapshot, *, other: Snapshot | None = None
) -> None:
    """지금 상태(current, dump_bundle_state)를 target에 맞춘다 — 지우기(자식 먼저) → 넣기(부모 먼저, 같은 id) → 고치기.

    other(단계의 반대쪽)에만 있는 행은 지운다. 고치는 행의 revision은 지금 값 + 1, 다시 넣는 행은 target 값 + 1.
    bundle_id는 덤프와 같은 묶음임을 호출 쪽에 드러내려고 받는다(쓰기는 행 키로 한다).
    """
    other = other or {}

    def _list_deletes(name: str) -> list[dict]:
        if _SPECS[name].is_update_only:
            return []
        wanted, now = target.get(name, {}), current.get(name, {})
        return [now[key] for key in other.get(name, {}) if key not in wanted and key in now]

    def _list_inserts(name: str) -> list[dict]:
        if _SPECS[name].is_update_only:
            return []
        now = current.get(name, {})
        return [row for key, row in target.get(name, {}).items() if key not in now]

    # 지우기 — 출처·짝 멤버 → 새 문장(칸 문장 먼저) → 짝
    for name in ("target_sources", "unit_pair_members", "target_sentences", "unit_pairs"):
        spec = _SPECS[name]
        rows = _list_deletes(name)
        if name == "target_sentences":
            rows.sort(key=lambda row: row["parent_target_id"] is None)
        for row in rows:
            await session.execute(delete(spec.table).where(_build_key_condition(spec, row)))

    # 넣기 — 짝 → 새 문장(부모 먼저) → 짝 멤버·출처
    for name in ("unit_decisions", "unit_pairs", "target_sentences", "unit_pair_members", "target_sources"):
        spec = _SPECS[name]
        rows = _list_inserts(name)
        if name == "target_sentences":
            rows = _order_parents_first(rows)
        for row in rows:
            values = _build_values(spec, row)
            if _has_revision(spec):
                values["revision"] = row["revision"] + 1
            await session.execute(insert(spec.table).values(**values))

    # 고치기 — 양쪽에 다 있는데 값이 다른 행
    for spec in TRACKED_TABLES:
        now_rows = current.get(spec.name, {})
        for key, row in target.get(spec.name, {}).items():
            now = now_rows.get(key)
            if now is None or _strip_uncompared(now) == _strip_uncompared(row):
                continue
            values = _build_values(spec, row)
            if _has_revision(spec):
                values["revision"] = now["revision"] + 1
            await session.execute(update(spec.table).where(_build_key_condition(spec, row)).values(**values))
    await session.flush()


def _order_parents_first(rows: list[dict]) -> list[dict]:
    """다시 넣을 새 문장을 부모가 먼저 오게 — 부모가 같은 무리에 없으면 이미 DB에 있다."""
    pending = {row["id"]: row for row in rows}
    ordered: list[dict] = []
    while pending:
        ready = [row for row in pending.values() if row["parent_target_id"] not in pending]
        for row in ready:
            ordered.append(pending.pop(row["id"]))
    return ordered


# ── 저장마다 단계 기록 (설계 §5.1·§5.4·§4.4) ─────────────────────────────────

# 세션 하나에 남기는 단계 수 — 넘치면 가장 오래된 단계부터 버린다
MAX_STEPS_PER_SESSION = 100
# 기록할 때 이보다 오래된 단계는 지운다
STEP_TTL = timedelta(hours=24)
STEP_APPLIED = "applied"
STEP_UNDONE = "undone"

T = TypeVar("T")

# 화면이 이름을 주는 관계 묶음 저장의 동작 — save_group 하나가 모두 맡아 서버만으로는 가를 수 없다
SaveOp = Literal["confirm", "hold", "link", "unlink", "mark_new", "link_source"]
_StepToken = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
_StepId = Annotated[int, Field(ge=1, le=MAX_DB_INT)]


class UndoMetaIn(BaseModel):
    """판단 저장 요청에 실리는 되돌리기 기록 정보 — 없으면 그 저장은 기록하지 않는다."""

    session: _StepToken  # Assign 화면을 열 때마다 화면이 만드는 id
    op: SaveOp | None = None
    focus_unit_id: _StepId | None = None
    focus_target_id: _StepId | None = None
    step_key: _StepToken | None = None  # 여러 요청으로 나뉜 한 동작을 한 단계로 합치는 키
    scope_label: Annotated[str, StringConstraints(max_length=200), NO_NUL] | None = None


def _merge_diffs(old_before: Snapshot, old_after: Snapshot, new_before: Snapshot, new_after: Snapshot) -> tuple[
    Snapshot, Snapshot
]:
    """한 단계에 이어 붙인 두 diff를 하나로 — before는 처음 값, after는 나중 값, 그대로 돌아온 행은 뺀다.

    새 diff의 before에만 있는 행은 앞 단계가 건드리지 않은 행이라 그 값이 처음 값이다. 앞 단계가 만든 행(after에만 있던 것)은
    처음에 없었으므로 before에 넣지 않는다 — 그 행을 이번에 지웠으면 양쪽 모두에서 사라진다.
    """
    before: Snapshot = {}
    after: Snapshot = {}
    for name in _SPECS:
        old_b, old_a = old_before.get(name, {}), old_after.get(name, {})
        new_b, new_a = new_before.get(name, {}), new_after.get(name, {})
        merged_before = dict(old_b)
        for key, row in new_b.items():
            if key not in old_b and key not in old_a:
                merged_before[key] = row
        merged_after = {key: row for key, row in old_a.items() if key not in new_b or key in new_a}
        merged_after.update(new_a)
        unchanged = {key for key in merged_before.keys() & merged_after.keys() if merged_before[key] == merged_after[key]}
        before[name] = {key: row for key, row in merged_before.items() if key not in unchanged}
        after[name] = {key: row for key, row in merged_after.items() if key not in unchanged}
    return before, after


def _list_decision_unit_ids(after: Snapshot) -> list[int]:
    return sorted(int(key) for key in after.get("unit_decisions", {}))


async def _prune_steps(session: AsyncSession, bundle_id: int, actor: str, session_key: str) -> None:
    """새 단계를 남기기 전 정리 — 그 세션의 되돌린 단계(선형), 같은 사람의 다른 세션 단계, 24시간 지난 단계."""
    mine = and_(DecisionStep.bundle_id == bundle_id, DecisionStep.actor == actor)
    await session.execute(
        delete(DecisionStep).where(
            mine, DecisionStep.session_key == session_key, DecisionStep.state == STEP_UNDONE
        )
    )
    await session.execute(delete(DecisionStep).where(mine, DecisionStep.session_key != session_key))
    await session.execute(
        delete(DecisionStep).where(DecisionStep.bundle_id == bundle_id, DecisionStep.created_at < now() - STEP_TTL)
    )


async def _cap_steps(session: AsyncSession, bundle_id: int, actor: str, session_key: str) -> None:
    """세션 단계가 상한을 넘으면 seq가 작은 것부터 버린다."""
    in_session = and_(
        DecisionStep.bundle_id == bundle_id, DecisionStep.actor == actor, DecisionStep.session_key == session_key
    )
    seqs = (await session.scalars(select(DecisionStep.seq).where(in_session).order_by(DecisionStep.seq.desc()))).all()
    if len(seqs) > MAX_STEPS_PER_SESSION:
        await session.execute(delete(DecisionStep).where(in_session, DecisionStep.seq <= seqs[MAX_STEPS_PER_SESSION]))


async def _load_last_step(session: AsyncSession, bundle_id: int, actor: str, session_key: str) -> DecisionStep | None:
    return await session.scalar(
        select(DecisionStep)
        .where(DecisionStep.bundle_id == bundle_id, DecisionStep.actor == actor, DecisionStep.session_key == session_key)
        .order_by(DecisionStep.seq.desc())
        .limit(1)
    )


async def _get_next_seq(session: AsyncSession, bundle_id: int, actor: str, session_key: str) -> int:
    latest = await session.scalar(
        select(func.max(DecisionStep.seq)).where(
            DecisionStep.bundle_id == bundle_id, DecisionStep.actor == actor, DecisionStep.session_key == session_key
        )
    )
    return (latest or 0) + 1


async def record_snapshot_step(
    session: AsyncSession,
    bundle: Bundle,
    actor: str,
    meta: UndoMetaIn | None,
    op: str,
    run: Callable[[], Awaitable[T]],
) -> T:
    """판단 저장 하나(run)를 감싸 전후 바뀐 행을 한 단계로 남긴다 — meta가 없으면 run만. 커밋은 호출부가 한다.

    같은 세션의 맨 끝 단계가 아직 applied이고 step_key가 같으면 그 단계에 이어 붙인다. 바뀐 것이 없으면 남기지 않는다.
    """
    if meta is None:
        return await run()
    # 덤프와 저장 사이에 다른 쓰기가 끼지 않게 먼저 잠근다(저장 함수가 다시 잠가도 같은 트랜잭션이다)
    await lock_bundle(session, bundle)
    before_state = await dump_bundle_state(session, bundle.id)
    result = await run()
    await session.flush()
    before, after = diff_states(before_state, await dump_bundle_state(session, bundle.id))
    if not any(before.values()) and not any(after.values()):
        return result

    await _prune_steps(session, bundle.id, actor, meta.session)
    last = await _load_last_step(session, bundle.id, actor, meta.session)
    focus = {"unit_id": meta.focus_unit_id, "target_id": meta.focus_target_id}
    if (
        last is not None
        and meta.step_key is not None
        and last.step_key == meta.step_key
        and last.state == STEP_APPLIED
        and last.kind == "snapshot"
    ):
        last.before, last.after = _merge_diffs(last.before, last.after, before, after)
        last.focus = focus
        last.unit_ids = [meta.focus_unit_id] if meta.focus_unit_id else _list_decision_unit_ids(last.after)
    else:
        session.add(
            DecisionStep(
                bundle_id=bundle.id, actor=actor, session_key=meta.session,
                seq=await _get_next_seq(session, bundle.id, actor, meta.session), op=op, kind="snapshot",
                state=STEP_APPLIED, step_key=meta.step_key, focus=focus,
                unit_ids=[meta.focus_unit_id] if meta.focus_unit_id else _list_decision_unit_ids(after),
                scope_label=meta.scope_label, before=before, after=after,
            )
        )
        await session.flush()
        await _cap_steps(session, bundle.id, actor, meta.session)
    await session.flush()
    return result


async def record_unit_edit_step(
    session: AsyncSession, bundle: Bundle, actor: str, meta: UndoMetaIn, document_id: int
) -> None:
    """Assign 안의 자르기를 한 단계로 — 내용은 찍지 않고 그 문서의 방금 만든 Split 편집 기록을 가리킨다(설계 §4.4)."""
    edit = await session.scalar(
        select(UnitEdit)
        .where(UnitEdit.document_id == document_id, UnitEdit.state == "applied")  # editing.EDIT_APPLIED — editing이 이 모듈을 거쳐 들여와 직접 못 쓴다
        .order_by(UnitEdit.seq.desc())
        .limit(1)
    )
    if edit is None:
        return
    await _prune_steps(session, bundle.id, actor, meta.session)
    session.add(
        DecisionStep(
            bundle_id=bundle.id, actor=actor, session_key=meta.session,
            seq=await _get_next_seq(session, bundle.id, actor, meta.session), op="cut", kind="unit_edit",
            state=STEP_APPLIED, step_key=meta.step_key,
            focus={"unit_id": meta.focus_unit_id, "target_id": meta.focus_target_id},
            unit_ids=[meta.focus_unit_id] if meta.focus_unit_id else list(edit.retired_unit_ids),
            scope_label=meta.scope_label, document_id=document_id, unit_edit_id=edit.id,
        )
    )
    await session.flush()
    await _cap_steps(session, bundle.id, actor, meta.session)
