"""숨긴 AI — 자동 칸 추천과 묶기 계획의 삭제 후보가 멈추고, 숨긴 자료가 있는 묶음도 검토 요청까지 간다 (쪼개기 먼저 설계 §5 H4·H5)."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings
from app.sop.ai import constants
from app.sop.models import AiSuggestion
from tests.ai_fixtures import clean_ai_jobs  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
from tests.ai_fixtures import AI_SOP_DOC, make_match_bundle, plan, read_rows, run_jobs, run_plan, use_reply
from tests.docx_factory import p
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, get_group_by_unit, put_tobe, save_group
from tests.test_sop_ai_match_plan import LONE_NEW, LONE_OLD, NEW_1, NEW_2, OLD_1, OLD_2, find_live, queue_plan, read_old_ids
from tests.test_sop_ai_prepare import post_prepare, read_jobs
from tests.test_sop_ai_translate import (
    TRANSLATED,
    clear_unit,
    load_translations,
    make_assigned_table,
    make_assigned_unit,
    read_blocker_codes,
    remove_translation,
    save_translation,
    translate,
)

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs")


def request_classify(client: TestClient, bundle_id: int, unit_id: int) -> None:
    response = client.post(f"/api/bundles/{bundle_id}/ai/classify", json={"unit_ids": [unit_id]}, headers=AUTHOR)
    assert response.status_code == 200, response.text


def read_delete_candidates() -> list[AiSuggestion]:
    return [row for row in read_rows(AiSuggestion) if row.content["shape"] == "delete_candidate"]


def test_prepare_queues_no_classify_but_still_a_plan(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 칸 추천이 쌓일 수 있는 묶음(빈 To-Be 문서 · 남은 줄)이고 업로드 뒤의 계획은 서지 않았다
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1), has_assign=True)
    monkeypatch.setattr(settings, "ai_auto_prepare", True)

    out = post_prepare(client, bundle.id).json()

    assert out["queued"] == 0
    assert read_jobs("classify") == []
    assert [job.payload["origin"] for job in read_jobs("match_plan")] == ["prepare"]


def test_requested_classify_still_queues(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1), has_assign=True)
    (unit,) = read_old_ids(client, bundle, OLD_1)

    request_classify(client, bundle.id, unit)

    assert len(read_jobs("classify")) == 1


def test_plan_ignores_a_live_classify_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1) + p(OLD_2), p(NEW_1) + p(NEW_2), has_assign=True)
    unit, _ = read_old_ids(client, bundle, OLD_1, OLD_2)
    use_reply(fake_ai, rewrites={"ko": ["합성 고쳐 쓴 문장이다."]})
    request_classify(client, bundle.id, unit)
    run_jobs()

    plan(client, bundle.id)

    assert find_live(unit_id=unit).kind == "match"
    (classify,) = [row for row in read_rows(AiSuggestion) if row.kind == "classify"]
    assert (classify.result, classify.adoption) == ("applied", None)  # 행은 바꾸지 않는다


@pytest.mark.parametrize("has_assign_doc", [False, True])
def test_plan_writes_no_delete_candidate(client: TestClient, fake_ai: FakeAi, has_assign_doc: bool) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW), has_assign=has_assign_doc)

    plan(client, bundle.id)

    assert read_delete_candidates() == []
    assert [row.content["shape"] for row in read_rows(AiSuggestion)] == ["new"]  # 신규는 그대로 낸다


@pytest.mark.parametrize("adds_assign_doc", [False, True])
def test_replan_leaves_an_existing_delete_candidate(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch, adds_assign_doc: bool
) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    monkeypatch.setattr(constants, "PLAN_DELETES", True)
    queue_plan(bundle.id, {"origin": "prepare"})
    run_plan()
    (before,) = read_delete_candidates()
    monkeypatch.setattr(constants, "PLAN_DELETES", False)
    if adds_assign_doc:  # 보이지 않는 빈 문서가 생겨도 동작이 갈리지 않는다
        assert put_tobe(client, bundle.id, [AI_SOP_DOC]).status_code == 200

    plan(client, bundle.id)

    (after,) = read_delete_candidates()
    assert (after.id, after.result) == (before.id, "applied")


# --- 막다른 길이 없게(H5) ---


def test_hidden_place_with_a_leftover_translation_reaches_review(client: TestClient, fake_ai: FakeAi) -> None:
    """칸에 확정한 줄과 아직 정하지 않은 AI 번역 — 번역을 지우면 막는 이유가 없어지고 배정 취소도 된다."""
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    assert "targets_ai_suggested" in read_blocker_codes(client, bundle.id)
    (read,) = get_group_by_unit(client, bundle.id, unit["id"])["translations"]  # 화면이 이것을 보고 확정 · 지우기를 낸다
    assert (read["id"], read["ai_text"], read["status"]) == (target.id, TRANSLATED, "ai_suggested")

    removed = remove_translation(client, bundle.id, target)

    assert removed.status_code == 200, removed.text
    assert not {code for code in read_blocker_codes(client, bundle.id) if code.startswith("targets_")}
    assert get_group_by_unit(client, bundle.id, unit["id"])["translations"] == []
    assert clear_unit(client, bundle.id, unit["id"]).status_code == 200
    assert get_group_by_unit(client, bundle.id, unit["id"])["units"][0]["decision"]["status"] == "unassigned"


def test_confirming_a_leftover_translation_keeps_the_row_decision(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    before = get_group_by_unit(client, bundle.id, unit["id"])["units"][0]["decision"]

    assert save_translation(client, bundle.id, target).status_code == 200

    assert not {code for code in read_blocker_codes(client, bundle.id) if code.startswith("targets_")}
    assert get_group_by_unit(client, bundle.id, unit["id"])["units"][0]["decision"] == before  # 누가 언제 확정했는지 그대로


def test_settling_a_leftover_translation_is_one_undo_step(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    undo = {"session": "s1", "op": "confirm", "focus_unit_id": unit["id"]}
    body = {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [target.id], "undo": undo}
    assert save_group(client, bundle.id, body).status_code == 200

    undone = client.post(f"/api/bundles/{bundle.id}/decisions/undo", json={"session": "s1"}, headers=AUTHOR)

    assert undone.status_code == 200, undone.text
    (read,) = get_group_by_unit(client, bundle.id, unit["id"])["translations"]
    assert (read["id"], read["status"], read["ai_text"]) == (target.id, "ai_suggested", TRANSLATED)


def test_clearing_a_hidden_place_leaves_an_orphan_the_row_still_shows(client: TestClient, fake_ai: FakeAi) -> None:
    """확정해 둔 번역은 배정 취소 뒤 보류로 남아 검토를 막는다 — 그 줄에서 다시 정할 수 있어야 한다."""
    bundle, unit = make_assigned_unit(client)
    assert save_translation(client, bundle.id, translate(client, fake_ai, bundle.id, unit["id"])).status_code == 200
    assert clear_unit(client, bundle.id, unit["id"]).status_code == 200
    assert "targets_on_hold" in read_blocker_codes(client, bundle.id)

    (orphan,) = get_group_by_unit(client, bundle.id, unit["id"])["translations"]
    body = {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [orphan["id"]]}
    assert save_group(client, bundle.id, body).status_code == 200

    assert not {code for code in read_blocker_codes(client, bundle.id) if code.startswith("targets_")}
    assert load_translations(unit["id"]) == []


def test_cell_translations_stay_in_the_group(client: TestClient, fake_ai: FakeAi) -> None:
    """칸 번역은 표 묶음의 새 문장이라 translations에 겹쳐 싣지 않는다."""
    bundle, table, cell = make_assigned_table(client)
    target = translate(client, fake_ai, bundle.id, cell["id"])

    group = get_group_by_unit(client, bundle.id, table["id"])

    assert target.id in {item["id"] for item in group["targets"]} and group["translations"] == []


def test_removing_a_cell_translation_echoes_the_table(client: TestClient, fake_ai: FakeAi) -> None:
    """화면(translation-decision)이 보내는 칸 번역 저장 — 표 묶음을 지금 그대로 되보내고 번역만 지운다."""
    bundle, table, cell = make_assigned_table(client)
    target = translate(client, fake_ai, bundle.id, cell["id"])
    group = get_group_by_unit(client, bundle.id, table["id"])
    place = ("target_doc_id", "slot_key", "wi_step", "wi_part")
    targets = []
    for item in group["targets"]:
        if item["id"] == target.id:
            continue
        echo = {"key": f"t{item['id']}", "id": item["id"], "revision": item["revision"], "kind": item["kind"],
                "source_unit_ids": item["source_unit_ids"], **{key: item[key] for key in place}}
        if item["parent_target_id"] is not None:
            echo |= {"parent_key": f"t{item['parent_target_id']}", "cell_row": item["cell_row"], "cell_col": item["cell_col"]}
        targets.append(echo)
    units = [
        {"unit_id": unit["unit_id"], **{key: unit["decision"][key] for key in ("revision", "disposition", "move_target_code", "reason")}}
        for unit in group["units"]
    ]

    saved = save_group(client, bundle.id, {"action": "confirm", "units": units, "targets": targets, "removed_target_ids": [target.id]})

    assert saved.status_code == 200, saved.text
    assert not {code for code in read_blocker_codes(client, bundle.id) if code.startswith("targets_")}
