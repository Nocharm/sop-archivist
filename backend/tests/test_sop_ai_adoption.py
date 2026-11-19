"""사람이 받은 제안과 채택 기록 — 저장이 실은 제안(Use)으로 그대로·고쳐서·버림 판정, 첫 판정 지키기, 짝이 나눠 쓰는 제안, 일괄 경로,
채택률, 제안 읽기 (설계 §6.8, §6.11, §7.7, §7.8, §13, 2026-11-19-ai-suggest-only D1·D2)."""

from collections.abc import Sequence

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.sop.ai.adoption import SavedShape, SuggestedShape, TargetShape, decide_adoption
from app.sop.models import (
    AiJob,
    AiSuggestion,
    TargetSentence,
    TargetTextHistory,
    Unit,
    UnitDecision,
    UnitPair,
    UnitPairMember,
)
from tests.access_helpers import update_row
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
    attach_new_target_suggestion,
    attach_suggestion,
    build_reply,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    clean_embedding_cache,  # noqa: F401
    edit_document,
    find_ids,
    find_kind,
    get_target,
    make_ai_bundle,
    make_match_bundle,
    plan,
    queue_units,
    read_decision,
    read_links,
    read_old_ids,
    read_rows,
    read_target,
    request_classify,
    run_jobs,
    upload_second_document,
    use_reply,
    use_vectors,
)
from tests.docx_factory import build_docx, p, tbl
from tests.fake_ai import FakeAi
from tests.sop_helpers import (
    AUTHOR,
    OUTSIDER,
    REVIEWER,
    WRITTEN_CAPTION,
    assign_as_is,
    build_as_is_targets,
    find_unit,
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
SPLIT_REWRITES = {"ko": ["합성 하나다.", "합성 둘이다."], "en": [REWRITES["en"]]}
MATCH_OLD, MATCH_NEW = "합성 장비의 전원을 켠 뒤 상태 표시등을 확인한다.", "합성 장비의 전원을 켠 뒤 상태 표시등을 반드시 확인한다."


def suggest_first_pair(client: TestClient, fake_ai: FakeAi, **reply: object) -> tuple[AiBundle, int, int]:
    """첫 한/영 짝에 제안을 받아 둔 묶음 — 판단은 미배정 그대로다."""
    bundle = make_ai_bundle(client)
    ko, en = find_ids(client, bundle, AI_KO_1, AI_EN_1)
    use_reply(fake_ai, **reply)
    queue_units(client, bundle.id, [ko, en])
    run_jobs()
    return bundle, ko, en


def find_live_suggestion(unit_id: int, kind: str = "classify") -> AiSuggestion:
    """그 단위를 덮는 마지막 적용된 제안 — Assign이 그 줄의 추천 카드로 보이는 제안이다."""
    return [
        row for row in read_suggestions()
        if row.kind == kind and row.result == "applied" and unit_id in row.content["unit_ids"]
    ][-1]


def build_use_body(
    unit_ids: Sequence[int], *, action: str = "confirm", suggestion: AiSuggestion | None = None, **changes: object
) -> dict:
    """사람이 분류 제안을 받아(Use) 만든 저장 — 제안의 처분·자리·언어별 고쳐 쓴 글·변경 종류를 초안에 채우고 suggestion_id를 싣는다.

    단위마다 제 언어의 고쳐 쓴 글이 새 문장 하나씩이 되고, changes가 새 문장 칸을 덮는다(받은 뒤 사람이 고친 것). 글 단위만 — 표는 use_table.
    """
    suggestion = suggestion or find_live_suggestion(unit_ids[0])
    content = suggestion.content
    disposition = content["disposition"]
    langs = {row.id: row.lang for row in read_rows(Unit)}
    place = {key: content[key] for key in ("target_doc_id", "slot_key", "wi_step", "wi_part")}
    return {
        "action": action,
        "hold_reason": "합성 보류" if action == "hold" else "",
        "units": [
            {
                "unit_id": unit_id, "revision": read_decision(unit_id).revision, "disposition": disposition,
                "reason": "" if disposition == "assigned" else "합성 사유",
            }
            for unit_id in unit_ids
        ],
        "targets": [
            {
                "key": f"{unit_id}-{index}", **place, "source_unit_ids": [unit_id], "text": text,
                "change_type": content["change_type"], **changes,
            }
            for unit_id in unit_ids if disposition == "assigned"
            for index, text in enumerate(content["rewrites"][langs[unit_id]])
        ],
        "suggestion_id": suggestion.id,
    }


def use_suggestion(
    client: TestClient, bundle_id: int, *unit_ids: int, action: str = "confirm", **changes: object
) -> httpx2.Response:
    return save_group(client, bundle_id, build_use_body(unit_ids, action=action, **changes))


def use_table(
    client: TestClient,
    bundle_id: int,
    table: dict,
    *,
    action: str = "confirm",
    edited_cell: tuple[str, str] | None = None,
    is_reshaped: bool = False,
) -> httpx2.Response:
    """표 분류 제안을 받아 저장한다 — 표·칸 새 문장은 원문 그대로 제안의 자리에 두고, 확정이면 캡션 없는 표라 써 넣은 캡션을 더한다.

    edited_cell은 (고칠 칸 글, 새 글), is_reshaped는 칸 글을 둔 채 한 열로 편다.
    """
    suggestion = find_live_suggestion(table["id"])
    content = suggestion.content
    location = {key: content[key] for key in ("slot_key", "wi_step", "wi_part")}
    (table_target, *cells), _ = build_as_is_targets(client, bundle_id, table, content["target_doc_id"], **location)
    texts = {row.id: row.text for row in read_rows(Unit)}
    for index, cell in enumerate(cells):
        if edited_cell is not None and texts[cell["source_unit_ids"][0]] == edited_cell[0]:
            cell.update(text=edited_cell[1], change_type="rewritten")
        if is_reshaped:
            cell.update(cell_row=index, cell_col=0)
    if is_reshaped:
        table_target.update(grid={"rows": len(cells), "cols": 1}, change_type="table_restructured")
    caption = {
        "key": "caption", "target_doc_id": content["target_doc_id"], **location, "parent_key": "t", "lang": "en",
        "text": WRITTEN_CAPTION, "source_unit_ids": [],
    }
    return save_group(client, bundle_id, {
        "action": action,
        "hold_reason": "합성 보류" if action == "hold" else "",
        "units": [{
            "unit_id": table["id"], "revision": read_decision(table["id"]).revision, "disposition": "assigned",
            "reason": "합성 사유" if is_reshaped else "",
        }],
        "targets": [table_target, *cells, *([caption] if action == "confirm" else [])],
        "suggestion_id": suggestion.id,
    })


def use_new_target(client: TestClient, bundle_id: int, target_id: int, *, action: str = "confirm") -> httpx2.Response:
    """입구 2 신규 제안을 받는다 — 그 새 문장을 출처 없이 저장하고 suggestion_id를 싣는다."""
    (target,) = [row for row in read_rows(TargetSentence) if row.id == target_id]
    (suggestion,) = [row for row in read_suggestions() if target_id in row.content["target_ids"]]
    return save_group(client, bundle_id, {
        "action": action,
        "hold_reason": "합성 보류" if action == "hold" else "",
        "units": [],
        "targets": [{"key": "t", "id": target_id, "revision": target.revision, "source_unit_ids": []}],
        "suggestion_id": suggestion.id,
    })


def save_unit(
    client: TestClient,
    bundle_id: int,
    *unit_ids: int,
    action: str = "confirm",
    disposition: str = "assigned",
    **changes: object,
) -> httpx2.Response:
    """단위들의 지금 묶음을 제안 없이 다시 저장한다 — text는 비워 보내고 changes가 새 문장 칸을 덮는다."""
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
    """제안을 받아 놓고 자리 대신 삭제·이동으로 확정한다."""
    body = build_use_body([unit_id])
    body["units"][0].update(
        disposition=disposition, reason="합성 사유", move_target_code="SOP-OTHER" if disposition == "move_external" else "",
    )
    body["targets"] = []
    return save_group(client, bundle_id, body)


def hold_without_targets(client: TestClient, bundle_id: int, unit_id: int) -> httpx2.Response:
    """제안을 받아 둔 채 새 문장 없이 보류한다 — 판단만 제안에 이어지고 일괄 처분이 지날 수 있다."""
    body = build_use_body([unit_id], action="hold")
    body["units"][0].update(disposition="unassigned", reason="")
    body["targets"] = []
    return save_group(client, bundle_id, body)


def clear_unit(client: TestClient, bundle_id: int, unit_id: int) -> httpx2.Response:
    revision = get_group_by_unit(client, bundle_id, unit_id)["units"][0]["decision"]["revision"]
    return client.post(
        f"/api/bundles/{bundle_id}/decisions/clear", json={"unit_id": unit_id, "revision": revision}, headers=AUTHOR
    )


def bulk_dispose(client: TestClient, bundle_id: int, *unit_ids: int, action: str = "delete") -> httpx2.Response:
    units = [{"unit_id": unit_id, "revision": read_decision(unit_id).revision} for unit_id in unit_ids]
    body = {"action": action, "reason": "합성 사유", "units": units}
    if action == "move_external":
        body["move_target_code"] = "SOP-OTHER"
    return client.post(f"/api/bundles/{bundle_id}/decisions/bulk", json=body, headers=AUTHOR)


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


def target(
    text: str = "글", place: tuple = PLACE, sources: tuple[int, ...] = (1,), *, restructured: bool = False
) -> TargetShape:
    return TargetShape(place=place, text=text, sources=frozenset(sources), restructured=restructured)


# --- 판정 ---


@pytest.mark.parametrize(
    ("suggested", "stored", "expected"),
    [
        (shape(target()), saved(target()), "as_is"),
        (shape(disposition="delete"), saved(dispositions=("delete",)), "as_is"),
        (shape(target("가"), target("나")), saved(target("나"), target("가")), "as_is"),  # 순서는 뜻이 없다
        (shape(target()), saved(target("다른 글")), "edited"),
        (shape(target()), saved(target(sources=(1, 2))), "edited"),  # 합침으로 출처를 더했다
        (shape(target()), saved(target(restructured=True)), "edited"),  # 칸 글이 같아도 표 구성을 바꿨다
        (shape(target()), saved(target(place=OTHER_PLACE, restructured=True)), "rejected"),
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


# --- 받기(Use)와 확정 ---


def test_using_a_suggestion_confirms_its_rewrite(client: TestClient, fake_ai: FakeAi) -> None:
    # AI는 새 문장을 쓰지 않는다 — 받은 글은 사람의 새 문장이 되고 AI 글 칸은 비어 있다
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    assert get_group_by_unit(client, bundle.id, ko)["targets"] == []

    response = use_suggestion(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    target_out = get_target(client, bundle.id, ko)
    assert (target_out["confirmed_text"], target_out["ai_text"]) == (REWRITE, "")
    assert (target_out["status"], target_out["change_type"]) == ("confirmed", "tone")
    assert read_rows(TargetTextHistory) == []


def test_using_a_suggestion_on_hold_links_it_without_adoption(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)

    response = use_suggestion(client, bundle.id, ko, action="hold")

    assert response.status_code == 200, response.text
    target_out = get_target(client, bundle.id, ko)
    assert (target_out["confirmed_text"], target_out["status"], target_out["change_type"]) == (REWRITE, "on_hold", "tone")
    (suggestion,) = read_suggestions()
    assert (read_decision(ko).suggestion_id, suggestion.adoption) == (suggestion.id, None)


def test_structural_change_type_is_not_inherited(client: TestClient, fake_ai: FakeAi) -> None:
    # 받아 보류한 나눔 두 문장 중 하나를 버리면 나눔이 아니다 — 행의 종류를 이어받지 않고 사람에게 고르게 한다
    bundle, ko, _ = suggest_first_pair(client, fake_ai, rewrites=SPLIT_REWRITES)
    assert use_suggestion(client, bundle.id, ko, action="hold").status_code == 200
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
    assert use_suggestion(client, bundle.id, ko).status_code == 200

    response = save_unit(client, bundle.id, ko, text=EDITED, change_type="rewritten")

    assert response.status_code == 200, response.text
    (history,) = read_rows(TargetTextHistory)
    assert (history.previous_text, history.changed_by) == (REWRITE, "qa.member")


def test_confirm_unchanged_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)

    response = use_suggestion(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    (suggestion,) = read_suggestions()
    assert (suggestion.adoption, suggestion.adopted_by) == ("as_is", "qa.member")
    assert suggestion.adopted_at is not None
    assert response.json()["units"][0]["decision"]["suggestion_id"] == suggestion.id
    # 입구 1 새 문장은 사람이 만든 것이라 제안에 잇지 않는다 — 판단이 제안을 가리킨다
    assert response.json()["targets"][0]["suggestion_id"] is None


def test_confirm_with_edited_text_records_edited(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)

    response = use_suggestion(client, bundle.id, ko, text=EDITED, change_type="rewritten")

    assert response.status_code == 200, response.text
    (suggestion,) = read_suggestions()
    assert suggestion.adoption == "edited"
    assert get_target(client, bundle.id, ko)["confirmed_text"] == EDITED
    assert suggestion.content["rewrites"]["ko"] == [REWRITE]  # 제안의 글은 제안 기록에 남는다
    assert read_decision(ko).suggestion_id == suggestion.id


def test_confirm_with_other_location_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)

    response = use_suggestion(client, bundle.id, ko, slot_key=OTHER_SLOT)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "rejected"


def test_own_sentence_elsewhere_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    # 받은 글을 버리고 사람이 원문 그대로 다른 자리에 만들었다
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    body = build_use_body([ko])
    body["targets"] = [{"key": "t", "target_doc_id": bundle.sop_id, "slot_key": OTHER_SLOT, "source_unit_ids": [ko]}]

    response = save_group(client, bundle.id, body)

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
    assert read_suggestions()[0].content["disposition"] == "delete"

    response = use_suggestion(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "as_is"
    assert (read_decision(ko).status, read_decision(ko).disposition) == ("confirmed", "delete")


def test_placing_a_delete_suggestion_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai, candidate="delete", change_type="as_is", rewrites={})
    body = build_use_body([ko])
    body["units"][0].update(disposition="assigned", reason="")
    body["targets"] = [{"key": "t", "target_doc_id": bundle.sop_id, "slot_key": "purpose", "source_unit_ids": [ko]}]

    response = save_group(client, bundle.id, body)

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

    response = use_suggestion(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "as_is"
    assert get_target(client, bundle.id, ko)["wi_step"] == 1


def test_dropping_one_of_two_rewrites_records_edited(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai, rewrites=SPLIT_REWRITES)
    body = build_use_body([ko])
    body["targets"] = [{**body["targets"][0], "change_type": "rewritten"}]

    response = save_group(client, bundle.id, body)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "edited"


def test_confirming_both_rewrites_of_a_split_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai, rewrites=SPLIT_REWRITES)

    response = use_suggestion(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    assert [item["change_type"] for item in response.json()["targets"]] == ["split", "split"]
    assert read_suggestions()[0].adoption == "as_is"


def test_merging_a_person_chosen_unit_records_edited(client: TestClient, fake_ai: FakeAi) -> None:
    # 글자·자리가 같아도 출처를 더하면 제안 그대로가 아니다 — 제안 밖의 단위는 제안에 잇지 않는다
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    other, = find_ids(client, bundle, AI_KO_2)
    body = build_use_body([ko])
    body["units"].append({"unit_id": other, "revision": read_decision(other).revision, "disposition": "assigned"})
    body["targets"][0]["source_unit_ids"] = [ko, other]

    response = save_group(client, bundle.id, body)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "edited"
    assert read_decision(other).suggestion_id is None


def test_kind_without_a_rule_stays_undecided(client: TestClient, fake_ai: FakeAi) -> None:
    # 복합 문장 나누기 제안은 저장과 견줄 것이 없어 판정 규칙이 없다 — 사람의 저장은 그대로 돈다
    bundle = make_ai_bundle(client)
    ko, = find_ids(client, bundle, AI_KO_1)
    attach_suggestion(bundle.id, ko, "split")

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": ko, "revision": read_decision(ko).revision, "disposition": "assigned"}],
        "targets": [{"key": "t", "target_doc_id": bundle.sop_id, "slot_key": "purpose", "source_unit_ids": [ko]}],
    })

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption is None


def suggest_table(client: TestClient, fake_ai: FakeAi) -> tuple[AiBundle, dict]:
    bundle = make_ai_bundle(client)
    table = find_kind(upload_second_document(client, bundle.id, tbl(CELLS)), "table")
    use_reply(fake_ai)
    queue_units(client, bundle.id, [table["id"]])
    run_jobs()
    return bundle, table


def test_table_suggestion_compares_the_cells(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, table = suggest_table(client, fake_ai)

    response = use_table(client, bundle.id, table)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "as_is"


def test_reshaped_table_records_edited(client: TestClient, fake_ai: FakeAi) -> None:
    # 칸 글·출처가 같아도 격자가 다르면 그대로가 아니다(§6.7) — 첫 판정이 남으니 여기서 틀리면 고칠 길이 없다
    bundle, table = suggest_table(client, fake_ai)

    response = use_table(client, bundle.id, table, is_reshaped=True)

    assert response.status_code == 200, response.text
    (table_target,) = [item for item in response.json()["targets"] if item["kind"] == "table"]
    assert (table_target["grid"], table_target["change_type"]) == ({"rows": 4, "cols": 1}, "table_restructured")
    assert read_suggestions()[0].adoption == "edited"


def test_edited_cell_records_edited(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, table = suggest_table(client, fake_ai)

    response = use_table(client, bundle.id, table, edited_cell=("합성 압력", "합성 압력 값"))

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "edited"


def test_hold_records_nothing_until_confirmed(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)

    held = use_suggestion(client, bundle.id, ko, action="hold", text=EDITED, change_type="rewritten")

    assert held.status_code == 200, held.text
    assert read_suggestions()[0].adoption is None
    # 보류가 판단을 제안에 이어 두었으니 나중의 확정은 제안을 다시 싣지 않아도 채택을 정한다
    confirmed = save_unit(client, bundle.id, ko, change_type="rewritten")
    assert confirmed.status_code == 200, confirmed.text
    assert read_suggestions()[0].adoption == "edited"  # 비운 글은 보류 때 고친 글이다


def test_later_edit_keeps_the_first_adoption(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    assert use_suggestion(client, bundle.id, ko).status_code == 200
    first_at = read_suggestions()[0].adopted_at

    response = save_unit(client, bundle.id, ko, text=EDITED, change_type="rewritten")

    assert response.status_code == 200, response.text
    (suggestion,) = read_suggestions()
    assert (suggestion.adoption, suggestion.adopted_at) == ("as_is", first_at)
    assert read_decision(ko).suggestion_id == suggestion.id


def test_save_without_suggestion_id_leaves_the_suggestion_undecided(client: TestClient, fake_ai: FakeAi) -> None:
    # 제안과 똑같이 저장해도 사람이 받지(Use) 않았으면 채택이 아니다 — 판단도 제안에 잇지 않는다
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    body = build_use_body([ko])
    del body["suggestion_id"]

    response = save_group(client, bundle.id, body)

    assert response.status_code == 200, response.text
    (suggestion,) = read_suggestions()
    assert (suggestion.adoption, suggestion.adopted_by) == (None, None)
    assert read_decision(ko).suggestion_id is None
    assert suggestion.result == "stale"  # 받지 않고 확정한 줄의 제안은 밀려난다
    assert "classify" not in get_adoption(client, bundle.id)  # 살아 있는 제안도 채택도 없어 집계에 없다


def test_clearing_a_row_confirmed_without_use_offers_it_to_classify_again(client: TestClient, fake_ai: FakeAi) -> None:
    # 받지 않고 확정한 줄의 제안이 살아 있으면 나중에 지운 줄을 문서 범위 분류가 already_suggested로 영영 건너뛴다
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    body = build_use_body([ko])
    del body["suggestion_id"]
    assert save_group(client, bundle.id, body).status_code == 200
    assert clear_unit(client, bundle.id, ko).status_code == 200

    response = request_classify(client, bundle.id, document_id=bundle.document_id)

    assert response.status_code == 200, response.text
    assert {"unit_id": ko, "reason": "already_suggested"} not in response.json()["skipped"]
    assert ko in {unit_id for job in read_rows(AiJob) if job.kind == "classify" for unit_id in job.unit_ids}


@pytest.mark.parametrize("case", ["unknown", "other_bundle", "wrong_kind"])
def test_unusable_suggestion_id_is_refused(client: TestClient, fake_ai: FakeAi, case: str) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    before = read_decision(ko)
    body = build_use_body([ko])
    if case == "unknown":
        body["suggestion_id"] = 999_999
    elif case == "other_bundle":
        other = make_ai_bundle(client)
        (other_ko,) = find_ids(client, other, AI_KO_1)
        body["suggestion_id"] = attach_suggestion(other.id, other_ko, "classify")
    else:  # 번역·나누기 제안은 판단에 잇지 않는다
        body["suggestion_id"] = attach_suggestion(bundle.id, ko, "split")

    response = save_group(client, bundle.id, body)

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == {"code": "suggestion_not_found", "suggestion_id": body["suggestion_id"]}
    decision = read_decision(ko)
    assert (decision.status, decision.revision, decision.suggestion_id) == ("unassigned", before.revision, None)
    assert get_group_by_unit(client, bundle.id, ko)["targets"] == []
    assert {row.adoption for row in read_suggestions()} == {None}


# --- 짝이 나눠 쓰는 제안 ---


def test_first_side_of_a_pair_decides_the_shared_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    assert use_suggestion(client, bundle.id, ko).status_code == 200
    assert read_suggestions()[0].adoption == "as_is"

    response = use_suggestion(client, bundle.id, en, text="An edited synthetic rewrite.", change_type="rewritten")

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "as_is"
    assert read_decision(en).suggestion_id == read_suggestions()[0].id


def test_saving_both_sides_judges_them_together(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    body = build_use_body([ko, en])
    ko_target, en_target = body["targets"]
    assert (ko_target["text"], en_target["text"]) == (REWRITES["ko"], REWRITES["en"])
    en_target.update(text="An edited synthetic rewrite.", change_type="rewritten")

    response = save_group(client, bundle.id, body)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "edited"


def test_held_units_of_two_suggestions_are_judged_apart_in_one_save(client: TestClient, fake_ai: FakeAi) -> None:
    # 저장 하나는 제안 하나만 싣는다 — 보류로 저마다 제안에 이어 둔 단위를 한 저장에서 확정하면 제안마다 제 단위의 새 문장만 견준다
    bundle = make_ai_bundle(client)
    use_reply(fake_ai)
    first, second = find_ids(client, bundle, AI_KO_1, AI_KO_2)
    assert client.post(
        f"/api/bundles/{bundle.id}/ai/classify", json={"document_id": bundle.document_id}, headers=AUTHOR
    ).json()["queued"] == 2
    run_jobs()
    assert use_suggestion(client, bundle.id, first, action="hold").status_code == 200
    assert use_suggestion(client, bundle.id, second, action="hold").status_code == 200

    response = save_unit(client, bundle.id, first, second, change_type="tone")

    assert response.status_code == 200, response.text
    assert [suggestion.adoption for suggestion in read_suggestions()] == ["as_is", "as_is"]


def test_re_request_keeps_a_suggestion_with_a_recorded_adoption(client: TestClient, fake_ai: FakeAi) -> None:
    # 한쪽을 받아 확정한 뒤 다른 쪽을 다시 받아도 그 채택이 통계에 남는다
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    assert use_suggestion(client, bundle.id, en).status_code == 200
    (adopted,) = read_suggestions()

    queue_units(client, bundle.id, [ko])
    run_jobs()

    first, second = read_suggestions()
    assert (first.id, first.result, first.adoption) == (adopted.id, "applied", "as_is")
    assert (second.result, second.adoption, second.content["unit_ids"]) == ("applied", None, [ko])
    assert read_decision(en).suggestion_id == first.id
    assert read_decision(ko).suggestion_id is None  # 새 제안은 사람이 받기 전까지 판단에 잇지 않는다
    assert get_adoption(client, bundle.id)["classify"] == {
        "applied": 2, "as_is": 1, "edited": 0, "rejected": 0, "pending": 1, "adoption_rate": 1.0,
    }


def test_held_side_confirmed_after_a_re_request_still_counts(client: TestClient, fake_ai: FakeAi) -> None:
    # 받아 보류한 것은 채택이 아니라 다른 쪽을 다시 받으면 제안이 밀린다 — 그 뒤 확정해도 채택은 채택률에 든다
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    assert use_suggestion(client, bundle.id, en, action="hold").status_code == 200
    queue_units(client, bundle.id, [ko])
    run_jobs()
    assert [suggestion.result for suggestion in read_suggestions()] == ["stale", "applied"]

    response = save_unit(client, bundle.id, en, change_type="tone")

    assert response.status_code == 200, response.text
    assert [(row.result, row.adoption) for row in read_suggestions()] == [("stale", "as_is"), ("applied", None)]
    assert get_adoption(client, bundle.id)["classify"] == {
        "applied": 1, "as_is": 1, "edited": 0, "rejected": 0, "pending": 1, "adoption_rate": 1.0,
    }


def test_stale_suggestion_can_still_be_used(client: TestClient, fake_ai: FakeAi) -> None:
    # 사람이 보던 카드가 그 사이 밀렸어도 받은 것은 사람의 결정이다 — 확정했으니 더 새 제안도 받을 수 없어 밀려난다
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    stale = read_suggestions()[0]
    queue_units(client, bundle.id, [ko, en])
    run_jobs()
    assert [row.result for row in read_suggestions()] == ["stale", "applied"]

    response = save_group(client, bundle.id, build_use_body([ko], suggestion=stale))

    assert response.status_code == 200, response.text
    assert [(row.result, row.adoption) for row in read_suggestions()] == [("stale", "as_is"), ("stale", None)]
    assert read_decision(ko).suggestion_id == stale.id


# --- 배정 지우기·일괄 ---


def test_clear_of_a_held_suggestion_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    assert use_suggestion(client, bundle.id, ko, action="hold").status_code == 200

    response = clear_unit(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    (suggestion,) = read_suggestions()
    assert (suggestion.result, suggestion.adoption, suggestion.adopted_by) == ("applied", "rejected", "qa.member")
    assert get_group_by_unit(client, bundle.id, ko)["units"][0]["decision"]["suggestion_id"] is None
    assert get_group_by_unit(client, bundle.id, ko)["targets"] == []


def test_clear_after_confirm_keeps_the_first_adoption(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    assert use_suggestion(client, bundle.id, ko).status_code == 200

    response = clear_unit(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "as_is"
    assert read_decision(ko).suggestion_id is None


@pytest.mark.parametrize("action", ["delete", "move_external"])
def test_bulk_disposal_leaves_an_untaken_suggestion_undecided(client: TestClient, fake_ai: FakeAi, action: str) -> None:
    # 받지 않은 제안이 덮는 줄 — 일괄 처분은 채택을 남기지 않고 그 제안을 밀어낸다(받을 수 없게 됐다)
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    assert get_adoption(client, bundle.id)["classify"]["pending"] == 1

    response = bulk_dispose(client, bundle.id, ko, en, action=action)

    assert response.status_code == 200, response.text
    for unit_id in (ko, en):
        decision = read_decision(unit_id)
        assert (decision.status, decision.disposition, decision.suggestion_id) == ("confirmed", action, None)
    (suggestion,) = read_suggestions()
    assert (suggestion.adoption, suggestion.result) == (None, "stale")
    assert "classify" not in get_adoption(client, bundle.id)
    assert read_rows(TargetSentence) == []


def read_pair_of(unit_id: int) -> tuple[int, str, set[int]]:
    """(짝 id, 상태, 구성 단위) — 짝이 풀렸으면 단위가 짝 구성원 표에 없다."""
    members = read_rows(UnitPairMember)
    (pair_id,) = [row.pair_id for row in members if row.unit_id == unit_id]
    (pair,) = [row for row in read_rows(UnitPair) if row.id == pair_id]
    return pair.id, pair.status, {row.unit_id for row in members if row.pair_id == pair_id}


def test_bulk_over_one_side_of_a_pair_leaves_the_other_side(client: TestClient, fake_ai: FakeAi) -> None:
    # 제안이 짝을 덮어도 AI는 판단을 쓰지 않았으니 걷을 것이 없다 — 고르지 않은 쪽은 그대로다
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    en_before = read_decision(en)
    pair_before = read_pair_of(ko)
    assert pair_before[2] == {ko, en}

    response = bulk_dispose(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    decision, other = read_decision(ko), read_decision(en)
    assert (decision.status, decision.disposition) == ("confirmed", "delete")
    assert (other.status, other.disposition, other.suggestion_id, other.revision) == (
        "unassigned", "unassigned", None, en_before.revision,
    )
    assert read_suggestions()[0].adoption is None
    # settle_pairs: 정한 운명은 삭제 하나뿐이고 다른 쪽은 미배정이라 짝을 풀지도 확정하지도 않는다
    assert read_pair_of(ko) == pair_before


@pytest.mark.usefixtures("clean_embedding_cache")
def test_bulk_over_a_unit_with_a_match_suggestion_leaves_the_new_sentence(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 계획은 문장 묶음을 제안으로만 남긴다 — 새 문서의 문장은 출처 없이 미배정 그대로고 일괄 처분이 단위를 받는다
    bundle = make_match_bundle(client, p(MATCH_OLD), p(MATCH_NEW))
    use_vectors(monkeypatch, fake_ai, {MATCH_OLD: 0, MATCH_NEW: 0})
    (unit_id,) = read_old_ids(client, bundle, MATCH_OLD)
    plan(client, bundle.id)
    written = read_target(MATCH_NEW)
    (suggestion,) = read_suggestions()
    assert suggestion.content["links"] == [[written.id, unit_id]]
    assert (read_decision(unit_id).status, read_links()) == ("unassigned", set())

    response = bulk_dispose(client, bundle.id, unit_id)

    assert response.status_code == 200, response.text
    decision = read_decision(unit_id)
    assert (decision.status, decision.disposition, decision.suggestion_id) == ("confirmed", "delete", None)
    new_target = read_target(MATCH_NEW)
    assert (new_target.id, new_target.status, new_target.suggestion_id, new_target.revision) == (
        written.id, "unassigned", None, written.revision,
    )
    assert read_links() == set()
    assert read_suggestions()[0].adoption is None


def test_bulk_still_refuses_units_with_confirmed_targets(client: TestClient, fake_ai: FakeAi) -> None:
    # 사람이 확정한 새 문장이 달린 줄은 지금처럼 통째 거절한다 — 섞인 제안 줄도 그대로다
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    human = find_unit(get_view(client, bundle.id, bundle.document_id), AI_KO_2)
    assign_as_is(client, bundle.id, human, bundle.sop_id, slot_key="purpose")
    before = read_decision(ko)

    response = bulk_dispose(client, bundle.id, ko, en, human["id"])

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == {"code": "unit_has_targets", "unit_ids": [human["id"]]}
    decision = read_decision(ko)
    assert (decision.status, decision.revision, decision.suggestion_id) == ("unassigned", before.revision, None)
    assert read_suggestions()[0].adoption is None


@pytest.mark.usefixtures("clean_embedding_cache")
def test_bulk_over_a_match_table_finds_no_cell_links(client: TestClient, fake_ai: FakeAi) -> None:
    # 표 묶음 제안도 칸 연결을 쓰지 않는다 — 걷을 출처가 없어 일괄 처분이 표 단위를 받고 새 문장은 미배정 그대로다
    bundle = make_match_bundle(client, tbl(CELLS), tbl([CELLS[0], ["합성 압력 범위", CELLS[1][1]]]))
    table_unit = find_kind(get_view(client, bundle.id, bundle.old_document_id), "table")["id"]
    plan(client, bundle.id)
    (suggestion,) = read_suggestions()
    assert table_unit in suggestion.content["unit_ids"] and read_links() == set()

    response = bulk_dispose(client, bundle.id, table_unit)

    assert response.status_code == 200, response.text
    assert (read_decision(table_unit).status, read_decision(table_unit).disposition) == ("confirmed", "delete")
    assert read_links() == set()
    assert {row.status for row in read_rows(TargetSentence)} == {"unassigned"}


@pytest.mark.parametrize("status", ["confirmed", "on_hold"])
def test_bulk_refuses_a_linked_target_even_in_ai_status(client: TestClient, fake_ai: FakeAi, status: str) -> None:
    # 지킴 시험 — 지금 길로는 만들 수 없는 모양을 DB에 직접 만든다: 단위를 출처로 둔 새 문장이 AI 제안 상태다.
    # 일괄 처분은 이제 어떤 새 문장도 걷지 않으므로 상태와 상관없이 거절해야 처분한 단위에 매달린 채 남지 않는다
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    assert use_suggestion(client, bundle.id, ko).status_code == 200
    (target_id,) = [target_id for target_id, unit_id in read_links() if unit_id == ko]
    update_row(TargetSentence, target_id, status="ai_suggested")
    update_row(UnitDecision, ko, status=status)
    before = read_decision(ko)

    response = bulk_dispose(client, bundle.id, ko)

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == {"code": "unit_has_targets", "unit_ids": [ko]}
    assert (read_decision(ko).status, read_decision(ko).revision) == (status, before.revision)
    assert {target_id for target_id, unit_id in read_links() if unit_id == ko} == {target_id}


@pytest.mark.parametrize(("candidate", "expected"), [("delete", "as_is"), ("c1", "rejected")])
def test_bulk_disposal_of_a_held_suggestion_records_adoption(
    client: TestClient, fake_ai: FakeAi, candidate: str, expected: str
) -> None:
    # 받아 둔 채 보류한 단위는 일괄 처분을 지날 수 있다 — 사람의 확정이라 채택도 남는다
    bundle = make_ai_bundle(client)
    ko, en = find_ids(client, bundle, AI_KO_1, AI_EN_1)
    use_reply(fake_ai, candidate=candidate, rewrites={} if candidate == "delete" else {
        "ko": [REWRITES["ko"]], "en": [REWRITES["en"]],
    })
    queue_units(client, bundle.id, [ko, en])
    run_jobs()
    held = hold_without_targets(client, bundle.id, ko)
    assert held.status_code == 200, held.text
    assert read_decision(ko).suggestion_id == read_suggestions()[0].id

    response = bulk_dispose(client, bundle.id, ko)

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == expected


def test_bulk_new_confirm_of_a_linked_target_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    # 입구 2 신규 제안(Task 12)을 받아 보류해 둔 새 문장을 한 번에 확정하는 길 — 제안은 시험이 직접 붙인다
    bundle = make_ai_bundle(client)
    uploaded = upload(client, bundle.id, build_docx(p(LONE_TEXT)), NEW_FILE, side="new", doc_type="sop")
    assert uploaded.status_code == 201, uploaded.text
    target_id = attach_new_target_suggestion(bundle.id, uploaded.json()["target_doc_id"])
    held = use_new_target(client, bundle.id, target_id, action="hold")
    assert held.status_code == 200, held.text
    assert read_suggestions()[0].adoption is None

    response = client.post(
        f"/api/bundles/{bundle.id}/match/bulk-confirm",
        json={"new": [{"target_id": target_id, "revision": held.json()["targets"][0]["revision"]}]}, headers=AUTHOR,
    )

    assert response.status_code == 200, response.text
    (suggestion,) = read_suggestions()
    assert (suggestion.adoption, suggestion.adopted_by) == ("as_is", "qa.member")
    assert response.json()["targets"][0]["suggestion_id"] == suggestion.id


def test_using_a_new_suggestion_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    # 입구 2 신규 제안을 받으면 그 새 문장이 제안에 이어진다 — 판단이 없어 새 문장 쪽에서 채택을 정한다
    bundle = make_ai_bundle(client)
    uploaded = upload(client, bundle.id, build_docx(p(LONE_TEXT)), NEW_FILE, side="new", doc_type="sop")
    assert uploaded.status_code == 201, uploaded.text
    target_id = attach_new_target_suggestion(bundle.id, uploaded.json()["target_doc_id"])

    response = use_new_target(client, bundle.id, target_id)

    assert response.status_code == 200, response.text
    (suggestion,) = read_suggestions()
    (saved_target,) = response.json()["targets"]
    assert (saved_target["status"], saved_target["change_type"], saved_target["suggestion_id"]) == (
        "confirmed", "new", suggestion.id,
    )
    assert suggestion.adoption == "as_is"


def test_removing_a_linked_new_doc_target_drops_and_rejects_its_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    # 입구 2 새 문장은 지워지지 않고 미배정으로 돌아간다 — 이어 둔 제안이 남으면 낡은 근거를 가리킨다
    bundle = make_ai_bundle(client)
    uploaded = upload(client, bundle.id, build_docx(p(LONE_TEXT)), NEW_FILE, side="new", doc_type="sop")
    assert uploaded.status_code == 201, uploaded.text
    target_id = attach_new_target_suggestion(bundle.id, uploaded.json()["target_doc_id"])
    assert use_new_target(client, bundle.id, target_id, action="hold").status_code == 200

    response = save_group(client, bundle.id, {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [target_id]})

    assert response.status_code == 200, response.text
    (row,) = [item for item in read_rows(TargetSentence) if item.id == target_id]
    assert (row.status, row.suggestion_id) == ("unassigned", None)
    assert read_suggestions()[0].adoption == "rejected"


@pytest.mark.usefixtures("clean_embedding_cache")
def test_using_a_match_suggestion_records_as_is(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 묶기 제안의 묶음(links)과 변경 종류를 그대로 받아 확정한다
    bundle = make_match_bundle(client, p(MATCH_OLD), p(MATCH_NEW))
    use_vectors(monkeypatch, fake_ai, {MATCH_OLD: 0, MATCH_NEW: 0})
    (unit_id,) = read_old_ids(client, bundle, MATCH_OLD)
    plan(client, bundle.id)
    (suggestion,) = read_suggestions()
    content = suggestion.content
    targets = {row.id: row for row in read_rows(TargetSentence)}

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": unit_id, "revision": read_decision(unit_id).revision, "disposition": "assigned"}],
        "targets": [
            {
                "key": str(target_id), "id": target_id, "revision": targets[target_id].revision, "source_unit_ids": [source_id],
                "change_type": content["target_change_types"][str(target_id)],
            }
            for target_id, source_id in content["links"]
        ],
        "suggestion_id": suggestion.id,
    })

    assert response.status_code == 200, response.text
    assert read_suggestions()[0].adoption == "as_is"
    assert read_decision(unit_id).suggestion_id == suggestion.id
    assert {item["suggestion_id"] for item in response.json()["targets"]} == {suggestion.id}


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


def test_retiring_one_side_takes_the_suggestion_out_of_pending(client: TestClient, fake_ai: FakeAi) -> None:
    # 받기 전의 제안은 덮는 단위가 모두 살아 있고 미배정일 때만 대기다 — 한쪽이 은퇴하면 다른 쪽이 미배정이어도 빠진다
    bundle, ko, en = suggest_first_pair(client, fake_ai)

    edit_document(client, bundle.id, bundle.document_id, {"type": "split", "unit_id": ko, "at": 3}, confirm=True)

    assert read_suggestions()[0].adoption is None
    assert read_decision(en).status == "unassigned"
    assert get_adoption(client, bundle.id)["classify"]["pending"] == 0


def test_held_side_of_a_retired_pair_stays_pending(client: TestClient, fake_ai: FakeAi) -> None:
    # 받아 보류한 쪽이 제안을 가리키는 동안은 다른 쪽이 은퇴해도 사람이 정할 몫이다
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    assert use_suggestion(client, bundle.id, en, action="hold").status_code == 200

    edit_document(client, bundle.id, bundle.document_id, {"type": "split", "unit_id": ko, "at": 3}, confirm=True)

    assert read_suggestions()[0].adoption is None
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
    assert use_suggestion(client, bundle.id, first).status_code == 200
    assert use_suggestion(client, bundle.id, second, text=EDITED, change_type="rewritten").status_code == 200

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
    assert use_suggestion(client, bundle.id, ko).status_code == 200
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
