"""To-Be 목록 API — 읽기·통째 쓰기·한 줄 추가·삭제·고치기·Excel 템플릿 내려받기와 가져오기, 자유로운 목록 파일의 AI 읽기. 쓰기는 작성자가 작업 중일 때만 한다."""

import asyncio
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.db import get_session
from app.equis import service as equis_service
from app.equis.view import EquisOut, build_equis_out
from app.routers.sop_equis import start_lookups
from app.settings import settings
from app.sop import tobe_excel
from app.sop.ai import tobe_list_text
from app.sop.ai.schemas import AdoptionIn
from app.sop.ai.tobe_list_job import TOBE_LIST_KIND, ProposalOut, close_proposal, enqueue_tobe_list, load_open_proposal
from app.sop.constants import MEMBER_ROLES
from app.sop.errors import check_revision, raise_rule
from app.sop.events import record_event
from app.sop.membership import BundleContext, ensure_editable, lock_bundle, require_bundle_role
from app.sop.models import Bundle
from app.sop.outline import load_outline_suggestions
from app.sop.outline_edit import (
    NewOutlineItemIn,
    OutlineItemPatchIn,
    add_outline_item,
    patch_outline_item,
    remove_outline_item,
)
from app.sop.tobe import (
    DocPatchIn,
    NaReasonIn,
    NewDocIn,
    NewStepIn,
    PlaceCountOut,
    SlotCountOut,
    TargetDocOut,
    ToBeIn,
    ToBeOut,
    add_tobe_doc,
    add_wi_step,
    apply_tobe,
    build_tobe_out,
    count_targets_by_slot,
    count_targets_by_step,
    remove_tobe_doc,
    remove_wi_step,
    rename_wi_step,
    set_na_slot,
    update_tobe_doc,
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
    # 칸에 보이는 항목 수와 칸 제목 수 — Documents 화면의 N/A 칸 상태 표가 N/A로 둘 수 없는 칸을 가린다
    slot_counts: list[SlotCountOut] = []
    # 지금 표준의 권장 이름 — 하위를 선언하는 항목의 키 → 이름들(5장 범주 후보, 6장의 장비 SOP용 절 이름). 없으면 빈 객체
    outline_suggestions: dict[str, list[str]] = {}


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
    slot_counts = await count_targets_by_slot(session, [doc.id for doc in tobe.docs])
    return ToBeViewOut(
        revision=tobe.revision, docs=docs, na_slots=tobe.na_slots, wi_steps=tobe.wi_steps,
        outline_items=tobe.outline_items, sentence_counts=sentence_counts, slot_counts=slot_counts,
        outline_suggestions=await load_outline_suggestions(session),
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


# --- 줄 하나 고치기(Documents 화면) — 칸마다 바로 저장한다. 한 줄 추가·삭제처럼 revision을 묻지 않는다 ---


@router.patch("/{bundle_id}/tobe/docs/{target_doc_id}", response_model=ToBeViewOut)
async def patch_tobe_doc(
    target_doc_id: int,
    body: DocPatchIn,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    bundle = await _open_row_write(session, ctx)
    await update_tobe_doc(session, bundle, target_doc_id, body, actor=ctx.login_id)
    await session.commit()
    # 번호나 제목이 바뀌었을 수 있다 — 새 번호를 EQUIS에 묻고, EQUIS에 있는 번호의 제목은 EQUIS 이름으로 맞춘다
    return await _build_tobe_view(session, background_tasks, bundle, sync_titles=True)


@router.put("/{bundle_id}/tobe/docs/{target_doc_id}/na/{slot_key}", response_model=ToBeViewOut)
async def put_na_slot(
    target_doc_id: int,
    slot_key: str,
    body: NaReasonIn,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    bundle = await _open_row_write(session, ctx)
    await set_na_slot(session, bundle, target_doc_id, slot_key, body.reason, actor=ctx.login_id)
    await session.commit()
    return await _build_tobe_view(session, background_tasks, bundle, sync_titles=False)


@router.delete("/{bundle_id}/tobe/docs/{target_doc_id}/na/{slot_key}", response_model=ToBeViewOut)
async def delete_na_slot(
    target_doc_id: int,
    slot_key: str,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    bundle = await _open_row_write(session, ctx)
    await set_na_slot(session, bundle, target_doc_id, slot_key, None, actor=ctx.login_id)
    await session.commit()
    return await _build_tobe_view(session, background_tasks, bundle, sync_titles=False)


@router.patch("/{bundle_id}/tobe/docs/{target_doc_id}/steps/{step_no}", response_model=ToBeViewOut)
async def patch_wi_step(
    target_doc_id: int,
    step_no: int,
    body: NewStepIn,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    bundle = await _open_row_write(session, ctx)
    await rename_wi_step(session, bundle, target_doc_id, step_no, body.title, actor=ctx.login_id)
    await session.commit()
    return await _build_tobe_view(session, background_tasks, bundle, sync_titles=False)


# --- 골격의 선언 항목(6장 절차·9장 부록·5장 범주) — 한 줄 쓰기와 같은 길이다: 묶음을 잠그고 revision을 묻지 않는다 ---


@router.post("/{bundle_id}/tobe/docs/{target_doc_id}/outline", response_model=ToBeViewOut, status_code=201)
async def post_outline_item(
    target_doc_id: int,
    body: NewOutlineItemIn,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    bundle = await _open_row_write(session, ctx)
    await add_outline_item(session, bundle, target_doc_id, body, actor=ctx.login_id)
    await session.commit()
    return await _build_tobe_view(session, background_tasks, bundle, sync_titles=False)


@router.patch("/{bundle_id}/tobe/docs/{target_doc_id}/outline/{key}", response_model=ToBeViewOut)
async def update_outline_item(
    target_doc_id: int,
    key: str,
    body: OutlineItemPatchIn,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    bundle = await _open_row_write(session, ctx)
    await patch_outline_item(session, bundle, target_doc_id, key, body, actor=ctx.login_id)
    await session.commit()
    return await _build_tobe_view(session, background_tasks, bundle, sync_titles=False)


@router.delete("/{bundle_id}/tobe/docs/{target_doc_id}/outline/{key}", response_model=ToBeViewOut)
async def delete_outline_item(
    target_doc_id: int,
    key: str,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeViewOut:
    bundle = await _open_row_write(session, ctx)
    await remove_outline_item(session, bundle, target_doc_id, key, actor=ctx.login_id)
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


# --- 새 문서 목록 AI 읽기 — 템플릿에 맞지 않는 계획 파일이나 붙여 넣은 글에서 AI가 목록을 읽어 제안한다 ---
# AI는 제안만 한다: 여기서는 목록에 쓰지 않고, 사람이 미리 보기에서 고른 줄을 위의 한 줄 추가·고치기로 저장한다.

# 붙여 넣는 글의 크기 상한 — 파일과 같은 값(본문이 끝없이 커지지 않게 경계에서 막는다)
_MAX_PASTED_CHARS = tobe_list_text.MAX_LIST_FILE_BYTES


class ListReadOut(BaseModel):
    queued: int
    request_id: str
    # 글이 길어 앞부분만 읽는다
    truncated: bool


@router.post("/{bundle_id}/tobe/read", response_model=ListReadOut, status_code=202)
async def request_tobe_read(
    file: UploadFile | None = File(None),
    text: str | None = Form(None, max_length=_MAX_PASTED_CHARS),
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ListReadOut:
    """목록 파일(xlsx·docx·txt·csv·md) 하나 또는 붙여 넣은 글을 받아 AI 작업을 쌓는다. 파일은 저장하지 않는다."""
    if not settings.ai_enabled:  # 사람 경로(번호로 더하기·Excel 템플릿)는 AI가 꺼져 있어도 그대로다
        raise_rule(503, "ai_disabled")
    if file is not None:
        # 상한보다 1바이트 더 읽어 넘었는지만 알린다 — 큰 파일을 통째로 메모리에 올리지 않는다
        data = await file.read(tobe_list_text.MAX_LIST_FILE_BYTES + 1)
        listed = await asyncio.to_thread(tobe_list_text.read_list_file, file.filename or "", data)
    elif text is not None:
        listed = tobe_list_text.read_list_text(text)
    else:
        raise_rule(422, "list_text_empty")
    bundle = await _open_row_write(session, ctx)
    job = enqueue_tobe_list(session, bundle.id, listed, ctx.login_id)
    await session.flush()
    record_event(
        session, bundle_id=bundle.id, actor=ctx.login_id, action="ai.request", target_type="ai_job",
        target_ids=[job.id], reason=TOBE_LIST_KIND,
    )
    await session.commit()
    return ListReadOut(queued=1, request_id=job.request_id, truncated=listed.truncated)


@router.get("/{bundle_id}/tobe/read", response_model=ProposalOut | None)
async def get_tobe_read(
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> ProposalOut | None:
    """아직 정하지 않은 가장 새 제안 — 없으면 null."""
    return await load_open_proposal(session, ctx.bundle.id)


@router.post("/{bundle_id}/tobe/read/{suggestion_id}/close", status_code=204)
async def close_tobe_read(
    suggestion_id: int,
    body: AdoptionIn,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """미리 보기를 닫는다 — 줄을 더한 뒤(as_is·edited)나 버릴 때(rejected). 목록은 이 요청이 바꾸지 않는다."""
    bundle = await _open_row_write(session, ctx)
    await close_proposal(session, bundle.id, suggestion_id, body.adoption, ctx.login_id)
    await session.commit()
    return Response(status_code=204)

