"""Health endpoint — also proves the lifespan (migrations) boots the app."""

from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}
