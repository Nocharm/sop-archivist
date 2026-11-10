"""결과물 A(문장 비교표)·B(맵핑 흐름)·C(새 문서 기준 묶음)와 언어별 요약 숫자, 검토 요청 조건의 단위 재료 — 스냅숏만 받는 순수 함수 (스펙 §7.13·§7.15).

세 결과물은 같은 재료(옛 단위·보낸 곳·새 문장)를 다른 방향에서 본다. 그래서 단위의 보낸 곳(_group_dests)·칸 순서(_plan_sections)·
신규 새 문장(_list_new_targets)을 한 벌만 두고 A·B·C·요약이 함께 쓴다. 번역 새 문장은 출처 연결이 없어 단위의 보낸 곳·관계 묶음에
끼지 않고, A의 번역 줄과 C의 칸 항목, 요약의 번역 숫자로만 나온다.
"""

from collections import Counter, defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from app.routers.admin import KstDatetime
from app.sop.constants import COVER_KINDS, NUMBER_NOTE, NUMBERED, SLOT_KEYS, WI_PARTS
from app.sop.groups import TABLE_UNIT_KINDS, build_group_ids, collapse_table_members
from app.sop.output_labels import LABELS, OutputLabels
from app.sop.snapshot import (
    NEUTRAL,
    PROGRESS_LANGS,
    BundleSnapshot,
    DocumentInfo,
    TargetDocInfo,
    TargetInfo,
    UnitInfo,
)
from app.sop.status import get_cover_status

Lang = Literal["ko", "en"]
NumberOf = Callable[[TargetInfo], str]  # 새 문장 → 그 판의 섹션 번호(없으면 빈 글)
ORIGIN_NEW_DOC = "new_doc"
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
    """결과물 A 한 줄 — 옛 단위 한 줄(중복 배정은 보낸 곳마다), 표 줄, 번역 줄, 입구 2 신규 줄."""

    row_kind: Literal["unit", "table", "translation", "new"]
    lang: str
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
    change_type: str
    group_id: str | None
    reason: str
    status: str
    confirmed_by: str | None
    confirmed_at: KstDatetime | None
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
    lang: str
    text: str
    ai_text: str
    change_type: str | None
    status: str
    source_note: str
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
    display_id: str
    doc_code: str
    section: str
    source_text: str
    reason: str


class CMoved(BaseModel):
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
    old_units: int
    assigned: int
    unassigned: int
    duplicate: int
    deleted: int
    moved: int
    new: int
    translated: int
    confirmed_rate: float


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
    unit_groups: dict[int, str]  # 관계 묶음 ID — GET groups와 같은 접기·같은 ID
    target_groups: dict[int, str]
    doc_order: list[TargetDocInfo]  # SOP(순서) 다음 그 SOP의 WI들, 부모 없는 WI는 끝
    doc_rank: dict[int, int]


@dataclass(frozen=True)
class _SectionPlan:
    key: str
    label: str
    number: str | None  # 줄 번호의 머리 — 같은 번호의 칸(WI 한 단계의 Instruction·Why)은 줄 번호를 이어 센다
    na_reason: str | None
    targets: list[TargetInfo]  # 칸 새 문장이 아닌 새 문장(두 언어 모두), 칸 안 순서
    keep_empty: bool  # SOP 칸·선언 단계는 비어도 싣고, 단계 없음·절 경로 칸은 그 언어 새 문장이 있을 때만


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

    edges = [(target.id, unit_id) for target in snap.targets.values() for unit_id in target.source_unit_ids]
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
    return _Index(
        snap=snap, old_units=old_units, cells=cells, unit_targets=unit_targets, doc_targets=doc_targets,
        children=children, translations=translations, unit_groups=unit_groups, target_groups=target_groups, doc_order=doc_order,
        doc_rank={doc.id: rank for rank, doc in enumerate(doc_order)},
    )


def _is_in_lang(value: str, lang: Lang) -> bool:
    """그 언어판에 나오는가 — 중립(그림·표)은 두 언어판 모두에 나온다."""
    return value in (lang, NEUTRAL)


def _get_decision_unit_id(unit: UnitInfo) -> int:
    """처분을 담는 단위 — 묶인 칸 문장은 그룹(표·행) 단위의 판단을 따른다."""
    return unit.group_unit_id if unit.group_unit_id is not None else unit.id


def _list_cover_units(index: _Index, lang: Lang) -> list[UnitInfo]:
    """그 언어의 옛 커버 단위(그림 포함) — 요약 숫자·흐름도가 세는 단위다. 표·행 단위는 세지 않는다."""
    return [unit for unit in index.old_units if unit.kind in COVER_KINDS and _is_in_lang(unit.lang, lang)]


def _format_doc_code(document: DocumentInfo) -> str:
    """옛 문서 번호 — 비어 있으면 표시 ID와 같은 D{id}."""
    return document.doc_code or f"D{document.id}"


def _get_item_key(index: _Index, doc: TargetDocInfo, target: TargetInfo) -> tuple[object, ...]:
    """칸 안 순서 — 사람이 정한 문서는 order_index, 아니면 입구 2 새 문장은 새 문서의 자리, 번역은 번역 출처 단위, 나머지는 첫 출처의 정렬 키.

    입구 2 새 문장의 자리는 새 문서 안의 실제 순서다(스펙 §6.7) — 짝지은 옛 단위 순서로 섞지 않는다.
    """
    if doc.manual_order:
        return (target.order_index, target.id)
    units = index.snap.units
    if target.origin == ORIGIN_NEW_DOC and target.new_unit_id in units:
        return (units[target.new_unit_id].order_key, target.id)
    if target.translation_source_unit_id in units:
        return (units[target.translation_source_unit_id].order_key, target.id)
    if target.source_unit_ids:
        return (units[target.source_unit_ids[0]].order_key, target.id)
    return ((2, target.order_index), target.id)


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


def _number_targets(index: _Index, lang: Lang, labels: OutputLabels) -> dict[int, str]:
    """그 언어판의 새 문장 → 섹션 번호. 줄은 그 판에 보이는 것(그 언어와 중립)만 센다 — 판마다 번호가 빈틈없이 이어진다.

    번역 줄은 따로 세지 않는 규칙이 아니라 출처와 같은 깊이·표시(detach._follow_source가 맞춘다)·같은 정렬 자리라서 두 판의 줄이
    서로 짝을 이루면 출처와 같은 번호가 된다. 한/영 짝 원문 줄도 깊이·표시를 함께 정하므로(순서 바꾸기가 짝 상대에 표시를 옮긴다)
    두 판이 나란하면 같은 번호다. 번호 생략·주석 줄은 번호가 없고 세지 않는다. 표 칸 새 문장은 표의 번호를 따른다(표가 번호가
    없으면 칸도 없다). 입구 2 문서·단계 없는 WI 칸은 번호가 없다.
    """
    numbers: dict[int, str] = {}
    for doc in index.doc_order:
        runs: dict[str, list[TargetInfo]] = {}
        for plan in _plan_sections(index, doc, labels):
            if plan.number is not None:
                runs.setdefault(plan.number, []).extend(target for target in plan.targets if _is_in_lang(target.lang, lang))
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


def _list_new_targets(index: _Index, lang: Lang, labels: OutputLabels) -> list[tuple[TargetDocInfo, TargetInfo]]:
    """입구 2의 신규 — 출처 없는 new_doc 새 문장(그 언어와 그림), 새 문서 순서와 결과물 C 칸 순서.

    표 새 문장은 글이 없고 칸 새 문장이 따로 나오므로 뺀다.
    """
    found = []
    for doc in index.doc_order:
        for plan in _plan_sections(index, doc, labels):
            for top in plan.targets:
                for target in (top, *index.children.get(top.id, [])):
                    is_new = target.origin == ORIGIN_NEW_DOC and not target.source_unit_ids and target.kind != "table"
                    if is_new and _is_in_lang(target.lang, lang):
                        found.append((doc, target))
    return found


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


def _list_translations(index: _Index, unit_id: int, lang: Lang) -> list[TargetInfo]:
    return [target for target in index.translations.get(unit_id, []) if target.lang == lang]


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


def _describe_dest(
    index: _Index, doc: TargetDocInfo, targets: list[TargetInfo], is_own: bool, labels: OutputLabels,
    number_of: NumberOf,
) -> _Dest:
    locations = [_format_target_location(target, labels) for target in targets]
    location = locations[0] if len(set(locations)) == 1 else _number_lines(locations)
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


def _build_unit_rows(
    index: _Index, unit: UnitInfo, row_kind: Literal["unit", "table"], labels: OutputLabels, number_of: NumberOf
) -> list[ARow]:
    """옛 단위 하나의 줄 — 보낸 새 문서마다 한 줄(중복 배정), 없으면 삭제·이동·미배정 한 줄."""
    snap = index.snap
    decision_unit_id = _get_decision_unit_id(unit)
    decision = snap.decisions[decision_unit_id]
    document = snap.documents[unit.document_id]
    dests = [
        _describe_dest(index, doc, targets, is_own, labels, number_of)
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
            row_kind=row_kind, lang=unit.lang, old_doc_code=_format_doc_code(document),
            old_doc_version=document.doc_version, location=_locate_unit(index, unit, labels),
            unit_id=unit.id, display_id=unit.display_id, source_text=_format_source_text(index, unit, labels),
            dest_kind=dest.kind, dest_doc_code=dest.doc_code, dest_doc_title=dest.doc_title,
            dest_location=dest.location, dest_number=dest.number, dest_is_note=dest.is_note,
            confirmed_text=dest.confirmed_text, ai_text=dest.ai_text,
            change_type=dest.change_type, group_id=index.unit_groups.get(decision_unit_id), reason=decision.reason,
            status=get_cover_status(unit, snap.decisions), confirmed_by=decision.confirmed_by,
            confirmed_at=decision.confirmed_at, warnings=dest.warnings,
        )
        for dest in dests
    ]


def _build_translation_row(index: _Index, target: TargetInfo, labels: OutputLabels, number_of: NumberOf) -> ARow:
    """번역 줄(스펙 §7.13 규칙 2) — 옛 문장 칸은 비고 위치·표시 ID는 출처 단위의 것이다. 출처가 은퇴한 번역(보류)은 둘 다 비어 있다."""
    snap = index.snap
    doc = snap.target_docs[target.target_doc_id]
    unit = snap.units.get(target.translation_source_unit_id)
    document = snap.documents[unit.document_id] if unit else None
    return ARow(
        row_kind="translation", lang=target.lang, old_doc_code=_format_doc_code(document) if document else "",
        old_doc_version=document.doc_version if document else "",
        location=_locate_unit(index, unit, labels) if unit else LocationOut(section="", place="", page=None, page_basis=""),
        unit_id=target.translation_source_unit_id, display_id=unit.display_id if unit else "", source_text="",
        dest_kind=doc.doc_type, dest_doc_code=doc.code, dest_doc_title=doc.title,
        dest_location=_format_target_location(target, labels), dest_number=number_of(target),
        dest_is_note=_is_note(index, target), confirmed_text=target.confirmed_text,
        ai_text=target.ai_text, change_type=target.change_type or "",
        group_id=index.target_groups.get(target.parent_target_id or target.id), reason="", status=target.status,
        confirmed_by=target.confirmed_by, confirmed_at=target.confirmed_at, warnings=list(target.warnings),
    )


def _build_old_rows(index: _Index, lang: Lang, labels: OutputLabels, number_of: NumberOf) -> list[ARow]:
    """옛 문서 줄 — 커버 단위(그 언어와 그림)와 표 줄, 단위 바로 뒤에 그 언어의 번역 줄.

    출처 단위는 다른 언어라 자기 줄이 없어도 그 자리를 잡는다. 표 줄은 그 언어 칸 문장이나 칸 번역이 있거나 칸이 아예 없을 때만.
    """
    rows: list[ARow] = []
    for unit in index.old_units:
        if unit.kind in TABLE_UNIT_KINDS:
            cells = index.cells.get(unit.id, [])
            if not cells or any(_is_in_lang(cell.lang, lang) or _list_translations(index, cell.id, lang) for cell in cells):
                rows += _build_unit_rows(index, unit, "table", labels, number_of)
        elif _is_in_lang(unit.lang, lang):
            rows += _build_unit_rows(index, unit, "unit", labels, number_of)
        rows += [
            _build_translation_row(index, target, labels, number_of) for target in _list_translations(index, unit.id, lang)
        ]
    return rows


def _build_orphan_rows(index: _Index, lang: Lang, labels: OutputLabels, number_of: NumberOf) -> list[ARow]:
    """출처 단위가 쪼개기 편집으로 은퇴한 번역 줄 — 줄 자리가 없어도 보류를 사람이 볼 수 있게 옛 문서 줄 끝에 둔다."""
    placed = {unit.id for unit in index.old_units}
    return [
        _build_translation_row(index, target, labels, number_of)
        for unit_id in sorted(index.translations.keys() - placed)
        for target in _list_translations(index, unit_id, lang)
    ]


def _build_new_row(
    index: _Index, doc: TargetDocInfo, target: TargetInfo, labels: OutputLabels, number_of: NumberOf
) -> ARow:
    return ARow(
        row_kind="new", lang=target.lang, old_doc_code="", old_doc_version="",
        location=LocationOut(section="", place="", page=None, page_basis=""), unit_id=None, display_id="",
        source_text="", dest_kind=doc.doc_type, dest_doc_code=doc.code, dest_doc_title=doc.title,
        dest_location=_format_target_location(target, labels), dest_number=number_of(target),
        dest_is_note=_is_note(index, target), confirmed_text=target.confirmed_text,
        ai_text=target.ai_text, change_type=target.change_type or "",
        group_id=index.target_groups.get(target.parent_target_id or target.id), reason="", status=target.status,
        confirmed_by=target.confirmed_by, confirmed_at=target.confirmed_at, warnings=list(target.warnings),
    )


def build_output_a(snap: BundleSnapshot, lang: Lang) -> list[ARow]:
    """결과물 A — 옛 문서 순서의 줄들(번역 줄 포함) 뒤에 입구 2 신규 줄을 새 문서별로 모은다."""
    labels = LABELS[lang]
    index = _build_index(snap)
    numbers = {"ko": _number_targets(index, "ko", labels), "en": _number_targets(index, "en", labels)}

    def get_number(target: TargetInfo) -> str:
        # 그 판에 보이지 않는 새 문장(다른 언어로 옮겨 쓴 것)은 자기 언어판의 번호다 — 결과물 C에서 그 새 문장이 보이는 번호
        return numbers[lang].get(target.id) or numbers.get(target.lang, {}).get(target.id, "")

    new_rows = [
        _build_new_row(index, doc, target, labels, get_number) for doc, target in _list_new_targets(index, lang, labels)
    ]
    return (
        _build_old_rows(index, lang, labels, get_number) + _build_orphan_rows(index, lang, labels, get_number) + new_rows
    )


# --- B ---


def build_output_b(snap: BundleSnapshot, lang: Lang) -> FlowGraph:
    """결과물 B — 옛 문서(그 언어 커버 단위 수) → 새 문서·삭제·이동·미배정. 나눔은 한 번, 중복 배정은 보낸 곳마다 한 번."""
    labels = LABELS[lang]
    index = _build_index(snap)
    old_counts: Counter[int] = Counter()
    edge_counts: Counter[tuple[int, str]] = Counter()
    for unit in _list_cover_units(index, lang):
        old_counts[unit.document_id] += 1
        dests = [f"target:{doc.id}" for doc, _, _ in _group_dests(index, unit)]
        if not dests:
            dests = [DISPOSITION_NODES.get(snap.decisions[_get_decision_unit_id(unit)].disposition, "unassigned")]
        for dest in dests:
            edge_counts[(unit.document_id, dest)] += 1
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


def _build_item(index: _Index, target: TargetInfo, lang: Lang, labels: OutputLabels, numbers: dict[int, str]) -> CItem:
    return CItem(
        target_id=target.id, kind=target.kind, lang=target.lang, text=target.confirmed_text, ai_text=target.ai_text,
        change_type=target.change_type, status=target.status, source_note=_format_source_note(index, target, labels),
        number=numbers.get(target.id), indent_level=target.indent_level,
        number_style=_get_number_style(index, target), cell_row=target.cell_row,
        cell_col=target.cell_col,
        children=[
            _build_item(index, child, lang, labels, numbers)
            for child in index.children.get(target.id, [])
            if _is_in_lang(child.lang, lang)
        ],
    )


def build_output_c(snap: BundleSnapshot, lang: Lang) -> COutput:
    """결과물 C — 새 문서마다 칸별로 받은 새 문장(그 언어와 중립), 끝에 삭제·다른 문서로 이동."""
    labels = LABELS[lang]
    index = _build_index(snap)
    numbers = _number_targets(index, lang, labels)
    docs = []
    for doc in index.doc_order:
        sections = []
        for plan in _plan_sections(index, doc, labels):
            items = [
                _build_item(index, target, lang, labels, numbers)
                for target in plan.targets if _is_in_lang(target.lang, lang)
            ]
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
    rows = _build_old_rows(index, lang, labels, lambda target: numbers.get(target.id, ""))
    return COutput(
        docs=docs,
        deleted=[
            CDeleted(
                display_id=row.display_id, doc_code=row.old_doc_code, section=row.location.section,
                source_text=row.source_text, reason=row.reason,
            )
            for row in rows if row.dest_kind == "delete"
        ],
        moved=[
            CMoved(
                display_id=row.display_id, doc_code=row.old_doc_code, section=row.location.section,
                source_text=row.source_text, move_target_code=row.dest_doc_code, reason=row.reason,
            )
            for row in rows if row.dest_kind == "move_external"
        ],
    )


# --- 요약 ---


def build_summary(snap: BundleSnapshot, lang: Lang) -> Summary:
    """언어별 요약 숫자 (스펙 §7.13) — 처분은 판단을 담는 단위의 것, 확정률은 커버 상태 기준(소수 넷째 자리)."""
    index = _build_index(snap)
    units = _list_cover_units(index, lang)
    dispositions = Counter(snap.decisions[_get_decision_unit_id(unit)].disposition for unit in units)
    confirmed = sum(get_cover_status(unit, snap.decisions) == "confirmed" for unit in units)
    return Summary(
        old_units=len(units),
        assigned=len(units) - dispositions["unassigned"],
        unassigned=dispositions["unassigned"],
        # 중복 배정 — 새 문장이 서로 다른 새 문서 둘 이상에 있는 단위(스펙 §6.9)
        duplicate=sum(len(_group_dests(index, unit)) >= 2 for unit in units),
        deleted=dispositions["delete"],
        moved=dispositions["move_external"],
        new=len(_list_new_targets(index, lang, LABELS[lang])),
        translated=sum(target.lang == lang for targets in index.translations.values() for target in targets),
        confirmed_rate=round(confirmed / len(units), 4) if units else 0.0,
    )


# --- 검토 요청 조건 재료 ---


@dataclass(frozen=True)
class ReviewFacts:
    cover_status_counts: dict[str, Counter[str]]  # 언어 → 커버 상태 → 옛 커버 단위 수 (진행 숫자와 같은 규칙)
    duplicate_unit_ids: list[int]  # 서로 다른 새 문서 둘 이상으로 간 판단 단위(칸 문장은 표·행 단위로 접는다), id 순


def build_review_facts(snap: BundleSnapshot) -> ReviewFacts:
    """검토 요청 조건이 읽는 단위 사실 — 요약·결과물과 같은 단위 집합(_list_cover_units)과 같은 보낸 곳 규칙(_group_dests)."""
    index = _build_index(snap)
    counts = {
        lang: Counter(get_cover_status(unit, snap.decisions) for unit in _list_cover_units(index, lang))
        for lang in PROGRESS_LANGS
    }
    duplicates = {_get_decision_unit_id(unit) for unit in index.old_units if len(_group_dests(index, unit)) >= 2}
    return ReviewFacts(cover_status_counts=counts, duplicate_unit_ids=sorted(duplicates))
