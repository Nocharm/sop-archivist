"""판단 API — 단위 목록·관계 묶음·같은 글자 후보 읽기(멤버)와 관계 묶음 저장·일괄 처분·배정 지우기·입구 2 한 번에 확정(작성자·작업 중).

검사와 쓰기는 app/sop/decisions.py(입구 2 한 번에 확정은 app/sop/match.py).
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.sop.constants import MEMBER_ROLES
from app.sop.decisions import (
    DEFAULT_UNITS_PAGE,
    MAX_UNITS_PAGE,
    BulkDecisionIn,
    ClearIn,
    GroupSaveIn,
    UnitDecisionRowOut,
    UnitsPageOut,
    clear_unit,
    dispose_units,
    list_units,
    save_group,
)
from app.sop.detach import DetachReport
from app.sop.groups import GroupOut, load_group
from app.sop.match import BulkMatchIn, IdenticalCandidate, confirm_in_bulk, list_identical_candidates
from app.sop.membership import BundleContext, require_bundle_role
from app.sop.tobe import MAX_DB_INT

router = APIRouter(prefix="/api/bundles", tags=["sop-decisions"])

_require_author = require_bundle_role("author")
_require_member = require_bundle_role(*MEMBER_ROLES)

# 경로의 단위·새 문장 ID 범위 — 정수 범위를 넘는 값이 DB까지 가서 500이 되지 않게
IdPath = Annotated[int, Path(ge=1, le=MAX_DB_INT)]


@router.get("/{bundle_id}/units", response_model=UnitsPageOut)
async def get_units(
    # 판단은 옛 문서 단위에만 있어 이 목록은 옛 문서 단위만 다룬다
    side: Literal["old"] = Query("old"),
    lang: Literal["ko", "en", "neutral"] | None = Query(None),
    status: Literal["unassigned", "ai_suggested", "confirmed", "on_hold"] | None = Query(None),
    document_id: int | None = Query(None, ge=1, le=MAX_DB_INT),
    target_doc_id: int | None = Query(None, ge=1, le=MAX_DB_INT),
    limit: int = Query(DEFAULT_UNITS_PAGE, ge=1, le=MAX_UNITS_PAGE),
    offset: int = Query(0, ge=0, le=MAX_DB_INT),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> UnitsPageOut:
    return await list_units(
        session, ctx.bundle.id, lang=lang, status=status, document_id=document_id, target_doc_id=target_doc_id,
        limit=limit, offset=offset,
    )


@router.get("/{bundle_id}/groups/by-unit/{unit_id}", response_model=GroupOut)
async def get_group_by_unit(
    unit_id: IdPath, ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> GroupOut:
    return await load_group(session, ctx.bundle.id, unit_id=unit_id)


@router.get("/{bundle_id}/groups/by-target/{target_id}", response_model=GroupOut)
async def get_group_by_target(
    target_id: IdPath, ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> GroupOut:
    return await load_group(session, ctx.bundle.id, target_id=target_id)


@router.post("/{bundle_id}/groups/save", response_model=GroupOut)
async def save_relation_group(
    body: GroupSaveIn, ctx: BundleContext = Depends(_require_author), session: AsyncSession = Depends(get_session)
) -> GroupOut:
    group = await save_group(session, ctx.bundle, body, ctx.login_id)
    await session.commit()
    return group


@router.post("/{bundle_id}/decisions/bulk", response_model=list[UnitDecisionRowOut])
async def dispose_units_in_bulk(
    body: BulkDecisionIn, ctx: BundleContext = Depends(_require_author), session: AsyncSession = Depends(get_session)
) -> list[UnitDecisionRowOut]:
    rows = await dispose_units(session, ctx.bundle, body, ctx.login_id)
    await session.commit()
    return rows


@router.post("/{bundle_id}/decisions/clear", response_model=DetachReport)
async def clear_unit_decision(
    body: ClearIn, ctx: BundleContext = Depends(_require_author), session: AsyncSession = Depends(get_session)
) -> DetachReport:
    report = await clear_unit(session, ctx.bundle, body, ctx.login_id)
    await session.commit()
    return report


@router.get("/{bundle_id}/match/identical-candidates", response_model=list[IdenticalCandidate])
async def get_identical_candidates(
    ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> list[IdenticalCandidate]:
    return await list_identical_candidates(session, ctx.bundle.id)


@router.post("/{bundle_id}/match/bulk-confirm", response_model=GroupOut)
async def confirm_matches_in_bulk(
    body: BulkMatchIn, ctx: BundleContext = Depends(_require_author), session: AsyncSession = Depends(get_session)
) -> GroupOut:
    group = await confirm_in_bulk(session, ctx.bundle, body, ctx.login_id)
    await session.commit()
    return group
