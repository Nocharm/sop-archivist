"""SOP 골격 — 표준 항목(관리자가 고치는 본)과 문서마다의 사본, 사본을 읽는 값 객체 DocOutline(찾기·부모·번호·수준·배정 가능·줄 세기).

칸을 아는 코드는 모두 문서의 사본(DocOutline)에서 읽는다 — 고정 목록을 다시 쓰지 않는다. 위계는 키의 점으로 적는다(부모 = 마지막 점 앞).
"""

import re
from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import NUMBER_BULLET, NUMBERED, OUTLINE_KINDS, NumberStyle
from app.sop.errors import raise_rule
from app.sop.models import OutlineStandardItem, TargetDocOutlineItem
from app.sop.schemas import NO_NUL

KIND_GENERAL = "general"
KIND_CATEGORY_TABLE = "category_table"
KIND_NAMED_CHILDREN = "named_children"
KIND_AUTO_LIST = "auto_list"
KIND_GROUP = "group"
ORIGIN_STANDARD = "standard"
ORIGIN_DECLARED = "declared"
ORIGIN_CUSTOM = "custom"  # 표준에서 벗어나 사용자가 더한 항목(사유가 따른다) — 선언할 수 없는 부모 아래나 최상위
# 직접 줄을 받는 종류 — group은 하위만 두고 auto_list는 앱이 채운다
ASSIGNABLE_KINDS = (KIND_GENERAL, KIND_CATEGORY_TABLE, KIND_NAMED_CHILDREN)
# 하위 항목을 두지 않는 종류 — 표준을 고칠 때 이 종류 아래에 항목을 달지 못한다
LEAF_KINDS = (KIND_GENERAL, KIND_AUTO_LIST)
# 문서마다 하위 항목을 선언하는 종류(6장 절차·9장 부록, 5장 범주) — 선언은 outline_edit, 권장 이름도 이 종류의 것만 화면에 보낸다
DECLARABLE_KINDS = (KIND_NAMED_CHILDREN, KIND_CATEGORY_TABLE)
LABEL_SEPARATOR = " › "  # 라벨에서 상위와 하위 제목 사이("General Requirements › Safety")
# 항목 키의 꼴 — 점으로 위계를 적고 ":"을 쓰지 않는다(프런트가 자리 키를 ":"으로 가른다). frontend lib/outline-admin-model.ts와 같은 값
KEY_PATTERN = re.compile(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*")
MAX_KEY_CHARS = 100  # outline_standard_items.key 열의 길이
MAX_STANDARD_ITEMS = 500  # 한 번에 받는 표준 항목 수 상한 — 요청 하나가 표를 끝없이 키우지 않게


def get_parent_key(key: str) -> str | None:
    """부모 항목의 키 — 마지막 점 앞("a.b.c" → "a.b"), 최상위면 None."""
    parent, _, child = key.rpartition(".")
    return parent if child and parent else None


def build_next_declared_key(parent_key: str, used_keys: Iterable[str]) -> str:
    """새 선언·사용자 항목의 키 "부모.n<수>"(부모가 빈 글이면 최상위 "n<수>") — 수는 그 부모 아래에서 쓴 적 없는 다음 수다(뺀 항목의 키도 센다).

    뺀 키를 다시 쓰면 그 키를 든 옛 판단 단계(되돌리기)가 다른 항목에 줄을 놓는다.
    """
    head = f"{parent_key}." if parent_key else ""
    pattern = re.compile(rf"{re.escape(head)}n(\d+)")
    used = [int(match.group(1)) for key in used_keys if (match := pattern.fullmatch(key)) is not None]
    return f"{head}n{max(used, default=0) + 1}"


def is_deviation(item: "OutlineItemInfo") -> bool:
    """표준에서 벗어난 항목인가 — 사용자 항목, 그리고 이름을 바꾸거나 필수인데 뺀 표준 항목(사유가 남아 있다).

    선택 항목(7.1.x)을 뺀 것·N/A·선언(6장 절차·9장 부록·5장 범주)은 벗어남이 아니다.
    """
    return item.origin == ORIGIN_CUSTOM or (item.origin == ORIGIN_STANDARD and item.deviation_reason is not None)


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

    번호는 남은 항목의 순서에서 센다(number_outline) — 항목을 빼면 뒤 번호가 당겨지고, N/A는 항목을 빼지 않아 번호가 그대로다.
    여기의 번호(get_number)는 모든 항목을 내보낸다고 보고 센 값이다. 결과물과 To-Be 목록은 비어 있는 선택 항목을 빼고 다시 센다
    (list_emitted_keys → number_outline).
    """

    def __init__(self, items: Sequence[OutlineItemInfo]) -> None:
        children: dict[str | None, list[OutlineItemInfo]] = defaultdict(list)
        for item in sorted(items, key=lambda item: (item.order_index, item.key)):
            # 뺀 표준 항목은 되살릴 수 있어 자리를 기억한다(listed_items). 뺀 선언·사용자 항목은 키만 막는 행이라 어디에도 없다
            if not item.is_removed or item.origin == ORIGIN_STANDARD:
                children[get_parent_key(item.key)].append(item)
        ordered: list[OutlineItemInfo] = []
        listed: list[OutlineItemInfo] = []
        pending = children[None][::-1]
        while pending:  # 깊이 먼저 — 부모 바로 뒤에 그 하위가 온다
            item = pending.pop()
            listed.append(item)
            if item.is_removed:  # 빠진 항목은 하위까지 함께 빠진다
                continue
            ordered.append(item)
            pending.extend(children[item.key][::-1])
        self.items: tuple[OutlineItemInfo, ...] = tuple(ordered)
        # items에 뺀 표준 항목(하위는 빼고)을 제자리에 더한 것 — To-Be 목록이 되살리기 단추를 그 자리에 그린다
        self.listed_items: tuple[OutlineItemInfo, ...] = tuple(listed)
        self._by_key = {item.key: item for item in ordered}
        self._numbers = number_outline(self, self._by_key.keys())

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
        """항목 번호("5", "6.1") — 모든 항목을 내보낸다고 보고 센 값. 번호 없는 항목(범주)과 골격에 없는 키는 None."""
        return self._numbers.get(key)

    def get_label(self, key: str, numbers: Mapping[str, str | None] | None = None) -> str:
        """상위부터 이은 영문 제목("General Requirements › Safety") — 새 문서가 영문 제목을 써서 라벨 언어와 상관없다. 골격에 없는 키는 키 그대로.

        하위 머리말(child_prefix)이 있는 항목의 하위는 상위 제목 대신 "Appendix 2. 이름"으로 적는다. 그 번호는 numbers(number_outline의
        결과 — 결과물이 내보낼 항목끼리 센 값)에서 읽고, 넘기지 않으면 모든 항목을 내보낸다고 본 번호다.
        """
        titles: list[str] = []
        current: str | None = key
        while current is not None:
            item = self._by_key.get(current)
            if item is None:
                return key
            prefix = self._find_child_prefix(current)
            if prefix:
                number = (self._numbers if numbers is None else numbers).get(item.key)
                titles.append(f"{prefix} {number}. {item.title_en}" if number else item.title_en)
                break
            titles.append(item.title_en)
            current = get_parent_key(current)
        return LABEL_SEPARATOR.join(reversed(titles))

    def _find_child_prefix(self, key: str) -> str:
        """그 항목의 부모가 하위에 붙이는 머리말("Appendix") — 부모가 없거나 머리말을 두지 않으면 빈 글."""
        parent_key = get_parent_key(key)
        parent = self._by_key.get(parent_key) if parent_key is not None else None
        return parent.child_prefix if parent is not None and parent.kind == KIND_NAMED_CHILDREN else ""

    def shows_number(self, key: str) -> bool:
        """절 머리에 번호를 라벨과 따로 적는가 — 하위 머리말이 있는 항목의 하위(부록)만 거짓이다.

        그 라벨("Appendix 1. 이름")에 번호가 이미 들어 있어 번호까지 적으면 "1 Appendix 1. …"이 된다. 번호 자체는 그대로다(줄 번호의 머리·No.).
        """
        return not self._find_child_prefix(key)

    def is_assignable(self, key: str) -> bool:
        """줄을 직접 놓을 수 있는 항목인가."""
        item = self._by_key.get(key)
        return item is not None and item.kind in ASSIGNABLE_KINDS

    def counts_lines(self, key: str) -> bool:
        """직접 놓인 줄을 세는(번호를 주는) 항목인가 — 범주 표와 하위를 선언하는 종류는 직접 줄을 받되 세지 않는다(세면 하위 제목 번호와 겹친다)."""
        item = self._by_key.get(key)
        return item is not None and item.kind == KIND_GENERAL


def number_outline(outline: DocOutline, emitted_keys: Collection[str]) -> dict[str, str | None]:
    """내보낼 항목(emitted_keys)끼리 센 항목 번호 — 내보내는 항목만 담기고, 번호 없는 항목은 값이 None이다.

    최상위는 순서대로 1…n. 하위는 "부모.n"이되, 범주 표의 하위(범주)는 번호가 없고, 하위 머리말이 있는 항목(부록)의 하위는 부모 번호 없이
    n만 쓴다("Appendix n."). 내보내지 않는 항목은 세지 않아 뒤 번호가 당겨진다(7.1.x는 남은 항목끼리). 부모를 내보내지 않으면 하위도 번호가 없다.
    """
    numbers: dict[str, str | None] = {}
    counts: dict[str | None, int] = defaultdict(int)
    for item in outline.items:  # 위계 순서라 부모가 먼저 온다
        if item.key not in emitted_keys:
            continue
        parent_key = get_parent_key(item.key)
        counts[parent_key] += 1
        position = str(counts[parent_key])
        if parent_key is None:
            numbers[item.key] = position
            continue
        parent = outline.find(parent_key)
        parent_number = numbers.get(parent_key)
        if parent is None or parent.kind == KIND_CATEGORY_TABLE:
            numbers[item.key] = None
        elif parent.kind == KIND_NAMED_CHILDREN and parent.child_prefix:
            numbers[item.key] = position
        else:
            numbers[item.key] = f"{parent_number}.{position}" if parent_number is not None else None
    return numbers


def list_emitted_keys(outline: DocOutline, used_keys: Collection[str], na_keys: Collection[str]) -> set[str]:
    """결과물에 내보낼 항목 — 결과물(outputs)과 To-Be 목록(tobe)이 같은 집합으로 번호를 세어 서로 어긋나지 않는다.

    필수 항목은 비어도 내보낸다(상위를 내보낼 때). 선택 항목(7.1.x)은 줄이나 칸 제목이 있거나(used_keys) 사람이 그 항목을 N/A로
    두었을 때만(na_keys — 상위의 N/A는 치지 않는다) 내보내고, 그때는 상위도 함께 내보낸다.
    """
    forced: set[str] = set()
    for item in outline.items:
        if item.key in used_keys or item.key in na_keys:
            key: str | None = item.key
            while key is not None and key not in forced:
                forced.add(key)
                key = get_parent_key(key)
    emitted: set[str] = set()
    for item in outline.items:  # 위계 순서라 부모의 판정이 먼저 끝난다
        parent_key = get_parent_key(item.key)
        if item.key in forced or (item.is_required and (parent_key is None or parent_key in emitted)):
            emitted.add(item.key)
    return emitted


EMPTY_OUTLINE = DocOutline(())  # SOP가 아닌 문서(WI)의 골격

# 기본 표준 = 회사 SOP 템플릿 1–9장: (키, 영문 제목, 종류, 필수, 기본 번호 표시, 하위 머리말).
# 내용은 글머리 기호가 기본이고 6장 절차와 9장 부록 안만 번호를 센다. 7.1.x는 선택 항목이라 비면 내보내지 않는다
_TEMPLATE_ITEMS: tuple[tuple[str, str, str, bool, NumberStyle, str], ...] = (
    ("purpose", "Purpose", KIND_GENERAL, True, NUMBER_BULLET, ""),
    ("scope", "Scope", KIND_GENERAL, True, NUMBER_BULLET, ""),
    ("definitions", "Definitions", KIND_GENERAL, True, NUMBER_BULLET, ""),
    ("responsibilities", "Responsibilities", KIND_GENERAL, True, NUMBER_BULLET, ""),
    ("general_requirements", "General Requirements", KIND_CATEGORY_TABLE, True, NUMBER_BULLET, ""),
    ("procedures", "Procedures", KIND_NAMED_CHILDREN, True, NUMBERED, ""),
    ("document_relationships", "Document Relationships", KIND_GROUP, True, NUMBER_BULLET, ""),
    ("document_relationships.associated_documents", "Associated Documents", KIND_GROUP, True, NUMBER_BULLET, ""),
    ("document_relationships.associated_documents.form", "Form", KIND_GENERAL, False, NUMBER_BULLET, ""),
    ("document_relationships.associated_documents.visual_aid", "Visual Aid", KIND_GENERAL, False, NUMBER_BULLET, ""),
    (
        "document_relationships.associated_documents.training_material", "Training Material", KIND_GENERAL, False,
        NUMBER_BULLET, "",
    ),
    (
        "document_relationships.associated_documents.quality_risk_assessment", "Quality Risk Assessment", KIND_GENERAL,
        False, NUMBER_BULLET, "",
    ),
    ("document_relationships.work_instructions", "Work Instructions", KIND_AUTO_LIST, True, NUMBER_BULLET, ""),
    ("document_relationships.references", "References", KIND_GENERAL, True, NUMBER_BULLET, ""),
    ("attachments", "Attachments", KIND_GENERAL, True, NUMBER_BULLET, ""),
    ("appendices", "Appendices", KIND_NAMED_CHILDREN, True, NUMBERED, "Appendix"),
)
TEMPLATE_OUTLINE: tuple[OutlineItemInfo, ...] = tuple(
    OutlineItemInfo(
        key=key, title_en=title, title_ko="", kind=kind, is_required=is_required, default_style=default_style,
        child_prefix=child_prefix, order_index=position, origin=ORIGIN_STANDARD, is_removed=False, deviation_reason=None,
    )
    for position, (key, title, kind, is_required, default_style, child_prefix) in enumerate(_TEMPLATE_ITEMS)
)
# 표준 항목의 권장 이름 — 5장 범주 후보(템플릿 가이드)와 6장의 장비 SOP용 절 이름
TEMPLATE_SUGGESTIONS: dict[str, tuple[str, ...]] = {
    "general_requirements": (
        "Safety", "Account", "Qualification", "Equipment", "Work", "Excursion/Alarm", "Material", "Training", "Record",
        "Quality", "Caution", "Data Management",
    ),
    "procedures": ("Electronic Record Control", "Troubleshooting", "Maintenance"),
}
# 새 SOP의 사본에 함께 넣는 첫 절차 — 절차를 선언하기 전에도 6장에 번호를 세는 자리(6.1)가 하나 있게(AI 후보 S6·S6.1이 갈 곳)
FIRST_PROCEDURE_PARENT = "procedures"
FIRST_PROCEDURE_KEY = "procedures.p1"
FIRST_PROCEDURE_TITLE = "Procedure 1"


async def seed_outline_standard(session: AsyncSession) -> None:
    """표준 골격 표가 비었을 때만 첫 내용(회사 템플릿)을 넣는다(멱등) — 커밋은 호출부가 한다(문서 사본 만들기가 요청 트랜잭션 안에서도 부른다)."""
    if await session.scalar(select(func.count()).select_from(OutlineStandardItem)):
        return
    session.add_all(
        OutlineStandardItem(
            key=item.key, order_index=item.order_index, title_en=item.title_en, title_ko=item.title_ko, kind=item.kind,
            is_required=item.is_required, default_style=item.default_style, child_prefix=item.child_prefix,
            suggestions=list(TEMPLATE_SUGGESTIONS.get(item.key, ())),
        )
        for item in TEMPLATE_OUTLINE
    )
    await session.flush()


async def load_standard_rows(session: AsyncSession) -> list[OutlineStandardItem]:
    """지금 표준 골격의 줄 — 표가 비어 있으면 먼저 시드한다(기동 시드를 거치지 않은 DB에서도 문서가 골격 없이 생기지 않게)."""
    await seed_outline_standard(session)
    return list(await session.scalars(select(OutlineStandardItem).order_by(OutlineStandardItem.order_index)))


async def load_outline_suggestions(session: AsyncSession) -> dict[str, list[str]]:
    """지금 표준의 권장 이름 — 하위를 선언하는 항목의 키 → 이름들. 권장 이름이 없는 항목은 싣지 않는다(읽기만 해서 시드하지 않는다)."""
    rows = await session.execute(
        select(OutlineStandardItem.key, OutlineStandardItem.suggestions)
        .where(OutlineStandardItem.kind.in_(DECLARABLE_KINDS))
        .order_by(OutlineStandardItem.order_index)
    )
    return {key: list(suggestions) for key, suggestions in rows if suggestions}


class OutlineStandardItemIn(BaseModel):
    """관리자가 보내는 표준 항목 한 줄 — 순서는 목록에서의 자리다(order_index를 받지 않는다).

    key·kind의 꼴은 여기서 막지 않고 replace_outline_standard가 사유를 붙여 거절한다(화면이 사유마다 문구를 보인다).
    """

    key: str
    title_en: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200), NO_NUL]
    title_ko: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200), NO_NUL] = ""
    kind: str
    is_required: bool = True
    default_style: NumberStyle = NUMBERED
    child_prefix: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40), NO_NUL] = ""
    suggestions: list[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200), NO_NUL]
    ] = Field(default_factory=list, max_length=50)


def _check_standard_items(items: Sequence[OutlineStandardItemIn]) -> None:
    """표준 목록의 꼴 — 어긋나면 422 outline_invalid{reason, index(걸린 줄의 자리)}. 부모는 자기보다 앞에 있어야 한다."""
    if not items:
        raise_rule(422, "outline_invalid", reason="empty")
    kinds: dict[str, str] = {}
    for index, item in enumerate(items):
        if len(item.key) > MAX_KEY_CHARS or KEY_PATTERN.fullmatch(item.key) is None:
            raise_rule(422, "outline_invalid", reason="bad_key", index=index)
        if item.key in kinds:
            raise_rule(422, "outline_invalid", reason="duplicate_key", index=index)
        if item.kind not in OUTLINE_KINDS:
            raise_rule(422, "outline_invalid", reason="bad_kind", index=index)
        parent_key = get_parent_key(item.key)
        if parent_key is not None:
            if parent_key not in kinds:
                raise_rule(422, "outline_invalid", reason="missing_parent", index=index)
            if kinds[parent_key] in LEAF_KINDS:
                raise_rule(422, "outline_invalid", reason="children_under_leaf", index=index)
        kinds[item.key] = item.kind


async def replace_outline_standard(session: AsyncSession, items: list[OutlineStandardItemIn]) -> None:
    """표준 골격을 보낸 목록으로 통째로 바꾼다(순서 = 목록 순서) — 커밋은 호출부가 한다.

    이미 만든 문서의 사본(target_doc_outline_items)은 건드리지 않는다. 바꾼 표준은 그 뒤에 만드는 SOP 문서부터 복사된다.
    """
    _check_standard_items(items)
    rows = {row.key: row for row in await session.scalars(select(OutlineStandardItem))}
    for position, item in enumerate(items):
        row = rows.pop(item.key, None)
        if row is None:
            row = OutlineStandardItem(key=item.key)
            session.add(row)
        row.order_index = position
        row.title_en = item.title_en
        row.title_ko = item.title_ko
        row.kind = item.kind
        row.is_required = item.is_required
        row.default_style = item.default_style
        row.child_prefix = item.child_prefix
        row.suggestions = list(item.suggestions)
    for row in rows.values():  # 목록에서 빠진 항목
        await session.delete(row)
    await session.flush()


def build_declared_item(
    parent: OutlineItemInfo, key: str, title_en: str, *, title_ko: str = "", order_index: int = 0
) -> OutlineItemInfo:
    """문서가 선언하는 하위 항목(6장 절차·9장 부록·5장 범주) 하나 — 줄을 받는 일반 항목이고 필수다(비어도 내보내고 번호를 차지한다).

    기본 표시는 부모의 것이다(절차·부록은 번호, 범주는 글머리 기호).
    """
    return OutlineItemInfo(
        key=key, title_en=title_en, title_ko=title_ko, kind=KIND_GENERAL, is_required=True,
        default_style=parent.default_style, child_prefix="", order_index=order_index, origin=ORIGIN_DECLARED,
        is_removed=False, deviation_reason=None,
    )


def build_custom_item(
    parent: OutlineItemInfo | None, key: str, title_en: str, *, title_ko: str, order_index: int, reason: str
) -> OutlineItemInfo:
    """사용자 항목 하나(표준에서 벗어남, 사유가 따른다) — 줄을 받는 일반 항목이고 필수다. 기본 표시는 부모의 것, 최상위면 글머리 기호(템플릿 내용의 기본)."""
    return OutlineItemInfo(
        key=key, title_en=title_en, title_ko=title_ko, kind=KIND_GENERAL, is_required=True,
        default_style=parent.default_style if parent is not None else NUMBER_BULLET, child_prefix="",
        order_index=order_index, origin=ORIGIN_CUSTOM, is_removed=False, deviation_reason=reason,
    )


def build_new_doc_items(standard: Sequence[OutlineItemInfo]) -> list[OutlineItemInfo]:
    """새 SOP 문서가 받을 골격 — 표준 그대로에, 6장(하위를 선언하는 `procedures`)이 표준에서 비어 있으면 첫 절차 "Procedure 1"을 더한다."""
    items = list(standard)
    parent = next((item for item in items if item.key == FIRST_PROCEDURE_PARENT), None)
    has_children = any(get_parent_key(item.key) == FIRST_PROCEDURE_PARENT for item in items)
    if parent is not None and parent.kind == KIND_NAMED_CHILDREN and not has_children:
        items.append(build_declared_item(parent, FIRST_PROCEDURE_KEY, FIRST_PROCEDURE_TITLE))
    return items


async def _build_new_doc_items(session: AsyncSession) -> list[OutlineItemInfo]:
    """지금 표준으로 새 SOP 문서가 받을 골격."""
    return build_new_doc_items(
        [
            OutlineItemInfo(
                key=row.key, title_en=row.title_en, title_ko=row.title_ko, kind=row.kind, is_required=row.is_required,
                default_style=row.default_style, child_prefix=row.child_prefix, order_index=row.order_index,
                origin=ORIGIN_STANDARD, is_removed=False, deviation_reason=None,
            )
            for row in await load_standard_rows(session)
        ]
    )


async def load_standard_outline(session: AsyncSession) -> DocOutline:
    """새로 만드는 SOP 문서가 받을 사본과 같은 내용의 골격(목록 쓰기가 쓰기 전에 N/A 칸 키를 검사한다)."""
    return DocOutline(await _build_new_doc_items(session))


async def copy_standard_to_doc(session: AsyncSession, target_doc_id: int) -> None:
    """SOP 문서의 골격 사본을 지금 표준으로 만든다 — 그 뒤 표준이 바뀌어도 사본은 그대로다.

    WI였다가 돌아온 문서는 뺀 표시 행(retire_doc_outline)이 남아 있다 — 기본 첫 절차의 키가 그중에 있으면 새 수를 받는다.
    """
    used = set(await session.scalars(
        select(TargetDocOutlineItem.key).where(TargetDocOutlineItem.target_doc_id == target_doc_id)
    ))
    rows = []
    for item in await _build_new_doc_items(session):
        key = item.key
        if key in used:  # 표준 행은 retire_doc_outline이 지웠으니 여기 걸리는 것은 선언 항목(첫 절차)뿐이다
            key = build_next_declared_key(get_parent_key(key) or "", used)
            used.add(key)
        rows.append(TargetDocOutlineItem(
            target_doc_id=target_doc_id, key=key, order_index=item.order_index, title_en=item.title_en,
            title_ko=item.title_ko, kind=item.kind, is_required=item.is_required, default_style=item.default_style,
            child_prefix=item.child_prefix, origin=item.origin,
        ))
    session.add_all(rows)
    await session.flush()


async def retire_doc_outline(session: AsyncSession, target_doc_id: int) -> None:
    """종류가 바뀐 문서의 골격 사본을 걷는다 — 표준 항목은 지우고 선언·사용자 항목은 뺀 표시로 남긴다.

    선언 키를 다시 쓰지 않아야 되돌리기가 옛 줄을 같은 키의 새 항목에 되살리지 않는다(SOP → WI → SOP 뒤 새 절차가 n1을 받는 경우).
    """
    owned = TargetDocOutlineItem.target_doc_id == target_doc_id
    await session.execute(delete(TargetDocOutlineItem).where(owned, TargetDocOutlineItem.origin == ORIGIN_STANDARD))
    await session.execute(
        update(TargetDocOutlineItem).where(owned, TargetDocOutlineItem.origin != ORIGIN_STANDARD).values(is_removed=True)
    )


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
