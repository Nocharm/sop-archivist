"""짝의 운명 — 판단을 쓰는 길(관계 묶음 저장·일괄 처분·입구 2 한 번에 확정) 끝에 서버가 한/영 짝을 확정하거나 푼다 (설계 §5.2, §7)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.pair_settle import PairSettleReport, settle_pairs
from tests.access_helpers import run_in_session
from tests.docx_factory import p
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_bundle, get_group_by_unit, get_view, save_group
from tests.test_sop_decisions import Fixture, _body, _reason, _setup, _target, _unit_in
from tests.test_sop_match import _bulk_confirm, _get_candidates, _identical_in
from tests.test_sop_match import _setup as _setup_match
from tests.test_sop_pairs import EN_ON, KO_ON, _code, _create, _delete, _load_pair_events

pytestmark = pytest.mark.usefixtures("clean_sop")

KO_HEAD, EN_HEAD = "1. 목적", "1. Purpose"
DELETE_REASON = "Synthetic: not needed"


def _pair_of(client: TestClient, bundle_id: int, document_id: int, unit: dict) -> dict | None:
    """문서 보기에서 그 단위가 든 짝."""
    view = get_view(client, bundle_id, document_id)
    return next((pair for pair in view["pairs"] if unit["id"] in pair["unit_ids"]), None)


def _setup_pair(client: TestClient) -> tuple[Fixture, dict, dict, int]:
    """한/영 제목이 제안 짝인 묶음 — (픽스처, 한글, 영어, 짝 id)."""
    fx = _setup(client)
    ko, en = find_unit(fx.view, KO_HEAD), find_unit(fx.view, EN_HEAD)
    pair = _pair_of(client, fx.bundle_id, fx.doc["id"], ko)
    assert pair is not None and set(pair["unit_ids"]) == {ko["id"], en["id"]}, fx.view["pairs"]
    assert pair["status"] == "suggested"
    return fx, ko, en, pair["id"]


def _unit_status(client: TestClient, bundle_id: int, unit: dict) -> str:
    response = client.get(f"/api/bundles/{bundle_id}/units", params={"limit": 1000}, headers=AUTHOR)
    assert response.status_code == 200, response.text
    (row,) = [row for row in response.json()["items"] if row["unit_id"] == unit["id"]]
    return row["status"]


def _dispose(client: TestClient, bundle_id: int, units: list[dict], revision: int = 1) -> None:
    body = {
        "action": "delete", "reason": DELETE_REASON,
        "units": [{"unit_id": unit["id"], "revision": revision} for unit in units],
    }
    response = client.post(f"/api/bundles/{bundle_id}/decisions/bulk", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text


# ── 관계 묶음 저장 ────────────────────────────────────────────────────────────


def test_confirming_the_whole_row_confirms_a_suggested_pair(client: TestClient) -> None:
    fx, ko, en, pair_id = _setup_pair(client)
    targets = [_target("ko", fx.sop_id, [ko], slot_key="purpose"), _target("en", fx.sop_id, [en], slot_key="purpose")]

    response = save_group(client, fx.bundle_id, _body([_unit_in(ko), _unit_in(en)], targets))

    assert response.status_code == 200, response.text
    group = response.json()
    assert _pair_of(client, fx.bundle_id, fx.doc["id"], ko) == {
        "id": pair_id, "status": "confirmed", "source": "code", "unit_ids": [ko["id"], en["id"]],
    }
    assert (group["pairs_confirmed"], group["pairs_dissolved"]) == ([pair_id], [])
    assert [action for action, _, _ in _load_pair_events(fx.bundle_id)] == ["pair.confirm"]


def test_pair_stays_suggested_while_one_member_is_undecided(client: TestClient) -> None:
    """한쪽만 저장하고 다른 쪽이 미배정이면 풀지 않는다 — 줄의 상태가 덜 끝난 쪽을 따른다(설계 §5.2 (1))."""
    fx, ko, _en, pair_id = _setup_pair(client)

    response = save_group(client, fx.bundle_id, _body([_unit_in(ko)], [_target("ko", fx.sop_id, [ko], slot_key="purpose")]))

    assert response.status_code == 200, response.text
    assert (response.json()["pairs_confirmed"], response.json()["pairs_dissolved"]) == ([], [])
    assert _pair_of(client, fx.bundle_id, fx.doc["id"], ko)["status"] == "suggested"
    assert _load_pair_events(fx.bundle_id) == []


def test_pair_stays_when_members_go_to_different_sections_of_one_doc(client: TestClient) -> None:
    """갈림의 기준은 새 문서까지다 — 같은 새 문서 안에서 칸이 다른 것은 갈린 것이 아니다."""
    fx, ko, en, pair_id = _setup_pair(client)
    targets = [
        _target("ko", fx.sop_id, [ko], slot_key="purpose"),
        _target("en", fx.sop_id, [en], slot_key="definitions"),
    ]

    response = save_group(client, fx.bundle_id, _body([_unit_in(ko), _unit_in(en)], targets))

    assert response.status_code == 200, response.text
    assert response.json()["pairs_confirmed"] == [pair_id]
    assert _pair_of(client, fx.bundle_id, fx.doc["id"], ko)["status"] == "confirmed"


def test_pair_dissolves_when_members_go_to_different_documents(client: TestClient) -> None:
    fx, ko, en, pair_id = _setup_pair(client)
    targets = [
        _target("ko", fx.sop_id, [ko], slot_key="purpose"),
        _target("en", fx.wi_id, [en], wi_step=1, wi_part="instruction"),
    ]

    response = save_group(client, fx.bundle_id, _body([_unit_in(ko), _unit_in(en)], targets))

    assert response.status_code == 200, response.text
    assert (response.json()["pairs_confirmed"], response.json()["pairs_dissolved"]) == ([], [pair_id])
    assert _pair_of(client, fx.bundle_id, fx.doc["id"], ko) is None
    assert _load_pair_events(fx.bundle_id) == [("pair.delete", "pair", [pair_id])]


def test_pair_dissolves_when_a_later_save_moves_one_member_elsewhere(client: TestClient) -> None:
    """확정된 짝이라도 다시 저장해 한쪽이 다른 새 문서로 가면 푼다 — 배정 지우기 뒤 다시 저장하는 길도 같다."""
    fx, ko, en, pair_id = _setup_pair(client)
    together = [_target("ko", fx.sop_id, [ko], slot_key="purpose"), _target("en", fx.sop_id, [en], slot_key="purpose")]
    first = save_group(client, fx.bundle_id, _body([_unit_in(ko), _unit_in(en)], together)).json()
    en_target = next(target for target in first["targets"] if target["lang"] == "en")
    moved = {"key": "en", "target_doc_id": fx.wi_id, "id": en_target["id"], "revision": en_target["revision"],
             "wi_step": 1, "wi_part": "instruction", "source_unit_ids": [en["id"]]}

    response = save_group(client, fx.bundle_id, _body([_unit_in(en, 2)], [moved]))

    assert response.status_code == 200, response.text
    assert response.json()["pairs_dissolved"] == [pair_id]
    assert _pair_of(client, fx.bundle_id, fx.doc["id"], ko) is None


def test_held_member_with_another_destination_dissolves_the_pair(client: TestClient) -> None:
    """보류도 판단이다 — 처분이 미배정이 아니면 운명을 비교한다."""
    fx, ko, en, pair_id = _setup_pair(client)
    save_group(client, fx.bundle_id, _body([_unit_in(ko)], [_target("ko", fx.sop_id, [ko], slot_key="purpose")]))

    held = save_group(client, fx.bundle_id, _body(
        [_unit_in(en)], [_target("en", fx.wi_id, [en], wi_step=1, wi_part="instruction")],
        action="hold", hold_reason="Synthetic: check later",
    ))

    assert held.status_code == 200, held.text
    assert held.json()["pairs_dissolved"] == [pair_id]


def test_release_unit_ids_dissolves_the_pair_in_the_same_save(client: TestClient) -> None:
    """한쪽만 잇고 다른 쪽을 따로 줄로 남긴다는 뜻을 저장에 실으면 그 저장 안에서 푼다(설계 §5.2 (1))."""
    fx, ko, en, pair_id = _setup_pair(client)
    body = _body([_unit_in(ko)], [_target("ko", fx.sop_id, [ko], slot_key="purpose")], release_unit_ids=[en["id"]])

    response = save_group(client, fx.bundle_id, body)

    assert response.status_code == 200, response.text
    assert (response.json()["pairs_confirmed"], response.json()["pairs_dissolved"]) == ([], [pair_id])
    assert _pair_of(client, fx.bundle_id, fx.doc["id"], ko) is None
    assert _unit_status(client, fx.bundle_id, en) == "unassigned"


def test_release_unit_ids_must_be_units_of_this_bundle(client: TestClient) -> None:
    fx, ko, en, pair_id = _setup_pair(client)
    other = _setup(client)
    foreign = find_unit(other.view, EN_HEAD)
    target = _target("ko", fx.sop_id, [ko], slot_key="purpose")

    for release in ([foreign["id"]], [en["id"], 999_999]):
        response = save_group(client, fx.bundle_id, _body([_unit_in(ko)], [target], release_unit_ids=release))
        assert _reason(response) == "unknown_unit"
        assert response.json()["detail"]["unit_ids"] == [release[-1]]
    assert _pair_of(client, fx.bundle_id, fx.doc["id"], ko)["status"] == "suggested"
    assert _pair_of(client, other.bundle_id, other.doc["id"], foreign)["status"] == "suggested"


def test_settle_pairs_never_touches_a_pair_of_another_bundle(client: TestClient) -> None:
    fx, ko, en, pair_id = _setup_pair(client)
    other_bundle = create_bundle(client, is_synthetic=True)["id"]

    async def _run(session: AsyncSession) -> PairSettleReport:
        report = await settle_pairs(session, other_bundle, [ko["id"]], "qa.member", release=[en["id"]])
        await session.commit()
        return report

    assert run_in_session(_run) == PairSettleReport(confirmed_pair_ids=[], dissolved_pair_ids=[])
    assert _pair_of(client, fx.bundle_id, fx.doc["id"], ko)["id"] == pair_id


# ── 일괄 처분 ─────────────────────────────────────────────────────────────────


def test_pair_dissolves_when_one_member_is_deleted_and_the_other_assigned(client: TestClient) -> None:
    fx, ko, en, pair_id = _setup_pair(client)
    save_group(client, fx.bundle_id, _body([_unit_in(ko)], [_target("ko", fx.sop_id, [ko], slot_key="purpose")]))

    _dispose(client, fx.bundle_id, [en])

    assert _pair_of(client, fx.bundle_id, fx.doc["id"], ko) is None
    assert _load_pair_events(fx.bundle_id) == [("pair.delete", "pair", [pair_id])]


def test_bulk_delete_of_both_members_keeps_and_confirms_the_pair(client: TestClient) -> None:
    fx, ko, en, pair_id = _setup_pair(client)

    _dispose(client, fx.bundle_id, [ko, en])

    assert _pair_of(client, fx.bundle_id, fx.doc["id"], ko) == {
        "id": pair_id, "status": "confirmed", "source": "code", "unit_ids": [ko["id"], en["id"]],
    }


# ── 입구 2 한 번에 확정 ───────────────────────────────────────────────────────


def _setup_match_pair(client: TestClient) -> tuple[int, int, int, dict, dict, list[dict]]:
    """옛 문서의 한/영 제안 짝과 같은 글자의 입구 2 새 문서 — (묶음, 옛 문서, SOP, 한글, 영어, 같은 글자 후보)."""
    fx = _setup_match(client, p(KO_ON) + p(EN_ON), p(KO_ON) + p(EN_ON))
    ko, en = find_unit(fx.old_view, KO_ON), find_unit(fx.old_view, EN_ON)
    document_id = fx.old_view["document"]["id"]
    pair = _pair_of(client, fx.bundle_id, document_id, ko)
    assert pair is not None and pair["status"] == "suggested", fx.old_view["pairs"]
    return fx.bundle_id, document_id, fx.sop_id, ko, en, _get_candidates(client, fx.bundle_id)


def _confirm_identical(client: TestClient, bundle_id: int, candidates: list[dict], unit: dict) -> None:
    body = {"identical": [_identical_in(c) for c in candidates if c["unit_id"] == unit["id"]], "new": []}
    assert len(body["identical"]) == 1, candidates
    response = _bulk_confirm(client, bundle_id, body)
    assert response.status_code == 200, response.text


def test_bulk_match_confirms_the_pair_when_both_land_in_one_new_doc(client: TestClient) -> None:
    bundle_id, document_id, _sop_id, ko, en, candidates = _setup_match_pair(client)

    _confirm_identical(client, bundle_id, candidates, ko)
    assert _pair_of(client, bundle_id, document_id, ko)["status"] == "suggested"
    _confirm_identical(client, bundle_id, candidates, en)

    assert _pair_of(client, bundle_id, document_id, ko)["status"] == "confirmed"


def test_bulk_match_dissolves_the_pair_when_the_mate_went_elsewhere(client: TestClient) -> None:
    bundle_id, document_id, sop_id, ko, en, candidates = _setup_match_pair(client)
    saved = save_group(client, bundle_id, _body([_unit_in(ko)], [_target("ko", sop_id, [ko], slot_key="purpose")]))
    assert saved.status_code == 200, saved.text

    _confirm_identical(client, bundle_id, candidates, en)

    assert _pair_of(client, bundle_id, document_id, ko) is None


# ── 짝을 맺는 길 ──────────────────────────────────────────────────────────────


def _unit_decision(client: TestClient, bundle_id: int, unit: dict) -> tuple[str, str]:
    """(상태, 처분)."""
    response = client.get(f"/api/bundles/{bundle_id}/units", params={"limit": 1000}, headers=AUTHOR)
    assert response.status_code == 200, response.text
    (row,) = [row for row in response.json()["items"] if row["unit_id"] == unit["id"]]
    return row["status"], row["decision"]["disposition"]


def _setup_unpaired(client: TestClient) -> tuple[Fixture, dict, dict]:
    """한/영 제목의 제안 짝을 사람이 풀어 둔 묶음 — 두 제목은 짝 없이 따로 줄이다."""
    fx, ko, en, pair_id = _setup_pair(client)
    assert _delete(client, fx, pair_id).status_code == 200
    return fx, ko, en


def _set_layout(client: TestClient, fx: Fixture, layout: str) -> None:
    revision = get_view(client, fx.bundle_id, fx.doc["id"])["document"]["revision"]
    response = client.patch(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc['id']}",
        json={"revision": revision, "language_layout": layout}, headers=AUTHOR,
    )
    assert response.status_code == 200, response.text


def test_pair_by_hand_is_refused_when_members_were_sent_to_different_places(client: TestClient) -> None:
    """짝을 나중에 맺는 길도 한 줄의 처분이 하나인 규칙을 지킨다 — 한쪽은 SOP로, 다른 쪽은 삭제로 보낸 두 줄은 짝이 될 수 없다."""
    fx, ko, en = _setup_unpaired(client)
    save_group(client, fx.bundle_id, _body([_unit_in(ko)], [_target("ko", fx.sop_id, [ko], slot_key="purpose")]))
    _dispose(client, fx.bundle_id, [en])

    response = _create(client, fx, [ko, en])

    assert _code(response) == (409, "pair_fates_differ")
    assert response.json()["detail"]["unit_ids"] == [ko["id"], en["id"]]
    assert _pair_of(client, fx.bundle_id, fx.doc["id"], ko) is None
    assert _unit_decision(client, fx.bundle_id, ko) == ("confirmed", "assigned")
    assert _unit_decision(client, fx.bundle_id, en) == ("confirmed", "delete")


def test_pair_by_hand_over_one_fate_is_one_confirmed_row(client: TestClient) -> None:
    fx, ko, en = _setup_unpaired(client)
    for unit in (ko, en):
        saved = save_group(client, fx.bundle_id, _body([_unit_in(unit)], [_target("t", fx.sop_id, [unit], slot_key="purpose")]))
        assert saved.status_code == 200, saved.text
    before = get_bundle(client, fx.bundle_id)["progress"]

    response = _create(client, fx, [ko, en])

    assert response.status_code == 201, response.text
    assert response.json()["pair"]["status"] == "confirmed"
    after = get_bundle(client, fx.bundle_id)["progress"]
    assert (after["total"], after["confirmed"]) == (before["total"] - 1, before["confirmed"] - 1)
    assert [action for action, _, _ in _load_pair_events(fx.bundle_id)] == ["pair.delete", "pair.create"]
    assert {_unit_decision(client, fx.bundle_id, unit) for unit in (ko, en)} == {("confirmed", "assigned")}


def test_code_pairs_follow_the_fates_of_judged_units(client: TestClient) -> None:
    """배치를 바꿔 코드 짝을 다시 제안할 때 — 다른 곳으로 보낸 두 줄은 짝짓지 않고, 같은 곳으로 확정한 두 줄의 짝은 바로 확정이다."""
    fx, ko, en = _setup_unpaired(client)
    save_group(client, fx.bundle_id, _body([_unit_in(ko)], [_target("ko", fx.sop_id, [ko], slot_key="purpose")]))
    save_group(client, fx.bundle_id, _body([_unit_in(en)], [_target("en", fx.wi_id, [en], wi_step=1, wi_part="instruction")]))

    _set_layout(client, fx, "ko_en_separate")
    _set_layout(client, fx, "ko_en_interleaved")

    assert _pair_of(client, fx.bundle_id, fx.doc["id"], ko) is None
    assert _pair_of(client, fx.bundle_id, fx.doc["id"], en) is None

    (en_target,) = get_group_by_unit(client, fx.bundle_id, en["id"])["targets"]
    moved = {"key": "en", "target_doc_id": fx.sop_id, "id": en_target["id"], "revision": en_target["revision"],
             "slot_key": "purpose", "source_unit_ids": [en["id"]]}
    assert save_group(client, fx.bundle_id, _body([_unit_in(en, 2)], [moved])).status_code == 200
    _set_layout(client, fx, "ko_en_separate")
    _set_layout(client, fx, "ko_en_interleaved")

    pair = _pair_of(client, fx.bundle_id, fx.doc["id"], ko)
    assert pair is not None and (pair["status"], pair["source"], pair["unit_ids"]) == (
        "confirmed", "code", [ko["id"], en["id"]],
    )
