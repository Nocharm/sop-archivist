"""표·그림 참조 연결의 순수 판정 — 참조 문장(덮는 글 단위)과 대상 표 단위 찾기. 문서 보기(caption_refs)와 결과물(outputs)이 함께 쓴다.

판단·저장 모듈(decisions 등)을 들여오지 않는다 — 스냅숏·결과물이 들여와도 순환이 생기지 않게.
"""

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from typing import Literal, Protocol

from app.sop.captions import CAPTION_KIND
from app.sop.groups import BUNDLE_UNIT_KINDS, TABLE_UNIT_KINDS
from app.sop.renumber import CaptionKind, NumberToken, find_caption_number

REF_TEXT_KINDS = ("sentence", "heading", "cell_sentence", CAPTION_KIND)
REF_LINKED, REF_DETACHED = "linked", "detached"
NumberedRefMiss = Literal["caption_ref_unresolved", "caption_ref_ambiguous"]


class _CaptionUnitShape(Protocol):
    """ORM Unit 행과 snapshot.UnitInfo가 함께 갖는 캡션·묶음 단위 칸."""

    @property
    def id(self) -> int: ...
    @property
    def kind(self) -> str: ...
    @property
    def text(self) -> str: ...
    @property
    def group_unit_id(self) -> int | None: ...


def get_bundle_kind(unit_kind: str) -> CaptionKind | None:
    """묶음 단위 종류(표·행·그림) → 캡션 번호 종류."""
    if unit_kind in TABLE_UNIT_KINDS:
        return "table"
    return "figure" if unit_kind == "figure" else None


def read_caption_numbers(units: Iterable[_CaptionUnitShape]) -> dict[int, NumberToken]:
    """캡션 단위 id → 자기 번호(renumber.find_caption_number) — 종류는 그 캡션이 달린 묶음(units 안)의 종류. 번호가 없으면 키 없음."""
    units = list(units)
    kinds = {unit.id: get_bundle_kind(unit.kind) for unit in units if unit.kind in BUNDLE_UNIT_KINDS}
    numbers: dict[int, NumberToken] = {}
    for unit in units:
        if unit.kind != CAPTION_KIND:
            continue
        token = find_caption_number(unit.text, kinds.get(unit.group_unit_id) if unit.group_unit_id else None)
        if token is not None:
            numbers[unit.id] = token
    return numbers


def index_caption_groups(units: Iterable[_CaptionUnitShape]) -> dict[tuple[str, int], set[int]]:
    """(종류, 캡션 번호) → 그 번호 캡션이 달린 묶음 단위 ids. units는 한 문서의 활성 단위(묶음이 units 밖이면 세지 않는다)."""
    units = list(units)
    by_id = {unit.id: unit for unit in units}
    groups: dict[tuple[str, int], set[int]] = defaultdict(set)
    for caption_id, token in read_caption_numbers(units).items():
        group_id = by_id[caption_id].group_unit_id
        if group_id is not None and group_id in by_id:
            groups[(token.kind, token.number)].add(group_id)
    return groups


def resolve_numbered_group(
    groups: Mapping[tuple[str, int], set[int]], kind: str, number: int
) -> int | NumberedRefMiss:
    """대상이 저장되지 않은 번호 참조의 묶음 — 그 번호 캡션이 달린 묶음이 정확히 하나면 그것, 없으면 unresolved, 둘 이상이면 ambiguous.

    언어마다 캡션이 따로여도 묶음은 하나로 센다. 올릴 때 잇기·문서 보기 카드·결과물이 모두 이 규칙을 쓴다.
    """
    found = groups.get((kind, number), set())
    if not found:
        return "caption_ref_unresolved"
    return next(iter(found)) if len(found) == 1 else "caption_ref_ambiguous"


class _BundleShape(Protocol):
    """ORM Unit 행과 snapshot.UnitInfo가 함께 갖는 묶음 단위 칸."""

    @property
    def id(self) -> int: ...
    @property
    def kind(self) -> str: ...
    @property
    def table_id(self) -> int | None: ...
    @property
    def row_index(self) -> int | None: ...


def pick_table_unit_id(table_id: int, bundles: Iterable[_BundleShape]) -> int | None:
    """대상 표의 묶음 단위 — 표 단위, 행으로 나눴으면 가장 작은 행. bundles는 활성 묶음 단위."""
    members = [unit for unit in bundles if unit.table_id == table_id and unit.kind in TABLE_UNIT_KINDS]
    tables = [unit for unit in members if unit.kind == "table"]
    if tables:
        return tables[0].id
    rows = sorted(
        (unit for unit in members if unit.kind == "table_row"),
        key=lambda unit: (unit.row_index if unit.row_index is not None else 0, unit.id),
    )
    return rows[0].id if rows else None


class _RefShape(Protocol):
    """ORM CaptionRef 행과 snapshot.CaptionRefInfo가 함께 갖는 칸."""

    @property
    def id(self) -> int: ...
    @property
    def block_id(self) -> int: ...
    @property
    def start(self) -> int: ...
    @property
    def kind(self) -> str: ...
    @property
    def number(self) -> int | None: ...


class _TextUnitShape(_CaptionUnitShape, Protocol):
    """ORM Unit 행과 snapshot.UnitInfo가 함께 갖는 글 단위 칸."""

    @property
    def spans(self) -> Sequence[Sequence[int]]: ...


def match_covering_units(refs: Iterable[_RefShape], units: Iterable[_TextUnitShape]) -> dict[int, int]:
    """find_covering_unit_ids의 순수 판정 — units는 활성 단위(묶음 단위는 캡션 번호 종류에만 쓴다). 결과물 스냅숏도 이것으로 참조 문장을 찾는다."""
    units = list(units)
    text_units = [unit for unit in units if unit.kind in REF_TEXT_KINDS]
    spans: dict[int, list[tuple[int, int, int]]] = defaultdict(list)
    for unit in text_units:
        for block_id, start, end in unit.spans:
            spans[block_id].append((start, end, unit.id))
    heads = read_caption_numbers(units)
    covering: dict[int, int] = {}
    for ref in refs:
        for start, end, unit_id in spans.get(ref.block_id, ()):
            if start <= ref.start < end:
                head = heads.get(unit_id)
                # 올린 뒤 캡션이 된 문장의 머리 번호는 참조가 아니다 — 올릴 때만 잡은 행을 읽을 때 거른다
                if head is None or (ref.kind, ref.number) != (head.kind, head.number):
                    covering[ref.id] = unit_id
                break
    return covering
