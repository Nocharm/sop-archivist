"""GET /api/me — 로그인한 사람의 신원과 유효 권한. 접속 기록(KST 하루 1행)과 실 인증의 단건 HR 동기화를 겸한다."""

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.resolve import get_effective_access
from app.access.sources import SourceOut, build_source_map
from app.auth import get_current_user
from app.clock import now
from app.db import get_session
from app.hr.service import sync_one
from app.models import Employee, LoginRecord
from app.orgchart import load_dept_index, resolve_org_path
from app.settings import settings

router = APIRouter(tags=["me"])


class MeOut(BaseModel):
    login_id: str
    # employees 행이 없으면(HR 동기화 전 첫 로그인) 신원 칸은 빈 문자열이다
    name: str
    korean_name: str
    department: str
    dept_path: str
    is_sysadmin: bool
    permissions: list[str]
    # 권한 키 → 출처(/api/access/effective와 같은 모양) — 홈이 "어디서 받은 권한인지"를 보여 준다. sysadmin·dev 전권은 {}
    sources: dict[str, list[SourceOut]]
    auth_mode: Literal["keycloak", "dev"]
    ai_enabled: bool


@router.get("/api/me", response_model=MeOut)
async def get_me(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MeOut:
    # 실 인증 + HR 설정 시 로그인 시점 1인 동기화 — 하루 1회 스로틀은 sync_one이 맡는다. dev는 시드 디렉터리를 쓴다.
    if settings.resolved_auth_mode() != "dev" and settings.hr_enabled:
        await sync_one(session, login_id)
    emp = await session.get(Employee, login_id)
    # /api/me는 앱 로드(새 탭·새로고침·토큰 갱신)마다 불리므로 KST 자정 이후 기록이 없을 때만 남긴다 = "그날 접속" 단위
    day_start = now().replace(hour=0, minute=0, second=0, microsecond=0)
    already = await session.scalar(
        select(LoginRecord.id)
        .where(LoginRecord.login_id == login_id, LoginRecord.occurred_at >= day_start)
        .limit(1)
    )
    if already is None:
        session.add(LoginRecord(login_id=login_id, name=emp.name if emp else None))
        await session.commit()

    access = await get_effective_access(session, login_id)
    dept_path = resolve_org_path(emp, await load_dept_index(session)) if emp else ""
    return MeOut(
        login_id=login_id,
        name=emp.name if emp else "",
        korean_name=emp.korean_name if emp else "",
        department=emp.department if emp else "",
        dept_path=dept_path,
        is_sysadmin=access.is_sysadmin,
        permissions=sorted(access.permissions),
        sources=await build_source_map(session, access),
        auth_mode=settings.resolved_auth_mode(),
        ai_enabled=settings.ai_enabled,
    )
