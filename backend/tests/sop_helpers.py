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


def set_doc_version(
    client: TestClient, bundle_id: int, doc: dict, version: str = "1.0", headers: dict[str, str] = AUTHOR
) -> dict:
    """옛 문서의 버전을 적는다(검토 요청 조건) — doc은 revision을 담은 문서 응답이고, 바뀐 문서를 돌려준다."""
    response = client.patch(
        f"/api/bundles/{bundle_id}/documents/{doc['id']}",
        json={"revision": doc["revision"], "doc_version": version},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


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


BUNDLE_KINDS = ("table", "table_row", "figure")
WRITTEN_CAPTION = "Synthetic caption"  # assign_as_is가 캡션 없는 묶음을 확정할 때 써 넣는 캡션


def build_missing_caption(targets: list[dict], parent: dict) -> list[dict]:
    """GroupOut 새 문장 parent(표·그림) 아래 캡션 새 문장이 없으면 써 넣은 캡션 하나(key "caption", parent_key는 parent id) — 캡션 없는 묶음은 확정할 수 없다.

    입구 2 표·그림은 새 문서 원문 그대로라 캡션을 써 넣지 않는다(서버도 캡션을 요구하지 않는다).
    """
    if parent["origin"] == "new_doc" or any(target["parent_target_id"] == parent["id"] and target["cell_row"] is None for target in targets):
        return []
    return [{
        "key": "caption", "target_doc_id": parent["target_doc_id"], "slot_key": parent["slot_key"],
        "wi_step": parent["wi_step"], "wi_part": parent["wi_part"], "parent_key": str(parent["id"]),
        "lang": "en", "text": WRITTEN_CAPTION, "source_unit_ids": [],
    }]


def build_as_is_targets(
    client: TestClient, bundle_id: int, unit: dict, target_doc_id: int, **location: object
) -> tuple[list[dict], list[int]]:
    """view 단위 하나를 원문 그대로 보내는 새 문장(key "t")과 그 묶음에 딸린 캡션 단위 id — 캡션 새 문장은 넣지 않는다.

    표·행 단위면 원래 격자의 표 새 문장과 칸 문장마다 같은 자리의 칸 새 문장을, 그림이면 그림 새 문장을 만든다.
    location은 칸 키·WI 단계·부분(slot_key·wi_step·wi_part)이고 칸 새 문장도 표와 같은 자리에 둔다.
    """
    group = get_group_by_unit(client, bundle_id, unit["id"])
    entry = next(member for member in group["units"] if member["unit_id"] == unit["id"])
    return _build_as_is_targets(client, bundle_id, unit, entry, target_doc_id, location)


def _build_as_is_targets(
    client: TestClient, bundle_id: int, unit: dict, entry: dict, target_doc_id: int, location: dict
) -> tuple[list[dict], list[int]]:
    target: dict = {"key": "t", "target_doc_id": target_doc_id, **location, "source_unit_ids": [unit["id"]]}
    targets = [target]
    if unit["kind"] not in BUNDLE_KINDS:
        return targets, []
    view = get_view(client, bundle_id, entry["document_id"])
    units = {member["id"]: member for member in view["units"]}
    # 묶인 단위 목록(cell_unit_ids)은 칸 문장과 캡션을 함께 싣는다
    caption_ids = [member_id for member_id in entry["cell_unit_ids"] if units[member_id]["kind"] == "caption"]
    if unit["kind"] == "figure":
        target["kind"] = "figure"
        return targets, caption_ids
    table = next(table for table in view["tables"] if table["id"] == unit["table_id"])
    blocks = {block["id"]: block for block in view["blocks"]}
    # 행 단위의 표는 그 행 하나짜리 격자이고 칸 좌표도 그 행 기준이다
    is_row = unit["kind"] == "table_row"
    target.update(kind="table", grid={"rows": 1 if is_row else table["n_rows"], "cols": table["n_cols"]})
    for cell_id in entry["cell_unit_ids"]:
        if cell_id in caption_ids:
            continue
        block = blocks[units[cell_id]["block_id"]]
        targets.append({
            "key": f"cell-{cell_id}", "target_doc_id": target_doc_id, **location, "parent_key": "t",
            "source_unit_ids": [cell_id],
            "cell_row": block["row_index"] - (unit["row_index"] if is_row else 0), "cell_col": block["col_index"],
        })
    return targets, caption_ids


def assign_as_is(
    client: TestClient,
    bundle_id: int,
    unit: dict,
    target_doc_id: int,
    *,
    hold_reason: str = "",
    undo: dict | None = None,
    **location: object,
) -> dict:
    """view 단위 하나를 원문 그대로 보내 확정(hold_reason을 주면 보류)하고 GroupOut을 돌려준다.

    표·행·그림 단위는 build_as_is_targets의 새 문장에 캡션 새 문장을 더한다 — 딸린 캡션 단위마다 하나, 캡션이 없는 묶음을
    확정할 때는 써 넣은 캡션 하나(캡션 없는 묶음은 확정할 수 없다). 보류는 캡션을 써 넣지 않는다.
    """
    group = get_group_by_unit(client, bundle_id, unit["id"])
    entry = next(member for member in group["units"] if member["unit_id"] == unit["id"])
    targets, caption_ids = _build_as_is_targets(client, bundle_id, unit, entry, target_doc_id, location)
    caption_base = {"target_doc_id": target_doc_id, **location, "parent_key": "t"}
    targets += [
        {**caption_base, "key": f"caption-{caption_id}", "source_unit_ids": [caption_id]} for caption_id in caption_ids
    ]
    if unit["kind"] in BUNDLE_KINDS and not caption_ids and not hold_reason:
        targets.append({**caption_base, "key": "caption", "lang": "en", "text": WRITTEN_CAPTION, "source_unit_ids": []})
    body = {
        "action": "hold" if hold_reason else "confirm",
        "hold_reason": hold_reason,
        "units": [{"unit_id": unit["id"], "revision": entry["decision"]["revision"], "disposition": "assigned"}],
        "targets": targets,
    }
    if undo is not None:
        body["undo"] = undo
    response = save_group(client, bundle_id, body)
    assert response.status_code == 200, response.text
    return response.json()
