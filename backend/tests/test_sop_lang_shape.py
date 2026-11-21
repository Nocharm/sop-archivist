"""언어를 바꿔 모양이 바뀌는 편집(switch_language, B6) — 짝 → 합침 · 짝만 풂, 합친 조각 → 짝, Assign 되돌리기가 모두 되살린다."""

import httpx2
import pytest
from fastapi.testclient import TestClient

from tests.sop_helpers import AUTHOR, find_unit, get_view, save_group
from tests.test_sop_decision_undo import (
    TEXT_A,
    TEXT_B,
    TEXT_C,
    UNDO,
    _dump,
    _redo,
    _setup_rich,
    _undo,
    assert_same_state,
)
from tests.test_sop_decisions import RECORDS, WARM_UP, _body, _target, _unit_in
from tests.test_sop_decisions import _setup as _setup_decisions
from tests.test_sop_pair_settle import EN_HEAD, KO_HEAD

pytestmark = pytest.mark.usefixtures("clean_sop")

RECORDS_EN = "Synthetic records are kept."


def _edit(client: TestClient, bundle_id: int, doc_id: int, op: dict, *, undo: dict | None = UNDO, confirm: bool = False) -> httpx2.Response:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    body: dict = {"revision": revision, "op": op, "confirm": confirm}
    if undo is not None:
        body["undo"] = undo
    return client.post(f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json=body, headers=AUTHOR)


def _ok(response: httpx2.Response, status: int = 200) -> dict:
    assert response.status_code == status, response.text
    return response.json()


def _pair(client: TestClient, bundle_id: int, doc_id: int, unit_ids: list[int]) -> dict:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/pairs", json={"revision": revision, "unit_ids": unit_ids}, headers=AUTHOR
    )
    return _ok(response, 201)["pair"]


def _active(view: dict) -> dict[int, dict]:
    return {unit["id"]: unit for unit in view["units"]}


def _pair_of(view: dict, unit_id: int) -> dict | None:
    return next((pair for pair in view["pairs"] if unit_id in pair["unit_ids"]), None)


# ── 짝 → 한 언어 ─────────────────────────────────────────────────────────────


def test_a_neighbour_pair_made_one_language_merges_and_undo_brings_the_pair_back(client: TestClient) -> None:
    fx = _setup_decisions(client)
    ko, en = find_unit(fx.view, KO_HEAD), find_unit(fx.view, EN_HEAD)
    pair = _pair(client, fx.bundle_id, fx.doc["id"], [ko["id"], en["id"]])

    result = _ok(_edit(client, fx.bundle_id, fx.doc["id"], {"type": "switch_language", "unit_id": en["id"], "lang": "ko", "merge_pair": True}))

    assert result["shape"] == "merged"
    assert sorted(result["retired_unit_ids"]) == sorted([ko["id"], en["id"]])
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    (merged,) = [_active(view)[unit_id] for unit_id in result["created_unit_ids"]]
    assert merged["lang"] == "ko" and merged["text"].startswith(KO_HEAD) and merged["text"].endswith(EN_HEAD)
    assert _pair_of(view, merged["id"]) is None

    assert _ok(_undo(client, fx.bundle_id))["op"] == "switch_language"
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert (_active(view)[ko["id"]]["lang"], _active(view)[en["id"]]["lang"]) == ("ko", "en")
    assert _pair_of(view, ko["id"]) == pair


def test_an_assigned_pair_merges_without_asking_and_undo_brings_the_assignment_back(client: TestClient) -> None:
    """3-c - 확인 창 없이 바로 하고 배정을 푼다. 되돌리면 배정 · 새 문장 · 짝이 그대로 돌아온다."""
    fx = _setup_decisions(client)
    ko, en = find_unit(fx.view, KO_HEAD), find_unit(fx.view, EN_HEAD)
    _pair(client, fx.bundle_id, fx.doc["id"], [ko["id"], en["id"]])
    _ok(save_group(client, fx.bundle_id, _body([_unit_in(ko), _unit_in(en)], [_target("t", fx.sop_id, [ko, en], slot_key="purpose", text="Synthetic purpose")])))
    before = _dump(fx.bundle_id)

    result = _ok(_edit(client, fx.bundle_id, fx.doc["id"], {"type": "switch_language", "unit_id": en["id"], "lang": "ko", "merge_pair": True}))

    assert result["shape"] == "merged"
    assert sorted(result["detach"]["reset_unit_ids"]) == sorted([ko["id"], en["id"]])
    assert _ok(_undo(client, fx.bundle_id))["restored_decisions"] is True
    restored = _dump(fx.bundle_id)
    restored["unit_decisions"].pop(str(result["created_unit_ids"][0]))
    assert_same_state(restored, before)


def test_a_far_pair_made_one_language_only_separates(client: TestClient) -> None:
    fx = _setup_decisions(client)
    warm, records_en = find_unit(fx.view, WARM_UP), find_unit(fx.view, RECORDS_EN)
    _pair(client, fx.bundle_id, fx.doc["id"], [warm["id"], records_en["id"]])

    result = _ok(_edit(client, fx.bundle_id, fx.doc["id"], {"type": "switch_language", "unit_id": records_en["id"], "lang": "ko"}))

    assert (result["shape"], result["created_unit_ids"], result["retired_unit_ids"]) == ("unpaired", [], [])
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert _active(view)[records_en["id"]]["lang"] == "ko"
    assert _pair_of(view, warm["id"]) is None and _pair_of(view, records_en["id"]) is None
    _ok(_undo(client, fx.bundle_id))
    assert _pair_of(get_view(client, fx.bundle_id, fx.doc["id"]), warm["id"]) is not None


def test_a_far_assigned_pair_member_is_released_without_asking(client: TestClient) -> None:
    fx = _setup_decisions(client)
    warm, records_en = find_unit(fx.view, WARM_UP), find_unit(fx.view, RECORDS_EN)
    _pair(client, fx.bundle_id, fx.doc["id"], [warm["id"], records_en["id"]])
    _ok(save_group(client, fx.bundle_id, _body([_unit_in(warm), _unit_in(records_en)], [_target("t", fx.sop_id, [warm, records_en], slot_key="purpose", text="Synthetic purpose")])))
    before = _dump(fx.bundle_id)

    result = _ok(_edit(client, fx.bundle_id, fx.doc["id"], {"type": "switch_language", "unit_id": records_en["id"], "lang": "ko"}))

    assert records_en["id"] in result["detach"]["reset_unit_ids"]
    assert _dump(fx.bundle_id)["unit_decisions"][str(records_en["id"])]["status"] == "unassigned"
    _ok(_undo(client, fx.bundle_id))
    assert_same_state(_dump(fx.bundle_id), before)
    assert _ok(_redo(client, fx.bundle_id))["op"] == "switch_language"
    assert _dump(fx.bundle_id)["unit_decisions"][str(records_en["id"])]["status"] == "unassigned"


@pytest.mark.parametrize("case", ["no_pair", "same_language", "still_bilingual"])
def test_switch_without_a_shape_change_is_refused(client: TestClient, case: str) -> None:
    fx = _setup_decisions(client)
    ko, en, warm = find_unit(fx.view, KO_HEAD), find_unit(fx.view, EN_HEAD), find_unit(fx.view, WARM_UP)
    records = find_unit(fx.view, RECORDS)
    op = {"type": "switch_language", "unit_id": warm["id"], "lang": "en"}
    if case == "no_pair":
        _pair(client, fx.bundle_id, fx.doc["id"], [ko["id"], en["id"]])
        for pair in get_view(client, fx.bundle_id, fx.doc["id"])["pairs"]:
            if warm["id"] in pair["unit_ids"]:
                client.delete(f"/api/bundles/{fx.bundle_id}/documents/{fx.doc['id']}/pairs/{pair['id']}", params={"revision": get_view(client, fx.bundle_id, fx.doc["id"])["document"]["revision"]}, headers=AUTHOR)
    elif case == "same_language":
        _pair(client, fx.bundle_id, fx.doc["id"], [ko["id"], en["id"]])
        op = {"type": "switch_language", "unit_id": ko["id"], "lang": "ko"}
    else:
        # KO 둘 + EN 하나 - KO 하나를 EN으로 바꿔도 두 언어가 남는다
        _pair(client, fx.bundle_id, fx.doc["id"], [warm["id"], records["id"], find_unit(fx.view, RECORDS_EN)["id"]])

    response = _edit(client, fx.bundle_id, fx.doc["id"], op)

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "no_shape_change"


# ── 합친 박스의 조각 → 짝 ─────────────────────────────────────────────────────


def _merge(client: TestClient, fx, unit_ids: list[int]) -> int:
    return _ok(_edit(client, fx.bundle_id, fx.old_doc_id, {"type": "merge", "unit_ids": unit_ids}, undo=None))["created_unit_ids"][0]


def test_the_first_of_three_pieces_splits_off_and_pairs_with_the_rest_kept_merged(client: TestClient) -> None:
    fx = _setup_rich(client)
    merged_id = _merge(client, fx, [fx.a["id"], fx.b["id"], fx.c["id"]])
    merged = _active(get_view(client, fx.bundle_id, fx.old_doc_id))[merged_id]
    assert (merged["can_unmerge"], merged["merge_pieces"]) == (True, [TEXT_A, TEXT_B, TEXT_C])

    result = _ok(_edit(client, fx.bundle_id, fx.old_doc_id, {"type": "switch_language", "unit_id": merged_id, "lang": "en", "piece": 0}))

    assert result["shape"] == "split_pair" and result["retired_unit_ids"] == [merged_id]
    view = get_view(client, fx.bundle_id, fx.old_doc_id)
    units = _active(view)
    assert units[fx.a["id"]]["lang"] == "en"  # 옛 ID 그대로 되살림
    (rest_id,) = [unit_id for unit_id in result["created_unit_ids"] if unit_id != fx.a["id"]]
    assert units[rest_id]["lang"] == "ko" and units[rest_id]["text"] == f"{TEXT_B} {TEXT_C}"
    pair = _pair_of(view, fx.a["id"])
    assert pair is not None and sorted(pair["unit_ids"]) == sorted([fx.a["id"], rest_id]) and pair["status"] == "confirmed"

    _ok(_undo(client, fx.bundle_id))
    view = get_view(client, fx.bundle_id, fx.old_doc_id)
    assert merged_id in _active(view) and fx.a["id"] not in _active(view) and view["pairs"] == []


def test_the_last_of_two_pieces_splits_off_and_both_come_back_with_their_ids(client: TestClient) -> None:
    fx = _setup_rich(client)
    merged_id = _merge(client, fx, [fx.a["id"], fx.b["id"]])

    result = _ok(_edit(client, fx.bundle_id, fx.old_doc_id, {"type": "switch_language", "unit_id": merged_id, "lang": "en", "piece": 1}))

    assert sorted(result["created_unit_ids"]) == sorted([fx.a["id"], fx.b["id"]])
    view = get_view(client, fx.bundle_id, fx.old_doc_id)
    assert (_active(view)[fx.a["id"]]["lang"], _active(view)[fx.b["id"]]["lang"]) == ("ko", "en")
    assert sorted(_pair_of(view, fx.b["id"])["unit_ids"]) == sorted([fx.a["id"], fx.b["id"]])


@pytest.mark.parametrize(("piece", "code"), [(1, "middle_piece"), (3, "invalid_piece")])
def test_a_middle_or_missing_piece_is_refused(client: TestClient, piece: int, code: str) -> None:
    fx = _setup_rich(client)
    merged_id = _merge(client, fx, [fx.a["id"], fx.b["id"], fx.c["id"]])

    response = _edit(client, fx.bundle_id, fx.old_doc_id, {"type": "switch_language", "unit_id": merged_id, "lang": "en", "piece": piece})

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == code


def test_a_piece_of_a_unit_that_was_not_merged_is_refused(client: TestClient) -> None:
    fx = _setup_rich(client)

    response = _edit(client, fx.bundle_id, fx.old_doc_id, {"type": "switch_language", "unit_id": fx.a["id"], "lang": "en", "piece": 0})

    assert response.status_code == 422 and response.json()["detail"]["code"] == "cannot_unmerge"
    assert find_unit(get_view(client, fx.bundle_id, fx.old_doc_id), TEXT_A)["lang"] == "ko"
    assert find_unit(get_view(client, fx.bundle_id, fx.old_doc_id), TEXT_B)["lang"] == "ko"


def test_a_pair_merged_by_a_language_switch_splits_back_into_the_pair_by_a_piece_switch(client: TestClient) -> None:
    """반대의 경우도 짝으로(사용자 원문 3번) - 짝을 한 언어로 바꿔 합친 박스는 조각이 남아, 끝 조각의 언어를 되돌리면 다시 짝이다."""
    fx = _setup_decisions(client)
    ko, en = find_unit(fx.view, KO_HEAD), find_unit(fx.view, EN_HEAD)
    _pair(client, fx.bundle_id, fx.doc["id"], [ko["id"], en["id"]])
    merged_id = _ok(_edit(client, fx.bundle_id, fx.doc["id"], {"type": "switch_language", "unit_id": en["id"], "lang": "ko", "merge_pair": True}))["created_unit_ids"][0]
    assert _active(get_view(client, fx.bundle_id, fx.doc["id"]))[merged_id]["merge_pieces"] == [KO_HEAD, EN_HEAD]

    _ok(_edit(client, fx.bundle_id, fx.doc["id"], {"type": "switch_language", "unit_id": merged_id, "lang": "en", "piece": 1}))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert (_active(view)[ko["id"]]["lang"], _active(view)[en["id"]]["lang"]) == ("ko", "en")
    assert sorted(_pair_of(view, ko["id"])["unit_ids"]) == sorted([ko["id"], en["id"]])
