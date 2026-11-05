"""To-Be 목록 API — 읽기·통째 쓰기·Excel 템플릿 내려받기와 가져오기. 쓰기는 작성자가 작업 중일 때만 한다."""

import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.sop import tobe_excel
from app.sop.constants import MEMBER_ROLES
from app.sop.errors import check_revision
from app.sop.membership import BundleContext, ensure_editable, lock_bundle, require_bundle_role
from app.sop.tobe import ToBeIn, ToBeOut, apply_tobe, build_tobe_out

router = APIRouter(prefix="/api/bundles", tags=["sop-tobe"])

_require_author = require_bundle_role("author")
_require_member = require_bundle_role(*MEMBER_ROLES)

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
TEMPLATE_FILE_NAME = "tobe-template.xlsx"


async def _write_tobe(
    session: AsyncSession,
    ctx: BundleContext,
    payload: ToBeIn | tobe_excel.ParsedWorkbook,
    *,
    revision: int,
    source: Literal["api", "excel"],
) -> ToBeOut:
    """PUT과 가져오기가 함께 쓰는 쓰기 — 묶음 행을 잠그고 revision·상태를 확인한 뒤 저장·커밋하고 새 목록을 돌려준다."""
    bundle = ctx.bundle
    await lock_bundle(session, bundle)
    check_revision("bundle", bundle.id, revision, bundle.revision)
    ensure_editable(bundle)
    await apply_tobe(session, bundle, payload, actor=ctx.login_id, source=source)
    await session.commit()
    return await build_tobe_out(session, bundle)


@router.get("/{bundle_id}/tobe", response_model=ToBeOut)
async def get_tobe(
    ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> ToBeOut:
    return await build_tobe_out(session, ctx.bundle)


@router.put("/{bundle_id}/tobe", response_model=ToBeOut)
async def put_tobe(
    body: ToBeIn,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeOut:
    return await _write_tobe(session, ctx, body, revision=body.revision, source="api")


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


@router.post("/{bundle_id}/tobe/import", response_model=ToBeOut)
async def import_tobe(
    file: UploadFile = File(),
    revision: int = Form(ge=1),
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> ToBeOut:
    # 상한보다 1바이트 더 읽어 넘었는지만 알린다 — 큰 파일을 통째로 메모리에 올리지 않는다
    data = await file.read(tobe_excel.MAX_FILE_BYTES + 1)
    # 파싱은 CPU를 쓰므로 이벤트 루프 밖에서 돌린다(묶음 잠금도 파싱이 끝난 뒤에 잡는다)
    parsed = await asyncio.to_thread(tobe_excel.parse_tobe_workbook, data)
    return await _write_tobe(session, ctx, parsed, revision=revision, source="excel")
