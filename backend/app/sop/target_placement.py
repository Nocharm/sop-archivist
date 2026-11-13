"""새 문장을 문서 안 순서에 끼워 넣는 자리 계산 — 순서를 사람이 정한(manual_order) 문서에서 번역을 출처 바로 뒤에 둔다."""

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import TargetSentence


async def insert_after(session: AsyncSession, source: TargetSentence) -> int:
    """출처 뒤 새 문장을 한 칸씩 밀고 출처 바로 뒤 order_index를 돌려준다 — 칸 새 문장은 순서에 들지 않아 건드리지 않는다.

    문서가 manual_order일 때만 부른다(아니면 순서는 결과물이 정한다). 묶음 잠금 안에서 부르므로 한 번의 UPDATE로 충분하다.
    """
    await session.execute(
        update(TargetSentence)
        .where(
            TargetSentence.target_doc_id == source.target_doc_id,
            TargetSentence.parent_target_id.is_(None),
            TargetSentence.order_index > source.order_index,
        )
        .values(order_index=TargetSentence.order_index + 1)
    )
    return source.order_index + 1
