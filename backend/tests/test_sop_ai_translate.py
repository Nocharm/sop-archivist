"""AI 번역 — 요청 대상 고르기, 번역 새 문장 적용, 낡음·무효·다시 받기, 사람 확정과 채택, 떼어 내기, 결과물 A·C·Excel (설계 §6.5, §7.5, §7.9, §7.12, §7.13)."""

import json
from io import BytesIO

import httpx2
import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AiUsageEvent
from app.settings import settings
from app.sop.ai import jobs
from app.sop.ai.translate import TranslateReply
from app.sop.constants import SYSTEM_HOLD_RELATED_CHANGED
from app.sop.models import AiJob, AiSuggestion, Bundle, TargetSentence
from tests.access_helpers import run_in_session
from tests.ai_fixtures import (
    AI_EN_1,
    AI_EN_2,
    AI_KO_1,
    AI_KO_2,
    AI_SOP_DOC,
    AI_WI_DOC,
    REWRITES,
    AiBundle,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    edit_document,
    find_ids,
    find_kind,
    get_target,
    make_ai_bundle,
    queue_units,
    read_rows,
    run_jobs,
    upload_second_document,
    use_reply,
)
from tests.docx_factory import build_docx, p, tbl
from tests.fake_ai import FakeAi
from tests.sop_helpers import (
    AUTHOR,
    REVIEWER,
    assign_as_is,
    find_unit,
    get_group_by_unit,
    get_view,
    put_tobe,
    save_group,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs")

LONE_KO = "합성 세 번째 문장을 시험한다."
LONE_KO_2 = "합성 네 번째 문장을 시험한다."
LONE_EN = "Test the fifth synthetic sentence."
EDITED = "합성 세 번째 문장을 반드시 시험한다."
TRANSLATED = "The third synthetic sentence shall be tested."
SLOT = "purpose"
OTHER_SLOT = "scope"
CELL_TEXT = "합성 압력"
CELL_TRANSLATED = "Synthetic pressure"
CELLS = [["합성 항목", "합성 값"], [CELL_TEXT, "합성 결과"]]
THIRD_FILE = "SYNTHETIC_OLD-THIRD.docx"
NEW_FILE = "SYNTHETIC_SOP-T_New.docx"


def use_translation(ai: FakeAi, text: str = TRANSLATED) -> None:
    ai.chat = lambda data: json.dumps({"text": text}, ensure_ascii=False)


def request_translate(
    client: TestClient, bundle_id: int, direction: str = "ko_to_en", *, headers: dict[str, str] = AUTHOR, **scope: object
) -> httpx2.Response:
    return client.post(f"/api/bundles/{bundle_id}/ai/translate", json={"direction": direction, **scope}, headers=headers)


def queue_translation(client: TestClient, bundle_id: int, unit_id: int, direction: str = "ko_to_en") -> None:
    response = request_translate(client, bundle_id, direction, unit_ids=[unit_id])
    assert response.status_code == 200, response.text
    assert (response.json()["queued"], response.json()["skipped_total"]) == (1, 0), response.text


def load_translations(unit_id: int) -> list[TargetSentence]:
    return [target for target in read_rows(TargetSentence) if target.translation_source_unit_id == unit_id]


def load_translation(unit_id: int) -> TargetSentence:
    (target,) = load_translations(unit_id)
    return target


def translate(client: TestClient, ai: FakeAi, bundle_id: int, unit_id: int, text: str = TRANSLATED) -> TargetSentence:
    """단위를 번역해 두고 번역 새 문장을 돌려준다."""
    use_translation(ai, text)
    queue_translation(client, bundle_id, unit_id)
    run_jobs()
    return load_translation(unit_id)


def make_assigned_unit(client: TestClient, text: str = LONE_KO) -> tuple[AiBundle, dict]:
    """짝 없는 문장 하나를 SOP 칸에 그대로 확정해 둔 묶음."""
    bundle = make_ai_bundle(client)
    unit = upload_second_document(client, bundle.id, p(text))["units"][0]
    assign_as_is(client, bundle.id, unit, bundle.sop_id, slot_key=SLOT)
    return bundle, unit


def make_assigned_table(client: TestClient) -> tuple[AiBundle, dict, dict]:
    """데이터 표를 SOP 칸에 그대로 확정해 둔 묶음 — 묶음과 표 단위, 칸 문장 하나를 돌려준다."""
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, tbl(CELLS))
    table = find_kind(view, "table")
    assign_as_is(client, bundle.id, table, bundle.sop_id, slot_key=SLOT)
    return bundle, table, find_unit(view, CELL_TEXT)


def save_translation(
    client: TestClient, bundle_id: int, target: TargetSentence, *, action: str = "confirm", **changes: object
) -> httpx2.Response:
    return save_group(client, bundle_id, {
        "action": action,
        "hold_reason": "합성 보류" if action == "hold" else "",
        "units": [],
        "targets": [
            {"key": "t", "id": target.id, "revision": target.revision, "source_unit_ids": [], "text": None, **changes}
        ],
    })


def remove_translation(client: TestClient, bundle_id: int, target: TargetSentence) -> httpx2.Response:
    return save_group(client, bundle_id, {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [target.id]})


def read_suggestions() -> list[AiSuggestion]:
    return [row for row in read_rows(AiSuggestion) if row.kind == "translate"]


def read_source_target_id(target: TargetSentence) -> int:
    return next(row for row in read_suggestions() if row.id == target.suggestion_id).content["source_target_id"]


def get_output_a(client: TestClient, bundle_id: int, lang: str) -> list[dict]:
    response = client.get(f"/api/bundles/{bundle_id}/outputs/a", params={"lang": lang}, headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def get_output_c(client: TestClient, bundle_id: int, lang: str) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/outputs/c", params={"lang": lang}, headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def get_adoption(client: TestClient, bundle_id: int) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/ai/status", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()["adoption"]["translate"]


def read_slot_items(output: dict, code: str, slot_key: str = SLOT) -> list[dict]:
    doc = next(doc for doc in output["docs"] if doc["code"] == code)
    return next(section for section in doc["sections"] if section["location_key"] == slot_key)["items"]


def clear_unit(client: TestClient, bundle_id: int, unit_id: int) -> httpx2.Response:
    revision = get_group_by_unit(client, bundle_id, unit_id)["units"][0]["decision"]["revision"]
    return client.post(
        f"/api/bundles/{bundle_id}/decisions/clear", json={"unit_id": unit_id, "revision": revision}, headers=AUTHOR
    )


def save_table_as_read(
    client: TestClient, bundle_id: int, unit_id: int, *, link_translation: bool = True
) -> httpx2.Response:
    """표 단위의 지금 묶음을 그대로 다시 확정한다 — 칸 새 문장은 표 새 문장 아래로, 칸 번역은 link_translation일 때만 parent_key로."""
    group = get_group_by_unit(client, bundle_id, unit_id)
    table = next(target for target in group["targets"] if target["kind"] == "table")
    targets = []
    for target in group["targets"]:
        is_linked = target["parent_target_id"] == table["id"] and (link_translation or target["origin"] != "translation")
        targets.append({
            "key": str(target["id"]), "id": target["id"], "revision": target["revision"],
            "slot_key": target["slot_key"], "wi_step": target["wi_step"], "wi_part": target["wi_part"],
            "kind": target["kind"], "source_unit_ids": target["source_unit_ids"],
            "parent_key": str(table["id"]) if is_linked else None,
        })
    return save_group(client, bundle_id, {
        "action": "confirm",
        "units": [{"unit_id": unit_id, "revision": group["units"][0]["decision"]["revision"], "disposition": "assigned"}],
        "targets": targets,
    })


# --- 요청 ---


def test_translation_uses_confirmed_text_else_ai_text(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, p(LONE_KO) + p(LONE_KO_2))
    confirmed, suggested = find_unit(view, LONE_KO)["id"], find_unit(view, LONE_KO_2)["id"]
    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": confirmed, "revision": 1, "disposition": "assigned"}],
        "targets": [{
            "key": "t", "target_doc_id": bundle.sop_id, "slot_key": SLOT, "source_unit_ids": [confirmed],
            "text": EDITED, "change_type": "rewritten",
        }],
    })
    assert response.status_code == 200, response.text
    use_reply(fake_ai)
    queue_units(client, bundle.id, [suggested])
    run_jobs()

    use_translation(fake_ai)
    assert request_translate(client, bundle.id, unit_ids=[confirmed, suggested]).json()["queued"] == 2
    run_jobs()

    assert [request["text"] for request in fake_ai.requests[-2:]] == [EDITED, REWRITES["ko"]]


def test_unassigned_units_are_skipped(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, p(LONE_KO))
    unit_id = view["units"][0]["id"]

    by_unit = request_translate(client, bundle.id, unit_ids=[unit_id]).json()
    by_document = request_translate(client, bundle.id, document_id=view["document"]["id"]).json()

    expected = {"queued": 0, "skipped_total": 1, "skipped": [{"unit_id": unit_id, "reason": "not_assigned"}]}
    assert by_unit == expected and by_document == expected
    assert read_rows(AiJob) == []


def test_units_with_opposite_pair_are_skipped(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    ko, en = find_ids(client, bundle, AI_KO_1, AI_EN_1)
    view = get_view(client, bundle.id, bundle.document_id)
    for text in (AI_KO_1, AI_EN_1):
        assign_as_is(client, bundle.id, find_unit(view, text), bundle.sop_id, slot_key=SLOT)

    from_ko = request_translate(client, bundle.id, unit_ids=[ko]).json()
    from_en = request_translate(client, bundle.id, "en_to_ko", unit_ids=[en]).json()

    assert from_ko["skipped"] == [{"unit_id": ko, "reason": "has_pair"}] and from_ko["queued"] == 0
    assert from_en["skipped"] == [{"unit_id": en, "reason": "has_pair"}] and from_en["queued"] == 0


def test_other_language_and_existing_translation_are_skipped(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])

    other = request_translate(client, bundle.id, "en_to_ko", unit_ids=[unit["id"]]).json()
    assert other["skipped"] == [{"unit_id": unit["id"], "reason": "other_language"}]

    for action in ("confirm", "hold"):
        target = load_translation(unit["id"])
        assert save_translation(client, bundle.id, target, action=action).status_code == 200
        existing = request_translate(client, bundle.id, unit_ids=[unit["id"]]).json()
        assert existing["skipped"] == [{"unit_id": unit["id"], "reason": "already_translated"}], action
    assert len(load_translations(unit["id"])) == 1


def test_document_scope_looks_only_at_the_source_language(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    ko_ids = find_ids(client, bundle, AI_KO_1, AI_KO_2)

    body = request_translate(client, bundle.id, document_id=bundle.document_id).json()

    assert body["skipped"] == [{"unit_id": unit_id, "reason": "not_assigned"} for unit_id in ko_ids]


def test_bound_cell_is_translatable_but_the_table_unit_is_not(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, table, cell = make_assigned_table(client)

    table_only = request_translate(client, bundle.id, unit_ids=[table["id"]]).json()
    by_cell = request_translate(client, bundle.id, unit_ids=[cell["id"]]).json()

    assert table_only["skipped"] == [{"unit_id": table["id"], "reason": "other_language"}]
    assert (by_cell["queued"], by_cell["skipped"]) == (1, [])


def test_active_job_is_reported_as_already_queued(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    queue_translation(client, bundle.id, unit["id"])

    again = request_translate(client, bundle.id, unit_ids=[unit["id"]]).json()

    assert again["skipped"] == [{"unit_id": unit["id"], "reason": "already_queued"}] and again["queued"] == 0


def test_request_over_the_limit_reports_limit_reached(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, p(LONE_KO) + p(LONE_KO_2))
    for text in (LONE_KO, LONE_KO_2):
        assign_as_is(client, bundle.id, find_unit(view, text), bundle.sop_id, slot_key=SLOT)
    monkeypatch.setattr(jobs, "MAX_JOBS_PER_REQUEST", 1)

    body = request_translate(client, bundle.id, document_id=view["document"]["id"]).json()

    assert (body["queued"], body["skipped"]) == (1, [{"unit_id": find_unit(view, LONE_KO_2)["id"], "reason": "limit_reached"}])


def test_request_needs_author_scope_direction_and_an_editable_bundle(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)

    assert request_translate(client, bundle.id, document_id=bundle.document_id, headers=REVIEWER).status_code == 403
    no_scope = request_translate(client, bundle.id)
    assert (no_scope.status_code, no_scope.json()["detail"]["code"]) == (422, "scope_required")
    assert request_translate(client, bundle.id, "ko_to_de", unit_ids=[unit["id"]]).status_code == 422
    assert client.post(
        f"/api/bundles/{bundle.id}/ai/translate", json={"unit_ids": [unit["id"]]}, headers=AUTHOR
    ).status_code == 422
    unknown = request_translate(client, bundle.id, unit_ids=[unit["id"] + 100000])
    assert (unknown.status_code, unknown.json()["detail"]["code"]) == (404, "unit_not_found")

    async def _set_in_review(session: AsyncSession) -> None:
        await session.execute(update(Bundle).where(Bundle.id == bundle.id).values(status="in_review"))
        await session.commit()

    run_in_session(_set_in_review)
    refused = request_translate(client, bundle.id, unit_ids=[unit["id"]])
    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "bundle_not_editable")


def test_request_needs_ai_enabled(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle, unit = make_assigned_unit(client)
    monkeypatch.setattr(settings, "ai_enabled", False)

    refused = request_translate(client, bundle.id, unit_ids=[unit["id"]])

    assert (refused.status_code, refused.json()["detail"]["code"]) == (503, "ai_disabled")


# --- 적용 ---


def test_translation_target_shares_location_and_is_ai_suggested(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    unit_id = unit["id"]

    target = translate(client, fake_ai, bundle.id, unit_id)

    assert (target.lang, target.origin, target.change_type, target.status) == ("en", "translation", "translated", "ai_suggested")
    assert (target.slot_key, target.translation_source_unit_id) == ("purpose", unit_id)
    assert (target.target_doc_id, target.kind, target.ai_text, target.confirmed_text) == (bundle.sop_id, "sentence", TRANSLATED, "")
    # 원문·판단은 그대로다 — 번역은 사람이 요청한 덤이라 단위를 건드리지 않는다
    group = get_group_by_unit(client, bundle.id, unit_id)
    assert group["units"][0]["decision"]["status"] == "confirmed"
    assert [item["id"] for item in group["targets"]] != [target.id]


def test_translation_in_a_wi_keeps_step_and_part_and_asks_for_wi_style(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    response = put_tobe(
        client, bundle.id, [AI_SOP_DOC, AI_WI_DOC],
        wi_steps=[{"code": AI_WI_DOC["code"], "step_no": 2, "title": "Synthetic step"}],
    )
    assert response.status_code == 200, response.text
    unit = upload_second_document(client, bundle.id, p(LONE_KO))["units"][0]
    assign_as_is(client, bundle.id, unit, bundle.wi_id, wi_step=2, wi_part="why")

    target = translate(client, fake_ai, bundle.id, unit["id"])

    assert (target.target_doc_id, target.slot_key, target.wi_step, target.wi_part) == (bundle.wi_id, None, 2, "why")
    assert fake_ai.requests[-1]["doc_type"] == "wi"


def test_payload_carries_only_the_text_languages_and_doc_type(
    client: TestClient, fake_ai: FakeAi, clean_ai_usage: None
) -> None:
    bundle, unit = make_assigned_unit(client)

    translate(client, fake_ai, bundle.id, unit["id"])

    assert fake_ai.requests[-1] == {"task": "translate", "text": LONE_KO, "from": "ko", "to": "en", "doc_type": "sop"}
    assert fake_ai.bodies[-1]["chat_template_kwargs"]["reasoning_effort"] == "low"
    system = fake_ai.messages[-1][0]["content"]
    assert "R02" in system and "translate one sentence" in system
    assert {event.feature for event in read_rows(AiUsageEvent)} == {"sop.translate"}


def test_english_source_is_translated_into_korean(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client, LONE_EN)
    use_translation(fake_ai, LONE_KO)

    queue_translation(client, bundle.id, unit["id"], "en_to_ko")
    run_jobs()

    assert fake_ai.requests[-1]["from"] == "en" and fake_ai.requests[-1]["to"] == "ko"
    assert (load_translation(unit["id"]).lang, load_translation(unit["id"]).ai_text) == ("ko", LONE_KO)


def test_suggestion_record_follows_the_contract(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    source = get_target(client, bundle.id, unit["id"])

    target = translate(client, fake_ai, bundle.id, unit["id"])

    (suggestion,) = read_suggestions()
    assert suggestion.content == {
        "unit_id": unit["id"], "source_target_id": source["id"], "to": "en", "target_id": target.id, "text": TRANSLATED,
    }
    assert (suggestion.result, target.suggestion_id) == ("applied", suggestion.id)
    assert suggestion.document_id == get_group_by_unit(client, bundle.id, unit["id"])["units"][0]["document_id"]
    assert set(suggestion.guideline_versions) == {"rules", "prompt.translate"}
    assert suggestion.model == "glm-test" and suggestion.input_refs["extraction_id"]
    assert read_rows(AiJob)[-1].target_ids == [source["id"]]
    assert (read_rows(AiJob)[-1].unit_ids, read_rows(AiJob)[-1].payload) == ([unit["id"]], {"to": "en"})


def test_cross_language_number_check_warns(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client, "합성 시료를 10분 동안 둔다.")

    target = translate(client, fake_ai, bundle.id, unit["id"], "Leave the synthetic sample for 20 minutes.")

    assert target.warnings == [{"kind": "number_mismatch", "source": "10", "target": "20"}]
    assert read_suggestions()[0].warnings == target.warnings


def test_matching_numbers_across_languages_do_not_warn(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client, "합성 시료를 10분 동안 둔다.")

    target = translate(client, fake_ai, bundle.id, unit["id"], "Leave the synthetic sample for 10 minutes.")

    assert target.warnings == []


def test_number_check_compares_with_the_unit_text_not_the_source_target(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    unit = upload_second_document(client, bundle.id, p("합성 시료를 10분 동안 둔다."))["units"][0]
    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"}],
        "targets": [{
            "key": "t", "target_doc_id": bundle.sop_id, "slot_key": SLOT, "source_unit_ids": [unit["id"]],
            "text": "합성 시료를 20분 동안 둔다.", "change_type": "rewritten",
        }],
    })
    assert response.status_code == 200, response.text

    target = translate(client, fake_ai, bundle.id, unit["id"], "Leave the synthetic sample for 20 minutes.")

    assert target.warnings == [{"kind": "number_mismatch", "source": "10", "target": "20"}]


def test_stale_when_source_target_changed_during_call(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    source = get_target(client, bundle.id, unit["id"])
    use_translation(fake_ai)

    def edit_the_source(data: dict) -> None:
        response = save_group(client, bundle.id, {
            "action": "confirm",
            "units": [{"unit_id": unit["id"], "revision": 2, "disposition": "assigned"}],
            "targets": [{
                "key": "t", "id": source["id"], "revision": source["revision"], "slot_key": SLOT,
                "source_unit_ids": [unit["id"]], "text": EDITED, "change_type": "rewritten",
            }],
        })
        assert response.status_code == 200, response.text

    fake_ai.on_chat = edit_the_source
    queue_translation(client, bundle.id, unit["id"])

    run_jobs()

    assert load_translations(unit["id"]) == []
    (suggestion,) = read_suggestions()
    assert (suggestion.result, suggestion.content["target_id"]) == ("stale", None)
    assert read_rows(AiJob)[-1].status == "stale"


def test_stale_when_source_target_is_gone(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    use_translation(fake_ai)
    fake_ai.on_chat = lambda data: clear_unit(client, bundle.id, unit["id"])
    queue_translation(client, bundle.id, unit["id"])

    run_jobs()

    assert load_translations(unit["id"]) == []
    assert read_rows(AiJob)[-1].status == "stale"
    assert read_suggestions()[0].result == "stale"


def test_job_goes_stale_without_a_call_when_the_source_left_before_it_ran(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    queue_translation(client, bundle.id, unit["id"])
    assert clear_unit(client, bundle.id, unit["id"]).status_code == 200
    calls = len(fake_ai.requests)

    run_jobs()

    assert len(fake_ai.requests) == calls
    assert read_rows(AiJob)[-1].status == "stale" and read_suggestions() == []


def test_job_goes_stale_without_a_call_when_a_person_settled_the_translation_first(
    client: TestClient, fake_ai: FakeAi
) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    queue_translation(client, bundle.id, unit["id"])
    assert save_translation(client, bundle.id, target).status_code == 200
    calls = len(fake_ai.requests)

    run_jobs()

    assert len(fake_ai.requests) == calls
    assert read_rows(AiJob)[-1].status == "stale"
    assert load_translation(unit["id"]).status == "confirmed"


def test_person_confirming_the_old_translation_during_a_rerun_wins(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    use_translation(fake_ai, "A second synthetic translation.")
    fake_ai.on_chat = lambda data: save_translation(client, bundle.id, target)
    queue_translation(client, bundle.id, unit["id"])

    run_jobs()

    kept = load_translation(unit["id"])
    assert (kept.id, kept.status, kept.confirmed_text) == (target.id, "confirmed", TRANSLATED)
    assert read_rows(AiJob)[-1].status == "stale"


@pytest.mark.parametrize("reply", ["not json", '{"text": 3}', '{"other": "field"}', '{"text": "   "}'])
def test_invalid_reply_leaves_no_translation(client: TestClient, fake_ai: FakeAi, reply: str) -> None:
    bundle, unit = make_assigned_unit(client)
    fake_ai.chat = lambda data: reply
    queue_translation(client, bundle.id, unit["id"])

    run_jobs()

    assert load_translations(unit["id"]) == []
    (suggestion,) = read_suggestions()
    assert suggestion.result == "invalid"
    assert suggestion.warnings == [{"kind": "invalid_format", "source": "", "target": ""}]
    assert suggestion.content == {
        "unit_id": unit["id"], "source_target_id": get_target(client, bundle.id, unit["id"])["id"], "to": "en",
        "target_id": None, "text": "",
    }
    assert read_rows(AiJob)[-1].status == "done"
    # 번역은 없어도 되는 것이라 무효 응답이 원문 쪽을 보류로 돌리지 않는다(설계 §6.5)
    assert get_group_by_unit(client, bundle.id, unit["id"])["units"][0]["decision"]["status"] == "confirmed"


def test_reply_text_is_cleaned_before_it_is_stored() -> None:
    assert TranslateReply.model_validate({"text": "  A\x00B\ud800  "}).text == "A�B�"


def test_rerun_replaces_ai_translation_only(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, p(LONE_KO) + p(LONE_KO_2))
    rerun, kept = find_unit(view, LONE_KO), find_unit(view, LONE_KO_2)
    for unit in (rerun, kept):
        assign_as_is(client, bundle.id, unit, bundle.sop_id, slot_key=SLOT)
    first = translate(client, fake_ai, bundle.id, rerun["id"])
    confirmed = translate(client, fake_ai, bundle.id, kept["id"], "A confirmed synthetic translation.")
    assert save_translation(client, bundle.id, confirmed).status_code == 200

    second = translate(client, fake_ai, bundle.id, rerun["id"], "A replaced synthetic translation.")

    assert second.id != first.id and second.ai_text == "A replaced synthetic translation."
    assert load_translation(kept["id"]).status == "confirmed"
    assert [suggestion.result for suggestion in read_suggestions()] == ["stale", "applied", "applied"]
    assert get_adoption(client, bundle.id)["applied"] == 2


def test_split_unit_gets_one_translation_for_each_source_target(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    unit = upload_second_document(client, bundle.id, p(LONE_KO))["units"][0]
    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"}],
        "targets": [
            {"key": key, "target_doc_id": bundle.sop_id, "slot_key": SLOT, "source_unit_ids": [unit["id"]], "text": text}
            for key, text in (("a", "합성 첫 조각."), ("b", "합성 둘째 조각."))
        ],
    })
    assert response.status_code == 200, response.text
    fake_ai.chat = lambda data: json.dumps({"text": f"EN {data['text']}"}, ensure_ascii=False)

    assert request_translate(client, bundle.id, unit_ids=[unit["id"]]).json()["queued"] == 2
    run_jobs()
    assert {target.ai_text for target in load_translations(unit["id"])} == {"EN 합성 첫 조각.", "EN 합성 둘째 조각."}

    # 다시 받아도 조각마다 자기 번역만 밀어낸다
    assert request_translate(client, bundle.id, unit_ids=[unit["id"]]).json()["queued"] == 2
    run_jobs()
    assert {target.ai_text for target in load_translations(unit["id"])} == {"EN 합성 첫 조각.", "EN 합성 둘째 조각."}
    assert len(load_translations(unit["id"])) == 2


def test_merged_target_is_translated_once(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, p(LONE_KO) + p(LONE_KO_2))
    first, second = find_unit(view, LONE_KO)["id"], find_unit(view, LONE_KO_2)["id"]
    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": unit_id, "revision": 1, "disposition": "assigned"} for unit_id in (first, second)],
        "targets": [{
            "key": "t", "target_doc_id": bundle.sop_id, "slot_key": SLOT, "source_unit_ids": [first, second],
            "text": EDITED,
        }],
    })
    assert response.status_code == 200, response.text
    use_translation(fake_ai)

    assert request_translate(client, bundle.id, unit_ids=[first, second]).json()["queued"] == 1
    assert request_translate(client, bundle.id, unit_ids=[second]).json()["skipped"] == [
        {"unit_id": second, "reason": "already_queued"}
    ]
    run_jobs()
    assert len(load_translations(first)) == 1

    # 같은 새 문장의 다른 출처로 다시 요청해도 번역은 하나다
    assert request_translate(client, bundle.id, unit_ids=[second]).json()["queued"] == 1
    run_jobs()
    assert load_translations(first) == [] and len(load_translations(second)) == 1

    assert save_translation(client, bundle.id, load_translation(second)).status_code == 200
    assert request_translate(client, bundle.id, unit_ids=[first]).json()["skipped"] == [
        {"unit_id": first, "reason": "already_translated"}
    ]


def test_cell_translation_keeps_parent_and_coordinates(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, table, cell = make_assigned_table(client)
    group = get_group_by_unit(client, bundle.id, table["id"])
    source = next(target for target in group["targets"] if target["source_unit_ids"] == [cell["id"]])

    target = translate(client, fake_ai, bundle.id, cell["id"], CELL_TRANSLATED)

    assert (target.parent_target_id, target.cell_row, target.cell_col) == (
        source["parent_target_id"], source["cell_row"], source["cell_col"],
    )
    assert source["parent_target_id"] is not None
    assert (target.kind, target.lang, target.slot_key) == ("sentence", "en", SLOT)


def test_translation_of_a_match_target_keeps_its_section(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    unit = upload_second_document(client, bundle.id, p(LONE_KO))["units"][0]
    uploaded = upload(
        client, bundle.id, build_docx(p("1. 합성 절", "Heading1") + p(LONE_KO)), NEW_FILE, side="new", doc_type="sop",
    )
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text
    (source,) = [row for row in read_rows(TargetSentence) if row.origin == "new_doc"]
    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"}],
        "targets": [{"key": "t", "id": source.id, "revision": source.revision, "source_unit_ids": [unit["id"]]}],
    })
    assert response.status_code == 200, response.text

    target = translate(client, fake_ai, bundle.id, unit["id"])

    assert (target.target_doc_id, target.section_path) == (source.target_doc_id, "1. 합성 절")
    confirmed = save_translation(client, bundle.id, target)
    assert confirmed.status_code == 200, confirmed.text
    (doc,) = [doc for doc in get_output_c(client, bundle.id, "en")["docs"] if doc["target_doc_id"] == source.target_doc_id]
    assert [item["text"] for section in doc["sections"] for item in section["items"]] == [TRANSLATED]


# --- 사람 확정 ---


def test_confirm_translation_alone_with_no_sources(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target_id = translate(client, fake_ai, bundle.id, unit["id"]).id

    response = save_group(client, bundle.id, {"action": "confirm", "units": [], "targets": [
        {"key": "t", "id": target_id, "revision": 1, "source_unit_ids": [], "text": None}]})

    assert response.status_code == 200, response.text
    assert response.json()["targets"][0]["change_type"] == "translated"
    saved = load_translation(unit["id"])
    assert (saved.status, saved.confirmed_text, saved.ai_text, saved.slot_key) == ("confirmed", TRANSLATED, TRANSLATED, SLOT)


def test_group_read_shows_the_source_unit_of_a_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])

    response = client.get(f"/api/bundles/{bundle.id}/groups/by-target/{target.id}", headers=AUTHOR)

    assert response.status_code == 200, response.text
    assert response.json()["units"] == []
    (read,) = response.json()["targets"]
    assert (read["translation_source_unit_id"], read["source_unit_ids"], read["group_id"]) == (unit["id"], [], None)


def test_edited_translation_is_checked_against_the_unit_text(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client, "합성 시료를 10분 동안 둔다.")
    target = translate(client, fake_ai, bundle.id, unit["id"], "Leave the synthetic sample for 10 minutes.")

    edited = save_translation(client, bundle.id, target, text="Leave the synthetic sample for 30 minutes.")

    assert edited.status_code == 200, edited.text
    assert load_translation(unit["id"]).warnings == [{"kind": "number_mismatch", "source": "10", "target": "30"}]


def test_hold_keeps_the_translation_with_the_reason(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])

    assert save_translation(client, bundle.id, target, action="hold").status_code == 200

    held = load_translation(unit["id"])
    assert (held.status, held.hold_reason, held.change_type) == ("on_hold", "합성 보류", "translated")
    assert read_suggestions()[0].adoption is None


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"slot_key": OTHER_SLOT}, "translation_locked"),
        ({"cell_row": 1, "cell_col": 1}, "translation_locked"),
        ({"lang": "ko"}, "lang_mismatch"),
        ({"text": "   "}, "empty_text"),
    ],
)
def test_translation_keeps_its_place_language_and_sourcelessness(
    client: TestClient, fake_ai: FakeAi, changes: dict[str, object], reason: str
) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])

    refused = save_translation(client, bundle.id, target, **changes)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"]["reason"] == reason


def test_translation_takes_no_source_link(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    source = get_target(client, bundle.id, unit["id"])

    refused = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": unit["id"], "revision": 2, "disposition": "assigned"}],
        "targets": [
            {
                "key": "s", "id": source["id"], "revision": source["revision"], "slot_key": SLOT,
                "source_unit_ids": [unit["id"]],
            },
            {"key": "t", "id": target.id, "revision": target.revision, "source_unit_ids": [unit["id"]]},
        ],
    })

    assert refused.status_code == 422, refused.text
    assert (refused.json()["detail"]["reason"], refused.json()["detail"]["keys"]) == ("translation_locked", ["t"])


def test_translation_may_repeat_its_own_place(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])

    saved = save_translation(client, bundle.id, target, slot_key=SLOT, target_doc_id=bundle.sop_id, lang="en")

    assert saved.status_code == 200, saved.text


def test_translation_does_not_turn_source_into_split_or_group(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    source = get_target(client, bundle.id, unit["id"])

    translate(client, fake_ai, bundle.id, unit["id"])

    group = get_group_by_unit(client, bundle.id, unit["id"])
    (read,) = group["targets"]
    assert (read["id"], read["change_type"], read["group_id"]) == (source["id"], "as_is", None)
    assert group["units"][0]["group_id"] is None
    # 번역은 출처 연결이 없으니 원문 쪽 저장의 닫힘에도 끼지 않는다
    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": unit["id"], "revision": 2, "disposition": "assigned"}],
        "targets": [{
            "key": "t", "id": read["id"], "revision": read["revision"], "slot_key": SLOT,
            "source_unit_ids": [unit["id"]],
        }],
    })
    assert response.status_code == 200, response.text
    assert response.json()["targets"][0]["change_type"] == "as_is"
    rows = [row for row in get_output_a(client, bundle.id, "ko") if row["unit_id"] == unit["id"]]
    assert [(row["row_kind"], row["group_id"], row["change_type"]) for row in rows] == [("unit", None, "as_is")]


@pytest.mark.parametrize("link_translation", [True, False])
def test_cell_translation_is_saved_with_its_table(client: TestClient, fake_ai: FakeAi, link_translation: bool) -> None:
    bundle, table, cell = make_assigned_table(client)
    target = translate(client, fake_ai, bundle.id, cell["id"], CELL_TRANSLATED)

    alone = save_translation(client, bundle.id, target)
    assert (alone.status_code, alone.json()["detail"]["reason"]) == (422, "not_closed")

    saved = save_table_as_read(client, bundle.id, table["id"], link_translation=link_translation)

    assert saved.status_code == 200, saved.text
    assert load_translation(cell["id"]).status == "confirmed"
    (read,) = [item for item in saved.json()["targets"] if item["origin"] == "translation"]
    assert (read["change_type"], read["group_id"], read["parent_target_id"]) == ("translated", None, target.parent_target_id)


def test_cell_translation_cannot_stay_under_a_removed_table(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, table, cell = make_assigned_table(client)
    target = translate(client, fake_ai, bundle.id, cell["id"], CELL_TRANSLATED)
    group = get_group_by_unit(client, bundle.id, table["id"])

    refused = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{
            "unit_id": table["id"], "revision": group["units"][0]["decision"]["revision"], "disposition": "delete",
            "reason": "합성 사유",
        }],
        "targets": [{"key": "t", "id": target.id, "revision": target.revision, "source_unit_ids": []}],
        "removed_target_ids": [item["id"] for item in group["targets"] if item["id"] != target.id],
    })

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"]["reason"] == "invalid_cell_target"
    assert load_translation(cell["id"]).status == "ai_suggested"


def test_removing_a_table_with_its_cell_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, table, cell = make_assigned_table(client)
    translate(client, fake_ai, bundle.id, cell["id"], CELL_TRANSLATED)
    group = get_group_by_unit(client, bundle.id, table["id"])

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{
            "unit_id": table["id"], "revision": group["units"][0]["decision"]["revision"], "disposition": "delete",
            "reason": "합성 사유",
        }],
        "targets": [],
        "removed_target_ids": [item["id"] for item in group["targets"]],
    })

    assert response.status_code == 200, response.text
    assert load_translations(cell["id"]) == []
    assert read_suggestions()[0].adoption == "rejected"


# --- 채택 ---


def test_new_translation_is_pending_without_a_decision_row(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)

    translate(client, fake_ai, bundle.id, unit["id"])

    assert get_adoption(client, bundle.id) == {
        "applied": 1, "as_is": 0, "edited": 0, "rejected": 0, "pending": 1, "adoption_rate": None,
    }


def test_confirming_the_suggested_text_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])

    save_translation(client, bundle.id, target)

    (suggestion,) = read_suggestions()
    assert (suggestion.adoption, suggestion.adopted_by) == ("as_is", "qa.member")
    assert suggestion.adopted_at is not None
    assert get_adoption(client, bundle.id) == {
        "applied": 1, "as_is": 1, "edited": 0, "rejected": 0, "pending": 0, "adoption_rate": 1.0,
    }


def test_confirming_an_edited_text_records_edited(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])

    save_translation(client, bundle.id, target, text="An edited synthetic translation.")

    assert read_suggestions()[0].adoption == "edited"
    saved = load_translation(unit["id"])
    assert (saved.confirmed_text, saved.ai_text) == ("An edited synthetic translation.", TRANSLATED)


def test_removing_a_translation_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])

    response = remove_translation(client, bundle.id, target)

    assert response.status_code == 200, response.text
    assert load_translations(unit["id"]) == []
    assert (read_suggestions()[0].adoption, read_suggestions()[0].result) == ("rejected", "applied")
    assert get_adoption(client, bundle.id)["pending"] == 0


def test_later_edit_keeps_the_first_adoption(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    save_translation(client, bundle.id, target)

    save_translation(client, bundle.id, load_translation(unit["id"]), text="An edited synthetic translation.")

    assert read_suggestions()[0].adoption == "as_is"


def test_table_adoption_ignores_a_cell_translation_in_the_same_save(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, tbl(CELLS))
    table, cell = find_kind(view, "table"), find_unit(view, CELL_TEXT)
    use_reply(fake_ai)
    queue_units(client, bundle.id, [table["id"]])
    run_jobs()
    translate(client, fake_ai, bundle.id, cell["id"], CELL_TRANSLATED)

    saved = save_table_as_read(client, bundle.id, table["id"])

    assert saved.status_code == 200, saved.text
    assert [row.adoption for row in read_rows(AiSuggestion)] == ["as_is", "as_is"]


# --- 떼어 내기 ---


def test_retiring_the_source_removes_ai_translation_and_holds_confirmed(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, p(LONE_KO) + p(LONE_KO_2))
    document_id = view["document"]["id"]
    suggested, confirmed = find_unit(view, LONE_KO), find_unit(view, LONE_KO_2)
    for unit in (suggested, confirmed):
        assign_as_is(client, bundle.id, unit, bundle.sop_id, slot_key=SLOT)
    translate(client, fake_ai, bundle.id, suggested["id"])
    target = translate(client, fake_ai, bundle.id, confirmed["id"], "A confirmed synthetic translation.")
    assert save_translation(client, bundle.id, target).status_code == 200

    edit_document(client, bundle.id, document_id, {"type": "split", "unit_id": suggested["id"], "at": 3}, confirm=True)
    edit_document(client, bundle.id, document_id, {"type": "split", "unit_id": confirmed["id"], "at": 3}, confirm=True)

    assert load_translations(suggested["id"]) == []
    held = load_translation(confirmed["id"])
    assert (held.status, held.hold_reason) == ("on_hold", SYSTEM_HOLD_RELATED_CHANGED)
    assert (held.confirmed_text, held.revision) == ("A confirmed synthetic translation.", target.revision + 2)


def test_clearing_the_source_reports_both_translations(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    assert save_translation(client, bundle.id, target).status_code == 200

    report = clear_unit(client, bundle.id, unit["id"]).json()

    assert report["held_target_ids"] == [target.id]
    assert load_translation(unit["id"]).status == "on_hold"


def test_clearing_the_source_reports_a_removed_ai_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    source = get_target(client, bundle.id, unit["id"])

    report = clear_unit(client, bundle.id, unit["id"]).json()

    assert sorted(report["deleted_target_ids"]) == sorted([source["id"], target.id])
    assert report["held_target_ids"] == []
    assert load_translations(unit["id"]) == []


def test_new_classify_over_the_source_sweeps_its_translations(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, p(LONE_KO) + p(LONE_KO_2))
    swept, confirmed = find_unit(view, LONE_KO)["id"], find_unit(view, LONE_KO_2)["id"]
    use_reply(fake_ai)
    queue_units(client, bundle.id, [swept, confirmed])
    run_jobs()
    old_source = get_target(client, bundle.id, confirmed)
    translate(client, fake_ai, bundle.id, swept)
    target = translate(client, fake_ai, bundle.id, confirmed, "A confirmed synthetic translation.")
    assert save_translation(client, bundle.id, target).status_code == 200

    use_reply(fake_ai)
    queue_units(client, bundle.id, [swept, confirmed])
    run_jobs()

    assert load_translations(swept) == []
    held = load_translation(confirmed)
    assert (held.status, held.hold_reason, held.confirmed_text) == (
        "on_hold", SYSTEM_HOLD_RELATED_CHANGED, "A confirmed synthetic translation.",
    )
    assert get_target(client, bundle.id, confirmed)["id"] != old_source["id"]
    # 밀린 AI 번역의 제안은 낡은 것이고, 사람이 확정한 번역의 제안은 채택이 남는다
    assert sorted((row.result, row.adoption) for row in read_suggestions()) == [("applied", "as_is"), ("stale", None)]


def test_retiring_a_unit_with_only_a_confirmed_translation_asks_first(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, p(LONE_KO))
    unit = view["units"][0]
    assign_as_is(client, bundle.id, unit, bundle.sop_id, slot_key=SLOT)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    assert save_translation(client, bundle.id, target).status_code == 200
    assert clear_unit(client, bundle.id, unit["id"]).status_code == 200
    assert save_translation(client, bundle.id, load_translation(unit["id"])).status_code == 200

    refused = client.post(
        f"/api/bundles/{bundle.id}/documents/{view['document']['id']}/edits",
        json={"revision": 1, "confirm": False, "op": {"type": "split", "unit_id": unit["id"], "at": 3}},
        headers=AUTHOR,
    )

    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "confirm_required")
    assert refused.json()["detail"]["unit_ids"] == [unit["id"]]

    # 출처 새 문장은 이미 없다 — 번역이 가리키는 단위로도 찾아 보류한다
    edit_document(
        client, bundle.id, view["document"]["id"], {"type": "split", "unit_id": unit["id"], "at": 3}, confirm=True
    )
    assert load_translation(unit["id"]).status == "on_hold"


def test_deleting_the_document_takes_its_translations_along(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, p(LONE_KO))
    unit = view["units"][0]
    assign_as_is(client, bundle.id, unit, bundle.sop_id, slot_key=SLOT)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    assert save_translation(client, bundle.id, target).status_code == 200
    document = get_view(client, bundle.id, view["document"]["id"])["document"]
    url = f"/api/bundles/{bundle.id}/documents/{document['id']}?revision={document['revision']}"

    asked = client.delete(url, headers=AUTHOR)
    deleted = client.delete(f"{url}&confirm=true", headers=AUTHOR)

    assert (asked.status_code, asked.json()["detail"]["code"]) == (409, "confirm_required")
    assert deleted.status_code == 204, deleted.text
    assert [row for row in read_rows(TargetSentence) if row.id == target.id] == []


def test_clearing_a_table_frees_its_confirmed_cell_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, table, cell = make_assigned_table(client)
    translate(client, fake_ai, bundle.id, cell["id"], CELL_TRANSLATED)
    assert save_table_as_read(client, bundle.id, table["id"]).status_code == 200

    report = clear_unit(client, bundle.id, table["id"])

    assert report.status_code == 200, report.text
    held = load_translation(cell["id"])
    assert report.json()["held_target_ids"] == [held.id]
    assert (held.status, held.parent_target_id, held.cell_row, held.cell_col) == ("on_hold", None, None, None)
    # 표에서 떨어졌으니 혼자 다시 확정할 수 있다
    assert save_translation(client, bundle.id, held).status_code == 200


def test_clearing_a_table_removes_its_ai_cell_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, table, cell = make_assigned_table(client)
    target = translate(client, fake_ai, bundle.id, cell["id"], CELL_TRANSLATED)

    report = clear_unit(client, bundle.id, table["id"]).json()

    assert load_translations(cell["id"]) == []
    assert target.id in report["deleted_target_ids"]


def test_retiring_one_cell_holds_the_other_cell_translation_in_the_table(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, table, cell = make_assigned_table(client)
    document_id = get_group_by_unit(client, bundle.id, table["id"])["units"][0]["document_id"]
    other = find_unit(get_view(client, bundle.id, document_id), "합성 값")
    target = translate(client, fake_ai, bundle.id, other["id"], "Synthetic value")

    edit_document(client, bundle.id, document_id, {"type": "split", "unit_id": cell["id"], "at": 2}, confirm=True)

    held = load_translation(other["id"])
    assert (held.id, held.status, held.parent_target_id) == (target.id, "on_hold", target.parent_target_id)


# --- 검토 ---


def read_blocker_codes(client: TestClient, bundle_id: int) -> set[str]:
    response = client.get(f"/api/bundles/{bundle_id}/review/readiness", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return {blocker["code"] for blocker in response.json()["blockers"]}


def test_missing_translation_never_blocks_review(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, _ = make_assigned_unit(client)

    assert not {code for code in read_blocker_codes(client, bundle.id) if code.startswith("targets_")}


def test_unsettled_translation_blocks_review_until_a_person_decides(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    assert "targets_ai_suggested" in read_blocker_codes(client, bundle.id)

    assert save_translation(client, bundle.id, target, action="hold").status_code == 200
    assert "targets_on_hold" in read_blocker_codes(client, bundle.id)

    assert save_translation(client, bundle.id, load_translation(unit["id"])).status_code == 200
    assert not {code for code in read_blocker_codes(client, bundle.id) if code.startswith("targets_")}


def test_translation_does_not_change_the_cover_counts(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    before = client.get(f"/api/bundles/{bundle.id}/summary", headers=AUTHOR).json()

    translate(client, fake_ai, bundle.id, unit["id"])

    after = client.get(f"/api/bundles/{bundle.id}/summary", headers=AUTHOR).json()
    assert after["en"] == {**before["en"], "translated": 1}
    assert after["ko"] == before["ko"]


# --- 출처가 바뀌면 번역을 다시 본다 ---


def make_settled_translation(
    client: TestClient, ai: FakeAi, text: str = LONE_KO, translated: str = TRANSLATED
) -> tuple[AiBundle, dict, TargetSentence]:
    """확정 문장 하나와 그 번역을 사람이 확정해 둔 묶음."""
    bundle, unit = make_assigned_unit(client, text)
    target = translate(client, ai, bundle.id, unit["id"], translated)
    assert save_translation(client, bundle.id, target).status_code == 200
    return bundle, unit, load_translation(unit["id"])


def assert_held(unit_id: int, text: str = TRANSLATED) -> None:
    held = load_translation(unit_id)
    assert (held.status, held.hold_reason, held.confirmed_text) == ("on_hold", SYSTEM_HOLD_RELATED_CHANGED, text)


def read_place(target_id: int) -> tuple[int, str | None, int | None, str | None, str]:
    (target,) = [row for row in read_rows(TargetSentence) if row.id == target_id]
    return (target.target_doc_id, target.slot_key, target.wi_step, target.wi_part, target.section_path)


def confirm_held(client: TestClient, bundle_id: int, unit_id: int, source_id: int) -> None:
    """보류된 번역이 출처 자리에 있고, 사람이 그 자리 그대로 다시 확정할 수 있다 — 자리 잠금에 걸리면 지우는 수밖에 없다."""
    held = load_translation(unit_id)
    assert read_place(held.id) == read_place(source_id)
    response = save_translation(
        client, bundle_id, held, slot_key=held.slot_key, wi_step=held.wi_step, wi_part=held.wi_part,
        target_doc_id=held.target_doc_id,
    )
    assert response.status_code == 200, response.text
    assert load_translation(unit_id).status == "confirmed"


def assert_swept(client: TestClient, bundle_id: int, unit_id: int) -> None:
    """AI 번역이 지워지고 제안은 낡은 것이 됐다 — 살아 있는 제안이 없으니 채택 집계에도 이 종류가 없다."""
    assert load_translations(unit_id) == []
    assert read_suggestions()[-1].result == "stale"
    assert "translate" not in client.get(f"/api/bundles/{bundle_id}/ai/status", headers=AUTHOR).json()["adoption"]


def save_source(client: TestClient, bundle_id: int, unit_id: int, **changes: object) -> httpx2.Response:
    """단위의 새 문장 하나를 그대로 다시 저장한다 — 자리는 지금 값이고 changes가 칸을 덮는다."""
    group = get_group_by_unit(client, bundle_id, unit_id)
    (source,) = group["targets"]
    return save_group(client, bundle_id, {
        "action": "confirm",
        "units": [{"unit_id": unit_id, "revision": group["units"][0]["decision"]["revision"], "disposition": "assigned"}],
        "targets": [{
            "key": "s", "id": source["id"], "revision": source["revision"], "slot_key": source["slot_key"],
            "wi_step": source["wi_step"], "wi_part": source["wi_part"], "source_unit_ids": [unit_id], **changes,
        }],
    })


def delete_source_unit(client: TestClient, bundle_id: int, unit_id: int) -> httpx2.Response:
    """새 문장을 지우고 단위를 삭제로 확정한다."""
    group = get_group_by_unit(client, bundle_id, unit_id)
    return save_group(client, bundle_id, {
        "action": "confirm",
        "units": [{
            "unit_id": unit_id, "revision": group["units"][0]["decision"]["revision"], "disposition": "delete",
            "reason": "합성 사유",
        }],
        "targets": [],
        "removed_target_ids": [target["id"] for target in group["targets"]],
    })


def replace_source(client: TestClient, bundle_id: int, unit_id: int, target_doc_id: int) -> httpx2.Response:
    """지금 새 문장을 지우고 같은 단위로 새 문장을 만든다 — 같은 저장 안의 교체다."""
    group = get_group_by_unit(client, bundle_id, unit_id)
    return save_group(client, bundle_id, {
        "action": "confirm",
        "units": [{"unit_id": unit_id, "revision": group["units"][0]["decision"]["revision"], "disposition": "assigned"}],
        "targets": [{"key": "n", "target_doc_id": target_doc_id, "slot_key": OTHER_SLOT, "source_unit_ids": [unit_id]}],
        "removed_target_ids": [target["id"] for target in group["targets"]],
    })


def make_merged_target(client: TestClient) -> tuple[AiBundle, int, int]:
    """두 단위를 한 새 문장으로 합쳐 확정해 둔 묶음 — 합친 글에는 두 단위의 뜻이 다 든다."""
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, p(LONE_KO) + p(LONE_KO_2))
    first, second = find_unit(view, LONE_KO)["id"], find_unit(view, LONE_KO_2)["id"]
    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": unit_id, "revision": 1, "disposition": "assigned"} for unit_id in (first, second)],
        "targets": [{
            "key": "t", "target_doc_id": bundle.sop_id, "slot_key": SLOT, "source_unit_ids": [first, second],
            "text": EDITED,
        }],
    })
    assert response.status_code == 200, response.text
    return bundle, first, second


def make_wi_translation(client: TestClient, ai: FakeAi) -> tuple[AiBundle, dict, dict, TargetSentence]:
    """WI 1단계의 문장과 그 AI 번역을 둔 묶음 — 단계는 1·2가 선언돼 있다."""
    bundle = make_ai_bundle(client)
    steps = [{"code": AI_WI_DOC["code"], "step_no": step, "title": "Synthetic step"} for step in (1, 2)]
    response = put_tobe(client, bundle.id, [AI_SOP_DOC, AI_WI_DOC], wi_steps=steps)
    assert response.status_code == 200, response.text
    unit = upload_second_document(client, bundle.id, p(LONE_KO))["units"][0]
    assign_as_is(client, bundle.id, unit, bundle.wi_id, wi_step=1, wi_part="instruction")
    return bundle, unit, get_target(client, bundle.id, unit["id"]), translate(client, ai, bundle.id, unit["id"])


def put_order(client: TestClient, bundle_id: int, target_doc_id: int, items: list[dict]) -> httpx2.Response:
    revision = client.get(f"/api/bundles/{bundle_id}", headers=AUTHOR).json()["revision"]
    return client.put(
        f"/api/bundles/{bundle_id}/targets/order",
        json={"revision": revision, "target_doc_id": target_doc_id, "items": items}, headers=AUTHOR,
    )


def make_match_translation(client: TestClient, ai: FakeAi) -> tuple[AiBundle, dict, dict, TargetSentence]:
    """입구 2 새 문서의 문장을 옛 단위와 짝지어 확정하고 번역해 둔 묶음 — (묶음, 옛 단위, 새 문서 view, 번역)."""
    bundle = make_ai_bundle(client)
    unit = upload_second_document(client, bundle.id, p(LONE_KO))["units"][0]
    body = p(LONE_KO_2) + p("1. 합성 절", "Heading1") + p(LONE_KO)
    uploaded = upload(client, bundle.id, build_docx(body), NEW_FILE, side="new", doc_type="sop")
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text
    (source,) = [row for row in read_rows(TargetSentence) if row.origin == "new_doc" and row.confirmed_text == LONE_KO]
    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"}],
        "targets": [{"key": "t", "id": source.id, "revision": source.revision, "source_unit_ids": [unit["id"]]}],
    })
    assert response.status_code == 200, response.text
    target = translate(client, ai, bundle.id, unit["id"])
    return bundle, unit, get_view(client, bundle.id, uploaded.json()["id"]), target


def test_deleting_the_source_unit_holds_a_confirmed_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, _ = make_settled_translation(client, fake_ai)

    response = delete_source_unit(client, bundle.id, unit["id"])

    assert response.status_code == 200, response.text
    assert_held(unit["id"])
    assert "targets_on_hold" in read_blocker_codes(client, bundle.id)


def test_deleting_the_source_unit_removes_an_ai_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    translate(client, fake_ai, bundle.id, unit["id"])

    response = delete_source_unit(client, bundle.id, unit["id"])

    assert response.status_code == 200, response.text
    assert_swept(client, bundle.id, unit["id"])


def test_replacing_the_source_in_one_save_holds_a_confirmed_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, _ = make_settled_translation(client, fake_ai)

    response = replace_source(client, bundle.id, unit["id"], bundle.sop_id)

    assert response.status_code == 200, response.text
    assert_held(unit["id"])


def test_editing_the_source_text_holds_a_confirmed_translation(client: TestClient, fake_ai: FakeAi) -> None:
    translated = "Leave the synthetic sample for 10 minutes."
    bundle, unit, _ = make_settled_translation(client, fake_ai, "합성 시료를 10분 동안 둔다.", translated)

    response = save_source(client, bundle.id, unit["id"], text="합성 시료를 20분 동안 둔다.", change_type="rewritten")

    assert response.status_code == 200, response.text
    assert_held(unit["id"], translated)


def test_editing_the_source_text_removes_an_ai_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    translate(client, fake_ai, bundle.id, unit["id"])

    response = save_source(client, bundle.id, unit["id"], text=EDITED, change_type="rewritten")

    assert response.status_code == 200, response.text
    assert_swept(client, bundle.id, unit["id"])


def test_moving_the_source_holds_a_confirmed_translation_at_the_new_place(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, target = make_settled_translation(client, fake_ai)
    source = get_target(client, bundle.id, unit["id"])

    response = save_source(client, bundle.id, unit["id"], slot_key=OTHER_SLOT)

    assert response.status_code == 200, response.text
    assert_held(unit["id"])
    assert load_translation(unit["id"]).slot_key == OTHER_SLOT
    assert load_translation(unit["id"]).revision == target.revision + 1
    confirm_held(client, bundle.id, unit["id"], source["id"])


def test_moving_the_source_to_another_document_carries_a_settled_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, _ = make_settled_translation(client, fake_ai)
    source = get_target(client, bundle.id, unit["id"])

    response = save_source(client, bundle.id, unit["id"], target_doc_id=bundle.wi_id, slot_key=None, wi_part="why")

    assert response.status_code == 200, response.text
    assert_held(unit["id"])
    held = load_translation(unit["id"])
    assert (held.target_doc_id, held.slot_key, held.wi_step, held.wi_part) == (bundle.wi_id, None, None, "why")
    confirm_held(client, bundle.id, unit["id"], source["id"])


def test_held_translation_keeps_a_persons_edit_when_it_follows_the_source(client: TestClient, fake_ai: FakeAi) -> None:
    # 자리 잠금 때문에 옛 자리에 남으면 고친 글을 지우고 다시 받는 수밖에 없다 — 그래서 함께 옮긴다
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    assert save_translation(client, bundle.id, target, text="An edited synthetic translation.").status_code == 200

    assert save_source(client, bundle.id, unit["id"], slot_key=OTHER_SLOT).status_code == 200

    assert_held(unit["id"], "An edited synthetic translation.")
    assert save_translation(client, bundle.id, load_translation(unit["id"])).status_code == 200
    saved = load_translation(unit["id"])
    assert (saved.status, saved.confirmed_text, saved.slot_key) == ("confirmed", "An edited synthetic translation.", OTHER_SLOT)


def test_translation_saved_with_a_moved_source_follows_it(client: TestClient, fake_ai: FakeAi) -> None:
    # 같은 저장에 담겨 보류되지는 않아도, 옛 자리에 남으면 잠금 때문에 옮길 길이 없다
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    group = get_group_by_unit(client, bundle.id, unit["id"])
    (source,) = group["targets"]

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": unit["id"], "revision": group["units"][0]["decision"]["revision"], "disposition": "assigned"}],
        "targets": [
            {
                "key": "s", "id": source["id"], "revision": source["revision"], "slot_key": OTHER_SLOT,
                "source_unit_ids": [unit["id"]],
            },
            {"key": "t", "id": target.id, "revision": target.revision, "source_unit_ids": []},
        ],
    })

    assert response.status_code == 200, response.text
    saved = load_translation(unit["id"])
    assert (saved.status, saved.slot_key) == ("confirmed", OTHER_SLOT)
    assert read_place(saved.id) == read_place(source["id"])
    (read,) = [item for item in response.json()["targets"] if item["id"] == target.id]
    assert read["slot_key"] == OTHER_SLOT


def test_editing_the_source_text_leaves_a_held_translation_in_place(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, target = make_settled_translation(client, fake_ai)

    assert save_source(client, bundle.id, unit["id"], text=EDITED, change_type="rewritten").status_code == 200

    assert_held(unit["id"])
    assert read_place(target.id) == (bundle.sop_id, SLOT, None, None, "")


def test_held_translation_stays_where_it_was_when_its_source_is_gone(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, target = make_settled_translation(client, fake_ai)
    place = read_place(target.id)

    # 새 문장을 다른 칸에 새로 만들어도 지운 출처의 번역이 따라갈 자리는 아니다
    assert replace_source(client, bundle.id, unit["id"], bundle.sop_id).status_code == 200

    assert_held(unit["id"])
    assert read_place(target.id) == place and get_target(client, bundle.id, unit["id"])["slot_key"] == OTHER_SLOT


def test_moving_the_source_to_another_document_removes_an_ai_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    translate(client, fake_ai, bundle.id, unit["id"])

    response = save_source(
        client, bundle.id, unit["id"], target_doc_id=bundle.wi_id, slot_key=None, wi_part="instruction",
    )

    assert response.status_code == 200, response.text
    assert_swept(client, bundle.id, unit["id"])


def test_saving_the_source_unchanged_keeps_a_confirmed_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, target = make_settled_translation(client, fake_ai)

    response = save_source(client, bundle.id, unit["id"])

    assert response.status_code == 200, response.text
    kept = load_translation(unit["id"])
    assert (kept.status, kept.revision) == ("confirmed", target.revision)


def test_confirming_an_ai_source_unchanged_keeps_its_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    unit = upload_second_document(client, bundle.id, p(LONE_KO))["units"][0]
    use_reply(fake_ai)
    queue_units(client, bundle.id, [unit["id"]])
    run_jobs()
    target = translate(client, fake_ai, bundle.id, unit["id"])

    # text를 비우면 AI 글 그대로 확정이다 — 번역이 옮긴 글이 그대로라 바뀐 것이 아니다
    response = save_source(client, bundle.id, unit["id"])

    assert response.status_code == 200, response.text
    kept = load_translation(unit["id"])
    assert (kept.id, kept.status, kept.revision) == (target.id, "ai_suggested", target.revision)


def test_translation_saved_with_its_source_is_left_as_the_person_decided(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    group = get_group_by_unit(client, bundle.id, unit["id"])
    (source,) = group["targets"]

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [{"unit_id": unit["id"], "revision": group["units"][0]["decision"]["revision"], "disposition": "assigned"}],
        "targets": [
            {
                "key": "s", "id": source["id"], "revision": source["revision"], "slot_key": SLOT,
                "source_unit_ids": [unit["id"]], "text": EDITED, "change_type": "rewritten",
            },
            {"key": "t", "id": target.id, "revision": target.revision, "source_unit_ids": []},
        ],
    })

    assert response.status_code == 200, response.text
    assert load_translation(unit["id"]).status == "confirmed"
    assert read_suggestions()[-1].adoption == "as_is"


def test_clearing_a_merged_source_the_translation_does_not_point_at_holds_it(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, first, second = make_merged_target(client)
    target = translate(client, fake_ai, bundle.id, first)
    assert save_translation(client, bundle.id, target).status_code == 200

    report = clear_unit(client, bundle.id, second).json()

    assert_held(first)
    assert target.id in report["held_target_ids"]


def test_clearing_a_merged_source_removes_an_ai_translation_of_the_other(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, first, second = make_merged_target(client)
    target = translate(client, fake_ai, bundle.id, first)

    report = clear_unit(client, bundle.id, second).json()

    assert target.id in report["deleted_target_ids"]
    assert_swept(client, bundle.id, first)


def test_clearing_keeps_a_translation_of_another_target_in_the_group(client: TestClient, fake_ai: FakeAi) -> None:
    # 같은 관계 묶음이어도 글을 잃지 않은 새 문장의 번역까지 다시 볼 일은 아니다
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, p(LONE_KO) + p(LONE_KO_2))
    first, second = find_unit(view, LONE_KO)["id"], find_unit(view, LONE_KO_2)["id"]
    response = save_group(client, bundle.id, {
        "action": "confirm",
        "units": [
            {"unit_id": first, "revision": 1, "disposition": "assigned"},
            {"unit_id": second, "revision": 1, "disposition": "assigned", "reason": "합성 사유"},
        ],
        "targets": [
            {"key": "m", "target_doc_id": bundle.sop_id, "slot_key": SLOT, "source_unit_ids": [first, second], "text": EDITED},
            {"key": "t", "target_doc_id": bundle.wi_id, "wi_part": "why", "source_unit_ids": [second]},
        ],
    })
    assert response.status_code == 200, response.text
    (lone,) = [item for item in response.json()["targets"] if item["source_unit_ids"] == [second]]
    use_translation(fake_ai)
    assert request_translate(client, bundle.id, unit_ids=[second]).json()["queued"] == 2
    run_jobs()
    settled = [row for row in load_translations(second) if read_source_target_id(row) == lone["id"]]
    assert len(settled) == 1 and save_translation(client, bundle.id, settled[0]).status_code == 200

    clear_unit(client, bundle.id, first)

    assert [row.status for row in load_translations(second) if read_source_target_id(row) == lone["id"]] == ["confirmed"]


def test_retiring_a_matched_new_unit_holds_a_confirmed_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, view, target = make_match_translation(client, fake_ai)
    assert save_translation(client, bundle.id, target).status_code == 200

    edit_document(
        client, bundle.id, view["document"]["id"],
        {"type": "split", "unit_id": find_unit(view, LONE_KO)["id"], "at": 3}, confirm=True,
    )

    assert_held(unit["id"])


def test_retiring_a_matched_new_unit_removes_an_ai_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, view, _ = make_match_translation(client, fake_ai)

    edit_document(
        client, bundle.id, view["document"]["id"],
        {"type": "split", "unit_id": find_unit(view, LONE_KO)["id"], "at": 3}, confirm=True,
    )

    assert_swept(client, bundle.id, unit["id"])


def test_new_section_for_a_matched_source_holds_a_confirmed_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, view, target = make_match_translation(client, fake_ai)
    assert save_translation(client, bundle.id, target).status_code == 200

    # 제목을 앞 문장과 합치면 절이 사라져 출처 새 문장의 자리(절 경로)가 바뀐다
    assert target.section_path == "1. 합성 절"
    edit_document(
        client, bundle.id, view["document"]["id"],
        {"type": "merge", "unit_ids": [find_unit(view, LONE_KO_2)["id"], find_unit(view, "1. 합성 절")["id"]]},
        confirm=True,
    )

    assert_held(unit["id"])
    held = load_translation(unit["id"])
    assert held.section_path == ""
    source_id = get_target(client, bundle.id, unit["id"])["id"]
    assert read_place(held.id) == read_place(source_id)
    confirmed = save_translation(client, bundle.id, held)
    assert confirmed.status_code == 200, confirmed.text


def test_moving_the_source_to_another_step_removes_an_ai_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, source, target = make_wi_translation(client, fake_ai)

    response = put_order(client, bundle.id, bundle.wi_id, [{"target_id": source["id"], "wi_step": 2}, {"target_id": target.id}])

    assert response.status_code == 200, response.text
    assert_swept(client, bundle.id, unit["id"])


def test_moving_the_source_to_another_step_holds_a_confirmed_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, source, target = make_wi_translation(client, fake_ai)
    assert save_translation(client, bundle.id, target).status_code == 200

    response = put_order(client, bundle.id, bundle.wi_id, [{"target_id": source["id"], "wi_step": 2}, {"target_id": target.id}])

    assert response.status_code == 200, response.text
    assert_held(unit["id"])
    assert load_translation(unit["id"]).wi_step == 2
    confirm_held(client, bundle.id, unit["id"], source["id"])


def test_reordering_without_a_step_change_keeps_the_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, source, target = make_wi_translation(client, fake_ai)
    assert save_translation(client, bundle.id, target).status_code == 200

    response = put_order(client, bundle.id, bundle.wi_id, [{"target_id": target.id}, {"target_id": source["id"]}])

    assert response.status_code == 200, response.text
    assert load_translation(unit["id"]).status == "confirmed"


def test_order_refuses_moving_a_translation_to_another_step(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, source, target = make_wi_translation(client, fake_ai)

    refused = put_order(client, bundle.id, bundle.wi_id, [{"target_id": source["id"]}, {"target_id": target.id, "wi_step": 2}])

    assert (refused.status_code, refused.json()["detail"]["code"]) == (422, "translation_locked")
    assert refused.json()["detail"]["target_ids"] == [target.id]
    assert load_translation(unit["id"]).wi_step == 1


# --- 이전 번역 찾기 ---


def test_replacing_the_source_then_rerunning_leaves_one_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    translate(client, fake_ai, bundle.id, unit["id"])
    assert replace_source(client, bundle.id, unit["id"], bundle.sop_id).status_code == 200

    translate(client, fake_ai, bundle.id, unit["id"], "A second synthetic translation.")

    assert load_translation(unit["id"]).ai_text == "A second synthetic translation."


def test_ai_translation_of_a_gone_source_is_replaced(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    first = translate(client, fake_ai, bundle.id, unit["id"])
    old_source = get_target(client, bundle.id, unit["id"])
    assert replace_source(client, bundle.id, unit["id"], bundle.sop_id).status_code == 200

    # 어느 경로로든 출처가 사라졌는데 AI 번역이 남은 모습 — 지금 경로는 쓸어 내므로 행을 직접 되돌려 둔다
    async def _restore(session: AsyncSession) -> None:
        session.add(TargetSentence(
            id=first.id, bundle_id=first.bundle_id, target_doc_id=first.target_doc_id, slot_key=first.slot_key, lang="en",
            kind="sentence", ai_text=TRANSLATED, change_type="translated", origin="translation", status="ai_suggested",
            translation_source_unit_id=unit["id"], suggestion_id=first.suggestion_id, revision=1,
        ))
        await session.commit()

    run_in_session(_restore)
    assert read_suggestions()[0].content["source_target_id"] == old_source["id"]

    translate_again = "A second synthetic translation."
    use_translation(fake_ai, translate_again)
    queue_translation(client, bundle.id, unit["id"])
    run_jobs()

    assert load_translation(unit["id"]).ai_text == translate_again


def test_settled_translation_of_a_gone_source_blocks_a_new_one(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit, _ = make_settled_translation(client, fake_ai)
    assert replace_source(client, bundle.id, unit["id"], bundle.sop_id).status_code == 200

    body = request_translate(client, bundle.id, unit_ids=[unit["id"]]).json()

    assert body["skipped"] == [{"unit_id": unit["id"], "reason": "already_translated"}]


def test_held_translation_of_a_cleared_merged_source_blocks_a_new_one(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, first, second = make_merged_target(client)
    target = translate(client, fake_ai, bundle.id, first)
    assert save_translation(client, bundle.id, target).status_code == 200
    assert clear_unit(client, bundle.id, first).status_code == 200
    assert_held(first)

    # 남은 출처로 물어도 같은 새 문장의 번역이 이미 보류로 있다
    body = request_translate(client, bundle.id, unit_ids=[second]).json()

    assert body["skipped"] == [{"unit_id": second, "reason": "already_translated"}]
    assert load_translations(second) == []


def test_invalid_rerun_keeps_the_previous_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    fake_ai.chat = lambda data: "not json"

    queue_translation(client, bundle.id, unit["id"])
    run_jobs()

    kept = load_translation(unit["id"])
    assert (kept.id, kept.ai_text, kept.status) == (target.id, TRANSLATED, "ai_suggested")
    assert [(row.result, row.id == kept.suggestion_id) for row in read_suggestions()] == [("applied", True), ("invalid", False)]
    assert read_rows(AiJob)[-1].status == "done"


# --- 결과물 ---


def test_output_a_places_translation_after_source_position(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    third = upload(client, bundle.id, build_docx(p(LONE_EN)), THIRD_FILE)
    assert third.status_code == 201, third.text
    source_display_id = get_group_by_unit(client, bundle.id, unit["id"])["units"][0]["display_id"]
    translate(client, fake_ai, bundle.id, unit["id"])

    rows = get_output_a(client, bundle.id, "en")

    index = [row["row_kind"] for row in rows].index("translation")
    assert rows[index]["display_id"] == source_display_id and rows[index]["source_text"] == ""
    assert [row["source_text"] for row in rows[:index]] == [AI_EN_1, AI_EN_2]
    assert [row["source_text"] for row in rows[index + 1:]] == [LONE_EN]
    source_row = next(row for row in get_output_a(client, bundle.id, "ko") if row["unit_id"] == unit["id"])
    row = rows[index]
    assert (row["location"], row["old_doc_code"], row["old_doc_version"], row["unit_id"]) == (
        {**source_row["location"], "place": "Paragraph"}, source_row["old_doc_code"], source_row["old_doc_version"],
        unit["id"],
    )
    assert (row["lang"], row["dest_kind"], row["dest_doc_code"], row["dest_location"]) == ("en", "sop", "SOP-AI", "Purpose")
    assert (row["ai_text"], row["confirmed_text"], row["change_type"], row["status"]) == (
        TRANSLATED, "", "translated", "ai_suggested",
    )


def test_output_a_shows_the_translation_only_in_its_language(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    translate(client, fake_ai, bundle.id, unit["id"])

    assert "translation" not in {row["row_kind"] for row in get_output_a(client, bundle.id, "ko")}


def test_output_a_row_shows_who_confirmed_the_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    assert save_translation(client, bundle.id, target).status_code == 200

    (row,) = [row for row in get_output_a(client, bundle.id, "en") if row["row_kind"] == "translation"]

    assert (row["confirmed_text"], row["status"], row["confirmed_by"]) == (TRANSLATED, "confirmed", "qa.member")
    assert row["confirmed_at"] is not None


def test_output_a_shows_the_table_row_ahead_of_a_translated_cell(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, table, cell = make_assigned_table(client)
    assert "table" not in {row["row_kind"] for row in get_output_a(client, bundle.id, "en")}

    translate(client, fake_ai, bundle.id, cell["id"], CELL_TRANSLATED)

    kinds = [row["row_kind"] for row in get_output_a(client, bundle.id, "en")]
    assert kinds.index("table") < kinds.index("translation")


def test_output_c_and_summary_include_translations(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    target = translate(client, fake_ai, bundle.id, unit["id"])

    (item,) = read_slot_items(get_output_c(client, bundle.id, "en"), "SOP-AI")
    summary = client.get(f"/api/bundles/{bundle.id}/summary", headers=AUTHOR).json()

    assert (item["target_id"], item["lang"], item["ai_text"], item["change_type"]) == (target.id, "en", TRANSLATED, "translated")
    assert item["source_note"].startswith("← ") and item["source_note"].endswith(" (translated)")
    assert (summary["en"]["translated"], summary["ko"]["translated"]) == (1, 0)
    (ko_item,) = read_slot_items(get_output_c(client, bundle.id, "ko"), "SOP-AI")
    assert ko_item["text"] == LONE_KO


def test_output_c_note_in_korean_marks_a_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client, LONE_EN)
    use_translation(fake_ai, LONE_KO)
    queue_translation(client, bundle.id, unit["id"], "en_to_ko")
    run_jobs()

    items = read_slot_items(get_output_c(client, bundle.id, "ko"), "SOP-AI")

    assert [item["source_note"].rsplit(" ", 1)[-1] for item in items] == ["(번역)"]


def test_output_c_puts_a_cell_translation_under_its_table(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, table, cell = make_assigned_table(client)
    target = translate(client, fake_ai, bundle.id, cell["id"], CELL_TRANSLATED)

    (item,) = read_slot_items(get_output_c(client, bundle.id, "en"), "SOP-AI")

    assert item["kind"] == "table"
    translated = [child for child in item["children"] if child["target_id"] == target.id]
    assert [(child["ai_text"], child["cell_row"], child["cell_col"]) for child in translated] == [
        (CELL_TRANSLATED, target.cell_row, target.cell_col)
    ]


def test_output_c_sorts_a_translation_by_its_source_unit(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    later = upload(client, bundle.id, build_docx(p(LONE_EN)), THIRD_FILE)
    assert later.status_code == 201, later.text
    english = get_view(client, bundle.id, later.json()["id"])["units"][0]
    assign_as_is(client, bundle.id, english, bundle.sop_id, slot_key=SLOT)

    # 번역이 나중에 만들어졌어도 앞선 문서의 단위를 옮긴 것이라 뒤 문서의 영어 문장 앞에 온다
    translate(client, fake_ai, bundle.id, unit["id"])

    items = read_slot_items(get_output_c(client, bundle.id, "en"), "SOP-AI")
    assert [item["text"] or item["ai_text"] for item in items] == [TRANSLATED, LONE_EN]


def test_manual_order_keeps_a_translation_next_to_its_source(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    other = upload(client, bundle.id, build_docx(p(LONE_EN)), THIRD_FILE)
    assert other.status_code == 201, other.text
    other_unit = get_view(client, bundle.id, other.json()["id"])["units"][0]
    assign_as_is(client, bundle.id, other_unit, bundle.sop_id, slot_key=SLOT)
    source, english = get_target(client, bundle.id, unit["id"]), get_target(client, bundle.id, other_unit["id"])
    revision = client.get(f"/api/bundles/{bundle.id}", headers=AUTHOR).json()["revision"]
    reordered = client.put(
        f"/api/bundles/{bundle.id}/targets/order",
        json={
            "revision": revision, "target_doc_id": bundle.sop_id,
            "items": [{"target_id": source["id"]}, {"target_id": english["id"]}],
        },
        headers=AUTHOR,
    )
    assert reordered.status_code == 200, reordered.text

    target = translate(client, fake_ai, bundle.id, unit["id"])

    assert target.order_index == 0
    assert [item["target_id"] for item in read_slot_items(get_output_c(client, bundle.id, "en"), "SOP-AI")] == [
        target.id, english["id"],
    ]


def test_held_translation_of_a_retired_unit_stays_visible(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    view = upload_second_document(client, bundle.id, p(LONE_KO))
    unit = view["units"][0]
    assign_as_is(client, bundle.id, unit, bundle.sop_id, slot_key=SLOT)
    target = translate(client, fake_ai, bundle.id, unit["id"])
    assert save_translation(client, bundle.id, target).status_code == 200
    edit_document(
        client, bundle.id, view["document"]["id"], {"type": "split", "unit_id": unit["id"], "at": 3}, confirm=True
    )

    (row,) = [row for row in get_output_a(client, bundle.id, "en") if row["row_kind"] == "translation"]
    (item,) = read_slot_items(get_output_c(client, bundle.id, "en"), "SOP-AI")
    summary = client.get(f"/api/bundles/{bundle.id}/summary", headers=AUTHOR).json()
    workbook = client.get(f"/api/bundles/{bundle.id}/export.xlsx", params={"lang": "en"}, headers=AUTHOR)

    assert (row["status"], row["confirmed_text"], row["display_id"], row["old_doc_code"]) == ("on_hold", TRANSLATED, "", "")
    assert (row["unit_id"], row["location"]["section"]) == (unit["id"], "")
    assert (item["target_id"], item["source_note"]) == (target.id, "")
    assert summary["en"]["translated"] == 1
    assert workbook.status_code == 200


def test_excel_a_sheet_has_the_translation_row(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit = make_assigned_unit(client)
    translate(client, fake_ai, bundle.id, unit["id"])
    source_display_id = get_group_by_unit(client, bundle.id, unit["id"])["units"][0]["display_id"]

    response = client.get(f"/api/bundles/{bundle.id}/export.xlsx", params={"lang": "en"}, headers=AUTHOR)

    assert response.status_code == 200, response.text
    workbook = load_workbook(BytesIO(response.content))
    (row,) = [cells for cells in workbook["A Comparison"].iter_rows(values_only=True) if TRANSLATED in cells]
    assert source_display_id in row and "Translated" in row and "AI suggested" in row
    (summary,) = [cells for cells in workbook["B Flow"].iter_rows(values_only=True) if cells[0] == "Translated"]
    assert summary[1] == 1
