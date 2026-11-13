"""Assign 되돌리기 — 판단 상태 스냅숏의 덤프·비교·되쓰기 (합성 DOCX를 올린 묶음으로 본다)."""

from typing import NamedTuple

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.decision_steps import Snapshot, diff_states, dump_bundle_state, find_mismatches, write_state
from app.sop.models import TargetSentence
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_view, put_tobe, save_group, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-1_Undo.docx"
STORAGE = "합성 시료는 4 ℃에서 보관한다."
OLD_BODY = p("1. 목적", "Heading1") + p(STORAGE)
TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]


class Fixture(NamedTuple):
    bundle_id: int
    sop_id: int
    unit: dict


def _setup(client: TestClient) -> Fixture:
    bundle = create_bundle(client, is_synthetic=True)
    response = put_tobe(client, bundle["id"], TOBE_DOCS)
    assert response.status_code == 200, response.text
    sop_id = response.json()["docs"][0]["id"]
    uploaded = upload(client, bundle["id"], build_docx(OLD_BODY), OLD_NAME)
    assert uploaded.status_code == 201, uploaded.text
    view = get_view(client, bundle["id"], uploaded.json()["id"])
    return Fixture(bundle["id"], sop_id, find_unit(view, STORAGE))


def _confirm(client: TestClient, fx: Fixture) -> None:
    target = {
        "key": "t", "target_doc_id": fx.sop_id, "source_unit_ids": [fx.unit["id"]],
        "slot_key": "responsibilities", "text": STORAGE, "change_type": "as_is",
    }
    body = {"action": "confirm", "units": [{"unit_id": fx.unit["id"], "revision": 1, "disposition": "assigned"}],
            "targets": [target]}
    response = save_group(client, fx.bundle_id, body)
    assert response.status_code == 200, response.text


def _dump(bundle_id: int) -> Snapshot:
    return run_in_session(lambda session: dump_bundle_state(session, bundle_id))


def _write(bundle_id: int, target: Snapshot, other: Snapshot) -> None:
    async def _run(session: AsyncSession) -> None:
        await write_state(session, bundle_id, target, await dump_bundle_state(session, bundle_id), other=other)
        await session.commit()

    run_in_session(_run)


def _load_target(target_id: int) -> TargetSentence | None:
    async def _run(session: AsyncSession) -> TargetSentence | None:
        return await session.scalar(select(TargetSentence).where(TargetSentence.id == target_id))

    return run_in_session(_run)


def test_diff_keeps_only_changed_rows(client: TestClient) -> None:
    fx = _setup(client)
    before = _dump(fx.bundle_id)

    _confirm(client, fx)
    before_d, after_d = diff_states(before, _dump(fx.bundle_id))

    a_id = fx.unit["id"]
    assert set(after_d["unit_decisions"]) == {str(a_id)}
    assert after_d["unit_decisions"][str(a_id)]["status"] == "confirmed"
    assert before_d["unit_decisions"][str(a_id)]["status"] == "unassigned"
    assert after_d["target_sentences"] and not before_d["target_sentences"]
    assert len(after_d["target_sources"]) == 1 and not before_d["target_sources"]
    assert not after_d["unit_pairs"] and not after_d["ai_suggestions"]


def test_write_state_restores_deleted_target_with_same_id(client: TestClient) -> None:
    fx = _setup(client)
    _confirm(client, fx)
    s1 = _dump(fx.bundle_id)
    (target_key,) = s1["target_sentences"]
    revision_at_delete = s1["target_sentences"][target_key]["revision"]

    cleared = client.post(
        f"/api/bundles/{fx.bundle_id}/decisions/clear", json={"unit_id": fx.unit["id"], "revision": 2}, headers=AUTHOR
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["deleted_target_ids"] == [int(target_key)]
    before_d, after_d = diff_states(s1, _dump(fx.bundle_id))
    _write(fx.bundle_id, before_d, after_d)

    restored = _load_target(int(target_key))
    assert restored is not None
    assert restored.confirmed_text == STORAGE
    assert restored.revision == revision_at_delete + 1
    now = _dump(fx.bundle_id)
    assert find_mismatches(before_d, now, other=after_d) == []
    assert now["unit_decisions"][str(fx.unit["id"])]["status"] == "confirmed"
    assert now["unit_decisions"][str(fx.unit["id"])]["revision"] == 4  # 확정 2 → 비우기 3 → 되쓰기 4
    assert set(now["target_sources"]) == set(s1["target_sources"])


def test_write_state_deletes_rows_only_on_the_other_side(client: TestClient) -> None:
    fx = _setup(client)
    s0 = _dump(fx.bundle_id)
    _confirm(client, fx)
    before_d, after_d = diff_states(s0, _dump(fx.bundle_id))

    _write(fx.bundle_id, before_d, after_d)

    now = _dump(fx.bundle_id)
    assert now["target_sentences"] == {} and now["target_sources"] == {}
    assert now["unit_decisions"][str(fx.unit["id"])]["status"] == "unassigned"
    assert find_mismatches(before_d, now, other=after_d) == []
    assert find_mismatches(after_d, now, other=before_d) != []


def test_find_mismatches_ignores_revision_only_changes(client: TestClient) -> None:
    fx = _setup(client)
    _confirm(client, fx)
    expected = _dump(fx.bundle_id)
    key = str(fx.unit["id"])

    bumped = {**expected, "unit_decisions": {key: {**expected["unit_decisions"][key], "revision": 99}}}
    changed = {**expected, "unit_decisions": {key: {**expected["unit_decisions"][key], "status": "on_hold"}}}

    assert find_mismatches(bumped, expected) == []
    assert find_mismatches(changed, expected) == [fx.unit["id"]]
