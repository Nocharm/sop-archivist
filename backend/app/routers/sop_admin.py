"""묶음 관리 API(bundle.admin) — 모든 묶음의 메타 정보와 멤버 바꾸기. 내용(문서·문장)은 멤버가 되어야 본다.

작성자가 모두 퇴직한 묶음을 정리하려고 있는 권한이다. 자기를 멤버로 넣으면 작업 기록에 reason="admin"으로 남는다.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.deps import require_permission
from app.db import get_session
from app.routers.admin import KstDatetime
from app.routers.sop_bundles import MemberOut, MembersUpdateIn, load_members, replace_bundle_members
from app.sop.errors import raise_rule
from app.sop.membership import BundleIdPath
from app.sop.models import Bundle
from app.sop.snapshot import BundleProgress, load_bundle_progress

router = APIRouter(prefix="/api/admin/bundles", tags=["sop-admin"])

# 각 엔드포인트의 첫 의존성으로 건다 — 경로 변수가 아무 값이어도 권한 없는 사람은 403이 먼저 난다(test_admin_ops가 전 라우트로 확인)
_require_bundle_admin = require_permission("bundle.admin")


class AdminBundleOut(BaseModel):
    """묶음 메타 한 줄 — 내용은 싣지 않는다. revision은 멤버 바꾸기 요청이 들고 와야 해서 싣는다."""

    id: int
    code: str
    title: str
    status: str
    revision: int
    members: list[MemberOut]
    # 활성 작성자가 한 명도 없으면 false — 정리가 필요한 묶음
    has_active_author: bool
    created_at: KstDatetime
    # 언어별 진행 숫자 — 글자 없이 건수만이라 메타 정보다(스펙 §9)
    progress: BundleProgress


def build_admin_item(bundle: Bundle, members: list[MemberOut], progress: BundleProgress) -> AdminBundleOut:
    return AdminBundleOut(
        id=bundle.id,
        code=bundle.code,
        title=bundle.title,
        status=bundle.status,
        revision=bundle.revision,
        members=members,
        has_active_author=any(member.role == "author" and member.active for member in members),
        created_at=bundle.created_at,
        progress=progress,
    )


@router.get("", response_model=list[AdminBundleOut])
async def list_admin_bundles(
    _login_id: str = Depends(_require_bundle_admin),
    session: AsyncSession = Depends(get_session),
) -> list[AdminBundleOut]:
    bundles = list(await session.scalars(select(Bundle).order_by(Bundle.id.desc())))
    bundle_ids = [bundle.id for bundle in bundles]
    members = await load_members(session, bundle_ids)
    progress = await load_bundle_progress(session, bundle_ids)
    return [build_admin_item(bundle, members[bundle.id], progress[bundle.id]) for bundle in bundles]


@router.put("/{bundle_id}/members", response_model=AdminBundleOut)
async def update_bundle_members_as_admin(
    bundle_id: BundleIdPath,
    body: MembersUpdateIn,
    login_id: str = Depends(_require_bundle_admin),
    session: AsyncSession = Depends(get_session),
) -> AdminBundleOut:
    bundle = await session.get(Bundle, bundle_id)
    if bundle is None:
        raise_rule(404, "bundle_not_found")
    await replace_bundle_members(session, bundle, body, actor=login_id, reason="admin")
    await session.commit()
    members = await load_members(session, [bundle.id])
    progress = await load_bundle_progress(session, [bundle.id])
    return build_admin_item(bundle, members[bundle.id], progress[bundle.id])
