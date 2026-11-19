"""AI 제안 일괄 수락 — 종류별 미리 보기(받을 것·뺄 것), 사람의 저장 경로로 받기(그대로 채택·누른 사람), 삭제 사유, 신규, 건너뛰기,
되돌리기 한 단계 (설계 2026-11-19-ai-suggest-only D3, §5 3-2~3-5)."""

import json

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.sop.ai.adoption import build_rewrite_shapes
from app.sop.models import AiSuggestion, TargetSentence, Unit, UnitDecision, UnitPairMember
from tests.access_helpers import update_row
from tests.ai_fixtures import (
    AI_EN_1,
    AI_KO_1,
    AI_KO_2,
    REWRITES,
    AiBundle,
    MatchBundle,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    clean_embedding_cache,  # noqa: F401
    find_ids,
    find_kind,
    make_ai_bundle,
    make_match_bundle,
    queue_units,
    read_decision,
    read_links,
    read_old_ids,
    read_rows,
    request_match,
    run_jobs,
    run_plan,
    upload_second_document,
    use_reply,
)
from tests.docx_factory import p, tbl
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, REVIEWER, get_group_by_unit

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs", "clean_embedding_cache")

DELETE_REASON = "합성 일괄 삭제 사유"
SPLIT_REWRITES = {"ko": ["합성 하나다.", "합성 둘이다."], "en": [REWRITES["en"]]}
MATCH_OLD = "합성 장비의 전원을 켠 뒤 상태 표시등을 확인한다."
MATCH_NEW = "합성 장비의 전원을 켠 뒤 상태 표시등을 확인하여야 한다."
MATCH_OLD_EN = "Turn on the synthetic instrument and check the status lamp."
MATCH_NEW_EN = "Turn on the synthetic instrument and always check the status lamp."
LONE_OLD = "옛 문서에만 남은 교육 일정 공지문이다."
LONE_NEW = "새로 넣은 비상 연락망 안내 문장이다."
CELLS = [["합성 항목", "합성 값"], ["합성 압력", "10 bar"]]
UNDO = {"session": "accept-test"}


def suggest_first_pair(client: TestClient, fake_ai: FakeAi, **reply: object) -> tuple[AiBundle, int, int]:
    bundle = make_ai_bundle(client)
    ko, en = find_ids(client, bundle, AI_KO_1, AI_EN_1)
    use_reply(fake_ai, **reply)
    queue_units(client, bundle.id, [ko, en])
    run_jobs()
    return bundle, ko, en


def make_match(client: TestClient, fake_ai: FakeAi, old: str, new: str) -> MatchBundle:
    """옛 문서·입구 2 문서 하나씩에 묶기 계획과 다듬기를 끝까지 돌린 묶음."""
    bundle = make_match_bundle(client, p(old), p(new))
    fake_ai.chat = lambda data: json.dumps({"change_type": "tone", "reason": "합성 이유.", "rule_ids": ["R02"]}, ensure_ascii=False)
    response = request_match(client, bundle.id)
    assert response.status_code == 200, response.text
    run_jobs()
    return bundle


def preview(client: TestClient, bundle_id: int, kind: str, document_id: int | None = None) -> dict:
    params: dict[str, object] = {"kind": kind}
    if document_id is not None:
        params["document_id"] = document_id
    response = client.get(f"/api/bundles/{bundle_id}/ai/accept-preview", params=params, headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def accept(client: TestClient, bundle_id: int, kind: str, ids: list[int], **body: object) -> httpx2.Response:
    return client.post(f"/api/bundles/{bundle_id}/ai/accept", json={"kind": kind, "suggestion_ids": ids, **body}, headers=AUTHOR)


def accept_all(client: TestClient, bundle_id: int, kind: str, document_id: int | None = None, **body: object) -> dict:
    ids = [item["suggestion_id"] for item in preview(client, bundle_id, kind, document_id)["items"]]
    response = accept(client, bundle_id, kind, ids, **body)
    assert response.status_code == 200, response.text
    return response.json()


def read_suggestion(suggestion_id: int) -> AiSuggestion:
    (row,) = [row for row in read_rows(AiSuggestion) if row.id == suggestion_id]
    return row


# --- 분류 ---


def test_preview_lists_the_live_classify_suggestion_of_the_document(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, _, _ = suggest_first_pair(client, fake_ai)

    out = preview(client, bundle.id, "classify", bundle.document_id)

    assert [(item["shape"], item["is_delete"]) for item in out["items"]] == [("assigned", False)]
    assert (out["excluded_warnings"], out["excluded_provisional"], out["excluded_changed"]) == (0, 0, 0)


def test_accepting_classify_confirms_by_the_person_and_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, en = suggest_first_pair(client, fake_ai)

    out = accept_all(client, bundle.id, "classify", bundle.document_id)

    assert out == {"accepted": 1, "skipped": 0}
    for unit_id in (ko, en):
        decision = read_decision(unit_id)
        assert (decision.status, decision.disposition, decision.confirmed_by) == ("confirmed", "assigned", "qa.member")
    texts = {target["confirmed_text"] for unit_id in (ko, en) for target in get_group_by_unit(client, bundle.id, unit_id)["targets"]}
    assert texts == set(REWRITES.values())
    (suggestion,) = read_rows(AiSuggestion)
    assert (suggestion.adoption, suggestion.adopted_by) == ("as_is", "qa.member")


def test_an_ai_split_is_saved_in_its_own_shape(client: TestClient, fake_ai: FakeAi) -> None:
    # 화면 Use는 칸 수가 맞을 때만 글을 채우지만 일괄 수락은 제안 모양 그대로 저장한다
    bundle, ko, _ = suggest_first_pair(client, fake_ai, rewrites=SPLIT_REWRITES)

    accept_all(client, bundle.id, "classify", bundle.document_id)

    targets = [target for target in get_group_by_unit(client, bundle.id, ko)["targets"] if target["lang"] == "ko"]
    assert sorted((target["confirmed_text"], target["change_type"]) for target in targets) == [
        ("합성 둘이다.", "split"), ("합성 하나다.", "split"),
    ]
    assert read_rows(AiSuggestion)[0].adoption == "as_is"


def test_delete_suggestions_take_an_optional_common_remark(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, _ = suggest_first_pair(client, fake_ai, candidate="delete", change_type="as_is", rewrites={})
    out = preview(client, bundle.id, "classify", bundle.document_id)
    assert [(item["shape"], item["is_delete"]) for item in out["items"]] == [("delete", True)]
    ids = [item["suggestion_id"] for item in out["items"]]

    accepted = accept(client, bundle.id, "classify", ids, delete_reason=f"  {DELETE_REASON} ")

    assert accepted.status_code == 200, accepted.text
    decision = read_decision(ko)
    assert (decision.status, decision.disposition, decision.reason) == ("confirmed", "delete", DELETE_REASON)
    assert read_rows(AiSuggestion)[0].adoption == "as_is"


def test_delete_suggestions_go_through_without_a_remark(client: TestClient, fake_ai: FakeAi) -> None:
    """Remark는 선택이다(요청서 4번) — 비우고 받아도 삭제로 확정된다."""
    bundle, ko, _ = suggest_first_pair(client, fake_ai, candidate="delete", change_type="as_is", rewrites={})
    ids = [item["suggestion_id"] for item in preview(client, bundle.id, "classify", bundle.document_id)["items"]]

    accepted = accept(client, bundle.id, "classify", ids)

    assert accepted.status_code == 200, accepted.text
    decision = read_decision(ko)
    assert (decision.status, decision.disposition, decision.reason) == ("confirmed", "delete", "")


def test_suggestions_with_warnings_stay_out(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, _, _ = suggest_first_pair(client, fake_ai)
    (suggestion,) = read_rows(AiSuggestion)
    update_row(AiSuggestion, suggestion.id, warnings=[{"code": "evidence_not_found", "message": "합성"}])

    out = preview(client, bundle.id, "classify", bundle.document_id)
    response = accept(client, bundle.id, "classify", [suggestion.id])

    assert (out["items"], out["excluded_warnings"]) == ([], 1)
    assert response.json() == {"accepted": 0, "skipped": 1}
    assert read_suggestion(suggestion.id).adoption is None


@pytest.mark.parametrize("change", ["held", "lang"])
def test_a_unit_changed_after_the_suggestion_is_skipped(client: TestClient, fake_ai: FakeAi, change: str) -> None:
    # 사람이 그 사이 정했거나(보류) 언어를 고쳐 고쳐 쓴 글의 언어가 어긋났다 — 글을 고치면 단위가 은퇴해 제안이 살아 있지 않다
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    (suggestion,) = read_rows(AiSuggestion)
    if change == "held":
        update_row(UnitDecision, ko, status="on_hold")
    else:
        update_row(Unit, ko, lang="en")

    out = preview(client, bundle.id, "classify", bundle.document_id)
    response = accept(client, bundle.id, "classify", [suggestion.id])

    assert (out["items"], out["excluded_changed"]) == ([], 1)
    assert response.json() == {"accepted": 0, "skipped": 1}
    assert read_decision(ko).status != "confirmed"


def test_a_suggestion_over_one_side_of_a_pair_is_skipped(client: TestClient, fake_ai: FakeAi) -> None:
    # 받으면 남은 쪽의 짝을 풀어야 한다 — 일괄로 짝을 조용히 풀지 않는다
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    assert {row.unit_id for row in read_rows(UnitPairMember)} >= {ko, en}
    (suggestion,) = read_rows(AiSuggestion)
    update_row(AiSuggestion, suggestion.id, content={**suggestion.content, "unit_ids": [ko]})

    assert preview(client, bundle.id, "classify", bundle.document_id)["excluded_changed"] == 1


def test_a_captionless_table_is_left_for_a_person(client: TestClient, fake_ai: FakeAi) -> None:
    # 캡션 없는 표는 확정할 수 없다(표·그림 명세 §3.4) — 받으면 늘 거절되니 받을 수에 넣지 않고 따로 센다
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    table = find_kind(upload_second_document(client, bundle.id, tbl(CELLS)), "table")
    use_reply(fake_ai)
    queue_units(client, bundle.id, [table["id"]])
    run_jobs()

    out = preview(client, bundle.id, "classify")
    result = accept_all(client, bundle.id, "classify")

    assert (len(out["items"]), out["excluded_manual"]) == (1, 1)
    assert result == {"accepted": 1, "skipped": 0}
    assert (read_decision(ko).status, read_decision(table["id"]).status) == ("confirmed", "unassigned")


def test_a_save_check_refusal_skips_only_that_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    # 그 사이 칸이 사라진 것처럼 저장 검사가 거절하는 제안은 그것만 건너뛰고, 검사는 쓰지 않으니 아무것도 남기지 않는다
    bundle, ko, _ = suggest_first_pair(client, fake_ai)
    second, = find_ids(client, bundle, AI_KO_2)
    queue_units(client, bundle.id, [second])
    run_jobs()
    broken = [row for row in read_rows(AiSuggestion) if second in row.content["unit_ids"]][0]
    update_row(AiSuggestion, broken.id, content={**broken.content, "slot_key": "no_such_slot"})

    out = accept_all(client, bundle.id, "classify", bundle.document_id)

    assert out == {"accepted": 1, "skipped": 1}
    assert (read_decision(ko).status, read_decision(second).status) == ("confirmed", "unassigned")
    assert read_suggestion(broken.id).adoption is None


def test_undo_takes_the_whole_accept_back_in_one_step(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, ko, en = suggest_first_pair(client, fake_ai)
    accept_all(client, bundle.id, "classify", bundle.document_id, undo=UNDO)

    response = client.post(f"/api/bundles/{bundle.id}/decisions/undo", json=UNDO, headers=AUTHOR)

    assert response.status_code == 200, response.text
    assert (read_decision(ko).status, read_decision(en).status) == ("unassigned", "unassigned")
    assert get_group_by_unit(client, bundle.id, ko)["targets"] == []
    (suggestion,) = read_rows(AiSuggestion)
    assert (suggestion.result, suggestion.adoption) == ("applied", None)  # 다시 받을 수 있는 추천으로 돌아온다
    assert len(preview(client, bundle.id, "classify", bundle.document_id)["items"]) == 1


def test_accept_is_for_authors_and_checks_its_input(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, _, _ = suggest_first_pair(client, fake_ai)
    (suggestion,) = read_rows(AiSuggestion)
    body = {"kind": "classify", "suggestion_ids": [suggestion.id]}

    reviewer = client.post(f"/api/bundles/{bundle.id}/ai/accept", json=body, headers=REVIEWER)
    repeated = accept(client, bundle.id, "classify", [suggestion.id, suggestion.id])
    wrong_kind = accept(client, bundle.id, "match", [suggestion.id])

    assert reviewer.status_code == 403
    assert repeated.status_code == 422 and repeated.json()["detail"]["code"] == "duplicate_items"
    assert wrong_kind.json() == {"accepted": 0, "skipped": 1}


# --- 묶기 ---


def test_accepting_a_refined_pair_links_and_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match(client, fake_ai, MATCH_OLD, MATCH_NEW)
    bundle_id, document_id = bundle.id, bundle.old_document_id

    out = preview(client, bundle_id, "match", document_id)
    result = accept_all(client, bundle_id, "match", document_id)

    assert [item["shape"] for item in out["items"]] == ["one_to_one"]
    assert result == {"accepted": 1, "skipped": 0}
    (unit_id,) = [row.id for row in read_rows(Unit) if row.text == MATCH_OLD]
    (target,) = [row for row in read_rows(TargetSentence) if row.confirmed_text == MATCH_NEW]
    assert (target.id, unit_id) in read_links()
    assert (target.status, target.change_type, read_decision(unit_id).status) == ("confirmed", "tone", "confirmed")
    live = [row for row in read_rows(AiSuggestion) if row.result == "applied"]
    assert [row.adoption for row in live] == ["as_is"]


def test_a_provisional_pair_waits_for_refinement(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(MATCH_OLD), p(MATCH_NEW))
    assert request_match(client, bundle.id).status_code == 200
    run_plan()  # 계획만 돌려 다듬기 작업을 큐에 남긴다

    out = preview(client, bundle.id, "match")
    assert (out["items"], out["excluded_provisional"]) == ([], 1)


def test_new_and_delete_candidates_ride_the_match_accept(client: TestClient, fake_ai: FakeAi) -> None:
    # 신규는 Old 문서가 없어 Bundle 범위에만 들고, 신규 한 번에 확정 길로 받아 그대로 채택이다(§5 3-5)
    bundle = make_match(client, fake_ai, LONE_OLD, LONE_NEW)
    bundle_id, document_id = bundle.id, bundle.old_document_id
    in_document = preview(client, bundle_id, "match", document_id)
    in_bundle = preview(client, bundle_id, "match")
    assert [item["shape"] for item in in_document["items"]] == ["delete_candidate"]
    assert sorted(item["shape"] for item in in_bundle["items"]) == ["delete_candidate", "new"]

    out = accept_all(client, bundle_id, "match", delete_reason=DELETE_REASON)

    assert out == {"accepted": 2, "skipped": 0}
    (target,) = [row for row in read_rows(TargetSentence) if row.confirmed_text == LONE_NEW]
    (unit_id,) = read_old_ids(client, bundle, LONE_OLD)
    assert (target.status, target.change_type, target.confirmed_by) == ("confirmed", "new", "qa.member")
    assert (read_decision(unit_id).disposition, read_decision(unit_id).reason) == ("delete", DELETE_REASON)
    assert sorted(row.adoption or "" for row in read_rows(AiSuggestion) if row.result == "applied") == ["as_is", "as_is"]
    assert target.suggestion_id is not None


def test_one_side_of_a_pair_is_matched_and_the_pair_released_like_use(client: TestClient, fake_ai: FakeAi) -> None:
    # 묶기 계획은 언어마다 따로 묶는다 — 화면 Use처럼 남는 쪽을 제 줄로 풀어 받고, 상대 쪽 제안도 같은 요청에서 받는다
    bundle = make_match_bundle(client, p(MATCH_OLD) + p(MATCH_OLD_EN), p(MATCH_NEW) + p(MATCH_NEW_EN))
    ko, en = read_old_ids(client, bundle, MATCH_OLD, MATCH_OLD_EN)
    pair_of = {row.unit_id: row.pair_id for row in read_rows(UnitPairMember)}
    assert ko in pair_of and pair_of[ko] == pair_of.get(en)
    fake_ai.chat = lambda data: json.dumps({"change_type": "tone", "reason": "합성 이유.", "rule_ids": ["R02"]}, ensure_ascii=False)
    assert request_match(client, bundle.id).status_code == 200
    run_jobs()

    out = preview(client, bundle.id, "match", bundle.old_document_id)
    result = accept_all(client, bundle.id, "match", bundle.old_document_id)

    assert (len(out["items"]), out["excluded_changed"]) == (2, 0)
    assert result == {"accepted": 2, "skipped": 0}
    assert (read_decision(ko).status, read_decision(en).status) == ("confirmed", "confirmed")


# --- 채택 판정의 1:1 (사용자 결정 2026-11-19) ---


def test_rewrites_matching_the_unit_count_pair_up_in_document_order() -> None:
    first = Unit(id=11, pos_seq=1, pos_start=0, text="합성 첫째.", lang="ko")
    second = Unit(id=12, pos_seq=2, pos_start=0, text="합성 둘째.", lang="ko")
    place = (1, "purpose", None, None)

    paired = build_rewrite_shapes(place, [second, first], ["고친 첫째.", "고친 둘째."])
    reshaped = build_rewrite_shapes(place, [first, second], ["합친 하나."])

    assert [(shape.text, shape.sources) for shape in paired] == [("고친 첫째.", {11}), ("고친 둘째.", {12})]
    assert [(shape.text, shape.sources) for shape in reshaped] == [("합친 하나.", {11, 12})]


def test_a_reference_line_keeps_its_text_without_the_paragraph_number() -> None:
    # 고쳐 쓰지 않는 참조 줄은 원문 그대로지만 문단 번호는 번호 칸의 것이다(화면 Use의 getContent와 같다)
    ref = Unit(id=21, pos_seq=1, pos_start=0, text="5.1 SOP-QA-001 합성 참조", lang="ref", number_len=3, number_set=None, number_source="auto")

    (shape,) = build_rewrite_shapes((1, "purpose", None, None), [ref], None)

    assert shape.text == "SOP-QA-001 합성 참조"
