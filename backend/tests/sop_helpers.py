"""SOP 테스트 공유 헬퍼 — 사용자 헤더와 묶음 만들기·읽기·멤버 바꾸기·To-Be 목록 쓰기 (태스크마다 이어서 더한다)."""

from collections.abc import Iterable

import httpx2
from fastapi.testclient import TestClient

AUTHOR = {"X-Dev-User": "qa.member"}
REVIEWER = {"X-Dev-User": "qa.lead"}
OUTSIDER = {"X-Dev-User": "prod.member"}
ADMIN = {"X-Dev-User": "dev.admin"}


def create_bundle(
    client: TestClient, *, title: str = "Bundle", headers: dict[str, str] = AUTHOR, is_synthetic: bool = False
) -> dict:
    response = client.post("/api/bundles", json={"title": title, "is_synthetic": is_synthetic}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def get_bundle(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def set_members(
    client: TestClient, bundle_id: int, members: list[tuple[str, str]], headers: dict[str, str] = AUTHOR
) -> httpx2.Response:
    """현재 revision을 읽어 멤버를 통째로 바꾼다 — 거절 응답도 그대로 돌려줘 테스트가 코드를 단언한다."""
    revision = get_bundle(client, bundle_id, headers)["revision"]
    body = {"revision": revision, "members": [{"login_id": login_id, "role": role} for login_id, role in members]}
    return client.put(f"/api/bundles/{bundle_id}/members", json=body, headers=headers)


def put_tobe(
    client: TestClient,
    bundle_id: int,
    docs: list[dict],
    *,
    na_slots: Iterable[dict] = (),
    wi_steps: Iterable[dict] = (),
    headers: dict[str, str] = AUTHOR,
) -> httpx2.Response:
    """현재 revision을 읽어 To-Be 목록을 통째로 바꾼다 — 거절 응답도 그대로 돌려줘 테스트가 코드를 단언한다."""
    revision = get_bundle(client, bundle_id, headers)["revision"]
    body = {"revision": revision, "docs": docs, "na_slots": list(na_slots), "wi_steps": list(wi_steps)}
    return client.put(f"/api/bundles/{bundle_id}/tobe", json=body, headers=headers)
