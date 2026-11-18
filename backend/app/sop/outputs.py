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
from app.sop.caption_ref_rules import (
    REF_LINKED,
    index_caption_groups,
    match_covering_units,
    pick_table_unit_id,
    resolve_numbered_group,
)
from app.sop.captions import CAPTION_KIND, get_caption_lang_rank, is_caption_target, join_caption_texts
from app.sop.constants import (
    COVER_KINDS,
    MAX_BULLET_LEVEL,
    NUMBER_BULLET,
    NUMBER_NOTE,
    NUMBERED,
    SLOT_HEADING,
    WI_PARTS,
    NumberStyle,
    OutlineKind,
)
from app.sop.groups import TABLE_UNIT_KINDS, build_group_ids, collapse_table_members
from app.sop.numbering import NUMBER_CELL, SECTION_KIND, is_number_fixed, normalize_number, strip_number
from app.sop.outline import KIND_AUTO_LIST, DocOutline, get_parent_key, list_emitted_keys, number_outline
from app.sop.output_labels import LABELS, OutputLabels
from app.sop.output_rows import (
    MeaningRow,
    build_meaning_rows,
    count_single_language,
    get_meaning_key,
    get_new_meaning_key,
    list_noise_units,
)
from app.sop.renumber import (
    find_caption_number,
    find_number_tokens,
    format_caption_prefix,
    has_caption_head,
    replace_numbers,
)
from app.sop.snapshot import (
    BundleSnapshot,
    CaptionRefInfo,
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
# 입구 2 한쪽만 맞춘 짝의 출처 없는 쪽(제품 명세 §7.13 줄 규칙 (4)) — 저장하지 않는 표시 전용 변경 종류
TRANSLATED_ADDED = "translated_added"
# 나눔 문장 번호 — 스무 개를 넘으면 "(21)" 꼴로 이어 간다
CIRCLED_NUMBERS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
DISPOSITION_NODES = {"delete": "delete", "move_external": "move_external"}  # 그 밖(미배정)은 "unassigned"
TAIL_NODES = ("delete", "move_external", "unassigned")  # 흐름도 오른쪽 열에서 새 문서들 뒤에 오는 노드
# 잡음 표시 줄(목차)의 상태 — 결정 행이 아니라 코드 규칙으로 지운 줄이라 판단 상태(미배정·확정 …)를 쓰지 않는다(MD 1 F6·F11)
STATUS_DELETED = "deleted"


# --- 출력 모양 ---


class LocationOut(BaseModel):
    section: str
    place: str  # 문단 · 표 n · r행 c열 · 그림 · 머리말 …
    page: int | None
    page_basis: str


class ARow(BaseModel):
    """결과물 A 한 줄 — 옛 단위 한 줄(중복 배정은 보낸 곳마다), 표 줄·칸 문장 줄, 번역 줄, 입구 2 신규 줄.

    줄은 의미 묶음(짝 하나·짝 없는 판단 단위 하나, 고아 번역 하나, 입구 2 신규 짝 하나)으로 묶인다. 묶음이 함께 쓰는 값은
    row_no·remark이고, 상태·변경 종류·위치는 줄마다 자기 값이다(제품 명세 §7.13 줄 규칙 (5)).
    """

    row_no: int  # 묶음 번호, 묶음마다 1부터 — 옛 문서 줄 → 고아 번역 → 신규
    is_group_start: bool
    row_kind: Literal["unit", "table", "caption", "cell", "translation", "new"]  # caption = 표·그림 줄 뒤 캡션 단위 줄
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
    status: str  # 옛 단위 줄은 커버 상태, 번역·신규 줄은 새 문장 상태, 잡음 표시 줄(목차)은 STATUS_DELETED
    confirmed_by: str | None  # "이름 (ID)", 디렉터리에 없거나 퇴직이면 ID만(format_confirmer)
    confirmed_at: KstDatetime | None
    group_id: str | None
    warnings: list[dict[str, str]]
    # 잡음 표시(noise.py) — "toc"면 목차 줄(보낸 곳 Deleted, 저절로). 시트 미리보기가 연달아 오는 목차 줄을 한 줄로 접는다
    noise_kind: str | None = None


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


class RenumberOut(BaseModel):
    """표·그림 줄의 번호 바뀜 — 원문 번호가 없으면 from_label이 빈 글."""

    from_label: str
    to_label: str


class CItem(BaseModel):
    target_id: int
    kind: str
    lang: str  # 글꼴용 — 한 칸에 두 언어가 섞여 나온다
    text: str
    ai_text: str
    change_type: str | None
    status: str
    source_note: str
    # 줄이 받은 옛 단위 수(중복 없이) — 2 이상이면 C 화면이 줄에 올리거나 고를 때 source_note를 꼬리표로 보인다(N:1)
    source_count: int
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
    # 표·그림 새 문장의 자식 — 캡션 새 문장(한국어·영어 순)이 먼저, 그다음 칸 새 문장(행·열 순)
    children: list["CItem"]
    # 표·그림 새 문장의 캡션 글(_pick_caption_text — 확정 글이 없으면 AI 글), 없거나 표·그림이 아니면 None. 미리 보기 글(끌기 카드)용이고,
    # 줄마다의 확정·AI 글·상태는 캡션 자식이 싣는다
    caption: str | None = None
    renumber: RenumberOut | None = None  # 표·그림 줄의 번호가 바뀌면 원문 → 새 번호(Renumbering.changes, Assign New 칸과 같은 값)


class AutoItem(BaseModel):
    """자동 목록 절(SOP 7.2 Work Instructions)의 한 줄 — 앱이 채우는 그 SOP의 자식 WI. 배정하는 줄이 아니다."""

    code: str
    title: str


class CSection(BaseModel):
    location_key: str  # SOP 칸 키 | step:<n>:<부분> | unstepped:<부분> | path:<절 경로>
    label: str
    # SOP 절 번호(6.1, 부록은 그 부록의 번호 2)·WI 단계 번호(3). 번호가 없는 칸(5장 범주·단계 없는 WI·절 경로)은 None
    number: str | None
    na_reason: str | None
    # 칸 제목에 이은 옛 제목(두 언어) — "← OLD-1 §5, OLD-2 §5", 없으면 빈 글. 칸 제목은 items에 넣지 않는다(제품 명세 §7.13 칸 제목)
    heading_note: str
    items: list[CItem]
    kind: OutlineKind | None  # SOP 골격 항목의 종류 — WI 단계·입구 2 절 경로 칸은 None
    level: int  # 골격 위계 깊이(최상위 0) — WI·절 경로 칸은 0
    # 이 칸에 직접 놓인 줄을 세는가 — SOP에서 범주 표·하위 항목을 선언하는 칸만 거짓이고 WI·절 경로 칸은 늘 참이다(프런트의 미리 세기·깊이 한도가 읽는다).
    # 번호 없는 칸(number가 null)의 줄은 참이어도 번호가 없다
    counts_lines: bool
    default_style: NumberStyle  # 이 칸에 새로 놓이는 줄의 기본 번호 표시
    auto_items: list[AutoItem] = []  # 자동 목록 절(kind가 auto_list)만 — 그 SOP의 자식 WI(To-Be 순서). 다른 칸은 빈 목록
    # 칸 머리에 번호를 라벨과 따로 적는가 — 라벨에 번호가 이미 든 부록("Appendix 1. 이름")만 거짓이고 그 밖(WI·절 경로 칸 포함)은 참이다.
    # 거짓이어도 number는 그대로다(줄 번호의 머리)
    shows_number: bool = True
    # 표준과 다른 SOP 절(사용자 항목·이름을 바꾼 표준 항목)의 사유 — 그 밖의 절은 None
    deviation_reason: str | None = None
    # 필수 절인데 비었다 — 줄을 받는 절·묶음 제목은 자기와 하위에 줄이 없고, 자동 목록은 자식 WI가 없고, N/A도 아니다. 알림일 뿐 검토 요청을 막지 않는다
    is_empty_required: bool = False


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
    """요약 숫자 한 벌(제품 명세 §7.13 요약 숫자) — 옛 쪽은 줄로 센다.

    목차 줄(잡음 표시)은 결과물 A에 한 줄씩 남으므로 old_rows·assigned에 들고(저절로 지운 줄), 사람이 지운 deleted와 나눠
    toc_deleted로 센다(MD 1 F11). 확정률은 판단 줄(목차 줄 제외)로 잰다 — 목차 줄은 사람이 확정하는 줄이 아니다.
    """

    old_rows: int
    assigned: int  # 처분이 미배정이 아닌 줄(삭제·이동·목차 저절로 삭제 포함)
    no_destination: int  # 처분이 미배정인 줄 — 갈 곳 없는 보류·일부만 판단한 줄 포함, 진행 숫자의 Unassigned(상태 기준)와 다르다
    duplicate: int
    deleted: int  # 사람이 지운 줄
    moved: int
    new: int  # 출처 없는 입구 2 새 문장을 새 문서 쪽 짝으로 묶은 수
    translated: int  # 번역 줄·Translated · Added 줄이 든 A 묶음 수
    confirmed_rate: float
    single_language: int
    toc_deleted: int = 0  # 목차 · 저절로 삭제 — 잡음 표시가 붙은 줄
    unwrapped_rows: int = 0  # 풀린 표에서 온 줄 — 레이아웃 표(표 벗기기)의 칸 줄이 든 줄(MD 1 F1 · F11)


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
    # 새 문서 → 내보낼 골격 항목의 번호(outline.number_outline — 내보내는 항목만 담긴다, 번호 없는 항목은 None). 비어 있는 선택 항목을
    # 빼고 센 값이라 A·C·요약이 모두 이것으로 절 번호·라벨을 읽는다
    outline_numbers: dict[int, dict[str, str | None]]


@dataclass(frozen=True)
class _SectionPlan:
    key: str
    label: str
    number: str | None  # 칸 제목의 번호 — SOP 절 번호·WI 단계 번호, 번호 없는 칸은 None
    na_reason: str | None
    targets: list[TargetInfo]  # 칸 새 문장이 아닌 새 문장(두 언어 모두), 칸 안 순서 — 칸 제목은 빠진다
    keep_empty: bool  # SOP 칸·선언 단계는 비어도 싣고, 단계 없음·절 경로 칸은 새 문장이 있을 때만
    headings: tuple[TargetInfo, ...] = ()  # SOP 칸의 칸 제목(두 언어) — 번호를 세지 않고 칸 항목도 아니다
    kind: str | None = None  # SOP 골격 항목의 종류 — WI·절 경로 칸은 None
    level: int = 0
    # 직접 놓인 줄을 세는 칸인가 — SOP에서 범주 표·하위 항목을 선언하는 칸(직접 줄이 하위 제목 번호와 겹친다)만 거짓이다.
    # 번호 없는 칸(number가 None)은 참이어도 번호를 받지 않는다 — 화면은 이 값으로 깊이 한도만 가른다
    counts_lines: bool = True
    default_style: str = NUMBERED
    # 줄 번호의 머리("6.1" → 6.1.1) — 줄을 세지 않는 칸은 None. 같은 run의 칸(WI 한 단계의 Instruction·Why)은 줄 번호를 이어 센다
    line_base: str | None = None
    run: str = ""  # 줄 번호를 이어 세는 범위 — SOP는 절마다(부록 1과 1장은 머리가 같은 "1"이어도 따로 센다), WI는 단계마다
    # 글머리 기호 줄의 No.에 적는 번호 — 자기 번호, 번호 없는 SOP 절(범주)은 가장 가까운 번호 있는 상위 절의 번호
    nearest_number: str | None = None
    shows_number: bool = True  # 칸 머리에 번호를 라벨과 따로 적는가 — 라벨에 번호가 든 부록만 거짓(outline.DocOutline.shows_number)
    deviation_reason: str | None = None  # 표준과 다른 SOP 절의 사유(CSection.deviation_reason)
    is_empty_required: bool = False  # 비어 있는 필수 SOP 절(CSection.is_empty_required)


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


def _get_child_key(target: TargetInfo) -> tuple[int, int, int, int]:
    """표·그림 새 문장의 자식 순서 — 캡션(한국어·영어 순)이 칸보다 먼저, 칸은 행·열 순(칸 번역은 같은 자리 id 순)."""
    if is_caption_target(target):
        return 0, get_caption_lang_rank(target.lang), 0, target.id
    return 1, target.cell_row or 0, target.cell_col or 0, target.id


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
        cell_targets.sort(key=_get_child_key)

    # 사람이 쓴 다른 언어 문장(translated)은 AI 번역처럼 번역 줄이라 관계 묶음(나눔·합침·중복 배정)에 넣지 않는다(제품 명세 §7.13 줄 규칙 (3)).
    # 칸 제목도 넣지 않는다 — 다른 옛 문서의 같은 제목이 출처로 함께 있어도 합침이 아니다(제품 명세 §7.13 칸 제목, groups._find_neighbors)
    edges = [
        (target.id, unit_id)
        for target in snap.targets.values() if target.change_type != TRANSLATED and target.kind != SLOT_HEADING
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
    outline_numbers = {
        doc.id: number_outline(
            doc.outline,
            # 줄이나 칸 제목이 놓인 항목 — To-Be 목록(tobe.build_tobe_out)과 같은 기준이다
            list_emitted_keys(
                doc.outline, {target.slot_key for target in doc_targets.get(doc.id, ()) if target.slot_key}, doc.na_slots
            ),
        )
        for doc in doc_order
    }
    return _Index(
        snap=snap, old_units=old_units, cells=cells, unit_targets=unit_targets, doc_targets=doc_targets,
        children=children, translations=translations, unit_groups=unit_groups, target_groups=target_groups, doc_order=doc_order,
        doc_rank={doc.id: rank for rank, doc in enumerate(doc_order)}, meaning_anchor=meaning_anchor,
        new_doc_places=new_doc_places, outline_numbers=outline_numbers,
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
    """칸 안 순서 — 사람이 정한 문서는 order_index, 아니면 입구 2 새 문장은 새 문서의 자리, 나머지는 기댄 옛 단위의 의미 순(제품 명세 §7.13 섹션 번호).

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
    """N/A 사유 — 상위 칸이 N/A면 하위 칸도 그 사유로 N/A다(R8). 자기 것이 먼저고, 없으면 가까운 조상부터 끝까지 본다."""
    key: str | None = slot_key
    while key is not None:
        if key in doc.na_slots:
            return doc.na_slots[key]
        key = get_parent_key(key)
    return None


def _get_line_base(outline: DocOutline, key: str, numbers: Mapping[str, str | None]) -> str | None:
    """SOP 절에 직접 놓인 줄 번호의 머리 — 줄을 세는 절의 자기 번호다(6장 절차 "6.1" → 6.1.1). 세지 않는 절과 번호 없는 절(범주)은 None.

    부록도 자기 번호가 머리다("Appendix 2" 안의 줄 → 2.1, 2.2, 2.1.1 — 사용자 확인 2026-11-18). 다른 곳은 이 값을 읽기만 한다
    (프런트는 절 응답의 number·counts_lines).
    """
    return numbers.get(key) if outline.counts_lines(key) else None


def _list_filled_keys(index: _Index, doc: TargetDocInfo, by_slot: Mapping[str | None, list[TargetInfo]]) -> set[str]:
    """SOP 절 가운데 채워진 것 — 줄(칸 제목 제외)이 놓인 절과, 자식 WI가 있는 자동 목록 절. 비어 있는 필수 절 판정의 재료다."""
    filled = {key for key, targets in by_slot.items() if key is not None and targets}
    if any(child.doc_type == "wi" and child.parent_id == doc.id for child in index.snap.target_docs.values()):
        filled |= {item.key for item in doc.outline.items if item.kind == KIND_AUTO_LIST}
    return filled


def _list_empty_required_keys(doc: TargetDocInfo, numbers: Mapping[str, str | None], filled: set[str]) -> set[str]:
    """비어 있는 필수 SOP 절 — 내보내는 절(numbers의 키) 가운데 필수이고 N/A가 아니며 자기와 하위에 채움(_list_filled_keys)이 없는 것.

    하위 절을 둔 절(묶음 제목 · 절차 · 범주 표)은 하위가 모두 N/A이거나 채워졌으면 비어 있음이 아니다 — 하위 가운데 비어 있는 필수 절이
    있을 때만 함께 비어 있다(하위가 하나도 없으면 자기만 본다). 자동 목록은 자식 WI가 없을 때, 빈 선택 항목은 절이 없어 오지 않는다.
    """
    outline = doc.outline
    empty: set[str] = set()
    for item in reversed(outline.items):  # 위계 순서의 거꾸로 — 하위의 판정이 먼저 끝난다
        if item.key not in numbers or not item.is_required or _find_na_reason(doc, item.key) is not None:
            continue
        if any(outline.is_within(key, item.key) for key in filled):
            continue
        children = [child.key for child in outline.list_children(item.key) if child.key in numbers]
        if not children or any(key in empty for key in children):
            empty.add(item.key)
    return empty


def _find_nearest_number(key: str, numbers: Mapping[str, str | None]) -> str | None:
    """그 절이나 가장 가까운 상위 절의 번호 — 번호 없는 절(5장 범주)의 줄이 결과물 A·Excel의 No.에 적는 값("5")."""
    current: str | None = key
    while current is not None:
        if numbers.get(current) is not None:
            return numbers[current]
        current = get_parent_key(current)
    return None


def _plan_sections(index: _Index, doc: TargetDocInfo, labels: OutputLabels) -> list[_SectionPlan]:
    """새 문서의 칸 — 입구 2 문서는 절 경로가 처음 나온 순서, SOP는 그 문서 골격 사본의 순서, WI는 단계마다 Instruction·Why.

    칸 제목은 칸 항목이 아니라 SOP 칸의 headings로 따로 싣는다(저장이 SOP의 N/A 아닌 칸에만 둔다).
    SOP는 내보낼 항목만 싣는다 — 비어 있고 N/A도 아닌 선택 항목(7.1.x)은 빠지고 번호도 세지 않는다(_Index.outline_numbers).
    """
    doc_targets = index.doc_targets.get(doc.id, [])
    tops = sorted(
        (target for target in doc_targets if target.parent_target_id is None and target.kind != SLOT_HEADING),
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
        headings: dict[str | None, list[TargetInfo]] = defaultdict(list)
        for target in doc_targets:
            if target.kind == SLOT_HEADING:
                headings[target.slot_key].append(target)
        outline, numbers = doc.outline, index.outline_numbers[doc.id]
        empty = _list_empty_required_keys(doc, numbers, _list_filled_keys(index, doc, by_slot))
        return [
            _SectionPlan(
                item.key, outline.get_label(item.key, numbers), numbers[item.key], na_reason,
                by_slot.get(item.key, []), keep_empty=True, headings=tuple(headings.get(item.key, ())),
                kind=item.kind, level=outline.get_level(item.key), counts_lines=outline.counts_lines(item.key),
                default_style=item.default_style, line_base=_get_line_base(outline, item.key, numbers), run=item.key,
                nearest_number=_find_nearest_number(item.key, numbers), shows_number=outline.shows_number(item.key),
                deviation_reason=item.deviation_reason, is_empty_required=item.key in empty,
            )
            for item in outline.items
            if item.key in numbers
            for na_reason in (_find_na_reason(doc, item.key),)
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
            line_base=str(step), run=f"step:{step}", nearest_number=str(step),
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


def list_target_order(snap: BundleSnapshot, target_doc_id: int) -> list[int]:
    """새 문서의 최상위 새 문장(칸 제목 제외) id를 결과물 C가 보이는 순서로 — 칸 순서, 그 안은 칸 안 순서. 문서가 없으면 빈 목록."""
    doc = snap.target_docs.get(target_doc_id)
    if doc is None:
        return []
    return [target.id for plan in _plan_sections(_build_index(snap), doc, LABELS["en"]) for target in plan.targets]


# --- 섹션 번호 ---


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


def get_bullet_depths(items: Sequence[CItem]) -> list[int | None]:
    """칸 안 줄마다 글머리 기호 깊이 — 글머리 기호가 아닌 줄은 None. 번호 줄과 따로 세어 앞 글머리 기호 줄 깊이 + 1(상한 MAX_BULLET_LEVEL)까지만 읽고,
    첫 글머리 기호 줄은 0이다. 번호 줄·생략·주석 줄은 건너뛴다. 저장한 깊이는 바꾸지 않는다(프런트 section-number.getSectionDepths와 같은 규칙)."""
    previous: int | None = None
    depths: list[int | None] = []
    for item in items:
        if item.number_style != NUMBER_BULLET:
            depths.append(None)
            continue
        depth = max(0, min(item.indent_level, MAX_BULLET_LEVEL, 0 if previous is None else previous + 1))
        depths.append(depth)
        previous = depth
    return depths


def number_targets(index: _Index, labels: OutputLabels) -> dict[int, str]:
    """새 문장 → 섹션 번호(제품 명세 §7.13 섹션 번호 세는 법). 한 칸(WI는 같은 단계의 Instruction·Why를 이어)의 칸 새 문장이 아닌 새 문장 전부를
    언어를 가리지 않고 결과물 C 순서대로 한 줄로 센다.

    번호 생략·주석·글머리 기호 줄은 번호가 없고 세지 않는다. 표 칸 새 문장은 표의 번호를 따른다(표가 번호가 없으면 칸도 없다).
    입구 2 문서·단계 없는 WI 칸·SOP 5장 범주는 번호가 없다. 칸 제목은 세지 않고 칸 번호가 곧 그 번호다(제품 명세 §7.13 칸 제목 — 결과물 A의 No.).
    줄을 세지 않는 칸(_SectionPlan.line_base가 None — 범주 표와 하위 항목을 선언하는 칸, 템플릿의 5·6·9장)에 직접 놓인 줄은 저장된
    표시·깊이와 상관없이 번호가 없고 세지 않는다(사용자 결정 2026-11-17) — 세면 6장의 머리 글 첫 줄이 6.1이 되어 절차 제목 "6.1"과 번호가 겹친다.
    저장값은 건드리지 않아 하위 칸으로 옮기면 다시 센다. 줄 번호의 머리는 _get_line_base(절차 6.1 → 6.1.1, 부록 2 → 2.1).
    """
    numbers: dict[int, str] = {}
    for doc in index.doc_order:
        runs: dict[str, tuple[str, list[TargetInfo]]] = {}
        for plan in _plan_sections(index, doc, labels):
            if plan.number is not None:
                numbers.update(dict.fromkeys((heading.id for heading in plan.headings), plan.number))
            if plan.line_base is not None:
                runs.setdefault(plan.run, (plan.line_base, []))[1].extend(plan.targets)
        for base, targets in runs.values():
            depths = [target.indent_level if target.number_style == NUMBERED else None for target in targets]
            for target, number in zip(targets, number_lines(base, depths), strict=True):
                if number is None:
                    continue
                numbers[target.id] = number
                for child in index.children.get(target.id, []):
                    numbers[child.id] = number
    return numbers


def number_bullets(index: _Index, labels: OutputLabels) -> dict[int, str]:
    """글머리 기호 새 문장(과 그 표 칸) → 놓인 절의 번호. 결과물 A·Excel의 No.에만 쓴다 — 줄 번호가 없어도 어느 절의 항목인지는 적는다.

    번호 없는 SOP 절(5장 범주)의 줄은 가장 가까운 번호 있는 상위 절의 번호("5")를 적는다 — 그 절에서는 번호 표시 줄도 번호를 받지
    못하니 글머리 기호 줄과 같이 적고, 그 절의 칸 제목도 같다. 번호 생략·주석 줄은 다른 절처럼 비운다.
    결과물 C의 줄 번호(number_targets)에는 넣지 않는다(화면이 번호 자리에 기호를 그린다). 번호를 댈 절이 없는 칸(입구 2 문서·단계 없는 WI)의 줄은 없다.
    """
    numbers: dict[int, str] = {}
    for doc in index.doc_order:
        for plan in _plan_sections(index, doc, labels):
            if plan.nearest_number is None:
                continue
            styles = (NUMBER_BULLET,) if plan.number is not None else (NUMBER_BULLET, NUMBERED)
            for target in plan.targets:
                if target.number_style in styles:
                    numbers.update(
                        dict.fromkeys(
                            (target.id, *(child.id for child in index.children.get(target.id, []))), plan.nearest_number
                        )
                    )
            if plan.number is None:
                numbers.update(dict.fromkeys((heading.id for heading in plan.headings), plan.nearest_number))
    return numbers


# --- 표·그림 번호 다시 매기기 ---

BUNDLE_TARGET_KINDS = ("table", "figure")
CaptionRefCode = Literal[
    "caption_ref_broken", "caption_ref_order", "caption_ref_unresolved", "caption_ref_ambiguous", "caption_ref_text_changed",
]


@dataclass(frozen=True)
class CaptionRefWarning:
    code: CaptionRefCode
    target_id: int | None  # 참조 새 문장(있으면)
    unit_id: int  # 참조 원문 단위


@dataclass(frozen=True)
class Renumbering:
    numbers: Mapping[int, int]  # 표·그림 새 문장 id → 새 번호(새 문서마다, 종류마다, C 순서로 1부터)
    texts: Mapping[int, str]  # 새 문장 id → 결과물에 쓸 글(바뀐 것만 — 캡션 새 문장과 참조 새 문장)
    # 표·그림 새 문장 id → ("표 1", "표 3"), 같으면 키 없음, 번호 없는 캡션에 머리 번호를 붙였으면 ("", "표 3"), 캡션이 없으면 키 없음
    changes: Mapping[int, tuple[str, str]]
    warnings: tuple[CaptionRefWarning, ...]


def _format_bundle_label(kind: str, number: int, labels: OutputLabels) -> str:
    return labels.table_template.format(table=number) if kind == "table" else f"{labels.figure} {number}"


@dataclass(frozen=True)
class _RefLookup:
    """참조 대상 찾기 색인 — 스냅숏 단위를 한 번만 훑는다."""

    table_units: Mapping[int, list[UnitInfo]]  # 표 id → 표·행 단위
    figure_units: Mapping[int, int]  # 그림 블록 id → 그림 단위 id
    # 문서 → (종류, 캡션 번호) → 그 캡션이 달린 묶음 단위들(caption_ref_rules.index_caption_groups)
    heads: Mapping[int, Mapping[tuple[str, int], set[int]]]


def _build_ref_lookup(snap: BundleSnapshot) -> _RefLookup:
    table_units: dict[int, list[UnitInfo]] = defaultdict(list)
    figure_units: dict[int, int] = {}
    by_doc: dict[int, list[UnitInfo]] = defaultdict(list)
    for unit in sorted(snap.units.values(), key=lambda unit: unit.id):
        by_doc[unit.document_id].append(unit)
        if unit.kind in TABLE_UNIT_KINDS and unit.table_id is not None:
            table_units[unit.table_id].append(unit)
        elif unit.kind == "figure":
            figure_units.setdefault(unit.block_id, unit.id)  # 그림 단위의 자리 블록이 곧 그림 블록이다
    heads = {doc_id: index_caption_groups(units) for doc_id, units in by_doc.items()}
    return _RefLookup(table_units, figure_units, heads)


def _find_ref_group(lookup: _RefLookup, ref: CaptionRefInfo, document_id: int) -> int | CaptionRefCode:
    """참조가 가리키는 옛 묶음 단위 id, 정할 수 없으면 경고 코드.

    대상이 저장돼 있으면 표는 표 단위(행이면 가장 작은 행 — caption_ref_rules.pick_table_unit_id), 그림은 그 블록의 그림 단위다.
    대상 없이 남은 번호 참조는 문서 보기 카드와 같은 규칙(caption_ref_rules.resolve_numbered_group)으로 그 문서에서 가린다 —
    없으면 unresolved, 둘 이상이면 ambiguous, 하나면(올린 뒤 캡션을 붙였다) 그 묶음.
    """
    if ref.target_table_id is not None:
        unit_id = pick_table_unit_id(ref.target_table_id, lookup.table_units.get(ref.target_table_id, ()))
        return unit_id if unit_id is not None else "caption_ref_broken"
    if ref.target_block_id is not None:
        return lookup.figure_units.get(ref.target_block_id, "caption_ref_broken")
    if ref.number is None:
        return "caption_ref_unresolved"
    return resolve_numbered_group(lookup.heads.get(document_id, {}), ref.kind, ref.number)


def _is_place_in_order(tops: Sequence[TargetInfo], referring: TargetInfo, bundle: TargetInfo, *, is_next: bool) -> bool:
    """자리 참조("아래 표")의 묶음이 새 문서에서 읽는 사람이 찾을 자리인가 — 참조 새 문장 뒤(앞)의 가장 가까운 같은 종류 묶음.

    올릴 때 자리 참조를 잇는 규칙(caption_refs.build_ref_drafts — 바로 뒤·앞의 같은 종류 묶음)과 같다. 칸 문장·캡션은 표의 자리로 잰다.
    """
    top_id = referring.parent_target_id or referring.id
    position = next((n for n, top in enumerate(tops) if top.id == top_id), None)
    if position is None:
        return True
    side = tops[position + 1:] if is_next else list(reversed(tops[:position]))
    nearest = next((top for top in side if top.kind == bundle.kind), None)
    return nearest is not None and nearest.id == bundle.id


def build_renumbering(index: _Index, labels: OutputLabels) -> Renumbering:
    """새 문서(SOP·WI)마다 결과물 C 순서로 표·그림을 따로 1부터 다시 세고, 캡션과 이어진 참조 문장의 번호를 그 값으로 바꾼 글(제품 명세 §5).

    규칙 계산이고(AI 아님) 확정 글(DB)은 바꾸지 않는다 — 결과물·화면이 texts를 덮어 보인다. KO·EN 판 모두 같은 번호다.
    참조는 출처 단위(번역은 번역 출처) 범위 안의 linked 참조만 보고, 바꾸지 못하는 참조는 경고(막지 않음)로 남긴다.
    새 문장이 없는(지운·미배정) 참조 문장은 경고하지 않는다.
    """
    snap = index.snap
    numbers: dict[int, int] = {}
    tops_by_doc: dict[int, list[TargetInfo]] = {}
    for doc in index.doc_order:
        tops = [target for plan in _plan_sections(index, doc, labels) for target in plan.targets]
        tops_by_doc[doc.id] = tops
        counts: Counter[str] = Counter()
        for target in tops:
            if target.kind in BUNDLE_TARGET_KINDS:
                counts[target.kind] += 1
                numbers[target.id] = counts[target.kind]

    edits: dict[int, dict[tuple[int, int], int]] = defaultdict(dict)  # 새 문장 → 숫자 자리 → 새 번호
    prefixes: dict[int, str] = {}
    changes: dict[int, tuple[str, str]] = {}
    for bundle_id, number in numbers.items():
        kind = snap.targets[bundle_id].kind
        original: int | None = None
        prefixed = False
        for child in index.children.get(bundle_id, []):
            if not is_caption_target(child):
                continue
            text = child.confirmed_text or child.ai_text
            # 머리 번호, 머리가 없으면 첫 그 종류 번호("<표 3> 운전 조건") — 복합 번호 머리("Table 3-1.")는 다시 매기지 않는다
            head = find_caption_number(text, kind)
            if head is None:
                if text and not has_caption_head(text):  # 번호 없이 쓴 캡션은 캡션 언어로 머리 번호를 붙인다(중립·그 밖은 한국어)
                    prefixes[child.id] = format_caption_prefix(kind, number, "en" if child.lang == "en" else "ko")
                    prefixed = True
                continue
            if original is None:
                original = head.number
            # 캡션 안의 같은 번호 다른 언어 표기("표 3. … (Table 3. …)")도 자기 번호다
            same = [token for token in find_number_tokens(text) if (token.kind, token.number) == (head.kind, head.number)]
            edits[child.id].update({(token.start, token.end): number for token in (head, *same)})
        after = _format_bundle_label(kind, number, labels)
        if original is not None and original != number:
            changes[bundle_id] = (_format_bundle_label(kind, original, labels), after)
        elif original is None and prefixed:  # 캡션이 아예 없는 표·그림(입구 2 등)은 붙인 번호가 없어 싣지 않는다
            changes[bundle_id] = ("", after)

    warnings = _follow_references(index, numbers, tops_by_doc, edits)
    texts: dict[int, str] = {}
    for target_id in edits.keys() | prefixes.keys():
        target = snap.targets[target_id]
        base = target.confirmed_text or target.ai_text
        text = prefixes.get(target_id, "") + replace_numbers(base, edits.get(target_id, {}))
        if text != base:
            texts[target_id] = text
    return Renumbering(numbers=numbers, texts=texts, changes=changes, warnings=warnings)


def _follow_references(
    index: _Index, numbers: Mapping[int, int], tops_by_doc: Mapping[int, list[TargetInfo]],
    edits: dict[int, dict[tuple[int, int], int]],
) -> tuple[CaptionRefWarning, ...]:
    """참조 새 문장마다 이어진 참조의 대상 묶음을 같은 새 문서에서 찾아 숫자 자리를 edits에 더하고, 못 하면 경고를 돌려준다."""
    snap = index.snap
    # 뗀 참조도 모은다 — 자기 경고는 없지만 합친 새 문장에서 같은 번호 토큰을 나눠 쓰면 바꾸기를 막는다
    covering = match_covering_units(snap.caption_refs, snap.units.values())
    refs_by_unit: dict[int, list[CaptionRefInfo]] = defaultdict(list)
    for ref in snap.caption_refs:
        if ref.id in covering:
            refs_by_unit[covering[ref.id]].append(ref)
    lookup = _build_ref_lookup(snap)
    bundle_targets: dict[tuple[int, int], list[TargetInfo]] = defaultdict(list)  # (새 문서, 옛 묶음 단위) → 표·그림 새 문장
    for doc_id, tops in tops_by_doc.items():
        for top in tops:
            if top.id in numbers:
                for unit_id in top.source_unit_ids:
                    bundle_targets[(doc_id, unit_id)].append(top)

    warnings: list[CaptionRefWarning] = []
    # (참조 단위, 참조, 새 문서) → 글이 있는 새 문장마다 (id, 그 참조의 토큰이 있는가)
    token_checks: dict[tuple[int, int, int], list[tuple[int, bool]]] = defaultdict(list)
    for target in sorted(snap.targets.values(), key=lambda target: target.id):
        if target.kind in (*BUNDLE_TARGET_KINDS, SLOT_HEADING):
            continue
        unit_ids = target.source_unit_ids
        if not unit_ids and target.translation_source_unit_id in snap.units:
            unit_ids = (target.translation_source_unit_id,)
        source_refs = [(unit_id, ref) for unit_id in unit_ids for ref in refs_by_unit.get(unit_id, ())]
        refs = [(unit_id, ref) for unit_id, ref in source_refs if ref.state == REF_LINKED]
        if not refs:
            continue
        tops = tops_by_doc.get(target.target_doc_id, [])

        def warn(code: CaptionRefCode, unit_id: int, target_id: int = target.id) -> None:
            warnings.append(CaptionRefWarning(code, target_id, unit_id))

        resolved: list[tuple[int, CaptionRefInfo, int, TargetInfo]] = []
        for unit_id, ref in refs:
            group = _find_ref_group(lookup, ref, snap.units[unit_id].document_id)
            if isinstance(group, str):
                warn(group, unit_id)
                continue
            found = bundle_targets.get((target.target_doc_id, group), [])
            if len(found) != 1:
                warn("caption_ref_broken" if not found else "caption_ref_ambiguous", unit_id)
                continue
            resolved.append((unit_id, ref, group, found[0]))
        # 합친 새 문장의 같은 (종류, 번호) 토큰은 출처 참조 모두의 것 — 모두 같은 묶음 하나로 풀릴 때만 바꾼다.
        # 못 푼 참조(경고가 났다)와 뗀 참조는 None으로 들어가 막는다
        bundle_of = {ref.id: bundle.id for _, ref, _, bundle in resolved}
        bundles_by_number: dict[tuple[str, int], set[int | None]] = defaultdict(set)
        for _, ref in source_refs:
            if ref.number is not None:
                bundles_by_number[(ref.kind, ref.number)].add(bundle_of.get(ref.id))
        text = target.confirmed_text or target.ai_text
        tokens = find_number_tokens(text)
        for unit_id, ref, group, bundle in resolved:
            if ref.number is None:
                # 저장된 자리 참조에는 방향이 없다 — 원문에서 묶음이 참조 문장보다 뒤면 "아래"(올릴 때 그 방향으로 이었다)
                is_next = snap.units[group].order_key > snap.units[unit_id].order_key
                if not _is_place_in_order(tops, target, bundle, is_next=is_next):
                    warn("caption_ref_order", unit_id)
                continue
            if bundles_by_number[(ref.kind, ref.number)] != {bundle.id}:
                warn("caption_ref_ambiguous", unit_id)
                continue
            if not text:  # 아직 글이 없는 새 문장은 바꿀 것도 경고할 것도 없다
                continue
            spans = [(token.start, token.end) for token in tokens if (token.kind, token.number) == (ref.kind, ref.number)]
            token_checks[(unit_id, ref.id, target.target_doc_id)].append((target.id, bool(spans)))
            if spans:
                edits[target.id].update(dict.fromkeys(spans, numbers[bundle.id]))
    # 한 단위를 한 새 문서의 새 문장 여럿으로 나누면 토큰은 그중 하나에만 있다 — 그 문서의 어느 글에도 없을 때만 경고한다
    for (unit_id, _, _), checks in token_checks.items():
        if not any(found for _, found in checks):
            warnings.append(CaptionRefWarning("caption_ref_text_changed", checks[0][0], unit_id))
    return tuple(dict.fromkeys(warnings))


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
    """줄의 처분 — 구성 판단 단위의 처분이 모두 같으면 그 값, 아니면 미배정(일부만 판단한 줄은 갈 곳 없음, 제품 명세 §7.13 요약 숫자)."""
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


def _format_target_location(index: _Index, doc: TargetDocInfo, target: TargetInfo, labels: OutputLabels) -> str:
    """새 문서(doc) 안 위치 — SOP 칸(그 문서 골격의 라벨, 부록 번호는 결과물 C와 같은 값), WI 단계·부분, 입구 2 문서는 새 문서의 실제 절 경로."""
    if target.slot_key is not None:
        return doc.outline.get_label(target.slot_key, index.outline_numbers[doc.id])
    if target.wi_part is not None:
        part = labels.wi_parts[target.wi_part]
        if target.wi_step is None:
            return labels.wi_unstepped_template.format(part=part)
        return labels.wi_step_template.format(step=target.wi_step, part=part)
    return target.section_path


def _format_place(index: _Index, unit: UnitInfo, labels: OutputLabels) -> str:
    # 번호 칸("A" · "7")을 앞 조각으로 받은 풀린 표의 줄은 내용 칸을 가리킨다 — 번호는 번호 칸의 몫이다(F3)
    has_number_cell = unit.number_source == NUMBER_CELL and len(unit.spans) > 1
    block = index.snap.blocks[unit.spans[1][0] if has_number_cell else unit.block_id]
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
    # 캡션은 제 문단 블록(새 추출)에도, 이행한 옛 그림 블록(0020)에도 있다 — 어느 쪽이든 문단으로 적는다
    if block.kind == "figure" and unit.kind != CAPTION_KIND:
        pieces.append(labels.figure)
    return " · ".join(pieces or [labels.paragraph])


def _format_source_text(index: _Index, unit: UnitInfo, labels: OutputLabels) -> str:
    """원문 칸 — 표·그림 단위는 묶인 원문 캡션 글(표는 뒤에 " [행×열]"), 캡션 없는 표·행 단위는 "[표 n, 행×열]"(행 단위는 그 행 하나).

    나머지는 단위 글자에서 문단 번호를 뺀 내용이다 — 번호는 위치 칸에 적는다(F5·F11). 번호 범위가 없는 단위(옛 추출, 타자로 친
    번호)는 번호가 글에 남은 그대로다.
    """
    caption = "\n".join(member.text for member in index.cells.get(unit.id, ()) if member.kind == CAPTION_KIND)
    if unit.kind not in TABLE_UNIT_KINDS:
        return caption or strip_number(unit.text, unit)
    table = index.snap.tables[unit.table_id]
    rows = 1 if unit.kind == "table_row" else table.n_rows
    if caption:
        return f"{caption} [{rows}×{table.n_cols}]"
    return labels.table_source_template.format(table=table.table_index + 1, rows=rows, cols=table.n_cols)


def _get_shown_texts(target: TargetInfo, texts: Mapping[int, str]) -> tuple[str, str]:
    """결과물에 쓸 (확정 글, AI 글) — 다시 매긴 글(Renumbering.texts)은 그 글이 나온 쪽(확정 글, 없으면 AI 글)에 싣는다."""
    text = texts.get(target.id)
    if text is None:
        return target.confirmed_text, target.ai_text
    return (text, target.ai_text) if target.confirmed_text else (target.confirmed_text, text)


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
    section = block.section_label
    if unit.number_set:
        # 사람이 고친 번호 — 읽은 값과 다르면 그 사실을 남긴다(변경 관리의 근거). 절을 여는 줄은 고친 번호가 곧 절이고,
        # 본문 줄은 속한 절 뒤에 그 줄의 번호를 잇는다("2 · 2.1 (읽은 값 2.2)")
        number = normalize_number(unit.number_set)
        if is_number_fixed(unit):
            number = labels.read_number_template.format(number=number, read=normalize_number(unit.number_read or ""))
        section = number if unit.kind == SECTION_KIND or not section else f"{section} · {number}"
    return LocationOut(
        section=section, place=_format_place(index, unit, labels), page=block.page, page_basis=block.page_basis,
    )


def _format_locations(index: _Index, doc: TargetDocInfo, targets: list[TargetInfo], labels: OutputLabels) -> str:
    """새 문장들의 새 문서(doc) 안 위치 — 모두 같으면 하나, 다르면 확정 문장 칸과 같은 ①② 순서로."""
    locations = [_format_target_location(index, doc, target, labels) for target in targets]
    return locations[0] if len(set(locations)) == 1 else _number_lines(locations)


def _describe_dest(
    index: _Index, doc: TargetDocInfo, targets: list[TargetInfo], is_own: bool, labels: OutputLabels,
    number_of: NumberOf, texts: Mapping[int, str],
) -> _Dest:
    if is_own:
        # 사람이 쓴 다른 언어 문장(변경 종류 translated)은 같은 묶음의 번역 줄로 뺀다 — 단위 줄의 ①②는 자기 언어(중립)·합침 새 문장만
        shown = [target for target in targets if target.change_type != TRANSLATED]
        if not shown:
            # 이 새 문서에는 번역 새 문장만 있다 — 보낸 곳(종류·문서·자리)만 적고 글·번호·변경 종류는 번역 줄에 맡긴다
            return _Dest(doc.doc_type, doc.code, doc.title, _format_locations(index, doc, targets, labels), "", False, "", "", "", [])
        targets = shown
    location = _format_locations(index, doc, targets, labels)
    # 번호는 새 문장마다 다르므로 여러 새 문장이면 확정 문장 칸과 같은 ①② 순서로 적는다
    number = _number_lines([number_of(target) for target in targets])
    if not is_own:
        return _Dest(doc.doc_type, doc.code, doc.title, location, number, False, "", "", targets[0].change_type or "", [])
    change_types = {target.change_type or "" for target in targets}
    # 한 새 문서 안에서 여러 새 문장으로 간 것은 나눔이다(스펙 §6.9) — 합침과 섞이면 나눔으로 적는다
    change_type = change_types.pop() if len(change_types) == 1 else "split"
    shown_texts = [_get_shown_texts(target, texts) for target in targets]
    return _Dest(
        doc.doc_type, doc.code, doc.title, location, number, all(_is_note(index, target) for target in targets),
        _number_lines([confirmed for confirmed, _ in shown_texts]),
        _number_lines([ai for _, ai in shown_texts]),
        change_type, [warning for target in targets for warning in target.warnings],
    )


def format_confirmer(login_id: str | None, people: Mapping[str, str]) -> str | None:
    """확정한 사람 — 디렉터리 이름이 있으면 "이름 (ID)", 없거나 퇴직이면 ID만(제품 명세 §7.13 줄 규칙 (7))."""
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
    texts: Mapping[int, str]  # 다시 매긴 글(Renumbering.texts) — 새 문장 칸만 쓴다, 옛 문서 칸은 원문 번호 그대로


@dataclass(frozen=True)
class _GroupSlot:
    """의미 묶음 하나가 함께 쓰는 값."""

    row_no: int
    remark: str


_NO_LOCATION = LocationOut(section="", place="", page=None, page_basis="")


def _build_unit_rows(
    ctx: _AContext, unit: UnitInfo, row_kind: Literal["unit", "table", "caption", "cell"], slot: _GroupSlot
) -> list[ARow]:
    """옛 단위 하나의 줄 — 보낸 새 문서마다 한 줄(중복 배정), 없으면 삭제·이동·미배정 한 줄."""
    index = ctx.index
    snap = index.snap
    decision_unit_id = _get_decision_unit_id(unit)
    decision = snap.decisions[decision_unit_id]
    document = snap.documents[unit.document_id]
    # 칸 제목은 같은 새 문서의 문장과 ①②로 섞지 않고 따로 한 줄이다(변경 종류 Slot heading, 제품 명세 §7.13 칸 제목)
    dests = [
        _describe_dest(index, doc, part, is_own, ctx.labels, ctx.number_of, ctx.texts)
        for doc, targets, is_own in _group_dests(index, unit)
        for part in (
            [target for target in targets if target.kind == SLOT_HEADING],
            [target for target in targets if target.kind != SLOT_HEADING],
        )
        if part
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
    confirmed_text, ai_text = _get_shown_texts(target, ctx.texts)
    return ARow(
        row_no=slot.row_no, is_group_start=False, row_kind=row_kind,
        old_doc_code=_format_doc_code(document) if document else "",
        old_doc_version=document.doc_version if document else "",
        location=_locate_unit(index, unit, ctx.labels) if unit else _NO_LOCATION, unit_id=source_id,
        display_id=unit.display_id if unit else "", source_text="",
        dest_kind=doc.doc_type, dest_doc_code=doc.code, dest_doc_title=doc.title,
        dest_location=_format_target_location(index, doc, target, ctx.labels), dest_number=ctx.number_of(target),
        dest_is_note=_is_note(index, target), confirmed_text=confirmed_text, ai_text=ai_text,
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
    """옛 묶음의 Remark(제품 명세 §7.13 줄 규칙 (6)) — 판단 이유, 출처 있는 새 문장의 remark, Translated · Added 새 문장(added)의 remark 순.

    출처 있는 새 문장은 구성 단위(칸 포함)를 출처로 둔 것이다. Translated · Added 새 문장은 출처가 없어 신규 묶음 대신
    이 묶음에 들므로 그 remark도 여기서 보인다. 결과물 C의 삭제·이동 줄 이유도 이 값이다. 칸 제목은 여러 옛 문서가 함께
    쓰는 한 줄이라 그 remark를 한 옛 묶음에 싣지 않는다(다른 옛 문서의 묶음으로 새지 않게).
    """
    units = _list_row_units(index, meaning)
    reasons = [index.snap.decisions[unit_id].reason for unit_id in meaning.unit_ids]
    sourced = [
        target.remark
        for unit in units
        for target in index.unit_targets.get(unit.id, [])
        if target.kind != SLOT_HEADING
    ]
    added_remarks = [target.remark for unit in units for target in added.get(unit.id, [])]
    return _join_remarks([*reasons, *sourced, *added_remarks])


def _build_old_group(ctx: _AContext, meaning: MeaningRow, row_no: int) -> list[ARow]:
    """옛 문서 의미 묶음 — 구성 단위마다 단위 줄, 표·그림 단위면 그 뒤에 캡션 줄, 표·행 단위면 칸 문장 줄. 각 줄 바로 뒤에 그 단위의 번역 줄."""
    slot = _GroupSlot(row_no, _build_old_remark(ctx.index, ctx.added, meaning))
    rows: list[ARow] = []
    for unit_id in meaning.unit_ids:
        unit = ctx.index.snap.units[unit_id]
        rows += _build_unit_rows(ctx, unit, "table" if unit.kind in TABLE_UNIT_KINDS else "unit", slot)
        rows += _build_after_rows(ctx, unit, slot)
        members = ctx.index.cells.get(unit_id, [])
        for member in [*(m for m in members if m.kind == CAPTION_KIND), *(m for m in members if m.kind != CAPTION_KIND)]:
            rows += _build_unit_rows(ctx, member, "caption" if member.kind == CAPTION_KIND else "cell", slot)
            rows += _build_after_rows(ctx, member, slot)
    return rows


def _number_toc_lines(units: Sequence[UnitInfo]) -> dict[int, int]:
    """목차 줄 → 그 문서·언어 안 차례(1부터) — 위치 칸 "목차 · 한글 · 3행"의 수. units는 원문 순."""
    counts: Counter[tuple[int, str]] = Counter()
    numbers: dict[int, int] = {}
    for unit in units:
        counts[(unit.document_id, unit.lang)] += 1
        numbers[unit.id] = counts[(unit.document_id, unit.lang)]
    return numbers


def _build_toc_row(ctx: _AContext, unit: UnitInfo, number: int, row_no: int) -> ARow:
    """목차 줄 하나 — 보낸 곳 Deleted, 비고는 "목차 · 새 문서 목차는 앱이 만든다 (저절로)". 결정 행이 아니라 표시라 상태도
    판단 상태가 아닌 STATUS_DELETED이고 확정한 사람이 없다(사람이 확정한 것처럼 꾸미지 않는다, MD 1 §11-2)."""
    labels = ctx.labels
    snap = ctx.index.snap
    block = snap.blocks[unit.block_id]
    document = snap.documents[unit.document_id]
    place = labels.toc_place_template.format(lang=labels.toc_langs.get(unit.lang, unit.lang), n=number)
    return ARow(
        row_no=row_no, is_group_start=False, row_kind="unit", old_doc_code=_format_doc_code(document),
        old_doc_version=document.doc_version,
        location=LocationOut(section=block.section_label, place=place, page=block.page, page_basis=block.page_basis),
        unit_id=unit.id, display_id=unit.display_id, source_text=unit.text, dest_kind="delete", dest_doc_code="",
        dest_doc_title="", dest_location="", dest_number="", dest_is_note=False, confirmed_text="", ai_text="",
        change_type="deleted", remark=labels.toc_remark, status=STATUS_DELETED, confirmed_by=None, confirmed_at=None,
        group_id=None, warnings=[], noise_kind=unit.noise_kind,
    )


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
    """입구 2 출처 없는 새 문장을 (옛 단위 → Translated · Added, 새 문서 쪽 짝 키 → 신규 묶음)으로 가른다(제품 명세 §7.13 줄 규칙 (4)).

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
    numbers = {**number_bullets(index, labels), **number_targets(index, labels)}

    def get_number(target: TargetInfo) -> str:
        return numbers.get(target.id, "")

    added, new_groups = _split_new_targets(snap, _list_new_targets(index, labels))
    texts = build_renumbering(index, labels).texts
    ctx = _AContext(index, labels, get_number, people, _index_translations(snap), added, texts)
    groups: list[list[ARow]] = []
    placed: set[int] = set()
    noise_units = list_noise_units(snap)
    toc_numbers = _number_toc_lines(noise_units)
    # 옛 문서 줄은 원문 순 — 판단 줄(의미 묶음, 첫 단위 순)과 목차 줄(잡음 표시 단위 하나가 한 묶음)을 섞는다
    entries: list[tuple[tuple[int, ...], MeaningRow | UnitInfo]] = [
        (snap.units[meaning.unit_ids[0]].order_key, meaning) for meaning in build_meaning_rows(snap)
    ]
    entries += [(unit.order_key, unit) for unit in noise_units]
    entries.sort(key=lambda entry: entry[0])
    for _, entry in entries:
        if isinstance(entry, UnitInfo):
            groups.append([_build_toc_row(ctx, entry, toc_numbers[entry.id], len(groups) + 1)])
            placed.add(entry.id)
            continue
        groups.append(_build_old_group(ctx, entry, len(groups) + 1))
        placed.update(entry.unit_ids)
        placed.update(cell.id for unit_id in entry.unit_ids for cell in index.cells.get(unit_id, []))
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
    """결과물 A 한 벌(제품 명세 §7.13 A) — lang은 위치 표기·변경 종류 같은 라벨 언어만, people(로그인 ID → 이름)은 확정한 사람 표시용."""
    return [row for group in _build_a_groups(_build_index(snap), LABELS[lang], people) for row in group]


# --- B ---


def build_output_b(snap: BundleSnapshot, lang: Lang) -> FlowGraph:
    """결과물 B 한 벌(제품 명세 §7.13 B) — 옛 문서(줄 수) → 새 문서·삭제·이동·미배정. lang은 노드 라벨 언어만 고른다.

    줄의 처분은 요약과 같은 _get_row_disposition이다: 배정 줄은 보낸 새 문서 집합에 한 번씩(나눔은 한 번, 중복 배정은 보낸 곳마다
    한 번), 삭제·이동·갈 곳 없음(일부만 판단한 줄 포함, 제품 명세 §7.13 요약 숫자)은 그 처분 노드 하나 — 처분 노드 건수가 요약 숫자와 같다
    (삭제 노드는 요약의 deleted + toc_deleted — 목차 줄도 삭제로 흐른다).
    짝의 두 단위가 서로 다른 옛 문서에 있으면(드묾) 줄의 첫 단위 문서로 센다.
    """
    labels = LABELS[lang]
    index = _build_index(snap)
    old_counts: Counter[int] = Counter()
    edge_counts: Counter[tuple[int, str]] = Counter()
    for unit in list_noise_units(snap):
        old_counts[unit.document_id] += 1
        edge_counts[(unit.document_id, DISPOSITION_NODES["delete"])] += 1
    for meaning in build_meaning_rows(snap):
        document_id = snap.units[meaning.unit_ids[0]].document_id
        old_counts[document_id] += 1
        disposition = _get_row_disposition(snap, meaning)
        dests = (
            [f"target:{doc_id}" for doc_id in _list_row_dest_doc_ids(index, meaning)] if disposition == "assigned" else []
        )
        if not dests:
            dests = [DISPOSITION_NODES.get(disposition, "unassigned")]
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


def _format_unit_refs(snap: BundleSnapshot, unit_ids: Iterable[int]) -> str:
    """옛 단위 위치 — "← OLD-1 §5.1, OLD-2 §5.1". 같은 문서·절은 한 번, 절이 없으면 문서 번호만, 단위가 없으면 빈 글."""
    refs = []
    for unit_id in unit_ids:
        unit = snap.units[unit_id]
        code = _format_doc_code(snap.documents[unit.document_id])
        section = snap.blocks[unit.block_id].section_label
        refs.append(f"{code} §{section}" if section else code)
    return "← " + ", ".join(dict.fromkeys(refs)) if refs else ""


def _list_source_unit_ids(snap: BundleSnapshot, target: TargetInfo) -> tuple[int, ...]:
    """줄이 받은 옛 단위 — 번역은 번역 출처 단위 하나다."""
    if target.translation_source_unit_id in snap.units:
        return (target.translation_source_unit_id,)
    return tuple(target.source_unit_ids)


def _format_source_note(index: _Index, target: TargetInfo, labels: OutputLabels) -> str:
    """받은 옛 단위 — "← OLD-1 §5.1, OLD-2 §5.1 (합침)". 번역은 번역 출처 단위."""
    snap = index.snap
    unit_ids = _list_source_unit_ids(snap, target)
    note = _format_unit_refs(snap, unit_ids)
    suffix = {"merged": labels.merged, "split": labels.split, "translated": labels.translated}.get(target.change_type or "")
    return f"{note} {suffix}" if note and suffix else note


def _format_heading_note(snap: BundleSnapshot, headings: Iterable[TargetInfo]) -> str:
    """칸 머리 줄의 칸 제목 출처 — 두 언어 칸 제목의 출처를 원문 순서로 모아 "← OLD-1 §5, OLD-2 §5"(제품 명세 §7.13 칸 제목). 접미 없음."""
    units = {unit_id for heading in headings for unit_id in heading.source_unit_ids}
    return _format_unit_refs(snap, sorted(units, key=lambda unit_id: snap.units[unit_id].order_key))


@dataclass(frozen=True)
class _CContext:
    """결과물 C 한 번 계산의 재료."""

    index: _Index
    labels: OutputLabels
    numbers: dict[int, str]
    # 옛 단위 → 그 줄에 드는 Translated · Added 새 문장(삭제·이동 줄 Remark가 A 묶음과 같은 함수로 짓는다)
    added: dict[int, list[TargetInfo]]
    # Translated · Added 새 문장 → A에서 그 줄이 드는 옛 단위(맞춘 쪽 출처 중 원문에서 가장 앞)
    added_anchor: dict[int, int]
    texts: Mapping[int, str]  # 다시 매긴 글(Renumbering.texts)
    changes: Mapping[int, tuple[str, str]]  # 표·그림 번호 바뀜(Renumbering.changes)


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


def _pick_caption_text(index: _Index, bundle_target: TargetInfo, texts: Mapping[int, str]) -> str | None:
    """표·그림 새 문장의 캡션 글 — 캡션 새 문장마다 다시 매긴 글(texts), 없으면 확정 글, 그것도 없으면 AI 글.

    여러 언어면 한국어·영어 순 줄바꿈 이음, 없으면 None.
    """
    return join_caption_texts(
        (child.lang, texts.get(child.id) or child.confirmed_text or child.ai_text)
        for child in index.children.get(bundle_target.id, [])
        if is_caption_target(child)
    )


def _build_item(ctx: _CContext, target: TargetInfo) -> CItem:
    """C 항목 하나 — 표·그림의 캡션 새 문장은 칸 앞의 자식이다(칸 문장처럼 줄마다 확정 글·AI 글·상태를 싣는다). text는 그 새 문장 자기 글."""
    index = ctx.index
    caption = _pick_caption_text(index, target, ctx.texts) if target.kind in BUNDLE_TARGET_KINDS else None
    text, ai_text = _get_shown_texts(target, ctx.texts)
    change = ctx.changes.get(target.id)
    return CItem(
        target_id=target.id, kind=target.kind, lang=target.lang, text=text, ai_text=ai_text,
        change_type=target.change_type, status=target.status, source_note=_format_source_note(index, target, ctx.labels),
        source_count=len(set(_list_source_unit_ids(index.snap, target))), origin=target.origin, meaning_key=_format_meaning_key(ctx, target),
        number=ctx.numbers.get(target.id), indent_level=target.indent_level,
        number_style=_get_number_style(index, target), cell_row=target.cell_row,
        cell_col=target.cell_col, children=[_build_item(ctx, child) for child in index.children.get(target.id, [])], caption=caption,
        renumber=RenumberOut(from_label=change[0], to_label=change[1]) if change else None,
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


def _build_c_context(snap: BundleSnapshot, labels: OutputLabels) -> _CContext:
    """결과물 C 계산 재료 — 묶음 전체의 색인·번호·Translated · Added 자리. 문서 하나만 지어도 번호는 묶음 전체에서 센다."""
    index = _build_index(snap)
    added, _ = _split_new_targets(snap, _list_new_targets(index, labels))
    renumbering = build_renumbering(index, labels)
    return _CContext(
        index=index, labels=labels, numbers=number_targets(index, labels), added=added,
        added_anchor={target.id: unit_id for unit_id, targets in added.items() for target in targets},
        texts=renumbering.texts, changes=renumbering.changes,
    )


def _list_auto_items(snap: BundleSnapshot, doc: TargetDocInfo, plan: _SectionPlan) -> list[AutoItem]:
    """자동 목록 절(7.2 Work Instructions)의 줄 — 그 SOP의 자식 WI를 To-Be 순서로. 다른 칸과 N/A인 절(상위 칸의 N/A가 덮은 것 포함)은 빈 목록."""
    if plan.kind != KIND_AUTO_LIST or plan.na_reason is not None:
        return []
    children = sorted(
        (child for child in snap.target_docs.values() if child.doc_type == "wi" and child.parent_id == doc.id),
        key=lambda child: (child.order_index, child.id),
    )
    return [AutoItem(code=child.code, title=child.title) for child in children]


def _build_c_doc(ctx: _CContext, doc: TargetDocInfo) -> CDoc:
    """결과물 C의 새 문서 하나 — 결과물 C 전체와 순서 저장 응답이 이것 하나로 짓는다(같은 값이어야 화면이 그 문서만 바꾼다)."""
    snap = ctx.index.snap
    sections = []
    for plan in _plan_sections(ctx.index, doc, ctx.labels):
        items = [_build_item(ctx, target) for target in plan.targets]
        if items or plan.keep_empty:
            sections.append(
                CSection(
                    location_key=plan.key, label=plan.label, number=plan.number, na_reason=plan.na_reason,
                    heading_note=_format_heading_note(snap, plan.headings), items=items,
                    kind=plan.kind, level=plan.level, counts_lines=plan.counts_lines, default_style=plan.default_style,
                    auto_items=_list_auto_items(snap, doc, plan), shows_number=plan.shows_number,
                    deviation_reason=plan.deviation_reason, is_empty_required=plan.is_empty_required,
                )
            )
    parent = snap.target_docs.get(doc.parent_id) if doc.parent_id is not None else None
    return CDoc(
        target_doc_id=doc.id, code=doc.code, title=doc.title, doc_type=doc.doc_type,
        parent_code=parent.code if parent is not None else None, entrance=doc.entrance, sections=sections,
    )


def build_output_c_doc(snap: BundleSnapshot, target_doc_id: int, lang: Lang) -> CDoc | None:
    """결과물 C의 새 문서 하나 — 같은 lang의 build_output_c에서 그 문서와 같은 값(번호·쓸려 나간 번역 반영). 문서가 없으면 None."""
    doc = snap.target_docs.get(target_doc_id)
    if doc is None:
        return None
    return _build_c_doc(_build_c_context(snap, LABELS[lang]), doc)


def build_output_c(snap: BundleSnapshot, lang: Lang) -> COutput:
    """결과물 C 한 벌(제품 명세 §7.13 C) — 새 문서마다 칸별로 받은 새 문장(두 언어와 중립이 한 목록, C 순서), 끝에 삭제·다른 문서로 이동(줄마다 한 번).

    lang은 칸 이름·출처 표기 같은 라벨 언어만 고른다.
    """
    ctx = _build_c_context(snap, LABELS[lang])
    index, labels = ctx.index, ctx.labels
    docs = [_build_c_doc(ctx, doc) for doc in index.doc_order]
    deleted: list[CDeleted] = []
    moved: list[CMoved] = []
    for meaning in build_meaning_rows(snap):
        disposition = _get_row_disposition(snap, meaning)
        if disposition not in DISPOSITION_NODES:
            continue
        # 삭제·이동은 새 문장이 없어(저장 검사) Translated · Added도 없지만, Remark는 A 묶음과 같은 함수로 짓는다
        fields = _describe_disposed_row(index, meaning, labels, _build_old_remark(index, ctx.added, meaning))
        if disposition == "delete":
            deleted.append(CDeleted(**fields))
        else:
            move_target_code = snap.decisions[meaning.unit_ids[0]].move_target_code
            moved.append(CMoved(**fields, move_target_code=move_target_code))
    return COutput(docs=docs, deleted=deleted, moved=moved)


# --- Assign New 칸의 쓰는 중 문서 ---


class BundleCellOut(BaseModel):
    """표 줄의 칸 새 문장 하나 — 글은 확정 글, 없으면 AI 글(결과물 C 표 칸과 같은 규칙). 칸 번역은 같은 자리에 하나 더 있다."""

    target_id: int
    row: int
    col: int
    lang: str
    text: str
    status: str


class BundleTableOut(BaseModel):
    """New 칸이 그리는 표 — 격자 크기와 칸 새 문장(행·열 순)."""

    rows: int
    cols: int
    cells: list[BundleCellOut]


class BundleFigureOut(BaseModel):
    """New 칸이 그리는 그림 — 이미지를 받을 문서와 블록(figures/{block_id})."""

    document_id: int
    block_id: int


def build_bundle_table(grid: dict[str, int] | None, cells: list[BundleCellOut]) -> BundleTableOut:
    """칸 새 문장들을 표 하나로 — 격자는 표 새 문장의 grid와 칸 자리 중 큰 쪽(grid가 낡거나 없어도 칸이 빠지지 않게)."""
    cells = sorted(cells, key=lambda cell: (cell.row, cell.col, cell.target_id))
    rows = max([cell.row + 1 for cell in cells] + [grid["rows"] if grid else 0])
    cols = max([cell.col + 1 for cell in cells] + [grid["cols"] if grid else 0])
    return BundleTableOut(rows=rows, cols=cols, cells=cells)


class ComposedItem(BaseModel):
    target_id: int
    kind: str
    lang: str
    text: str  # 고쳐 쓴 글, 없으면 AI 글, 그것도 없으면(보류한 그림 등) 출처 원문
    status: str
    change_type: str | None
    number: str | None  # 그 문장 자기 번호(칸마다 한 줄, 생략·주석은 None)
    # 아래 셋은 결과물 C 항목(CItem)과 같은 값 — New 칸 템플릿 보기가 글머리 기호 깊이·주석 줄과 한/영 짝(같은 묶음 키)을 읽는다
    number_style: str
    indent_level: int
    meaning_key: str | None
    # 출처 단위 — 번역은 번역 출처 단위(Old 쪽으로 잇는 선과 칩이 쓴다)
    source_unit_ids: list[int]
    table: BundleTableOut | None = None  # 표 줄이면 칸 새 문장 격자
    figure: BundleFigureOut | None = None  # 그림 줄이고 출처 그림에 이미지가 있으면 그 블록
    caption: str | None = None  # 표·그림 줄의 캡션 글(결과물 C와 같은 _pick_caption_text), 없으면 None — New 칸이 표·그림 위에 보인다
    renumber: RenumberOut | None = None  # 표·그림 줄의 번호가 바뀌면 원문 → 새 번호(Renumbering.changes), 같으면 None


class ComposedSection(BaseModel):
    location_key: str
    label: str
    number: str | None
    na_reason: str | None
    heading_note: str  # 칸 제목 출처 — 결과물 C 칸 머리와 같은 "← OLD-1 §5", 없으면 빈 글
    items: list[ComposedItem]
    # 아래 여덟은 결과물 C 칸(CSection)과 같은 값이다
    kind: OutlineKind | None
    level: int
    counts_lines: bool
    default_style: NumberStyle
    auto_items: list[AutoItem] = []
    shows_number: bool = True
    deviation_reason: str | None = None
    is_empty_required: bool = False


class ComposedDoc(BaseModel):
    target_doc_id: int
    code: str
    title: str
    doc_type: str
    entrance: str
    sections: list[ComposedSection]


def _find_figure_block(snap: BundleSnapshot, unit_ids: list[int]) -> BundleFigureOut | None:
    """그림 새 문장이 보일 이미지 — 출처 단위 중 첫 그림 블록이고 이미지가 있는 것. 없으면 None(화면은 자리 상자)."""
    for unit_id in unit_ids:
        unit = snap.units.get(unit_id)
        if unit is None:
            continue
        block = snap.blocks[unit.block_id]
        if block.kind == "figure" and block.has_image:
            return BundleFigureOut(document_id=unit.document_id, block_id=block.id)
    return None


def build_composed_doc(snap: BundleSnapshot, target_doc_id: int, lang: Lang) -> ComposedDoc | None:
    """새 문서 하나를 지금까지의 배정으로 — 결과물 C와 같은 칸·순서(_plan_sections)에 두 언어 새 문장을 함께 싣는다.

    Assign 화면의 New 칸이 아직 쓰지 않은 문서를 미리 보이는 데 쓴다. 칸 새 문장(표 칸)은 따로 줄로 싣지 않고 표 줄의 table에 격자로 싣는다.
    번호는 결과물 C와 같은 한 줄 세기이고, 칸 제목은 항목이 아니라 C처럼 칸 머리의 출처(heading_note)로 싣는다.
    lang은 라벨 언어만 고른다. 문서가 묶음에 없으면 None.
    """
    doc = snap.target_docs.get(target_doc_id)
    if doc is None:
        return None
    labels = LABELS[lang]
    # 결과물 C와 같은 계산 재료 — 번호·다시 매긴 글·묶음 키가 C 항목과 같아야 템플릿 보기가 C와 다른 것을 보이지 않는다
    ctx = _build_c_context(snap, labels)
    index, numbers = ctx.index, ctx.numbers

    def build_item(target: TargetInfo) -> ComposedItem:
        sources = list(target.source_unit_ids)
        if not sources and target.translation_source_unit_id in snap.units:
            sources = [target.translation_source_unit_id]
        text = ctx.texts.get(target.id) or target.confirmed_text or target.ai_text or " ".join(
            strip_number(snap.units[uid].text, snap.units[uid]) for uid in sources if uid in snap.units
        )
        table = None
        if target.kind == "table":
            cells = [
                BundleCellOut(
                    target_id=cell.id, row=cell.cell_row or 0, col=cell.cell_col or 0, lang=cell.lang,
                    text=cell.confirmed_text or cell.ai_text, status=cell.status,
                )
                for cell in index.children.get(target.id, [])
                if not is_caption_target(cell)  # 캡션은 칸이 아니다 — 격자 (0, 0)에 겹쳐 그리지 않는다
            ]
            table = build_bundle_table(target.grid, cells)
        figure = _find_figure_block(snap, [target.new_unit_id] if target.new_unit_id else sources) if target.kind == "figure" else None
        change = ctx.changes.get(target.id)
        return ComposedItem(
            target_id=target.id, kind=target.kind, lang=target.lang, text=text, status=target.status,
            change_type=target.change_type, number=numbers.get(target.id),
            number_style=_get_number_style(index, target), indent_level=target.indent_level,
            meaning_key=_format_meaning_key(ctx, target), source_unit_ids=sources, table=table, figure=figure,
            caption=_pick_caption_text(index, target, ctx.texts) if target.kind in BUNDLE_TARGET_KINDS else None,
            renumber=RenumberOut(from_label=change[0], to_label=change[1]) if change else None,
        )

    sections = [
        ComposedSection(
            location_key=plan.key, label=plan.label, number=plan.number, na_reason=plan.na_reason,
            heading_note=_format_heading_note(snap, plan.headings), items=[build_item(target) for target in plan.targets],
            kind=plan.kind, level=plan.level, counts_lines=plan.counts_lines, default_style=plan.default_style,
            auto_items=_list_auto_items(snap, doc, plan), shows_number=plan.shows_number,
            deviation_reason=plan.deviation_reason, is_empty_required=plan.is_empty_required,
        )
        for plan in _plan_sections(index, doc, labels)
        if plan.targets or plan.keep_empty
    ]
    return ComposedDoc(
        target_doc_id=doc.id, code=doc.code, title=doc.title, doc_type=doc.doc_type, entrance=doc.entrance,
        sections=sections,
    )


# --- 요약 ---


def build_summary(snap: BundleSnapshot) -> Summary:
    """요약 숫자 한 벌(제품 명세 §7.13 요약 숫자) — 줄은 진행 숫자와 같은 의미 묶음, 줄의 처분은 구성 단위가 모두 같을 때 그 값(아니면 미배정).

    목차 줄은 결과물 A의 줄처럼 old_rows·assigned에 더하고 toc_deleted로 따로 센다(Summary 참고).
    확정률은 판단 줄의 상태 기준(소수 넷째 자리, 줄이 없으면 0). 번역은 결과물 A 묶음 짓기를 그대로 센다.
    """
    index = _build_index(snap)
    rows = build_meaning_rows(snap)
    dispositions = Counter(_get_row_disposition(snap, meaning) for meaning in rows)
    confirmed = sum(meaning.status == "confirmed" for meaning in rows)
    toc_rows = len(list_noise_units(snap))
    labels = LABELS["en"]  # 숫자만 세므로 라벨 언어는 결과에 닿지 않는다
    groups = _build_a_groups(index, labels, {})
    return Summary(
        old_rows=len(rows) + toc_rows,
        assigned=len(rows) + toc_rows - dispositions["unassigned"],
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
        toc_deleted=toc_rows,
        unwrapped_rows=sum(any(_is_unwrapped_cell(snap.units[unit_id]) for unit_id in meaning.unit_ids) for meaning in rows),
    )


def _is_unwrapped_cell(unit: UnitInfo) -> bool:
    """풀린 표(레이아웃 표)의 칸 줄인가 — 데이터 표의 칸 문장은 표·행 단위에 묶여 판단 줄이 아니다."""
    return unit.kind == "cell_sentence" and unit.group_unit_id is None


# --- 검토 요청 조건 재료 ---


@dataclass(frozen=True)
class ReviewFacts:
    row_status_counts: Counter[str]  # 줄 상태 → 줄 수 (진행 숫자와 같은 규칙 — 짝 하나·짝 없는 단위 하나가 한 줄)
    duplicate_unit_ids: list[int]  # 서로 다른 새 문서 둘 이상으로 간 판단 단위(칸 문장은 표·행 단위로 접는다), id 순
    caption_ref_warnings: tuple[CaptionRefWarning, ...] = ()  # 표·그림 참조 경고(build_renumbering) — 막지 않는다


def build_review_facts(snap: BundleSnapshot) -> ReviewFacts:
    """검토 요청 조건이 읽는 단위 사실 — 요약·결과물과 같은 옛 단위 집합(_build_index)과 같은 보낸 곳 규칙(_group_dests)."""
    index = _build_index(snap)
    counts = Counter(row.status for row in build_meaning_rows(snap))
    duplicates = {_get_decision_unit_id(unit) for unit in index.old_units if len(_group_dests(index, unit)) >= 2}
    return ReviewFacts(
        row_status_counts=counts, duplicate_unit_ids=sorted(duplicates),
        caption_ref_warnings=build_renumbering(index, LABELS["en"]).warnings,  # 경고는 라벨 언어와 무관하다
    )
