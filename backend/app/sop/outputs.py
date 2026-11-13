"""결과물 A(문장 비교표)·B(맵핑 흐름)·C(새 문서 기준 묶음)와 요약 숫자, 검토 요청 조건의 단위 재료 — 스냅숏만 받는 순수 함수 (스펙 §7.13·§7.15).

세 결과물은 같은 재료(옛 단위·보낸 곳·새 문장)를 다른 방향에서 본다. 그래서 단위의 보낸 곳(_group_dests)·칸 순서(_plan_sections)·
신규 새 문장(_list_new_targets)을 한 벌만 두고 A·B·C·요약이 함께 쓴다. 번역 새 문장은 출처 연결이 없어 단위의 보낸 곳·관계 묶음에
끼지 않고, A의 번역 줄과 C의 칸 항목, 요약의 번역 숫자로만 나온다. 모두 판(ko/en)이 없는 한 벌이고 lang은 라벨 언어만 고른다.
줄은 의미 묶음(output_rows — 짝 하나·짝 없는 판단 단위 하나)이라 A의 묶음·B의 건수·C의 삭제·이동·요약이 진행 숫자와 같은 줄이다.
"""

from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from app.routers.admin import KstDatetime
from app.sop.constants import COVER_KINDS, NUMBER_NOTE, NUMBERED, SLOT_KEYS, WI_PARTS
from app.sop.groups import TABLE_UNIT_KINDS, build_group_ids, collapse_table_members
from app.sop.output_labels import LABELS, OutputLabels
from app.sop.output_rows import (
    MeaningRow,
    build_meaning_rows,
    count_single_language,
    get_meaning_key,
    get_new_meaning_key,
)
from app.sop.snapshot import (
    BundleSnapshot,
    DocumentInfo,
    TargetDocInfo,
    TargetInfo,
    UnitInfo,
)
from app.sop.status import get_cover_status

Lang = Literal["ko", "en"]  # 라벨 언어
NumberOf = Callable[[TargetInfo], str]  # 새 문장 → 섹션 번호(없으면 빈 글)
ORIGIN_NEW_DOC = "new_doc"
TRANSLATED = "translated"
# 입구 2 한쪽만 맞춘 짝의 출처 없는 쪽(설계 §4.5) — 저장하지 않는 표시 전용 변경 종류
TRANSLATED_ADDED = "translated_added"
# 나눔 문장 번호 — 스무 개를 넘으면 "(21)" 꼴로 이어 간다
CIRCLED_NUMBERS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
DISPOSITION_NODES = {"delete": "delete", "move_external": "move_external"}  # 그 밖(미배정)은 "unassigned"
TAIL_NODES = ("delete", "move_external", "unassigned")  # 흐름도 오른쪽 열에서 새 문서들 뒤에 오는 노드


# --- 출력 모양 ---


class LocationOut(BaseModel):
    section: str
    place: str  # 문단 · 표 n · r행 c열 · 그림 · 머리말 …
    page: int | None
    page_basis: str


class ARow(BaseModel):
    """결과물 A 한 줄 — 옛 단위 한 줄(중복 배정은 보낸 곳마다), 표 줄·칸 문장 줄, 번역 줄, 입구 2 신규 줄.

    줄은 의미 묶음(짝 하나·짝 없는 판단 단위 하나, 고아 번역 하나, 입구 2 신규 짝 하나)으로 묶인다. 묶음이 함께 쓰는 값은
    row_no·remark이고, 상태·변경 종류·위치는 줄마다 자기 값이다(설계 §4.2).
    """

    row_no: int  # 묶음 번호, 묶음마다 1부터 — 옛 문서 줄 → 고아 번역 → 신규
    is_group_start: bool
    row_kind: Literal["unit", "table", "cell", "translation", "new"]
    old_doc_code: str
    old_doc_version: str
    location: LocationOut
    unit_id: int | None
    display_id: str
    source_text: str
    dest_kind: str  # sop | wi | delete | move_external | ""(미배정)
    dest_doc_code: str
    dest_doc_title: str
    dest_location: str
    # 새 문서 안 섹션 번호(결과물 C와 같은 값) — 여러 새 문장이면 "① 6.1.1\n② 6.1.2", 번호가 없는 자리(입구 2 문서·단계 없는 WI)는 빈 글
    dest_number: str
    # 보낸 새 문장이 모두 주석 줄(번호 없이 기울임)인가 — Excel A가 확정·AI 제안 문장 칸을 기울여 쓴다
    dest_is_note: bool
    confirmed_text: str
    ai_text: str
    change_type: str  # 저장한 변경 종류, 그리고 표시 전용 translated_added
    remark: str  # 묶음의 Remark — 묶음의 모든 줄에 같은 값
    status: str  # 옛 단위 줄은 커버 상태, 번역·신규 줄은 새 문장 상태
    confirmed_by: str | None  # "이름 (ID)", 디렉터리에 없거나 퇴직이면 ID만(format_confirmer)
    confirmed_at: KstDatetime | None
    group_id: str | None
    warnings: list[dict[str, str]]


class FlowNode(BaseModel):
    id: str  # old:<문서 id> | target:<새 문서 id> | delete | move_external | unassigned
    kind: str  # old | sop | wi | delete | move_external | unassigned
    label: str
    title: str
    count: int


class FlowEdge(BaseModel):
    source: str
    target: str
    count: int


class FlowGraph(BaseModel):
    nodes: list[FlowNode]
    edges: list[FlowEdge]


class CItem(BaseModel):
    target_id: int
    kind: str
    lang: str  # 글꼴용 — 한 칸에 두 언어가 섞여 나온다
    text: str
    ai_text: str
    change_type: str | None
    status: str
    source_note: str
    origin: str  # units | translation | new_doc — 프런트가 번역 기원의 깊이 단추만 숨긴다
    # 굵은 선 묶음 키(A와 같은 묶음) — "old:<옛 줄 키>" | "new:<새 문서 쪽 짝 키>" | None(출처가 은퇴한 번역)
    meaning_key: str | None
    # 섹션 번호(칸 번호 + 들여쓰기 깊이, 예: 6.1.2.1) — 표 칸은 표의 번호, 입구 2 문서·단계 없는 WI·생략·주석 줄은 None
    number: str | None
    indent_level: int  # 사람이 정한 깊이 그대로(번호는 눌러 읽은 깊이로 센다)
    # 번호 표시 numbered | omitted | note — 생략·주석은 number가 None, 주석은 글을 기울여 보인다. 표 칸은 표의 값이다
    number_style: str
    cell_row: int | None
    cell_col: int | None
    children: list["CItem"]  # 표 새 문장의 칸 새 문장(행·열 순)


class CSection(BaseModel):
    location_key: str  # SOP 칸 키 | step:<n>:<부분> | unstepped:<부분> | path:<절 경로>
    label: str
    number: str | None  # SOP 칸 번호(5.1)·WI 단계 번호(3), 번호가 없는 칸은 None
    na_reason: str | None
    items: list[CItem]


class CDoc(BaseModel):
    target_doc_id: int
    code: str
    title: str
    doc_type: str
    parent_code: str | None
    entrance: str
    sections: list[CSection]


class CDeleted(BaseModel):
    """삭제한 옛 줄(의미 묶음) 하나 — 표시 ID·원문은 구성 단위 값을 줄바꿈으로, 문서·절은 첫 단위, 이유는 묶음 Remark."""

    display_id: str
    doc_code: str
    section: str
    source_text: str
    reason: str


class CMoved(BaseModel):
    """다른 문서로 옮긴 옛 줄 하나 — 칸 모양은 CDeleted와 같다."""

    display_id: str
    doc_code: str
    section: str
    source_text: str
    move_target_code: str
    reason: str


class COutput(BaseModel):
    docs: list[CDoc]
    deleted: list[CDeleted]
    moved: list[CMoved]


class Summary(BaseModel):
    """요약 숫자 한 벌(설계 §5.3) — 옛 쪽은 줄로 센다."""

    old_rows: int
    assigned: int  # 처분이 미배정이 아닌 줄(삭제·이동 포함)
    no_destination: int  # 처분이 미배정인 줄 — 갈 곳 없는 보류·일부만 판단한 줄 포함, 진행 숫자의 Unassigned(상태 기준)와 다르다
    duplicate: int
    deleted: int
    moved: int
    new: int  # 출처 없는 입구 2 새 문장을 새 문서 쪽 짝으로 묶은 수
    translated: int  # 번역 줄·Translated · Added 줄이 든 A 묶음 수
    confirmed_rate: float
    single_language: int


# --- 공용 색인 ---


@dataclass(frozen=True)
class _Index:
    snap: BundleSnapshot
    old_units: list[UnitInfo]  # 옛 문서의 커버·표·행 단위, 정렬 키 순(표·행 단위는 자기 칸 문장 앞)
    cells: dict[int, list[UnitInfo]]  # 표·행 단위 → 묶인 칸 문장
    unit_targets: dict[int, list[TargetInfo]]  # 출처 단위 → 그 단위를 출처로 둔 새 문장
    doc_targets: dict[int, list[TargetInfo]]  # 새 문서 → 그 문서의 새 문장
    children: dict[int, list[TargetInfo]]  # 표 새 문장 → 칸 새 문장(행·열 순)
    translations: dict[int, list[TargetInfo]]  # 번역 출처 단위 → 그 단위의 번역 새 문장(두 언어 모두)
    unit_groups: dict[int, str]  # 관계 묶음 ID — GET groups와 같은 접기·같은 ID, 단 번역(translated) 새 문장의 연결은 뺀다
    target_groups: dict[int, str]
    doc_order: list[TargetDocInfo]  # SOP(순서) 다음 그 SOP의 WI들, 부모 없는 WI는 끝
    doc_rank: dict[int, int]
    # 단위 → 그 단위가 든 짝 구성원 중 가장 앞 order_key(짝 없으면 자기 order_key) — 칸 안에서 같은 의미의 문장끼리 붙인다
    meaning_anchor: dict[int, tuple[int, ...]]
    # (새 문서, 옛 단위) → 그 옛 단위를 출처로 둔 입구 2 새 문장의 자리(새 문서 단위 order_key) — 그 새 문장의 번역을 바로 뒤에 둔다
    new_doc_places: dict[tuple[int, int], tuple[int, ...]]


@dataclass(frozen=True)
class _SectionPlan:
    key: str
    label: str
    number: str | None  # 줄 번호의 머리 — 같은 번호의 칸(WI 한 단계의 Instruction·Why)은 줄 번호를 이어 센다
    na_reason: str | None
    targets: list[TargetInfo]  # 칸 새 문장이 아닌 새 문장(두 언어 모두), 칸 안 순서
    keep_empty: bool  # SOP 칸·선언 단계는 비어도 싣고, 단계 없음·절 경로 칸은 새 문장이 있을 때만


def _order_target_docs(snap: BundleSnapshot) -> list[TargetDocInfo]:
    def _key(doc: TargetDocInfo) -> tuple[int, int]:
        return doc.order_index, doc.id

    docs = sorted(snap.target_docs.values(), key=_key)
    children: dict[int, list[TargetDocInfo]] = defaultdict(list)
    for doc in docs:
        if doc.doc_type == "wi" and doc.parent_id is not None:
            children[doc.parent_id].append(doc)
    ordered: list[TargetDocInfo] = []
    for doc in docs:
        if doc.doc_type == "sop":
            ordered.append(doc)
            ordered.extend(children.get(doc.id, []))
    placed = {doc.id for doc in ordered}
    return ordered + [doc for doc in docs if doc.id not in placed]


def _build_index(snap: BundleSnapshot) -> _Index:
    old_doc_ids = {document.id for document in snap.documents.values() if document.side == "old"}
    old_units = sorted(
        (
            unit for unit in snap.units.values()
            if unit.document_id in old_doc_ids and unit.kind in (*COVER_KINDS, *TABLE_UNIT_KINDS)
        ),
        key=lambda unit: unit.order_key,
    )
    cells: dict[int, list[UnitInfo]] = defaultdict(list)
    for unit in old_units:
        if unit.group_unit_id is not None:
            cells[unit.group_unit_id].append(unit)
    unit_targets: dict[int, list[TargetInfo]] = defaultdict(list)
    doc_targets: dict[int, list[TargetInfo]] = defaultdict(list)
    children: dict[int, list[TargetInfo]] = defaultdict(list)
    translations: dict[int, list[TargetInfo]] = defaultdict(list)
    for target in sorted(snap.targets.values(), key=lambda target: target.id):
        doc_targets[target.target_doc_id].append(target)
        if target.parent_target_id is not None:
            children[target.parent_target_id].append(target)
        for unit_id in target.source_unit_ids:
            unit_targets[unit_id].append(target)
        if target.translation_source_unit_id is not None:
            translations[target.translation_source_unit_id].append(target)
    for cell_targets in children.values():
        cell_targets.sort(key=lambda target: (target.cell_row or 0, target.cell_col or 0, target.id))

    # 사람이 쓴 다른 언어 문장(translated)은 AI 번역처럼 번역 줄이라 관계 묶음(나눔·합침·중복 배정)에 넣지 않는다(설계 §4.1)
    edges = [
        (target.id, unit_id)
        for target in snap.targets.values() if target.change_type != TRANSLATED
        for unit_id in target.source_unit_ids
    ]
    group_unit_by_cell = {unit.id: unit.group_unit_id for unit in snap.units.values() if unit.group_unit_id is not None}
    parent_by_cell_target = {
        target.id: target.parent_target_id for target in snap.targets.values() if target.parent_target_id is not None
    }
    unit_groups, target_groups = build_group_ids(
        collapse_table_members(edges, group_unit_by_cell, parent_by_cell_target),
        {unit.id: unit.order_key for unit in snap.units.values()},
        {unit.id: unit.display_id for unit in snap.units.values()},
    )
    doc_order = _order_target_docs(snap)
    pair_starts: dict[int, tuple[int, ...]] = {}
    for unit in snap.units.values():
        pair_id = snap.pair_of.get(unit.id)
        if pair_id is not None and (pair_id not in pair_starts or unit.order_key < pair_starts[pair_id]):
            pair_starts[pair_id] = unit.order_key
    meaning_anchor = {
        unit.id: pair_starts[snap.pair_of[unit.id]] if unit.id in snap.pair_of else unit.order_key
        for unit in snap.units.values()
    }
    new_doc_places: dict[tuple[int, int], tuple[int, ...]] = {}
    for target in snap.targets.values():
        if target.origin == ORIGIN_NEW_DOC and target.new_unit_id in snap.units:
            place = snap.units[target.new_unit_id].order_key
            for unit_id in target.source_unit_ids:
                key = (target.target_doc_id, unit_id)
                if key not in new_doc_places or place < new_doc_places[key]:
                    new_doc_places[key] = place
    return _Index(
        snap=snap, old_units=old_units, cells=cells, unit_targets=unit_targets, doc_targets=doc_targets,
        children=children, translations=translations, unit_groups=unit_groups, target_groups=target_groups, doc_order=doc_order,
        doc_rank={doc.id: rank for rank, doc in enumerate(doc_order)}, meaning_anchor=meaning_anchor,
        new_doc_places=new_doc_places,
    )


def _get_decision_unit_id(unit: UnitInfo) -> int:
    """처분을 담는 단위 — 묶인 칸 문장은 그룹(표·행) 단위의 판단을 따른다."""
    return unit.group_unit_id if unit.group_unit_id is not None else unit.id


def _format_doc_code(document: DocumentInfo) -> str:
    """옛 문서 번호 — 비어 있으면 표시 ID와 같은 D{id}."""
    return document.doc_code or f"D{document.id}"


def _get_base_unit_id(index: _Index, target: TargetInfo) -> int | None:
    """새 문장이 기댄 옛 단위 — 번역은 번역 출처, 그 밖은 첫 출처. 출처가 없거나 번역 출처가 은퇴했고 출처도 없으면 None."""
    if target.translation_source_unit_id in index.snap.units:
        return target.translation_source_unit_id
    return target.source_unit_ids[0] if target.source_unit_ids else None


def _get_item_key(index: _Index, doc: TargetDocInfo, target: TargetInfo) -> tuple[object, ...]:
    """칸 안 순서 — 사람이 정한 문서는 order_index, 아니면 입구 2 새 문장은 새 문서의 자리, 나머지는 기댄 옛 단위의 의미 순(설계 §6).

    입구 2 새 문장의 자리는 새 문서 안의 실제 순서다(스펙 §6.7) — 짝지은 옛 단위 순서로 섞지 않는다. 그 밖은 같은 의미(짝)의
    문장끼리 붙이고, 그 안에서 영어 출처를 먼저, 번역(변경 종류 translated — AI 번역과 사람이 쓴 다른 언어 문장)은 출처 바로 뒤에 둔다.
    입구 2 새 문장의 번역은 그 새 문장 자리 바로 뒤다(옛 단위 정렬 키로 재면 새 문서의 모든 문장보다 앞에 선다).
    순서를 사람이 정한 적이 없는 문서의 계산 규칙이라 사람의 선택을 덮지 않는다.
    """
    if doc.manual_order:
        return (target.order_index, target.id)
    units = index.snap.units
    if target.origin == ORIGIN_NEW_DOC and target.new_unit_id in units:
        return (units[target.new_unit_id].order_key, 0, (), 0, target.id)
    base_id = _get_base_unit_id(index, target)
    if base_id is None:
        return ((2, target.order_index), 0, (), 0, target.id)
    place = index.new_doc_places.get((doc.id, base_id))
    if place is not None:
        return (place, 0, (), int(target.change_type == TRANSLATED), target.id)
    base = units[base_id]
    return (
        index.meaning_anchor[base_id], 0 if base.lang == "en" else 1, base.order_key,
        int(target.change_type == TRANSLATED), target.id,
    )


def _find_na_reason(doc: TargetDocInfo, slot_key: str) -> str | None:
    """N/A 사유 — 상위 칸이 N/A면 하위 칸도 그 사유로 N/A다(R8)."""
    if slot_key in doc.na_slots:
        return doc.na_slots[slot_key]
    parent = slot_key.split(".", 1)[0]
    return doc.na_slots.get(parent) if parent != slot_key else None


def _plan_sections(index: _Index, doc: TargetDocInfo, labels: OutputLabels) -> list[_SectionPlan]:
    """새 문서의 칸 — 입구 2 문서는 절 경로가 처음 나온 순서, SOP는 SLOT_KEYS 순서, WI는 단계마다 Instruction·Why."""
    tops = sorted(
        (target for target in index.doc_targets.get(doc.id, []) if target.parent_target_id is None),
        key=lambda target: _get_item_key(index, doc, target),
    )
    if doc.entrance == "match":
        by_path: dict[str, list[TargetInfo]] = {}
        for target in tops:
            by_path.setdefault(target.section_path, []).append(target)
        return [
            _SectionPlan(f"path:{path}", path or labels.no_section, None, None, targets, keep_empty=False)
            for path, targets in by_path.items()
        ]
    if doc.doc_type == "sop":
        by_slot: dict[str | None, list[TargetInfo]] = defaultdict(list)
        for target in tops:
            by_slot[target.slot_key].append(target)
        return [
            _SectionPlan(
                key, labels.slots[key], SLOT_NUMBERS[key], _find_na_reason(doc, key), by_slot.get(key, []),
                keep_empty=True,
            )
            for key in SLOT_KEYS
        ]
    by_place: dict[tuple[int | None, str | None], list[TargetInfo]] = defaultdict(list)
    for target in tops:
        by_place[(target.wi_step, target.wi_part)].append(target)
    declared = {step_no for step_no, _ in doc.steps}
    # 선언 단계와, 목록에서 빠진 단계를 가리키는 새 문장의 단계(조용히 빠지지 않게)
    steps = sorted(declared | {target.wi_step for target in tops if target.wi_step is not None})
    plans = [
        _SectionPlan(
            f"step:{step}:{part}", labels.wi_step_template.format(step=step, part=labels.wi_parts[part]), str(step),
            None, by_place.get((step, part), []), keep_empty=step in declared,
        )
        for step in steps
        for part in WI_PARTS
    ]
    plans += [
        _SectionPlan(
            f"unstepped:{part}", labels.wi_unstepped_template.format(part=labels.wi_parts[part]), None, None,
            by_place.get((None, part), []), keep_empty=False,
        )
        for part in WI_PARTS
    ]
    return plans


# --- 섹션 번호 ---


def _build_slot_numbers() -> dict[str, str]:
    """SOP 칸 번호 — SLOT_KEYS의 고정 자리(도메인 문서 §2의 S1…S7, 하위 칸은 5.1)라 칸을 N/A로 바꿔도 다른 칸 번호가 그대로다."""
    numbers: dict[str, str] = {}
    tops = 0
    children: Counter[str] = Counter()
    for key in SLOT_KEYS:
        parent, _, child = key.partition(".")
        if child:
            children[parent] += 1
            numbers[key] = f"{numbers[parent]}.{children[parent]}"
        else:
            tops += 1
            numbers[key] = str(tops)
    return numbers


SLOT_NUMBERS = _build_slot_numbers()


def number_lines(base: str, depths: Sequence[int | None]) -> list[str | None]:
    """칸 번호 base 아래 줄 번호 — 깊이 d 줄은 base 뒤에 d + 1 마디(5 → 5.1, 5.2, 5.2.1).

    깊이는 앞 번호 줄의 깊이 + 1을 넘지 못한다(첫 번호 줄은 0) — 넘으면 그만큼으로 눌러 읽는다. 저장한 깊이는 바꾸지 않으므로
    앞줄을 옮기거나 내어 쓰면 눌렸던 줄이 사람이 정한 깊이로 돌아온다. 깊이가 None인 줄(번호 생략·주석)은 번호가 None이고
    세지도 않는다 — 다음 번호 줄이 그 앞 번호 줄에 이어 센다(5.1, 생략, 5.2).
    """
    counters: list[int] = []  # 깊이별 지금 번호 — 길이가 앞 번호 줄의 눌러 읽은 깊이 + 1이다
    numbers: list[str | None] = []
    for depth in depths:
        if depth is None:
            numbers.append(None)
            continue
        level = max(0, min(depth, len(counters)))
        del counters[level + 1:]
        if len(counters) == level:
            counters.append(0)
        counters[level] += 1
        numbers.append(".".join([base, *map(str, counters)]))
    return numbers


def number_targets(index: _Index, labels: OutputLabels) -> dict[int, str]:
    """새 문장 → 섹션 번호(설계 §6 세는 법). 한 칸(WI는 같은 단계의 Instruction·Why를 이어)의 칸 새 문장이 아닌 새 문장 전부를
    언어를 가리지 않고 결과물 C 순서대로 한 줄로 센다.

    번호 생략·주석 줄은 번호가 없고 세지 않는다. 표 칸 새 문장은 표의 번호를 따른다(표가 번호가 없으면 칸도 없다).
    입구 2 문서·단계 없는 WI 칸은 번호가 없다.
    """
    numbers: dict[int, str] = {}
    for doc in index.doc_order:
        runs: dict[str, list[TargetInfo]] = {}
        for plan in _plan_sections(index, doc, labels):
            if plan.number is not None:
                runs.setdefault(plan.number, []).extend(plan.targets)
        for base, targets in runs.items():
            depths = [target.indent_level if target.number_style == NUMBERED else None for target in targets]
            for target, number in zip(targets, number_lines(base, depths), strict=True):
                if number is None:
                    continue
                numbers[target.id] = number
                for child in index.children.get(target.id, []):
                    numbers[child.id] = number
    return numbers


def _group_dests(index: _Index, unit: UnitInfo) -> list[tuple[TargetDocInfo, list[TargetInfo], bool]]:
    """단위의 보낸 곳 — 새 문서마다 (문서, 그 문서의 새 문장, 자기 새 문장인가), 결과물 C 문서 순서.

    칸 새 문장이 없는 묶인 칸 문장(표 구성 변경으로 빠진 칸)은 표의 보낸 곳을 따르되 글이 없다(False).
    """
    targets, is_own = index.unit_targets.get(unit.id, []), True
    if not targets and unit.group_unit_id is not None:
        targets, is_own = index.unit_targets.get(unit.group_unit_id, []), False
    by_doc: dict[int, list[TargetInfo]] = defaultdict(list)
    for target in targets:
        by_doc[target.target_doc_id].append(target)
    groups = []
    for doc_id in sorted(by_doc, key=index.doc_rank.__getitem__):
        doc = index.snap.target_docs[doc_id]
        groups.append((doc, sorted(by_doc[doc_id], key=lambda target: _get_item_key(index, doc, target)), is_own))
    return groups


def _list_new_targets(index: _Index, labels: OutputLabels) -> list[TargetInfo]:
    """입구 2의 신규 — 출처 없는 new_doc 새 문장(두 언어와 그림), 새 문서 순서와 결과물 C 칸 순서.

    표 새 문장은 글이 없고 칸 새 문장이 따로 나오므로 뺀다.
    """
    found = []
    for doc in index.doc_order:
        for plan in _plan_sections(index, doc, labels):
            for top in plan.targets:
                for target in (top, *index.children.get(top.id, [])):
                    if target.origin == ORIGIN_NEW_DOC and not target.source_unit_ids and target.kind != "table":
                        found.append(target)
    return found


def _list_row_units(index: _Index, meaning: MeaningRow) -> list[UnitInfo]:
    """줄의 단위 — 구성 판단 단위(원문 순), 그 뒤에 표·행 단위에 묶인 칸 문장."""
    units = [index.snap.units[unit_id] for unit_id in meaning.unit_ids]
    return units + [cell for unit_id in meaning.unit_ids for cell in index.cells.get(unit_id, [])]


def _get_row_disposition(snap: BundleSnapshot, meaning: MeaningRow) -> str:
    """줄의 처분 — 구성 판단 단위의 처분이 모두 같으면 그 값, 아니면 미배정(일부만 판단한 줄은 갈 곳 없음, 설계 §5.3)."""
    dispositions = {snap.decisions[unit_id].disposition for unit_id in meaning.unit_ids}
    return dispositions.pop() if len(dispositions) == 1 else "unassigned"


def _list_row_dest_doc_ids(index: _Index, meaning: MeaningRow) -> list[int]:
    """줄이 보낸 새 문서 — 구성 단위(칸 포함) 보낸 곳의 합집합, 결과물 C 문서 순."""
    doc_ids = {doc.id for unit in _list_row_units(index, meaning) for doc, _, _ in _group_dests(index, unit)}
    return sorted(doc_ids, key=index.doc_rank.__getitem__)


def _is_duplicate_row(index: _Index, meaning: MeaningRow) -> bool:
    """중복 배정 줄 — 구성 단위(칸 포함) 중 하나라도 새 문장이 서로 다른 새 문서 둘 이상에 있다(스펙 §6.9)."""
    return any(len(_group_dests(index, unit)) >= 2 for unit in _list_row_units(index, meaning))


# --- A ---


def _number_lines(texts: list[str]) -> str:
    """여러 새 문장을 한 칸에 — "① …\\n② …". 하나면 그대로, 모두 비면 빈 글."""
    if len(texts) == 1:
        return texts[0]
    if not any(texts):
        return ""
    marks = [CIRCLED_NUMBERS[n] if n < len(CIRCLED_NUMBERS) else f"({n + 1})" for n in range(len(texts))]
    return "\n".join(f"{mark} {text}" for mark, text in zip(marks, texts, strict=True))


def _format_target_location(target: TargetInfo, labels: OutputLabels) -> str:
    """새 문서 안 위치 — SOP 칸, WI 단계·부분, 입구 2 문서는 새 문서의 실제 절 경로."""
    if target.slot_key is not None:
        return labels.slots.get(target.slot_key, target.slot_key)
    if target.wi_part is not None:
        part = labels.wi_parts[target.wi_part]
        if target.wi_step is None:
            return labels.wi_unstepped_template.format(part=part)
        return labels.wi_step_template.format(step=target.wi_step, part=part)
    return target.section_path


def _format_place(index: _Index, unit: UnitInfo, labels: OutputLabels) -> str:
    block = index.snap.blocks[unit.block_id]
    pieces = [labels.parts[block.part]] if block.part in labels.parts else []
    if unit.kind in TABLE_UNIT_KINDS:
        table_no = index.snap.tables[unit.table_id].table_index + 1  # 표·행 단위는 늘 원문 표를 가리킨다
        if unit.kind == "table":
            pieces.append(labels.table_template.format(table=table_no))
        else:
            pieces.append(labels.table_row_template.format(table=table_no, row=(unit.row_index or 0) + 1))
        return " · ".join(pieces)
    if block.table_index is not None and block.row_index is not None and block.col_index is not None:
        pieces.append(
            labels.cell_template.format(table=block.table_index + 1, row=block.row_index + 1, col=block.col_index + 1)
        )
    if block.kind == "figure":
        pieces.append(labels.figure)
    return " · ".join(pieces or [labels.paragraph])


def _format_source_text(index: _Index, unit: UnitInfo, labels: OutputLabels) -> str:
    """원문 칸 — 표·행 단위는 "[표 n, 행×열]"(행 단위는 그 행 하나), 나머지는 단위 글자 그대로."""
    if unit.kind not in TABLE_UNIT_KINDS:
        return unit.text
    table = index.snap.tables[unit.table_id]
    rows = 1 if unit.kind == "table_row" else table.n_rows
    return labels.table_source_template.format(table=table.table_index + 1, rows=rows, cols=table.n_cols)


@dataclass(frozen=True)
class _Dest:
    kind: str
    doc_code: str
    doc_title: str
    location: str
    number: str
    is_note: bool
    confirmed_text: str
    ai_text: str
    change_type: str
    warnings: list[dict[str, str]]


def _get_number_style(index: _Index, target: TargetInfo) -> str:
    """새 문장의 번호 표시 — 표 칸 새 문장은 표의 값을 따른다(번호도 표의 것이다)."""
    parent = index.snap.targets.get(target.parent_target_id) if target.parent_target_id is not None else None
    return (parent or target).number_style


def _is_note(index: _Index, target: TargetInfo) -> bool:
    return _get_number_style(index, target) == NUMBER_NOTE


def _locate_unit(index: _Index, unit: UnitInfo, labels: OutputLabels) -> LocationOut:
    block = index.snap.blocks[unit.block_id]
    return LocationOut(
        section=block.section_label, place=_format_place(index, unit, labels), page=block.page,
        page_basis=block.page_basis,
    )


def _format_locations(targets: list[TargetInfo], labels: OutputLabels) -> str:
    """새 문장들의 새 문서 안 위치 — 모두 같으면 하나, 다르면 확정 문장 칸과 같은 ①② 순서로."""
    locations = [_format_target_location(target, labels) for target in targets]
    return locations[0] if len(set(locations)) == 1 else _number_lines(locations)


def _describe_dest(
    index: _Index, doc: TargetDocInfo, targets: list[TargetInfo], is_own: bool, labels: OutputLabels,
    number_of: NumberOf,
) -> _Dest:
    if is_own:
        # 사람이 쓴 다른 언어 문장(변경 종류 translated)은 같은 묶음의 번역 줄로 뺀다 — 단위 줄의 ①②는 자기 언어(중립)·합침 새 문장만
        shown = [target for target in targets if target.change_type != TRANSLATED]
        if not shown:
            # 이 새 문서에는 번역 새 문장만 있다 — 보낸 곳(종류·문서·자리)만 적고 글·번호·변경 종류는 번역 줄에 맡긴다
            return _Dest(doc.doc_type, doc.code, doc.title, _format_locations(targets, labels), "", False, "", "", "", [])
        targets = shown
    location = _format_locations(targets, labels)
    # 번호는 새 문장마다 다르므로 여러 새 문장이면 확정 문장 칸과 같은 ①② 순서로 적는다
    number = _number_lines([number_of(target) for target in targets])
    if not is_own:
        return _Dest(doc.doc_type, doc.code, doc.title, location, number, False, "", "", targets[0].change_type or "", [])
    change_types = {target.change_type or "" for target in targets}
    # 한 새 문서 안에서 여러 새 문장으로 간 것은 나눔이다(스펙 §6.9) — 합침과 섞이면 나눔으로 적는다
    change_type = change_types.pop() if len(change_types) == 1 else "split"
    return _Dest(
        doc.doc_type, doc.code, doc.title, location, number, all(_is_note(index, target) for target in targets),
        _number_lines([target.confirmed_text for target in targets]),
        _number_lines([target.ai_text for target in targets]),
        change_type, [warning for target in targets for warning in target.warnings],
    )


def format_confirmer(login_id: str | None, people: Mapping[str, str]) -> str | None:
    """확정한 사람 — 디렉터리 이름이 있으면 "이름 (ID)", 없거나 퇴직이면 ID만(설계 §4.5)."""
    if login_id is None:
        return None
    name = people.get(login_id)
    return f"{name} ({login_id})" if name else login_id


def _join_remarks(texts: Iterable[str]) -> str:
    """비지 않은 글을 겹치지 않게 처음 나온 순서로 줄바꿈해 잇는다."""
    return "\n".join(dict.fromkeys(text for text in texts if text))


@dataclass(frozen=True)
class _AContext:
    """결과물 A 한 번 계산의 재료 — 줄 짓는 함수들이 함께 쓴다."""

    index: _Index
    labels: OutputLabels
    number_of: NumberOf
    people: Mapping[str, str]
    # 옛 단위 → 그 단위 줄 바로 뒤의 번역 새 문장: AI 번역(번역 출처)과 출처가 그 단위 하나인 사람이 쓴 다른 언어 문장, id 순
    translations: dict[int, list[TargetInfo]]
    # 옛 단위 → 그 줄 뒤의 Translated · Added 새 문장(입구 2 한쪽만 맞춘 짝의 출처 없는 쪽)
    added: dict[int, list[TargetInfo]]


@dataclass(frozen=True)
class _GroupSlot:
    """의미 묶음 하나가 함께 쓰는 값."""

    row_no: int
    remark: str


_NO_LOCATION = LocationOut(section="", place="", page=None, page_basis="")


def _build_unit_rows(
    ctx: _AContext, unit: UnitInfo, row_kind: Literal["unit", "table", "cell"], slot: _GroupSlot
) -> list[ARow]:
    """옛 단위 하나의 줄 — 보낸 새 문서마다 한 줄(중복 배정), 없으면 삭제·이동·미배정 한 줄."""
    index = ctx.index
    snap = index.snap
    decision_unit_id = _get_decision_unit_id(unit)
    decision = snap.decisions[decision_unit_id]
    document = snap.documents[unit.document_id]
    dests = [
        _describe_dest(index, doc, targets, is_own, ctx.labels, ctx.number_of)
        for doc, targets, is_own in _group_dests(index, unit)
    ]
    if not dests:
        dest_kind = DISPOSITION_NODES.get(decision.disposition, "")
        dests = [
            _Dest(
                dest_kind, decision.move_target_code if dest_kind == "move_external" else "", "", "", "", False, "", "",
                "deleted" if dest_kind == "delete" else "", [],
            )
        ]
    return [
        ARow(
            row_no=slot.row_no, is_group_start=False, row_kind=row_kind, old_doc_code=_format_doc_code(document),
            old_doc_version=document.doc_version, location=_locate_unit(index, unit, ctx.labels),
            unit_id=unit.id, display_id=unit.display_id, source_text=_format_source_text(index, unit, ctx.labels),
            dest_kind=dest.kind, dest_doc_code=dest.doc_code, dest_doc_title=dest.doc_title,
            dest_location=dest.location, dest_number=dest.number, dest_is_note=dest.is_note,
            confirmed_text=dest.confirmed_text, ai_text=dest.ai_text, change_type=dest.change_type, remark=slot.remark,
            status=get_cover_status(unit, snap.decisions), confirmed_by=format_confirmer(decision.confirmed_by, ctx.people),
            confirmed_at=decision.confirmed_at, group_id=index.unit_groups.get(decision_unit_id), warnings=dest.warnings,
        )
        for dest in dests
    ]


def _build_target_row(
    ctx: _AContext, target: TargetInfo, row_kind: Literal["translation", "new"], source_id: int | None,
    change_type: str, slot: _GroupSlot,
) -> ARow:
    """새 문장 하나가 한 줄인 번역·신규 줄 — 옛 문장 칸은 비고, 번역 줄이면 위치·표시 ID는 출처 단위(source_id)의 것이다.

    출처가 은퇴한 번역(보류)은 출처 id만 남고 위치·표시 ID가 빈다.
    """
    index = ctx.index
    doc = index.snap.target_docs[target.target_doc_id]
    unit = index.snap.units.get(source_id) if source_id is not None else None
    document = index.snap.documents[unit.document_id] if unit else None
    return ARow(
        row_no=slot.row_no, is_group_start=False, row_kind=row_kind,
        old_doc_code=_format_doc_code(document) if document else "",
        old_doc_version=document.doc_version if document else "",
        location=_locate_unit(index, unit, ctx.labels) if unit else _NO_LOCATION, unit_id=source_id,
        display_id=unit.display_id if unit else "", source_text="",
        dest_kind=doc.doc_type, dest_doc_code=doc.code, dest_doc_title=doc.title,
        dest_location=_format_target_location(target, ctx.labels), dest_number=ctx.number_of(target),
        dest_is_note=_is_note(index, target), confirmed_text=target.confirmed_text, ai_text=target.ai_text,
        change_type=change_type, remark=slot.remark, status=target.status,
        confirmed_by=format_confirmer(target.confirmed_by, ctx.people), confirmed_at=target.confirmed_at,
        group_id=index.target_groups.get(target.parent_target_id or target.id), warnings=list(target.warnings),
    )


def _build_after_rows(ctx: _AContext, unit: UnitInfo, slot: _GroupSlot) -> list[ARow]:
    """단위 줄 바로 뒤 — 그 단위의 번역 줄(AI 번역·사람이 쓴 다른 언어 문장), 그다음 Translated · Added 줄."""
    rows = [
        _build_target_row(ctx, target, "translation", unit.id, target.change_type or "", slot)
        for target in ctx.translations.get(unit.id, [])
    ]
    return rows + [
        _build_target_row(ctx, target, "new", None, TRANSLATED_ADDED, slot) for target in ctx.added.get(unit.id, [])
    ]


def _build_old_remark(index: _Index, added: Mapping[int, list[TargetInfo]], meaning: MeaningRow) -> str:
    """옛 묶음의 Remark(설계 §4.4) — 판단 이유, 출처 있는 새 문장의 remark, Translated · Added 새 문장(added)의 remark 순.

    출처 있는 새 문장은 구성 단위(칸 포함)를 출처로 둔 것이다. Translated · Added 새 문장은 출처가 없어 신규 묶음 대신
    이 묶음에 들므로 그 remark도 여기서 보인다. 결과물 C의 삭제·이동 줄 이유도 이 값이다.
    """
    units = _list_row_units(index, meaning)
    reasons = [index.snap.decisions[unit_id].reason for unit_id in meaning.unit_ids]
    sourced = [target.remark for unit in units for target in index.unit_targets.get(unit.id, [])]
    added_remarks = [target.remark for unit in units for target in added.get(unit.id, [])]
    return _join_remarks([*reasons, *sourced, *added_remarks])


def _build_old_group(ctx: _AContext, meaning: MeaningRow, row_no: int) -> list[ARow]:
    """옛 문서 의미 묶음 — 구성 단위마다 단위 줄(표·행 단위는 표 줄 뒤에 칸 문장 줄), 각 줄 바로 뒤에 그 단위의 번역 줄."""
    slot = _GroupSlot(row_no, _build_old_remark(ctx.index, ctx.added, meaning))
    rows: list[ARow] = []
    for unit_id in meaning.unit_ids:
        unit = ctx.index.snap.units[unit_id]
        if unit.kind in TABLE_UNIT_KINDS:
            rows += _build_unit_rows(ctx, unit, "table", slot) + _build_after_rows(ctx, unit, slot)
            for cell in ctx.index.cells.get(unit_id, []):
                rows += _build_unit_rows(ctx, cell, "cell", slot) + _build_after_rows(ctx, cell, slot)
        else:
            rows += _build_unit_rows(ctx, unit, "unit", slot) + _build_after_rows(ctx, unit, slot)
    return rows


def _index_translations(snap: BundleSnapshot) -> dict[int, list[TargetInfo]]:
    """옛 단위 → 번역 줄로 나올 새 문장 — AI 번역은 번역 출처, 사람이 쓴 다른 언어 문장(translated)은 하나뿐인 출처 단위."""
    translations: dict[int, list[TargetInfo]] = defaultdict(list)
    for target in sorted(snap.targets.values(), key=lambda target: target.id):
        if target.translation_source_unit_id is not None:
            translations[target.translation_source_unit_id].append(target)
        elif target.change_type == TRANSLATED and len(target.source_unit_ids) == 1:
            translations[target.source_unit_ids[0]].append(target)
    return translations


def _split_new_targets(
    snap: BundleSnapshot, new_targets: list[TargetInfo]
) -> tuple[dict[int, list[TargetInfo]], dict[int, list[TargetInfo]]]:
    """입구 2 출처 없는 새 문장을 (옛 단위 → Translated · Added, 새 문서 쪽 짝 키 → 신규 묶음)으로 가른다(설계 §4.5·§7.2).

    새 문서 짝(get_new_meaning_key)에 출처 있는 새 문장이 있으면 한쪽만 맞춘 짝이다 — 출처 없는 쪽은 맞춘 쪽 출처 중 원문에서
    가장 앞선 옛 단위 줄 뒤에 둔다. 나머지는 짝 키마다 한 신규 묶음(새 문서 순·C 칸 순).
    """
    anchors: dict[int, UnitInfo] = {}
    for target in snap.targets.values():
        if target.origin == ORIGIN_NEW_DOC and target.source_unit_ids:
            key = get_new_meaning_key(snap, target)
            first = min((snap.units[unit_id] for unit_id in target.source_unit_ids), key=lambda unit: unit.order_key)
            if key not in anchors or first.order_key < anchors[key].order_key:
                anchors[key] = first
    added: dict[int, list[TargetInfo]] = defaultdict(list)
    groups: dict[int, list[TargetInfo]] = {}
    for target in new_targets:
        key = get_new_meaning_key(snap, target)
        if key in anchors:
            added[anchors[key].id].append(target)
        else:
            groups.setdefault(key, []).append(target)
    return added, groups


def _build_a_groups(index: _Index, labels: OutputLabels, people: Mapping[str, str]) -> list[list[ARow]]:
    """결과물 A의 묶음 — 의미 묶음 순서(output_rows)의 옛 문서 줄, 그 뒤 고아 번역, 끝에 입구 2 신규 묶음. 요약의 번역 숫자도 이것을 센다."""
    snap = index.snap
    numbers = number_targets(index, labels)

    def get_number(target: TargetInfo) -> str:
        return numbers.get(target.id, "")

    added, new_groups = _split_new_targets(snap, _list_new_targets(index, labels))
    ctx = _AContext(index, labels, get_number, people, _index_translations(snap), added)
    groups: list[list[ARow]] = []
    placed: set[int] = set()
    for meaning in build_meaning_rows(snap):
        groups.append(_build_old_group(ctx, meaning, len(groups) + 1))
        placed.update(meaning.unit_ids)
        placed.update(cell.id for unit_id in meaning.unit_ids for cell in index.cells.get(unit_id, []))
    # 출처 단위가 쪼개기 편집으로 은퇴한 번역(보류) — 줄 자리가 없어도 사람이 볼 수 있게 한 줄짜리 묶음으로 둔다
    for unit_id in sorted(ctx.translations.keys() - placed):
        for target in ctx.translations[unit_id]:
            slot = _GroupSlot(len(groups) + 1, "")
            groups.append([_build_target_row(ctx, target, "translation", unit_id, target.change_type or "", slot)])
    for targets in new_groups.values():
        slot = _GroupSlot(len(groups) + 1, _join_remarks(target.remark for target in targets))
        groups.append([_build_target_row(ctx, target, "new", None, target.change_type or "", slot) for target in targets])
    for group in groups:
        group[0].is_group_start = True
    return groups


def build_output_a(snap: BundleSnapshot, lang: Lang, people: Mapping[str, str]) -> list[ARow]:
    """결과물 A 한 벌(설계 §4.1) — lang은 위치 표기·변경 종류 같은 라벨 언어만, people(로그인 ID → 이름)은 확정한 사람 표시용."""
    return [row for group in _build_a_groups(_build_index(snap), LABELS[lang], people) for row in group]


# --- B ---


def build_output_b(snap: BundleSnapshot, lang: Lang) -> FlowGraph:
    """결과물 B 한 벌(설계 §5.1) — 옛 문서(줄 수) → 새 문서·삭제·이동·미배정, 줄마다 보낸 새 문서 집합에 한 번씩(나눔은 한 번,
    중복 배정은 보낸 곳마다 한 번), 보낸 곳이 없으면 줄의 처분 노드 하나. lang은 노드 라벨 언어만 고른다.

    짝의 두 단위가 서로 다른 옛 문서에 있으면(드묾) 줄의 첫 단위 문서로 센다.
    """
    labels = LABELS[lang]
    index = _build_index(snap)
    old_counts: Counter[int] = Counter()
    edge_counts: Counter[tuple[int, str]] = Counter()
    for meaning in build_meaning_rows(snap):
        document_id = snap.units[meaning.unit_ids[0]].document_id
        old_counts[document_id] += 1
        dests = [f"target:{doc_id}" for doc_id in _list_row_dest_doc_ids(index, meaning)]
        if not dests:
            dests = [DISPOSITION_NODES.get(_get_row_disposition(snap, meaning), "unassigned")]
        for dest in dests:
            edge_counts[(document_id, dest)] += 1
    dest_counts: Counter[str] = Counter()
    for (_, dest), count in edge_counts.items():
        dest_counts[dest] += count

    old_docs = sorted(
        (document for document in snap.documents.values() if document.side == "old"), key=lambda document: document.order
    )
    nodes = [
        FlowNode(id=f"old:{document.id}", kind="old", label=_format_doc_code(document), title=document.title,
                 count=old_counts[document.id])
        for document in old_docs
    ]
    nodes += [
        FlowNode(id=f"target:{doc.id}", kind=doc.doc_type, label=doc.code, title=doc.title,
                 count=dest_counts[f"target:{doc.id}"])
        for doc in index.doc_order
    ]
    tail_labels = {**{kind: labels.dest_kinds[kind] for kind in DISPOSITION_NODES}, "unassigned": labels.unassigned}
    nodes += [FlowNode(id=kind, kind=kind, label=tail_labels[kind], title="", count=dest_counts[kind]) for kind in TAIL_NODES]
    rank = {node.id: position for position, node in enumerate(nodes)}
    edges = [
        FlowEdge(source=f"old:{document_id}", target=dest, count=count)
        for (document_id, dest), count in sorted(
            edge_counts.items(), key=lambda item: (rank[f"old:{item[0][0]}"], rank[item[0][1]])
        )
    ]
    return FlowGraph(nodes=[node for node in nodes if node.count], edges=edges)


# --- C ---


def _format_source_note(index: _Index, target: TargetInfo, labels: OutputLabels) -> str:
    """받은 옛 단위 — "← OLD-1 §5.1, OLD-2 §5.1 (합침)". 같은 문서·절은 한 번, 절이 없으면 문서 번호만. 번역은 번역 출처 단위."""
    snap = index.snap
    unit_ids = target.source_unit_ids
    if target.translation_source_unit_id in snap.units:
        unit_ids = (target.translation_source_unit_id,)
    if not unit_ids:
        return ""
    refs = []
    for unit_id in unit_ids:
        unit = snap.units[unit_id]
        code = _format_doc_code(snap.documents[unit.document_id])
        section = snap.blocks[unit.block_id].section_label
        refs.append(f"{code} §{section}" if section else code)
    note = "← " + ", ".join(dict.fromkeys(refs))
    suffix = {"merged": labels.merged, "split": labels.split, "translated": labels.translated}.get(target.change_type or "")
    return f"{note} {suffix}" if suffix else note


@dataclass(frozen=True)
class _CContext:
    """결과물 C 한 번 계산의 재료."""

    index: _Index
    labels: OutputLabels
    numbers: dict[int, str]
    # Translated · Added 새 문장 → A에서 그 줄이 드는 옛 단위(맞춘 쪽 출처 중 원문에서 가장 앞)
    added_anchor: dict[int, int]


def _format_meaning_key(ctx: _CContext, target: TargetInfo) -> str | None:
    """굵은 선 묶음 키 — A와 같은 묶음: 기댄 옛 단위의 줄(old:), 출처 없는 입구 2 새 문장은 새 문서 쪽 짝(new:), 고아 번역은 None.

    Translated · Added 새 문장은 A처럼 맞춘 옛 줄의 묶음이다. 칸 문장 출처는 표·행 단위의 줄을 따른다.
    """
    snap = ctx.index.snap
    unit_id = ctx.added_anchor.get(target.id)
    if unit_id is None:
        unit_id = _get_base_unit_id(ctx.index, target)
    if unit_id is not None:
        return f"old:{get_meaning_key(snap, _get_decision_unit_id(snap.units[unit_id]))}"
    if target.origin == ORIGIN_NEW_DOC and target.new_unit_id is not None:
        return f"new:{get_new_meaning_key(snap, target)}"
    return None


def _build_item(ctx: _CContext, target: TargetInfo) -> CItem:
    index = ctx.index
    return CItem(
        target_id=target.id, kind=target.kind, lang=target.lang, text=target.confirmed_text, ai_text=target.ai_text,
        change_type=target.change_type, status=target.status, source_note=_format_source_note(index, target, ctx.labels),
        origin=target.origin, meaning_key=_format_meaning_key(ctx, target),
        number=ctx.numbers.get(target.id), indent_level=target.indent_level,
        number_style=_get_number_style(index, target), cell_row=target.cell_row,
        cell_col=target.cell_col,
        children=[_build_item(ctx, child) for child in index.children.get(target.id, [])],
    )


def _describe_disposed_row(index: _Index, meaning: MeaningRow, labels: OutputLabels, remark: str) -> dict[str, str]:
    """삭제·이동 줄 칸 — 표시 ID·원문은 구성 단위 값을 줄바꿈으로, 문서 번호·절은 첫 단위, 이유는 묶음 Remark."""
    snap = index.snap
    units = [snap.units[unit_id] for unit_id in meaning.unit_ids]
    return {
        "display_id": "\n".join(unit.display_id for unit in units),
        "doc_code": _format_doc_code(snap.documents[units[0].document_id]),
        "section": snap.blocks[units[0].block_id].section_label,
        "source_text": "\n".join(_format_source_text(index, unit, labels) for unit in units),
        "reason": remark,
    }


def build_output_c(snap: BundleSnapshot, lang: Lang) -> COutput:
    """결과물 C 한 벌(설계 §5.2) — 새 문서마다 칸별로 받은 새 문장(두 언어와 중립이 한 목록, C 순서), 끝에 삭제·다른 문서로 이동(줄마다 한 번).

    lang은 칸 이름·출처 표기 같은 라벨 언어만 고른다.
    """
    labels = LABELS[lang]
    index = _build_index(snap)
    added, _ = _split_new_targets(snap, _list_new_targets(index, labels))
    ctx = _CContext(
        index, labels, number_targets(index, labels),
        {target.id: unit_id for unit_id, targets in added.items() for target in targets},
    )
    docs = []
    for doc in index.doc_order:
        sections = []
        for plan in _plan_sections(index, doc, labels):
            items = [_build_item(ctx, target) for target in plan.targets]
            if items or plan.keep_empty:
                sections.append(
                    CSection(
                        location_key=plan.key, label=plan.label, number=plan.number, na_reason=plan.na_reason,
                        items=items,
                    )
                )
        parent = snap.target_docs.get(doc.parent_id) if doc.parent_id is not None else None
        docs.append(
            CDoc(
                target_doc_id=doc.id, code=doc.code, title=doc.title, doc_type=doc.doc_type,
                parent_code=parent.code if parent is not None else None, entrance=doc.entrance, sections=sections,
            )
        )
    deleted: list[CDeleted] = []
    moved: list[CMoved] = []
    for meaning in build_meaning_rows(snap):
        disposition = _get_row_disposition(snap, meaning)
        if disposition not in DISPOSITION_NODES:
            continue
        # 삭제·이동은 새 문장이 없어(저장 검사) Translated · Added도 없지만, Remark는 A 묶음과 같은 함수로 짓는다
        fields = _describe_disposed_row(index, meaning, labels, _build_old_remark(index, added, meaning))
        if disposition == "delete":
            deleted.append(CDeleted(**fields))
        else:
            move_target_code = snap.decisions[meaning.unit_ids[0]].move_target_code
            moved.append(CMoved(**fields, move_target_code=move_target_code))
    return COutput(docs=docs, deleted=deleted, moved=moved)


# --- 요약 ---


def build_summary(snap: BundleSnapshot) -> Summary:
    """요약 숫자 한 벌(설계 §5.3) — 줄은 진행 숫자와 같은 의미 묶음, 줄의 처분은 구성 단위가 모두 같을 때 그 값(아니면 미배정).

    확정률은 줄 상태 기준(소수 넷째 자리, 줄이 없으면 0). 번역은 결과물 A 묶음 짓기를 그대로 센다.
    """
    index = _build_index(snap)
    rows = build_meaning_rows(snap)
    dispositions = Counter(_get_row_disposition(snap, meaning) for meaning in rows)
    confirmed = sum(meaning.status == "confirmed" for meaning in rows)
    labels = LABELS["en"]  # 숫자만 세므로 라벨 언어는 결과에 닿지 않는다
    groups = _build_a_groups(index, labels, {})
    return Summary(
        old_rows=len(rows),
        assigned=len(rows) - dispositions["unassigned"],
        no_destination=dispositions["unassigned"],
        duplicate=sum(_is_duplicate_row(index, meaning) for meaning in rows),
        deleted=dispositions["delete"],
        moved=dispositions["move_external"],
        # 새 문서 쪽 짝 하나가 한 신규 — Translated · Added(맞춘 짝의 출처 없는 쪽)도 여기 든다
        new=len({get_new_meaning_key(snap, target) for target in _list_new_targets(index, labels)}),
        translated=sum(
            any(row.row_kind == "translation" or row.change_type == TRANSLATED_ADDED for row in group) for group in groups
        ),
        confirmed_rate=round(confirmed / len(rows), 4) if rows else 0.0,
        single_language=count_single_language(snap),
    )


# --- 검토 요청 조건 재료 ---


@dataclass(frozen=True)
class ReviewFacts:
    row_status_counts: Counter[str]  # 줄 상태 → 줄 수 (진행 숫자와 같은 규칙 — 짝 하나·짝 없는 단위 하나가 한 줄)
    duplicate_unit_ids: list[int]  # 서로 다른 새 문서 둘 이상으로 간 판단 단위(칸 문장은 표·행 단위로 접는다), id 순


def build_review_facts(snap: BundleSnapshot) -> ReviewFacts:
    """검토 요청 조건이 읽는 단위 사실 — 요약·결과물과 같은 옛 단위 집합(_build_index)과 같은 보낸 곳 규칙(_group_dests)."""
    index = _build_index(snap)
    counts = Counter(row.status for row in build_meaning_rows(snap))
    duplicates = {_get_decision_unit_id(unit) for unit in index.old_units if len(_group_dests(index, unit)) >= 2}
    return ReviewFacts(row_status_counts=counts, duplicate_unit_ids=sorted(duplicates))
