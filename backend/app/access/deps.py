"""권한 라우터 의존성 — `Depends(require_permission("<key>"))`로 보호한다. 판정은 resolve 한 곳."""

from collections.abc import Awaitable, Callable

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.catalog import is_known_permission
from app.access.resolve import get_effective_access
from app.auth import get_current_user
from app.db import get_session


def require_permission(permission: str) -> Callable[..., Awaitable[str]]:
    """permission이 있으면 요청 사용자 login_id를, 없으면 403을 내는 의존성을 만든다.

    모르는 키는 만드는 시점(import)에 ValueError — 오타가 "sysadmin까지 전원 403"으로 조용히 숨지 않게 한다.
    세션은 엔드포인트와 같은 요청 세션(FastAPI 의존성 캐시)이라 판정과 변경이 한 트랜잭션에서 일어난다.
    """
    if not is_known_permission(permission):
        raise ValueError(f"unknown permission: {permission}")

    async def check_permission(
        login_id: str = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
    ) -> str:
        access = await get_effective_access(session, login_id)
        if permission not in access.permissions:
            raise HTTPException(status_code=403, detail=f"missing permission: {permission}")
        return login_id

    return check_permission
