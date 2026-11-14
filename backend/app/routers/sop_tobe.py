"""To-Be 목록 API — 읽기·통째 쓰기·한 줄 추가·삭제·Excel 템플릿 내려받기와 가져오기. 쓰기는 작성자가 작업 중일 때만 한다."""

import asyncio
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.db import get_session
from app.equis import service as equis_service
from app.equis.view import EquisOut, build_equis_out
from app.routers.sop_equis import start_lookups
from app.sop import tobe_excel
from app.sop.constants import MEMBER_ROLES
from app.sop.errors import check_revision
from app.sop.membership import BundleContext, ensure_editable, lock_bundle, require_bundle_role
from app.sop.models import Bundle
from app.sop.tobe import (
    NewDocIn,
    NewStepIn,
    PlaceCountOut,
    TargetDocOut,
    ToBeIn,
    ToBeOut,
    add_tobe_doc,
    add_wi_step,
    apply_tobe,
    build_tobe_out,
    count_targets_by_step,
    remove_tobe_doc,
    remove_wi_step,
)

router = APIRouter(prefix="/api/bundles", tags=["sop-tobe"])

_require_author = require_bundle_role("author")
_require_member = require_bundle_role(*MEMBER_ROLES)

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
TEMPLATE_FILE_NAME = "tobe-template.xlsx"


class ToBeDocOut(TargetDocOut):
    # 줄 번호의 EQUIS 표시 — 기능이 꺼졌거나 묻지 않는 번호(임시 번호)면 None
    equis: EquisOut | None = None


class ToBeViewOut(ToBeOut):
    docs: list[ToBeDocOut]  # type: ignore[assignment] -- 같은 줄에 EQUIS 표시만 더한 모양
    # 문장이 든 자리 — 배정 화면이 지울 수 없는 문서·단계를 미리 잠근다(서버는 지울 때 다시 검사한다)
    sentence_counts: list[PlaceCountOut] = []


async def _build_tobe_view(
    session: AsyncSession, background_tasks: BackgroundTasks, bundle: Bundle, *, sync_titles: bool
) -> ToBeViewOut:
    """To-Be 목록에 EQUIS 표시를 붙인다. 물을 번호는 응답 뒤에 조회하고, 쓰기 뒤에는 받아 둔 이름으로 제목을 맞춘다."""
    codes = [doc.code for doc in (await build_tobe_out(session, bundle)).docs]
    await start_lookups(session, background_tasks, bundle, codes, sync_titles=sync_titles)
    tobe = await build_tobe_out(session, bundle)
    lookups = await equis_service.load_lookups(session, codes)
    now = clock.now()
    docs = [
        ToBeDocOut(**doc.model_dump(), equis=build_equis_out(doc.code, "new", "", lookups, now)) for doc in tobe.docs
    ]
    sentence_counts = await count_targets_by_step(session, [doc.id for doc in tobe.docs])
    return ToBeViewOut(
        revision=tobe.revision, docs=docs, na_slots=tobe.na_slots, wi_steps=tobe.wi_steps,
        sentence_counts=sentence_counts,
    )


async def _write_tobe(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    ctx: BundleContext,
    payload: ToBeIn | tobe_excel.ParsedWorkbook,
    *,
    revision: int,
    source: Literal["api", "excel"],
) -> ToBeViewOut:
    """PUT과 가져오기가 함께 쓰는 쓰기 — 묶음 행을 잠그고 revision·상태를 확인한 뒤 저장·커밋하고 새 목록을 돌려준다.

    EQUIS에 있는 번호의 제목은 사람이 다른 값을 보내도 EQUIS 이름으로 돌아간다(거절하지 않는다 — 초안에 옛 제목이 남아 있을 수 있다).
    """
    bundle = ctx.bundle
    await lock_bundle(session, bundle)
    check_revision("bundle", bundle.id, revision, bundle.revision)
    ensure_editable(bundle)
    await apply_tobe(session, bundle, payload, actor=ctx.login_id, source=source)
    await session.commit()
    return await _build_tobe_view(session, background_tasks, bundle, sync_titles=True)


@router.get("/{bundle_id}/tobe", response_model=ToBeViewOut)
async def get_tobe(
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    return await _build_tobe_view(session, background_tasks, ctx.bundle, sync_titles=False)


@router.put("/{bundle_id}/tobe", response_model=ToBeViewOut)
async def put_tobe(
    body: ToBeIn,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    return await _write_tobe(session, background_tasks, ctx, body, revision=body.revision, source="api")


# --- 한 줄 추가·삭제(배정 화면) — revision을 묻지 않는다: 묶음을 잠근 뒤 DB의 지금 목록에 한 줄을 더하거나 뺀다 ---


async def _open_row_write(session: AsyncSession, ctx: BundleContext) -> Bundle:
    await lock_bundle(session, ctx.bundle)
    ensure_editable(ctx.bundle)
    return ctx.bundle


@router.post("/{bundle_id}/tobe/docs", response_model=ToBeViewOut, status_code=201)
async def post_tobe_doc(
    body: NewDocIn,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    bundle = await _open_row_write(session, ctx)
    await add_tobe_doc(session, bundle, body, actor=ctx.login_id)
    await session.commit()
    return await _build_tobe_view(session, background_tasks, bundle, sync_titles=True)


@router.delete("/{bundle_id}/tobe/docs/{target_doc_id}", response_model=ToBeViewOut)
async def delete_tobe_doc(
    target_doc_id: int,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    bundle = await _open_row_write(session, ctx)
    await remove_tobe_doc(session, bundle, target_doc_id, actor=ctx.login_id)
    await session.commit()
    return await _build_tobe_view(session, background_tasks, bundle, sync_titles=False)


@router.post("/{bundle_id}/tobe/docs/{target_doc_id}/steps", response_model=ToBeViewOut, status_code=201)
async def post_wi_step(
    target_doc_id: int,
    body: NewStepIn,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    bundle = await _open_row_write(session, ctx)
    await add_wi_step(session, bundle, target_doc_id, body.title, actor=ctx.login_id)
    await session.commit()
    return await _build_tobe_view(session, background_tasks, bundle, sync_titles=False)


@router.delete("/{bundle_id}/tobe/docs/{target_doc_id}/steps/{step_no}", response_model=ToBeViewOut)
async def delete_wi_step(
    target_doc_id: int,
    step_no: int,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    bundle = await _open_row_write(session, ctx)
    await remove_wi_step(session, bundle, target_doc_id, step_no, actor=ctx.login_id)
    await session.commit()
    return await _build_tobe_view(session, background_tasks, bundle, sync_titles=False)


@router.get("/{bundle_id}/tobe/template.xlsx")
async def download_tobe_template(
    ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> Response:
    tobe = await build_tobe_out(session, ctx.bundle)
    content = await asyncio.to_thread(tobe_excel.build_tobe_template, tobe)
    return Response(
        content=content,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{TEMPLATE_FILE_NAME}"'},
    )


@router.post("/{bundle_id}/tobe/import", response_model=ToBeViewOut)
async def import_tobe(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(),
    revision: int = Form(ge=1),
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    # 상한보다 1바이트 더 읽어 넘었는지만 알린다 — 큰 파일을 통째로 메모리에 올리지 않는다
    data = await file.read(tobe_excel.MAX_FILE_BYTES + 1)
    # 파싱은 CPU를 쓰므로 이벤트 루프 밖에서 돌린다(묶음 잠금도 파싱이 끝난 뒤에 잡는다)
    parsed = await asyncio.to_thread(tobe_excel.parse_tobe_workbook, data)
    return await _write_tobe(session, background_tasks, ctx, parsed, revision=revision, source="excel")
