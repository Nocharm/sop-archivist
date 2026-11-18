"""새 문서(To-Be) 목록 — 입력·출력 스키마, 읽기, 검사하며 저장하기(API와 Excel 가져오기가 공용), 올린 새 문서의 목록 줄."""

import re
from collections import Counter
from collections.abc import Callable, Collection
from typing import TYPE_CHECKING, Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field, StringConstraints
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.clock import now
from app.equis.rules import normalize_number
from app.sop.constants import SLOT_HEADING, TARGET_DOC_TYPES, NumberStyle, OutlineKind, OutlineOrigin
from app.sop.errors import raise_rule
from app.sop.events import record_event
from app.sop.models import (
    Bundle,
    Document,
    TargetDoc,
    TargetDocNaSlot,
    TargetSentence,
    WiStep,
)
from app.sop.outline import (
    KIND_AUTO_LIST,
    DocOutline,
    copy_standard_to_doc,
    get_parent_key,
    list_emitted_keys,
    load_doc_outlines,
    load_standard_outline,
    number_outline,
    retire_doc_outline,
)
from app.sop.schemas import NO_NUL

if TYPE_CHECKING:
    from app.sop.tobe_excel import ParsedWorkbook

# 목록 한 번에 실을 줄 수 상한(Excel 가져오기도 같은 값) — 본문이 끝없이 커지지 않게 경계에서 막는다
MAX_TOBE_ROWS = 2000
MAX_DB_INT = 2_147_483_647  # Postgres INTEGER 상한 — 넘는 값이 DB까지 가서 500이 되지 않게

DocCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100), NO_NUL]


def _blank_to_none(value: object) -> object:
    """빈 부모 번호(""·공백)는 "부모 없음"과 같다 — Excel 빈 칸과 JSON null이 같은 뜻이 되게."""
    return None if isinstance(value, str) and not value.strip() else value


class TargetDocIn(BaseModel):
    code: DocCode
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500), NO_NUL] = ""
    # 허용 값은 규칙 검사(invalid_doc_type)가 코드로 거절한다 — 그래야 화면이 사유를 구분한다
    doc_type: str
    parent_code: Annotated[DocCode | None, BeforeValidator(_blank_to_none)] = None
    is_equipment_sop: bool = False
    order_index: int = Field(0, ge=0, le=MAX_DB_INT)


class NaSlotIn(BaseModel):
    code: DocCode
    slot_key: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000), NO_NUL]


class WiStepIn(BaseModel):
    code: DocCode
    step_no: int = Field(ge=1, le=MAX_DB_INT)
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500), NO_NUL] = ""


class ToBeIn(BaseModel):
    """목록 전체의 새 상태. N/A·단계는 이 요청에 나온 문서의 것을 통째로 바꾸므로 생략하지 못한다(실수로 지우지 않게)."""

    revision: int = Field(ge=1)
    docs: list[TargetDocIn] = Field(max_length=MAX_TOBE_ROWS)
    na_slots: list[NaSlotIn] = Field(max_length=MAX_TOBE_ROWS)
    wi_steps: list[WiStepIn] = Field(max_length=MAX_TOBE_ROWS)


class TargetDocOut(BaseModel):
    id: int
    code: str
    title: str
    doc_type: str
    parent_code: str | None
    entrance: str
    is_equipment_sop: bool
    order_index: int
    # 입구 2(match) 문서가 이어진 올린 파일 — assign 문서는 None
    document_id: int | None


class OutlineItemOut(BaseModel):
    """SOP 문서 골격 사본의 한 항목 — 화면이 칸 목록·번호·배정할 수 있는 자리를 이것으로 그린다(고정 목록을 두지 않는다)."""

    code: str  # 새 문서 번호 — 목록의 다른 줄(N/A·단계)과 같은 키
    key: str
    parent_key: str | None
    level: int  # 위계 깊이 — 최상위 0
    number: str | None
    title_en: str
    title_ko: str
    label: str  # 상위부터 이은 제목("General Requirements › Safety")
    kind: OutlineKind
    is_required: bool
    default_style: NumberStyle
    is_assignable: bool
    counts_lines: bool  # 직접 놓인 줄에 번호를 세는가
    shows_number: bool  # 제목 앞에 번호를 따로 적는가 — 라벨에 번호가 든 부록("Appendix 1. 이름")만 거짓
    origin: OutlineOrigin
    is_removed: bool
    deviation_reason: str | None


class ToBeOut(BaseModel):
    revision: int
    docs: list[TargetDocOut]
    na_slots: list[NaSlotIn]
    wi_steps: list[WiStepIn]
    # SOP 문서마다 골격 사본의 항목 — 문서 순서, 그 안은 골격 순서(부모 바로 뒤에 하위). WI는 항목이 없다
    outline_items: list[OutlineItemOut] = []


def _build_outline_items(code: str, outline: DocOutline, numbers: dict[str, str | None]) -> list[OutlineItemOut]:
    """골격 사본의 항목 전부 — 번호(numbers)는 결과물이 내보낼 항목끼리 센 값이라, 비어 있는 선택 항목과 번호 없는 항목(범주)은 None이다."""
    return [
        OutlineItemOut(
            code=code, key=item.key, parent_key=get_parent_key(item.key), level=outline.get_level(item.key),
            number=numbers.get(item.key), title_en=item.title_en, title_ko=item.title_ko,
            label=outline.get_label(item.key, numbers), kind=item.kind, is_required=item.is_required,
            default_style=item.default_style, is_assignable=outline.is_assignable(item.key),
            counts_lines=outline.counts_lines(item.key), shows_number=outline.shows_number(item.key),
            origin=item.origin, is_removed=item.is_removed,
            deviation_reason=item.deviation_reason,
        )
        for item in outline.items
    ]


def _get_outline_position(outline: DocOutline, key: str, default: int) -> int:
    """골격 순서에서 그 키의 자리 — 골격에 없는 키는 default."""
    return next((position for position, item in enumerate(outline.items) if item.key == key), default)


async def _load_used_slot_keys(session: AsyncSession, doc_ids: Collection[int]) -> dict[int, set[str]]:
    """문서별로 줄이나 칸 제목이 놓인 골격 항목 키 — 내보낼 항목(outline.list_emitted_keys)의 재료이고 결과물(outputs._build_index)과 같은 기준이다."""
    used: dict[int, set[str]] = {doc_id: set() for doc_id in doc_ids}
    if doc_ids:
        rows = await session.execute(
            select(TargetSentence.target_doc_id, TargetSentence.slot_key)
            .where(TargetSentence.target_doc_id.in_(doc_ids), TargetSentence.slot_key.is_not(None))
            .distinct()
        )
        for doc_id, slot_key in rows:
            used[doc_id].add(slot_key)
    return used


async def build_tobe_out(session: AsyncSession, bundle: Bundle) -> ToBeOut:
    """묶음의 To-Be 목록을 쿼리 다섯 번(문서·골격·N/A·단계·줄이 놓인 항목)으로 읽는다. 문서는 (순서, id)순, 나머지는 문서 순서를 따른다.

    골격 항목의 번호·라벨은 결과물 C와 같은 값이다 — 비어 있고 N/A도 아닌 선택 항목은 번호가 없고 세지 않는다.
    """
    doc_rows = (
        await session.execute(
            select(TargetDoc, Document.id)
            .outerjoin(Document, Document.target_doc_id == TargetDoc.id)
            .where(TargetDoc.bundle_id == bundle.id)
            .order_by(TargetDoc.order_index, TargetDoc.id)
        )
    ).all()
    code_by_id = {doc.id: doc.code for doc, _ in doc_rows}
    doc_position = {doc.id: position for position, (doc, _) in enumerate(doc_rows)}
    docs = [
        TargetDocOut(
            id=doc.id, code=doc.code, title=doc.title, doc_type=doc.doc_type,
            parent_code=code_by_id.get(doc.parent_id) if doc.parent_id is not None else None,
            entrance=doc.entrance, is_equipment_sop=doc.is_equipment_sop, order_index=doc.order_index,
            document_id=document_id,
        )
        for doc, document_id in doc_rows
    ]

    outlines = await load_doc_outlines(session, list(code_by_id))
    na_rows = await _load_na_rows(session, list(code_by_id))
    na_slots = [
        NaSlotIn(code=code_by_id[row.target_doc_id], slot_key=row.slot_key, reason=row.reason)
        for row in sorted(
            na_rows,
            key=lambda r: (doc_position[r.target_doc_id], _get_outline_position(outlines[r.target_doc_id], r.slot_key, 0)),
        )
    ]
    step_rows = await _load_step_rows(session, list(code_by_id))
    wi_steps = [
        WiStepIn(code=code_by_id[row.target_doc_id], step_no=row.step_no, title=row.title)
        for row in sorted(step_rows, key=lambda r: (doc_position[r.target_doc_id], r.step_no))
    ]
    used_keys = await _load_used_slot_keys(session, [doc.id for doc in docs if outlines[doc.id].items])
    na_keys: dict[int, set[str]] = {}
    for row in na_rows:
        na_keys.setdefault(row.target_doc_id, set()).add(row.slot_key)
    outline_items = [
        item
        for doc in docs
        for item in _build_outline_items(
            doc.code,
            outlines[doc.id],
            number_outline(
                outlines[doc.id],
                list_emitted_keys(outlines[doc.id], used_keys.get(doc.id, ()), na_keys.get(doc.id, ())),
            ),
        )
    ]
    return ToBeOut(
        revision=bundle.revision, docs=docs, na_slots=na_slots, wi_steps=wi_steps, outline_items=outline_items
    )


async def _load_na_rows(session: AsyncSession, doc_ids: Collection[int]) -> list[TargetDocNaSlot]:
    if not doc_ids:
        return []
    return list(await session.scalars(select(TargetDocNaSlot).where(TargetDocNaSlot.target_doc_id.in_(doc_ids))))


async def _load_step_rows(session: AsyncSession, doc_ids: Collection[int]) -> list[WiStep]:
    if not doc_ids:
        return []
    return list(await session.scalars(select(WiStep).where(WiStep.target_doc_id.in_(doc_ids))))


# --- 새 문장 수 질의(지우기·바꾸기 거절의 근거) ---


async def count_targets_in(session: AsyncSession, target_doc_ids: Collection[int]) -> dict[int, int]:
    """새 문서별 새 문장 수 — 문장이 하나라도 있는 문서만 담긴다."""
    if not target_doc_ids:
        return {}
    rows = await session.execute(
        select(TargetSentence.target_doc_id, func.count())
        .where(TargetSentence.target_doc_id.in_(target_doc_ids))
        .group_by(TargetSentence.target_doc_id)
    )
    return {doc_id: count for doc_id, count in rows}


async def _count_targets_by(
    session: AsyncSession, column: InstrumentedAttribute, target_doc_ids: Collection[int]
) -> dict[tuple[int, int | str], int]:
    """(새 문서, 칸 키 또는 단계 번호)별 새 문장 수 — 칸·단계가 없는 문장은 세지 않는다."""
    if not target_doc_ids:
        return {}
    rows = await session.execute(
        select(TargetSentence.target_doc_id, column, func.count())
        .where(TargetSentence.target_doc_id.in_(target_doc_ids), column.is_not(None))
        .group_by(TargetSentence.target_doc_id, column)
    )
    return {(doc_id, key): count for doc_id, key, count in rows}


class PlaceCountOut(BaseModel):
    target_doc_id: int
    # 단계가 없는 자리(SOP의 칸, 단계를 적지 않은 WI)는 None
    wi_step: int | None
    count: int


async def count_targets_by_step(session: AsyncSession, target_doc_ids: Collection[int]) -> list[PlaceCountOut]:
    """(새 문서, WI 단계)별 새 문장 수 — 화면이 지울 수 없는 문서·단계의 지우기 단추를 미리 잠근다. 문장이 있는 자리만 담긴다."""
    if not target_doc_ids:
        return []
    rows = await session.execute(
        select(TargetSentence.target_doc_id, TargetSentence.wi_step, func.count())
        .where(TargetSentence.target_doc_id.in_(target_doc_ids))
        .group_by(TargetSentence.target_doc_id, TargetSentence.wi_step)
    )
    counts = [PlaceCountOut(target_doc_id=doc_id, wi_step=step, count=count) for doc_id, step, count in rows]
    return sorted(counts, key=lambda row: (row.target_doc_id, row.wi_step or 0))


class SlotCountOut(BaseModel):
    target_doc_id: int
    slot_key: str
    count: int  # 칸 항목 수 — 딸린 줄(parent_target_id가 있는 줄: 표 칸 새 문장·캡션)과 칸 제목은 빼고, 언어마다 따로, 상태를 가리지 않는다
    heading_count: int  # 그 칸 제목에 이은 옛 제목 수


async def count_targets_by_slot(session: AsyncSession, target_doc_ids: Collection[int]) -> list[SlotCountOut]:
    """(새 문서, SOP 칸)별 항목 수와 칸 제목 수 — 화면이 N/A로 둘 수 없는 칸을 미리 가린다. 하위 칸의 수는 상위 칸에 더하지 않는다."""
    if not target_doc_ids:
        return []
    is_heading = TargetSentence.kind == SLOT_HEADING
    rows = await session.execute(
        select(
            TargetSentence.target_doc_id,
            TargetSentence.slot_key,
            func.sum(case((is_heading, 0), (TargetSentence.parent_target_id.is_(None), 1), else_=0)),
            func.sum(case((is_heading, 1), else_=0)),
        )
        .where(TargetSentence.target_doc_id.in_(target_doc_ids), TargetSentence.slot_key.is_not(None))
        .group_by(TargetSentence.target_doc_id, TargetSentence.slot_key)
    )
    counts = [
        SlotCountOut(target_doc_id=doc_id, slot_key=slot_key, count=count, heading_count=heading_count)
        for doc_id, slot_key, count, heading_count in rows
        if count or heading_count
    ]
    # 문서 골격에 없는 키는 있어서는 안 되는 자료지만 막힘 판단이 서버와 같도록 싣고 끝에 둔다
    outlines = await load_doc_outlines(session, target_doc_ids)
    return sorted(
        counts,
        key=lambda row: (
            row.target_doc_id,
            _get_outline_position(outlines[row.target_doc_id], row.slot_key, len(outlines[row.target_doc_id].items)),
        ),
    )


# --- 검사하며 저장하기 ---


def _check_list_rules(
    payload: "ToBeIn | ParsedWorkbook",
    existing: list[TargetDoc],
    code_by_id: dict[int, str],
    get_outline: Callable[[str], DocOutline],
) -> dict[str, str]:
    """요청 내용만으로 가려지는 422 규칙을 모두 검사하고, 저장 뒤 목록의 {문서 번호: 종류}를 돌려준다.

    get_outline은 문서 번호 → 저장 뒤 그 SOP 문서가 가질 골격(N/A 칸 키가 그 안에 있어야 한다).
    """
    counts = Counter(item.code for item in payload.docs)
    duplicates = sorted(code for code, count in counts.items() if count > 1)
    if duplicates:
        raise_rule(422, "duplicate_code", codes=duplicates)
    for item in payload.docs:
        if item.doc_type not in TARGET_DOC_TYPES:
            raise_rule(422, "invalid_doc_type", doc_code=item.code)
        if item.is_equipment_sop and item.doc_type != "sop":
            raise_rule(422, "equipment_flag_on_wi", doc_code=item.code)

    # 요청에 실리지 않은 match 문서는 그대로 남으므로 부모·N/A·단계의 대상이 될 수 있다
    final_types = {item.code: item.doc_type for item in payload.docs}
    kept_match = [doc for doc in existing if doc.entrance == "match" and doc.code not in final_types]
    final_types.update({doc.code: doc.doc_type for doc in kept_match})

    for item in payload.docs:
        if item.doc_type == "sop":
            if item.parent_code is not None:
                raise_rule(422, "invalid_parent", doc_code=item.code, parent_code=item.parent_code)
        elif item.parent_code is None or final_types.get(item.parent_code) != "sop":
            raise_rule(422, "invalid_parent", doc_code=item.code, parent_code=item.parent_code)
    for doc in kept_match:
        parent_code = code_by_id.get(doc.parent_id) if doc.parent_id is not None else None
        if parent_code is not None and final_types.get(parent_code) != "sop":
            raise_rule(422, "invalid_parent", doc_code=doc.code, parent_code=parent_code)

    seen_slots: set[tuple[str, str]] = set()
    for row in payload.na_slots or ():
        if row.code not in final_types:
            raise_rule(422, "unknown_doc", doc_code=row.code)
        if final_types[row.code] != "sop":
            raise_rule(422, "na_on_wi", doc_code=row.code)
        item = get_outline(row.code).find(row.slot_key)
        if item is None:
            raise_rule(422, "unknown_slot", doc_code=row.code, slot_key=row.slot_key)
        # N/A는 줄을 받지 않는 묶음 제목(7·7.1)에도 둘 수 있고 하위를 덮는다. 앱이 채우는 자동 목록(7.2)만 사람이 N/A로 두지 못한다
        if item.kind == KIND_AUTO_LIST:
            raise_rule(422, "slot_not_assignable", doc_code=row.code, slot_key=row.slot_key)
        if (row.code, row.slot_key) in seen_slots:
            raise_rule(422, "duplicate_na_slot", doc_code=row.code, slot_key=row.slot_key)
        seen_slots.add((row.code, row.slot_key))

    seen_steps: set[tuple[str, int]] = set()
    for step in payload.wi_steps:
        if step.code not in final_types:
            raise_rule(422, "unknown_doc", doc_code=step.code)
        if final_types[step.code] != "wi":
            raise_rule(422, "steps_on_sop", doc_code=step.code)
        if (step.code, step.step_no) in seen_steps:
            raise_rule(422, "duplicate_step", doc_code=step.code, step_no=step.step_no)
        seen_steps.add((step.code, step.step_no))
    return final_types


def is_within_slot(slot_key: str, slot: str) -> bool:
    """slot_key가 slot 자신이거나 그 하위 칸(`procedures` → `procedures.p1`)인가 — 상위 칸 N/A는 하위 칸도 덮는다."""
    return slot_key == slot or slot_key.startswith(f"{slot}.")


async def find_blocked_slots(
    session: AsyncSession, wanted_na: Collection[tuple[str, str]], by_code: dict[str, TargetDoc]
) -> list[dict[str, str]]:
    """N/A로 표시하거나 골격에서 빼려는 칸(하위 칸 포함) 중 새 문장이 이미 있는 칸 — 새로 만드는 문서에는 문장이 없다."""
    counts = await _count_targets_by(
        session, TargetSentence.slot_key, [by_code[code].id for code, _ in wanted_na if code in by_code]
    )
    return [
        {"doc_code": code, "slot_key": slot_key}
        for code, slot_key in sorted(wanted_na)
        if code in by_code
        and any(
            doc_id == by_code[code].id and is_within_slot(str(used_key), slot_key)
            for (doc_id, used_key), count in counts.items()
            if count
        )
    ]


async def _find_blocked_steps(
    session: AsyncSession,
    step_rows: list[WiStep],
    wanted_steps: Collection[tuple[str, int]],
    scope: set[str],
    code_by_id: dict[int, str],
) -> list[dict[str, str | int]]:
    """이 요청이 다루는 WI에서 빼려는 단계 중 새 문장이 이미 든 단계."""
    scoped = [row for row in step_rows if code_by_id[row.target_doc_id] in scope]
    counts = await _count_targets_by(session, TargetSentence.wi_step, {row.target_doc_id for row in scoped})
    dropped = [
        row for row in scoped
        if (code_by_id[row.target_doc_id], row.step_no) not in wanted_steps
        and counts.get((row.target_doc_id, row.step_no))
    ]
    return [
        {"doc_code": code_by_id[row.target_doc_id], "step_no": row.step_no}
        for row in sorted(dropped, key=lambda r: (code_by_id[r.target_doc_id], r.step_no))
    ]


async def _write_docs(
    session: AsyncSession,
    bundle: Bundle,
    items: list[TargetDocIn],
    by_code: dict[str, TargetDoc],
    removed_ids: set[int],
) -> tuple[dict[str, TargetDoc], set[int]]:
    """문서 줄을 만들고 고치고 지운다. 저장 뒤 {문서 번호: 문서}(지운 문서 포함)와 바뀐 문서 id를 돌려준다.

    골격 사본은 SOP에만 있다 — 새 SOP는 표준을 복사해 받고, WI로 바뀌면 사본을 지우고, SOP로 바뀌면 지금 표준을 다시 복사한다.
    """
    created = {
        item.code: TargetDoc(
            bundle_id=bundle.id, code=item.code, doc_type=item.doc_type, entrance="assign", title=item.title,
            is_equipment_sop=item.is_equipment_sop, order_index=item.order_index,
        )
        for item in items
        if item.code not in by_code
    }
    session.add_all(created.values())
    await session.flush()  # 부모 번호를 id로 풀려면 새 문서의 id가 필요하다
    for doc in created.values():
        if doc.doc_type == "sop":
            await copy_standard_to_doc(session, doc.id)
    docs_by_code = {**by_code, **created}
    changed = {doc.id for doc in created.values()}
    for item in items:
        doc = docs_by_code[item.code]
        if doc.doc_type != item.doc_type:  # 종류가 바뀐 기존 문서 — 문장이 없는 문서만 여기까지 온다(doc_has_targets)
            await retire_doc_outline(session, doc.id)
            if item.doc_type == "sop":
                await copy_standard_to_doc(session, doc.id)
        fields = {
            "title": item.title,
            "doc_type": item.doc_type,
            "parent_id": docs_by_code[item.parent_code].id if item.parent_code is not None else None,
            "is_equipment_sop": item.is_equipment_sop,
            "order_index": item.order_index,
        }
        if any(getattr(doc, name) != value for name, value in fields.items()):
            for name, value in fields.items():
                setattr(doc, name, value)
            changed.add(doc.id)
    if removed_ids:
        # 부모와 자식이 함께 빠질 수 있어 한 문장으로 지운다. N/A·단계는 DB의 ON DELETE CASCADE가 지운다
        await session.execute(delete(TargetDoc).where(TargetDoc.id.in_(sorted(removed_ids))))
        changed |= removed_ids
    return docs_by_code, changed


async def _write_na_rows(
    session: AsyncSession,
    rows: list[TargetDocNaSlot],
    wanted: dict[tuple[str, str], str],
    docs_by_code: dict[str, TargetDoc],
    code_by_id: dict[int, str],
    final_types: dict[str, str],
    scope: set[str],
    replace: bool,
    actor: str,
) -> set[int]:
    """N/A 줄을 (문서, 칸)으로 합치고 바뀐 문서 id를 돌려준다. replace가 아니면 줄을 더하거나 바꾸지 않는다."""
    changed: set[int] = set()
    for row in rows:
        key = (code_by_id[row.target_doc_id], row.slot_key)
        # WI가 된 문서의 N/A는 항상 지운다(Excel 가져오기도 종류를 바꿀 수 있다)
        if final_types.get(key[0]) == "wi" or (replace and key[0] in scope and key not in wanted):
            await session.delete(row)
            changed.add(row.target_doc_id)
        elif key in wanted and row.reason != wanted[key]:
            row.reason, row.set_by, row.set_at = wanted[key], actor, now()  # 사유가 바뀔 때만 표시한 사람을 바꾼다
            changed.add(row.target_doc_id)
    current = {(code_by_id[row.target_doc_id], row.slot_key) for row in rows}
    for (code, slot_key), reason in wanted.items():
        if (code, slot_key) not in current:
            doc_id = docs_by_code[code].id
            session.add(TargetDocNaSlot(target_doc_id=doc_id, slot_key=slot_key, reason=reason, set_by=actor))
            changed.add(doc_id)
    return changed


async def _write_step_rows(
    session: AsyncSession,
    rows: list[WiStep],
    wanted: dict[tuple[str, int], str],
    docs_by_code: dict[str, TargetDoc],
    code_by_id: dict[int, str],
    scope: set[str],
) -> set[int]:
    """WI 단계를 (문서, 번호)로 합친다 — 요청이 가리킨 문서(scope)의 단계는 요청 내용으로 바뀐다. 바뀐 문서 id를 돌려준다."""
    changed: set[int] = set()
    for row in rows:
        key = (code_by_id[row.target_doc_id], row.step_no)
        if key[0] not in scope:
            continue
        if key not in wanted:
            await session.delete(row)
            changed.add(row.target_doc_id)
        elif row.title != wanted[key]:
            row.title = wanted[key]
            changed.add(row.target_doc_id)
    current = {(code_by_id[row.target_doc_id], row.step_no) for row in rows}
    for (code, step_no), title in wanted.items():
        if (code, step_no) not in current:
            doc_id = docs_by_code[code].id
            session.add(WiStep(target_doc_id=doc_id, step_no=step_no, title=title))
            changed.add(doc_id)
    return changed


async def apply_tobe(
    session: AsyncSession,
    bundle: Bundle,
    payload: "ToBeIn | ParsedWorkbook",
    *,
    actor: str,
    source: Literal["api", "excel"],
) -> None:
    """검사한 뒤 목록을 저장하고, 바뀐 게 있으면 묶음 revision을 올려 작업 기록을 남긴다. 커밋과 revision 비교는 호출부가 한다.

    문서는 문서 번호로 기존 줄과 합친다(id 유지). assign 문서만 만들고 고치며, 요청에서 빠진 assign 문서는 지운다.
    match 문서는 종류를 바꿀 수 없고 빠져도 지우지 않는다. N/A와 단계는 이 요청이 가리킨 문서의 것을 통째로 바꾼다
    (N/A가 None이면 건드리지 않는다 — Excel 가져오기). Excel에 "SOP 절차" 시트가 있으면 거기 나온 SOP의 6장 절차를 시트에 맞춘다
    (outline_edit). 모든 검사는 쓰기 전에 끝나 거절된 요청은 아무것도 남기지 않는다.
    """
    # outline_edit이 이 모듈을 들여와 위에서 들이면 순환한다
    from app.sop.outline_edit import apply_procedure_plans, plan_procedures

    existing = list(await session.scalars(select(TargetDoc).where(TargetDoc.bundle_id == bundle.id)))
    by_code = {doc.code: doc for doc in existing}
    code_by_id = {doc.id: doc.code for doc in existing}
    # SOP로 남는 문서는 자기 사본, 새로 생기거나 SOP로 바뀌는 문서는 지금 표준을 받는다
    outlines = await load_doc_outlines(session, [doc.id for doc in existing if doc.doc_type == "sop"])
    standard = await load_standard_outline(session)

    def get_outline(code: str) -> DocOutline:
        doc = by_code.get(code)
        return outlines[doc.id] if doc is not None and doc.id in outlines else standard

    final_types = _check_list_rules(payload, existing, code_by_id, get_outline)
    # 절차 시트는 Excel 가져오기에만 있다 — 시트가 없으면(None) 골격을 건드리지 않는다
    procedure_rows = None if isinstance(payload, ToBeIn) else payload.procedures
    # 파일이 붙은 문서(입구 2)는 구조가 파일의 것이라 절차를 선언하지 않는다 — SOP가 아닌 것으로 넘겨 거절받는다
    match_codes = {doc.code for doc in existing if doc.entrance == "match"}
    declarable_types = {code: "match" if code in match_codes else doc_type for code, doc_type in final_types.items()}
    procedure_plans = plan_procedures(procedure_rows or (), declarable_types, get_outline)

    listed = {item.code: item for item in payload.docs}
    removed = [doc for doc in existing if doc.entrance == "assign" and doc.code not in listed]
    retyped = [doc for doc in existing if doc.code in listed and doc.doc_type != listed[doc.code].doc_type]
    locked = sorted(doc.code for doc in retyped if doc.entrance == "match")
    if locked:
        raise_rule(409, "match_doc_locked", codes=locked)
    counts = await count_targets_in(session, [doc.id for doc in (*removed, *retyped)])
    with_targets = sorted(doc.code for doc in (*removed, *retyped) if counts.get(doc.id))
    if with_targets:
        raise_rule(409, "doc_has_targets", codes=with_targets)

    removed_ids = {doc.id for doc in removed}
    kept_ids = [doc.id for doc in existing if doc.id not in removed_ids]
    replace_na = payload.na_slots is not None
    wanted_na = {(row.code, row.slot_key): row.reason for row in payload.na_slots or ()}
    wanted_steps = {(row.code, row.step_no): row.title for row in payload.wi_steps}
    na_scope = {*listed, *(code for code, _ in wanted_na)}
    step_scope = {*listed, *(code for code, _ in wanted_steps)}
    na_rows = await _load_na_rows(session, kept_ids)
    step_rows = await _load_step_rows(session, kept_ids)
    dropped_slots = {(plan.code, key) for plan in procedure_plans for key in plan.removed}
    blocked_slots = await find_blocked_slots(session, {*wanted_na, *dropped_slots}, by_code)
    if blocked_slots:
        raise_rule(409, "slot_has_targets", slots=blocked_slots)
    blocked_steps = await _find_blocked_steps(session, step_rows, wanted_steps, step_scope, code_by_id)
    if blocked_steps:
        raise_rule(409, "step_has_targets", steps=blocked_steps)

    # --- 여기부터 쓰기 ---
    docs_by_code, changed = await _write_docs(session, bundle, payload.docs, by_code, removed_ids)
    code_by_id = {doc.id: code for code, doc in docs_by_code.items()}
    changed |= await _write_na_rows(
        session, na_rows, wanted_na, docs_by_code, code_by_id, final_types, na_scope, replace_na, actor
    )
    changed |= await _write_step_rows(session, step_rows, wanted_steps, docs_by_code, code_by_id, step_scope)
    changed |= await apply_procedure_plans(session, procedure_plans, docs_by_code, actor=actor)

    if not changed:  # 바뀐 게 없으면 revision을 올리지 않고 기록도 남기지 않는다(멤버 바꾸기와 같은 규칙)
        return
    bundle.revision += 1
    record_event(
        session, bundle_id=bundle.id, actor=actor, action="tobe.update" if source == "api" else "tobe.import",
        target_type="target_doc", target_ids=sorted(changed),
    )


# --- 한 줄 추가·삭제 — 배정 화면에서 보낼 곳을 바로 만들고 지운다 ---
# 지금 목록에 한 줄을 더하거나 뺀 전체를 apply_tobe에 넘긴다. 그래서 검사·기록·revision이 통째 쓰기와 같고,
# 화면이 든 revision을 묻지 않는다(묶음 잠금 안에서 DB의 지금 목록을 읽어 만든다 — 배정 중 revision이 자주 오른다).


class NewDocIn(BaseModel):
    """번호·종류·부모만 받는다 — 제목과 장비 SOP 여부는 Documents 화면의 To-Be 목록에서 채운다."""

    code: DocCode
    doc_type: str
    parent_code: Annotated[DocCode | None, BeforeValidator(_blank_to_none)] = None


class NewStepIn(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500), NO_NUL] = ""


async def _read_list(session: AsyncSession, bundle: Bundle) -> ToBeIn:
    """지금 목록을 통째 쓰기의 입력 모양으로 읽는다."""
    current = await build_tobe_out(session, bundle)
    docs = [
        TargetDocIn(
            code=doc.code, title=doc.title, doc_type=doc.doc_type, parent_code=doc.parent_code,
            is_equipment_sop=doc.is_equipment_sop, order_index=doc.order_index,
        )
        for doc in current.docs
    ]
    # 저장돼 있던 목록이라 다시 검증하지 않는다(줄 수 상한은 더하는 쪽이 본다)
    return ToBeIn.model_construct(
        revision=bundle.revision, docs=docs, na_slots=list(current.na_slots), wi_steps=list(current.wi_steps)
    )


def _ensure_room(rows: Collection[object]) -> None:
    if len(rows) >= MAX_TOBE_ROWS:
        raise_rule(422, "tobe_list_full", limit=MAX_TOBE_ROWS)


async def get_target_doc(session: AsyncSession, bundle_id: int, target_doc_id: int) -> TargetDoc:
    doc = await session.scalar(
        select(TargetDoc).where(TargetDoc.id == target_doc_id, TargetDoc.bundle_id == bundle_id)
    )
    if doc is None:
        raise_rule(404, "target_doc_not_found", target_doc_id=target_doc_id)
    return doc


async def add_tobe_doc(session: AsyncSession, bundle: Bundle, item: NewDocIn, *, actor: str) -> None:
    """목록 끝에 문서 한 줄을 더한다."""
    payload = await _read_list(session, bundle)
    _ensure_room(payload.docs)
    order_index = max((doc.order_index for doc in payload.docs), default=-1) + 1
    payload.docs.append(
        TargetDocIn(code=item.code, doc_type=item.doc_type, parent_code=item.parent_code, order_index=order_index)
    )
    await apply_tobe(session, bundle, payload, actor=actor, source="api")


async def add_wi_step(session: AsyncSession, bundle: Bundle, target_doc_id: int, title: str, *, actor: str) -> None:
    """WI에 단계 한 줄을 더한다. 번호는 가장 큰 번호 다음이다 — 지운 번호를 다시 쓰지 않는다."""
    doc = await get_target_doc(session, bundle.id, target_doc_id)
    payload = await _read_list(session, bundle)
    _ensure_room(payload.wi_steps)
    step_no = max((row.step_no for row in payload.wi_steps if row.code == doc.code), default=0) + 1
    payload.wi_steps.append(WiStepIn(code=doc.code, step_no=step_no, title=title))
    await apply_tobe(session, bundle, payload, actor=actor, source="api")


async def remove_tobe_doc(session: AsyncSession, bundle: Bundle, target_doc_id: int, *, actor: str) -> None:
    """문서 한 줄을 지운다. 문장이 든 문서와 아래 WI가 남은 SOP는 apply_tobe가 거절하고, 올린 파일의 문서는 여기서 거절한다."""
    doc = await get_target_doc(session, bundle.id, target_doc_id)
    if doc.entrance != "assign":
        raise_rule(409, "match_doc_locked", codes=[doc.code])
    payload = await _read_list(session, bundle)
    payload.docs = [item for item in payload.docs if item.code != doc.code]
    payload.na_slots = [row for row in payload.na_slots if row.code != doc.code]
    payload.wi_steps = [row for row in payload.wi_steps if row.code != doc.code]
    await apply_tobe(session, bundle, payload, actor=actor, source="api")


async def remove_wi_step(
    session: AsyncSession, bundle: Bundle, target_doc_id: int, step_no: int, *, actor: str
) -> None:
    """WI 단계 한 줄을 지운다. 문장이 든 단계는 apply_tobe가 거절한다."""
    doc = await get_target_doc(session, bundle.id, target_doc_id)
    payload = await _read_list(session, bundle)
    kept = [row for row in payload.wi_steps if (row.code, row.step_no) != (doc.code, step_no)]
    if len(kept) == len(payload.wi_steps):
        raise_rule(404, "wi_step_not_found", doc_code=doc.code, step_no=step_no)
    payload.wi_steps = kept
    await apply_tobe(session, bundle, payload, actor=actor, source="api")


# --- 줄 하나 고치기 — Documents 화면이 칸마다 바로 저장한다(통째 쓰기의 초안·Save가 없다) ---
# 한 줄 추가·삭제와 같은 길이다: 지금 목록을 읽어 그 줄만 바꾼 전체를 apply_tobe에 넘긴다. 번호만은 줄 id를 지키려고 직접 바꾼다.


class DocPatchIn(BaseModel):
    """목록 줄 하나의 고칠 칸 — 보낸 칸만 바꾼다(부모는 null이 "없음"이라, 보냈는지로 가른다)."""

    code: DocCode | None = None
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500), NO_NUL] | None = None
    doc_type: str | None = None
    parent_code: Annotated[DocCode | None, BeforeValidator(_blank_to_none)] = None
    is_equipment_sop: bool | None = None


class NaReasonIn(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000), NO_NUL]


async def update_tobe_doc(
    session: AsyncSession, bundle: Bundle, target_doc_id: int, patch: DocPatchIn, *, actor: str
) -> None:
    """문서 한 줄의 칸을 고친다. 검사는 통째 쓰기와 같다(apply_tobe).

    번호를 바꾸면 줄 id는 그대로 두고 번호만 바꾼다 — 통째 쓰기는 번호로 줄을 합쳐서, 번호가 바뀌면 지우고 새로 만드는
    것이 된다(문장이 든 줄에서 거절된다). 올린 파일의 줄은 409 match_doc_locked(그 번호는 파일의 번호다).
    종류를 바꾸면 그 줄의 N/A와 단계를 비우고, SOP가 되면 부모도 비운다.
    """
    doc = await get_target_doc(session, bundle.id, target_doc_id)
    sent = patch.model_fields_set
    is_renamed = "code" in sent and patch.code is not None and patch.code != doc.code
    if is_renamed:
        if doc.entrance != "assign":
            raise_rule(409, "match_doc_locked", codes=[doc.code])
        await rename_match_doc(session, bundle, doc.id, patch.code)
        await session.flush()  # 아래에서 읽는 목록에 새 번호가 보이게
    payload = await _read_list(session, bundle)
    revision = bundle.revision
    row = next(item for item in payload.docs if item.code == doc.code)
    if "title" in sent and patch.title is not None:
        row.title = patch.title
    if "doc_type" in sent and patch.doc_type is not None and patch.doc_type != row.doc_type:
        row.doc_type = patch.doc_type
        payload.na_slots = [item for item in payload.na_slots if item.code != doc.code]
        payload.wi_steps = [item for item in payload.wi_steps if item.code != doc.code]
        if patch.doc_type == "sop":
            row.parent_code = None
    if "parent_code" in sent:
        row.parent_code = patch.parent_code
    if "is_equipment_sop" in sent and patch.is_equipment_sop is not None:
        row.is_equipment_sop = patch.is_equipment_sop
    await apply_tobe(session, bundle, payload, actor=actor, source="api")
    if is_renamed and bundle.revision == revision:  # 번호만 바뀌었다 — apply_tobe는 바뀐 게 없어 기록하지 않았다
        record_event(
            session, bundle_id=bundle.id, actor=actor, action="tobe.update",
            target_type="target_doc", target_ids=[doc.id],
        )


async def set_na_slot(
    session: AsyncSession, bundle: Bundle, target_doc_id: int, slot_key: str, reason: str | None, *, actor: str
) -> None:
    """SOP의 칸 하나를 N/A로 두거나(사유와 함께) 되돌린다(reason이 None). 문장이 든 칸은 apply_tobe가 거절한다."""
    doc = await get_target_doc(session, bundle.id, target_doc_id)
    payload = await _read_list(session, bundle)
    payload.na_slots = [item for item in payload.na_slots if (item.code, item.slot_key) != (doc.code, slot_key)]
    if reason is not None:
        _ensure_room(payload.na_slots)
        payload.na_slots.append(NaSlotIn(code=doc.code, slot_key=slot_key, reason=reason))
    await apply_tobe(session, bundle, payload, actor=actor, source="api")


async def rename_wi_step(
    session: AsyncSession, bundle: Bundle, target_doc_id: int, step_no: int, title: str, *, actor: str
) -> None:
    """WI 단계 한 줄의 제목을 고친다."""
    doc = await get_target_doc(session, bundle.id, target_doc_id)
    payload = await _read_list(session, bundle)
    row = next((item for item in payload.wi_steps if (item.code, item.step_no) == (doc.code, step_no)), None)
    if row is None:
        raise_rule(404, "wi_step_not_found", doc_code=doc.code, step_no=step_no)
    payload.wi_steps = [
        WiStepIn(code=item.code, step_no=item.step_no, title=title) if item is row else item for item in payload.wi_steps
    ]
    await apply_tobe(session, bundle, payload, actor=actor, source="api")


# --- 입구 2(match) 새 문서 — 올린 새 문서(side=new)가 목록에 들어오고 나가는 길 ---


async def find_attachable_doc(session: AsyncSession, bundle_id: int, code: str) -> TargetDoc | None:
    """올린 새 문서를 붙일 목록 줄 — 번호가 같고, 배정으로 엮는 줄(assign)이며, 문장이 하나도 없는 줄. 없으면 None.

    번호가 같은 줄에 문장이 이미 있으면 409 doc_in_use(붙이면 그 문장들의 자리가 없어진다 — 먼저 배정을 지우거나 다른
    번호로 올린다). 이미 파일이 붙은 줄(match)은 None을 돌려줘 호출부의 번호 검사가 409 duplicate_code로 거절한다.
    """
    if not code:
        return None
    doc = await session.scalar(select(TargetDoc).where(TargetDoc.bundle_id == bundle_id, TargetDoc.code == code))
    if doc is None or doc.entrance != "assign":
        return None
    if await count_targets_in(session, [doc.id]):
        raise_rule(409, "doc_in_use", doc_code=code)
    return doc


async def check_match_doc(
    session: AsyncSession, bundle_id: int, *, code: str, doc_type: str | None, parent_code: str | None
) -> int | None:
    """올린 새 문서를 목록에 넣을 수 있는지 검사하고 부모 SOP의 id를 돌려준다 — 목록 쓰기와 같은 거절 코드를 쓴다.

    종류가 sop|wi가 아니면 422 invalid_doc_type, SOP에 부모가 있거나 WI의 부모가 이 묶음의 SOP가 아니면 422 invalid_parent,
    번호가 이미 목록에 있으면 409 duplicate_code. 번호가 비면 임시 번호를 문서 id가 정해진 뒤에 붙이므로 번호 검사를 건너뛴다.
    """
    if doc_type not in TARGET_DOC_TYPES:
        raise_rule(422, "invalid_doc_type", doc_code=code)
    parent_id = None
    if doc_type == "sop":
        if parent_code is not None:
            raise_rule(422, "invalid_parent", doc_code=code, parent_code=parent_code)
    else:
        parent = None
        if parent_code is not None:
            parent = await session.scalar(
                select(TargetDoc).where(TargetDoc.bundle_id == bundle_id, TargetDoc.code == parent_code)
            )
        if parent is None or parent.doc_type != "sop":
            raise_rule(422, "invalid_parent", doc_code=code, parent_code=parent_code)
        parent_id = parent.id
    if code:
        await ensure_code_free(session, bundle_id, code)
    return parent_id


async def ensure_code_free(session: AsyncSession, bundle_id: int, code: str) -> None:
    """목록에 같은 번호가 있으면 409 duplicate_code — 올린 새 문서는 목록 줄을 새로 만들 뿐 기존 줄과 합치지 않는다."""
    taken = await session.scalar(select(TargetDoc.id).where(TargetDoc.bundle_id == bundle_id, TargetDoc.code == code))
    if taken is not None:
        raise_rule(409, "duplicate_code", doc_code=code)


def temp_match_code(document_id: int) -> str:
    """번호 없는 새 문서의 목록 번호 — 번호를 지어내지 않고, 사람이 문서 번호를 고칠 때까지 쓰는 임시 번호."""
    return f"NEW-{document_id}"


_TEMP_MATCH_CODE = re.compile(r"NEW-\d+")


def is_temp_match_code(code: str) -> bool:
    """앱이 붙인 임시 번호(NEW-<숫자>)인가 — 앞뒤 빈칸·대소문자를 가리지 않는다. 지어낸 번호라 조회하거나 남에게 보이지 않는다."""
    return _TEMP_MATCH_CODE.fullmatch(normalize_number(code)) is not None


async def add_match_doc(
    session: AsyncSession, bundle: Bundle, *, code: str, title: str, doc_type: str, parent_id: int | None
) -> TargetDoc:
    """입구 2 문서 한 줄을 만들고 묶음 revision을 올린다(목록이 바뀌었다). 검사는 호출부가 check_match_doc으로 먼저 한다."""
    doc = TargetDoc(
        bundle_id=bundle.id, code=code, title=title, doc_type=doc_type, parent_id=parent_id, entrance="match"
    )
    session.add(doc)
    await session.flush()  # 문서가 가리킬 id가 필요하다
    if doc_type == "sop":  # 입구와 상관없이 SOP는 골격 사본을 갖는다 — 파일을 지워 배정 줄로 돌아가도 칸이 있다
        await copy_standard_to_doc(session, doc.id)
    bundle.revision += 1
    return doc


async def rename_match_doc(session: AsyncSession, bundle: Bundle, target_doc_id: int, code: str) -> None:
    """올린 새 문서의 번호를 고치면 그 목록 줄 번호도 같이 바꾼다 — 다른 줄과 겹치면 409 duplicate_code.

    바뀌면 묶음 revision을 올린다(목록이 바뀌었다). 문장·부모·N/A·단계는 줄 id를 가리키므로 번호만 바뀐다.
    """
    doc = await session.get_one(TargetDoc, target_doc_id)  # 문서의 FK가 가리키므로 늘 있다
    if doc.code == code:
        return
    await ensure_code_free(session, bundle.id, code)
    doc.code = code
    bundle.revision += 1


async def release_match_doc(session: AsyncSession, bundle: Bundle, target_doc_id: int, *, document_id: int) -> None:
    """올린 새 문서의 파일을 지울 때 — 목록 줄은 남기고 배정으로 엮는 줄(assign)로 돌린다. 묶음 revision을 올린다.

    줄과 파일은 화면에서 한 줄이다: 파일만 지웠는데 줄(종류·상위 SOP·N/A·단계)까지 사라지면 안 된다. 줄 지우기는 목록의
    지우기가 한다. 번호가 없어 임시 번호(NEW-<문서 id>)로 생긴 줄만은 파일과 함께 지운다 — 그 줄은 파일이 전부다.
    새 문장이 남아 있으면 409 doc_has_targets(이 문서 단위에서 온 새 문장은 호출부가 먼저 떼어 낸다).
    """
    doc = await session.get_one(TargetDoc, target_doc_id)  # 문서의 FK가 가리키므로 늘 있다
    if await count_targets_in(session, [doc.id]):
        raise_rule(409, "doc_has_targets", codes=[doc.code])
    if doc.code != temp_match_code(document_id):
        doc.entrance = "assign"
        bundle.revision += 1
        return
    children = list(
        await session.scalars(select(TargetDoc.code).where(TargetDoc.parent_id == doc.id).order_by(TargetDoc.code))
    )
    if children:
        raise_rule(409, "doc_has_children", codes=children)
    await session.delete(doc)  # N/A·단계는 DB의 ON DELETE CASCADE가 지운다
    bundle.revision += 1
