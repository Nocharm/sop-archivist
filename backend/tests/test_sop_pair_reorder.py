"""짝 카드 안 순서 — 편집 reorder_pair(units.pair_seq)의 적용 · 되돌리기 · 다시 하기, 문단 Excel의 카드 순서, 받지 않는 요청."""

from io import BytesIO
from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.sop.models import Bundle, UnitDecision
from app.sop.pair_order import order_pair_card
from tests.access_helpers import update_row
from tests.docx_factory import build_docx, p
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_view, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-1_PairOrder.docx"
KO_ON, EN_ON = "합성 장비를 켠다.", "Turn on the synthetic unit."
KO_OFF, EN_OFF = "합성 장비를 끈다.", "Turn off the synthetic unit."


class Fixture(NamedTuple):
    bundle_id: int
    doc_id: int
    view: dict


def _setup(client: TestClient, body: str) -> Fixture:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = upload(client, bundle_id, build_docx(body), OLD_NAME)
    assert response.status_code == 201, response.text
    doc = response.json()
    assert doc["status"] == "ready", doc
    return Fixture(bundle_id, doc["id"], get_view(client, bundle_id, doc["id"]))


def _view(client: TestClient, fx: Fixture) -> dict:
    return get_view(client, fx.bundle_id, fx.doc_id)


def _reorder(client: TestClient, fx: Fixture, pair_id: int, unit_ids: list[int]) -> httpx2.Response:
    body = {
        "revision": _view(client, fx)["document"]["revision"],
        "op": {"type": "reorder_pair", "pair_id": pair_id, "unit_ids": unit_ids},
    }
    return client.post(f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits", json=body, headers=AUTHOR)


def _step(client: TestClient, fx: Fixture, action: str) -> httpx2.Response:
    revision = _view(client, fx)["document"]["revision"]
    return client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits/{action}", json={"revision": revision}, headers=AUTHOR
    )


def _code(response: httpx2.Response) -> tuple[int, str]:
    return response.status_code, response.json()["detail"]["code"]


def _card_order(view: dict, pair_id: int) -> list[int]:
    """화면이 그리는 카드 순서 — 원문 순서의 구성원을 pair_seq 규칙으로."""
    members = [unit for unit in view["units"] if unit["pair_id"] == pair_id]
    return [unit["id"] for unit in order_pair_card(members, lambda unit: unit["pair_seq"])]


def _paragraph_lines(client: TestClient, fx: Fixture) -> list[str]:
    response = client.get(f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/paragraphs.xlsx", headers=AUTHOR)
    assert response.status_code == 200, response.text
    sheet = load_workbook(BytesIO(response.content)).worksheets[0]
    return [row[0] for row in sheet.iter_rows(values_only=True)]


def test_order_pair_card_follows_seq_only_when_every_member_has_a_distinct_one() -> None:
    members = [("a", None), ("b", None), ("c", None)]

    assert order_pair_card(members, lambda member: member[1]) == members
    assert [m[0] for m in order_pair_card([("a", 1), ("b", 0)], lambda member: member[1])] == ["b", "a"]
    # 새로 든 구성원(값 없음)이나 겹친 낡은 값이면 원문 순서
    assert [m[0] for m in order_pair_card([("a", 1), ("b", 0), ("c", None)], lambda member: member[1])] == ["a", "b", "c"]
    assert [m[0] for m in order_pair_card([("a", 0), ("b", 0)], lambda member: member[1])] == ["a", "b"]


def test_reorder_flips_the_card_and_undo_redo_follow(client: TestClient) -> None:
    """KO 위 EN 카드를 EN 위 KO로 — 보기의 pair_seq와 문단 Excel이 따르고, 되돌리면 원문 순서, 다시 하면 바꾼 순서. 같은 순서는 쓰지 않는다."""
    fx = _setup(client, p(KO_ON) + p(EN_ON) + p(KO_OFF))
    ko_on, en_on = find_unit(fx.view, KO_ON), find_unit(fx.view, EN_ON)
    (pair,) = fx.view["pairs"]
    assert _card_order(fx.view, pair["id"]) == [ko_on["id"], en_on["id"]]
    revision = fx.view["document"]["revision"]

    response = _reorder(client, fx, pair["id"], [en_on["id"], ko_on["id"]])

    assert response.status_code == 200, response.text
    assert response.json()["document_revision"] == revision + 1
    assert (response.json()["created_unit_ids"], response.json()["retired_unit_ids"]) == ([], [])
    view = _view(client, fx)
    assert (find_unit(view, EN_ON)["pair_seq"], find_unit(view, KO_ON)["pair_seq"]) == (0, 1)
    assert _card_order(view, pair["id"]) == [en_on["id"], ko_on["id"]]
    assert _paragraph_lines(client, fx) == [EN_ON, KO_ON, KO_OFF]
    # 같은 순서를 다시 보내면 바뀌는 게 없다
    assert _reorder(client, fx, pair["id"], [en_on["id"], ko_on["id"]]).json()["document_revision"] == revision + 1

    undone = _step(client, fx, "undo")

    assert undone.status_code == 200, undone.text
    assert undone.json()["op"] == "reorder_pair"
    view = _view(client, fx)
    assert (find_unit(view, EN_ON)["pair_seq"], find_unit(view, KO_ON)["pair_seq"]) == (None, None)
    assert _card_order(view, pair["id"]) == [ko_on["id"], en_on["id"]]
    assert _paragraph_lines(client, fx) == [KO_ON, EN_ON, KO_OFF]

    redone = _step(client, fx, "redo")

    assert redone.status_code == 200, redone.text
    assert _card_order(_view(client, fx), pair["id"]) == [en_on["id"], ko_on["id"]]


def test_reorder_rules(client: TestClient) -> None:
    """그 문서의 짝 · 구성원 전부 · 겹침 없음 · 끊김 없는 카드 · 배정 없음 · 작업 중인 묶음만."""
    fx = _setup(client, p(KO_ON) + p(EN_ON) + p(KO_OFF) + p(EN_OFF))
    ko_on, en_on, ko_off, en_off = (find_unit(fx.view, text) for text in (KO_ON, EN_ON, KO_OFF, EN_OFF))
    first = next(pair for pair in fx.view["pairs"] if ko_on["id"] in pair["unit_ids"])

    assert _code(_reorder(client, fx, 999_999, [en_on["id"], ko_on["id"]])) == (404, "pair_not_found")
    assert _code(_reorder(client, fx, first["id"], [en_on["id"], ko_off["id"]])) == (422, "pair_members_mismatch")
    assert _code(_reorder(client, fx, first["id"], [en_on["id"], ko_on["id"], ko_off["id"]])) == (
        422, "pair_members_mismatch",
    )
    assert _code(_reorder(client, fx, first["id"], [en_on["id"], en_on["id"]])) == (422, "duplicate_units")

    # 떨어진 짝(KO_ON ↔ EN_OFF, 사이에 두 줄)은 카드가 아니다
    made = client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/pairs",
        json={"revision": _view(client, fx)["document"]["revision"], "unit_ids": [ko_on["id"], en_off["id"]]},
        headers=AUTHOR,
    )
    assert made.status_code == 201, made.text
    apart = made.json()["pair"]["id"]
    response = _reorder(client, fx, apart, [en_off["id"], ko_on["id"]])
    assert _code(response) == (422, "pair_not_adjacent")
    assert response.json()["detail"]["unit_ids"] == [en_on["id"], ko_off["id"]]

    # 배정이 걸린 구성원 — 먼저 배정을 푼다
    second = _setup(client, p(KO_ON) + p(EN_ON))
    (pair,) = second.view["pairs"]
    ko, en = find_unit(second.view, KO_ON), find_unit(second.view, EN_ON)
    update_row(UnitDecision, ko["id"], disposition="delete", status="confirmed")
    response = _reorder(client, second, pair["id"], [en["id"], ko["id"]])
    assert _code(response) == (409, "unit_has_decision")
    assert response.json()["detail"]["reason"] == "pair_order"

    update_row(UnitDecision, ko["id"], disposition="unassigned", status="unassigned")
    update_row(Bundle, second.bundle_id, status="in_review")
    assert _code(_reorder(client, second, pair["id"], [en["id"], ko["id"]])) == (409, "bundle_not_editable")
