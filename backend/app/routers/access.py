"""권한 표 관리 API — 역할·부여 CRUD, 변경 기록, 유효 권한 조회. 전부 permission.manage가 필요하다.

변경 API는 변경과 기록(add_audit_event)을 한 트랜잭션으로 커밋한다. permission.manage 보유자는
permission.manage 자체도 줄 수 있고(sysadmin 없이 관리 부서를 넓히기 위해) 그것도 기록에 남는다.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.audit import add_audit_event
from app.access.catalog import PERMISSIONS, is_known_permission
from app.access.deps import require_permission
from app.access.resolve import AccessSource, get_effective_access
from app.clock import KST, now
from app.db import get_session
from app.models import AccessAuditEvent, AccessGrant, Department, Employee, Role, RolePermission

# 같은 의존성 객체를 라우터와 엔드포인트(행위자 login_id가 필요한 곳)가 함께 써서 요청당 판정은 한 번만 돈다
# (FastAPI 의존성 캐시). 라우터 단에도 걸어 두어 새 엔드포인트가 게이트 없이 열리는 일이 없게 한다.
_require_manage = require_permission("permission.manage")

router = APIRouter(prefix="/api/access", tags=["access"], dependencies=[Depends(_require_manage)])

# 변경 기록 한 번에 돌려주는 최대 건수 — 큰 limit은 거부하지 않고 이 값으로 자른다
MAX_AUDIT_LIMIT = 500

# 길이 상한은 컬럼 길이와 같다 — sqlite는 길이를 강제하지 않아 운영 Postgres에서만 500이 난다
RoleName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
PermissionKey = Annotated[str, StringConstraints(max_length=100)]
SubjectType = Literal["user", "dept"]


class RoleIn(BaseModel):
    name: RoleName
    description: str = Field("", max_length=500)
    permissions: list[PermissionKey] = Field(default_factory=list)


class RoleOut(BaseModel):
    id: int
    name: str
    description: str
    permissions: list[str]
    grant_count: int


class GrantIn(BaseModel):
    subject_type: SubjectType
    subject_id: str = Field(min_length=1, max_length=100)
    role_id: int | None = None
    permission: PermissionKey | None = None


class GrantOut(BaseModel):
    id: int
    subject_type: str
    subject_id: str
    # 개인은 Employee.name, 부서는 Department.name — 대상 행이 없으면 ""와 subject_missing=True
    subject_name: str
    subject_missing: bool
    role_id: int | None
    role_name: str | None
    permission: str | None
    created_by: str
    created_at: datetime


class AuditOut(BaseModel):
    id: int
    occurred_at: datetime
    actor: str
    action: str
    detail: dict[str, Any]


class SourceOut(BaseModel):
    kind: SubjectType
    subject_id: str
    subject_name: str
    role: str | None


class EffectiveOut(BaseModel):
    login_id: str
    known: bool
    active: bool
    is_sysadmin: bool
    permissions: list[str]
    sources: dict[str, list[SourceOut]]


def _normalize_to_kst(value: datetime) -> datetime:
    # sqlite는 시간대 없이 KST 벽시계로, Postgres(asyncpg)는 UTC로 돌려준다 — 응답은 어느 DB든 KST 오프셋으로 맞춘다
    return value.replace(tzinfo=KST) if value.tzinfo is None else value.astimezone(KST)


def _validate_permissions(keys: list[str]) -> list[str]:
    """모르는 키는 422, 중복은 접어 이름순으로."""
    for key in keys:
        if not is_known_permission(key):
            raise HTTPException(status_code=422, detail=f"unknown permission: {key}")
    return sorted(set(keys))


async def _load_role_permissions(session: AsyncSession, role_id: int) -> list[str]:
    return list((await session.scalars(
        select(RolePermission.permission)
        .where(RolePermission.role_id == role_id)
        .order_by(RolePermission.permission)
    )).all())


async def _count_role_grants(session: AsyncSession, role_id: int) -> int:
    return await session.scalar(
        select(func.count()).select_from(AccessGrant).where(AccessGrant.role_id == role_id)
    ) or 0


async def _ensure_role_name_free(session: AsyncSession, name: str, *, except_id: int | None = None) -> None:
    stmt = select(Role.id).where(Role.name == name)
    if except_id is not None:
        stmt = stmt.where(Role.id != except_id)
    if await session.scalar(stmt.limit(1)) is not None:
        raise HTTPException(status_code=409, detail="role name already exists")


async def _commit_or_conflict(session: AsyncSession, status_code: int, detail: str) -> None:
    """동시 요청이 API 검사를 앞질러 DB 제약에 걸리면 500 대신 같은 오류 문구로 돌려준다."""
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=status_code, detail=detail) from exc


async def _load_subject_names(
    session: AsyncSession, subjects: set[tuple[str, str]]
) -> dict[tuple[str, str], str]:
    """(kind, subject_id) → 표시 이름. 행이 없는 대상은 결과에 없다(사라진 대상 판정)."""
    user_ids = {sid for kind, sid in subjects if kind == "user"}
    dept_codes = {sid for kind, sid in subjects if kind == "dept"}
    names: dict[tuple[str, str], str] = {}
    if user_ids:
        rows = await session.execute(
            select(Employee.login_id, Employee.name).where(Employee.login_id.in_(user_ids))
        )
        names.update({("user", login_id): name for login_id, name in rows})
    if dept_codes:
        rows = await session.execute(
            select(Department.dept_code, Department.name).where(Department.dept_code.in_(dept_codes))
        )
        names.update({("dept", code): name for code, name in rows})
    return names


def _build_grant_detail(grant: AccessGrant, role_name: str | None) -> dict[str, Any]:
    return {
        "grant_id": grant.id, "subject_type": grant.subject_type, "subject_id": grant.subject_id,
        "role_id": grant.role_id, "role_name": role_name, "permission": grant.permission,
    }


@router.get("/catalog", response_model=list[str])
async def list_catalog() -> list[str]:
    return list(PERMISSIONS)


@router.get("/roles", response_model=list[RoleOut])
async def list_roles(
    session: AsyncSession = Depends(get_session),
) -> list[RoleOut]:
    roles = (await session.scalars(select(Role).order_by(Role.name))).all()
    permission_rows = await session.execute(
        select(RolePermission.role_id, RolePermission.permission).order_by(RolePermission.permission)
    )
    permissions: dict[int, list[str]] = {}
    for role_id, permission in permission_rows:
        permissions.setdefault(role_id, []).append(permission)
    grant_counts = dict((await session.execute(
        select(AccessGrant.role_id, func.count())
        .where(AccessGrant.role_id.is_not(None))
        .group_by(AccessGrant.role_id)
    )).all())
    return [
        RoleOut(
            id=role.id, name=role.name, description=role.description,
            permissions=permissions.get(role.id, []), grant_count=grant_counts.get(role.id, 0),
        )
        for role in roles
    ]


@router.post("/roles", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
async def create_role(
    body: RoleIn,
    actor: str = Depends(_require_manage),
    session: AsyncSession = Depends(get_session),
) -> RoleOut:
    permissions = _validate_permissions(body.permissions)
    await _ensure_role_name_free(session, body.name)
    role = Role(name=body.name, description=body.description)
    session.add(role)
    try:
        await session.flush()  # 권한 행·기록에 쓸 id
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail="role name already exists") from exc
    session.add_all(RolePermission(role_id=role.id, permission=key) for key in permissions)
    add_audit_event(session, actor, "role.create", {
        "role_id": role.id, "name": role.name, "description": role.description, "permissions": permissions,
    })
    await _commit_or_conflict(session, 409, "role name already exists")
    return RoleOut(
        id=role.id, name=role.name, description=role.description, permissions=permissions, grant_count=0,
    )


@router.put("/roles/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: int,
    body: RoleIn,
    actor: str = Depends(_require_manage),
    session: AsyncSession = Depends(get_session),
) -> RoleOut:
    """이름·설명·권한 목록을 통째로 바꾼다. 역할을 받은 사람들의 유효 권한이 곧바로 따라간다."""
    role = await session.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="role not found")
    permissions = _validate_permissions(body.permissions)
    await _ensure_role_name_free(session, body.name, except_id=role.id)
    before = {
        "name": role.name, "description": role.description,
        "permissions": await _load_role_permissions(session, role.id),
    }
    grant_count = await _count_role_grants(session, role.id)
    role.name, role.description = body.name, body.description
    role.updated_at = now()  # 권한만 바뀌면 roles 행은 그대로라 onupdate가 돌지 않는다
    try:
        # 아래 delete 실행이 autoflush로 이름 변경을 먼저 내보낸다 — 동시 개명 충돌도 여기서 잡는다
        await session.execute(delete(RolePermission).where(RolePermission.role_id == role.id))
        session.add_all(RolePermission(role_id=role.id, permission=key) for key in permissions)
        add_audit_event(session, actor, "role.update", {
            "role_id": role.id,
            "before": before,
            "after": {"name": role.name, "description": role.description, "permissions": permissions},
        })
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail="role name already exists") from exc
    return RoleOut(
        id=role.id, name=role.name, description=role.description,
        permissions=permissions, grant_count=grant_count,
    )


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: int,
    actor: str = Depends(_require_manage),
    session: AsyncSession = Depends(get_session),
) -> None:
    """부여가 남은 역할은 409 — 회수를 먼저 요구해 받은 사람들의 권한이 조용히 사라지지 않게 한다."""
    role = await session.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="role not found")
    if await _count_role_grants(session, role.id):
        raise HTTPException(status_code=409, detail="role is still granted")
    add_audit_event(session, actor, "role.delete", {
        "role_id": role.id, "name": role.name,
        "permissions": await _load_role_permissions(session, role.id),
    })
    await session.delete(role)  # role_permissions는 FK CASCADE로 함께 지워진다
    # 검사 뒤 동시에 들어온 부여는 FK RESTRICT가 막는다
    await _commit_or_conflict(session, 409, "role is still granted")


@router.get("/grants", response_model=list[GrantOut])
async def list_grants(
    session: AsyncSession = Depends(get_session),
) -> list[GrantOut]:
    """대상이 사라진 부여도 지우지 않고 subject_missing=True로 보여 사람이 정리하게 한다."""
    rows = (await session.execute(
        select(AccessGrant, Role.name)
        .outerjoin(Role, Role.id == AccessGrant.role_id)
        .order_by(AccessGrant.id)
    )).all()
    names = await _load_subject_names(session, {(g.subject_type, g.subject_id) for g, _ in rows})
    return [
        GrantOut(
            id=grant.id, subject_type=grant.subject_type, subject_id=grant.subject_id,
            subject_name=names.get((grant.subject_type, grant.subject_id), ""),
            subject_missing=(grant.subject_type, grant.subject_id) not in names,
            role_id=grant.role_id, role_name=role_name, permission=grant.permission,
            created_by=grant.created_by, created_at=_normalize_to_kst(grant.created_at),
        )
        for grant, role_name in rows
    ]


@router.post("/grants", response_model=GrantOut, status_code=status.HTTP_201_CREATED)
async def add_grant(
    body: GrantIn,
    actor: str = Depends(_require_manage),
    session: AsyncSession = Depends(get_session),
) -> GrantOut:
    if (body.role_id is None) == (body.permission is None):
        raise HTTPException(status_code=422, detail="exactly one of role_id or permission is required")
    role_name: str | None = None
    if body.permission is not None and not is_known_permission(body.permission):
        raise HTTPException(status_code=422, detail=f"unknown permission: {body.permission}")
    if body.role_id is not None:
        role = await session.get(Role, body.role_id)
        if role is None:
            raise HTTPException(status_code=422, detail="unknown role")
        role_name = role.name
    names = await _load_subject_names(session, {(body.subject_type, body.subject_id)})
    subject_name = names.get((body.subject_type, body.subject_id))
    if subject_name is None:
        raise HTTPException(status_code=422, detail="unknown subject")
    duplicate = await session.scalar(
        select(AccessGrant.id).where(AccessGrant.build_identity_filter(
            body.subject_type, body.subject_id, body.role_id, body.permission,
        )).limit(1)
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="grant already exists")

    grant = AccessGrant(
        subject_type=body.subject_type, subject_id=body.subject_id,
        role_id=body.role_id, permission=body.permission, created_by=actor,
    )
    session.add(grant)
    try:
        await session.flush()  # 기록에 쓸 id
    except IntegrityError as exc:  # 검사 뒤 역할이 동시에 지워짐(FK)
        await session.rollback()
        raise HTTPException(status_code=422, detail="unknown role") from exc
    add_audit_event(session, actor, "grant.add", _build_grant_detail(grant, role_name))
    await _commit_or_conflict(session, 422, "unknown role")
    return GrantOut(
        id=grant.id, subject_type=grant.subject_type, subject_id=grant.subject_id,
        subject_name=subject_name, subject_missing=False,
        role_id=grant.role_id, role_name=role_name, permission=grant.permission,
        created_by=grant.created_by, created_at=_normalize_to_kst(grant.created_at),
    )


@router.delete("/grants/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_grant(
    grant_id: int,
    actor: str = Depends(_require_manage),
    session: AsyncSession = Depends(get_session),
) -> None:
    grant = await session.get(AccessGrant, grant_id)
    if grant is None:
        raise HTTPException(status_code=404, detail="grant not found")
    role_name = None
    if grant.role_id is not None:
        role_name = await session.scalar(select(Role.name).where(Role.id == grant.role_id))
    add_audit_event(session, actor, "grant.remove", _build_grant_detail(grant, role_name))
    await session.delete(grant)
    await session.commit()


@router.get("/audit", response_model=list[AuditOut])
async def list_audit(
    limit: int = Query(100, ge=1),
    session: AsyncSession = Depends(get_session),
) -> list[AuditOut]:
    events = (await session.scalars(
        select(AccessAuditEvent)
        .order_by(AccessAuditEvent.occurred_at.desc(), AccessAuditEvent.id.desc())
        .limit(min(limit, MAX_AUDIT_LIMIT))
    )).all()
    return [
        AuditOut(
            id=event.id, occurred_at=_normalize_to_kst(event.occurred_at),
            actor=event.actor, action=event.action, detail=event.detail,
        )
        for event in events
    ]


@router.get("/effective/{login_id}", response_model=EffectiveOut)
async def get_effective(
    login_id: str = Path(max_length=100),
    session: AsyncSession = Depends(get_session),
) -> EffectiveOut:
    """사람 하나의 유효 권한과 출처 — require_permission과 같은 판정(get_effective_access)을 그대로 보여 준다."""
    access = await get_effective_access(session, login_id)
    names = await _load_subject_names(
        session, {(s.kind, s.subject_id) for srcs in access.sources.values() for s in srcs},
    )

    def build_source_out(source: AccessSource) -> SourceOut:
        return SourceOut(
            kind=source.kind, subject_id=source.subject_id,
            subject_name=names.get((source.kind, source.subject_id), ""), role=source.role,
        )

    return EffectiveOut(
        login_id=access.login_id, known=access.known, active=access.active, is_sysadmin=access.is_sysadmin,
        permissions=sorted(access.permissions),
        sources={key: [build_source_out(s) for s in srcs] for key, srcs in access.sources.items()},
    )
