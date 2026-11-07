"""결과물 API — 결과물 A·B·C·요약 숫자 읽기와 Excel 내보내기(멤버, 모든 상태), 결과물 C 순서 바꾸기(작성자·작업 중).

계산은 app/sop/outputs.py의 순수 함수, 재료는 app/sop/snapshot.py가 표마다 질의 한 번으로 읽는다.
"""

import asyncio
import logging
from collections import Counter, defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.db import get_session
from app.routers.sop_documents import build_content_disposition
from app.sop.ai.guidelines import get_rules_version_label
from app.sop.constants import MEMBER_ROLES
from app.sop.decisions import DbId
from app.sop.detach import ORIGIN_NEW_DOC, ORIGIN_TRANSLATION, sweep_translations
from app.sop.errors import check_revision, raise_rule
from app.sop.events import record_event
from app.sop.excel_export import ExportMeta, build_export_file_name, build_workbook
from app.sop.membership import BundleContext, ensure_editable, lock_bundle, require_bundle_role
from app.sop.models import Bundle, TargetDoc, TargetSentence, WiStep
from app.sop.outputs import (
    ARow,
    COutput,
    FlowGraph,
    Summary,
    build_output_a,
    build_output_b,
    build_output_c,
    build_summary,
)
from app.sop.snapshot import BundleSnapshot, load_bundle_snapshot

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/bundles", tags=["sop-outputs"])

_require_author = require_bundle_role("author")
_require_member = require_bundle_role(*MEMBER_ROLES)

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_ORDER_ITEMS = 20000  # 순서 바꾸기 한 번에 싣는 새 문장 수 — 새 문서 하나의 새 문장 전부가 들어가는 크기


class SummaryOut(BaseModel):
    ko: Summary
    en: Summary


class OrderItemIn(BaseModel):
    target_id: DbId
    # 보낸 경우에만 바꾼다 — null은 "단계 없음"으로 옮긴다는 뜻이라 생략과 다르다(model_fields_set으로 가린다)
    wi_step: DbId | None = None


class TargetOrderIn(BaseModel):
    revision: int = Field(ge=1)
    target_doc_id: DbId
    # 그 새 문서의 칸 새 문장이 아닌 새 문장 전부를 한 번씩, 새 순서대로
    items: list[OrderItemIn] = Field(max_length=MAX_ORDER_ITEMS)


class OrderItemOut(BaseModel):
    target_id: int
    order_index: int
    wi_step: int | None


class TargetOrderOut(BaseModel):
    revision: int
    target_doc_id: int
    items: list[OrderItemOut]


async def _load_snapshot_for_read(session: AsyncSession, bundle_id: int) -> BundleSnapshot:
    """읽기 전용 결과물 재료 — 다 읽으면 트랜잭션을 끝내 묶음 행 공유 잠금을 놓는다(스레드 계산 동안 쓰기를 막지 않게)."""
    snap = await load_bundle_snapshot(session, bundle_id)
    await session.commit()
    return snap


@router.get("/{bundle_id}/outputs/a", response_model=list[ARow])
async def get_output_a(
    lang: Literal["ko", "en"] = Query(),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> list[ARow]:
    snap = await _load_snapshot_for_read(session, ctx.bundle.id)
    # 순수 계산이라 큰 묶음이 이벤트 루프를 막지 않게 스레드에서 돈다
    return await asyncio.to_thread(build_output_a, snap, lang)


@router.get("/{bundle_id}/outputs/b", response_model=FlowGraph)
async def get_output_b(
    lang: Literal["ko", "en"] = Query(),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> FlowGraph:
    snap = await _load_snapshot_for_read(session, ctx.bundle.id)
    return await asyncio.to_thread(build_output_b, snap, lang)


@router.get("/{bundle_id}/outputs/c", response_model=COutput)
async def get_output_c(
    lang: Literal["ko", "en"] = Query(),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> COutput:
    snap = await _load_snapshot_for_read(session, ctx.bundle.id)
    return await asyncio.to_thread(build_output_c, snap, lang)


@router.get("/{bundle_id}/summary", response_model=SummaryOut)
async def get_summary(
    ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> SummaryOut:
    snap = await _load_snapshot_for_read(session, ctx.bundle.id)
    ko, en = await asyncio.to_thread(lambda: (build_summary(snap, "ko"), build_summary(snap, "en")))
    return SummaryOut(ko=ko, en=en)


@router.get("/{bundle_id}/export.xlsx")
async def get_export(
    lang: Literal["ko", "en"] = Query(),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """언어별 Excel 파일 — 작업 중·검토 중·완료 어느 상태에서나 받고, 받은 사실은 작업 기록에 남는다."""
    bundle = ctx.bundle
    # 스냅숏 읽기가 트랜잭션을 끝내므로 지침 버전 질의는 그보다 먼저 해야 스레드 계산 동안 트랜잭션이 열려 있지 않다
    guideline_version = await get_rules_version_label(session)
    snap = await _load_snapshot_for_read(session, bundle.id)
    meta = ExportMeta(exported_by=ctx.login_id, exported_at=now(), guideline_version=guideline_version)
    try:
        content = await asyncio.to_thread(build_workbook, snap, lang, meta)
    except Exception as error:
        # 파일 생성 실패는 저장 실패와 다른 오류로 알린다(스펙 §7.14). 예외 메시지에 원문이 실릴 수 있어 클래스 이름만 남긴다
        logger.error("export failed: bundle=%d lang=%s error=%s", bundle.id, lang, type(error).__name__)
        raise_rule(500, "export_failed")
    file_name = build_export_file_name(bundle.title, lang, meta.exported_at)
    record_event(
        session, bundle_id=bundle.id, actor=ctx.login_id, action="export", target_type="bundle",
        target_ids=[bundle.id], reason=lang,
    )
    await session.commit()
    headers = {"Content-Disposition": build_content_disposition(file_name)}
    return Response(content=content, media_type=XLSX_MEDIA_TYPE, headers=headers)


async def reorder_targets(
    session: AsyncSession, bundle: Bundle, payload: TargetOrderIn, actor: str
) -> TargetOrderOut:
    """새 문서 하나의 새 문장 순서(와 WI 단계)를 사람이 정한다 — 이후 그 문서는 order_index 순이고 새로 들어오는 새 문장은 끝에 붙는다.

    목록은 칸 새 문장이 아닌 새 문장 전부를 한 번씩 담아야 한다(빠진 새 문장의 자리를 지어내지 않게). 검사를 모두 마친 뒤에 쓴다.
    """
    await lock_bundle(session, bundle)
    check_revision("bundle", bundle.id, payload.revision, bundle.revision)
    ensure_editable(bundle)
    doc = await session.get(TargetDoc, payload.target_doc_id)
    if doc is None or doc.bundle_id != bundle.id:
        raise_rule(404, "target_doc_not_found", target_doc_id=payload.target_doc_id)
    rows = list(await session.scalars(select(TargetSentence).where(TargetSentence.target_doc_id == doc.id)))
    tops = {row.id: row for row in rows if row.parent_target_id is None}
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
    # 번역의 자리는 출처 새 문장을 따른다(스펙 §7.9) — 저장(decisions.py)과 같은 잠금이다
    translations = sorted(target_id for target_id in moves if tops[target_id].origin == ORIGIN_TRANSLATION)
    if translations:
        raise_rule(422, "translation_locked", target_ids=translations)
    if moves:
        declared = set(await session.scalars(select(WiStep.step_no).where(WiStep.target_doc_id == doc.id)))
        undeclared = sorted(target_id for target_id, step in moves.items() if step is not None and step not in declared)
        if undeclared:
            raise_rule(422, "unknown_wi_step", target_ids=undeclared)

    cells: dict[int, list[TargetSentence]] = defaultdict(list)
    for row in rows:
        if row.parent_target_id is not None:
            cells[row.parent_target_id].append(row)
    for order_index, target_id in enumerate(sent):
        tops[target_id].order_index = order_index
    moved: list[int] = []
    for target_id, step in moves.items():
        # 칸 새 문장은 표와 같은 자리에 있다(관계 묶음 저장 검사 7) — 자리가 바뀐 새 문장은 revision을 올려 낡은 저장을 막는다
        for target in (tops[target_id], *cells.get(target_id, [])):
            target.wi_step = step
            target.revision += 1
            moved.append(target.id)
    await sweep_translations(session, bundle.id, moved)
    doc.manual_order = True
    bundle.revision += 1
    record_event(
        session, bundle_id=bundle.id, actor=actor, action="targets.reorder", target_type="target_doc",
        target_ids=[doc.id],
    )
    await session.flush()
    return TargetOrderOut(
        revision=bundle.revision,
        target_doc_id=doc.id,
        items=[
            OrderItemOut(target_id=target_id, order_index=tops[target_id].order_index, wi_step=tops[target_id].wi_step)
            for target_id in sent
        ],
    )


@router.put("/{bundle_id}/targets/order", response_model=TargetOrderOut)
async def put_target_order(
    body: TargetOrderIn, ctx: BundleContext = Depends(_require_author), session: AsyncSession = Depends(get_session)
) -> TargetOrderOut:
    result = await reorder_targets(session, ctx.bundle, body, ctx.login_id)
    await session.commit()
    return result
