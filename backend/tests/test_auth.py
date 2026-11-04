"""Request authentication — dev header trust and Keycloak RS256 + issuing-client (azp) checks."""

import logging
from datetime import timedelta
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from app import auth
from app.auth import get_current_user
from app.clock import now
from app.settings import settings

ISS = "http://keycloak.test:8080/realms/ai-portal"
CID = "sop-archivist"

# 서명키 생성은 느리므로 모듈당 한 번. 다른 키는 "같은 realm이 아닌 서명" 위조 재현용.
_REALM_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_FOREIGN_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _StubSigningKey:
    def __init__(self, key: rsa.RSAPublicKey) -> None:
        self.key = key


class _StubJwkClient:
    """realm JWKS 대역 — 네트워크 없이 realm 공개키를 돌려준다."""

    def get_signing_key_from_jwt(self, _token: str) -> _StubSigningKey:
        return _StubSigningKey(_REALM_KEY.public_key())


def _make_token(
    *,
    key: rsa.RSAPrivateKey = _REALM_KEY,
    expires_in: timedelta = timedelta(minutes=5),
    **overrides: Any,
) -> str:
    claims: dict[str, Any] = {
        "iss": ISS,
        "azp": CID,
        "sub": "f3b0c6a2-sub",
        "preferred_username": "qa.lead",
        "exp": now() + expires_in,
    }
    claims.update(overrides)
    # None을 넘기면 그 클레임 자체를 뺀다 — "클레임 없음" 케이스 재현용.
    claims = {name: value for name, value in claims.items() if value is not None}
    return jwt.encode(claims, key, algorithm="RS256")


def _bearer(token: str) -> str:
    return f"Bearer {token}"


@pytest.fixture
def keycloak(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "auth_mode", "keycloak")
    monkeypatch.setattr(settings, "keycloak_issuer", ISS)
    monkeypatch.setattr(settings, "keycloak_client_id", CID)
    monkeypatch.setattr(settings, "keycloak_audience", "")
    # lru_cache로 감싼 실제 팩토리 대신 이름을 교체 — 캐시를 오염시키지 않고 테스트 끝에 자동 원복.
    monkeypatch.setattr(auth, "_jwk_client", lambda: _StubJwkClient())


def _reject(authorization: str | None, x_dev_user: str | None = None) -> HTTPException:
    with pytest.raises(HTTPException) as exc_info:
        get_current_user(authorization, x_dev_user)
    assert exc_info.value.status_code == 401
    return exc_info.value


def test_dev_uses_header() -> None:
    assert get_current_user(None, "qa.lead") == "qa.lead"


def test_dev_falls_back_to_dev_user() -> None:
    assert get_current_user(None, None) == "dev.admin"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_requires_bearer() -> None:
    assert _reject(None).detail == "missing bearer token"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_rejects_non_bearer_scheme() -> None:
    assert _reject(f"Basic {_make_token()}").detail == "missing bearer token"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_ignores_dev_header() -> None:
    assert _reject(None, "qa.lead").detail == "missing bearer token"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_valid_token() -> None:
    assert get_current_user(_bearer(_make_token()), None) == "qa.lead"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_valid_token_ignores_dev_header() -> None:
    assert get_current_user(_bearer(_make_token()), "dev.admin") == "qa.lead"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_falls_back_to_sub() -> None:
    token = _make_token(preferred_username=None)
    assert get_current_user(_bearer(token), None) == "f3b0c6a2-sub"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_rejects_token_without_subject() -> None:
    token = _make_token(preferred_username=None, sub=None)
    assert _reject(_bearer(token)).detail == "token has no subject"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_rejects_other_client() -> None:
    # 같은 realm이 정상 서명한 다른 앱(bpm) 토큰 — 서명·issuer는 통과하므로 azp만이 방어선이다.
    token = _make_token(azp="bpm-frontend")
    assert _reject(_bearer(token)).detail == "token was issued to another client"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_rejects_missing_azp() -> None:
    token = _make_token(azp=None)
    assert _reject(_bearer(token)).detail == "token was issued to another client"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_fails_closed_when_client_id_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "keycloak_client_id", "")
    # 빈 azp가 빈 client id와 "일치"해 통과하는 길도 막혀야 한다.
    for token in (_make_token(), _make_token(azp=""), _make_token(azp=None)):
        assert _reject(_bearer(token)).detail == "token was issued to another client"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_rejects_wrong_issuer() -> None:
    token = _make_token(iss="http://keycloak.test:8080/realms/other")
    assert _reject(_bearer(token)).detail == "invalid token"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_rejects_expired() -> None:
    token = _make_token(expires_in=timedelta(minutes=-5))
    assert _reject(_bearer(token)).detail == "invalid token"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_rejects_foreign_signature() -> None:
    token = _make_token(key=_FOREIGN_KEY)
    assert _reject(_bearer(token)).detail == "invalid token"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_rejects_malformed_token() -> None:
    assert _reject(_bearer("not-a-jwt")).detail == "invalid token"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_audience_checked_only_when_set(monkeypatch: pytest.MonkeyPatch) -> None:
    token = _make_token(aud="x")
    assert get_current_user(_bearer(token), None) == "qa.lead"

    monkeypatch.setattr(settings, "keycloak_audience", "api")
    assert _reject(_bearer(token)).detail == "invalid token"


@pytest.mark.usefixtures("keycloak")
def test_keycloak_rejection_logs_reason_without_token(caplog: pytest.LogCaptureFixture) -> None:
    token = _make_token(expires_in=timedelta(minutes=-5))

    with caplog.at_level(logging.WARNING, logger="app.auth"):
        _reject(_bearer(token))

    (record,) = [r for r in caplog.records if r.name == "app.auth"]
    # 앱은 로깅 설정이 없어 lastResort가 %(message)s만 찍는다 — 사유는 렌더된 메시지에 있어야 보인다.
    message = record.getMessage()
    assert "ExpiredSignatureError" in message
    assert "Signature has expired" in message
    assert token not in message
    assert record.error == "ExpiredSignatureError"
    assert token not in str(record.__dict__)


@pytest.mark.usefixtures("keycloak")
def test_keycloak_other_client_logs_azp(caplog: pytest.LogCaptureFixture) -> None:
    token = _make_token(azp="bpm-frontend")

    with caplog.at_level(logging.WARNING, logger="app.auth"):
        _reject(_bearer(token))

    (record,) = [r for r in caplog.records if r.name == "app.auth"]
    message = record.getMessage()
    assert "bpm-frontend" in message
    assert token not in message
    assert record.azp == "bpm-frontend"
