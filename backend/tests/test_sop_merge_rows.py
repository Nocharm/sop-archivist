"""여럿 고른 줄 합치기(merge_rows, 쪼개기 먼저 설계 §9) — 언어마다 하나로 합치고 한글 · 영어가 다 있으면 다시 짝, 편집 하나 · 되돌리기 한 번."""

from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.sop.models import Unit
from tests.access_helpers import update_row
from tests.docx_factory import build_docx, p
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_view, put_tobe, save_group, upload
from tests.test_sop_decision_undo import TOBE_DOCS, _dump, _redo, _undo, assert_same_state
from tests.test_sop_decisions import _body, _target, _unit_in
from tests.test_sop_lang_shape import _active, _edit, _ok, _pair, _pair_of

pytestmark = pytest.mark.usefixtures("clean_sop", "legacy_split_rule")

KO1, EN1 = "합성 장비를 켠다.", "Turn on the synthetic device."
KO2, EN2 = "합성 시료를 넣는다.", "Load the synthetic sample."
BODY = p("1. 목적", "Heading1") + p(KO1) + p(EN1) + p(KO2) + p(EN2)


class Fixture(NamedTuple):
    bundle_id: int
    sop_id: int
    doc_id: int
    ko1: dict
    en1: dict
    ko2: dict
    en2: dict


def _clear_pairs(client: TestClient, bundle_id: int, doc_id: int) -> None:
    """저절로 선 제안 짝을 걷는다 — 시험마다 짝을 손으로 맺는다."""
    for pair in get_view(client, bundle_id, doc_id)["pairs"]:
        revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
        response = client.delete(
            f"/api/bundles/{bundle_id}/documents/{doc_id}/pairs/{pair['id']}", params={"revision": revision}, headers=AUTHOR
        )
        assert response.status_code in (200, 204), response.text


def _setup(client: TestClient, *, side: str = "old", pairs: bool = True) -> Fixture:
    """한글 · 영어가 번갈아 놓인 문서 하나 — pairs면 (KO1, EN1) · (KO2, EN2)를 사람이 맺은 짝으로."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = put_tobe(client, bundle_id, TOBE_DOCS)
    assert response.status_code == 200, response.text
    sop_id = response.json()["docs"][0]["id"]
    if side == "new":
        _ok(upload(client, bundle_id, build_docx(BODY), "SYNTHETIC_OLD-1_Rows.docx"), 201)
        doc = _ok(
            upload(client, bundle_id, build_docx(BODY, headers=[p("합성 새 문서")]), "SYNTHETIC_SOP-R_Rows.docx", side="new", doc_type="sop"),
            201,
        )
    else:
        doc = _ok(upload(client, bundle_id, build_docx(BODY), "SYNTHETIC_OLD-1_Rows.docx"), 201)
    _clear_pairs(client, bundle_id, doc["id"])
    view = get_view(client, bundle_id, doc["id"])
    fx = Fixture(bundle_id, sop_id, doc["id"], *(find_unit(view, text) for text in (KO1, EN1, KO2, EN2)))
    if pairs:
        _pair(client, bundle_id, doc["id"], [fx.ko1["id"], fx.en1["id"]])
        _pair(client, bundle_id, doc["id"], [fx.ko2["id"], fx.en2["id"]])
    return fx


def _ids(*units: dict) -> list[int]:
    return [unit["id"] for unit in units]


def _merge_rows(client: TestClient, fx: Fixture, units: list[int], *, confirm: bool = False) -> httpx2.Response:
    return _edit(client, fx.bundle_id, fx.doc_id, {"type": "merge_rows", "unit_ids": units}, confirm=confirm)


def _rule(response: httpx2.Response) -> dict:
    assert response.status_code == 422, response.text
    return response.json()["detail"]


def _code(response: httpx2.Response) -> tuple[int, str]:
    return response.status_code, response.json()["detail"]["code"]


def _targets(bundle_id: int) -> list[dict]:
    return [row for row in _dump(bundle_id)["target_sentences"].values() if row["new_unit_id"] is not None]


def _dump_without(bundle_id: int, unit_ids: list[int]) -> dict:
    """편집이 만든 단위의 빈 판단 행은 편집 기록의 몫이라(되돌려도 은퇴한 단위에 남는다) 견주기에서 뺀다."""
    state = _dump(bundle_id)
    for unit_id in unit_ids:
        state["unit_decisions"].pop(str(unit_id), None)
    return state


# ── 합치기 ───────────────────────────────────────────────────────────────────


def test_pair_rows_merge_by_language_and_pair_again(client: TestClient) -> None:
    fx = _setup(client)
    before = _dump(fx.bundle_id)

    result = _ok(_merge_rows(client, fx, _ids(fx.ko1, fx.en1, fx.ko2, fx.en2)))

    view = get_view(client, fx.bundle_id, fx.doc_id)
    ko, en = (_active(view)[unit_id] for unit_id in result["created_unit_ids"])
    assert (ko["lang"], en["lang"], ko["text"], en["text"]) == ("ko", "en", f"{KO1} {KO2}", f"{EN1} {EN2}")
    pair = _pair_of(view, ko["id"])
    assert sorted(pair["unit_ids"]) == sorted([ko["id"], en["id"]]) and pair["status"] == "confirmed"
    assert sorted(result["retired_unit_ids"]) == sorted(_ids(fx.ko1, fx.en1, fx.ko2, fx.en2))

    _ok(_undo(client, fx.bundle_id))
    assert_same_state(_dump_without(fx.bundle_id, result["created_unit_ids"]), before)
    _ok(_redo(client, fx.bundle_id))
    assert _pair_of(get_view(client, fx.bundle_id, fx.doc_id), ko["id"]) is not None


def test_one_language_rows_merge_to_one_without_a_pair(client: TestClient) -> None:
    fx = _setup(client, pairs=False)

    result = _ok(_merge_rows(client, fx, _ids(fx.ko1, fx.ko2)))

    view = get_view(client, fx.bundle_id, fx.doc_id)
    assert len(result["created_unit_ids"]) == 1 and view["pairs"] == []
    assert _active(view)[result["created_unit_ids"][0]]["text"] == f"{KO1} {KO2}"


def test_a_lone_korean_row_joins_a_pair_row(client: TestClient) -> None:
    fx = _setup(client, pairs=False)
    _pair(client, fx.bundle_id, fx.doc_id, _ids(fx.ko2, fx.en2))

    result = _ok(_merge_rows(client, fx, _ids(fx.ko1, fx.ko2, fx.en2)))

    view = get_view(client, fx.bundle_id, fx.doc_id)
    (merged_id,) = result["created_unit_ids"]
    merged, en = _active(view)[merged_id], fx.en2
    assert merged["text"] == f"{KO1} {KO2}"
    assert sorted(_pair_of(view, merged["id"])["unit_ids"]) == sorted([merged["id"], en["id"]]) and en["id"] not in result["retired_unit_ids"]


def test_unpaired_mixed_rows_and_a_half_of_a_pair_are_refused(client: TestClient) -> None:
    fx = _setup(client, pairs=False)
    a = _merge_rows(client, fx, _ids(fx.ko1, fx.en1))
    _pair(client, fx.bundle_id, fx.doc_id, _ids(fx.ko2, fx.en2))
    b = _merge_rows(client, fx, _ids(fx.ko1, fx.ko2))

    assert (_rule(a)["code"], _rule(a)["reason"]) == ("cannot_merge", "mixed")
    assert (_rule(b)["code"], _rule(b)["reason"]) == ("cannot_merge", "pair_part")


def test_decided_rows_ask_once_and_undo_brings_the_decisions_back(client: TestClient) -> None:
    fx = _setup(client)
    _ok(save_group(client, fx.bundle_id, _body(
        [_unit_in(fx.ko1), _unit_in(fx.en1)], [_target("t", fx.sop_id, [fx.ko1, fx.en1], slot_key="purpose", text="Synthetic purpose")],
    )))
    before = _dump(fx.bundle_id)

    first = _merge_rows(client, fx, _ids(fx.ko1, fx.en1, fx.ko2, fx.en2))

    assert _code(first) == (409, "confirm_required")
    assert sorted(first.json()["detail"]["unit_ids"]) == sorted(_ids(fx.ko1, fx.en1))
    assert_same_state(_dump(fx.bundle_id), before)
    result = _ok(_merge_rows(client, fx, _ids(fx.ko1, fx.en1, fx.ko2, fx.en2), confirm=True))
    assert _ok(_undo(client, fx.bundle_id))["restored_decisions"] is True
    assert_same_state(_dump_without(fx.bundle_id, result["created_unit_ids"]), before)


def test_new_document_rows_merge_and_their_targets_follow(client: TestClient) -> None:
    fx = _setup(client, side="new")

    result = _ok(_merge_rows(client, fx, _ids(fx.ko1, fx.en1, fx.ko2, fx.en2)))

    assert len([t for t in _targets(fx.bundle_id) if t["new_unit_id"] in result["created_unit_ids"]]) == 2
    view = get_view(client, fx.bundle_id, fx.doc_id)
    assert sorted(_pair_of(view, result["created_unit_ids"][0])["unit_ids"]) == sorted(result["created_unit_ids"])


def test_a_toc_line_is_refused(client: TestClient) -> None:
    fx = _setup(client, pairs=False)
    update_row(Unit, fx.ko2["id"], noise_kind="toc")

    response = _merge_rows(client, fx, _ids(fx.ko1, fx.ko2))

    assert _code(response) == (422, "toc_line_locked")
