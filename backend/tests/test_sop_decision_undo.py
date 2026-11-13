"""Assign 되돌리기 — 판단 상태 스냅숏의 덤프·비교·되쓰기 (합성 DOCX를 올린 묶음으로 본다)."""

from collections.abc import Callable
from typing import NamedTuple

import httpx2
import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.sop import decision_steps
from app.sop.decision_steps import Snapshot, diff_states, dump_bundle_state, find_mismatches, write_state
from app.sop.models import AiSuggestion, Bundle, BundleEvent, DecisionStep, TargetSentence, UnitEdit
from tests.access_helpers import run_in_session, update_row
from tests.ai_fixtures import (
    AI_EN_1,
    AI_KO_1,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    find_ids,
    make_ai_bundle,
    queue_units,
    read_decision,
    read_rows,
    run_jobs,
    use_reply,
)
from tests.docx_factory import build_docx, p
from tests.fake_ai import FakeAi
from tests.sop_helpers import (
    AUTHOR,
    REVIEWER,
    assign_as_is,
    create_bundle,
    find_unit,
    get_bundle,
    get_group_by_unit,
    get_view,
    put_tobe,
    save_group,
    set_members,
    upload,
)
from tests.test_sop_decisions import _body, _target, _unit_in
from tests.test_sop_decisions import NA_SLOTS as DECISIONS_NA_SLOTS
from tests.test_sop_decisions import TOBE_DOCS as DECISIONS_TOBE_DOCS
from tests.test_sop_decisions import WI_STEPS as DECISIONS_WI_STEPS
from tests.test_sop_decisions import _setup as _setup_decisions
from tests.test_sop_pair_settle import EN_HEAD, KO_HEAD

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


# ── 되돌리기·다시 하기 ───────────────────────────────────────────────────────

OTHER_AUTHOR = REVIEWER  # 아래 시험에서 작성자로 넣는다
DECISION_ROUTES = {
    "/api/bundles/{bundle_id}/groups/save",
    "/api/bundles/{bundle_id}/decisions/bulk",
    "/api/bundles/{bundle_id}/decisions/clear",
    "/api/bundles/{bundle_id}/decisions/reset",
    "/api/bundles/{bundle_id}/match/bulk-confirm",
    "/api/bundles/{bundle_id}/decisions/undo",
    "/api/bundles/{bundle_id}/decisions/redo",
}


def assert_same_state(actual: Snapshot, expected: Snapshot) -> None:
    """두 덤프가 revision·updated_at만 빼고 같다."""
    def _strip(state: Snapshot) -> Snapshot:
        return {
            name: {key: {col: v for col, v in row.items() if col not in ("revision", "updated_at")} for key, row in rows.items()}
            for name, rows in state.items()
        }

    assert _strip(actual) == _strip(expected)


def _undo(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR, session: str = "s1") -> httpx2.Response:
    return client.post(f"/api/bundles/{bundle_id}/decisions/undo", json={"session": session}, headers=headers)


def _redo(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR, session: str = "s1") -> httpx2.Response:
    return client.post(f"/api/bundles/{bundle_id}/decisions/redo", json={"session": session}, headers=headers)


def _ok(response: httpx2.Response) -> dict:
    assert response.status_code == 200, response.text
    return response.json()


def _save_rich(client: TestClient, fx: RichFixture, body: dict, undo: dict | None = UNDO) -> dict:
    if undo is not None:
        body = {**body, "undo": undo}
    return _ok(save_group(client, fx.bundle_id, body))


def _hold_unit(client: TestClient, fx: RichFixture, unit: dict, undo: dict | None = UNDO) -> None:
    target = {
        "key": "t", "target_doc_id": fx.sop_id, "source_unit_ids": [unit["id"]],
        "slot_key": "responsibilities", "text": unit["text"], "change_type": "as_is",
    }
    _save_rich(client, fx, {
        "action": "hold", "hold_reason": "합성 보류",
        "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"}], "targets": [target],
    }, undo)


def _link_two(client: TestClient, fx: RichFixture, undo: dict | None = UNDO) -> None:
    """A·B 두 Unit을 새 문장 하나로 잇는다."""
    target = {
        "key": "t", "target_doc_id": fx.sop_id, "source_unit_ids": [fx.a["id"], fx.b["id"]],
        "slot_key": "responsibilities", "text": f"{TEXT_A} {TEXT_B}", "change_type": "as_is",
    }
    units = [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"} for unit in (fx.a, fx.b)]
    _save_rich(client, fx, {"action": "confirm", "units": units, "targets": [target]}, undo)


def _new_doc_target(client: TestClient, fx: RichFixture, unit: dict) -> int:
    response = client.get(f"/api/bundles/{fx.bundle_id}/match/identical-candidates", headers=AUTHOR)
    (candidate,) = [row for row in _ok(response) if row["unit_id"] == unit["id"]]
    return candidate["target_id"]


def _bulk(client: TestClient, fx: RichFixture, action: str, undo: dict | None = UNDO) -> None:
    body: dict = {
        "action": action, "reason": "합성 사유", "units": [{"unit_id": u["id"], "revision": 1} for u in (fx.a, fx.b)],
    }
    if action == "move_external":
        body["move_target_code"] = "SOP-OTHER"
    if undo is not None:
        body["undo"] = undo
    _ok(client.post(f"/api/bundles/{fx.bundle_id}/decisions/bulk", json=body, headers=AUTHOR))


def _case_rich(client: TestClient, case: str) -> tuple[int, Callable[[], None]]:
    fx = _setup_rich(client)
    if case == "confirm":
        return fx.bundle_id, lambda: _confirm_unit(client, fx, fx.a, undo={**UNDO, "op": "confirm"})
    if case == "hold":
        return fx.bundle_id, lambda: _hold_unit(client, fx, fx.a)
    if case == "link":
        return fx.bundle_id, lambda: _link_two(client, fx)
    if case == "mark_new":
        target_id = _new_doc_target(client, fx, fx.b)
        body = {"action": "confirm", "units": [], "targets": [
            {"key": "t", "id": target_id, "revision": 1, "source_unit_ids": [], "remark": "합성 메모"},
        ]}
        return fx.bundle_id, lambda: _save_rich(client, fx, body, {**UNDO, "op": "mark_new"})
    if case == "link_source":
        target_id = _new_doc_target(client, fx, fx.b)
        body = {
            "action": "confirm", "units": [{"unit_id": fx.b["id"], "revision": 1, "disposition": "assigned"}],
            "targets": [{"key": "t", "id": target_id, "revision": 1, "source_unit_ids": [fx.b["id"]]}],
        }
        return fx.bundle_id, lambda: _save_rich(client, fx, body, {**UNDO, "op": "link_source"})
    if case == "clear_cascade":
        _link_two(client, fx, undo=None)
        return fx.bundle_id, lambda: _clear(client, fx.bundle_id, fx.a, 2, undo=UNDO)
    if case in ("bulk_delete", "bulk_move"):
        return fx.bundle_id, lambda: _bulk(client, fx, "delete" if case == "bulk_delete" else "move_external")
    if case in ("reset_document", "reset_bundle"):
        _confirm_unit(client, fx, fx.a)
        _hold_unit(client, fx, fx.b, undo=None)
        scope = {} if case == "reset_document" else {"document_id": None}
        return fx.bundle_id, lambda: _reset(client, fx, undo=UNDO, **scope)
    assert case == "confirm_identical_batched"

    def _two_batches() -> None:
        undo = {**UNDO, "step_key": "same-text"}
        _bulk_confirm_identical(client, fx, fx.b, undo)
        _bulk_confirm_identical(client, fx, fx.c, undo)

    return fx.bundle_id, _two_batches


def _case_table_and_pair(client: TestClient, case: str) -> tuple[int, Callable[[], None]]:
    """표(표 새 문장 + 칸 새 문장)와 한/영 짝이 있는 묶음 — 부모·자식 순서와 짝 행 되쓰기를 본다."""
    fx = _setup_decisions(client)
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    if case == "table_confirm":
        return fx.bundle_id, lambda: assign_as_is(
            client, fx.bundle_id, table, fx.sop_id, slot_key="general_requirements", undo=UNDO
        )
    if case == "table_clear":
        assign_as_is(client, fx.bundle_id, table, fx.sop_id, slot_key="general_requirements")
        return fx.bundle_id, lambda: _clear(client, fx.bundle_id, table, 2, undo=UNDO)
    assert case == "pair_confirm"
    ko, en = find_unit(fx.view, KO_HEAD), find_unit(fx.view, EN_HEAD)
    targets = [_target("ko", fx.sop_id, [ko], slot_key="purpose"), _target("en", fx.sop_id, [en], slot_key="purpose")]
    body = _body([_unit_in(ko), _unit_in(en)], targets, undo=UNDO)

    def _confirm_pair() -> None:
        _ok(save_group(client, fx.bundle_id, body))

    return fx.bundle_id, _confirm_pair


@pytest.mark.parametrize(
    "case",
    ["confirm", "hold", "link", "mark_new", "link_source", "clear_cascade", "bulk_delete", "bulk_move",
     "reset_document", "reset_bundle", "confirm_identical_batched", "table_confirm", "table_clear", "pair_confirm"],
)
def test_undo_restores_and_redo_reapplies(client: TestClient, case: str) -> None:
    build = _case_table_and_pair if case in ("table_confirm", "table_clear", "pair_confirm") else _case_rich
    bundle_id, act = build(client, case)
    s0 = _dump(bundle_id)
    act()
    s1 = _dump(bundle_id)
    assert s1 != s0

    undone = _ok(_undo(client, bundle_id))
    assert_same_state(_dump(bundle_id), s0)
    assert (undone["can_undo"], undone["can_redo"]) == (False, True)

    redone = _ok(_redo(client, bundle_id))
    assert_same_state(_dump(bundle_id), s1)
    assert (redone["can_undo"], redone["can_redo"]) == (True, False)
    assert redone["op"] == undone["op"]

    _ok(_undo(client, bundle_id))  # 두 번째 왕복도 맞물린다
    assert_same_state(_dump(bundle_id), s0)


def test_undo_raises_revisions_and_logs_event(client: TestClient) -> None:
    fx = _setup_rich(client)
    _confirm_unit(client, fx, fx.a, undo={**UNDO, "op": "confirm", "focus_unit_id": fx.a["id"]})

    result = _ok(_undo(client, fx.bundle_id))

    assert result == {
        "op": "confirm", "unit_ids": [fx.a["id"]], "focus_unit_id": fx.a["id"], "focus_target_id": None,
        "scope_label": None, "can_undo": False, "can_redo": True,
    }
    assert _dump(fx.bundle_id)["unit_decisions"][str(fx.a["id"])]["revision"] == 3  # 확정 2 → 되돌림 3
    stale = {"action": "confirm", "units": [{"unit_id": fx.a["id"], "revision": 2, "disposition": "assigned"}],
             "targets": []}
    assert save_group(client, fx.bundle_id, stale).status_code == 409
    events = [(event.action, event.reason, event.target_ids) for event in _load_events(fx.bundle_id)]
    assert ("decision.undo", "confirm", [fx.a["id"]]) in events


def _load_events(bundle_id: int) -> list[BundleEvent]:
    async def _load(session: AsyncSession) -> list[BundleEvent]:
        return list(await session.scalars(select(BundleEvent).where(BundleEvent.bundle_id == bundle_id)))

    return run_in_session(_load)


@pytest.mark.usefixtures("clean_ai_jobs")
def test_undo_brings_back_ai_suggested_and_adoption(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    ko, en = find_ids(client, bundle, AI_KO_1, AI_EN_1)
    use_reply(fake_ai)
    queue_units(client, bundle.id, [ko, en])
    run_jobs()
    assert read_decision(ko).status == "ai_suggested"
    group = get_group_by_unit(client, bundle.id, ko)
    body = {
        "action": "confirm",
        "units": [{"unit_id": u["unit_id"], "revision": u["decision"]["revision"], "disposition": "assigned"}
                  for u in group["units"]],
        "targets": [
            {"key": str(t["id"]), "id": t["id"], "revision": t["revision"], "slot_key": t["slot_key"],
             "wi_step": t["wi_step"], "wi_part": t["wi_part"], "source_unit_ids": t["source_unit_ids"]}
            for t in group["targets"]
        ],
        "undo": UNDO,
    }
    s0 = _dump(bundle.id)
    _ok(save_group(client, bundle.id, body))
    assert {row.adoption for row in read_rows(AiSuggestion)} - {None}

    _ok(_undo(client, bundle.id))

    assert read_decision(ko).status == "ai_suggested"
    assert {row.adoption for row in read_rows(AiSuggestion)} == {None}
    assert_same_state(_dump(bundle.id), s0)


def test_undo_brings_back_deleted_new_sentence_same_id(client: TestClient) -> None:
    fx = _setup_rich(client)
    _confirm_unit(client, fx, fx.a)
    (target_key,) = {
        str(row["target_id"]) for row in _dump(fx.bundle_id)["target_sources"].values() if row["unit_id"] == fx.a["id"]
    }
    _clear(client, fx.bundle_id, fx.a, 2, undo=UNDO)
    assert _load_target(int(target_key)) is None

    _ok(_undo(client, fx.bundle_id))

    restored = _load_target(int(target_key))
    assert restored is not None and restored.confirmed_text == TEXT_A


def test_undo_restores_dissolved_pair(client: TestClient) -> None:
    fx = _setup_decisions(client)
    ko, en = find_unit(fx.view, KO_HEAD), find_unit(fx.view, EN_HEAD)
    (pair,) = [pair for pair in fx.view["pairs"] if ko["id"] in pair["unit_ids"]]
    revision = get_view(client, fx.bundle_id, fx.doc["id"])["document"]["revision"]
    body = _body([_unit_in(ko)], [_target("ko", fx.sop_id, [ko], slot_key="purpose")],
                 release_unit_ids=[en["id"]], undo=UNDO)
    assert _ok(save_group(client, fx.bundle_id, body))["pairs_dissolved"] == [pair["id"]]

    _ok(_undo(client, fx.bundle_id))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert [p for p in view["pairs"] if p["id"] == pair["id"]] == [pair]
    assert view["document"]["revision"] > revision + 1  # 풀기 +1, 되돌림 +1


def test_undo_refused_when_someone_changed_the_line(client: TestClient) -> None:
    fx = _setup_rich(client)
    assert set_members(client, fx.bundle_id, [("qa.member", "author"), ("qa.lead", "author")]).status_code == 200
    _confirm_unit(client, fx, fx.a, undo=UNDO)
    group = get_group_by_unit(client, fx.bundle_id, fx.a["id"], headers=OTHER_AUTHOR)
    (target,) = group["targets"]
    held = save_group(client, fx.bundle_id, {
        "action": "hold", "hold_reason": "합성 보류",
        "units": [{"unit_id": fx.a["id"], "revision": 2, "disposition": "assigned"}],
        "targets": [{"key": "t", "id": target["id"], "revision": target["revision"], "slot_key": target["slot_key"],
                     "source_unit_ids": [fx.a["id"]]}],
    }, headers=OTHER_AUTHOR)
    assert held.status_code == 200, held.text
    before = _dump(fx.bundle_id)

    response = _undo(client, fx.bundle_id)

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == {"code": "undo_conflict", "unit_ids": [fx.a["id"]]}
    assert _dump(fx.bundle_id) == before
    assert _undo(client, fx.bundle_id).status_code == 409  # 기록은 남아 다시 눌러도 같은 이유


def _split_a(client: TestClient, fx: RichFixture, *, confirm: bool = False, undo: dict | None = None) -> dict:
    revision = get_view(client, fx.bundle_id, fx.old_doc_id)["document"]["revision"]
    body: dict = {"revision": revision, "op": {"type": "split", "unit_id": fx.a["id"], "at": 3}, "confirm": confirm}
    if undo is not None:
        body["undo"] = undo
    return _ok(client.post(f"/api/bundles/{fx.bundle_id}/documents/{fx.old_doc_id}/edits", json=body, headers=AUTHOR))


def test_undo_refused_after_split_detach(client: TestClient) -> None:
    fx = _setup_rich(client)
    _confirm_unit(client, fx, fx.a, undo=UNDO)
    _split_a(client, fx, confirm=True)
    before = _dump(fx.bundle_id)

    response = _undo(client, fx.bundle_id)

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "undo_conflict"
    assert fx.a["id"] in response.json()["detail"]["unit_ids"]
    assert _dump(fx.bundle_id) == before


def test_undo_clear_after_cut_undone(client: TestClient) -> None:
    """확정 → 비우기 → 자르기 → undo(자르기) → undo(비우기) — revision만 바뀐 행이 앞 단계를 막지 않는다."""
    fx = _setup_rich(client)
    _confirm_unit(client, fx, fx.a, undo=UNDO)
    _clear(client, fx.bundle_id, fx.a, 2, undo=UNDO)
    _split_a(client, fx, undo={**UNDO, "focus_unit_id": fx.a["id"]})

    assert _ok(_undo(client, fx.bundle_id))["op"] == "cut"
    assert _ok(_undo(client, fx.bundle_id))["op"] == "clear"

    assert _dump(fx.bundle_id)["unit_decisions"][str(fx.a["id"])]["status"] == "confirmed"


def test_cut_undo_with_assigned_piece_returns_confirm_required(client: TestClient) -> None:
    fx = _setup_rich(client)
    result = _split_a(client, fx, undo=UNDO)
    view = get_view(client, fx.bundle_id, fx.old_doc_id)
    piece = next(unit for unit in view["units"] if unit["id"] in result["created_unit_ids"])
    _confirm_unit(client, fx, piece)

    response = _undo(client, fx.bundle_id)

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "confirm_required"


def test_nothing_to_undo_and_redo(client: TestClient) -> None:
    fx = _setup_rich(client)

    assert _undo(client, fx.bundle_id).json()["detail"] == {"code": "nothing_to_undo"}
    assert _redo(client, fx.bundle_id).json()["detail"] == {"code": "nothing_to_redo"}
    _confirm_unit(client, fx, fx.a, undo=UNDO)
    assert _redo(client, fx.bundle_id).status_code == 409


def test_other_users_session_is_invisible(client: TestClient) -> None:
    fx = _setup_rich(client)
    assert set_members(client, fx.bundle_id, [("qa.member", "author"), ("qa.lead", "author")]).status_code == 200
    _confirm_unit(client, fx, fx.a, undo=UNDO)

    response = _undo(client, fx.bundle_id, headers=OTHER_AUTHOR)

    assert response.status_code == 409 and response.json()["detail"]["code"] == "nothing_to_undo"


def test_new_save_after_undo_drops_redo(client: TestClient) -> None:
    fx = _setup_rich(client)
    _confirm_unit(client, fx, fx.a, undo=UNDO)
    _ok(_undo(client, fx.bundle_id))

    _confirm_unit(client, fx, fx.b, undo=UNDO)

    assert _redo(client, fx.bundle_id).json()["detail"] == {"code": "nothing_to_redo"}


def test_undo_refused_while_in_review(client: TestClient) -> None:
    fx = _setup_rich(client)
    _confirm_unit(client, fx, fx.a, undo=UNDO)
    update_row(Bundle, fx.bundle_id, status="in_review")

    response = _undo(client, fx.bundle_id)

    assert response.status_code == 409 and response.json()["detail"]["code"] == "bundle_not_editable"


def test_every_decision_route_is_recorded() -> None:
    """판단 상태 표에 쓰는 POST 라우트 — 새 라우트가 생기면 여기서 걸려 되돌리기 기록 여부를 묻게 한다."""
    paths = {
        route.path for route in app.routes
        if isinstance(route, APIRoute) and "POST" in route.methods
        and any(part in route.path for part in ("/decisions", "/groups/save", "/match/bulk-confirm"))
    }

    assert paths == DECISION_ROUTES


# ── 되살릴 새 문장의 자리·딸린 행 ─────────────────────────────────────────────

EXTRA_DOC = {"code": "SOP-X", "title": "Synthetic extra SOP", "doc_type": "sop", "parent_code": None}


def _confirm_clear_then(client: TestClient, bundle_id: int, unit: dict, target: dict) -> None:
    """unit을 target 자리로 확정 → 비우기, 둘 다 기록한다."""
    body = {"action": "confirm", "units": [_unit_in(unit)], "targets": [target], "undo": UNDO}
    _ok(save_group(client, bundle_id, body))
    _clear(client, bundle_id, unit, 2, undo=UNDO)


def _assert_stuck_cleanly(client: TestClient, bundle_id: int, unit_ids: list[int]) -> None:
    before = _dump(bundle_id)
    for _ in range(2):  # 다시 눌러도 같은 이유로 거절되고 500이 나지 않는다
        response = _undo(client, bundle_id)
        assert response.status_code == 409, response.text
        assert response.json()["detail"] == {"code": "undo_conflict", "unit_ids": unit_ids}
        assert _dump(bundle_id) == before


def test_undo_refused_when_target_doc_was_deleted(client: TestClient) -> None:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = put_tobe(client, bundle_id, [*TOBE_DOCS, EXTRA_DOC])
    assert response.status_code == 200, response.text
    docs = {doc["code"]: doc["id"] for doc in response.json()["docs"]}
    uploaded = upload(client, bundle_id, build_docx(OLD_BODY), OLD_NAME)
    unit = find_unit(get_view(client, bundle_id, uploaded.json()["id"]), STORAGE)
    _confirm_clear_then(client, bundle_id, unit, _target("t", docs["SOP-X"], [unit], slot_key="purpose"))
    removed = put_tobe(client, bundle_id, TOBE_DOCS)
    assert removed.status_code == 200, removed.text

    _assert_stuck_cleanly(client, bundle_id, [unit["id"]])


def test_undo_refused_when_wi_step_was_removed(client: TestClient) -> None:
    fx = _setup_decisions(client)
    unit = find_unit(fx.view, STORAGE)
    target = _target("t", fx.wi_id, [unit], wi_step=1, wi_part="instruction")
    _confirm_clear_then(client, fx.bundle_id, unit, target)
    removed = put_tobe(client, fx.bundle_id, DECISIONS_TOBE_DOCS, na_slots=DECISIONS_NA_SLOTS)
    assert removed.status_code == 200, removed.text

    _assert_stuck_cleanly(client, fx.bundle_id, [unit["id"]])


def test_undo_refused_when_slot_became_na(client: TestClient) -> None:
    fx = _setup_decisions(client)
    unit = find_unit(fx.view, STORAGE)
    _confirm_clear_then(client, fx.bundle_id, unit, _target("t", fx.sop_id, [unit], slot_key="purpose"))
    na = [*DECISIONS_NA_SLOTS, {"code": "SOP-NEW", "slot_key": "purpose", "reason": "Synthetic: not needed"}]
    marked = put_tobe(client, fx.bundle_id, DECISIONS_TOBE_DOCS, na_slots=na, wi_steps=DECISIONS_WI_STEPS)
    assert marked.status_code == 200, marked.text

    _assert_stuck_cleanly(client, fx.bundle_id, [unit["id"]])


def test_undo_refused_when_another_author_linked_to_my_new_sentence(client: TestClient) -> None:
    fx = _setup_rich(client)
    assert set_members(client, fx.bundle_id, [("qa.member", "author"), ("qa.lead", "author")]).status_code == 200
    _confirm_unit(client, fx, fx.a, undo=UNDO)
    (target,) = get_group_by_unit(client, fx.bundle_id, fx.a["id"], headers=OTHER_AUTHOR)["targets"]
    linked = save_group(client, fx.bundle_id, {
        "action": "confirm",
        "units": [_unit_in(fx.a, 2), _unit_in(fx.b)],
        "targets": [{"key": "t", "id": target["id"], "revision": target["revision"], "slot_key": target["slot_key"],
                     "source_unit_ids": [fx.a["id"], fx.b["id"]], "text": f"{TEXT_A} {TEXT_B}", "change_type": "as_is"}],
    }, headers=OTHER_AUTHOR)
    assert linked.status_code == 200, linked.text
    before = _dump(fx.bundle_id)

    response = _undo(client, fx.bundle_id)

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "undo_conflict"
    assert _dump(fx.bundle_id) == before


def test_dependents_added_to_a_row_being_deleted_are_found() -> None:
    """남이 지울 새 문장에 출처를 붙였거나 지울 짝에 멤버를 넣었으면 그 Unit을 댄다 — 단계에 든 행은 세지 않는다."""
    expected: Snapshot = {
        "target_sentences": {"10": {"id": 10, "parent_target_id": None}},
        "target_sources": {"10,1": {"target_id": 10, "unit_id": 1}},
        "unit_pairs": {"5": {"id": 5, "document_id": 1}},
        "unit_pair_members": {"5,1": {"pair_id": 5, "unit_id": 1}},
    }
    restore: Snapshot = {"target_sentences": {}, "target_sources": {}, "unit_pairs": {}, "unit_pair_members": {}}
    current: Snapshot = {
        **expected,
        "target_sources": {**expected["target_sources"], "10,2": {"target_id": 10, "unit_id": 2}},
        "unit_pair_members": {**expected["unit_pair_members"], "5,3": {"pair_id": 5, "unit_id": 3}},
    }

    assert decision_steps._find_unrecorded_dependents(expected, restore, expected) is None
    assert decision_steps._find_unrecorded_dependents(expected, restore, current) == [2, 3]
