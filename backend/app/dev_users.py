"""dev 모드 디렉터리 시드 — 부서가 다른 가짜 사용자·부서 트리. frontend lib/dev-auth.ts LOCAL_USERS와 같은 값을 쓴다."""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Department, Employee


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
