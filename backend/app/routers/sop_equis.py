"""EQUIS 조회 API — 사람이 누르는 "다시 조회"와, 저장 뒤 조회를 거는 공용 도우미(설계 §8.2·§8.4)."""

from collections.abc import Iterable
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.clock import KST
from app.db import get_session
from app.equis import service as equis_service
from app.equis.rules import normalize_number
from app.sop.errors import raise_rule
from app.sop.membership import BundleContext, ensure_editable, require_bundle_role
from app.sop.models import Bundle, Document, TargetDoc
from app.sop.schemas import NO_NUL

router = APIRouter(prefix="/api/bundles", tags=["sop-equis"])

_require_author = require_bundle_role("author")


class EquisRefreshIn(BaseModel):
    document_number: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100), NO_NUL]


class EquisRefreshOut(BaseModel):
    # 조회를 새로 걸었는지 — 방금 조회한 번호나 조회 중인 번호는 다시 걸지 않는다
    requested: bool


async def start_lookups(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    bundle: Bundle,
    codes: Iterable[str],
    *,
    sync_titles: bool = True,
) -> None:
    """번호를 저장한 뒤와 목록을 읽을 때 부른다 — 받아 둔 이름으로 제목을 맞추고, 물을 번호는 응답 뒤에 조회한다.

    기능이 꺼져 있으면 아무 일도 하지 않는다. 조회는 응답 뒤에 돌아 저장을 늦추지도 막지도 않는다.
    """
    if sync_titles:
        await equis_service.sync_bundle_titles(session, bundle)
    requested = await equis_service.request_lookups(session, codes)
    await session.commit()
    for number in requested:
        background_tasks.add_task(equis_service.run_lookup, number)


async def _is_number_in_bundle(session: AsyncSession, bundle_id: int, number: str) -> bool:
    document = select(Document.id).where(
        Document.bundle_id == bundle_id, func.upper(func.trim(Document.doc_code)) == number
    )
    target = select(TargetDoc.id).where(TargetDoc.bundle_id == bundle_id, func.upper(func.trim(TargetDoc.code)) == number)
    return (await session.scalar(document.limit(1))) is not None or (await session.scalar(target.limit(1))) is not None


@router.post("/{bundle_id}/equis/refresh", response_model=EquisRefreshOut)
async def refresh_equis(
    body: EquisRefreshIn,
    background_tasks: BackgroundTasks,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> EquisRefreshOut:
    """이 묶음에 있는 번호 하나를 다시 조회한다 — 번호를 자유롭게 받으면 앱이 EQUIS 검색 창구가 된다."""
    ensure_editable(ctx.bundle)
    number = normalize_number(body.document_number)
    if not equis_service.needs_lookup(number) or not await _is_number_in_bundle(session, ctx.bundle.id, number):
        raise_rule(404, "equis_number_not_in_bundle")
    lookup = (await equis_service.load_lookups(session, [number])).get(number)
    if lookup is not None and lookup.fetched_at is not None:
        fetched_at = lookup.fetched_at.replace(tzinfo=KST) if lookup.fetched_at.tzinfo is None else lookup.fetched_at
        if clock.now() - fetched_at < timedelta(seconds=equis_service.REFRESH_DEBOUNCE_SECONDS):
            return EquisRefreshOut(requested=False)
    requested = await equis_service.request_lookups(session, [number], force=True)
    await session.commit()
    for item in requested:
        background_tasks.add_task(equis_service.run_lookup, item)
    return EquisRefreshOut(requested=bool(requested))
