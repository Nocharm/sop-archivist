"""Request user authentication — dev trusts X-Dev-User, keycloak verifies a realm RS256 token issued to this app."""

import logging
from functools import lru_cache

import jwt
from fastapi import Header, HTTPException

from app.settings import settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _jwk_client() -> jwt.PyJWKClient:
    # realm 공개키 — Keycloak certs 엔드포인트. lru_cache로 키 세트를 재사용한다.
    return jwt.PyJWKClient(f"{settings.keycloak_issuer}/protocol/openid-connect/certs")


def get_current_user(
    authorization: str | None = Header(None),
    x_dev_user: str | None = Header(None),
) -> str:
    """요청 사용자 loginId — 모든 보호 라우트의 의존성. 모드별로 검증기만 다르고 반환 계약은 같다."""
    if settings.resolved_auth_mode() == "dev":
        return x_dev_user or settings.dev_user  # 헤더는 dev 모드에서만 신뢰

    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    return _decode_keycloak_token(authorization.removeprefix("Bearer "))


def _decode_keycloak_token(token: str) -> str:
    """realm JWKS로 RS256 서명·issuer(·aud)를 검증하고, 이 앱 클라이언트에 발급된 토큰만 받는다."""
    try:
        signing_key = _jwk_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.keycloak_issuer,
            # 빈 문자열(미설정·compose 기본 ${VAR:-})도 None과 동일하게 aud 검증 생략 — 아니면 토큰이 항상 깨짐
            audience=settings.keycloak_audience or None,
            options={"verify_aud": bool(settings.keycloak_audience)},
        )
    except jwt.PyJWTError as exc:
        # 실패 사유는 서버 로그에만 — 응답에 검증 내부를 싣지 않는다. 토큰 원문은 로그에도 남기지 않는다.
        logger.warning("keycloak token rejected", extra={"error": type(exc).__name__, "reason": str(exc)})
        raise HTTPException(status_code=401, detail="invalid token") from exc

    # realm ai-portal은 다른 사내 앱과 공유된다 — 서명·issuer가 맞아도 다른 앱 클라이언트(예: bpm)에
    # 발급된 토큰은 거부한다. 빈 azp·미설정 client id는 어느 쪽이든 불일치로 처리해 fail closed.
    azp = claims.get("azp")
    if not azp or azp != settings.keycloak_client_id:
        logger.warning("keycloak token rejected", extra={"reason": "issued to another client", "azp": azp})
        raise HTTPException(status_code=401, detail="token was issued to another client")

    username = claims.get("preferred_username") or claims.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="token has no subject")
    return username
