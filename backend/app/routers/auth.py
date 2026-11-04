"""Public auth-mode endpoint — the frontend reads it at boot to pick its login flow."""

from fastapi import APIRouter

from app.settings import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/mode")
async def get_auth_mode() -> dict[str, str]:
    """프런트 부팅용 — 인증 불필요. 시크릿은 절대 넣지 않는다.

    issuer/client_id는 비밀이 아니다(브라우저가 리다이렉트 URL로 이미 노출한다).
    """
    return {
        "mode": settings.resolved_auth_mode(),
        "keycloakIssuer": settings.keycloak_issuer,
        "keycloakClientId": settings.keycloak_client_id,
    }
