"""New 문서 편집의 단계 되돌리기 · 다시 하기 — new_unit_id마다 새 문장 하나(쪼개기 먼저 설계 §4-1)."""

from collections import Counter

import pytest
from fastapi.testclient import TestClient

from app.sop.decision_steps import Snapshot
from tests.docx_factory import build_docx, make_grid_table, make_row, p
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_view, save_group, upload
from tests.test_sop_decision_undo import _dump, _redo, _undo, assert_same_state

pytestmark = pytest.mark.usefixtures("clean_sop")

K1 = "새 필터를 끼우고 기록지에 적는다."
K2 = "장치를 멈추고 압력을 확인한다."
K3 = "보호 장갑과 보안경을 착용한다."
UNDO = {"session": "s1"}


def _setup(client: TestClient) -> tuple[int, dict, dict]:
    """묶음 id, Old 문서, New 문서 — New는 문장 · 표(칸 하나에 문장 둘) · 문장이다."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    old_body = p("절", "Heading1") + p(K1) + p(K2)
    old = upload(client, bundle_id, build_docx(old_body), "SYNTHETIC_OLD-1_A.docx")
    table = make_grid_table(
        2, make_row(["항목", "내용"], header=True) + make_row(["교체", p(K1) + p(K2)]) + make_row(["준비", K3])
    )
    new_body = p("새 절", "Heading1") + p("앞 문장이다. 이어진 문장이다.") + table + p("뒤 문장이다.") + p("끝 문장이다.")
    new = upload(client, bundle_id, build_docx(new_body), "SYNTHETIC_NEW-1_B.docx", side="new", doc_type="sop")
    assert old.status_code == 201 and new.status_code == 201, (old.text, new.text)
    return bundle_id, old.json(), new.json()


def _push_ids(client: TestClient, bundle_id: int, number: int) -> None:
    """다른 New 문서를 올려 id를 민다 — sqlite가 지운 id를 다시 쓰면 결함이 가려진다(글이 매번 달라야 409 중복 파일이 안 난다)."""
    data = build_docx(p("다른 절", "Heading1") + p(f"다른 문서의 문장 {number}이다."))
    response = upload(client, bundle_id, data, f"SYNTHETIC_NEW-{number}_C.docx", side="new", doc_type="sop")
    assert response.status_code == 201, response.text


def _edit(client: TestClient, bundle_id: int, doc: dict, op: dict) -> None:
    """편집 하나 — 409 confirm_required면 confirm을 켜고 한 번 더."""
    for confirm in (False, True):
        revision = get_view(client, bundle_id, doc["id"])["document"]["revision"]
        response = client.post(
            f"/api/bundles/{bundle_id}/documents/{doc['id']}/edits",
            json={"revision": revision, "confirm": confirm, "op": op, "undo": UNDO}, headers=AUTHOR,
        )
        if response.status_code != 409:
            break
    assert response.status_code == 200, response.text


def _link_cell(client: TestClient, bundle_id: int, old: dict, new: dict) -> None:
    """Old K1을 New K1 문장에 잇고 확정 — 칸이면 같은 표의 줄을 parent_key와 함께 되보낸다."""
    unit = find_unit(get_view(client, bundle_id, old["id"]), K1)
    cell_id = find_unit(get_view(client, bundle_id, new["id"]), K1)["id"]
    state = _dump(bundle_id)["target_sentences"]
    target_id, parent = next((int(key), row["parent_target_id"]) for key, row in state.items() if row["new_unit_id"] == cell_id)
    rows = {
        key: row for key, row in state.items()
        if int(key) == target_id or (parent is not None and parent in (int(key), row["parent_target_id"]))
    }
    targets = [
        {
            "key": key, "id": int(key), "revision": row["revision"], "kind": row["kind"],
            "cell_row": row["cell_row"], "cell_col": row["cell_col"],
            "source_unit_ids": [unit["id"]] if int(key) == target_id else [],
            "parent_key": str(row["parent_target_id"]) if row["parent_target_id"] else None,
        }
        for key, row in rows.items()
    ]
    body = {
        "action": "confirm", "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"}],
        "targets": targets, "undo": UNDO,
    }
    response = save_group(client, bundle_id, body)
    assert response.status_code == 200, response.text


def _build_op(view: dict, case: str) -> dict:
    sentences = [unit for unit in view["units"] if unit["kind"] == "sentence"]
    if case == "split":
        return {"type": "split", "unit_id": sentences[0]["id"], "at": 3}
    if case == "merge":
        at = next(index for index, unit in enumerate(sentences) if unit["text"] == "뒤 문장이다.")
        return {"type": "merge", "unit_ids": [sentences[at]["id"], sentences[at + 1]["id"]]}
    return {"type": "set_layout_table", "table_id": view["tables"][0]["id"], "is_layout": case == "unwrap"}


def _assert_one_each(state: Snapshot) -> None:
    counts = Counter(row["new_unit_id"] for row in state["target_sentences"].values() if row["new_unit_id"] is not None)
    assert [unit_id for unit_id, count in counts.items() if count != 1] == []


def _strip(rows: dict[str, dict]) -> dict[str, dict]:
    return {key: {col: v for col, v in row.items() if col not in ("revision", "updated_at")} for key, row in rows.items()}


@pytest.mark.parametrize("linked", [False, True])
@pytest.mark.parametrize("case", ["split", "merge", "unwrap", "rewrap"])
def test_undo_and_redo_keep_one_new_sentence_per_unit(client: TestClient, case: str, linked: bool) -> None:
    bundle_id, old, new = _setup(client)
    _push_ids(client, bundle_id, 2)
    if case == "rewrap":
        _edit(client, bundle_id, new, _build_op(get_view(client, bundle_id, new["id"]), "unwrap"))
    if linked:
        _link_cell(client, bundle_id, old, new)
    before = _dump(bundle_id)
    _edit(client, bundle_id, new, _build_op(get_view(client, bundle_id, new["id"]), case))
    _push_ids(client, bundle_id, 3)
    after = _dump(bundle_id)

    for _ in range(2):  # 여러 번 오간다
        undo = _undo(client, bundle_id)
        assert undo.status_code == 200, undo.text
        undone = _dump(bundle_id)
        _assert_one_each(undone)
        for name in ("target_sentences", "target_sources", "unit_decisions"):  # 이음과 확정까지 되살아난다
            assert _strip({key: undone[name].get(key, {}) for key in before[name]}) == _strip(before[name])

        redo = _redo(client, bundle_id)  # 이은 칸이 있어도 409 confirm_required가 아니다
        assert redo.status_code == 200, redo.text
        _assert_one_each(_dump(bundle_id))
        assert_same_state(_dump(bundle_id), after)
