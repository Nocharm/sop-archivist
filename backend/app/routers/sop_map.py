"""참조 지도 API — 이 Bundle의 구성원만 연다(작성자·검토자 같음). 읽기만 한다(설계 2026-11-17 참조 지도 §7.1·§7.2)."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.sop.constants import MEMBER_ROLES
from app.sop.membership import BundleContext, require_bundle_role
from app.sop.ref_map import (
    NODE_MAX_LENGTH,
    NODE_PATTERN,
    MapLinesOut,
    MapOut,
    MapScope,
    build_node_lines,
    build_reference_map,
)

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


@router.get("/{bundle_id}/map/lines", response_model=MapLinesOut)
async def get_map_lines(
    node: str = Query(max_length=NODE_MAX_LENGTH, pattern=NODE_PATTERN),
    scope: MapScope = Query("linked"),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> MapLinesOut:
    """고른 마디의 줄 — 문장은 그 줄이 든 Bundle의 구성원에게만, 그 밖의 줄은 선마다 줄 수만(`withheld_*`)."""
    return await build_node_lines(session, ctx, node, scope)
