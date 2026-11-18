"""문서 골격 사본 고치기 — 선언 항목(6장 절차·9장 부록·5장 범주)을 더하고 이름·순서를 바꾸고 빼며, 표준에서 벗어나는 일(사유가 따른다)을 다룬다.

배정 화면의 한 줄 쓰기(API)와 To-Be Excel의 "SOP 절차" 시트가 같은 규칙을 쓴다. 벗어남(계획 `2026-11-17-template-fit-1-outline-plan.md`
스텝 6)은 셋이다 — 묶음 제목(group) 아래나 최상위에 사용자 항목 더하기, 표준 항목의 영어 제목 바꾸기, 필수 표준 항목 빼기.
셋 다 사유가 없으면 422 deviation_reason_required다. 표준 항목의 순서는 API와 Excel 모두 바꾸지 못한다(422 outline_standard_item).
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import SLOT_HEADING
from app.sop.detach import sweep_translations
from app.sop.errors import raise_rule
from app.sop.events import record_event
from app.sop.models import (
    Bundle,
    OutlineStandardItem,
    TargetDoc,
    TargetDocNaSlot,
    TargetDocOutlineItem,
    TargetSentence,
    TargetTextHistory,
)
from app.sop.outline import (
    DECLARABLE_KINDS,
    FIRST_PROCEDURE_PARENT,
    KIND_NAMED_CHILDREN,
    LEAF_KINDS,
    MAX_KEY_CHARS,
    ORIGIN_CUSTOM,
    ORIGIN_STANDARD,
    DocOutline,
    OutlineItemInfo,
    build_custom_item,
    build_declared_item,
    build_next_declared_key,
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
# 벗어남 사유 — 빈 글은 "보내지 않음"이다(사유가 필요한 쓰기는 422 deviation_reason_required). 길이 상한은 N/A 사유와 같다
Reason = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000), NO_NUL]


class NewOutlineItemIn(BaseModel):
    """항목 하나 — 키는 서버가 짓고("부모.n<수>", 최상위는 "n<수>") 자리는 형제 끝이다.

    부모가 하위를 선언하는 항목이면 선언(사유가 필요 없다), 묶음 제목(group)이거나 빈 글(최상위)이면 사용자 항목이라 사유가 필요하다.
    """

    parent_key: Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_KEY_CHARS)]
    title_en: TitleEn
    title_ko: TitleKo = ""
    reason: Reason = ""


class OutlineItemPatchIn(BaseModel):
    """항목의 고칠 칸 — 보낸 칸만 바꾼다. position은 형제 안의 자리(0부터)이고 형제 수를 넘으면 끝이다.

    is_removed는 표준 항목을 빼거나(True) 되살린다(False) — 선언·사용자 항목의 True는 DELETE와 같다. reason은 벗어나는 쓰기의 사유이고,
    이미 벗어난 항목(이름을 바꾼 표준 항목·사용자 항목)에 사유만 보내면 사유를 고친다.
    """

    title_en: TitleEn | None = None
    title_ko: TitleKo | None = None
    position: int | None = Field(None, ge=0, le=MAX_DB_INT)
    is_removed: bool | None = None
    reason: Reason = ""


class ProcedureRowIn(BaseModel):
    """Excel "SOP 절차" 시트의 한 줄 — 절차 번호는 그 SOP 안의 순서다."""

    code: DocCode
    number: int = Field(ge=1, le=MAX_DB_INT)
    title_en: TitleEn
    title_ko: TitleKo = ""


@dataclass(frozen=True)
class _Edit:
    """고칠 문서의 골격 — 읽는 값(outline, 뺀 항목이 없다)과 쓰는 행(rows, 뺀 항목의 행 포함)."""

    outline: DocOutline
    rows: dict[str, TargetDocOutlineItem]


async def _load_rows(session: AsyncSession, target_doc_id: int) -> dict[str, TargetDocOutlineItem]:
    rows = await session.scalars(
        select(TargetDocOutlineItem).where(TargetDocOutlineItem.target_doc_id == target_doc_id)
    )
    return {row.key: row for row in rows}


async def _open_edit(session: AsyncSession, doc: TargetDoc, **context: str) -> _Edit:
    """골격 사본은 SOP에만 있다 — WI와 파일이 붙은 SOP(입구 2, 구조가 파일의 것)는 422 outline_parent_not_declarable."""
    if doc.doc_type != "sop" or doc.entrance != "assign":
        raise_rule(422, "outline_parent_not_declarable", doc_code=doc.code, **context)
    outline = (await load_doc_outlines(session, [doc.id]))[doc.id]
    return _Edit(outline, await _load_rows(session, doc.id))


def _find_listed_item(edit: _Edit, doc: TargetDoc, key: str) -> OutlineItemInfo:
    """고칠 항목 — 골격에 있는 항목과 뺀 표준 항목(되살릴 수 있다). 없는 키와 뺀 선언·사용자 항목은 404."""
    item = next((listed for listed in edit.outline.listed_items if listed.key == key), None)
    if item is None:
        raise_rule(404, "outline_item_not_found", doc_code=doc.code, key=key)
    return item


def _get_declared_item(edit: _Edit, doc: TargetDoc, key: str) -> OutlineItemInfo:
    """지울 수 있는 항목(선언·사용자 항목) — 없는 키(이미 뺀 항목 포함)는 404, 표준에서 온 항목은 422(빼기는 PATCH is_removed)."""
    item = edit.outline.find(key)
    if item is None:
        raise_rule(404, "outline_item_not_found", doc_code=doc.code, key=key)
    if item.origin == ORIGIN_STANDARD:
        raise_rule(422, "outline_standard_item", doc_code=doc.code, key=key)
    return item


def _ensure_title_free(doc: TargetDoc, parent_key: str | None, siblings: Sequence[OutlineItemInfo], title_en: str) -> None:
    """한 부모 아래 영어 제목은 하나씩이다(대소문자 무시) — Excel 가져오기가 영어 제목으로 항목을 짝짓는다."""
    folded = title_en.casefold()
    if any(sibling.title_en.casefold() == folded for sibling in siblings):
        raise_rule(422, "duplicate_outline_title", doc_code=doc.code, parent_key=parent_key)


def _add_row(
    session: AsyncSession, doc: TargetDoc, rows: dict[str, TargetDocOutlineItem], parent: OutlineItemInfo | None,
    title_en: str, title_ko: str, order_index: int, *, reason: str | None = None,
) -> None:
    """새 항목의 행 — reason이 있으면 사용자 항목(부모가 없으면 최상위), 없으면 선언 항목(부모가 있다).

    키는 뺀 항목의 행도 세어 짓는다(build_next_declared_key — 뺀 수를 다시 쓰지 않는다).
    """
    key = build_next_declared_key(parent.key if parent is not None else "", rows)
    if len(key) > MAX_KEY_CHARS:  # 관리자가 넣은 긴 부모 키 — 열 길이를 넘는 키를 DB까지 보내지 않는다
        raise_rule(422, "outline_parent_not_declarable", doc_code=doc.code, parent_key=parent.key if parent else "")
    item = (
        build_declared_item(parent, key, title_en, title_ko=title_ko, order_index=order_index)
        if reason is None and parent is not None
        else build_custom_item(parent, key, title_en, title_ko=title_ko, order_index=order_index, reason=reason or "")
    )
    rows[key] = TargetDocOutlineItem(
        target_doc_id=doc.id, key=item.key, order_index=item.order_index, title_en=item.title_en,
        title_ko=item.title_ko, kind=item.kind, is_required=item.is_required, default_style=item.default_style,
        child_prefix=item.child_prefix, origin=item.origin, deviation_reason=item.deviation_reason,
    )
    session.add(rows[key])


async def _clear_na_within(session: AsyncSession, doc: TargetDoc, key: str) -> None:
    """그 항목과 하위의 N/A를 지운다 — 빠진 항목은 결과물에 없어 N/A도 둘 곳이 없다."""
    await session.execute(
        delete(TargetDocNaSlot).where(
            TargetDocNaSlot.target_doc_id == doc.id,
            or_(TargetDocNaSlot.slot_key == key, TargetDocNaSlot.slot_key.startswith(f"{key}.", autoescape=True)),
        )
    )


async def _retire(session: AsyncSession, doc: TargetDoc, row: TargetDocOutlineItem) -> None:
    """선언·사용자 항목을 뺀다 — 행은 지우지 않고 뺀 표시(is_removed)로 남겨 그 키를 다시 쓰지 않게 한다(읽는 쪽 DocOutline이 건너뛴다).

    그 항목의 N/A도 함께 지운다. 줄이 있는지는 호출부가 먼저 본다(find_blocked_slots).
    """
    row.is_removed = True
    await _clear_na_within(session, doc, row.key)


async def _ensure_no_lines(session: AsyncSession, doc: TargetDoc, key: str) -> None:
    """그 항목과 하위에 줄이나 칸 제목이 있으면 409 slot_has_targets(N/A로 둘 때와 같은 검사)."""
    blocked = await find_blocked_slots(session, [(doc.code, key)], {doc.code: doc})
    if blocked:
        raise_rule(409, "slot_has_targets", slots=blocked)


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


def _require_reason(doc: TargetDoc, reason: str, **context: str) -> str:
    """벗어나는 쓰기의 사유 — 비면 422 deviation_reason_required."""
    if not reason:
        raise_rule(422, "deviation_reason_required", doc_code=doc.code, **context)
    return reason


async def _load_standard_titles(session: AsyncSession, key: str) -> tuple[str, str] | None:
    """지금 표준의 그 키의 (영어, 한글) 제목 — 표준에 없는 키(관리자가 뺐다)는 None.

    문서 사본은 만든 때의 표준을 복사해 그 뒤 관리자가 표준을 고쳤으면 사본의 처음 제목과 다를 수 있다 — "표준 제목"은 지금 표준의 것이다.
    """
    row = await session.scalar(select(OutlineStandardItem).where(OutlineStandardItem.key == key))
    return (row.title_en, row.title_ko) if row is not None else None


# --- 한 줄 쓰기(API) — 커밋은 호출부가 한다 ---


async def add_outline_item(
    session: AsyncSession, bundle: Bundle, target_doc_id: int, body: NewOutlineItemIn, *, actor: str
) -> None:
    """부모 아래(빈 글이면 최상위) 끝에 항목 하나를 더한다.

    하위를 선언하는 항목(6장·9장·5장) 아래는 선언이고, 묶음 제목(group) 아래와 최상위는 사용자 항목이라 사유가 필요하다.
    없는 부모와 하위를 두지 않는 항목(일반 항목·자동 목록 — 직접 줄과 하위 번호가 겹친다) 아래는 422 outline_parent_not_declarable.
    """
    doc = await get_target_doc(session, bundle.id, target_doc_id)
    edit = await _open_edit(session, doc, parent_key=body.parent_key)
    parent = edit.outline.find(body.parent_key) if body.parent_key else None
    if body.parent_key and (parent is None or parent.kind in LEAF_KINDS):
        raise_rule(422, "outline_parent_not_declarable", doc_code=doc.code, parent_key=body.parent_key)
    is_declaring = parent is not None and parent.kind in DECLARABLE_KINDS
    reason = None if is_declaring else _require_reason(doc, body.reason, parent_key=body.parent_key)
    siblings = edit.outline.list_children(parent.key if parent is not None else None)
    if len(siblings) >= MAX_DECLARED_ITEMS:
        raise_rule(422, "tobe_list_full", limit=MAX_DECLARED_ITEMS)
    _ensure_title_free(doc, parent.key if parent is not None else None, siblings, body.title_en)
    order_index = max((sibling.order_index for sibling in siblings), default=-1) + 1
    _add_row(session, doc, edit.rows, parent, body.title_en, body.title_ko, order_index, reason=reason)
    await _finish_edit(session, bundle, doc, actor)


async def patch_outline_item(
    session: AsyncSession, bundle: Bundle, target_doc_id: int, key: str, body: OutlineItemPatchIn, *, actor: str
) -> None:
    """항목의 이름·순서를 바꾸거나 표준 항목을 빼고 되살린다 — 키와 그 항목의 줄(확정·출처 연결·자리)은 그대로이고 번호와 칸 제목 글만 따라간다.

    바뀐 게 없으면 revision을 올리지 않고 기록도 남기지 않는다.
    """
    doc = await get_target_doc(session, bundle.id, target_doc_id)
    edit = await _open_edit(session, doc, key=key)
    item = _find_listed_item(edit, doc, key)
    if item.origin == ORIGIN_STANDARD:
        is_changed = await _patch_standard_item(session, doc, edit, item, body)
    elif body.is_removed:  # 선언·사용자 항목을 빼는 것은 DELETE와 같다
        await _ensure_no_lines(session, doc, key)
        await _retire(session, doc, edit.rows[key])
        is_changed = True
    else:
        is_changed = _patch_declared_item(doc, edit, item, body)
    if is_changed:
        await _finish_edit(session, bundle, doc, actor)


def _patch_declared_item(doc: TargetDoc, edit: _Edit, item: OutlineItemInfo, body: OutlineItemPatchIn) -> bool:
    """선언·사용자 항목의 이름·순서(와 사용자 항목의 사유) — 이 항목들은 이미 표준 밖이라 이름을 바꿔도 사유가 필요 없다."""
    parent_key = get_parent_key(item.key)
    row = edit.rows[item.key]
    is_changed = False
    if body.title_en is not None and body.title_en != row.title_en:
        others = [sibling for sibling in edit.outline.list_children(parent_key) if sibling.key != item.key]
        _ensure_title_free(doc, parent_key, others, body.title_en)
        row.title_en = body.title_en
        is_changed = True
    if body.title_ko is not None and body.title_ko != row.title_ko:
        row.title_ko = body.title_ko
        is_changed = True
    if row.origin == ORIGIN_CUSTOM and body.reason and body.reason != row.deviation_reason:
        row.deviation_reason = body.reason
        is_changed = True
    if body.position is not None:
        before = [sibling.key for sibling in edit.outline.list_children(parent_key)]
        after = [sibling_key for sibling_key in before if sibling_key != item.key]
        after.insert(min(body.position, len(after)), item.key)
        if after != before:
            _write_order(edit.rows, after)
            is_changed = True
    return is_changed


async def _patch_standard_item(
    session: AsyncSession, doc: TargetDoc, edit: _Edit, item: OutlineItemInfo, body: OutlineItemPatchIn
) -> bool:
    """표준 항목 — 순서는 바꾸지 못한다(422 outline_standard_item). 빼기·되살리기, 이름(벗어남이면 사유), 사유만 고치기.

    필수 항목을 빼면 사유가 필요하고(선택 항목 7.1.x는 벗어남이 아니다), 하위까지 함께 빠진다(줄이 있으면 409). 되살리면 사유가 지워지고
    제목이 지금 표준의 것으로 돌아온다(뺐던 동안 이름이 바뀌어 있었어도). 이름을 지금 표준 제목으로 되돌려도 사유가 지워진다.
    """
    row = edit.rows[item.key]
    if body.position is not None:
        raise_rule(422, "outline_standard_item", doc_code=doc.code, key=item.key)
    if row.is_removed:
        if body.is_removed is not False:  # 빠진 항목은 되살리기 말고는 고칠 것이 없다
            raise_rule(404, "outline_item_not_found", doc_code=doc.code, key=item.key)
        standard = await _load_standard_titles(session, item.key)
        row.is_removed, row.deviation_reason = False, None
        if standard is not None:
            row.title_en, row.title_ko = standard
        return True
    if body.is_removed:
        reason = _require_reason(doc, body.reason, key=item.key) if item.is_required else None
        await _ensure_no_lines(session, doc, item.key)
        row.is_removed, row.deviation_reason = True, reason
        await _clear_na_within(session, doc, item.key)
        return True
    is_changed = False
    if body.title_en is not None and body.title_en != row.title_en:
        parent_key = get_parent_key(item.key)
        others = [sibling for sibling in edit.outline.list_children(parent_key) if sibling.key != item.key]
        _ensure_title_free(doc, parent_key, others, body.title_en)
        standard = await _load_standard_titles(session, item.key)
        is_standard_title = standard is not None and body.title_en == standard[0]
        row.deviation_reason = None if is_standard_title else _require_reason(doc, body.reason, key=item.key)
        row.title_en = body.title_en
        is_changed = True
    elif body.reason and row.deviation_reason is not None and body.reason != row.deviation_reason:
        row.deviation_reason = body.reason  # 이미 벗어난 항목의 사유만 고친다
        is_changed = True
    if body.title_ko is not None and body.title_ko != row.title_ko:  # 한글 제목은 표준 밖 이름이 아니다(템플릿 제목은 영어)
        row.title_ko = body.title_ko
        is_changed = True
    return is_changed


async def remove_outline_item(
    session: AsyncSession, bundle: Bundle, target_doc_id: int, key: str, *, actor: str
) -> None:
    """선언·사용자 항목을 뺀다 — 줄이나 칸 제목이 놓인 항목은 409 slot_has_targets(N/A로 둘 때와 같은 검사).

    표준 항목은 422 outline_standard_item이다 — 표준 항목은 PATCH is_removed로 빼고(사유) 되살린다.
    """
    doc = await get_target_doc(session, bundle.id, target_doc_id)
    edit = await _open_edit(session, doc, key=key)
    item = _get_declared_item(edit, doc, key)
    await _ensure_no_lines(session, doc, item.key)
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
    한 SOP 안에 같은 제목 422 duplicate_outline_title, 표준에서 온 절차의 영어 이름(대소문자 포함)을 바꾸거나 빼거나 표준 절차끼리의
    순서를 바꾸면 422 outline_standard_item — API와 같은 규칙이고, 시트에는 사유 칸이 없어 표준에서 벗어나는 일은 화면에서 한다.
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
        # 순서는 절차 번호 순이고 번호가 같으면 시트의 줄 순서다 — 번호를 고쳐 순서를 바꾼다
        for row in sorted(doc_rows, key=lambda row: row.number):
            folded = row.title_en.casefold()
            if folded in wanted:
                raise_rule(422, "duplicate_outline_title", doc_code=code, parent_key=parent.key)
            child = children.get(folded)
            # 한글 제목은 표준 밖 이름이 아니다(API의 표준 항목 이름 바꾸기와 같다)
            if child is not None and child.origin == ORIGIN_STANDARD and child.title_en != row.title_en:
                raise_rule(422, "outline_standard_item", doc_code=code, key=child.key)
            wanted[folded] = (child.key if child is not None else None, row)
        removed = [child for folded, child in children.items() if folded not in wanted]
        standard = next((child for child in removed if child.origin == ORIGIN_STANDARD), None)
        if standard is not None:
            raise_rule(422, "outline_standard_item", doc_code=code, key=standard.key)
        # 표준 절차끼리의 순서는 그대로여야 한다 — 선언 절차를 그 앞뒤로 옮기는 것은 된다(API의 순서 바꾸기와 같다)
        standard_keys = [child.key for child in children.values() if child.origin == ORIGIN_STANDARD]
        wanted_standard = [key for key, _ in wanted.values() if key in standard_keys]
        moved = next((key for key, expected in zip(wanted_standard, standard_keys) if key != expected), None)
        if moved is not None:
            raise_rule(422, "outline_standard_item", doc_code=code, key=moved)
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
