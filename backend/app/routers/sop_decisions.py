"""판단 API — 단위 목록·관계 묶음·같은 글자 후보 읽기(멤버)와 관계 묶음 저장·일괄 처분·배정 지우기·입구 2 한 번에 확정(작성자·작업 중).
Remark 고르기 도움(내 최근 사유 — 묶음 밖 `remarks_router`, 외부 이동 대상 후보 — 멤버)도 여기 둔다.

검사와 쓰기는 app/sop/decisions.py(입구 2 한 번에 확정은 app/sop/match.py).
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.sop.constants import MEMBER_ROLES
from app.sop.decisions import (
    DEFAULT_UNITS_PAGE,
    MAX_UNITS_PAGE,
    BulkDecisionIn,
    ClearIn,
    GroupSaveIn,
    ResetIn,
    ResetOut,
    UnitDecisionRowOut,
    UnitsPageOut,
    clear_unit,
    dispose_units,
    list_units,
    reset_assignments,
    save_group,
)
from app.sop.detach import DetachReport
from app.sop.groups import GroupOut, load_group
from app.sop.match import BulkMatchIn, IdenticalCandidate, confirm_in_bulk, list_identical_candidates
from app.sop.membership import BundleContext, ensure_active_account, require_bundle_role
from app.sop.remarks import (
    DEFAULT_MOVE_TARGETS,
    MAX_MOVE_TARGETS,
    MAX_RECENT_REMARKS,
    MoveTargetOut,
    RecentRemarkOut,
    list_move_targets,
    list_recent_remarks,
)
from app.sop.tobe import MAX_DB_INT
from app.sop.written import NewCandidateOut, WrittenSentenceOut, list_new_candidates, list_written_sentences

router = APIRouter(prefix="/api/bundles", tags=["sop-decisions"])
remarks_router = APIRouter(prefix="/api/sop/remarks", tags=["sop-decisions"])

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


@router.post("/{bundle_id}/decisions/reset", response_model=ResetOut)
async def reset_decisions(
    body: ResetIn, ctx: BundleContext = Depends(_require_author), session: AsyncSession = Depends(get_session)
) -> ResetOut:
    """문서 하나(document_id) 또는 묶음 전체의 배정 초기화. dry_run이면 건수만 돌려주고 바꾸지 않는다."""
    out = await reset_assignments(session, ctx.bundle, body, ctx.login_id)
    await session.commit()
    return out


@router.get("/{bundle_id}/written-sentences", response_model=list[WrittenSentenceOut])
async def get_written_sentences(
    ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> list[WrittenSentenceOut]:
    """Assign 화면의 New 원문 — 이미 쓴 문서(입구 2)의 최상위 문장과 출처·한/영 짝 상대."""
    return await list_written_sentences(session, ctx.bundle.id)


@router.get("/{bundle_id}/units/{unit_id}/new-candidates", response_model=list[NewCandidateOut])
async def get_new_candidates(
    unit_id: IdPath, ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> list[NewCandidateOut]:
    """Old 단위 하나에 가까운 이미 쓴 문서 문장 — 임베딩 캐시만 읽고 없으면 글자 유사도(LLM·임베딩 호출 없음)."""
    return await list_new_candidates(session, ctx.bundle.id, unit_id)


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


@router.get("/{bundle_id}/move-targets", response_model=list[MoveTargetOut])
async def get_move_targets(
    q: str = Query("", max_length=100),
    limit: int = Query(DEFAULT_MOVE_TARGETS, ge=1, le=MAX_MOVE_TARGETS),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> list[MoveTargetOut]:
    """외부 이동 대상 후보 — 내가 멤버인 다른 묶음의 To-Be 문서와 전에 쓴 이동 코드(전에 쓴 것 먼저, 그다음 q와 맞는 정도)."""
    return await list_move_targets(session, ctx.bundle.id, ctx.login_id, q, limit)


@remarks_router.get("/recent", response_model=list[RecentRemarkOut])
async def get_recent_remarks(
    limit: int = Query(MAX_RECENT_REMARKS, ge=1, le=MAX_RECENT_REMARKS),
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[RecentRemarkOut]:
    """내가 쓴 사유를 최근 것부터(모든 묶음, 같은 글은 한 번) — Remark 창이 골라 넣는다."""
    await ensure_active_account(session, login_id)
    return await list_recent_remarks(session, login_id, limit)
