"""묶음 API — 내 묶음 목록·만들기·고치기·삭제·멤버 바꾸기·작업 기록·검토 흐름. 묶음은 멤버만 열 수 있다(sysadmin도 예외 없음)."""

from collections import Counter
from collections.abc import Collection
from typing import Annotated, Self

from fastapi import APIRouter, Depends, Query, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictBool, StringConstraints, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.deps import require_permission
from app.auth import get_current_user
from app.db import get_session
from app.models import Employee
from app.routers.admin import KstDatetime
from app.sop.constants import MEMBER_ROLES, SEMANTIC_CHECK_KEYS
from app.sop.errors import check_revision, raise_rule
from app.sop.events import record_event
from app.sop.membership import (
    BundleContext,
    ensure_active_account,
    ensure_editable,
    lock_bundle,
    require_bundle_role,
)
from app.sop.models import Bundle, BundleDeletionRecord, BundleEvent, BundleMember
from app.sop.review import (
    NextAction,
    Readiness,
    complete_review,
    compute_readiness,
    get_next_action,
    reopen_review,
    request_review,
    return_review,
    update_semantic_checks,
)
from app.sop.snapshot import BundleProgress, load_bundle_progress

router = APIRouter(prefix="/api/bundles", tags=["sop-bundles"])

_require_bundle_create = require_permission("bundle.create")
_require_author = require_bundle_role("author")
_require_reviewer = require_bundle_role("reviewer")
_require_member = require_bundle_role(*MEMBER_ROLES)

# 작업 기록 한 번에 돌려주는 기본·최대 건수 — 큰 limit은 거부하지 않고 최대로 자른다
DEFAULT_EVENTS_LIMIT = 100
MAX_EVENTS_LIMIT = 500

# 묶음 설명 길이와 멤버 수 상한 — 본문이 끝없이 커지지 않게 경계에서 막는다
MAX_DESCRIPTION_CHARS = 2000
MAX_MEMBERS = 200


def _check_member_role(value: str) -> str:
    if value not in MEMBER_ROLES:
        raise ValueError(f"role must be one of {MEMBER_ROLES}")
    return value


def _check_semantic_check_keys(value: dict[str, bool]) -> dict[str, bool]:
    if set(value) != set(SEMANTIC_CHECK_KEYS):
        raise ValueError(f"checks must have exactly the keys {SEMANTIC_CHECK_KEYS}")
    return value


BundleTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
LoginId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
MemberRole = Annotated[str, AfterValidator(_check_member_role)]
ReviewReason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
SemanticChecks = Annotated[dict[str, StrictBool], AfterValidator(_check_semantic_check_keys)]


class BundleCreateIn(BaseModel):
    title: BundleTitle
    description: str = Field("", max_length=MAX_DESCRIPTION_CHARS)
    is_synthetic: bool = False


class BundleUpdateIn(BaseModel):
    revision: int = Field(ge=1)
    title: BundleTitle | None = None
    description: str | None = Field(None, max_length=MAX_DESCRIPTION_CHARS)

    @model_validator(mode="after")
    def check_something_to_change(self) -> Self:
        if self.title is None and self.description is None:
            raise ValueError("title or description is required")
        return self


class MemberIn(BaseModel):
    login_id: LoginId
    role: MemberRole


class MembersUpdateIn(BaseModel):
    revision: int = Field(ge=1)
    members: list[MemberIn] = Field(max_length=MAX_MEMBERS)


class SemanticChecksUpdateIn(BaseModel):
    revision: int = Field(ge=1)
    checks: SemanticChecks


class ReviewRequestIn(BaseModel):
    revision: int = Field(ge=1)


class ReviewReasonIn(ReviewRequestIn):
    reason: ReviewReason


class MemberOut(BaseModel):
    login_id: str
    role: str
    name: str
    korean_name: str
    # employees 행이 없거나 퇴직자면 false — 화면이 "접근 못 하는 멤버"를 표시한다
    active: bool


class BundleBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str
    status: str
    is_synthetic: bool
    semantic_checks: dict[str, object]
    revision: int
    created_by: str
    created_at: KstDatetime
    updated_at: KstDatetime


class BundleOut(BundleBase):
    # 멤버 바꾸기 응답에서만 None이 될 수 있다 — 호출한 작성자가 스스로 빠진 경우
    my_role: str | None
    members: list[MemberOut]
    # 개요의 언어별 진행 숫자(커버 상태별 옛 단위 수)
    progress: BundleProgress
    # 사람이 다음에 할 일 하나(검토 요청 조건을 해야 하는 순서로 훑은 것)
    next_action: NextAction


class BundleListItem(BaseModel):
    id: int
    title: str
    status: str
    my_role: str
    updated_at: KstDatetime
    progress: BundleProgress


class BundleEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    occurred_at: KstDatetime
    actor: str
    action: str
    target_type: str
    target_ids: list[int | str]
    reason: str


async def load_members(session: AsyncSession, bundle_ids: Collection[int]) -> dict[int, list[MemberOut]]:
    """묶음별 멤버(이름·활성 포함)를 쿼리 한 번으로 읽는다. 작성자가 앞에 오고 그 안에서는 loginId 순이다."""
    members: dict[int, list[MemberOut]] = {bundle_id: [] for bundle_id in bundle_ids}
    if not bundle_ids:
        return members
    rows = await session.execute(
        select(BundleMember, Employee)
        .outerjoin(Employee, Employee.login_id == BundleMember.login_id)
        .where(BundleMember.bundle_id.in_(bundle_ids))
        # 역할 이름이 가나다순으로 author < reviewer라 그대로 작성자가 앞에 온다
        .order_by(BundleMember.bundle_id, BundleMember.role, BundleMember.login_id)
    )
    for member, employee in rows:
        members[member.bundle_id].append(
            MemberOut(
                login_id=member.login_id,
                role=member.role,
                name=employee.name if employee else "",
                korean_name=employee.korean_name if employee else "",
                active=employee is not None and employee.active,
            )
        )
    return members


async def build_bundle_out(
    session: AsyncSession, bundle: Bundle, login_id: str, *, next_action: NextAction | None = None
) -> BundleOut:
    """개요 응답. next_action을 알면(방금 만든 묶음) 넘겨 조건 계산을 건너뛴다."""
    members = (await load_members(session, [bundle.id]))[bundle.id]
    my_role = next((member.role for member in members if member.login_id == login_id), None)
    progress = (await load_bundle_progress(session, [bundle.id]))[bundle.id]
    return BundleOut(
        **BundleBase.model_validate(bundle).model_dump(), my_role=my_role, members=members, progress=progress,
        next_action=next_action or await get_next_action(session, bundle),
    )


async def replace_bundle_members(
    session: AsyncSession, bundle: Bundle, body: MembersUpdateIn, *, actor: str, reason: str = ""
) -> None:
    """멤버를 통째로 바꾼다(작성자 경로와 bundle.admin 경로가 같은 검사를 쓴다). 상태와 무관하게 바꿀 수 있고 커밋은 호출부가 한다.

    바뀐 것이 없으면 revision도 기록도 건드리지 않는다.
    """
    await lock_bundle(session, bundle)
    check_revision("bundle", bundle.id, body.revision, bundle.revision)

    wanted = {member.login_id: member.role for member in body.members}
    counts = Counter(member.login_id for member in body.members)
    duplicates = sorted(login_id for login_id, count in counts.items() if count > 1)
    if duplicates:
        raise_rule(422, "duplicate_member", login_ids=duplicates)
    active_ids = set(
        await session.scalars(
            select(Employee.login_id).where(Employee.login_id.in_(list(wanted)), Employee.active.is_(True))
        )
    )
    unknown = sorted(wanted.keys() - active_ids)
    if unknown:
        raise_rule(422, "unknown_member", login_ids=unknown)
    # 새 멤버는 모두 활성(위 검사)이라 작성자 역할이 하나라도 있으면 활성 작성자가 있다
    if "author" not in wanted.values():
        raise_rule(422, "no_active_author")

    rows = await session.scalars(select(BundleMember).where(BundleMember.bundle_id == bundle.id))
    current = {member.login_id: member for member in rows}
    role_changed = {
        login_id for login_id in current.keys() & wanted.keys() if current[login_id].role != wanted[login_id]
    }
    changed = sorted((current.keys() ^ wanted.keys()) | role_changed)
    if not changed:
        return

    for login_id, member in current.items():
        if login_id not in wanted:
            await session.delete(member)
        else:
            member.role = wanted[login_id]
    for login_id in wanted.keys() - current.keys():
        session.add(BundleMember(bundle_id=bundle.id, login_id=login_id, role=wanted[login_id], added_by=actor))
    bundle.revision += 1
    record_event(
        session, bundle_id=bundle.id, actor=actor, action="bundle.members",
        target_type="member", target_ids=changed, reason=reason,
    )


@router.get("", response_model=list[BundleListItem])
async def list_my_bundles(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[BundleListItem]:
    await ensure_active_account(session, login_id)
    rows = (
        await session.execute(
            select(Bundle.id, Bundle.title, Bundle.status, BundleMember.role.label("my_role"), Bundle.updated_at)
            .join(BundleMember, BundleMember.bundle_id == Bundle.id)
            .where(BundleMember.login_id == login_id)
            .order_by(Bundle.updated_at.desc(), Bundle.id.desc())
        )
    ).all()
    progress = await load_bundle_progress(session, [row.id for row in rows])
    return [BundleListItem(**row._asdict(), progress=progress[row.id]) for row in rows]


@router.post("", response_model=BundleOut, status_code=201)
async def create_bundle(
    body: BundleCreateIn,
    login_id: str = Depends(_require_bundle_create),
    session: AsyncSession = Depends(get_session),
) -> BundleOut:
    # 퇴직자·디렉터리에 없는 사람이 만들면 처음부터 접근 못 하는 작성자만 있는 묶음이 생긴다
    await ensure_active_account(session, login_id)
    bundle = Bundle(
        title=body.title, description=body.description, is_synthetic=body.is_synthetic, created_by=login_id
    )
    session.add(bundle)
    await session.flush()  # 묶음 id가 필요하다
    session.add(BundleMember(bundle_id=bundle.id, login_id=login_id, role="author", added_by=login_id))
    record_event(
        session, bundle_id=bundle.id, actor=login_id, action="bundle.create",
        target_type="bundle", target_ids=[bundle.id],
    )
    await session.commit()
    # 방금 만든 묶음에는 문서가 없다 — 조건을 계산하지 않고 첫 행동을 바로 안내한다
    return await build_bundle_out(session, bundle, login_id, next_action="upload_documents")


@router.get("/{bundle_id}", response_model=BundleOut)
async def get_bundle(
    ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> BundleOut:
    return await build_bundle_out(session, ctx.bundle, ctx.login_id)


@router.patch("/{bundle_id}", response_model=BundleOut)
async def update_bundle(
    body: BundleUpdateIn,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> BundleOut:
    bundle = ctx.bundle
    await lock_bundle(session, bundle)
    check_revision("bundle", bundle.id, body.revision, bundle.revision)
    ensure_editable(bundle)
    if body.title is not None:
        bundle.title = body.title
    if body.description is not None:
        bundle.description = body.description
    bundle.revision += 1
    record_event(
        session, bundle_id=bundle.id, actor=ctx.login_id, action="bundle.update",
        target_type="bundle", target_ids=[bundle.id],
    )
    await session.commit()
    return await build_bundle_out(session, bundle, ctx.login_id)


@router.delete("/{bundle_id}", status_code=204)
async def delete_bundle(
    revision: int = Query(ge=1),
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> Response:
    bundle = ctx.bundle
    await lock_bundle(session, bundle)
    check_revision("bundle", bundle.id, revision, bundle.revision)
    ensure_editable(bundle)
    # 묶음이 지워지면 작업 기록도 함께 사라지므로 누가 어떤 묶음을 지웠는지는 묶음 밖 전역 기록에 남긴다
    session.add(BundleDeletionRecord(bundle_id=bundle.id, title=bundle.title, actor=ctx.login_id))
    await session.delete(bundle)  # 나머지 SOP 표는 DB의 ON DELETE CASCADE가 지운다
    await session.commit()
    return Response(status_code=204)


@router.put("/{bundle_id}/members", response_model=BundleOut)
async def update_members(
    body: MembersUpdateIn,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> BundleOut:
    await replace_bundle_members(session, ctx.bundle, body, actor=ctx.login_id)
    await session.commit()
    return await build_bundle_out(session, ctx.bundle, ctx.login_id)


@router.get("/{bundle_id}/review/readiness", response_model=Readiness)
async def get_review_readiness(
    ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)
) -> Readiness:
    return await compute_readiness(session, ctx.bundle)


@router.put("/{bundle_id}/semantic-checks", response_model=BundleOut)
async def put_semantic_checks(
    body: SemanticChecksUpdateIn,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> BundleOut:
    await update_semantic_checks(session, ctx.bundle, revision=body.revision, checks=body.checks, actor=ctx.login_id)
    await session.commit()
    return await build_bundle_out(session, ctx.bundle, ctx.login_id)


@router.post("/{bundle_id}/review/request", response_model=BundleOut)
async def post_review_request(
    body: ReviewRequestIn,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> BundleOut:
    await request_review(session, ctx.bundle, revision=body.revision, actor=ctx.login_id)
    await session.commit()
    return await build_bundle_out(session, ctx.bundle, ctx.login_id)


@router.post("/{bundle_id}/review/complete", response_model=BundleOut)
async def post_review_complete(
    body: ReviewRequestIn,
    ctx: BundleContext = Depends(_require_reviewer),
    session: AsyncSession = Depends(get_session),
) -> BundleOut:
    await complete_review(session, ctx.bundle, revision=body.revision, actor=ctx.login_id)
    await session.commit()
    return await build_bundle_out(session, ctx.bundle, ctx.login_id)


@router.post("/{bundle_id}/review/return", response_model=BundleOut)
async def post_review_return(
    body: ReviewReasonIn,
    ctx: BundleContext = Depends(_require_reviewer),
    session: AsyncSession = Depends(get_session),
) -> BundleOut:
    await return_review(session, ctx.bundle, revision=body.revision, reason=body.reason, actor=ctx.login_id)
    await session.commit()
    return await build_bundle_out(session, ctx.bundle, ctx.login_id)


@router.post("/{bundle_id}/review/reopen", response_model=BundleOut)
async def post_review_reopen(
    body: ReviewReasonIn,
    ctx: BundleContext = Depends(_require_author),
    session: AsyncSession = Depends(get_session),
) -> BundleOut:
    await reopen_review(session, ctx.bundle, revision=body.revision, reason=body.reason, actor=ctx.login_id)
    await session.commit()
    return await build_bundle_out(session, ctx.bundle, ctx.login_id)


@router.get("/{bundle_id}/events", response_model=list[BundleEventOut])
async def list_bundle_events(
    limit: int = Query(DEFAULT_EVENTS_LIMIT, ge=1),
    ctx: BundleContext = Depends(_require_member),
    session: AsyncSession = Depends(get_session),
) -> list[BundleEvent]:
    # 같은 초에 쌓인 사건은 autoincrement id가 순서를 정한다
    rows = await session.scalars(
        select(BundleEvent)
        .where(BundleEvent.bundle_id == ctx.bundle.id)
        .order_by(BundleEvent.occurred_at.desc(), BundleEvent.id.desc())
        .limit(min(limit, MAX_EVENTS_LIMIT))
    )
    return list(rows)
