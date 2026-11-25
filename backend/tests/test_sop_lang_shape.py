"""언어를 바꿔 모양이 바뀌는 편집(switch_language, B6) — 짝 → 합침 · 짝만 풂, 합친 조각 → 짝, Assign 되돌리기가 모두 되살린다."""

from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.sop.models import Unit
from tests.access_helpers import update_row
from tests.docx_factory import build_docx, p
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_view, save_group, upload
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

pytestmark = pytest.mark.usefixtures("clean_sop", "legacy_split_rule")

RECORDS_EN = "Synthetic records are kept."
NEW_KO, NEW_EN, NEW_FAR = "밸브를 닫고 압력을 확인한다.", "Close the valve.", "Record the result."


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


# ── New 문서 (R4) ─────────────────────────────────────────────────────────────


class NewFixture(NamedTuple):
    bundle_id: int
    old_id: int
    new_id: int
    ko: dict
    en: dict
    far: dict


def _setup_new(client: TestClient) -> NewFixture:
    """같은 글의 Old와 New — New의 한글 문장 · 영어 문장이 짝이고, 뒤에 떨어진 영어 문장이 있다."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    body = p("1. 절", "Heading1") + p(NEW_KO) + p(NEW_EN) + p(NEW_FAR)
    old = _ok(upload(client, bundle_id, build_docx(body), "SYNTHETIC_OLD-1_Shape.docx"), 201)
    new = _ok(
        upload(
            client, bundle_id, build_docx(body, headers=[p("합성 새 문서")]), "SYNTHETIC_SOP-L_Shape.docx",
            side="new", doc_type="sop",
        ),
        201,
    )
    view = get_view(client, bundle_id, new["id"])
    return NewFixture(
        bundle_id, old["id"], new["id"], find_unit(view, NEW_KO), find_unit(view, NEW_EN), find_unit(view, NEW_FAR)
    )


def _pair_new(client: TestClient, fx: NewFixture, *units: dict) -> None:
    """저절로 선 제안 짝을 걷고 사람이 맺은 짝 하나로."""
    for pair in get_view(client, fx.bundle_id, fx.new_id)["pairs"]:
        revision = get_view(client, fx.bundle_id, fx.new_id)["document"]["revision"]
        response = client.delete(
            f"/api/bundles/{fx.bundle_id}/documents/{fx.new_id}/pairs/{pair['id']}", params={"revision": revision}, headers=AUTHOR
        )
        assert response.status_code in (200, 204), response.text
    _pair(client, fx.bundle_id, fx.new_id, [unit["id"] for unit in units])


def _new_targets(bundle_id: int) -> dict[int, dict]:
    """단위 id → 새 문장 — 단위 하나에 새 문장 하나다."""
    rows = [row for row in _dump(bundle_id)["target_sentences"].values() if row["new_unit_id"] is not None]
    targets = {row["new_unit_id"]: row for row in rows}
    assert len(targets) == len(rows)
    return targets


def _link_new(client: TestClient, fx: NewFixture, unit_id: int, old_text: str) -> int:
    """Old의 old_text 문장을 New 단위의 새 문장에 이어 확정하고 Old 단위 id를 돌려준다."""
    old = find_unit(get_view(client, fx.bundle_id, fx.old_id), old_text)
    target = _new_targets(fx.bundle_id)[unit_id]
    body = {
        "action": "confirm", "units": [_unit_in(old)],
        "targets": [{"key": "t", "id": target["id"], "revision": target["revision"], "source_unit_ids": [old["id"]]}],
    }
    _ok(save_group(client, fx.bundle_id, body))
    return old["id"]


def test_switch_language_works_on_a_new_document(client: TestClient) -> None:
    fx = _setup_new(client)
    _pair_new(client, fx, fx.ko, fx.en)
    before = _dump(fx.bundle_id)

    result = _ok(_edit(client, fx.bundle_id, fx.new_id, {"type": "switch_language", "unit_id": fx.en["id"], "lang": "ko", "merge_pair": True}))

    assert result["shape"] == "merged"
    (merged_id,) = result["created_unit_ids"]
    view = get_view(client, fx.bundle_id, fx.new_id)
    assert _active(view)[merged_id]["lang"] == "ko" and _pair_of(view, merged_id) is None
    targets = _new_targets(fx.bundle_id)
    assert set(targets) == {merged_id, fx.far["id"]}
    assert (targets[merged_id]["lang"], targets[merged_id]["confirmed_text"]) == ("ko", f"{NEW_KO} {NEW_EN}")
    after = _dump(fx.bundle_id)
    for _ in range(2):
        assert _ok(_undo(client, fx.bundle_id))["op"] == "switch_language"
        assert_same_state(_dump(fx.bundle_id), before)
        _ok(_redo(client, fx.bundle_id))
        assert_same_state(_dump(fx.bundle_id), after)

    # 합친 New 문장의 끝 조각을 다시 영어로 - 옛 단위 둘과 새 문장 둘, 짝
    result = _ok(_edit(client, fx.bundle_id, fx.new_id, {"type": "switch_language", "unit_id": merged_id, "lang": "en", "piece": 1}))
    assert result["shape"] == "split_pair"
    assert set(_new_targets(fx.bundle_id)) == {fx.ko["id"], fx.en["id"], fx.far["id"]}
    pair = _pair_of(get_view(client, fx.bundle_id, fx.new_id), fx.ko["id"])
    assert pair is not None and sorted(pair["unit_ids"]) == sorted([fx.ko["id"], fx.en["id"]])
    _ok(_undo(client, fx.bundle_id))
    assert_same_state(_dump(fx.bundle_id), after)


def test_document_edit_undo_brings_back_both_new_sentences(client: TestClient) -> None:
    """단계 기록이 없는 편집(원문 고치기의 되돌리기)도 새 문장 둘이 돌아온다."""
    fx = _setup_new(client)
    _pair_new(client, fx, fx.ko, fx.en)
    op = {"type": "switch_language", "unit_id": fx.en["id"], "lang": "ko", "merge_pair": True}
    _ok(_edit(client, fx.bundle_id, fx.new_id, op, undo=None))

    revision = get_view(client, fx.bundle_id, fx.new_id)["document"]["revision"]
    _ok(client.post(f"/api/bundles/{fx.bundle_id}/documents/{fx.new_id}/edits/undo", json={"revision": revision}, headers=AUTHOR))

    assert set(_new_targets(fx.bundle_id)) == {fx.ko["id"], fx.en["id"], fx.far["id"]}


@pytest.mark.parametrize("shape", ["merged", "unpaired", "split_pair"])
def test_switching_a_linked_new_pair_asks_first(client: TestClient, shape: str) -> None:
    """New는 이음을 묻지 않고 풀지 않는다(R4) - 확인하면 이음이 풀리고 이어져 있던 Old 줄은 보류, 되돌리면 모두 돌아온다."""
    fx = _setup_new(client)
    other = fx.far if shape == "unpaired" else fx.en
    _pair_new(client, fx, fx.ko, other)
    op: dict = {"type": "switch_language", "unit_id": other["id"], "lang": "ko", "merge_pair": shape != "unpaired"}
    linked = {other["id"]: other["text"]} if shape == "unpaired" else {fx.ko["id"]: NEW_KO, other["id"]: other["text"]}
    if shape == "split_pair":
        (merged_id,) = _ok(_edit(client, fx.bundle_id, fx.new_id, op))["created_unit_ids"]
        op = {"type": "switch_language", "unit_id": merged_id, "lang": "en", "piece": 1}
        linked = {merged_id: NEW_KO}
    olds = {_link_new(client, fx, unit_id, text) for unit_id, text in linked.items()}
    before = _dump(fx.bundle_id)

    refused = _edit(client, fx.bundle_id, fx.new_id, op)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"]["code"] == "confirm_required"
    assert sorted(refused.json()["detail"]["unit_ids"]) == sorted(linked)
    assert_same_state(_dump(fx.bundle_id), before)

    result = _ok(_edit(client, fx.bundle_id, fx.new_id, op, confirm=True))

    assert result["shape"] == shape
    assert set(result["detach"]["held_unit_ids"]) == olds
    state = _dump(fx.bundle_id)
    assert {state["unit_decisions"][str(unit_id)]["status"] for unit_id in olds} == {"on_hold"}
    assert state["target_sources"] == {}
    assert {row["status"] for row in _new_targets(fx.bundle_id).values()} == {"unassigned"}
    if shape == "unpaired":
        row = _new_targets(fx.bundle_id)[other["id"]]
        assert (row["lang"], row["confirmed_text"]) == ("ko", other["text"])
        assert get_view(client, fx.bundle_id, fx.new_id)["pairs"] == []
    for _ in range(2):
        _ok(_undo(client, fx.bundle_id))
        assert_same_state(_dump(fx.bundle_id), before)
        _ok(_redo(client, fx.bundle_id))
        assert_same_state(_dump(fx.bundle_id), state)


def test_a_new_sentence_confirmed_without_sources_asks_too(client: TestClient) -> None:
    fx = _setup_new(client)
    _pair_new(client, fx, fx.ko, fx.far)
    target = _new_targets(fx.bundle_id)[fx.far["id"]]
    body = {"action": "confirm", "units": [], "targets": [{"key": "t", "id": target["id"], "revision": target["revision"], "source_unit_ids": []}]}
    _ok(save_group(client, fx.bundle_id, body))
    op = {"type": "switch_language", "unit_id": fx.far["id"], "lang": "ko"}

    refused = _edit(client, fx.bundle_id, fx.new_id, op)

    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "confirm_required", refused.text
    _ok(_edit(client, fx.bundle_id, fx.new_id, op, confirm=True))
    assert _new_targets(fx.bundle_id)[fx.far["id"]]["status"] == "unassigned"


@pytest.mark.parametrize("case", ["no_shape_change", "cannot_unmerge", "toc_line_locked"])
def test_new_refusals_stay(client: TestClient, case: str) -> None:
    fx = _setup_new(client)
    _pair_new(client, fx, fx.ko, fx.en)
    op: dict = {"type": "switch_language", "unit_id": fx.ko["id"], "lang": "ko"}
    if case == "cannot_unmerge":
        op = {"type": "switch_language", "unit_id": fx.ko["id"], "lang": "en", "piece": 0}
    elif case == "toc_line_locked":
        update_row(Unit, fx.en["id"], noise_kind="toc")
        op = {"type": "switch_language", "unit_id": fx.en["id"], "lang": "ko", "merge_pair": True}
    before = _dump(fx.bundle_id)

    response = _edit(client, fx.bundle_id, fx.new_id, op, confirm=True)

    assert response.status_code == 422 and response.json()["detail"]["code"] == case, response.text
    assert_same_state(_dump(fx.bundle_id), before)
