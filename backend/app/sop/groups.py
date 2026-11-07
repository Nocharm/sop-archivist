"""관계 묶음 — 표 구성원 접기·묶음 ID(순수 계산, 결과물도 쓴다)와 연결 요소 따라가기·묶음 읽기(GroupOut) (스펙 §6.9)."""

from collections import defaultdict
from collections.abc import Callable, Collection, Iterable, Iterator, Mapping
from typing import Any, TypeVar

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Row, Select, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.admin import KstDatetime
from app.sop.errors import raise_rule
from app.sop.models import Document, Extraction, TargetSentence, TargetSource, Unit, UnitDecision
from app.sop.units import UNIT_ACTIVE, compute_display_id

TABLE_UNIT_KINDS = ("table", "table_row")  # 칸 문장이 묶이는 단위 — 칸 문장의 처분·상태를 담는다
GROUP_ID_PREFIX = "G-"
# IN 목록 한 번에 싣는 id 수 — asyncpg 바인드 인자 상한(32767) 아래로, 큰 표·큰 문서도 한 질의가 넘치지 않게
IN_CHUNK_SIZE = 5000

Node = tuple[str, int]  # ("u", 단위 id) | ("t", 새 문장 id)
ChunkKey = TypeVar("ChunkKey", int, str)  # IN 목록 값 — 정수 id와 임베딩 캐시의 글 해시(문자열)가 같은 나누기를 쓴다


# --- 순수 계산 ---


def collapse_table_members(
    edges: Iterable[tuple[int, int]],
    group_unit_by_cell: Mapping[int, int],
    parent_by_cell_target: Mapping[int, int],
) -> list[tuple[int, int]]:
    """(새 문장, 단위) 연결에서 칸 새 문장은 부모 표 새 문장으로, 묶인 칸 문장은 그룹 단위로 접는다(같은 연결은 한 번).

    표 하나는 표 단위·칸 문장·표 새 문장·칸 새 문장이 얽힌 그래프라 접지 않으면 1:1 표가 나눔·합침 묶음으로 잡힌다.
    """
    folded = (
        (parent_by_cell_target.get(target_id, target_id), group_unit_by_cell.get(unit_id, unit_id))
        for target_id, unit_id in edges
    )
    return list(dict.fromkeys(folded))


def _find_root(parents: dict[Node, Node], node: Node) -> Node:
    while parents[node] != node:
        parents[node] = parents[parents[node]]  # 경로 반으로 줄이기
        node = parents[node]
    return node


def build_group_ids(
    edges: Iterable[tuple[int, int]],
    unit_order: Mapping[int, tuple[int, ...]],
    display_ids: Mapping[int, str],
) -> tuple[dict[int, str], dict[int, str]]:
    """(새 문장, 단위) 연결의 연결 요소 중 단위 ≥2 또는 새 문장 ≥2인 것(나눔·합침·중복 배정)에 묶음 ID를 붙인다.

    ID는 요소 안에서 정렬 키가 가장 앞선 단위의 표시 ID로 정해 저장하지 않아도 매번 같다. 접기는 호출 전에 한다.
    """
    parents: dict[Node, Node] = {}
    for target_id, unit_id in edges:
        target_node, unit_node = ("t", target_id), ("u", unit_id)
        parents.setdefault(target_node, target_node)
        parents.setdefault(unit_node, unit_node)
        parents[_find_root(parents, target_node)] = _find_root(parents, unit_node)
    members: dict[Node, list[Node]] = defaultdict(list)
    for node in parents:
        members[_find_root(parents, node)].append(node)

    unit_groups: dict[int, str] = {}
    target_groups: dict[int, str] = {}
    for nodes in members.values():
        unit_ids = [node_id for kind, node_id in nodes if kind == "u"]
        target_ids = [node_id for kind, node_id in nodes if kind == "t"]
        if len(unit_ids) < 2 and len(target_ids) < 2:
            continue
        group_id = GROUP_ID_PREFIX + display_ids[min(unit_ids, key=lambda unit_id: unit_order[unit_id])]
        unit_groups.update(dict.fromkeys(unit_ids, group_id))
        target_groups.update(dict.fromkeys(target_ids, group_id))
    return unit_groups, target_groups


def build_unit_order_key(document: Document, unit: Unit) -> tuple[int, ...]:
    """단위 정렬 키 — 옛 문서 먼저, 같은 쪽 안에서는 문서 id, 그다음 문서 안 자리(설계 데이터 규칙)."""
    return (0 if document.side == "old" else 1, document.id, unit.pos_seq, unit.pos_start, unit.id)


def iter_chunks(ids: Collection[ChunkKey], size: int = IN_CHUNK_SIZE) -> Iterator[list[ChunkKey]]:
    ordered = sorted(ids)
    for start in range(0, len(ordered), size):
        yield ordered[start:start + size]


async def select_in_chunks(
    session: AsyncSession, build_statement: Callable[[list[ChunkKey]], Select[Any]], ids: Collection[ChunkKey]
) -> list[Row[Any]]:
    """id 목록을 IN_CHUNK_SIZE씩 나눠 같은 질의를 돌리고 행을 모은다 — id가 적으면 질의 한 번이다."""
    rows: list[Row[Any]] = []
    for chunk in iter_chunks(ids):
        rows.extend((await session.execute(build_statement(chunk))).all())
    return rows


# --- 출력 스키마 ---


class DecisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    disposition: str
    move_target_code: str
    reason: str
    status: str
    hold_reason: str
    confirmed_by: str | None
    confirmed_at: KstDatetime | None
    revision: int
    # 이 처분의 근거가 된 AI 제안 — 사람이 확정해도 남고, 배정을 지우면 비워진다
    suggestion_id: int | None


class GroupUnitOut(BaseModel):
    unit_id: int
    display_id: str
    document_id: int
    kind: str
    lang: str
    text: str
    # 나눔·합침·중복 배정 관계 묶음일 때만 값이 있다
    group_id: str | None
    decision: DecisionOut
    # 표·행 단위에 묶인 활성 칸 문장(원문 순서) — 칸 문장은 따로 줄을 갖지 않고 그룹 단위를 따른다
    cell_unit_ids: list[int]


class GroupTargetOut(BaseModel):
    id: int
    target_doc_id: int
    slot_key: str | None
    wi_step: int | None
    wi_part: str | None
    section_path: str
    order_index: int
    lang: str
    kind: str
    confirmed_text: str
    ai_text: str
    change_type: str | None
    origin: str
    new_unit_id: int | None
    # 번역이 옮긴 옛 단위 — 번역은 출처 연결이 없어 source_unit_ids는 비고, 묶음도 문장 하나(칸 번역은 그 표)다
    translation_source_unit_id: int | None
    parent_target_id: int | None
    cell_row: int | None
    cell_col: int | None
    grid: dict[str, int] | None
    status: str
    hold_reason: str
    warnings: list[dict[str, str]]
    # 출처 단위(출처 순서)
    source_unit_ids: list[int]
    group_id: str | None
    revision: int
    # 이 문장을 채운 AI 제안
    suggestion_id: int | None


class GroupOut(BaseModel):
    units: list[GroupUnitOut]
    targets: list[GroupTargetOut]


# --- 연결 요소 ---


async def _find_neighbors(
    session: AsyncSession, unit_ids: Collection[int], target_ids: Collection[int]
) -> tuple[set[int], set[int]]:
    """한 걸음 이웃 — 칸 문장↔그룹 단위, 칸 새 문장↔표 새 문장, 출처 연결(새 문장↔단위)."""
    found_units: set[int] = set()
    found_targets: set[int] = set()
    unit_rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit.id, Unit.group_unit_id).where(or_(Unit.id.in_(chunk), Unit.group_unit_id.in_(chunk))),
        unit_ids,
    )
    for unit_id, group_unit_id in unit_rows:
        found_units.add(unit_id)
        if group_unit_id is not None:
            found_units.add(group_unit_id)
    target_rows = await select_in_chunks(
        session,
        lambda chunk: select(TargetSentence.id, TargetSentence.parent_target_id).where(
            or_(TargetSentence.id.in_(chunk), TargetSentence.parent_target_id.in_(chunk))
        ),
        target_ids,
    )
    for target_id, parent_target_id in target_rows:
        found_targets.add(target_id)
        if parent_target_id is not None:
            found_targets.add(parent_target_id)
    link_rows = [
        *await select_in_chunks(
            session, lambda chunk: select(TargetSource.target_id, TargetSource.unit_id).where(TargetSource.unit_id.in_(chunk)),
            unit_ids,
        ),
        *await select_in_chunks(
            session,
            lambda chunk: select(TargetSource.target_id, TargetSource.unit_id).where(TargetSource.target_id.in_(chunk)),
            target_ids,
        ),
    ]
    for target_id, unit_id in link_rows:
        found_targets.add(target_id)
        found_units.add(unit_id)
    return found_units, found_targets


async def collect_component(
    session: AsyncSession, *, unit_ids: Collection[int], target_ids: Collection[int]
) -> tuple[set[int], set[int]]:
    """시작 단위·새 문장에서 출처 연결과 칸 묶음을 따라간 연결 요소 전체 — (단위 id, 새 문장 id).

    걸음마다 질의 몇 번이라 요소의 지름만큼만 돈다(단위 수에 비례하지 않는다).
    """
    units: set[int] = set()
    targets: set[int] = set()
    next_units, next_targets = set(unit_ids), set(target_ids)
    while next_units or next_targets:
        units |= next_units
        targets |= next_targets
        found_units, found_targets = await _find_neighbors(session, next_units, next_targets)
        next_units, next_targets = found_units - units, found_targets - targets
    return units, targets


async def build_group_out(
    session: AsyncSession, *, unit_ids: Collection[int], target_ids: Collection[int]
) -> GroupOut:
    """시작점들의 연결 요소를 GroupOut으로 — 요소가 여럿이어도(한/영 짝 두 단위) 함께 싣는다."""
    component_units, component_targets = await collect_component(session, unit_ids=unit_ids, target_ids=target_ids)
    unit_rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit, Document, UnitDecision)
        .join(Extraction, Extraction.id == Unit.extraction_id)
        .join(Document, Document.id == Extraction.document_id)
        .join(UnitDecision, UnitDecision.unit_id == Unit.id)
        .where(Unit.id.in_(chunk)),
        component_units,
    )
    target_rows = await select_in_chunks(
        session, lambda chunk: select(TargetSentence).where(TargetSentence.id.in_(chunk)), component_targets
    )
    source_rows = await select_in_chunks(
        session,
        lambda chunk: select(TargetSource.target_id, TargetSource.unit_id, TargetSource.seq).where(
            TargetSource.target_id.in_(chunk)
        ),
        component_targets,
    )
    targets = sorted((row[0] for row in target_rows), key=lambda target: target.id)
    sources: dict[int, list[int]] = defaultdict(list)
    for target_id, unit_id, _seq in sorted(source_rows, key=lambda row: (row[0], row[2])):
        sources[target_id].append(unit_id)

    order_keys = {unit.id: build_unit_order_key(document, unit) for unit, document, _ in unit_rows}
    display_ids = {unit.id: compute_display_id(document, unit) for unit, document, _ in unit_rows}
    group_unit_by_cell = {unit.id: unit.group_unit_id for unit, _, _ in unit_rows if unit.group_unit_id is not None}
    parent_by_cell_target = {target.id: target.parent_target_id for target in targets if target.parent_target_id}
    edges = [(target_id, unit_id) for target_id, members in sources.items() for unit_id in members]
    unit_groups, target_groups = build_group_ids(
        collapse_table_members(edges, group_unit_by_cell, parent_by_cell_target), order_keys, display_ids
    )

    cells: dict[int, list[int]] = defaultdict(list)
    for unit, _, _ in sorted(unit_rows, key=lambda row: order_keys[row[0].id]):
        if unit.group_unit_id is not None and unit.status == UNIT_ACTIVE:
            cells[unit.group_unit_id].append(unit.id)
    units_out = [
        GroupUnitOut(
            unit_id=unit.id, display_id=display_ids[unit.id], document_id=document.id, kind=unit.kind,
            lang=unit.lang, text=unit.text, group_id=unit_groups.get(unit.id),
            decision=DecisionOut.model_validate(decision), cell_unit_ids=cells.get(unit.id, []),
        )
        for unit, document, decision in sorted(unit_rows, key=lambda row: order_keys[row[0].id])
        if unit.group_unit_id is None
    ]
    targets_out = [
        _build_target_out(
            target, sources.get(target.id, []), target_groups.get(parent_by_cell_target.get(target.id, target.id))
        )
        for target in targets
    ]
    return GroupOut(units=units_out, targets=targets_out)


def _build_target_out(target: TargetSentence, source_unit_ids: list[int], group_id: str | None) -> GroupTargetOut:
    return GroupTargetOut(
        id=target.id, target_doc_id=target.target_doc_id, slot_key=target.slot_key, wi_step=target.wi_step,
        wi_part=target.wi_part, section_path=target.section_path, order_index=target.order_index, lang=target.lang,
        kind=target.kind, confirmed_text=target.confirmed_text, ai_text=target.ai_text, change_type=target.change_type,
        origin=target.origin, new_unit_id=target.new_unit_id,
        translation_source_unit_id=target.translation_source_unit_id, parent_target_id=target.parent_target_id,
        cell_row=target.cell_row, cell_col=target.cell_col, grid=target.grid, status=target.status,
        hold_reason=target.hold_reason, warnings=target.warnings, source_unit_ids=source_unit_ids, group_id=group_id,
        revision=target.revision, suggestion_id=target.suggestion_id,
    )


async def load_group(
    session: AsyncSession, bundle_id: int, *, unit_id: int | None = None, target_id: int | None = None
) -> GroupOut:
    """옛 문서 활성 단위 하나 또는 새 문장 하나가 든 관계 묶음 — 이 묶음 것이 아니면 404."""
    if (unit_id is None) == (target_id is None):
        raise ValueError("pass exactly one of unit_id or target_id")
    if unit_id is not None:
        found = await session.scalar(
            select(Unit.id)
            .join(Extraction, Extraction.id == Unit.extraction_id)
            .join(Document, Document.id == Extraction.document_id)
            .where(
                Unit.id == unit_id, Document.bundle_id == bundle_id, Document.side == "old", Unit.status == UNIT_ACTIVE
            )
        )
        if found is None:
            raise_rule(404, "unit_not_found", unit_ids=[unit_id])
        return await build_group_out(session, unit_ids=[unit_id], target_ids=[])
    found = await session.scalar(
        select(TargetSentence.id).where(TargetSentence.id == target_id, TargetSentence.bundle_id == bundle_id)
    )
    if found is None:
        raise_rule(404, "target_not_found", target_ids=[target_id])
    return await build_group_out(session, unit_ids=[], target_ids=[target_id])
