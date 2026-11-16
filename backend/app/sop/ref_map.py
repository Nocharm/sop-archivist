"""참조 지도 — 이 Bundle의 Old 문서가 가리키는 문서와 그 문서를 가리키는 문서를 번호와 줄 수로 모은다(설계 2026-11-17 참조 지도 §4·§7.1).

읽기만 한다 — 잠그지 않고 아무것도 쓰지 않는다. 응답에는 문장을 담는 필드가 없다: 남의 Bundle에서 실리는 것은 문서 번호·제목,
Bundle 코드·상태·문서 수, 후속 문서, 선의 줄 수뿐이고 Bundle 제목은 그 Bundle 구성원에게만 싣는다(계획 판단 1).
줄을 모으는 단계(`collect_map_lines`)와 선으로 묶는 단계(`build_reference_map`)를 갈라 둔다 — 문장 API가 같은 줄을 다시 쓴다.
"""

import logging
import time
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy import ColumnElement, Row, Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from app.equis.rules import normalize_number
from app.sop.bundle_code import format_bundle_code
from app.sop.groups import select_in_chunks
from app.sop.membership import BundleContext
from app.sop.models import (
    Bundle,
    BundleMember,
    Document,
    Extraction,
    TargetDoc,
    TargetSentence,
    TargetSource,
    Unit,
    UnitDecision,
    UnitPairMember,
    UnitRef,
)
from app.sop.refs import REF_KINDS, is_document_number, read_ref_state
from app.sop.snapshot import select_latest_extractions
from app.sop.tobe import is_temp_match_code
from app.sop.units import UNIT_ACTIVE

logger = logging.getLogger(__name__)

MapScope = Literal["linked", "all"]
MAX_NODES = 2000  # 응답의 마디 상한 — 넘으면 이 Bundle 것과 이어진 것부터 채우고 truncated
MAX_EDGES = 10000  # 응답의 선 상한
# 표시 없는 줄을 번호로 거르는 LIKE를 한 질의에 묶는 수 — 늘리면 질의 수가 줄고 조건 하나가 길어진다
LIKE_NUMBERS_PER_QUERY = 50

_OLD_SIDE = "old"
_READY = "ready"
_CONFIRMED = "confirmed"
_MOVE_EXTERNAL = "move_external"
_KIND_ORDER = {"old": 0, "target": 1, "num": 2}


@dataclass(frozen=True)
class MapLine:
    """선으로 묶기 전의 한 줄 — 참조 줄은 Unit 하나, 이동은 줄(짝 하나 또는 짝 없는 Unit 하나, 그 줄의 원문 순서 첫 Unit)."""

    bundle_id: int
    document_id: int
    unit_id: int
    kind: Literal["ref", "moved"]
    state: Literal["confirmed", "proposed"]
    number: str  # normalize_number를 거친 번호


class MapBundleOut(BaseModel):
    id: int
    code: str
    title: str  # relation이 summary면 ""
    status: str
    relation: Literal["self", "member", "summary"]
    document_count: int


class MapBecomesOut(BaseModel):
    code: str  # 임시 번호면 ""
    title: str
    doc_type: Literal["sop", "wi"]


class MapNodeOut(BaseModel):
    id: str  # old:<document id> | target:<target doc id> | num:<번호>
    kind: Literal["old", "target", "num"]
    bundle_id: int | None
    number: str
    title: str
    doc_type: Literal["sop", "wi"] | None  # target만
    becomes: list[MapBecomesOut]


class MapEdgeOut(BaseModel):
    source: str
    target: str
    kind: Literal["ref", "moved"]
    state: Literal["confirmed", "proposed"]
    lines: int


class MapOut(BaseModel):
    scope: MapScope
    truncated: bool
    bundles: list[MapBundleOut]
    nodes: list[MapNodeOut]
    edges: list[MapEdgeOut]


# --- 줄 모으기 ---


def _select_old_units(*columns: Any, in_bundle: ColumnElement[bool]) -> Select[Any]:
    """읽힌 Old 문서의 가장 새 추출의 활성 Unit — in_bundle은 Document에 거는 Bundle 조건이다."""
    return (
        select(*columns)
        .select_from(Unit)
        .join(Extraction, Extraction.id == Unit.extraction_id)
        .join(Document, Document.id == Extraction.document_id)
        .where(
            in_bundle, Document.side == _OLD_SIDE, Document.status == _READY, Unit.status == UNIT_ACTIVE,
            Unit.extraction_id.in_(select_latest_extractions(in_bundle)),
        )
    )


def _select_ref_units(in_bundle: ColumnElement[bool]) -> Select[Any]:
    """참조 줄이 될 수 있는 Unit과 사람의 표시 — read_ref_state가 읽는 칸만 싣는다."""
    return (
        _select_old_units(Unit, UnitRef, Document.bundle_id, Document.id, in_bundle=in_bundle)
        .outerjoin(UnitRef, UnitRef.unit_id == Unit.id)
        .where(Unit.kind.in_(REF_KINDS))
        .options(load_only(Unit.kind, Unit.lang, Unit.text), load_only(UnitRef.state, UnitRef.number))
    )


def _select_moved_units(in_bundle: ColumnElement[bool]) -> Select[Any]:
    """사람이 확정한 다른 문서로 보내기 — 줄 열쇠(짝)와 원문 자리, 대상 코드만. 사유는 읽지 않는다."""
    return (
        _select_old_units(
            Document.bundle_id, Document.id, Unit.id, UnitPairMember.pair_id, Unit.pos_seq, Unit.pos_start,
            UnitDecision.move_target_code, in_bundle=in_bundle,
        )
        .join(UnitDecision, UnitDecision.unit_id == Unit.id)
        .outerjoin(UnitPairMember, UnitPairMember.unit_id == Unit.id)
        .where(
            UnitDecision.disposition == _MOVE_EXTERNAL, UnitDecision.status == _CONFIRMED,
            Unit.group_unit_id.is_(None),
        )
    )


def _read_ref_lines(rows: Iterable[Row[Any]]) -> list[MapLine]:
    lines = []
    for unit, mark, bundle_id, document_id in rows:
        ref = read_ref_state(unit, mark)
        number = normalize_number(ref.number) if ref is not None else ""
        if ref is not None and number:
            lines.append(MapLine(bundle_id, document_id, unit.id, "ref", ref.state, number))
    return lines


def _read_moved_lines(rows: Iterable[Row[Any]]) -> list[MapLine]:
    """짝 하나 또는 짝 없는 Unit 하나가 한 줄(진행 숫자와 같은 줄 열쇠) — 줄마다 원문 순서 첫 Unit을 남긴다."""
    first: dict[tuple[int, int, str], tuple[tuple[int, int, int], int]] = {}
    owner: dict[int, int] = {}
    for bundle_id, document_id, unit_id, pair_id, pos_seq, pos_start, code in rows:
        number = normalize_number(code)
        if not number:
            continue
        key = (document_id, pair_id if pair_id is not None else -unit_id, number)
        place = (pos_seq, pos_start, unit_id)
        if key not in first or place < first[key][0]:
            first[key] = (place, unit_id)
        owner[document_id] = bundle_id
    return [
        MapLine(owner[document_id], document_id, unit_id, "moved", "confirmed", number)
        for (document_id, _, number), (_, unit_id) in first.items()
    ]


def _is_matchable(number: str) -> bool:
    """Bundle을 건너 맞춰 볼 수 있는 번호인가 — 문서 번호 꼴이고 임시 번호가 아니다.

    꼴을 보지 않으면 작성자가 자기 문서 번호를 아무 글로 바꿔 남의 Bundle의 숨은 글(확정 참조 번호·이동 대상 코드)을
    맞혀 볼 수 있다 — 선과 줄 수가 답이 된다. 그래서 맞추기의 양쪽, 모든 길에 건다. 꼴이 아닌 진짜 번호(`QP 07`)는 선을 잃는다.
    """
    return is_document_number(number) and not is_temp_match_code(number)


async def _load_own_numbers(session: AsyncSession, bundle_id: int) -> set[str]:
    """이 Bundle을 가리킬 수 있는 번호 — 읽힌 Old 문서 번호와 New 문서 번호 가운데 맞춰 볼 수 있는 것."""
    doc_codes = await session.scalars(
        select(Document.doc_code).where(
            Document.bundle_id == bundle_id, Document.side == _OLD_SIDE, Document.status == _READY
        )
    )
    target_codes = await session.scalars(select(TargetDoc.code).where(TargetDoc.bundle_id == bundle_id))
    numbers = {normalize_number(code) for code in [*doc_codes, *target_codes]}
    return {number for number in numbers if _is_matchable(number)}


def _in_same_kind(bundle: Bundle, column: Any) -> ColumnElement[bool]:
    """보는 Bundle과 합성/실제가 같은 Bundle — 서로의 지도에 섞이지 않는다."""
    return column.in_(select(Bundle.id).where(Bundle.is_synthetic == bundle.is_synthetic))


async def _collect_incoming(session: AsyncSession, bundle: Bundle, numbers: set[str]) -> list[MapLine]:
    """다른 Bundle(같은 종류)에서 이 Bundle의 번호를 가리키는 줄 — 표시한 참조, 표시 없는 줄, 이동의 세 길."""
    others = and_(Document.bundle_id != bundle.id, _in_same_kind(bundle, Document.bundle_id))
    found: dict[int, Row[Any]] = {}
    marked = await select_in_chunks(
        session, lambda chunk: _select_ref_units(others).where(UnitRef.number.in_(chunk)), numbers
    )
    for row in marked:
        found[row[0].id] = row
    # 번호 꼴만 LIKE에 넣는다 — 꼴이 [A-Z0-9-]라 `%`·`_`가 끼지 않는다. 대소문자는 read_ref_state가 다시 거른다
    patterns = sorted(number for number in numbers if is_document_number(number))
    for start in range(0, len(patterns), LIKE_NUMBERS_PER_QUERY):
        chunk = patterns[start:start + LIKE_NUMBERS_PER_QUERY]
        statement = _select_ref_units(others).where(or_(*(Unit.text.like(f"%{number}%") for number in chunk)))
        for row in (await session.execute(statement)).all():
            found.setdefault(row[0].id, row)
    moved = await select_in_chunks(
        session,
        lambda chunk: _select_moved_units(others).where(
            func.upper(func.trim(UnitDecision.move_target_code)).in_(chunk)
        ),
        numbers,
    )
    lines = _read_ref_lines(found.values()) + _read_moved_lines(moved)
    return [line for line in lines if line.number in numbers]


async def collect_map_lines(session: AsyncSession, bundle: Bundle, scope: MapScope) -> list[MapLine]:
    """지도의 줄 — 이 Bundle에서 나가는 참조·이동과, 다른 Bundle에서 이 Bundle의 번호로 들어오는 참조·이동.

    scope "all"도 지금은 같은 줄을 모은다(남끼리의 줄은 다음 걸음).
    """
    own = Document.bundle_id == bundle.id
    lines = _read_ref_lines((await session.execute(_select_ref_units(own))).all())
    lines += _read_moved_lines((await session.execute(_select_moved_units(own))).all())
    numbers = await _load_own_numbers(session, bundle.id)
    if numbers:
        lines += await _collect_incoming(session, bundle, numbers)
    return lines


# --- 선으로 묶기 ---


@dataclass(frozen=True)
class _Node:
    id: str
    kind: Literal["old", "target", "num"]
    bundle_id: int | None
    number: str
    title: str
    doc_type: Literal["sop", "wi"] | None
    key: int  # 문서 id(num은 0) — 정렬용


def _old_node(row: Row[Any]) -> _Node:
    doc_id, bundle_id, doc_code, title = row
    return _Node(f"old:{doc_id}", "old", bundle_id, doc_code, title, None, doc_id)


async def _resolve_numbers(
    session: AsyncSession, bundle: Bundle, numbers: set[str]
) -> tuple[dict[str, list[_Node]], dict[str, list[_Node]]]:
    """번호마다 맞는 읽힌 Old 문서와 New 문서(임시 번호 빼고) — 같은 종류의 모든 Bundle에서."""
    olds: dict[str, list[_Node]] = defaultdict(list)
    targets: dict[str, list[_Node]] = defaultdict(list)
    old_rows = await select_in_chunks(
        session,
        lambda chunk: select(Document.id, Document.bundle_id, Document.doc_code, Document.title).where(
            _in_same_kind(bundle, Document.bundle_id), Document.side == _OLD_SIDE, Document.status == _READY,
            func.upper(func.trim(Document.doc_code)).in_(chunk),
        ),
        numbers,
    )
    for row in old_rows:
        olds[normalize_number(row[2])].append(_old_node(row))
    target_rows = await select_in_chunks(
        session,
        lambda chunk: select(TargetDoc.id, TargetDoc.bundle_id, TargetDoc.code, TargetDoc.title, TargetDoc.doc_type).where(
            _in_same_kind(bundle, TargetDoc.bundle_id), func.upper(func.trim(TargetDoc.code)).in_(chunk)
        ),
        numbers,
    )
    for target_id, bundle_id, code, title, doc_type in target_rows:
        if not is_temp_match_code(code):
            targets[normalize_number(code)].append(
                _Node(f"target:{target_id}", "target", bundle_id, code, title, doc_type, target_id)
            )
    return olds, targets


def _pick_ends(line: MapLine, olds: dict[str, list[_Node]], targets: dict[str, list[_Node]]) -> list[_Node]:
    """줄의 번호가 닿는 마디 — 참조는 Old 먼저, 이동은 New 먼저, 둘 다 없으면 num. 맞춰 볼 수 없는 번호의 줄은 버린다.

    번호 꼴을 문서와 맞추기 전에 본다 — 자유 입력 글이 번호처럼 남에게 보이지도, 남의 문서 번호와 맞아 선이 되지도 않게.
    """
    if not _is_matchable(line.number):
        return []
    first, second = (olds, targets) if line.kind == "ref" else (targets, olds)
    return first.get(line.number) or second.get(line.number) or [
        _Node(f"num:{line.number}", "num", None, line.number, "", None, 0)
    ]


async def _load_old_nodes(session: AsyncSession, bundle_id: int, extra_ids: set[int]) -> dict[str, _Node]:
    """이 Bundle의 읽힌 Old 문서 전부와, 선의 출발점인 다른 Bundle의 Old 문서."""
    columns = (Document.id, Document.bundle_id, Document.doc_code, Document.title)
    ready = (Document.side == _OLD_SIDE, Document.status == _READY)
    rows = list((await session.execute(select(*columns).where(Document.bundle_id == bundle_id, *ready))).all())
    rows += await select_in_chunks(session, lambda chunk: select(*columns).where(Document.id.in_(chunk), *ready), extra_ids)
    return {node.id: node for node in map(_old_node, rows)}


async def _load_becomes(session: AsyncSession, doc_ids: set[int]) -> dict[int, list[MapBecomesOut]]:
    """Old 문서마다 후속 문서 — 사람이 확정한 새 문장의 출처가 그 문서의 가장 새 추출의 활성 Unit인 New 문서. SOP 먼저."""

    def build(chunk: list[int]) -> Select[Any]:
        in_docs = Document.id.in_(chunk)
        return (
            select(
                Document.id, TargetDoc.id, TargetDoc.code, TargetDoc.title, TargetDoc.doc_type, TargetDoc.order_index
            )
            .distinct()
            .select_from(TargetSource)
            .join(TargetSentence, TargetSentence.id == TargetSource.target_id)
            .join(TargetDoc, TargetDoc.id == TargetSentence.target_doc_id)
            .join(Unit, Unit.id == TargetSource.unit_id)
            .join(Extraction, Extraction.id == Unit.extraction_id)
            .join(Document, Document.id == Extraction.document_id)
            .where(
                in_docs, TargetSentence.status == _CONFIRMED, Unit.status == UNIT_ACTIVE,
                Unit.extraction_id.in_(select_latest_extractions(in_docs)),
            )
        )

    found: dict[int, list[tuple[tuple[int, int, int], MapBecomesOut]]] = defaultdict(list)
    for doc_id, target_id, code, title, doc_type, order_index in await select_in_chunks(session, build, doc_ids):
        item = MapBecomesOut(code="" if is_temp_match_code(code) else code, title=title, doc_type=doc_type)
        found[doc_id].append(((0 if doc_type == "sop" else 1, order_index, target_id), item))
    return {doc_id: [item for _, item in sorted(items, key=lambda pair: pair[0])] for doc_id, items in found.items()}


async def _count_documents(session: AsyncSession, bundle_ids: set[int]) -> dict[int, int]:
    rows = await select_in_chunks(
        session,
        lambda chunk: select(Document.bundle_id, func.count())
        .where(Document.bundle_id.in_(chunk), Document.side == _OLD_SIDE, Document.status == _READY)
        .group_by(Document.bundle_id),
        bundle_ids,
    )
    return {bundle_id: count for bundle_id, count in rows}


def _cap(
    nodes: dict[str, _Node], edges: Counter[tuple[str, str, str, str]], bundle_id: int
) -> tuple[list[_Node], list[tuple[tuple[str, str, str, str], int]], bool]:
    """상한에서 자른다 — 이 Bundle의 마디 → 이 Bundle과 선으로 이어진 마디 → 나머지, 선은 두 끝이 남은 것만(계획 판단 7)."""

    def touches(key: tuple[str, str, str, str]) -> bool:
        return nodes[key[0]].bundle_id == bundle_id or nodes[key[1]].bundle_id == bundle_id

    linked = {end for key in edges if touches(key) for end in key[:2]}

    def rank(node: _Node) -> tuple[Any, ...]:
        group = 0 if node.bundle_id == bundle_id else 1 if node.id in linked else 2
        return (group, node.bundle_id is None, node.bundle_id or 0, _KIND_ORDER[node.kind], node.key, node.number)

    kept = sorted(nodes.values(), key=rank)[:MAX_NODES]
    kept_ids = {node.id for node in kept}
    candidates = sorted(
        ((key, count) for key, count in edges.items() if key[0] in kept_ids and key[1] in kept_ids),
        key=lambda item: (not touches(item[0]), item[0]),
    )
    kept_edges = candidates[:MAX_EDGES]
    return kept, kept_edges, len(kept) < len(nodes) or len(kept_edges) < len(edges)


async def build_reference_map(session: AsyncSession, ctx: BundleContext, scope: MapScope) -> MapOut:
    """보는 사람(ctx — 이 Bundle의 구성원)에게 줄 지도. 다른 Bundle과의 관계는 bundle_members만으로 정한다(권한을 보지 않는다)."""
    started = time.perf_counter()
    bundle = ctx.bundle
    bundle_rows = {
        row.id: row
        for row in await session.execute(
            select(Bundle.id, Bundle.title, Bundle.status).where(Bundle.is_synthetic == bundle.is_synthetic)
        )
    }
    member_of = set(await session.scalars(select(BundleMember.bundle_id).where(BundleMember.login_id == ctx.login_id)))

    lines = await collect_map_lines(session, bundle, scope)
    olds, targets = await _resolve_numbers(session, bundle, {line.number for line in lines if _is_matchable(line.number)})
    nodes: dict[str, _Node] = {}
    edges: Counter[tuple[str, str, str, str]] = Counter()
    for line in lines:
        source = f"old:{line.document_id}"
        for end in _pick_ends(line, olds, targets):
            # 자기 참조는 선이 아니고, 한쪽 끝이 이 Bundle인 선만 싣는다(남끼리의 추측은 세지 않는다)
            if end.id == source or (line.bundle_id != bundle.id and end.bundle_id != bundle.id):
                continue
            nodes[end.id] = end
            edges[(source, end.id, line.kind, line.state)] += 1
    sources = {int(key[0].removeprefix("old:")) for key in edges}
    nodes.update(await _load_old_nodes(session, bundle.id, sources))
    # 질의 사이에 지워졌거나 새로 생긴 문서·Bundle은 이번 지도에서 뺀다(잠그지 않는다 — 다시 읽으면 맞는다)
    nodes = {key: node for key, node in nodes.items() if node.bundle_id is None or node.bundle_id in bundle_rows}
    edges = Counter({key: count for key, count in edges.items() if key[0] in nodes and key[1] in nodes})

    kept, kept_edges, truncated = _cap(nodes, edges, bundle.id)
    bundle_ids = {bundle.id} | {node.bundle_id for node in kept if node.bundle_id is not None}
    counts = await _count_documents(session, bundle_ids)
    becomes = await _load_becomes(session, {node.key for node in kept if node.kind == "old"})

    order = [bundle.id, *sorted(bundle_ids - {bundle.id})]
    bundles = []
    for bundle_id in order:
        row = bundle_rows[bundle_id]
        relation = "self" if bundle_id == bundle.id else "member" if bundle_id in member_of else "summary"
        # Bundle 제목을 싣는 곳은 여기 하나다 — 구성원이 아닌 Bundle의 제목은 싣지 않는다
        title = "" if relation == "summary" else row.title
        bundles.append(MapBundleOut(
            id=bundle_id, code=format_bundle_code(bundle_id), title=title, status=row.status, relation=relation,
            document_count=counts.get(bundle_id, 0),
        ))
    lane = {bundle_id: index for index, bundle_id in enumerate(order)}
    kept.sort(key=lambda node: (lane.get(node.bundle_id, len(order)), _KIND_ORDER[node.kind], node.key, node.number))
    out = MapOut(
        scope=scope,
        truncated=truncated,
        bundles=bundles,
        nodes=[_build_node_out(node, becomes) for node in kept],
        edges=[
            MapEdgeOut(source=source, target=target, kind=kind, state=state, lines=count)
            for (source, target, kind, state), count in sorted(kept_edges)
        ],
    )
    logger.info("reference map built", extra={
        "scope": scope, "bundles": len(out.bundles), "nodes": len(out.nodes), "edges": len(out.edges),
        "elapsed_ms": round((time.perf_counter() - started) * 1000),
    })
    return out


def _build_node_out(node: _Node, becomes: dict[int, list[MapBecomesOut]]) -> MapNodeOut:
    return MapNodeOut(
        id=node.id, kind=node.kind, bundle_id=node.bundle_id, number=node.number, title=node.title,
        doc_type=node.doc_type, becomes=becomes.get(node.key, []) if node.kind == "old" else [],
    )
