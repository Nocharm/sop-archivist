"""참조 지도 API — 이 Bundle의 구성원만 연다(작성자·검토자 같음). 읽기만 한다(설계 2026-11-17 참조 지도 §7.1)."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.sop.constants import MEMBER_ROLES
from app.sop.membership import BundleContext, require_bundle_role
from app.sop.ref_map import MapOut, MapScope, build_reference_map

router = APIRouter(prefix="/api/bundles", tags=["sop-map"])

# 계정 활성(403) → 구성원(404) 그대로 — sysadmin·bundle.admin도 구성원이 아니면 열지 못한다
_require_member = require_bundle_role(*MEMBER_ROLES)


@router.get("/{bundle_id}/map", response_model=MapOut)
async def get_reference_map(
    scope: MapScope = Query("linked"),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> MapOut:
    return await build_reference_map(session, ctx, scope)
