"""한/영 짝 API — 사람이 만든 짝(확정)·제안 짝 확정·풀기와 짝 규칙, 은퇴한 단위가 짝에서 빠지는 것."""

from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import Bundle, BundleEvent
from tests.access_helpers import run_in_session, update_row
from tests.docx_factory import build_docx, p, tbl
from tests.sop_helpers import AUTHOR, REVIEWER, create_bundle, find_unit, get_view, set_members, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-1_Pairs.docx"
KO_ON, EN_ON = "합성 장비를 켠다.", "Turn on the synthetic unit."
KO_LOAD, KO_KEEP = "합성 시료를 넣는다.", "합성 기록을 남긴다."
EN_BOTH = "Load the sample and keep the records."


class Fixture(NamedTuple):
    bundle_id: int
    doc: dict
    view: dict


def _setup(client: TestClient, body: str, name: str = OLD_NAME, bundle_id: int | None = None) -> Fixture:
    if bundle_id is None:
        bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = upload(client, bundle_id, build_docx(body), name)
    assert response.status_code == 201, response.text
    doc = response.json()
    assert doc["status"] == "ready", doc
    return Fixture(bundle_id, doc, get_view(client, bundle_id, doc["id"]))


def _base(fx: Fixture) -> str:
    return f"/api/bundles/{fx.bundle_id}/documents/{fx.doc['id']}/pairs"


def _revision(client: TestClient, fx: Fixture) -> int:
    return get_view(client, fx.bundle_id, fx.doc["id"])["document"]["revision"]


def _create(
    client: TestClient, fx: Fixture, units: list[dict], *, revision: int | None = None, headers: dict[str, str] = AUTHOR
) -> httpx2.Response:
    body = {"revision": revision or _revision(client, fx), "unit_ids": [unit["id"] for unit in units]}
    return client.post(_base(fx), json=body, headers=headers)


def _confirm(client: TestClient, fx: Fixture, pair_id: int, headers: dict[str, str] = AUTHOR) -> httpx2.Response:
    return client.post(f"{_base(fx)}/{pair_id}/confirm", json={"revision": _revision(client, fx)}, headers=headers)


def _delete(client: TestClient, fx: Fixture, pair_id: int, headers: dict[str, str] = AUTHOR) -> httpx2.Response:
    return client.delete(f"{_base(fx)}/{pair_id}", params={"revision": _revision(client, fx)}, headers=headers)


def _code(response: httpx2.Response) -> tuple[int, str]:
    return response.status_code, response.json()["detail"]["code"]


def _ids(*units: dict) -> list[int]:
    return [unit["id"] for unit in units]


def _load_pair_events(bundle_id: int) -> list[tuple[str, str, list]]:
    async def _run(session: AsyncSession) -> list[tuple[str, str, list]]:
        rows = await session.execute(
            select(BundleEvent.action, BundleEvent.target_type, BundleEvent.target_ids)
            .where(BundleEvent.bundle_id == bundle_id, BundleEvent.action.like("pair.%"))
            .order_by(BundleEvent.id)
        )
        return [tuple(row) for row in rows]

    return run_in_session(_run)


def test_create_confirm_delete_pair(client: TestClient) -> None:
    """제안 짝을 확정하고, 제안 짝에 든 단위로 사람이 짝을 만들면 그 제안 짝은 지워지며, 짝을 풀 수 있다 — 모두 문서 revision +1."""
    fx = _setup(client, p(KO_ON) + p(EN_ON) + p(f"{KO_LOAD} {KO_KEEP}") + p(EN_BOTH))
    ko_on, en_on, ko_load, ko_keep, en_both = (
        find_unit(fx.view, text) for text in (KO_ON, EN_ON, KO_LOAD, KO_KEEP, EN_BOTH)
    )
    first, second = fx.view["pairs"]
    assert [first["unit_ids"], second["unit_ids"]] == [_ids(ko_on, en_on), _ids(ko_load, ko_keep, en_both)]

    confirmed = _confirm(client, fx, first["id"])

    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json() == {
        "document_revision": 2,
        "pair": {"id": first["id"], "status": "confirmed", "source": "code", "unit_ids": _ids(ko_on, en_on)},
    }
    created = _create(client, fx, [en_both, ko_load])
    assert created.status_code == 201, created.text
    pair = created.json()["pair"]
    assert created.json()["document_revision"] == 3
    assert (pair["status"], pair["source"], pair["unit_ids"]) == ("confirmed", "human", _ids(ko_load, en_both))
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert [(item["id"], item["unit_ids"]) for item in view["pairs"]] == [
        (first["id"], _ids(ko_on, en_on)), (pair["id"], _ids(ko_load, en_both)),
    ]
    assert find_unit(view, KO_KEEP)["pair_id"] is None

    deleted = _delete(client, fx, pair["id"])

    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"document_revision": 4, "pair": None}
    assert [item["id"] for item in get_view(client, fx.bundle_id, fx.doc["id"])["pairs"]] == [first["id"]]
    assert _load_pair_events(fx.bundle_id) == [
        ("pair.confirm", "pair", [first["id"]]), ("pair.create", "pair", [pair["id"]]),
        ("pair.delete", "pair", [pair["id"]]),
    ]
    # 이미 확정된 짝을 다시 확정해도 바뀌는 게 없다
    again = _confirm(client, fx, first["id"])
    assert again.json()["document_revision"] == 4
    assert _code(_create(client, fx, [ko_keep, en_both], revision=1)) == (409, "revision_conflict")
    assert _code(_delete(client, fx, 999_999)) == (404, "pair_not_found")


def test_pair_rules(client: TestClient) -> None:
    """같은 문서의 활성 글자 단위, 한글·영어 모두, 한쪽 MAX_PAIR_SIDE 이하. 확정 짝에 든 단위는 409."""
    korean = ["합성 하나를 한다.", "합성 둘을 한다.", "합성 셋을 한다.", "합성 넷을 한다."]
    fx = _setup(client, p(" ".join(korean)) + p("Do one to four.") + p("Do it again.") + tbl([["합성 칸"]]))
    ko = [find_unit(fx.view, text) for text in korean]
    en, again = find_unit(fx.view, "Do one to four."), find_unit(fx.view, "Do it again.")
    (table,) = [unit for unit in fx.view["units"] if unit["kind"] == "table"]
    assert fx.view["pairs"] == []  # 한글 덩어리가 MAX_PAIR_SIDE를 넘어 코드 짝이 없다
    other = _setup(client, p("합성 다른 문서."), "SYNTHETIC_OLD-2_Pairs.docx", fx.bundle_id)

    assert _code(_create(client, fx, ko[:2])) == (422, "missing_language")
    assert _code(_create(client, fx, [*ko, en])) == (422, "pair_side_too_large")
    assert _code(_create(client, fx, [ko[0], table, en])) == (422, "invalid_unit_kind")
    assert _code(_create(client, fx, [ko[0], ko[0], en])) == (422, "duplicate_units")
    assert _code(_create(client, fx, [find_unit(other.view, "합성 다른 문서."), en])) == (404, "unit_not_found")
    assert _create(client, fx, [*ko[:3], en]).status_code == 201

    taken = _create(client, fx, [ko[3], en, again])

    assert taken.status_code == 409
    assert taken.json()["detail"]["code"] == "unit_already_paired"
    assert taken.json()["detail"]["unit_ids"] == [en["id"]]
    assert get_view(client, fx.bundle_id, fx.doc["id"])["document"]["revision"] == 2
    (pair,) = get_view(client, fx.bundle_id, fx.doc["id"])["pairs"]
    assert set_members(client, fx.bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200
    assert {
        _code(_create(client, fx, [ko[3], again], headers=REVIEWER)),
        _code(_confirm(client, fx, pair["id"], headers=REVIEWER)),
        _code(_delete(client, fx, pair["id"], headers=REVIEWER)),
    } == {(403, "role_required")}
    update_row(Bundle, fx.bundle_id, status="in_review")
    assert {
        _code(_create(client, fx, [ko[3], again])),
        _code(_confirm(client, fx, pair["id"])),
        _code(_delete(client, fx, pair["id"])),
    } == {(409, "bundle_not_editable")}


def test_retired_unit_leaves_pair(client: TestClient) -> None:
    """사람이 만든 짝의 단위를 나누면 그 단위는 짝에서 빠지고, 한쪽 언어가 비면 짝이 지워진다."""
    fx = _setup(client, p(f"{KO_LOAD}{KO_KEEP} {KO_ON}") + p(EN_BOTH))
    two, ko_on, en_both = (find_unit(fx.view, text) for text in (f"{KO_LOAD}{KO_KEEP}", KO_ON, EN_BOTH))
    created = _create(client, fx, [two, ko_on, en_both])
    assert created.status_code == 201, created.text
    pair_id = created.json()["pair"]["id"]

    def _split(unit: dict, at: int) -> None:
        body = {"revision": _revision(client, fx), "op": {"type": "split", "unit_id": unit["id"], "at": at}}
        response = client.post(f"/api/bundles/{fx.bundle_id}/documents/{fx.doc['id']}/edits", json=body, headers=AUTHOR)
        assert response.status_code == 200, response.text

    _split(two, len(KO_LOAD))

    (kept,) = get_view(client, fx.bundle_id, fx.doc["id"])["pairs"]
    assert (kept["id"], kept["status"], kept["unit_ids"]) == (pair_id, "confirmed", _ids(ko_on, en_both))

    _split(en_both, len("Load the sample "))

    assert get_view(client, fx.bundle_id, fx.doc["id"])["pairs"] == []
