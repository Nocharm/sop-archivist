"""권한 출처의 응답 모양 — /api/access/effective와 /api/me가 같은 SourceOut·이름 조회를 쓴다."""

from typing import Literal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.resolve import AccessSource, EffectiveAccess
from app.models import Department, Employee


class SourceOut(BaseModel):
    kind: Literal["user", "dept"]
    subject_id: str
    # 개인은 Employee.name, 부서는 Department.name — 대상 행이 없으면 ""
    subject_name: str
    role: str | None


async def load_subject_names(
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


async def build_source_map(
    session: AsyncSession, access: EffectiveAccess
) -> dict[str, list[SourceOut]]:
    """권한 키 → 출처 목록(표시 이름 포함). sysadmin·dev 전권은 출처가 비어 있다."""
    names = await load_subject_names(
        session, {(s.kind, s.subject_id) for srcs in access.sources.values() for s in srcs},
    )

    def build_source_out(source: AccessSource) -> SourceOut:
        return SourceOut(
            kind=source.kind, subject_id=source.subject_id,
            subject_name=names.get((source.kind, source.subject_id), ""), role=source.role,
        )

    return {key: [build_source_out(s) for s in srcs] for key, srcs in access.sources.items()}
