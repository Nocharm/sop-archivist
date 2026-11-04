"""디렉터리 읽기 전용 API — 권한 부여 화면의 개인·부서 선택용. 인증된 모든 사용자에게 열려 있다."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Department, Employee
from app.orgchart import load_dept_index, resolve_org_path

router = APIRouter(tags=["directory"])

# 한 번에 돌려주는 최대 인원 — 큰 limit은 거부하지 않고 이 값으로 자른다
MAX_DIRECTORY_LIMIT = 50
# 검색어 상한 — 가장 긴 검색 대상 컬럼(이름·부서 200자)보다 긴 부분 문자열은 어차피 일치할 수 없다
MAX_QUERY_LENGTH = 200


class DirectoryUserOut(BaseModel):
    login_id: str
    name: str
    korean_name: str
    department: str
    dept_code: str | None
    dept_path: str


class DepartmentOut(BaseModel):
    dept_code: str
    parent_dept_code: str | None
    name: str
    name_ko: str
    level: int


@router.get("/api/directory", response_model=list[DirectoryUserOut])
async def search_directory(
    q: str = Query("", max_length=MAX_QUERY_LENGTH),
    limit: int = Query(20, ge=1),
    _: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[DirectoryUserOut]:
    """재직자 검색 — q는 login_id·name·korean_name·department 대소문자 무시 부분 일치(비우면 전체)."""
    stmt = select(Employee).where(Employee.active.is_(True))
    needle = q.strip()
    if needle:
        # autoescape: q의 % _ 를 패턴이 아닌 글자로 취급한다
        stmt = stmt.where(or_(*(
            column.icontains(needle, autoescape=True)
            for column in (Employee.login_id, Employee.name, Employee.korean_name, Employee.department)
        )))
    rows = (await session.scalars(
        stmt.order_by(Employee.login_id).limit(min(limit, MAX_DIRECTORY_LIMIT))
    )).all()

    dept_index = await load_dept_index(session)
    return [
        DirectoryUserOut(
            login_id=emp.login_id,
            name=emp.name,
            korean_name=emp.korean_name,
            department=emp.department,
            dept_code=emp.dept_code,
            dept_path=resolve_org_path(emp, dept_index),
        )
        for emp in rows
    ]


@router.get("/api/departments", response_model=list[DepartmentOut])
async def list_departments(
    _: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[Department]:
    """HR 조직도 미러 전체 — 부서 부여 대상 선택과 트리 표시용."""
    return list((await session.scalars(
        select(Department).order_by(Department.level, Department.dept_code)
    )).all())
