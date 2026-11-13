"""Assign 되돌리기 스냅숏 엔진 — 묶음의 판단 상태 표를 덤프·비교·되쓴다 (설계: docs/superpowers/specs/2026-11-13-assign-undo-design.md §5.2·§5.3)."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import ColumnElement, DateTime, Select, Table, and_, delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import (
    AiSuggestion,
    Document,
    TargetSentence,
    TargetSource,
    UnitDecision,
    UnitPair,
    UnitPairMember,
)

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
