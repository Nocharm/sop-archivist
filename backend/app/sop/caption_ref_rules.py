"""표·그림 참조 연결의 순수 판정 — 참조 문장(덮는 글 단위)과 대상 표 단위 찾기. 문서 보기(caption_refs)와 결과물(outputs)이 함께 쓴다.

판단·저장 모듈(decisions 등)을 들여오지 않는다 — 스냅숏·결과물이 들여와도 순환이 생기지 않게.
"""

from collections import defaultdict
from collections.abc import Iterable, Sequence
from typing import Protocol

from app.sop.captions import CAPTION_KIND
from app.sop.groups import TABLE_UNIT_KINDS
from app.sop.renumber import read_caption_number

REF_TEXT_KINDS = ("sentence", "heading", "cell_sentence", CAPTION_KIND)
REF_LINKED, REF_DETACHED = "linked", "detached"


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


class _TextUnitShape(Protocol):
    """ORM Unit 행과 snapshot.UnitInfo가 함께 갖는 글 단위 칸."""

    @property
    def id(self) -> int: ...
    @property
    def kind(self) -> str: ...
    @property
    def text(self) -> str: ...
    @property
    def spans(self) -> Sequence[Sequence[int]]: ...


def match_covering_units(refs: Iterable[_RefShape], units: Iterable[_TextUnitShape]) -> dict[int, int]:
    """find_covering_unit_ids의 순수 판정 — units는 활성 단위(글 단위 종류만 본다). 결과물 스냅숏도 이것으로 참조 문장을 찾는다."""
    text_units = [unit for unit in units if unit.kind in REF_TEXT_KINDS]
    spans: dict[int, list[tuple[int, int, int]]] = defaultdict(list)
    for unit in text_units:
        for block_id, start, end in unit.spans:
            spans[block_id].append((start, end, unit.id))
    heads = {unit.id: read_caption_number(unit.text) for unit in text_units if unit.kind == CAPTION_KIND}
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
