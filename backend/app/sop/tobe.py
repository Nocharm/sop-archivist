"""새 문서(To-Be) 목록 — 입력·출력 스키마, 읽기, 검사하며 저장하기(API와 Excel 가져오기가 공용)."""

from collections import Counter
from collections.abc import Collection
from typing import TYPE_CHECKING, Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field, StringConstraints
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.clock import now
from app.sop.constants import SLOT_KEYS, TARGET_DOC_TYPES
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

if TYPE_CHECKING:
    from app.sop.tobe_excel import ParsedWorkbook

# 목록 한 번에 실을 줄 수 상한(Excel 가져오기도 같은 값) — 본문이 끝없이 커지지 않게 경계에서 막는다
MAX_TOBE_ROWS = 2000
MAX_DB_INT = 2_147_483_647  # Postgres INTEGER 상한 — 넘는 값이 DB까지 가서 500이 되지 않게

DocCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


def _blank_to_none(value: object) -> object:
    """빈 부모 번호(""·공백)는 "부모 없음"과 같다 — Excel 빈 칸과 JSON null이 같은 뜻이 되게."""
    return None if isinstance(value, str) and not value.strip() else value


class TargetDocIn(BaseModel):
    code: DocCode
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""
    # 허용 값은 규칙 검사(invalid_doc_type)가 코드로 거절한다 — 그래야 화면이 사유를 구분한다
    doc_type: str
    parent_code: Annotated[DocCode | None, BeforeValidator(_blank_to_none)] = None
    is_equipment_sop: bool = False
    order_index: int = Field(0, ge=0, le=MAX_DB_INT)


class NaSlotIn(BaseModel):
    code: DocCode
    slot_key: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class WiStepIn(BaseModel):
    code: DocCode
    step_no: int = Field(ge=1, le=MAX_DB_INT)
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""


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


class ToBeOut(BaseModel):
    revision: int
    docs: list[TargetDocOut]
    na_slots: list[NaSlotIn]
    wi_steps: list[WiStepIn]


async def build_tobe_out(session: AsyncSession, bundle: Bundle) -> ToBeOut:
    """묶음의 To-Be 목록을 쿼리 세 번(문서·N/A·단계)으로 읽는다. 문서는 (순서, id)순, 나머지는 문서 순서를 따른다."""
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

    slot_position = {key: position for position, key in enumerate(SLOT_KEYS)}
    na_rows = await _load_na_rows(session, list(code_by_id))
    na_slots = [
        NaSlotIn(code=code_by_id[row.target_doc_id], slot_key=row.slot_key, reason=row.reason)
        for row in sorted(na_rows, key=lambda r: (doc_position[r.target_doc_id], slot_position.get(r.slot_key, 0)))
    ]
    step_rows = await _load_step_rows(session, list(code_by_id))
    wi_steps = [
        WiStepIn(code=code_by_id[row.target_doc_id], step_no=row.step_no, title=row.title)
        for row in sorted(step_rows, key=lambda r: (doc_position[r.target_doc_id], r.step_no))
    ]
    return ToBeOut(revision=bundle.revision, docs=docs, na_slots=na_slots, wi_steps=wi_steps)


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


# --- 검사하며 저장하기 ---


def _check_list_rules(
    payload: "ToBeIn | ParsedWorkbook", existing: list[TargetDoc], code_by_id: dict[int, str]
) -> dict[str, str]:
    """요청 내용만으로 가려지는 422 규칙을 모두 검사하고, 저장 뒤 목록의 {문서 번호: 종류}를 돌려준다."""
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
        if row.slot_key not in SLOT_KEYS:
            raise_rule(422, "unknown_slot", doc_code=row.code, slot_key=row.slot_key)
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
    """slot_key가 slot 자신이거나 그 하위 칸(`procedures` → `procedures.procedure`)인가 — 상위 칸 N/A는 하위 칸도 덮는다."""
    return slot_key == slot or slot_key.startswith(f"{slot}.")


async def _find_blocked_slots(
    session: AsyncSession, wanted_na: Collection[tuple[str, str]], by_code: dict[str, TargetDoc]
) -> list[dict[str, str]]:
    """N/A로 표시하려는 칸(하위 칸 포함) 중 새 문장이 이미 있는 칸 — 새로 만드는 문서에는 문장이 없다."""
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
    """문서 줄을 만들고 고치고 지운다. 저장 뒤 {문서 번호: 문서}(지운 문서 포함)와 바뀐 문서 id를 돌려준다."""
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
    docs_by_code = {**by_code, **created}
    changed = {doc.id for doc in created.values()}
    for item in items:
        doc = docs_by_code[item.code]
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
    (N/A가 None이면 건드리지 않는다 — Excel 가져오기). 모든 검사는 쓰기 전에 끝나 거절된 요청은 아무것도 남기지 않는다.
    """
    existing = list(await session.scalars(select(TargetDoc).where(TargetDoc.bundle_id == bundle.id)))
    by_code = {doc.code: doc for doc in existing}
    code_by_id = {doc.id: doc.code for doc in existing}
    final_types = _check_list_rules(payload, existing, code_by_id)

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
    blocked_slots = await _find_blocked_slots(session, wanted_na, by_code)
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

    if not changed:  # 바뀐 게 없으면 revision을 올리지 않고 기록도 남기지 않는다(멤버 바꾸기와 같은 규칙)
        return
    bundle.revision += 1
    record_event(
        session, bundle_id=bundle.id, actor=actor, action="tobe.update" if source == "api" else "tobe.import",
        target_type="target_doc", target_ids=sorted(changed),
    )
