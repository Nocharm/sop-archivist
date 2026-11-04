"""유효 권한 판정 단일 소스 — 개인 부여 ∪ 소속 부서 체인(리프→루트) 부여, 역할은 권한으로 펼친다.

require_permission·/api/me·관리 화면의 유효 권한 조회가 모두 get_effective_access 하나를 부른다.
부여는 더하기만 있고(금지·빼기 없음), 부서 부여는 그 부서와 모든 하위 부서 사람에게 닿는다.
"""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.catalog import PERMISSIONS, is_known_permission
from app.models import AccessGrant, Employee, Role, RolePermission
from app.orgchart import get_dept_chain_codes, load_dept_index
from app.settings import settings


@dataclass(frozen=True)
class AccessSource:
    """권한 하나가 어디서 왔는지 — 부여 대상과, 역할로 받았으면 그 역할 이름(권한 직접 부여면 None)."""

    kind: Literal["user", "dept"]
    subject_id: str
    role: str | None


@dataclass(frozen=True)
class EffectiveAccess:
    login_id: str
    # employees 행이 있는지(HR 동기화 전 첫 로그인이면 False)
    known: bool
    active: bool
    # APP_SYSADMINS 또는 dev 전권 — 이때 permissions는 카탈로그 전부이고 sources는 비어 있다
    is_sysadmin: bool
    permissions: frozenset[str]
    # 권한 키 → 출처(개인 먼저, 부서는 가까운 부서부터). 키는 이름순.
    sources: dict[str, tuple[AccessSource, ...]]


def is_sysadmin(login_id: str) -> bool:
    """APP_SYSADMINS 비상 열쇠 — 권한 표와 무관하고 표로는 줄 수 없다."""
    return login_id in settings.sysadmin_login_ids()


async def get_effective_access(session: AsyncSession, login_id: str) -> EffectiveAccess:
    """판정 규칙 ①~⑤ — 예외 없이 끝난다(모르는 사람·부서·끊긴 체인·순환은 닿는 데까지만)."""
    emp = await session.get(Employee, login_id)
    known = emp is not None
    active = emp is not None and emp.active
    # ① sysadmin ② dev 모드 기본 전권(로컬 잠금 방지). keycloak 모드에는 이 지름길이 없다.
    unenforced_dev = settings.resolved_auth_mode() == "dev" and not settings.dev_enforce_permissions
    if is_sysadmin(login_id) or unenforced_dev:
        return EffectiveAccess(login_id, known, active, True, frozenset(PERMISSIONS), {})
    # ③ 직원 없음 ④ 퇴직자 — 남은 부여가 있어도 권한 없음
    if emp is None or not emp.active:
        return EffectiveAccess(login_id, known, active, False, frozenset(), {})
    # ⑤ 체인은 미러에 있는 부서만 담는다 — 사라진 부서에 걸린 부여는 여기서 저절로 빠진다
    chain = get_dept_chain_codes(await load_dept_index(session), emp.dept_code)
    sources = await _collect_sources(session, login_id, chain)
    return EffectiveAccess(login_id, True, True, False, frozenset(sources), sources)


async def _collect_sources(
    session: AsyncSession, login_id: str, chain: list[str]
) -> dict[str, tuple[AccessSource, ...]]:
    subject_filter = and_(AccessGrant.subject_type == "user", AccessGrant.subject_id == login_id)
    if chain:
        subject_filter = or_(
            subject_filter,
            and_(AccessGrant.subject_type == "dept", AccessGrant.subject_id.in_(chain)),
        )
    grants = list((await session.execute(
        select(AccessGrant.subject_type, AccessGrant.subject_id, AccessGrant.role_id,
               AccessGrant.permission, Role.name.label("role_name"))
        .outerjoin(Role, Role.id == AccessGrant.role_id)
        .where(subject_filter)
        .order_by(AccessGrant.id)
    )).all())

    role_ids = {g.role_id for g in grants if g.role_id is not None}
    role_permissions: dict[int, list[str]] = {}
    if role_ids:
        rows = await session.execute(
            select(RolePermission.role_id, RolePermission.permission)
            .where(RolePermission.role_id.in_(role_ids))
            .order_by(RolePermission.permission)
        )
        for role_id, permission in rows:
            role_permissions.setdefault(role_id, []).append(permission)

    # 출처 순서를 결정적으로 — 개인 부여 먼저, 부서는 리프(가까운 부서)부터. 같은 대상 안에서는 부여 순(정렬은 안정).
    rank = {("user", login_id): 0} | {("dept", code): depth + 1 for depth, code in enumerate(chain)}
    grants.sort(key=lambda g: rank[(g.subject_type, g.subject_id)])

    sources: dict[str, list[AccessSource]] = {}
    for grant in grants:
        is_role_grant = grant.role_id is not None
        keys = role_permissions.get(grant.role_id, []) if is_role_grant else [grant.permission]
        source = AccessSource(
            kind=grant.subject_type, subject_id=grant.subject_id,
            role=grant.role_name if is_role_grant else None,
        )
        for key in keys:
            if not is_known_permission(key):
                continue  # 카탈로그에서 빠진 옛 키 — 행은 남겨도 권한으로는 치지 않는다
            bucket = sources.setdefault(key, [])
            if source not in bucket:
                bucket.append(source)
    return {key: tuple(sources[key]) for key in sorted(sources)}
