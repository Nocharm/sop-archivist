"""묶음 작업 기록 — 사람이 남긴 결정을 ID로 가리키는 추가 전용 사건 한 줄 (원문 글자는 담지 않는다)."""

from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import BundleEvent


def record_event(
    session: AsyncSession,
    *,
    bundle_id: int,
    actor: str,
    action: str,
    target_type: str = "",
    target_ids: Sequence[int | str] = (),
    reason: str = "",
) -> None:
    """행만 추가한다 — 커밋은 호출부가 해서 변경과 기록이 한 트랜잭션으로 묶이게 한다."""
    session.add(
        BundleEvent(
            bundle_id=bundle_id,
            actor=actor,
            action=action,
            target_type=target_type,
            target_ids=list(target_ids),
            reason=reason,
        )
    )
