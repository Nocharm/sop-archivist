"""묶음 접근 판정 — 요청 사람이 이 묶음의 어떤 역할인지(멤버십)를 정한다. 권한(require_permission)과 별개다."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Employee
from app.sop.constants import MEMBER_ROLES
from app.sop.errors import raise_rule
from app.sop.models import Bundle, BundleMember

# 경로의 묶음 ID 범위 — 정수 범위를 넘는 값이 DB까지 가서 500이 되지 않게(Postgres INTEGER 상한)
BundleIdPath = Annotated[int, Path(ge=1, le=2_147_483_647)]


@dataclass(frozen=True)
class BundleContext:
    bundle: Bundle
    login_id: str
    role: str


async def ensure_active_account(session: AsyncSession, login_id: str) -> None:
    """employees 행이 없거나 퇴직자면 403 — 퇴직자는 멤버여도 묶음을 열지 못한다."""
    employee = await session.get(Employee, login_id)
    if employee is None or not employee.active:
        raise_rule(403, "inactive_account")


def require_bundle_role(*roles: str) -> Callable[..., Awaitable[BundleContext]]:
    """경로 변수 bundle_id의 묶음에서 요청 사람의 역할이 roles 중 하나면 BundleContext를, 아니면 거절하는 의존성을 만든다.

    순서: 계정 활성(403) → 멤버(404) → 역할(403). 멤버가 아니면 있는 묶음도 없는 묶음과 같은 404이고,
    sysadmin도 예외가 아니다. 모르는 역할은 만드는 시점에 ValueError — 오타가 전원 403으로 숨지 않게 한다.
    """
    if not roles or any(role not in MEMBER_ROLES for role in roles):
        raise ValueError(f"roles must be a non-empty subset of {MEMBER_ROLES}: {roles}")

    async def check_bundle_role(
        bundle_id: BundleIdPath,
        login_id: str = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
    ) -> BundleContext:
        await ensure_active_account(session, login_id)
        member = await session.get(BundleMember, (bundle_id, login_id))
        bundle = await session.get(Bundle, bundle_id) if member is not None else None
        if member is None or bundle is None:
            raise_rule(404, "bundle_not_found")
        if member.role not in roles:
            raise_rule(403, "role_required", roles=list(roles))
        return BundleContext(bundle=bundle, login_id=login_id, role=member.role)

    return check_bundle_role


def ensure_editable(bundle: Bundle) -> None:
    """변경 요청은 작업 중(in_progress)일 때만 받는다."""
    if bundle.status != "in_progress":
        raise_rule(409, "bundle_not_editable", status=bundle.status)


async def lock_bundle(session: AsyncSession, bundle: Bundle) -> None:
    """쓰기 직전에 묶음 행을 잠그고 최신으로 다시 읽는다.

    같은 revision을 든 두 요청이 둘 다 검사를 통과해 서로 덮어쓰거나, 상태가 막 바뀐 묶음을 작업 중으로 믿고 고치는 걸 막는다.
    Postgres는 FOR UPDATE로 다른 쓰기를 기다리게 하고 sqlite는 잠금 구문 없이 다시 읽기만 한다.
    """
    await session.refresh(bundle, with_for_update=True)
