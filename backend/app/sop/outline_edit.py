"""문서 골격 사본 고치기 — 문서마다 선언하는 하위 항목(6장 절차·9장 부록·5장 범주)을 더하고, 이름·순서를 바꾸고, 뺀다.

배정 화면의 한 줄 쓰기(API)와 To-Be Excel의 "SOP 절차" 시트가 같은 규칙을 쓴다. 표준 항목의 이름 바꾸기·빼기는 여기서 거절한다
(벗어남은 사유와 함께 따로 다룬다 — 계획 `2026-11-17-template-fit-1-outline-plan.md` 스텝 6).
"""

import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import SLOT_HEADING
from app.sop.detach import sweep_translations
from app.sop.errors import raise_rule
from app.sop.events import record_event
from app.sop.models import Bundle, TargetDoc, TargetDocNaSlot, TargetDocOutlineItem, TargetSentence, TargetTextHistory
from app.sop.outline import (
    DECLARABLE_KINDS,
    FIRST_PROCEDURE_PARENT,
    KIND_NAMED_CHILDREN,
    MAX_KEY_CHARS,
    ORIGIN_STANDARD,
    DocOutline,
    OutlineItemInfo,
    build_declared_item,
    get_parent_key,
    load_doc_outlines,
)
from app.sop.schemas import NO_NUL
from app.sop.tobe import MAX_DB_INT, DocCode, find_blocked_slots, get_target_doc

# 한 부모 아래 선언 항목 수 상한 — To-Be 응답이 모든 문서의 골격을 싣는다. 요청이 한 문서의 골격을 끝없이 키우지 않게
MAX_DECLARED_ITEMS = 200
# Excel "SOP 절차" 시트가 맞추는 부모 항목(6장)
PROCEDURE_PARENT = FIRST_PROCEDURE_PARENT

TitleEn = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200), NO_NUL]
TitleKo = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200), NO_NUL]


class NewOutlineItemIn(BaseModel):
    """선언 항목 하나 — 키는 서버가 짓고("부모.n<수>") 자리는 형제 끝이다."""

    parent_key: Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_KEY_CHARS)]
    title_en: TitleEn
    title_ko: TitleKo = ""


class OutlineItemPatchIn(BaseModel):
    """선언 항목의 고칠 칸 — 보낸 칸만 바꾼다. position은 형제 안의 자리(0부터)이고 형제 수를 넘으면 끝이다."""

    title_en: TitleEn | None = None
    title_ko: TitleKo | None = None
    position: int | None = Field(None, ge=0, le=MAX_DB_INT)


class ProcedureRowIn(BaseModel):
    """Excel "SOP 절차" 시트의 한 줄 — 절차 번호는 그 SOP 안의 순서다."""

    code: DocCode
    number: int = Field(ge=1, le=MAX_DB_INT)
    title_en: TitleEn
    title_ko: TitleKo = ""


@dataclass(frozen=True)
class _Edit:
    """고칠 문서의 골격 — 읽는 값(outline, 뺀 항목이 없다)과 쓰는 행(rows, 뺀 항목의 자리 표시 포함)."""

    outline: DocOutline
    rows: dict[str, TargetDocOutlineItem]


async def _load_rows(session: AsyncSession, target_doc_id: int) -> dict[str, TargetDocOutlineItem]:
    rows = await session.scalars(
        select(TargetDocOutlineItem).where(TargetDocOutlineItem.target_doc_id == target_doc_id)
    )
    return {row.key: row for row in rows}


async def _open_edit(session: AsyncSession, doc: TargetDoc, **context: str) -> _Edit:
    """골격 사본은 SOP에만 있다 — WI는 422 outline_parent_not_declarable(선언할 자리가 없는 문서다)."""
    if doc.doc_type != "sop":
        raise_rule(422, "outline_parent_not_declarable", doc_code=doc.code, **context)
    outline = (await load_doc_outlines(session, [doc.id]))[doc.id]
    return _Edit(outline, await _load_rows(session, doc.id))


def _get_declared_item(edit: _Edit, doc: TargetDoc, key: str) -> OutlineItemInfo:
    """이름·순서를 바꾸거나 뺄 수 있는 항목 — 없는 키(이미 뺀 항목 포함)는 404, 표준에서 온 항목은 422."""
    item = edit.outline.find(key)
    if item is None:
        raise_rule(404, "outline_item_not_found", doc_code=doc.code, key=key)
    # 확인 필요: 표준에서 온 항목은 순서 바꾸기도 거절한다(계획은 이름·빼기만 적었다) — 선언 항목을 그 앞뒤로 옮기는 것은 된다
    if item.origin == ORIGIN_STANDARD:
        raise_rule(422, "outline_standard_item", doc_code=doc.code, key=key)
    return item


def _ensure_title_free(doc: TargetDoc, parent_key: str | None, siblings: Sequence[OutlineItemInfo], title_en: str) -> None:
    """한 부모 아래 영어 제목은 하나씩이다(대소문자 무시) — Excel 가져오기가 영어 제목으로 항목을 짝짓는다."""
    folded = title_en.casefold()
    if any(sibling.title_en.casefold() == folded for sibling in siblings):
        raise_rule(422, "duplicate_outline_title", doc_code=doc.code, parent_key=parent_key)


def _build_next_key(parent_key: str, rows: Mapping[str, TargetDocOutlineItem]) -> str:
    """새 선언 항목의 키 "부모.n<수>" — 수는 그 부모 아래에서 쓴 적 없는 다음 수다.

    뺀 항목의 행이 남아 있어(_retire) 뺀 수도 센다. 뺀 키를 다시 쓰면 그 키를 든 옛 판단 단계(되돌리기)가 다른 항목에 줄을 놓는다.
    """
    pattern = re.compile(rf"{re.escape(parent_key)}\.n(\d+)")
    used = [int(match.group(1)) for key in rows if (match := pattern.fullmatch(key)) is not None]
    return f"{parent_key}.n{max(used, default=0) + 1}"


def _add_row(
    session: AsyncSession, doc: TargetDoc, rows: dict[str, TargetDocOutlineItem], parent: OutlineItemInfo,
    title_en: str, title_ko: str, order_index: int,
) -> None:
    key = _build_next_key(parent.key, rows)
    if len(key) > MAX_KEY_CHARS:  # 관리자가 넣은 긴 부모 키 — 열 길이를 넘는 키를 DB까지 보내지 않는다
        raise_rule(422, "outline_parent_not_declarable", doc_code=doc.code, parent_key=parent.key)
    item = build_declared_item(parent, key, title_en, title_ko=title_ko, order_index=order_index)
    rows[key] = TargetDocOutlineItem(
        target_doc_id=doc.id, key=item.key, order_index=item.order_index, title_en=item.title_en,
        title_ko=item.title_ko, kind=item.kind, is_required=item.is_required, default_style=item.default_style,
        child_prefix=item.child_prefix, origin=item.origin,
    )
    session.add(rows[key])


async def _retire(session: AsyncSession, doc: TargetDoc, row: TargetDocOutlineItem) -> None:
    """선언 항목을 뺀다 — 행은 지우지 않고 뺀 표시(is_removed)로 남겨 그 키를 다시 쓰지 않게 한다(읽는 쪽 DocOutline이 건너뛴다).

    그 항목의 N/A도 함께 지운다. 줄이 있는지는 호출부가 먼저 본다(find_blocked_slots).
    """
    row.is_removed = True
    await session.execute(
        delete(TargetDocNaSlot).where(TargetDocNaSlot.target_doc_id == doc.id, TargetDocNaSlot.slot_key == row.key)
    )


async def _sync_slot_heading_texts(session: AsyncSession, doc: TargetDoc, actor: str) -> None:
    """칸 제목 줄의 글을 지금 골격의 라벨로 맞춘다 — 이름을 바꾼 항목과, 순서 바꾸기·빼기로 번호가 달라진 부록("Appendix n. 이름").

    칸 제목의 글은 늘 칸 이름이다(decisions._resolve_text). 보통 저장처럼 바뀌기 직전 글을 남기고 revision을 올려 낡은 저장을 막는다.
    출처 연결·상태·자리는 건드리지 않는다.
    """
    await session.flush()  # 방금 고친 골격을 읽는다
    outline = (await load_doc_outlines(session, [doc.id]))[doc.id]
    headings = await session.scalars(
        select(TargetSentence).where(TargetSentence.target_doc_id == doc.id, TargetSentence.kind == SLOT_HEADING)
    )
    rewritten: list[int] = []
    for target in headings:
        if target.slot_key is None or outline.find(target.slot_key) is None:
            continue
        label = outline.get_label(target.slot_key)
        if target.confirmed_text == label:
            continue
        session.add(TargetTextHistory(target_id=target.id, previous_text=target.confirmed_text, changed_by=actor))
        target.confirmed_text = label
        target.revision += 1
        rewritten.append(target.id)
    if rewritten:  # 글이 바뀐 새 문장의 번역은 다시 보게 한다(번역은 출처 새 문장을 따른다)
        await sweep_translations(session, doc.bundle_id, rewritten)


async def _finish_edit(session: AsyncSession, bundle: Bundle, doc: TargetDoc, actor: str) -> None:
    """칸 제목 글을 맞추고 To-Be revision을 올려 기록한다 — 목록의 다른 한 줄 쓰기(apply_tobe)와 같은 기록이다."""
    await _sync_slot_heading_texts(session, doc, actor)
    bundle.revision += 1
    record_event(
        session, bundle_id=bundle.id, actor=actor, action="tobe.update", target_type="target_doc", target_ids=[doc.id]
    )


def _list_sibling_keys(rows: Mapping[str, TargetDocOutlineItem], parent_key: str) -> list[str]:
    """그 부모 아래 남은 항목의 키 — 골격 순서(DocOutline과 같은 정렬)."""
    siblings = [row for row in rows.values() if not row.is_removed and get_parent_key(row.key) == parent_key]
    return [row.key for row in sorted(siblings, key=lambda row: (row.order_index, row.key))]


def _write_order(rows: Mapping[str, TargetDocOutlineItem], keys: Sequence[str]) -> None:
    for position, key in enumerate(keys):
        rows[key].order_index = position


# --- 한 줄 쓰기(API) — 커밋은 호출부가 한다 ---


async def add_outline_item(
    session: AsyncSession, bundle: Bundle, target_doc_id: int, body: NewOutlineItemIn, *, actor: str
) -> None:
    """하위를 선언하는 항목(6장·9장·5장) 아래 끝에 항목 하나를 더한다 — 그 밖의 부모는 422 outline_parent_not_declarable."""
    doc = await get_target_doc(session, bundle.id, target_doc_id)
    edit = await _open_edit(session, doc, parent_key=body.parent_key)
    parent = edit.outline.find(body.parent_key)
    if parent is None or parent.kind not in DECLARABLE_KINDS:
        raise_rule(422, "outline_parent_not_declarable", doc_code=doc.code, parent_key=body.parent_key)
    siblings = edit.outline.list_children(parent.key)
    if len(siblings) >= MAX_DECLARED_ITEMS:
        raise_rule(422, "tobe_list_full", limit=MAX_DECLARED_ITEMS)
    _ensure_title_free(doc, parent.key, siblings, body.title_en)
    order_index = max((sibling.order_index for sibling in siblings), default=-1) + 1
    _add_row(session, doc, edit.rows, parent, body.title_en, body.title_ko, order_index)
    await _finish_edit(session, bundle, doc, actor)


async def patch_outline_item(
    session: AsyncSession, bundle: Bundle, target_doc_id: int, key: str, body: OutlineItemPatchIn, *, actor: str
) -> None:
    """선언 항목의 이름·순서를 바꾼다 — 키와 그 항목의 줄(확정·출처 연결·자리)은 그대로이고 번호와 칸 제목 글만 따라간다.

    바뀐 게 없으면 revision을 올리지 않고 기록도 남기지 않는다.
    """
    doc = await get_target_doc(session, bundle.id, target_doc_id)
    edit = await _open_edit(session, doc, key=key)
    item = _get_declared_item(edit, doc, key)
    parent_key = get_parent_key(key)
    row = edit.rows[key]
    is_changed = False
    if body.title_en is not None and body.title_en != row.title_en:
        others = [sibling for sibling in edit.outline.list_children(parent_key) if sibling.key != key]
        _ensure_title_free(doc, parent_key, others, body.title_en)
        row.title_en = body.title_en
        is_changed = True
    if body.title_ko is not None and body.title_ko != row.title_ko:
        row.title_ko = body.title_ko
        is_changed = True
    if body.position is not None:
        before = [sibling.key for sibling in edit.outline.list_children(parent_key)]
        after = [sibling_key for sibling_key in before if sibling_key != item.key]
        after.insert(min(body.position, len(after)), item.key)
        if after != before:
            _write_order(edit.rows, after)
            is_changed = True
    if is_changed:
        await _finish_edit(session, bundle, doc, actor)


async def remove_outline_item(
    session: AsyncSession, bundle: Bundle, target_doc_id: int, key: str, *, actor: str
) -> None:
    """선언 항목을 뺀다 — 줄이나 칸 제목이 놓인 항목은 409 slot_has_targets(N/A로 둘 때와 같은 검사)."""
    doc = await get_target_doc(session, bundle.id, target_doc_id)
    edit = await _open_edit(session, doc, key=key)
    item = _get_declared_item(edit, doc, key)
    blocked = await find_blocked_slots(session, [(doc.code, item.key)], {doc.code: doc})
    if blocked:
        raise_rule(409, "slot_has_targets", slots=blocked)
    await _retire(session, doc, edit.rows[key])
    await _finish_edit(session, bundle, doc, actor)


# --- Excel "SOP 절차" 시트 — 시트에 나온 SOP의 절차 목록을 시트에 맞춘다(tobe.apply_tobe가 검사와 쓰기를 나눠 부른다) ---


@dataclass(frozen=True)
class ProcedurePlan:
    """SOP 하나의 절차 맞추기 — 쓰기 전에 다 정해 거절은 쓰기 전에 끝난다."""

    code: str
    parent: OutlineItemInfo
    wanted: tuple[tuple[str | None, ProcedureRowIn], ...]  # 저장 뒤 순서 — (짝지은 기존 항목의 키 또는 새 항목이면 None, 줄)
    removed: tuple[str, ...]  # 시트에서 빠져 뺄 항목의 키 — 줄이 있는지는 호출부가 본다(find_blocked_slots)


def plan_procedures(
    rows: Sequence[ProcedureRowIn], final_types: Mapping[str, str], get_outline: Callable[[str], DocOutline]
) -> list[ProcedurePlan]:
    """시트의 줄을 SOP마다 묶어 지금 절차와 짝짓는다(영어 제목, 대소문자 무시) — DB를 읽지 않는다.

    get_outline은 문서 번호 → 저장 뒤 그 SOP가 가질 골격. 시트에 나오지 않은 SOP는 계획에 없다(건드리지 않는다).
    거절: 목록에 없는 번호 422 unknown_doc, SOP가 아니거나 6장이 하위를 선언하는 항목이 아니면 422 outline_parent_not_declarable,
    한 SOP 안에 같은 제목 422 duplicate_outline_title, 표준에서 온 절차의 이름을 바꾸거나 빼면 422 outline_standard_item.
    """
    by_code: dict[str, list[ProcedureRowIn]] = {}
    for row in rows:
        by_code.setdefault(row.code, []).append(row)
    plans: list[ProcedurePlan] = []
    for code, doc_rows in by_code.items():
        if code not in final_types:
            raise_rule(422, "unknown_doc", doc_code=code)
        outline = get_outline(code)  # SOP가 아닌 문서에는 표준을 돌려주니 종류를 먼저 본다
        parent = outline.find(PROCEDURE_PARENT) if final_types[code] == "sop" else None
        if parent is None or parent.kind != KIND_NAMED_CHILDREN:
            raise_rule(422, "outline_parent_not_declarable", doc_code=code, parent_key=PROCEDURE_PARENT)
        if len(doc_rows) > MAX_DECLARED_ITEMS:
            raise_rule(422, "tobe_list_full", limit=MAX_DECLARED_ITEMS)
        children = {child.title_en.casefold(): child for child in outline.list_children(parent.key)}
        wanted: dict[str, tuple[str | None, ProcedureRowIn]] = {}
        # 확인 필요: 순서는 절차 번호 순이고 번호가 같으면 시트의 줄 순서다(번호를 고쳐 순서를 바꾸는 쪽을 따랐다)
        for row in sorted(doc_rows, key=lambda row: row.number):
            folded = row.title_en.casefold()
            if folded in wanted:
                raise_rule(422, "duplicate_outline_title", doc_code=code, parent_key=parent.key)
            child = children.get(folded)
            is_renamed = child is not None and (child.title_en, child.title_ko) != (row.title_en, row.title_ko)
            if child is not None and child.origin == ORIGIN_STANDARD and is_renamed:
                raise_rule(422, "outline_standard_item", doc_code=code, key=child.key)
            wanted[folded] = (child.key if child is not None else None, row)
        removed = [child for folded, child in children.items() if folded not in wanted]
        standard = next((child for child in removed if child.origin == ORIGIN_STANDARD), None)
        if standard is not None:
            raise_rule(422, "outline_standard_item", doc_code=code, key=standard.key)
        plans.append(ProcedurePlan(code, parent, tuple(wanted.values()), tuple(child.key for child in removed)))
    return plans


async def apply_procedure_plans(
    session: AsyncSession, plans: Sequence[ProcedurePlan], docs_by_code: Mapping[str, TargetDoc], *, actor: str
) -> set[int]:
    """절차 계획을 쓴다 — 없는 절차를 더하고, 한글 제목(과 영어 제목의 대소문자)을 맞추고, 시트 순서로 놓고, 빠진 절차를 뺀다.

    바뀐 문서의 id를 돌려준다(revision·기록은 호출부 apply_tobe가 한다). 키는 그대로라 줄은 움직이지 않는다.
    """
    changed: set[int] = set()
    for plan in plans:
        doc = docs_by_code[plan.code]
        rows = await _load_rows(session, doc.id)
        before = _list_sibling_keys(rows, plan.parent.key)
        is_changed = bool(plan.removed)
        for position, (key, wanted) in enumerate(plan.wanted):
            if key is None:
                _add_row(session, doc, rows, plan.parent, wanted.title_en, wanted.title_ko, position)
                is_changed = True
                continue
            row = rows[key]
            if (row.title_en, row.title_ko) != (wanted.title_en, wanted.title_ko):
                row.title_en, row.title_ko = wanted.title_en, wanted.title_ko
                is_changed = True
            row.order_index = position
        for key in plan.removed:
            await _retire(session, doc, rows[key])
        if is_changed or _list_sibling_keys(rows, plan.parent.key) != before:
            await _sync_slot_heading_texts(session, doc, actor)
            changed.add(doc.id)
    return changed
