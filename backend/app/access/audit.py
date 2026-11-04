"""권한 표 변경 기록 — 역할·부여 변경 API가 변경과 같은 트랜잭션에 남긴다."""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AccessAuditEvent

ACTIONS = ("role.create", "role.update", "role.delete", "grant.add", "grant.remove")


def add_audit_event(session: AsyncSession, actor: str, action: str, detail: dict[str, Any]) -> None:
    """세션에 기록 행을 더하기만 한다 — 커밋은 호출부가 변경과 함께 해야 변경만 남고 기록이 빠지는 일이 없다."""
    if action not in ACTIONS:
        raise ValueError(f"unknown audit action: {action}")
    session.add(AccessAuditEvent(actor=actor, action=action, detail=detail))
