"""사람 확정과 채택 기록 — 그대로·고쳐서·버림 판정, 첫 판정 지키기, 짝이 나눠 쓰는 제안, 일괄 경로, 채택률, 제안 읽기 (설계 §6.8, §6.11, §7.7, §7.8, §13)."""

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.sop.ai.adoption import SavedShape, SuggestedShape, TargetShape, decide_adoption
from app.sop.models import AiSuggestion, TargetSentence, TargetTextHistory
from tests.ai_fixtures import (
    AI_EN_1,
    AI_EN_2,
    AI_KO_1,
    AI_KO_2,
    REWRITE,
    REWRITES,
    AI_SOP_DOC,
    AI_WI_DOC,
    AiBundle,
    attach_match_suggestion,
    attach_new_target_suggestion,
    build_reply,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    edit_document,
    find_ids,
    find_kind,
    get_target,
    make_ai_bundle,
    queue_units,
    read_decision,
    read_rows,
    run_jobs,
    upload_second_document,
    use_reply,
)
from tests.docx_factory import build_docx, p, tbl
from tests.fake_ai import FakeAi
from tests.sop_helpers import (
    AUTHOR,
    OUTSIDER,
    REVIEWER,
    assign_as_is,
    get_group_by_unit,
    get_view,
    put_tobe,
    save_group,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs")

EDITED = "합성 장비의 전원을 반드시 켠다."
OTHER_SLOT = "scope"  # 첫 후보의 칸은 purpose다
LONE_TEXT = "합성 세 번째 문장을 시험한다."
NEW_FILE = "SYNTHETIC_SOP-N_New.docx"
CELLS = [["합성 항목", "합성 값"], ["합성 압력", "10 bar"]]
PLACE = (1, "purpose", None, None)
OTHER_PLACE = (1, "scope", None, None)


def suggest_first_pair(client: TestClient, fake_ai: FakeAi, **reply: object) -> tuple[AiBundle, int, int]:
    """첫 한/영 짝에 제안을 받아 둔 묶음."""
    bundle = make_ai_bundle(client)
    ko, en = find_ids(client, bundle, AI_KO_1, AI_EN_1)
    use_reply(fake_ai, **reply)
    queue_units(client, bundle.id, [ko, en])
    run_jobs()
    return bundle, ko, en


def save_unit(
    client: TestClient,
    bundle_id: int,
    *unit_ids: int,
    action: str = "confirm",
    disposition: str = "assigned",
    **changes: object,
) -> httpx2.Response:
    """단위들의 지금 묶음을 그대로 저장한다 — text·change_type은 비워 보내고 changes가 새 문장 칸을 덮는다."""
    groups = [get_group_by_unit(client, bundle_id, unit_id) for unit_id in unit_ids]
    targets = [target for group in groups for target in group["targets"]]
    return save_group(client, bundle_id, {
        "action": action,
        "hold_reason": "합성 보류" if action == "hold" else "",
        "units": [
            {"unit_id": unit["unit_id"], "revision": unit["decision"]["revision"], "disposition": disposition}
            for group in groups for unit in group["units"]
        ],
        "targets": [
            {
                "key": str(target["id"]), "id": target["id"], "revision": target["revision"],
                "slot_key": target["slot_key"], "wi_step": target["wi_step"], "wi_part": target["wi_part"],
                "source_unit_ids": target["source_unit_ids"], **changes,
            }
            for target in targets
        ],
    })


def save_disposal(client: TestClient, bundle_id: int, unit_id: int, disposition: str) -> httpx2.Response:
    """AI 새 문장을 지우고 삭제·이동으로 확정한다."""
    group = get_group_by_unit(client, bundle_id, unit_id)
    return save_group(client, bundle_id, {
        "action": "confirm",
        "units": [{
            "unit_id": unit_id, "revision": group["units"][0]["decision"]["revision"], "disposition": disposition,
            "reason": "합성 사유", "move_target_code": "SOP-OTHER" if disposition == "move_external" else "",
        }],
        "targets": [],
        "removed_target_ids": [target["id"] for target in group["targets"]],
    })


def clear_unit(client: TestClient, bundle_id: int, unit_id: int) -> httpx2.Response:
    revision = get_group_by_unit(client, bundle_id, unit_id)["units"][0]["decision"]["revision"]
    return client.post(
        f"/api/bundles/{bundle_id}/decisions/clear", json={"unit_id": unit_id, "revision": revision}, headers=AUTHOR
    )


def bulk_delete(client: TestClient, bundle_id: int, unit_id: int) -> httpx2.Response:
    revision = get_group_by_unit(client, bundle_id, unit_id)["units"][0]["decision"]["revision"]
    body = {"action": "delete", "reason": "합성 사유", "units": [{"unit_id": unit_id, "revision": revision}]}
    return client.post(f"/api/bundles/{bundle_id}/decisions/bulk", json=body, headers=AUTHOR)


def save_table(
    client: TestClient, bundle_id: int, table_id: int, *, edited_cell: tuple[str, str] | None = None
) -> httpx2.Response:
    """AI 표 새 문장과 칸 새 문장을 저장한다 — edited_cell은 (고칠 칸 글, 새 글)."""
    group = get_group_by_unit(client, bundle_id, table_id)
    (table_target,) = [item for item in group["targets"] if item["kind"] == "table"]
    targets = []
    for item in group["targets"]:
        fields = {
            "key": str(item["id"]), "id": item["id"], "revision": item["revision"], "kind": item["kind"],
            "slot_key": item["slot_key"], "source_unit_ids": item["source_unit_ids"],
        }
        if item["kind"] == "sentence":
            fields["parent_key"] = str(table_target["id"])
            if edited_cell is not None and item["ai_text"] == edited_cell[0]:
                fields.update(text=edited_cell[1], change_type="rewritten")
        targets.append(fields)
    return save_group(client, bundle_id, {
        "action": "confirm",
        "units": [{"unit_id": table_id, "revision": group["units"][0]["decision"]["revision"], "disposition": "assigned"}],
        "targets": targets,
    })


def read_suggestions() -> list[AiSuggestion]:
    return read_rows(AiSuggestion)


def get_adoption(client: TestClient, bundle_id: int) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/ai/status", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()["adoption"]


def list_suggestions(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR, **params: object) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/ai/suggestions", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def shape(*targets: TargetShape, disposition: str = "assigned") -> SuggestedShape:
    return SuggestedShape(disposition=disposition, targets=targets)


def saved(*targets: TargetShape, dispositions: tuple[str, ...] = ("assigned",)) -> SavedShape:
    return SavedShape(dispositions=frozenset(dispositions), targets=targets)


def target(text: str = "글", place: tuple = PLACE, sources: tuple[int, ...] = (1,)) -> TargetShape:
    return TargetShape(place=place, text=text, sources=frozenset(sources))


# --- 판정 ---


@pytest.mark.parametrize(
    ("suggested", "stored", "expected"),
    [
        (shape(target()), saved(target()), "as_is"),
        (shape(disposition="delete"), saved(dispositions=("delete",)), "as_is"),
        (shape(target("가"), target("나")), saved(target("나"), target("가")), "as_is"),  # 순서는 뜻이 없다
        (shape(target()), saved(target("다른 글")), "edited"),
        (shape(target()), saved(target(sources=(1, 2))), "edited"),  # 합침으로 출처를 더했다
        (shape(target("가"), target("나")), saved(target("가")), "edited"),  # 나눔 하나를 버렸다
        (shape(target()), saved(target(), target(place=OTHER_PLACE)), "edited"),  # 일부만 다른 자리
        # 짝을 한 저장에서 따로 처분했다 — 한쪽은 제안대로라 버린 것이 아니다
        (shape(target("가"), target("나", sources=(2,))), saved(target("가"), dispositions=("assigned", "delete")), "edited"),
        (shape(disposition="delete"), saved(target(), dispositions=("assigned", "delete")), "edited"),
        (shape(target()), saved(dispositions=("delete",)), "rejected"),
        (shape(disposition="delete"), saved(target()), "rejected"),
        (shape(target()), saved(), "rejected"),  # 새 문장이 모두 사라졌다
        (shape(target()), saved(target(place=OTHER_PLACE)), "rejected"),  # 글이 같아도 모두 다른 자리
    ],
)
def test_decide_adoption(suggested: SuggestedShape, stored: SavedShape, expected: str) -> None:
    assert decide_adoption(suggested, stored) == expected


# --- 확정 ---


def test_empty_text_on_ai_target_confirms_ai_text(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)

    response = save_unit(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    target_out = get_target(client, bundle.id, ko)
    assert (target_out["confirmed_text"], target_out["ai_text"]) == (REWRITE, REWRITE)
    assert (target_out["status"], target_out["change_type"]) == ("confirmed", "tone")
    assert read_rows(TargetTextHistory) == []


def test_empty_text_on_hold_keeps_the_ai_text(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)

    response = save_unit(client, bundle.id, ko, action="hold")

    assert response.status_code == 200, response.text
    target_out = get_target(client, bundle.id, ko)
    assert (target_out["confirmed_text"], target_out["status"], target_out["change_type"]) == (REWRITE, "on_hold", "tone")


def test_structural_change_type_is_not_inherited(client: TestClient, fake_ai: FakeAi) -> None:
    # 나눔 두 문장 중 하나를 버리면 나눔이 아니다 — 행의 종류를 이어받지 않고 사람에게 고르게 한다
    bundle, ko, _ = suggest_first_pair(client, fake_ai, rewrites={"ko": ["합성 하나다.", "합성 둘이다."], "en": [REWRITES["en"]]})
    group = get_group_by_unit(client, bundle.id, ko)
    first, second = group["targets"]
    assert first["change_type"] == "split"

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": ko, "revision": group["units"][0]["decision"]["revision"], "disposition": "assigned"}],
        "targets": [{
            "key": "t", "id": first["id"], "revision": first["revision"], "slot_key": first["slot_key"],
            "source_unit_ids": [ko],
        }],
        "removed_target_ids": [second["id"]],
    })

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["reason"] == "change_type_required"


def test_text_history_starts_from_the_first_confirmed_text(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    assert save_unit(client, bundle.id, ko).status_code == 200

    response = save_unit(client, bundle.id, ko, text=EDITED, change_type="rewritten")

    assert response.status_code == 200, response.text
    (history,) = read_rows(TargetTextHistory)
    assert (history.previous_text, history.changed_by) == (REWRITE, "qa.member")


def test_confirm_unchanged_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)

    response = save_unit(client, bundle.id, ko, text=REWRITE, change_type="tone")

    assert response.status_code == 200, response.text
    (suggestion,) = read_suggestions()
    assert (suggestion.adoption, suggestion.adopted_by) == ("as_is", "qa.member")
    assert suggestion.adopted_at is not None
    decision = response.json()["units"][0]["decision"]
    assert decision["suggestion_id"] == suggestion.id == response.json()["targets"][0]["suggestion_id"]


def test_confirm_with_edited_text_records_edited(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)

    response = save_unit(client, bundle.id, ko, text=EDITED, change_type="rewritten")

    assert response.status_code == 200, response.text
    (suggestion,) = read_suggestions()
    assert suggestion.adoption == "edited"
    target_out = get_target(client, bundle.id, ko)
    assert (target_out["confirmed_text"], target_out["ai_text"]) == (EDITED, REWRITE)  # §6.7 따로 보관
    assert target_out["suggestion_id"] == suggestion.id


def test_confirm_with_other_location_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    group = get_group_by_unit(client, bundle.id, ko)
    target_row = group["targets"][0]

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": ko, "revision": group["units"][0]["decision"]["revision"], "disposition": "assigned"}],
        "targets": [{
            "key": "t", "id": target_row["id"], "revision": target_row["revision"], "slot_key": OTHER_SLOT,
            "source_unit_ids": [ko],
        }],
    })

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "rejected"


def test_confirm_in_a_new_target_elsewhere_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    # 제안 새 문장을 지우고 사람이 자기 문장을 다른 자리에 만들었다
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    group = get_group_by_unit(client, bundle.id, ko)

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": ko, "revision": group["units"][0]["decision"]["revision"], "disposition": "assigned"}],
        "targets": [{"key": "t", "target_doc_id": bundle.sop_id, "slot_key": OTHER_SLOT, "source_unit_ids": [ko]}],
        "removed_target_ids": [group["targets"][0]["id"]],
    })

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "rejected"


@pytest.mark.parametrize("disposition", ["delete", "move_external"])
def test_confirm_with_other_disposition_records_rejected(client: TestClient, fake_ai: FakeAi, disposition: str) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)

    response = save_disposal(client, bundle.id, ko, disposition)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "rejected"
    assert read_decision(ko).suggestion_id == read_suggestions()[0].id  # 근거가 된 제안은 남는다


def test_confirming_a_delete_suggestion_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai, candidate="delete", change_type="as_is", rewrites={})

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": ko, "revision": read_decision(ko).revision, "disposition": "delete", "reason": "합성 사유"}],
        "targets": [],
    })

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "as_is"


def test_placing_a_delete_suggestion_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai, candidate="delete", change_type="as_is", rewrites={})

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": ko, "revision": read_decision(ko).revision, "disposition": "assigned"}],
        "targets": [{"key": "t", "target_doc_id": bundle.sop_id, "slot_key": "purpose", "source_unit_ids": [ko]}],
    })

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "rejected"


def test_confirming_a_wi_suggestion_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    response = put_tobe(
        client, bundle.id, [AI_SOP_DOC, AI_WI_DOC], wi_steps=[{"code": AI_WI_DOC["code"], "step_no": 1, "title": "합성 단계"}]
    )
    assert response.status_code == 200, response.text
    ko, en = find_ids(client, bundle, AI_KO_1, AI_EN_1)
    fake_ai.chat = lambda data: build_reply(data, candidate=next(
        item["key"] for item in data["candidates"] if "단계 1" in item["label"] and item["label"].endswith("Why")
    ))
    queue_units(client, bundle.id, [ko, en])
    run_jobs()

    response = save_unit(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "as_is"


def test_dropping_one_of_two_rewrites_records_edited(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai, rewrites={"ko": ["합성 하나다.", "합성 둘이다."], "en": [REWRITES["en"]]})
    group = get_group_by_unit(client, bundle.id, ko)
    first, second = group["targets"]

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": ko, "revision": group["units"][0]["decision"]["revision"], "disposition": "assigned"}],
        "targets": [{
            "key": "t", "id": first["id"], "revision": first["revision"], "slot_key": first["slot_key"],
            "source_unit_ids": [ko], "change_type": "rewritten",
        }],
        "removed_target_ids": [second["id"]],
    })

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "edited"


def test_confirming_both_rewrites_of_a_split_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai, rewrites={"ko": ["합성 하나다.", "합성 둘이다."], "en": [REWRITES["en"]]})

    response = save_unit(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "as_is"


def test_merging_a_person_chosen_unit_records_edited(client: TestClient, fake_ai: FakeAi) -> None:
    # 글자·자리가 같아도 출처를 더하면 제안 그대로가 아니다
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    other, = find_ids(client, bundle, AI_KO_2)
    group = get_group_by_unit(client, bundle.id, ko)
    target_row = group["targets"][0]

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [
            {"unit_id": ko, "revision": group["units"][0]["decision"]["revision"], "disposition": "assigned"},
            {"unit_id": other, "revision": read_decision(other).revision, "disposition": "assigned"},
        ],
        "targets": [{
            "key": "t", "id": target_row["id"], "revision": target_row["revision"], "slot_key": target_row["slot_key"],
            "source_unit_ids": [ko, other], "text": REWRITE,
        }],
    })

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "edited"


def test_kind_without_a_rule_stays_undecided(client: TestClient, fake_ai: FakeAi) -> None:
    # 입구 2 제안은 견줄 처분·자리를 담지 않아 아직 판정 규칙이 없다 — 사람의 저장은 그대로 돈다
    bundle = make_ai_bundle(client)
    ko, = find_ids(client, bundle, AI_KO_1)
    attach_match_suggestion(bundle.id, ko)

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": ko, "revision": read_decision(ko).revision, "disposition": "assigned"}],
        "targets": [{"key": "t", "target_doc_id": bundle.sop_id, "slot_key": "purpose", "source_unit_ids": [ko]}],
    })

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption is None


def test_table_suggestion_compares_the_cells(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    table = find_kind(upload_second_document(client, bundle.id, tbl(CELLS)), "table")
    use_reply(fake_ai)
    queue_units(client, bundle.id, [table["id"]])
    run_jobs()

    response = save_table(client, bundle.id, table["id"])

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "as_is"


def test_edited_cell_records_edited(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    table = find_kind(upload_second_document(client, bundle.id, tbl(CELLS)), "table")
    use_reply(fake_ai)
    queue_units(client, bundle.id, [table["id"]])
    run_jobs()

    response = save_table(client, bundle.id, table["id"], edited_cell=("합성 압력", "합성 압력 값"))

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "edited"


def test_hold_records_nothing_until_confirmed(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)

    held = save_unit(client, bundle.id, ko, action="hold", text=EDITED, change_type="rewritten")

    assert held.status_code == 200, held.text
    assert read_suggestions()[0].adoption is None
    confirmed = save_unit(client, bundle.id, ko)
    assert confirmed.status_code == 200, confirmed.text
    assert read_suggestions()[0].adoption == "edited"  # 비운 글은 보류 때 고친 글이다


def test_later_edit_keeps_the_first_adoption(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    assert save_unit(client, bundle.id, ko).status_code == 200
    first_at = read_suggestions()[0].adopted_at

    response = save_unit(client, bundle.id, ko, text=EDITED, change_type="rewritten")

    assert response.status_code == 200, response.text
    (suggestion,) = read_suggestions()
    assert (suggestion.adoption, suggestion.adopted_at) == ("as_is", first_at)
    assert read_decision(ko).suggestion_id == suggestion.id


# --- 짝이 나눠 쓰는 제안 ---


def test_first_side_of_a_pair_decides_the_shared_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    assert save_unit(client, bundle.id, ko).status_code == 200
    assert read_suggestions()[0].adoption == "as_is"

    response = save_unit(client, bundle.id, en, text="An edited synthetic rewrite.", change_type="rewritten")

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "as_is"


def test_saving_both_sides_judges_them_together(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    ko_group, en_group = (get_group_by_unit(client, bundle.id, unit_id) for unit_id in (ko, en))
    ko_target, en_target = ko_group["targets"][0], en_group["targets"][0]

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [
            {"unit_id": ko, "revision": ko_group["units"][0]["decision"]["revision"], "disposition": "assigned"},
            {"unit_id": en, "revision": en_group["units"][0]["decision"]["revision"], "disposition": "assigned"},
        ],
        "targets": [
            {
                "key": "ko", "id": ko_target["id"], "revision": ko_target["revision"],
                "slot_key": ko_target["slot_key"], "source_unit_ids": [ko],
            },
            {
                "key": "en", "id": en_target["id"], "revision": en_target["revision"], "slot_key": en_target["slot_key"],
                "source_unit_ids": [en], "text": "An edited synthetic rewrite.", "change_type": "rewritten",
            },
        ],
    })

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "edited"


def test_one_save_judges_each_suggestion_apart(client: TestClient, fake_ai: FakeAi) -> None:
    # 한 저장에 여러 제안이 담기면 제안마다 제 단위의 새 문장만 견준다
    bundle = make_ai_bundle(client)
    use_reply(fake_ai)
    first, second = find_ids(client, bundle, AI_KO_1, AI_KO_2)
    assert client.post(
        f"/api/bundles/{bundle.id}/ai/classify", json={"document_id": bundle.document_id}, headers=AUTHOR
    ).json()["queued"] == 2
    run_jobs()

    response = save_unit(client, bundle.id, first, second)

    assert response.status_code == 200, response.text
    assert [suggestion.adoption for suggestion in read_suggestions()] == ["as_is", "as_is"]


def test_re_request_keeps_a_suggestion_with_a_recorded_adoption(client: TestClient, fake_ai: FakeAi) -> None:
    # 한쪽을 확정한 뒤 다른 쪽을 다시 받아도 그 채택이 통계에 남는다
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    assert save_unit(client, bundle.id, en).status_code == 200
    (adopted,) = read_suggestions()

    queue_units(client, bundle.id, [ko])
    run_jobs()

    first, second = read_suggestions()
    assert (first.id, first.result, first.adoption) == (adopted.id, "applied", "as_is")
    assert (second.result, second.adoption) == ("applied", None)
    assert read_decision(en).suggestion_id == first.id
    assert get_target(client, bundle.id, en)["suggestion_id"] == first.id
    assert read_decision(ko).suggestion_id == second.id
    assert get_adoption(client, bundle.id)["classify"] == {
        "applied": 2, "as_is": 1, "edited": 0, "rejected": 0, "pending": 1, "adoption_rate": 1.0,
    }


def test_held_side_confirmed_after_a_re_request_still_counts(client: TestClient, fake_ai: FakeAi) -> None:
    # 보류는 채택이 아니라 다른 쪽을 다시 받으면 제안이 밀린다 — 그 뒤 확정해도 채택은 채택률에 든다
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    assert save_unit(client, bundle.id, en, action="hold").status_code == 200
    queue_units(client, bundle.id, [ko])
    run_jobs()
    assert [suggestion.result for suggestion in read_suggestions()] == ["stale", "applied"]

    response = save_unit(client, bundle.id, en)

    assert response.status_code == 200, response.text
    assert [(row.result, row.adoption) for row in read_suggestions()] == [("stale", "as_is"), ("applied", None)]
    assert get_adoption(client, bundle.id)["classify"] == {
        "applied": 1, "as_is": 1, "edited": 0, "rejected": 0, "pending": 1, "adoption_rate": 1.0,
    }


# --- 배정 지우기·일괄 ---


def test_clear_records_rejected_and_resets_suggestion_id(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)

    response = clear_unit(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    (suggestion,) = read_suggestions()
    assert (suggestion.result, suggestion.adoption, suggestion.adopted_by) == ("applied", "rejected", "qa.member")
    assert get_group_by_unit(client, bundle.id, ko)["units"][0]["decision"]["suggestion_id"] is None
    assert get_group_by_unit(client, bundle.id, ko)["targets"] == []


def test_clear_after_confirm_keeps_the_first_adoption(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    assert save_unit(client, bundle.id, ko).status_code == 200

    response = clear_unit(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "as_is"
    assert read_decision(ko).suggestion_id is None


def test_clear_of_a_held_suggestion_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    assert save_unit(client, bundle.id, ko, action="hold").status_code == 200

    assert clear_unit(client, bundle.id, ko).status_code == 200

    assert read_suggestions()[0].adoption == "rejected"


def test_bulk_delete_refuses_ai_suggested_units(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai, candidate="delete", change_type="as_is", rewrites={})
    before = read_decision(ko)

    response = bulk_delete(client, bundle.id, ko)

    assert (response.status_code, response.json()["detail"]["code"]) == (409, "ai_suggested_units")
    assert response.json()["detail"]["unit_ids"] == [ko]
    decision = read_decision(ko)
    assert (decision.status, decision.revision) == ("ai_suggested", before.revision)


@pytest.mark.parametrize(("candidate", "expected"), [("delete", "as_is"), ("c1", "rejected")])
def test_bulk_disposal_of_a_held_suggestion_records_adoption(
    client: TestClient, fake_ai: FakeAi, candidate: str, expected: str
) -> None:
    # 보류한 단위는 일괄 처분을 지날 수 있다 — 사람의 확정이라 채택도 남는다
    bundle = make_ai_bundle(client)
    ko, en = find_ids(client, bundle, AI_KO_1, AI_EN_1)
    use_reply(fake_ai, candidate=candidate, rewrites={} if candidate == "delete" else {
        "ko": [REWRITES["ko"]], "en": [REWRITES["en"]],
    })
    queue_units(client, bundle.id, [ko, en])
    run_jobs()
    group = get_group_by_unit(client, bundle.id, ko)
    held = save_group(client, bundle.id, {
        "action": "hold",
        "hold_reason": "합성 보류",
        "units": [{"unit_id": ko, "revision": group["units"][0]["decision"]["revision"], "disposition": "unassigned"}],
        "targets": [],
        "removed_target_ids": [target_row["id"] for target_row in group["targets"]],
    })
    assert held.status_code == 200, held.text

    response = bulk_delete(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == expected


def test_bulk_new_confirm_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    # 입구 2 신규 제안(Task 12)을 한 번에 확정하는 길 — 제안은 시험이 직접 붙인다
    bundle = make_ai_bundle(client)
    uploaded = upload(client, bundle.id, build_docx(p(LONE_TEXT)), NEW_FILE, side="new", doc_type="sop")
    assert uploaded.status_code == 201, uploaded.text
    target_id = attach_new_target_suggestion(bundle.id, uploaded.json()["target_doc_id"])

    response = client.post(
        f"/api/bundles/{bundle.id}/match/bulk-confirm",
        json={"new": [{"target_id": target_id, "revision": 2}]}, headers=AUTHOR,
    )

    assert response.status_code == 200, response.text
    (suggestion,) = read_suggestions()
    assert (suggestion.adoption, suggestion.adopted_by) == ("as_is", "qa.member")
    assert response.json()["targets"][0]["suggestion_id"] == suggestion.id


def test_removing_a_new_doc_target_drops_its_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    # 입구 2 새 문장은 지워지지 않고 미배정으로 돌아간다 — 이어 둔 제안이 남으면 낡은 근거를 가리킨다
    bundle = make_ai_bundle(client)
    uploaded = upload(client, bundle.id, build_docx(p(LONE_TEXT)), NEW_FILE, side="new", doc_type="sop")
    assert uploaded.status_code == 201, uploaded.text
    target_id = attach_new_target_suggestion(bundle.id, uploaded.json()["target_doc_id"])

    response = save_group(client, bundle.id, {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [target_id]})

    assert response.status_code == 200, response.text
    (row,) = [item for item in read_rows(TargetSentence) if item.id == target_id]
    assert (row.status, row.suggestion_id) == ("unassigned", None)


# --- 편집으로 은퇴 ---


def test_unit_retired_by_edit_leaves_adoption_empty(client: TestClient, fake_ai: FakeAi) -> None:
    # 사람이 정한 게 아니라 비워 두고, 이제 정할 곳도 없어 대기로 세지 않는다
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, p(LONE_TEXT))
    unit = view["units"][0]
    use_reply(fake_ai)
    queue_units(client, bundle.id, [unit["id"]])
    run_jobs()

    edit_document(
        client, bundle.id, view["document"]["id"], {"type": "split", "unit_id": unit["id"], "at": 3}, confirm=True
    )

    (suggestion,) = read_suggestions()
    assert (suggestion.result, suggestion.adoption, suggestion.adopted_by) == ("applied", None, None)
    assert read_decision(unit["id"]).suggestion_id is None
    assert get_adoption(client, bundle.id)["classify"] == {
        "applied": 1, "as_is": 0, "edited": 0, "rejected": 0, "pending": 0, "adoption_rate": None,
    }


def test_retiring_one_side_leaves_the_other_pending(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, en = suggest_first_pair(client, fake_ai)

    edit_document(client, bundle.id, bundle.document_id, {"type": "split", "unit_id": ko, "at": 3}, confirm=True)

    assert read_suggestions()[0].adoption is None
    assert read_decision(en).status == "ai_suggested"
    assert get_adoption(client, bundle.id)["classify"]["pending"] == 1


# --- 채택률 ---


def test_status_reports_adoption_rate_per_kind(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    use_reply(fake_ai)
    first, second = find_ids(client, bundle, AI_KO_1, AI_KO_2)
    assert client.post(
        f"/api/bundles/{bundle.id}/ai/classify", json={"document_id": bundle.document_id}, headers=AUTHOR
    ).json()["queued"] == 2
    third = upload_second_document(client, bundle.id, p(LONE_TEXT))["units"][0]["id"]
    queue_units(client, bundle.id, [third])
    run_jobs()
    assert save_unit(client, bundle.id, first).status_code == 200
    assert save_unit(client, bundle.id, second, text=EDITED, change_type="rewritten").status_code == 200

    status = client.get(f"/api/bundles/{bundle.id}/ai/status", headers=REVIEWER).json()

    assert status["adoption"]["classify"] == {
        "applied": 3, "as_is": 1, "edited": 1, "rejected": 0, "pending": 1, "adoption_rate": 0.5,
    }
    assert set(status["adoption"]) == {"classify"}


def test_stale_and_invalid_results_stay_out_of_the_counts(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    queue_units(client, bundle.id, [ko, en])
    run_jobs()  # 처음 제안은 stale

    other_ko, other_en = find_ids(client, bundle, AI_KO_2, AI_EN_2)
    fake_ai.chat = lambda data: "not json"
    queue_units(client, bundle.id, [other_ko, other_en])
    run_jobs()

    assert [suggestion.result for suggestion in read_suggestions()] == ["stale", "applied", "invalid"]
    assert get_adoption(client, bundle.id)["classify"] == {
        "applied": 1, "as_is": 0, "edited": 0, "rejected": 0, "pending": 1, "adoption_rate": None,
    }


def test_status_has_no_adoption_without_suggestions(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)

    assert get_adoption(client, bundle.id) == {}


def test_status_stays_within_the_bundle(client: TestClient, fake_ai: FakeAi) -> None:
    suggest_first_pair(client, fake_ai)
    other = make_ai_bundle(client)

    assert get_adoption(client, other.id) == {}


# --- 제안 읽기 ---


def test_suggestion_detail_and_list(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    queue_units(client, bundle.id, [ko, en])
    run_jobs()
    second_doc = upload_second_document(client, bundle.id, p(LONE_TEXT))
    queue_units(client, bundle.id, [second_doc["units"][0]["id"]])
    run_jobs()
    assert save_unit(client, bundle.id, ko).status_code == 200
    stale, applied, other_doc = read_suggestions()

    everything = list_suggestions(client, bundle.id, REVIEWER)

    assert everything["total"] == 3
    assert [item["id"] for item in everything["items"]] == [stale.id, applied.id, other_doc.id]
    item = everything["items"][1]
    assert set(item) == {
        "id", "job_id", "kind", "document_id", "result", "content", "warnings", "guideline_versions", "model",
        "adoption", "adopted_by", "adopted_at", "created_at",
    }
    assert (item["kind"], item["document_id"], item["result"]) == ("classify", bundle.document_id, "applied")
    assert (item["adoption"], item["adopted_by"]) == ("as_is", "qa.member")
    assert item["adopted_at"].endswith("+09:00")
    assert item["content"]["rewrites"]["ko"] == [REWRITES["ko"]]

    response = client.get(f"/api/bundles/{bundle.id}/ai/suggestions/{applied.id}", headers=REVIEWER)
    assert response.status_code == 200, response.text
    assert response.json() == item
    assert "score" not in response.text and "score" not in str(everything)

    assert list_suggestions(client, bundle.id, kind="classify")["total"] == 3
    assert list_suggestions(client, bundle.id, kind="translate") == {"total": 0, "items": []}
    assert [row["id"] for row in list_suggestions(client, bundle.id, document_id=second_doc["document"]["id"])["items"]] == [other_doc.id]
    assert [row["id"] for row in list_suggestions(client, bundle.id, result="stale")["items"]] == [stale.id]
    page = list_suggestions(client, bundle.id, limit=1, offset=1)
    assert (page["total"], [row["id"] for row in page["items"]]) == (3, [applied.id])


def test_suggestions_are_for_members_of_the_bundle(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, _, _ = suggest_first_pair(client, fake_ai)
    other = make_ai_bundle(client)
    (suggestion,) = read_suggestions()
    base = f"/api/bundles/{bundle.id}/ai/suggestions"

    assert client.get(base, headers=OUTSIDER).status_code == 404
    assert client.get(f"{base}/{suggestion.id}", headers=OUTSIDER).status_code == 404
    response = client.get(f"/api/bundles/{other.id}/ai/suggestions/{suggestion.id}", headers=AUTHOR)
    assert (response.status_code, response.json()["detail"]["code"]) == (404, "suggestion_not_found")
    assert client.get(f"{base}/0", headers=AUTHOR).status_code == 422


@pytest.mark.parametrize("params", [{"kind": "nope"}, {"result": "nope"}, {"limit": 0}, {"offset": -1}, {"document_id": 0}])
def test_suggestion_list_refuses_bad_filters(client: TestClient, fake_ai: FakeAi, params: dict[str, object]) -> None:
    bundle = make_ai_bundle(client)

    response = client.get(f"/api/bundles/{bundle.id}/ai/suggestions", params=params, headers=AUTHOR)

    assert response.status_code == 422, response.text


def test_save_without_a_suggestion_records_nothing(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    view = get_view(client, bundle.id, bundle.document_id)

    group = assign_as_is(client, bundle.id, view["units"][0], bundle.sop_id, slot_key="purpose")

    assert group["units"][0]["decision"]["suggestion_id"] is None
    assert read_suggestions() == []
