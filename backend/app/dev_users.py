"""dev 모드 디렉터리·데모 권한 시드 — 부서가 다른 가짜 사용자·부서 트리. frontend lib/dev-auth.ts LOCAL_USERS와 같은 값을 쓴다."""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AccessGrant, Department, Employee, Role, RolePermission


@dataclass(frozen=True)
class DevDepartment:
    dept_code: str
    parent_dept_code: str | None
    name: str
    name_ko: str
    level: int


@dataclass(frozen=True)
class DevUser:
    login_id: str
    name: str
    korean_name: str
    dept_code: str


DEV_DEPARTMENTS: tuple[DevDepartment, ...] = (
    DevDepartment("CORP", None, "Example Pharma", "예시제약", 1),
    DevDepartment("DIV-QA", "CORP", "Quality Division", "품질본부", 2),
    DevDepartment("TEAM-QA1", "DIV-QA", "QA Team 1", "품질보증1팀", 3),
    DevDepartment("DIV-PROD", "CORP", "Production Division", "생산본부", 2),
    DevDepartment("TEAM-PROD1", "DIV-PROD", "Production Team 1", "생산1팀", 3),
    DevDepartment("DIV-IT", "CORP", "IT Division", "IT본부", 2),
    DevDepartment("TEAM-IT1", "DIV-IT", "IT Ops Team", "IT운영팀", 3),
)

DEV_USERS: tuple[DevUser, ...] = (
    DevUser("dev.admin", "Dev Admin", "개발관리자", "TEAM-IT1"),
    DevUser("qa.lead", "QA Lead", "품질리드", "DIV-QA"),
    DevUser("qa.member", "QA Member", "품질담당", "TEAM-QA1"),
    DevUser("prod.member", "Production Member", "생산담당", "TEAM-PROD1"),
    DevUser("ops.member", "Ops Member", "운영담당", "TEAM-IT1"),
)


@dataclass(frozen=True)
class DemoRole:
    name: str
    description: str
    permissions: tuple[str, ...]


@dataclass(frozen=True)
class DemoGrant:
    subject_type: str
    subject_id: str
    # 역할 이름 또는 권한 키 중 하나만
    role: str | None
    permission: str | None


# 공용 데이터(plan global.md) — DEV_ENFORCE_PERMISSIONS=true로 띄우면 사용자별 차등이 바로 보인다
DEMO_ROLES: tuple[DemoRole, ...] = (
    DemoRole("Permission Admin", "Edits roles and grants", ("permission.manage",)),
    DemoRole("Operations", "Runs directory sync, checks AI and system status",
             ("directory.sync", "system.view", "ai.admin")),
)

DEMO_GRANTS: tuple[DemoGrant, ...] = (
    DemoGrant("dept", "DIV-QA", "Permission Admin", None),  # 하위 TEAM-QA1의 qa.member까지 내려간다
    DemoGrant("user", "ops.member", "Operations", None),
    DemoGrant("user", "prod.member", None, "system.view"),  # 역할 없이 권한 직접 부여
)


async def seed_dev_directory(session: AsyncSession) -> None:
    """dev 부서·사용자를 없을 때만 넣는다(멱등). 이미 있는 행은 고치지 않고 commit까지 한다.

    사용자는 source="dev"라 HR 동기화가 삭제·비활성·덮어쓰기를 하지 않는다.
    """
    departments_by_code = {d.dept_code: d for d in DEV_DEPARTMENTS}
    for dept in DEV_DEPARTMENTS:
        if await session.get(Department, dept.dept_code) is None:
            session.add(Department(
                dept_code=dept.dept_code, parent_dept_code=dept.parent_dept_code,
                name=dept.name, name_ko=dept.name_ko, level=dept.level,
            ))
    for user in DEV_USERS:
        if await session.get(Employee, user.login_id) is None:
            dept = departments_by_code[user.dept_code]
            session.add(Employee(
                login_id=user.login_id, name=user.name, korean_name=user.korean_name,
                source="dev", active=True, dept_code=user.dept_code,
                department=dept.name, korean_dept=dept.name_ko,
            ))
    await session.commit()


async def seed_demo_access(session: AsyncSession) -> None:
    """데모 역할 2개·부여 3건을 없을 때만 넣고 commit한다(멱등). 테스트 픽스처와 scripts.reset_db가 공유한다.

    lifespan은 부르지 않는다 — 기본 dev 모드는 전원 전권이라 표가 필요 없고, 운영 DB에 데모 권한이 섞이면 안 된다.
    이미 있는 같은 이름의 역할은 권한을 고치지 않는다. 관리자 행위가 아니라 변경 기록도 남기지 않는다.
    """
    role_ids: dict[str, int] = {}
    for demo_role in DEMO_ROLES:
        role_id = await session.scalar(select(Role.id).where(Role.name == demo_role.name))
        if role_id is None:
            role = Role(name=demo_role.name, description=demo_role.description)
            session.add(role)
            await session.flush()  # 권한 행에 쓸 id
            session.add_all(RolePermission(role_id=role.id, permission=key) for key in demo_role.permissions)
            role_id = role.id
        role_ids[demo_role.name] = role_id
    for demo_grant in DEMO_GRANTS:
        role_id = role_ids[demo_grant.role] if demo_grant.role is not None else None
        existing = await session.scalar(select(AccessGrant.id).where(AccessGrant.build_identity_filter(
            demo_grant.subject_type, demo_grant.subject_id, role_id, demo_grant.permission,
        )).limit(1))
        if existing is None:
            session.add(AccessGrant(
                subject_type=demo_grant.subject_type, subject_id=demo_grant.subject_id,
                role_id=role_id, permission=demo_grant.permission, created_by="seed",
            ))
    await session.commit()
