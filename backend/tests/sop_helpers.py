"""SOP 테스트 공유 헬퍼 — 사용자 헤더와 묶음 만들기·읽기·멤버 바꾸기·To-Be 목록 쓰기·문서 올리기·원문 대조 데이터 읽기·관계 묶음 저장 (태스크마다 이어서 더한다)."""

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


def upload(
    client: TestClient,
    bundle_id: int,
    data: bytes,
    file_name: str,
    *,
    side: str = "old",
    doc_type: str | None = None,
    parent_code: str | None = None,
    headers: dict[str, str] = AUTHOR,
) -> httpx2.Response:
    """문서 파일 하나를 올린다 — 거절 응답도 그대로 돌려줘 테스트가 코드를 단언한다. None인 칸은 폼에 싣지 않는다."""
    form = {"side": side}
    if doc_type is not None:
        form["doc_type"] = doc_type
    if parent_code is not None:
        form["parent_code"] = parent_code
    return client.post(
        f"/api/bundles/{bundle_id}/documents", files={"file": (file_name, data)}, data=form, headers=headers
    )


def get_view(client: TestClient, bundle_id: int, doc_id: int, headers: dict[str, str] = AUTHOR) -> dict:
    """문서의 원문 대조 데이터(블록·활성 단위·짝)."""
    response = client.get(f"/api/bundles/{bundle_id}/documents/{doc_id}/view", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def find_unit(view: dict, text: str, occurrence: int = 1) -> dict:
    """글자가 정확히 text인 활성 단위 중 occurrence번째(1부터) — 같은 문장이 여러 곳에 있으면 순서로 고른다."""
    matches = [unit for unit in view["units"] if unit["text"] == text]
    assert len(matches) >= occurrence, f"unit #{occurrence} with the given text not found ({len(matches)} match)"
    return matches[occurrence - 1]


def save_group(
    client: TestClient, bundle_id: int, body: dict, headers: dict[str, str] = AUTHOR
) -> httpx2.Response:
    """관계 묶음 하나(또는 여럿)를 저장한다 — 거절 응답도 그대로 돌려줘 테스트가 코드를 단언한다."""
    return client.post(f"/api/bundles/{bundle_id}/groups/save", json=body, headers=headers)


def get_group_by_unit(client: TestClient, bundle_id: int, unit_id: int, headers: dict[str, str] = AUTHOR) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/groups/by-unit/{unit_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def assign_as_is(client: TestClient, bundle_id: int, unit: dict, target_doc_id: int, **location: object) -> dict:
    """view 단위 하나를 원문 그대로 보내 확정하고 GroupOut을 돌려준다.

    표·행 단위면 원래 격자의 표 새 문장과 칸 문장마다 같은 자리의 칸 새 문장을, 그림이면 그림 새 문장을 만든다.
    location은 칸 키·WI 단계·부분(slot_key·wi_step·wi_part)이고 칸 새 문장도 표와 같은 자리에 둔다.
    """
    group = get_group_by_unit(client, bundle_id, unit["id"])
    entry = next(member for member in group["units"] if member["unit_id"] == unit["id"])
    target: dict = {"key": "t", "target_doc_id": target_doc_id, **location, "source_unit_ids": [unit["id"]]}
    targets = [target]
    if unit["kind"] in ("table", "table_row"):
        view = get_view(client, bundle_id, entry["document_id"])
        table = next(table for table in view["tables"] if table["id"] == unit["table_id"])
        blocks = {block["id"]: block for block in view["blocks"]}
        units = {member["id"]: member for member in view["units"]}
        # 행 단위의 표는 그 행 하나짜리 격자이고 칸 좌표도 그 행 기준이다
        is_row = unit["kind"] == "table_row"
        target.update(kind="table", grid={"rows": 1 if is_row else table["n_rows"], "cols": table["n_cols"]})
        for cell_id in entry["cell_unit_ids"]:
            block = blocks[units[cell_id]["block_id"]]
            targets.append({
                "key": f"cell-{cell_id}", "target_doc_id": target_doc_id, **location, "parent_key": "t",
                "source_unit_ids": [cell_id],
                "cell_row": block["row_index"] - (unit["row_index"] if is_row else 0), "cell_col": block["col_index"],
            })
    elif unit["kind"] == "figure":
        target["kind"] = "figure"
    body = {
        "action": "confirm",
        "units": [{"unit_id": unit["id"], "revision": entry["decision"]["revision"], "disposition": "assigned"}],
        "targets": targets,
    }
    response = save_group(client, bundle_id, body)
    assert response.status_code == 200, response.text
    return response.json()
