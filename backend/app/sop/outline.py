"""SOP 골격 — 표준 항목(관리자가 고치는 본)과 문서마다의 사본, 사본을 읽는 값 객체 DocOutline(찾기·부모·번호·수준·배정 가능·줄 세기).

칸을 아는 코드는 모두 문서의 사본(DocOutline)에서 읽는다 — 고정 목록을 다시 쓰지 않는다. 위계는 키의 점으로 적는다(부모 = 마지막 점 앞).
"""

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import NUMBERED, SLOT_KEYS
from app.sop.models import OutlineStandardItem, TargetDocOutlineItem

KIND_GENERAL = "general"
KIND_NAMED_CHILDREN = "named_children"
ORIGIN_STANDARD = "standard"
# 직접 줄을 받는 종류 — group은 하위만 두고 auto_list는 앱이 채운다
ASSIGNABLE_KINDS = (KIND_GENERAL, "category_table", KIND_NAMED_CHILDREN)
LABEL_SEPARATOR = " › "  # 라벨에서 상위와 하위 제목 사이("General Requirements › Safety")


def get_parent_key(key: str) -> str | None:
    """부모 항목의 키 — 마지막 점 앞("a.b.c" → "a.b"), 최상위면 None."""
    parent, _, child = key.rpartition(".")
    return parent if child and parent else None


@dataclass(frozen=True)
class OutlineItemInfo:
    key: str
    title_en: str
    title_ko: str
    kind: str
    is_required: bool
    default_style: str
    child_prefix: str
    order_index: int
    origin: str
    is_removed: bool
    deviation_reason: str | None


class DocOutline:
    """문서 한 건의 골격 — 빠진(is_removed) 항목과 부모가 없는 항목을 뺀 나머지를 위계 순서(부모 바로 뒤에 하위)로 든다.

    번호는 남은 항목의 순서에서 센다(최상위 1, 2 … 하위는 "부모.n") — 항목을 빼면 뒤 번호가 당겨지고, N/A는 항목을 빼지 않아 번호가 그대로다.
    """

    def __init__(self, items: Sequence[OutlineItemInfo]) -> None:
        children: dict[str | None, list[OutlineItemInfo]] = defaultdict(list)
        for item in sorted(items, key=lambda item: (item.order_index, item.key)):
            if not item.is_removed:
                children[get_parent_key(item.key)].append(item)
        ordered: list[OutlineItemInfo] = []
        numbers: dict[str, str] = {}
        pending = [(item, str(position)) for position, item in enumerate(children[None], start=1)][::-1]
        while pending:  # 깊이 먼저 — 부모 바로 뒤에 그 하위가 온다
            item, number = pending.pop()
            ordered.append(item)
            numbers[item.key] = number
            pending.extend(
                [(child, f"{number}.{position}") for position, child in enumerate(children[item.key], start=1)][::-1]
            )
        self.items: tuple[OutlineItemInfo, ...] = tuple(ordered)
        self._by_key = {item.key: item for item in ordered}
        self._numbers = numbers

    def find(self, key: str) -> OutlineItemInfo | None:
        return self._by_key.get(key)

    def list_children(self, key: str | None) -> list[OutlineItemInfo]:
        """바로 아래 항목(순서대로) — key가 None이면 최상위."""
        return [item for item in self.items if get_parent_key(item.key) == key]

    def is_within(self, key: str, ancestor: str) -> bool:
        """key가 ancestor 자신이거나 그 아래인가 — 상위 항목의 N/A는 하위도 덮는다."""
        return key == ancestor or key.startswith(f"{ancestor}.")

    def get_level(self, key: str) -> int:
        """위계 깊이 — 최상위 0."""
        return key.count(".")

    def get_number(self, key: str) -> str | None:
        """항목 번호("5", "5.1") — 골격에 없는 키는 None."""
        return self._numbers.get(key)

    def get_label(self, key: str) -> str:
        """상위부터 이은 영문 제목("General Requirements › Safety") — 새 문서가 영문 제목을 써서 라벨 언어와 상관없다. 골격에 없는 키는 키 그대로."""
        titles: list[str] = []
        current: str | None = key
        while current is not None:
            item = self._by_key.get(current)
            if item is None:
                return key
            titles.append(item.title_en)
            current = get_parent_key(current)
        return LABEL_SEPARATOR.join(reversed(titles))

    def is_assignable(self, key: str) -> bool:
        """줄을 직접 놓을 수 있는 항목인가."""
        item = self._by_key.get(key)
        return item is not None and item.kind in ASSIGNABLE_KINDS

    def counts_lines(self, key: str) -> bool:
        """직접 놓인 줄을 세는(번호를 주는) 항목인가 — 하위를 선언하는 종류는 세면 하위 제목 번호와 겹쳐서 세지 않는다."""
        item = self._by_key.get(key)
        return item is not None and item.kind == KIND_GENERAL


EMPTY_OUTLINE = DocOutline(())  # SOP가 아닌 문서(WI)의 골격

# 옛 15칸의 제목(도메인 문서 §2의 영문 이름) — 라벨은 상위 제목을 앞에 이어 만든다
_LEGACY_TITLES = {
    "purpose": "Purpose",
    "scope": "Scope",
    "definitions": "Definitions",
    "responsibilities": "Responsibilities",
    "general_requirements": "General Requirements",
    "general_requirements.safety": "Safety",
    "general_requirements.operation": "Operation",
    "procedures": "Procedures",
    "procedures.procedure": "Procedure",
    "procedures.electronic_record_control": "Electronic Record Control",
    "procedures.troubleshooting": "Troubleshooting",
    "procedures.maintenance": "Maintenance",
    "document_relationships": "Document Relationships",
    "document_relationships.attachments": "Attachments",
    "document_relationships.appendices": "Appendices",
}

# 표준 골격의 첫 내용 — 옛 고정 15칸 그대로. 하위 칸이 있는 칸(5·6·7)은 직접 줄을 받되 세지 않는다
LEGACY_OUTLINE: tuple[OutlineItemInfo, ...] = tuple(
    OutlineItemInfo(
        key=key, title_en=_LEGACY_TITLES[key], title_ko="",
        kind=KIND_NAMED_CHILDREN if any(other.startswith(f"{key}.") for other in SLOT_KEYS) else KIND_GENERAL,
        is_required=True, default_style=NUMBERED, child_prefix="", order_index=position,
        origin=ORIGIN_STANDARD, is_removed=False, deviation_reason=None,
    )
    for position, key in enumerate(SLOT_KEYS)
)


async def seed_outline_standard(session: AsyncSession) -> None:
    """표준 골격 표가 비었을 때만 첫 내용을 넣는다(멱등) — 커밋은 호출부가 한다(문서 사본 만들기가 요청 트랜잭션 안에서도 부른다)."""
    if await session.scalar(select(func.count()).select_from(OutlineStandardItem)):
        return
    session.add_all(
        OutlineStandardItem(
            key=item.key, order_index=item.order_index, title_en=item.title_en, title_ko=item.title_ko, kind=item.kind,
            is_required=item.is_required, default_style=item.default_style, child_prefix=item.child_prefix, suggestions=[],
        )
        for item in LEGACY_OUTLINE
    )
    await session.flush()


async def _load_standard_rows(session: AsyncSession) -> list[OutlineStandardItem]:
    """지금 표준 골격의 줄 — 표가 비어 있으면 먼저 시드한다(기동 시드를 거치지 않은 DB에서도 문서가 골격 없이 생기지 않게)."""
    await seed_outline_standard(session)
    return list(await session.scalars(select(OutlineStandardItem).order_by(OutlineStandardItem.order_index)))


async def load_standard_outline(session: AsyncSession) -> DocOutline:
    """지금 표준 골격 — 새로 만드는 SOP 문서가 받을 사본과 같은 내용이다(목록 쓰기가 쓰기 전에 N/A 칸 키를 검사한다)."""
    return DocOutline(
        [
            OutlineItemInfo(
                key=row.key, title_en=row.title_en, title_ko=row.title_ko, kind=row.kind, is_required=row.is_required,
                default_style=row.default_style, child_prefix=row.child_prefix, order_index=row.order_index,
                origin=ORIGIN_STANDARD, is_removed=False, deviation_reason=None,
            )
            for row in await _load_standard_rows(session)
        ]
    )


async def copy_standard_to_doc(session: AsyncSession, target_doc_id: int) -> None:
    """SOP 문서의 골격 사본을 지금 표준으로 만든다 — 그 뒤 표준이 바뀌어도 사본은 그대로다."""
    session.add_all(
        TargetDocOutlineItem(
            target_doc_id=target_doc_id, key=row.key, order_index=row.order_index, title_en=row.title_en,
            title_ko=row.title_ko, kind=row.kind, is_required=row.is_required, default_style=row.default_style,
            child_prefix=row.child_prefix, origin=ORIGIN_STANDARD,
        )
        for row in await _load_standard_rows(session)
    )
    await session.flush()


async def load_doc_outlines(session: AsyncSession, doc_ids: Iterable[int]) -> dict[int, DocOutline]:
    """문서별 골격(질의 한 번) — 넘긴 문서마다 하나씩 돌려주고, 사본이 없는 문서(WI)는 빈 골격이다."""
    ids = sorted(set(doc_ids))
    rows: dict[int, list[OutlineItemInfo]] = {doc_id: [] for doc_id in ids}
    if ids:
        for row in await session.scalars(
            select(TargetDocOutlineItem).where(TargetDocOutlineItem.target_doc_id.in_(ids))
        ):
            rows[row.target_doc_id].append(
                OutlineItemInfo(
                    key=row.key, title_en=row.title_en, title_ko=row.title_ko, kind=row.kind,
                    is_required=row.is_required, default_style=row.default_style, child_prefix=row.child_prefix,
                    order_index=row.order_index, origin=row.origin, is_removed=row.is_removed,
                    deviation_reason=row.deviation_reason,
                )
            )
    return {doc_id: DocOutline(items) if items else EMPTY_OUTLINE for doc_id, items in rows.items()}
