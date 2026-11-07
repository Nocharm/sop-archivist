"""AI 호출 계량 — call_ai를 감싸 호출 1건당 AiUsageEvent 1행(질문·답변 원문 없이)을 남긴다."""

import logging

from app.ai_client import AiReasoning, AiReply, call_ai
from app.db import SessionLocal
from app.models import AiUsageEvent

logger = logging.getLogger(__name__)


async def record_ai_usage(
    *,
    login_id: str,
    feature: str,
    model: str,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    ok: bool,
) -> None:
    """사용량 한 행을 자기 짧은 세션으로 남기고 커밋한다.

    호출자의 세션과 따로 열고 닫는다 — 느린 AI 호출 동안 요청 세션(DB 연결)을 붙들지 않게 하려는 분리이고,
    호출자의 미커밋 변경은 이 커밋에 딸려 가지 않는다. 행에는 누가·무슨 기능·요청 모델 선택자·토큰만 담는다.
    """
    async with SessionLocal() as session:
        session.add(
            AiUsageEvent(
                login_id=login_id,
                feature=feature,
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                ok=ok,
            )
        )
        await session.commit()


async def call_ai_recorded(
    *,
    login_id: str,
    feature: str,
    messages: list[dict],
    model: str | None = None,
    reasoning: AiReasoning | None = None,
    max_tokens: int | None = None,
) -> AiReply:
    """call_ai 호출 결과를 사용량 행으로 남긴다. AI 호출이 실패하면 ok=False 행을 남긴 뒤 예외를 다시 던진다.

    DB 세션을 받지 않는다 — 호출 동안 연결을 잡지 않고, 기록은 `record_ai_usage`가 호출 뒤에 따로 연다.
    프롬프트와 답변은 저장하지 않는다.
    """
    try:
        reply = await call_ai(messages, model, reasoning=reasoning, max_tokens=max_tokens)
    except Exception:
        await _record_failure(login_id=login_id, feature=feature, model=model)
        raise
    # 성공 쪽 기록 실패는 삼키지 않는다 — DB가 죽었는데 계량이 조용히 빠지면 안 된다
    await record_ai_usage(
        login_id=login_id,
        feature=feature,
        model=model or "",
        prompt_tokens=reply.prompt_tokens,
        completion_tokens=reply.completion_tokens,
        ok=True,
    )
    return reply


async def _record_failure(*, login_id: str, feature: str, model: str | None) -> None:
    """실패 행을 남긴다. 기록이 실패해도 원래 AI 오류를 가리지 않도록 로그만 남긴다.

    로그에는 예외 클래스 이름만 쓴다 — 메시지·트레이스백에는 값이 실릴 수 있다.
    """
    try:
        await record_ai_usage(
            login_id=login_id,
            feature=feature,
            model=model or "",
            prompt_tokens=None,
            completion_tokens=None,
            ok=False,
        )
    except Exception as exc:  # noqa: BLE001 -- 계량 실패가 원래 오류(502 등)를 바꾸지 않는다
        logger.warning("AI usage event insert failed (failure path): %s", type(exc).__name__)
