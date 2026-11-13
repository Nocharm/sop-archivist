"""Assign 되돌리기 — 판단 상태 스냅숏의 덤프·비교·되쓰기 (합성 DOCX를 올린 묶음으로 본다)."""

from typing import NamedTuple

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop import decision_steps
from app.sop.decision_steps import Snapshot, diff_states, dump_bundle_state, find_mismatches, write_state
from app.sop.models import DecisionStep, TargetSentence, UnitEdit
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_bundle, get_view, put_tobe, save_group, upload

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


# ── 저장마다 단계 기록 ───────────────────────────────────────────────────────

UNDO = {"session": "s1"}
TEXT_A = "합성 장비를 켠다."
TEXT_B = "합성 시료를 넣는다."
TEXT_C = "합성 라벨을 붙인다."


class RichFixture(NamedTuple):
    bundle_id: int
    sop_id: int
    old_doc_id: int
    a: dict
    b: dict
    c: dict


def _setup_rich(client: TestClient) -> RichFixture:
    """옛 문서(A·B·C)와 입구 2 새 문서(B·C) — B·C는 같은 글자 후보가 된다."""
    bundle = create_bundle(client, is_synthetic=True)
    response = put_tobe(client, bundle["id"], TOBE_DOCS)
    assert response.status_code == 200, response.text
    sop_id = response.json()["docs"][0]["id"]
    old = upload(client, bundle["id"], build_docx(p("1. 목적", "Heading1") + p(TEXT_A) + p(TEXT_B) + p(TEXT_C)), OLD_NAME)
    assert old.status_code == 201, old.text
    new = upload(
        client, bundle["id"], build_docx(p(TEXT_B) + p(TEXT_C)), "SYNTHETIC_SOP-U_Undo.docx", side="new", doc_type="sop"
    )
    assert new.status_code == 201, new.text
    view = get_view(client, bundle["id"], old.json()["id"])
    return RichFixture(
        bundle["id"], sop_id, old.json()["id"], find_unit(view, TEXT_A), find_unit(view, TEXT_B), find_unit(view, TEXT_C)
    )


def _confirm_unit(client: TestClient, fx: RichFixture, unit: dict, revision: int = 1, undo: dict | None = None) -> None:
    target = {
        "key": "t", "target_doc_id": fx.sop_id, "source_unit_ids": [unit["id"]],
        "slot_key": "responsibilities", "text": unit["text"], "change_type": "as_is",
    }
    body: dict = {
        "action": "confirm", "units": [{"unit_id": unit["id"], "revision": revision, "disposition": "assigned"}],
        "targets": [target],
    }
    if undo is not None:
        body["undo"] = undo
    response = save_group(client, fx.bundle_id, body)
    assert response.status_code == 200, response.text


def _clear(client: TestClient, bundle_id: int, unit: dict, revision: int, undo: dict | None = None) -> None:
    body: dict = {"unit_id": unit["id"], "revision": revision}
    if undo is not None:
        body["undo"] = undo
    response = client.post(f"/api/bundles/{bundle_id}/decisions/clear", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text


def _bulk_confirm_identical(client: TestClient, fx: RichFixture, unit: dict, undo: dict) -> None:
    response = client.get(f"/api/bundles/{fx.bundle_id}/match/identical-candidates", headers=AUTHOR)
    assert response.status_code == 200, response.text
    (candidate,) = [row for row in response.json() if row["unit_id"] == unit["id"]]
    item = {"unit_id": unit["id"], "unit_revision": 1, "target_id": candidate["target_id"], "target_revision": 1}
    confirmed = client.post(
        f"/api/bundles/{fx.bundle_id}/match/bulk-confirm", json={"identical": [item], "undo": undo}, headers=AUTHOR
    )
    assert confirmed.status_code == 200, confirmed.text


def _reset(client: TestClient, fx: RichFixture, **body: object) -> None:
    revision = get_bundle(client, fx.bundle_id)["revision"]
    response = client.post(
        f"/api/bundles/{fx.bundle_id}/decisions/reset",
        json={"revision": revision, "document_id": fx.old_doc_id, **body},
        headers=AUTHOR,
    )
    assert response.status_code == 200, response.text


def _load_steps(bundle_id: int) -> list[DecisionStep]:
    async def _load(session: AsyncSession) -> list[DecisionStep]:
        rows = await session.scalars(
            select(DecisionStep)
            .where(DecisionStep.bundle_id == bundle_id)
            .order_by(DecisionStep.session_key, DecisionStep.seq)
        )
        return list(rows)

    return run_in_session(_load)


def test_each_save_route_records_one_step(client: TestClient) -> None:
    fx = _setup_rich(client)

    _confirm_unit(client, fx, fx.a, undo={**UNDO, "op": "confirm", "focus_unit_id": fx.a["id"]})
    _clear(client, fx.bundle_id, fx.a, 2, undo=UNDO)
    deleted = client.post(
        f"/api/bundles/{fx.bundle_id}/decisions/bulk",
        json={"action": "delete", "reason": "합성 사유", "units": [{"unit_id": fx.b["id"], "revision": 1}], "undo": UNDO},
        headers=AUTHOR,
    )
    assert deleted.status_code == 200, deleted.text
    _reset(client, fx, undo={**UNDO, "scope_label": "OLD-1"})
    _bulk_confirm_identical(client, fx, fx.c, UNDO)

    steps = _load_steps(fx.bundle_id)
    assert [step.op for step in steps] == ["confirm", "clear", "delete", "reset", "confirm_identical"]
    assert [step.seq for step in steps] == [1, 2, 3, 4, 5]
    assert {step.state for step in steps} == {"applied"} and {step.kind for step in steps} == {"snapshot"}
    assert steps[0].unit_ids == [fx.a["id"]] and steps[0].focus == {"unit_id": fx.a["id"], "target_id": None}
    assert steps[2].unit_ids == [fx.b["id"]]
    assert steps[3].scope_label == "OLD-1"
    assert steps[0].after["unit_decisions"][str(fx.a["id"])]["status"] == "confirmed"
    assert steps[0].before["unit_decisions"][str(fx.a["id"])]["status"] == "unassigned"


def test_save_without_undo_meta_records_nothing(client: TestClient) -> None:
    fx = _setup_rich(client)

    _confirm_unit(client, fx, fx.a)
    _clear(client, fx.bundle_id, fx.a, 2)

    assert _load_steps(fx.bundle_id) == []


def test_reset_dry_run_records_nothing(client: TestClient) -> None:
    fx = _setup_rich(client)
    _confirm_unit(client, fx, fx.a)

    _reset(client, fx, dry_run=True, undo=UNDO)

    assert _load_steps(fx.bundle_id) == []


def test_bulk_confirm_batches_merge_into_one_step(client: TestClient) -> None:
    fx = _setup_rich(client)
    undo = {**UNDO, "step_key": "same-text-1"}

    _bulk_confirm_identical(client, fx, fx.b, undo)
    _bulk_confirm_identical(client, fx, fx.c, undo)

    (step,) = _load_steps(fx.bundle_id)
    assert step.op == "confirm_identical"
    assert set(step.after["unit_decisions"]) == {str(fx.b["id"]), str(fx.c["id"])}
    assert set(step.before["unit_decisions"]) == {str(fx.b["id"]), str(fx.c["id"])}
    assert step.unit_ids == sorted([fx.b["id"], fx.c["id"]])


def test_clear_requests_with_same_step_key_merge(client: TestClient) -> None:
    fx = _setup_rich(client)
    _confirm_unit(client, fx, fx.a)
    _confirm_unit(client, fx, fx.b)
    undo = {**UNDO, "step_key": "clear-1"}

    _clear(client, fx.bundle_id, fx.a, 2, undo=undo)
    _clear(client, fx.bundle_id, fx.b, 2, undo=undo)

    (step,) = _load_steps(fx.bundle_id)
    assert step.op == "clear"
    assert {row["status"] for row in step.before["unit_decisions"].values()} == {"confirmed"}
    assert {row["status"] for row in step.after["unit_decisions"].values()} == {"unassigned"}
    assert len(step.before["target_sentences"]) == 2 and step.after["target_sentences"] == {}


def test_merged_step_drops_rows_created_then_deleted(client: TestClient) -> None:
    """같은 단계 안에서 만들었다 지운 새 문장은 처음에 없었으므로 양쪽 모두에 남지 않는다."""
    fx = _setup_rich(client)
    undo = {**UNDO, "step_key": "m"}

    _confirm_unit(client, fx, fx.a, undo={**undo, "op": "confirm"})
    _clear(client, fx.bundle_id, fx.a, 2, undo=undo)

    (step,) = _load_steps(fx.bundle_id)
    assert step.op == "confirm"
    for name in ("target_sentences", "target_sources"):
        assert step.before[name] == {} and step.after[name] == {}
    key = str(fx.a["id"])
    assert step.before["unit_decisions"][key]["revision"] == 1
    assert step.after["unit_decisions"][key]["revision"] == 3


def test_new_session_prunes_old_session(client: TestClient) -> None:
    fx = _setup_rich(client)

    _confirm_unit(client, fx, fx.a, undo={"session": "s1"})
    _confirm_unit(client, fx, fx.b, undo={"session": "s2"})

    steps = _load_steps(fx.bundle_id)
    assert [(step.session_key, step.seq) for step in steps] == [("s2", 1)]


def test_step_cap_drops_oldest(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    fx = _setup_rich(client)
    monkeypatch.setattr(decision_steps, "MAX_STEPS_PER_SESSION", 3)

    _confirm_unit(client, fx, fx.a, undo=UNDO)
    _clear(client, fx.bundle_id, fx.a, 2, undo=UNDO)
    _confirm_unit(client, fx, fx.a, revision=3, undo=UNDO)
    _clear(client, fx.bundle_id, fx.a, 4, undo=UNDO)

    assert [step.seq for step in _load_steps(fx.bundle_id)] == [2, 3, 4]


def test_new_save_drops_undone_steps(client: TestClient) -> None:
    fx = _setup_rich(client)
    _confirm_unit(client, fx, fx.a, undo=UNDO)
    (first,) = _load_steps(fx.bundle_id)

    async def _mark_undone(session: AsyncSession) -> None:
        step = await session.get(DecisionStep, first.id)
        assert step is not None
        step.state = "undone"
        await session.commit()

    run_in_session(_mark_undone)
    _confirm_unit(client, fx, fx.b, undo=UNDO)

    assert [(step.seq, step.state) for step in _load_steps(fx.bundle_id)] == [(1, "applied")]


def test_assign_cut_records_unit_edit_step(client: TestClient) -> None:
    fx = _setup_rich(client)
    revision = get_view(client, fx.bundle_id, fx.old_doc_id)["document"]["revision"]
    body = {
        "revision": revision, "op": {"type": "split", "unit_id": fx.a["id"], "at": 3},
        "undo": {**UNDO, "focus_unit_id": fx.a["id"]},
    }

    response = client.post(f"/api/bundles/{fx.bundle_id}/documents/{fx.old_doc_id}/edits", json=body, headers=AUTHOR)

    assert response.status_code == 200, response.text

    async def _latest_edit_id(session: AsyncSession) -> int | None:
        return await session.scalar(
            select(UnitEdit.id).where(UnitEdit.document_id == fx.old_doc_id).order_by(UnitEdit.seq.desc()).limit(1)
        )

    (step,) = _load_steps(fx.bundle_id)
    assert (step.kind, step.op, step.document_id) == ("unit_edit", "cut", fx.old_doc_id)
    assert step.unit_edit_id == run_in_session(_latest_edit_id)
    assert step.unit_ids == [fx.a["id"]]
