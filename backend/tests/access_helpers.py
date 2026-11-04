"""권한 테스트 공유 헬퍼 — 판정 호출·부여 추가·디렉터리 행 수정 (test_access_resolve/api·test_me 공용)."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.resolve import EffectiveAccess, get_effective_access
from app.db import SessionLocal
from app.models import AccessGrant, Base, Role, RolePermission

T = TypeVar("T")


def run_in_session(work: Callable[[AsyncSession], Awaitable[T]]) -> T:
    async def _go() -> T:
        async with SessionLocal() as session:
            return await work(session)

    return asyncio.run(_go())


def resolve(login_id: str) -> EffectiveAccess:
    return run_in_session(lambda session: get_effective_access(session, login_id))


def get_role_id(name: str) -> int:
    async def _find(session: AsyncSession) -> int:
        role_id = await session.scalar(select(Role.id).where(Role.name == name))
        assert role_id is not None, f"role {name!r} is not seeded"
        return role_id

    return run_in_session(_find)


def add_grant(subject_type: str, subject_id: str, *, role: str | None = None, permission: str | None = None) -> None:
    role_id = get_role_id(role) if role is not None else None

    async def _add(session: AsyncSession) -> None:
        session.add(AccessGrant(
            subject_type=subject_type, subject_id=subject_id, role_id=role_id,
            permission=permission, created_by="test",
        ))
        await session.commit()

    run_in_session(_add)


def add_role_permission(role: str, permission: str) -> None:
    """카탈로그 검사를 거치지 않고 역할에 권한 키를 직접 넣는다 — 카탈로그에서 빠진 옛 키 재현용."""
    role_id = get_role_id(role)

    async def _add(session: AsyncSession) -> None:
        session.add(RolePermission(role_id=role_id, permission=permission))
        await session.commit()

    run_in_session(_add)


def update_row(model: type[Base], key: str, **columns: Any) -> None:
    async def _update(session: AsyncSession) -> None:
        row = await session.get(model, key)
        assert row is not None, f"{model.__name__} {key!r} is missing"
        for name, value in columns.items():
            setattr(row, name, value)
        await session.commit()

    run_in_session(_update)


def delete_row(model: type[Base], key: str) -> None:
    async def _delete(session: AsyncSession) -> None:
        row = await session.get(model, key)
        assert row is not None, f"{model.__name__} {key!r} is missing"
        await session.delete(row)
        await session.commit()

    run_in_session(_delete)
