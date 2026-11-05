"""SOP 업무 규칙 거절 — detail={"code", ...문맥} 모양과 revision 충돌(409)을 한 곳에서 낸다."""

from typing import NoReturn

from fastapi import HTTPException


def raise_rule(status_code: int, code: str, **context: object) -> NoReturn:
    """업무 규칙 거절 — detail={"code": code, **context}. 입력 형식 오류는 FastAPI 기본 422를 그대로 쓴다."""
    raise HTTPException(status_code=status_code, detail={"code": code, **context})


def check_revision(entity: str, entity_id: int, expected: int, actual: int) -> None:
    """요청이 든 revision이 현재와 다르면 409. 화면은 current_revision을 보고 그 대상을 다시 읽는다."""
    if expected != actual:
        raise_rule(
            409,
            "revision_conflict",
            conflicts=[{"entity": entity, "id": entity_id, "current_revision": actual}],
        )
