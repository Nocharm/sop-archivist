"""숨긴 AI — 자동 칸 추천과 묶기 계획의 삭제 후보가 멈추고, 숨긴 자료가 있는 묶음도 검토 요청까지 간다 (쪼개기 먼저 설계 §5 H4·H5)."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings
from app.sop.ai import constants
from app.sop.models import AiSuggestion
from tests import test_sop_review as review
from tests.ai_fixtures import clean_ai_jobs  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
from tests.ai_fixtures import AI_SOP_DOC, edit_document, make_ai_bundle, make_match_bundle, plan, read_rows, run_jobs, run_plan, upload_second_document, use_reply
from tests.docx_factory import p
from tests.fake_ai import FakeAi
from tests.sop_helpers import (
    AUTHOR,
    OUTSIDER,
    REVIEWER,
    assign_as_is,
    find_unit,
    get_bundle,
    get_group_by_unit,
    get_view,
    put_tobe,
    save_group,
)
from tests.test_sop_ai_context import _count_queries as count_queries
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


def read_open(client: TestClient, bundle_id: int) -> list[dict]:
    response = client.get(f"/api/bundles/{bundle_id}/translations/open", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def test_hidden_place_with_a_leftover_translation_reaches_review(client: TestClient, fake_ai: FakeAi) -> None:
    """칸에 확정한 줄과 아직 정하지 않은 AI 번역 — 번역을 지우면 막는 이유가 없어지고 배정 취소도 된다."""
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    assert "targets_ai_suggested" in read_blocker_codes(client, bundle.id)
    (read,) = read_open(client, bundle.id)  # 화면이 이것을 보고 확정 · 지우기를 낸다
    assert (read["id"], read["text"], read["status"], read["can_confirm"]) == (target.id, TRANSLATED, "ai_suggested", True)
    assert (read["source_unit_id"], read["row_unit_id"], read["source_text"]) == (unit["id"], unit["id"], unit["text"])

    removed = remove_translation(client, bundle.id, target)

    assert removed.status_code == 200, removed.text
    assert not {code for code in read_blocker_codes(client, bundle.id) if code.startswith("targets_")}
    assert read_open(client, bundle.id) == []
    assert clear_unit(client, bundle.id, unit["id"]).status_code == 200
    assert get_group_by_unit(client, bundle.id, unit["id"])["units"][0]["decision"]["status"] == "unassigned"


@pytest.mark.parametrize("settle", ["confirm", "remove"])
def test_bundle_with_hidden_data_reaches_the_review_request(client: TestClient, fake_ai: FakeAi, settle: str) -> None:
    """빈 문서에 배정한 줄 · 남은 번역 · 살아 있는 칸 추천이 있는 묶음 — 남는 화면의 동작만으로 검토 요청까지 간다(Review Focus 5)."""
    fx = review._make_ready(client)  # 줄이 모두 빈 To-Be 문서의 칸에 있다
    placed, cleared = (find_unit(fx.view, text) for text in (review.KO_1, review.KO_2))
    target = translate(client, fake_ai, fx.bundle_id, placed["id"])
    assert clear_unit(client, fx.bundle_id, cleared["id"]).status_code == 200  # 배정 취소
    use_reply(fake_ai, rewrites={"ko": ["합성 고쳐 쓴 문장이다."]})
    request_classify(client, fx.bundle_id, cleared["id"])
    run_jobs()
    assert [row.result for row in read_rows(AiSuggestion) if row.kind == "classify"] == ["applied"]
    assert review._request(client, fx.bundle_id).status_code == 422

    settled = save_translation(client, fx.bundle_id, target) if settle == "confirm" else remove_translation(client, fx.bundle_id, target)
    assert settled.status_code == 200, settled.text
    delete_body = {"action": "delete", "reason": "", "units": [{
        "unit_id": cleared["id"], "revision": get_group_by_unit(client, fx.bundle_id, cleared["id"])["units"][0]["decision"]["revision"],
    }]}
    deleted = client.post(f"/api/bundles/{fx.bundle_id}/decisions/bulk", json=delete_body, headers=AUTHOR)
    assert deleted.status_code == 200, deleted.text
    assert review._put_checks(client, fx.bundle_id).status_code == 200

    requested = review._request(client, fx.bundle_id)

    assert requested.status_code == 200, requested.text


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
    undo = {"session": "s1", "op": "drop_translation", "focus_unit_id": unit["id"]}
    body = {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [target.id], "undo": undo}
    assert save_group(client, bundle.id, body).status_code == 200

    undone = client.post(f"/api/bundles/{bundle.id}/decisions/undo", json={"session": "s1"}, headers=AUTHOR)

    assert undone.status_code == 200, undone.text
    assert undone.json()["op"] == "drop_translation"  # 화면이 "번역 지우기"를 되돌렸다고 말한다
    (read,) = read_open(client, bundle.id)
    assert (read["id"], read["status"], read["text"]) == (target.id, "ai_suggested", TRANSLATED)


def test_clearing_a_hidden_place_leaves_an_orphan_the_row_still_shows(client: TestClient, fake_ai: FakeAi) -> None:
    """확정해 둔 번역은 배정 취소 뒤 보류로 남아 검토를 막는다 — 그 줄에서 다시 정할 수 있어야 한다."""
    bundle, unit = make_assigned_unit(client)
    assert save_translation(client, bundle.id, translate(client, fake_ai, bundle.id, unit["id"])).status_code == 200
    assert clear_unit(client, bundle.id, unit["id"]).status_code == 200
    assert "targets_on_hold" in read_blocker_codes(client, bundle.id)

    (orphan,) = read_open(client, bundle.id)
    assert (orphan["row_unit_id"], orphan["can_confirm"]) == (unit["id"], False)  # 출처 문장이 없어 지우기만
    body = {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [orphan["id"]]}
    assert save_group(client, bundle.id, body).status_code == 200

    assert not {code for code in read_blocker_codes(client, bundle.id) if code.startswith("targets_")}
    assert load_translations(unit["id"]) == []


def test_a_cell_translation_names_its_table_row(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, table, cell = make_assigned_table(client)
    target = translate(client, fake_ai, bundle.id, cell["id"])

    (read,) = read_open(client, bundle.id)

    assert (read["id"], read["source_unit_id"], read["row_unit_id"]) == (target.id, cell["id"], table["id"])
    assert read["parent_target_id"] is not None and read["can_confirm"]


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


def test_removing_a_translation_someone_just_changed_is_refused(client: TestClient, fake_ai: FakeAi) -> None:
    """번역만 지우는 저장은 단위를 싣지 않아 단위 revision이 막지 못한다 — 지울 새 문장의 revision을 견준다."""
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    body = {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [target.id], "removed_revisions": {target.id: target.revision}}
    assert save_translation(client, bundle.id, target, text="Edited by someone else.").status_code == 200  # 그 사이 남이 고쳐 확정

    refused = save_group(client, bundle.id, body)

    assert refused.status_code == 409, refused.text
    (kept,) = load_translations(unit["id"])
    assert (kept.confirmed_text, kept.status) == ("Edited by someone else.", "confirmed")
    fresh = {**body, "removed_revisions": {target.id: kept.revision}}
    assert save_group(client, bundle.id, fresh).status_code == 200
    assert load_translations(unit["id"]) == []


def delete_rows(client: TestClient, bundle_id: int, units: list[dict]) -> None:
    body = {"action": "delete", "reason": "", "units": [
        {"unit_id": unit["id"], "revision": get_group_by_unit(client, bundle_id, unit["id"])["units"][0]["decision"]["revision"]}
        for unit in units
    ]}
    response = client.post(f"/api/bundles/{bundle_id}/decisions/bulk", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text


def make_retired_translation(client: TestClient, fake_ai: FakeAi, op: str) -> tuple[review.Fixture, int]:
    """확정해 둔 번역의 출처 Old 단위를 나누거나 합쳐 은퇴시킨 묶음 — 묶음과 남은 번역 id."""
    fx = review._make_ready(client)
    unit, neighbor = (find_unit(fx.view, text) for text in (review.KO_1, review.KO_2))
    target = translate(client, fake_ai, fx.bundle_id, unit["id"])
    assert save_translation(client, fx.bundle_id, target).status_code == 200
    edit = {"type": "split", "unit_id": unit["id"], "at": 6} if op == "split" else {"type": "merge", "unit_ids": [unit["id"], neighbor["id"]]}
    edit_document(client, fx.bundle_id, fx.doc["id"], edit, confirm=True)
    return fx, target.id


@pytest.mark.parametrize("op", ["split", "merge"])
def test_a_translation_of_a_retired_unit_is_listed_and_removed(client: TestClient, fake_ai: FakeAi, op: str) -> None:
    """출처 단위가 나누기 · 합치기로 은퇴해 어느 줄에도 없는 번역 — 묶음 목록에서 지우고 검토 요청까지 간다."""
    fx, target_id = make_retired_translation(client, fake_ai, op)
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    delete_rows(client, fx.bundle_id, [unit for unit in view["units"] if unit["status"] == "unassigned"])
    assert review._put_checks(client, fx.bundle_id).status_code == 200
    assert read_blocker_codes(client, fx.bundle_id) == {"targets_on_hold"}
    (read,) = read_open(client, fx.bundle_id)
    assert (read["id"], read["status"], read["source_unit_id"], read["row_unit_id"], read["can_confirm"]) == (
        target_id, "on_hold", None, None, False,
    )

    body = {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [target_id],
            "removed_revisions": {target_id: read["revision"]}, "undo": {"session": "s1", "op": "drop_translation"}}
    removed = save_group(client, fx.bundle_id, body)

    assert removed.status_code == 200, removed.text
    assert read_open(client, fx.bundle_id) == []
    undone = client.post(f"/api/bundles/{fx.bundle_id}/decisions/undo", json={"session": "s1"}, headers=AUTHOR)
    assert undone.status_code == 200, undone.text
    (restored,) = read_open(client, fx.bundle_id)  # Ctrl+Z 한 번으로 돌아온다
    assert (restored["id"], restored["text"], restored["status"]) == (target_id, read["text"], "on_hold")
    again = {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [target_id]}
    assert save_group(client, fx.bundle_id, again).status_code == 200
    assert review._put_checks(client, fx.bundle_id).status_code == 200
    requested = review._request(client, fx.bundle_id)
    assert requested.status_code == 200, requested.text


def test_reset_leaves_the_retired_translation_on_the_list(client: TestClient, fake_ai: FakeAi) -> None:
    fx, target_id = make_retired_translation(client, fake_ai, "split")
    reset = client.post(
        f"/api/bundles/{fx.bundle_id}/decisions/reset",
        json={"revision": get_bundle(client, fx.bundle_id)["revision"]}, headers=AUTHOR,
    )
    assert reset.status_code == 200, reset.text

    assert [item["id"] for item in read_open(client, fx.bundle_id)] == [target_id]


def test_open_translations_are_for_members_and_in_order(client: TestClient, fake_ai: FakeAi) -> None:
    """구성원(검토자 포함)만 읽고, 출처 줄이 있는 것이 Old 문서 순서로 먼저, 출처 없는 것이 끝이다."""
    fx, orphan_id = make_retired_translation(client, fake_ai, "split")
    unit = find_unit(fx.view, review.KO_2)
    live = translate(client, fake_ai, fx.bundle_id, unit["id"])
    url = f"/api/bundles/{fx.bundle_id}/translations/open"

    assert [item["id"] for item in read_open(client, fx.bundle_id)] == [live.id, orphan_id]
    assert client.get(url, headers=REVIEWER).status_code == 200
    assert client.get(url, headers=OUTSIDER).status_code == 404


def test_open_translations_take_a_fixed_number_of_queries(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    texts = [f"합성 시험 문장 {name}를 확인한다." for name in "가나다라마"]
    units = upload_second_document(client, bundle.id, "".join(p(text) for text in texts))["units"]
    for unit in units:
        assign_as_is(client, bundle.id, unit, bundle.sop_id, slot_key="purpose")
    translate(client, fake_ai, bundle.id, units[0]["id"])
    with count_queries() as one:
        assert len(read_open(client, bundle.id)) == 1
    for unit in units[1:]:
        translate(client, fake_ai, bundle.id, unit["id"])
    with count_queries() as many:
        assert len(read_open(client, bundle.id)) == 5
    assert len(many) == len(one)
