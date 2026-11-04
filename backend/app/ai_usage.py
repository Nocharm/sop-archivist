"""AI 호출 계량 — call_ai를 감싸 호출 1건당 AiUsageEvent 1행(질문·답변 원문 없이)을 남긴다."""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_client import AiReasoning, AiReply, call_ai
from app.models import AiUsageEvent

logger = logging.getLogger(__name__)


async def call_ai_recorded(
    session: AsyncSession,
    *,
    login_id: str,
    feature: str,
    messages: list[dict],
    model: str | None = None,
    reasoning: AiReasoning | None = None,
    max_tokens: int | None = None,
) -> AiReply:
    """call_ai 호출 결과를 사용량 행으로 남기고 커밋한다. AI 호출이 실패하면 ok=False 행을 남긴 뒤 예외를 다시 던진다.

    행에는 누가(login_id)·무슨 기능(feature)·요청 모델 선택자·토큰만 담는다 — 프롬프트와 답변은 저장하지 않는다.
    커밋은 이 세션 전체를 확정하므로, 호출자의 미커밋 변경도 함께 커밋된다.
    """
    try:
        reply = await call_ai(messages, model, reasoning=reasoning, max_tokens=max_tokens)
    except Exception:
        await _record_failure(session, login_id=login_id, feature=feature, model=model)
        raise
    # 성공 쪽 기록 실패는 삼키지 않는다 — DB가 죽었는데 계량이 조용히 빠지면 안 된다
    session.add(
        AiUsageEvent(
            login_id=login_id,
            feature=feature,
            model=model or "",
            prompt_tokens=reply.prompt_tokens,
            completion_tokens=reply.completion_tokens,
            ok=True,
        )
    )
    await session.commit()
    return reply


async def _record_failure(session: AsyncSession, *, login_id: str, feature: str, model: str | None) -> None:
    """실패 행을 남긴다. 기록이 실패해도 원래 AI 오류를 가리지 않도록 롤백하고 로그만 남긴다(호출자의 미커밋 변경도 롤백된다)."""
    try:
        session.add(AiUsageEvent(login_id=login_id, feature=feature, model=model or "", ok=False))
        await session.commit()
    except Exception:  # noqa: BLE001 -- 계량 실패가 원래 오류(502 등)를 바꾸지 않는다
        await session.rollback()
        logger.warning("AI usage event insert failed (failure path)", exc_info=True)
