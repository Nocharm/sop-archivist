"""Public auth-mode endpoint the frontend boots from — no auth, no secrets."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings

ISS = "http://keycloak.test:8080/realms/ai-portal"
CID = "sop-archivist"


def test_mode_dev_by_default(client: TestClient) -> None:
    assert client.get("/api/auth/mode").json()["mode"] == "dev"


def test_mode_keycloak_exposes_issuer(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "auth_mode", "keycloak")
    monkeypatch.setattr(settings, "keycloak_issuer", ISS)
    monkeypatch.setattr(settings, "keycloak_client_id", CID)

    response = client.get("/api/auth/mode")

    assert response.status_code == 200
    assert response.json() == {"mode": "keycloak", "keycloakIssuer": ISS, "keycloakClientId": CID}
