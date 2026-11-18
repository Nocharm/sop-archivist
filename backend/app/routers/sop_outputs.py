"""결과물 API — 결과물 A·B·C·요약 숫자 읽기와 Excel 내보내기·미리보기(멤버, 모든 상태), 결과물 C 순서 바꾸기(작성자·작업 중).

계산은 app/sop/outputs.py의 순수 함수(Excel·미리보기는 그 위의 sheet_model), 재료는 app/sop/snapshot.py가 표마다 질의 한 번으로 읽는다.
"""

import asyncio
import logging
from collections import Counter, defaultdict
from collections.abc import Collection, Mapping
from typing import Annotated, Literal, NoReturn

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.db import get_session
from app.equis import service as equis_service
from app.equis.view import EquisOut, build_equis_out
from app.routers.sop_documents import build_content_disposition
from app.sop import sheet_model
from app.sop.ai.guidelines import get_rules_version_label
from app.sop.constants import MAX_INDENT_LEVEL, MEMBER_ROLES, SLOT_HEADING, NumberStyle
from app.sop.decisions import DbId
from app.sop.detach import ORIGIN_NEW_DOC, ORIGIN_TRANSLATION, load_source_target_ids, sweep_translations
from app.sop.errors import check_revision, raise_rule
from app.sop.events import record_event
from app.sop.excel_export import ExportMeta, build_workbook
from app.sop.membership import BundleContext, ensure_editable, lock_bundle, require_bundle_role
from app.sop.models import Bundle, TargetDoc, TargetDocNaSlot, TargetSentence, WiStep
from app.sop.outline import DocOutline, load_doc_outlines
from app.sop.outputs import (
    ARow,
    CDoc,
    ComposedDoc,
    COutput,
    FlowGraph,
    Summary,
    build_composed_doc,
    build_output_a,
    build_output_b,
    build_output_c,
    build_output_c_doc,
    build_summary,
)
from app.sop.sheet_model import Sheet, WorkbookModel, build_equis_key, build_workbook_model, limit_preview
from app.sop.snapshot import BundleSnapshot, list_confirmer_ids, load_bundle_snapshot, load_people_names
from app.sop.target_placement import restyle_moved
from app.sop.tobe import MAX_DB_INT, is_within_slot

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/bundles", tags=["sop-outputs"])

_require_author = require_bundle_role("author")
_require_member = require_bundle_role(*MEMBER_ROLES)

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_ORDER_ITEMS = 20000  # 순서 바꾸기 한 번에 싣는 새 문장 수 — 새 문서 하나의 새 문장 전부가 들어가는 크기


class OrderItemIn(BaseModel):
    target_id: DbId
    # 보낸 경우에만 바꾼다 — null은 "단계 없음"으로 옮긴다는 뜻이라 생략과 다르다(model_fields_set으로 가린다)
    wi_step: DbId | None = None
    # 보낸 경우에만 바꾼다 — SOP 줄을 다른 칸으로 옮긴다. wi_step과 달리 null도 "칸 없음"이 아니라 모르는 칸(422 unknown_slot)이다
    slot_key: str | None = Field(default=None, max_length=100)
    # 들여쓰기 깊이 — 보낸 경우에만 바꾼다(null도 바꾸지 않음). 앞줄보다 깊은 값도 받는다(결과물이 셀 때 눌러 읽는다)
    indent_level: int | None = Field(default=None, ge=0, le=MAX_INDENT_LEVEL)
    # 번호 표시 — 보낸 경우에만 바꾼다(null도 바꾸지 않음). 이 줄만 바꾼다(짝 상대·번역은 따라 바뀌지 않는다)
    number_style: NumberStyle | None = None


class TargetOrderIn(BaseModel):
    revision: int = Field(ge=1)
    target_doc_id: DbId
    # 그 새 문서의 칸 새 문장·칸 제목이 아닌 새 문장 전부를 한 번씩, 새 순서대로
    items: list[OrderItemIn] = Field(max_length=MAX_ORDER_ITEMS)


class OrderItemOut(BaseModel):
    target_id: int
    order_index: int
    wi_step: int | None
    slot_key: str | None
    indent_level: int
    number_style: str


class TargetOrderSaved(BaseModel):
    """순서 쓰기의 결과 — 쓴 뒤 묶음 revision과 남은 새 문장(쓸려 나간 번역은 빠진다)."""

    revision: int
    target_doc_id: int
    items: list[OrderItemOut]


class TargetOrderOut(TargetOrderSaved):
    # 저장 뒤 그 문서의 C 모양 — 같은 lang의 GET …/outputs/c에서 그 문서와 같은 값(번호·쓸린 번역 반영). 화면은 C 전체를 다시 받지 않는다
    doc: CDoc


async def _load_snapshot_for_read(session: AsyncSession, bundle_id: int) -> BundleSnapshot:
    """읽기 전용 결과물 재료 — 다 읽으면 트랜잭션을 끝내 묶음 행 공유 잠금을 놓는다(스레드 계산 동안 쓰기를 막지 않게)."""
    snap = await load_bundle_snapshot(session, bundle_id)
    await session.commit()
    return snap


@router.get("/{bundle_id}/outputs/a", response_model=list[ARow])
async def get_output_a(
    lang: Literal["ko", "en"] = Query("en"),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> list[ARow]:
    """결과물 A 한 벌 — lang은 라벨 언어만(없으면 en), 확정한 사람은 디렉터리 이름을 붙인다."""
    snap = await load_bundle_snapshot(session, ctx.bundle.id)
    people = await load_people_names(session, list_confirmer_ids(snap))
    # 다 읽었으니 트랜잭션을 끝내 묶음 행 공유 잠금을 놓는다(스레드 계산 동안 쓰기를 막지 않게)
    await session.commit()
    # 순수 계산이라 큰 묶음이 이벤트 루프를 막지 않게 스레드에서 돈다
    return await asyncio.to_thread(build_output_a, snap, lang, people)


@router.get("/{bundle_id}/outputs/b", response_model=FlowGraph)
async def get_output_b(
    lang: Literal["ko", "en"] = Query("en"),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> FlowGraph:
    """결과물 B 한 벌 — lang은 노드 라벨 언어만(없으면 en)."""
    snap = await _load_snapshot_for_read(session, ctx.bundle.id)
    return await asyncio.to_thread(build_output_b, snap, lang)


@router.get("/{bundle_id}/outputs/c", response_model=COutput)
async def get_output_c(
    lang: Literal["ko", "en"] = Query("en"),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> COutput:
    """결과물 C 한 벌 — 칸마다 두 언어가 한 목록, lang은 라벨 언어만(없으면 en)."""
    snap = await _load_snapshot_for_read(session, ctx.bundle.id)
    return await asyncio.to_thread(build_output_c, snap, lang)


@router.get("/{bundle_id}/outputs/c/docs/{target_doc_id}", response_model=ComposedDoc)
async def get_composed_doc(
    target_doc_id: Annotated[int, Path(ge=1, le=MAX_DB_INT)],
    lang: Literal["ko", "en"] = Query("en"),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> ComposedDoc:
    """Assign New 칸 — 새 문서 하나를 지금까지의 배정으로(결과물 C와 같은 칸, 두 언어 함께). lang은 라벨 언어만(없으면 en)."""
    snap = await _load_snapshot_for_read(session, ctx.bundle.id)
    doc = await asyncio.to_thread(build_composed_doc, snap, target_doc_id, lang)
    if doc is None:
        raise_rule(404, "target_doc_not_found", target_doc_id=target_doc_id)
    return doc


@router.get("/{bundle_id}/summary", response_model=Summary)
async def get_summary(
    ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> Summary:
    """요약 숫자 한 벌 — 옛 쪽은 진행 숫자와 같은 줄로 센다."""
    snap = await _load_snapshot_for_read(session, ctx.bundle.id)
    return await asyncio.to_thread(build_summary, snap)


async def _load_export_equis(session: AsyncSession, snap: BundleSnapshot) -> dict[str, EquisOut]:
    """문서 목록 시트에 실을 EQUIS 값 — 받아 둔 조회 결과만 읽는다(내보내기가 조회를 걸지 않는다). 꺼져 있으면 빈 값."""
    old_docs = [doc for doc in snap.documents.values() if doc.side == "old"]
    targets = list(snap.target_docs.values())
    lookups = await equis_service.load_lookups(session, [doc.doc_code for doc in old_docs] + [doc.code for doc in targets])
    stamp = now()
    found = {
        build_equis_key("old", doc.id): build_equis_out(doc.doc_code, "old", doc.doc_version, lookups, stamp)
        for doc in old_docs
    } | {build_equis_key("new", doc.id): build_equis_out(doc.code, "new", "", lookups, stamp) for doc in targets}
    return {key: equis for key, equis in found.items() if equis is not None}


async def _load_export_inputs(
    session: AsyncSession, ctx: BundleContext
) -> tuple[BundleSnapshot, ExportMeta, dict[str, str], dict[str, EquisOut]]:
    """Excel·미리보기 재료(지침 버전·스냅숏·확정한 사람 이름·문서의 EQUIS 값)를 읽고 트랜잭션을 끝낸다 — 스레드 계산 동안 묶음 행
    잠금을 쥐지 않게.

    파일 이름의 시각도 여기서 정한다(now()) — 미리보기와 받기가 같은 분이면 같은 이름이다.
    """
    guideline_version = await get_rules_version_label(session)
    snap = await load_bundle_snapshot(session, ctx.bundle.id)
    people = await load_people_names(session, list_confirmer_ids(snap))
    equis = await _load_export_equis(session, snap)
    await session.commit()
    meta = ExportMeta(exported_by=ctx.login_id, exported_at=now(), guideline_version=guideline_version)
    return snap, meta, people, equis


def _raise_export_failed(bundle_id: int, error: Exception) -> NoReturn:
    """파일 생성 실패는 저장 실패와 다른 오류로 알린다(스펙 §7.14). 예외 메시지에 원문이 실릴 수 있어 클래스 이름만 남긴다."""
    logger.error("export failed: bundle=%d error=%s", bundle_id, type(error).__name__)
    raise_rule(500, "export_failed")


@router.get("/{bundle_id}/export.xlsx")
async def get_export(
    ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> Response:
    """Excel 파일 한 벌 — 작업 중·검토 중·완료 어느 상태에서나 받고, 받은 사실은 작업 기록에 남는다. 이름은 시트 모델의 file_name."""
    bundle = ctx.bundle
    snap, meta, people, equis = await _load_export_inputs(session, ctx)
    try:
        model = await asyncio.to_thread(build_workbook_model, snap, meta, people, equis)
        content = await asyncio.to_thread(build_workbook, model)
    except Exception as error:
        _raise_export_failed(bundle.id, error)
    record_event(
        session, bundle_id=bundle.id, actor=ctx.login_id, action="export", target_type="bundle", target_ids=[bundle.id],
    )
    await session.commit()
    headers = {"Content-Disposition": build_content_disposition(model.file_name)}
    return Response(content=content, media_type=XLSX_MEDIA_TYPE, headers=headers)


@router.get("/{bundle_id}/export/preview", response_model=WorkbookModel)
async def get_export_preview(
    ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> WorkbookModel:
    """Excel 미리보기 — 받을 파일과 같은 시트 모델(시트마다 MAX_PREVIEW_ROWS줄까지)과 파일 이름. 작업 기록은 남기지 않는다."""
    snap, meta, people, equis = await _load_export_inputs(session, ctx)
    try:
        model = await asyncio.to_thread(build_workbook_model, snap, meta, people, equis)
    except Exception as error:
        _raise_export_failed(ctx.bundle.id, error)
    # 상한은 부를 때 읽는다 — 시험이 모듈 값을 바꿔 자르기를 본다
    return limit_preview(model, sheet_model.MAX_PREVIEW_ROWS)


@router.get("/{bundle_id}/export/preview/a", response_model=Sheet)
async def get_export_preview_a(
    doc_id: Annotated[int, Query(ge=1, le=MAX_DB_INT)],
    around_unit_id: Annotated[int | None, Query(ge=1, le=MAX_DB_INT)] = None,
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> Sheet:
    """Assign Space 미리보기 — 옛 문서 하나의 A 시트(받을 파일과 같은 줄)를 고른 단위를 가운데로 MAX_PREVIEW_ROWS줄까지.

    B 그림·C·Info·Documents는 짓지 않는다. 작업 기록은 남기지 않는다. 이 묶음의 옛 문서가 아니면 404 document_not_found.
    """
    snap = await load_bundle_snapshot(session, ctx.bundle.id)
    people = await load_people_names(session, list_confirmer_ids(snap))
    await session.commit()
    document = snap.documents.get(doc_id)
    if document is None or document.side != "old":
        raise_rule(404, "document_not_found")
    try:
        return await asyncio.to_thread(
            sheet_model.build_a_preview, snap, people, doc_id, around_unit_id, sheet_model.MAX_PREVIEW_ROWS
        )
    except Exception as error:
        _raise_export_failed(ctx.bundle.id, error)


async def _check_translation_moves(
    session: AsyncSession, tops: dict[int, TargetSentence], moves: Mapping[int, object]
) -> list[int]:
    """옮기는 번역의 id를 돌려준다 — 번역의 자리는 출처와 함께 같은 값으로만 옮긴다(스펙 §7.9, 저장 decisions.py와 같은 잠금). 아니면 422 translation_locked."""
    translations = [target_id for target_id in moves if tops[target_id].origin == ORIGIN_TRANSLATION]
    source_ids = await load_source_target_ids(session, translations)
    astray = sorted(
        target_id for target_id in translations
        if source_ids[target_id] not in moves or moves[source_ids[target_id]] != moves[target_id]
    )
    if astray:
        raise_rule(422, "translation_locked", target_ids=astray)
    return translations


async def _check_slot_moves(
    session: AsyncSession, doc: TargetDoc, outline: DocOutline, tops: dict[int, TargetSentence], items: list[OrderItemIn]
) -> dict[int, str]:
    """다른 칸으로 옮기는 줄(새 문장 → 칸)을 돌려준다 — 보냈고 지금 칸과 다를 때만. 쓰기 전에 검사만 한다.

    입구 1 SOP의 사람이 쓴 줄만 칸을 옮긴다(slot_not_allowed). 칸은 그 문서의 골격 사본 안(unknown_slot)의 줄을 받는 종류(slot_not_assignable —
    묶음 제목·자동 목록은 받지 않는다), 그 문서에서 N/A가 아닌 칸(na_slot, 상위 칸 N/A는 하위 칸도 덮는다 — 저장 decisions._check_location과
    같은 규칙)이어야 한다.
    """
    requested = {
        item.target_id: item.slot_key
        for item in items
        if "slot_key" in item.model_fields_set and item.slot_key != tops[item.target_id].slot_key
    }
    if not requested:
        return {}
    locked = sorted(
        target_id for target_id in requested
        if doc.doc_type != "sop" or doc.entrance == "match" or tops[target_id].origin == ORIGIN_NEW_DOC
    )
    if locked:
        raise_rule(422, "slot_not_allowed", target_ids=locked)
    unknown = sorted(
        target_id for target_id, slot_key in requested.items() if slot_key is None or outline.find(slot_key) is None
    )
    if unknown:
        raise_rule(422, "unknown_slot", target_ids=unknown)
    closed = sorted(target_id for target_id, slot_key in requested.items() if not outline.is_assignable(str(slot_key)))
    if closed:
        raise_rule(422, "slot_not_assignable", target_ids=closed)
    na_keys = list(await session.scalars(select(TargetDocNaSlot.slot_key).where(TargetDocNaSlot.target_doc_id == doc.id)))
    na = sorted(
        target_id for target_id, slot_key in requested.items()
        if any(is_within_slot(str(slot_key), na_key) for na_key in na_keys)
    )
    if na:
        raise_rule(422, "na_slot", target_ids=na)
    return {target_id: str(slot_key) for target_id, slot_key in requested.items()}


async def _check_indents(
    session: AsyncSession,
    doc: TargetDoc,
    tops: dict[int, TargetSentence],
    items: list[OrderItemIn],
    moved_ids: Collection[int],
) -> dict[int, int]:
    """바뀌는 깊이(새 문장 → 깊이)를 돌려준다 — 깊이가 바뀌는 출처의 번역도 출처의 새 깊이로 싣는다. 쓰기 전에 검사만 한다.

    다른 단계·칸으로 옮기는 줄(moved_ids)은 깊이를 보내지 않았으면 0으로 돌린다 — 깊이는 그 칸 앞뒤 줄에 기댄 값이라
    저장 경로(decisions._apply_plan)와 같은 규칙이다. 번역은 여기서 0으로 돌리지 않고 출처를 따른다.

    입구 2 문서는 번호를 새로 매기지 않으므로 깊이를 받지 않는다(422 indent_not_allowed). 번역의 깊이는 출처를 따라 잠겨 있어
    출처의 바뀐 뒤 깊이와 다르게 보내면 422 translation_locked다(단계 잠금과 같은 규칙).
    """
    requested = {
        item.target_id: 0 if item.indent_level is None else item.indent_level
        for item in items
        if item.indent_level is not None
        or (item.target_id in moved_ids and tops[item.target_id].origin != ORIGIN_TRANSLATION)
    }
    indents = {target_id: level for target_id, level in requested.items() if level != tops[target_id].indent_level}
    if indents and doc.entrance == "match":
        raise_rule(422, "indent_not_allowed", target_ids=sorted(indents))
    translation_ids = [target_id for target_id, row in tops.items() if row.origin == ORIGIN_TRANSLATION]
    if not indents or not translation_ids:
        return indents
    source_ids = await load_source_target_ids(session, translation_ids)

    def get_final_level(target_id: int) -> int | None:
        return indents.get(target_id, tops[target_id].indent_level) if target_id in tops else None

    astray = sorted(
        target_id for target_id in indents
        if target_id in source_ids and get_final_level(source_ids[target_id]) != indents[target_id]
    )
    if astray:
        raise_rule(422, "translation_locked", target_ids=astray)
    # 번역은 출처와 같은 깊이다 — 깊이만 바뀐 것은 글·자리가 그대로라 sweep_translations(보류·지우기)를 거치지 않고 따라간다
    followers = {target_id: indents[source_id] for target_id, source_id in source_ids.items() if source_id in indents}
    return {**indents, **followers}


def _check_number_styles(doc: TargetDoc, tops: dict[int, TargetSentence], items: list[OrderItemIn]) -> dict[int, str]:
    """바뀌는 번호 표시(새 문장 → 표시)를 돌려준다. 쓰기 전에 검사만 한다.

    표시는 그 문장에만 속한다 — 한/영 짝 상대도 번역도 따라 바뀌지 않고, 번역도 출처와 다른 표시를 가질 수 있다.
    입구 2 문서는 번호를 새로 매기지 않으므로 422 number_style_not_allowed다.
    WI 단계를 옮겨도 표시는 그대로다 — 깊이와 달리 앞뒤 줄에 기대지 않는 그 줄 자체의 성격이다. SOP의 다른 절로 옮기는 줄만
    reorder_targets가 번호 ↔ 글머리 기호를 도착한 절의 기본으로 바꾼다(target_placement.restyle_moved).
    """
    requested = {
        item.target_id: item.number_style
        for item in items
        if item.number_style is not None and item.number_style != tops[item.target_id].number_style
    }
    if requested and doc.entrance == "match":
        raise_rule(422, "number_style_not_allowed", target_ids=sorted(requested))
    return requested


async def reorder_targets(
    session: AsyncSession, bundle: Bundle, payload: TargetOrderIn, actor: str
) -> TargetOrderSaved:
    """새 문서 하나의 새 문장 순서(와 WI 단계·SOP 칸·들여쓰기·번호 표시)를 사람이 정한다 — 이후 그 문서는 order_index 순이고 새로 들어오는 새 문장은 끝에 붙는다.

    목록은 칸 새 문장이 아닌 새 문장 전부를 한 번씩 담아야 한다(빠진 새 문장의 자리를 지어내지 않게). 검사를 모두 마친 뒤에 쓴다.
    """
    await lock_bundle(session, bundle)
    check_revision("bundle", bundle.id, payload.revision, bundle.revision)
    ensure_editable(bundle)
    doc = await session.get(TargetDoc, payload.target_doc_id)
    if doc is None or doc.bundle_id != bundle.id:
        raise_rule(404, "target_doc_not_found", target_doc_id=payload.target_doc_id)
    rows = list(await session.scalars(select(TargetSentence).where(TargetSentence.target_doc_id == doc.id)))
    # 칸 제목은 결과물 C의 칸 항목이 아니라 순서가 없다 — 목록에서 뺀다(보내면 모르는 새 문장이다)
    tops = {row.id: row for row in rows if row.parent_target_id is None and row.kind != SLOT_HEADING}
    sent = [item.target_id for item in payload.items]
    duplicates = sorted(target_id for target_id, count in Counter(sent).items() if count > 1)
    missing, unknown = sorted(tops.keys() - set(sent)), sorted(set(sent) - tops.keys())
    if duplicates or missing or unknown:
        raise_rule(
            422, "order_mismatch", missing_target_ids=missing, unknown_target_ids=unknown,
            duplicate_target_ids=duplicates,
        )
    moves = {
        item.target_id: item.wi_step
        for item in payload.items
        if "wi_step" in item.model_fields_set and item.wi_step != tops[item.target_id].wi_step
    }
    # 단계는 입구 1 WI의 새 문장만 옮긴다 — 입구 2 새 문장의 자리는 새 문서 원문 그대로다
    locked = sorted(target_id for target_id in moves if doc.doc_type != "wi" or tops[target_id].origin == ORIGIN_NEW_DOC)
    if locked:
        raise_rule(422, "wi_step_not_allowed", target_ids=locked)
    translations = await _check_translation_moves(session, tops, moves)
    if moves:
        declared = set(await session.scalars(select(WiStep.step_no).where(WiStep.target_doc_id == doc.id)))
        undeclared = sorted(target_id for target_id, step in moves.items() if step is not None and step not in declared)
        if undeclared:
            raise_rule(422, "unknown_wi_step", target_ids=undeclared)
    outline = (await load_doc_outlines(session, [doc.id]))[doc.id]
    slot_moves = await _check_slot_moves(session, doc, outline, tops, payload.items)
    translations += await _check_translation_moves(session, tops, slot_moves)
    indents = await _check_indents(session, doc, tops, payload.items, moves.keys() | slot_moves.keys())
    number_styles = _check_number_styles(doc, tops, payload.items)
    # 다른 절로 옮기는 줄은 번호 ↔ 글머리 기호를 도착한 절의 기본으로 바꾼다(생략·주석은 그대로) — 같은 요청이 표시를 실어 보냈으면
    # 그 값이 먼저다. 지금 값과 같은 표시를 보낸 것도 "이 표시로 둔다"는 뜻이다(옮긴 뒤 표시를 도로 고른 줄 — 화면은 옮긴 줄의 표시를 늘 싣는다)
    styled = {item.target_id for item in payload.items if item.number_style is not None}
    for target_id, slot_key in slot_moves.items():
        if target_id not in styled:
            style = restyle_moved(tops[target_id].number_style, outline, slot_key)
            if style != tops[target_id].number_style:
                number_styles[target_id] = style

    cells: dict[int, list[TargetSentence]] = defaultdict(list)
    for row in rows:
        if row.parent_target_id is not None:
            cells[row.parent_target_id].append(row)
    for order_index, target_id in enumerate(sent):
        tops[target_id].order_index = order_index
    # 깊이·번호 표시는 번호만 바꾸는 표시라 새 문장 revision을 올리지 않는다(저장 경로는 깊이를 보내지 않아 덮어쓸 일이 없다)
    for target_id, level in indents.items():
        tops[target_id].indent_level = level
    for target_id, style in number_styles.items():
        tops[target_id].number_style = style
    moved: list[int] = []
    for target_id in moves.keys() | slot_moves.keys():
        # 칸 새 문장은 표와 같은 자리에 있다(관계 묶음 저장 검사 7) — 자리가 바뀐 새 문장은 revision을 올려 낡은 저장을 막는다
        for target in (tops[target_id], *cells.get(target_id, [])):
            if target_id in moves:
                target.wi_step = moves[target_id]
            if target_id in slot_moves:
                target.slot_key = slot_moves[target_id]
            target.revision += 1
            moved.append(target.id)
    # 함께 옮긴 번역은 자리를 사람이 정한 것이고, 출처만 옮기면 쓸어 낸다
    swept = await sweep_translations(session, bundle.id, moved, exempt=translations)
    doc.manual_order = True
    bundle.revision += 1
    record_event(
        session, bundle_id=bundle.id, actor=actor, action="targets.reorder", target_type="target_doc",
        target_ids=[doc.id],
    )
    await session.flush()
    return TargetOrderSaved(
        revision=bundle.revision,
        target_doc_id=doc.id,
        items=[
            OrderItemOut(
                target_id=target_id, order_index=tops[target_id].order_index, wi_step=tops[target_id].wi_step,
                slot_key=tops[target_id].slot_key, indent_level=tops[target_id].indent_level,
                number_style=tops[target_id].number_style,
            )
            for target_id in sent if target_id not in swept
        ],
    )


@router.put("/{bundle_id}/targets/order", response_model=TargetOrderOut)
async def put_target_order(
    body: TargetOrderIn,
    lang: Literal["ko", "en"] = Query("en"),
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> TargetOrderOut:
    """순서·깊이·번호 표시를 쓰고 그 문서의 C 모양을 함께 돌려준다 — lang은 라벨 언어만(없으면 en)."""
    result = await reorder_targets(session, ctx.bundle, body, ctx.login_id)
    # 같은 트랜잭션에서 읽어 방금 쓴 순서를 본다 — 스냅숏의 FOR SHARE는 이 트랜잭션이 이미 든 FOR UPDATE와 부딪치지 않는다
    snap = await load_bundle_snapshot(session, ctx.bundle.id)
    await session.commit()
    # 계산은 잠금을 놓은 뒤 스레드에서(읽기 결과물과 같은 까닭)
    doc = await asyncio.to_thread(build_output_c_doc, snap, result.target_doc_id, lang)
    if doc is None:  # reorder_targets가 같은 트랜잭션에서 문서를 확인했다 — 타입을 좁히는 자리
        raise_rule(404, "target_doc_not_found", target_doc_id=result.target_doc_id)
    return TargetOrderOut(revision=result.revision, target_doc_id=result.target_doc_id, items=result.items, doc=doc)
