"""입구 2 변경 종류 — 계획이 문장 짝에 정하는 종류(LLM 없음), 구조에서 나오는 종류, 출처 연결, 문장 검사, 사람 확정과 채택
(설계 §6.7, §6.11, §7.10, §7.12, 2026-11-20-change-type-two D6)."""


import pytest
from fastapi.testclient import TestClient

from app.models import AiUsageEvent
from app.sop.ai.adoption import SavedShape, SuggestedShape, TargetShape, decide_adoption
from app.sop.models import AiJob, AiSuggestion, TargetSentence, TargetSource, UnitDecision
from tests.ai_fixtures import (
    MatchBundle,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    clean_embedding_cache,  # noqa: F401
    find_kind,
    make_match_bundle,
    read_decision,
    read_links,
    read_old_ids,
    read_rows,
    read_target,
    request_match,
    run_jobs,
    use_vectors,
)
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, p, tbl
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, find_unit, get_group_by_unit, get_view, save_group, upload

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs", "clean_embedding_cache")

OLD = "합성 장비의 전원을 켠 뒤 상태 표시등을 확인한다."
ORIGINAL_NEW_TEXT = "합성 장비의 전원을 켠 뒤 상태 표시등을 확인하여야 한다."
OLD_SPLIT = "합성 배관의 누수를 주 1회 점검하여 결과를 기록한다."
NEW_SPLIT_A = "합성 배관의 누수를 주 1회 점검한다."
NEW_SPLIT_B = "합성 배관 점검 결과를 기록한다."
OLD_MERGE_A = "합성 필터를 교체한다."
OLD_MERGE_B = "합성 필터 교체일을 적는다."
NEW_MERGED = "합성 필터를 교체하고 교체일을 적는다."
OLD_DOSE = "합성 시료를 5 mL 넣는다."
NEW_DOSE = "합성 시료를 10 mL 넣는다."
NEW_OTHER_DOC = "합성 배관 점검 주기를 다른 문서에 적는다."
SECOND_NEW_FILE = "SYNTHETIC_SOP-N_New.docx"
REPEATED = "두 문서에 되풀이되는 합성 문장이다."
LONE_OLD = "옛 문서에만 남은 교육 일정 공지문이다."
LONE_NEW = "새로 넣은 비상 연락망 안내 문장이다."
OTHER_OLD = "전혀 다른 합성 창고 청소 안내문이다."
HEADING = "합성 절 제목"
TRANSLATION = "Synthetic translation."
REASON = "합성 사유."
CELLS = [["합성 항목", "합성 값"], ["합성 압력", "합성 결과"]]
CHANGED_CELLS = [CELLS[0], ["합성 압력 범위", CELLS[1][1]]]
CAPTION = "그림 1 합성 장비 배치도"
MEDIA = {"image1.png": TINY_PNG}
CONTENT_KEYS = {
    "unit_ids", "target_ids", "shape", "change_type", "links", "target_change_types", "reason", "rule_ids", "retrieval",
}


def pair_up(client: TestClient, bundle_id: int) -> None:
    """계획을 돌린다 — 문장 짝의 변경 종류까지 계획이 바로 정한다."""
    response = request_match(client, bundle_id)
    assert response.status_code == 200, response.text
    assert response.json()["queued"] == 1, response.text
    run_jobs()


def read_suggestions(*shapes: str) -> list[AiSuggestion]:
    return [row for row in read_rows(AiSuggestion) if not shapes or row.content.get("shape") in shapes]


def clear_by_hand(client: TestClient, bundle_id: int, unit_id: int) -> None:
    """계획이 쓴 묶음을 사람이 Clear로 지운다 — 판단은 미배정, 새 문장은 출처 없이 돌아간다."""
    revision = get_group_by_unit(client, bundle_id, unit_id)["units"][0]["decision"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/decisions/clear", json={"unit_id": unit_id, "revision": revision}, headers=AUTHOR,
    )
    assert response.status_code == 200, response.text


def make_pair(client: TestClient, ai: FakeAi, old: str = OLD, new: str = ORIGINAL_NEW_TEXT) -> tuple[MatchBundle, int]:
    """1:1 짝 하나에 제안을 받아 둔 묶음."""
    bundle = make_match_bundle(client, p(old), p(new))
    (unit_id,) = read_old_ids(client, bundle, old)
    pair_up(client, bundle.id)
    return bundle, unit_id


def add_new_document(client: TestClient, bundle_id: int, body: str) -> None:
    uploaded = upload(client, bundle_id, build_docx(body), SECOND_NEW_FILE, side="new", doc_type="sop")
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text


def make_cross_document_pair(
    client: TestClient, ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> tuple[MatchBundle, int]:
    """옛 단위 하나가 새 문서 둘의 문장 하나씩으로 간 짝에 제안을 받아 둔 묶음."""
    bundle = make_match_bundle(client, p(OLD_SPLIT), p(NEW_SPLIT_A))
    add_new_document(client, bundle.id, p(NEW_SPLIT_B))
    (unit_id,) = read_old_ids(client, bundle, OLD_SPLIT)
    use_vectors(monkeypatch, ai, {OLD_SPLIT: 0, NEW_SPLIT_A: 0, NEW_SPLIT_B: 0})
    pair_up(client, bundle.id)
    return bundle, unit_id


def build_group_body(client: TestClient, bundle_id: int, unit_id: int, **unit_fields: object) -> dict:
    """관계 묶음을 읽어 그대로 되보낼 저장 본문 — 화면이 하는 일이다."""
    group = get_group_by_unit(client, bundle_id, unit_id)
    return {
        "action": "confirm",
        "units": [
            {"unit_id": unit["unit_id"], "revision": unit["decision"]["revision"], **unit_fields}
            for unit in group["units"]
        ],
        "targets": [
            {
                "key": str(target["id"]), "id": target["id"], "revision": target["revision"], "kind": target["kind"],
                "source_unit_ids": target["source_unit_ids"],
            }
            for target in group["targets"]
        ],
    }


def save_ok(client: TestClient, bundle_id: int, body: dict) -> dict:
    response = save_group(client, bundle_id, body)
    assert response.status_code == 200, response.text
    return response.json()


def build_target_body(target: TargetSentence, **fields: object) -> dict:
    """짝 없는 새 문장 하나를 저장할 본문 — 판단 행이 없어 단위 없이 간다."""
    item = {
        "key": str(target.id), "id": target.id, "revision": target.revision, "kind": target.kind, "source_unit_ids": [],
        **fields,
    }
    return {"action": "confirm", "units": [], "targets": [item]}


def assert_unit_untouched(unit_id: int) -> None:
    """AI는 판단을 쓰지 않는다 — 사람이 제안을 받기 전까지 처음 그대로다(설계 2026-11-19-ai-suggest-only D1)."""
    decision = read_decision(unit_id)
    assert (decision.status, decision.disposition, decision.suggestion_id, decision.revision) == (
        "unassigned", "unassigned", None, 1,
    )


def assert_target_untouched(text: str) -> None:
    """AI는 입구 2 새 문장도 쓰지 않는다 — 상태·변경 종류·경고·revision이 처음 그대로고 글은 새 문서 원문이다."""
    target = read_target(text)
    assert (target.status, target.change_type, target.suggestion_id, target.revision) == ("unassigned", None, None, 1)
    assert (target.warnings, target.confirmed_text, target.ai_text) == ([], text, "")


def read_suggested_links(suggestion: AiSuggestion) -> list[tuple[int, int]]:
    """제안이 사람이 받을 때 걸 출처 연결 (새 문장 id, 단위 id) — 순서가 새 문장 안의 출처 순서다."""
    return [(target_id, unit_id) for target_id, unit_id in suggestion.content["links"]]


def read_suggested_types(suggestion: AiSuggestion) -> dict[int, str]:
    """제안이 새 문장마다 낸 변경 종류 — content의 키는 JSON이라 글자다."""
    return {int(target_id): change_type for target_id, change_type in suggestion.content["target_change_types"].items()}


def find_live(*, unit_id: int | None = None, target_id: int | None = None) -> AiSuggestion:
    """그 단위나 새 문장을 덮는 살아 있는(적용됐고 채택 없는) 짝 맞추기 제안 — 판단·새 문장이 제안을 가리키지 않아 content로 찾는다."""
    (suggestion,) = [
        row for row in read_rows(AiSuggestion)
        if row.kind == "match" and row.result == "applied" and row.adoption is None
        and (unit_id in row.content["unit_ids"] or target_id in row.content["target_ids"])
    ]
    return suggestion


def build_use_body(suggestion: AiSuggestion, **unit_fields: object) -> dict:
    """제안을 받는(Use) 저장 본문 — 화면이 제안 content의 묶음·출처로 초안을 채워 suggestion_id와 함께 보낸다. 변경 종류는 서버가 정한다."""
    content = suggestion.content
    disposition = "delete" if content["shape"] == "delete_candidate" else "assigned"
    targets = {row.id: row for row in read_rows(TargetSentence)}
    sources: dict[int, list[int]] = {target_id: [] for target_id in content["target_ids"]}
    for target_id, unit_id in read_suggested_links(suggestion):
        sources[target_id].append(unit_id)
    return {
        "action": "confirm",
        "suggestion_id": suggestion.id,
        "units": [
            {"unit_id": unit_id, "revision": read_decision(unit_id).revision, "disposition": disposition, **unit_fields}
            for unit_id in content["unit_ids"]
        ],
        "targets": [
            {
                "key": str(target_id), "id": target_id, "revision": targets[target_id].revision,
                "kind": targets[target_id].kind, "source_unit_ids": sources[target_id],
            }
            for target_id in content["target_ids"]
        ],
    }


def hold_suggestion(client: TestClient, bundle_id: int, suggestion: AiSuggestion) -> dict:
    """제안을 받아 보류로 둔다 — 판단·새 문장이 제안에 이어지고 채택은 아직 열려 있다."""
    return save_ok(client, bundle_id, {**build_use_body(suggestion), "action": "hold", "hold_reason": REASON})


# --- 변경 종류 ---


def test_one_to_one_with_different_text_is_rewritten(client: TestClient, fake_ai: FakeAi) -> None:
    _, unit_id = make_pair(client, fake_ai)

    target = read_target(ORIGINAL_NEW_TEXT)
    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.content["change_type"] == "rewritten"
    assert read_suggested_types(suggestion) == {target.id: "rewritten"}
    assert read_suggested_links(suggestion) == [(target.id, unit_id)]
    assert_target_untouched(ORIGINAL_NEW_TEXT)  # 입구 2는 글자를 바꾸지 않고, 종류는 사람이 받을 때 쓴다


def test_same_text_is_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    # 되풀이되는 문장은 같은 글자 한 번에 확정 후보가 아니라 짝 계획으로 온다
    bundle = make_match_bundle(client, p(REPEATED) + p(REPEATED), p(REPEATED) + p(REPEATED))

    pair_up(client, bundle.id)

    targets = [row for row in read_rows(TargetSentence) if row.origin == "new_doc"]
    assert {(row.status, row.change_type) for row in targets} == {("unassigned", None)}
    assert fake_ai.requests == []
    refined = read_suggestions("one_to_one")
    assert {row.content["change_type"] for row in refined} == {"as_is"}
    assert {change_type for row in refined for change_type in read_suggested_types(row).values()} == {"as_is"}


def test_split_and_merged_come_from_structure(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(
        client, p(OLD_SPLIT) + p(OLD_MERGE_A) + p(OLD_MERGE_B), p(NEW_SPLIT_A) + p(NEW_SPLIT_B) + p(NEW_MERGED)
    )
    axes = {OLD_SPLIT: 0, NEW_SPLIT_A: 0, NEW_SPLIT_B: 0, OLD_MERGE_A: 1, OLD_MERGE_B: 1, NEW_MERGED: 1}
    use_vectors(monkeypatch, fake_ai, axes)

    pair_up(client, bundle.id)

    split_a, split_b = read_target(NEW_SPLIT_A), read_target(NEW_SPLIT_B)
    (split,) = read_suggestions("split")
    assert split.content["change_type"] == "split"
    assert split.content["target_ids"] == [split_a.id, split_b.id]
    assert read_suggested_types(split) == {split_a.id: "split", split_b.id: "split"}
    (merged,) = read_suggestions("merged")
    assert merged.content["change_type"] == "merged"
    assert sorted(merged.content["unit_ids"]) == read_old_ids(client, bundle, OLD_MERGE_A, OLD_MERGE_B)
    assert read_suggested_types(merged) == {read_target(NEW_MERGED).id: "merged"}


def test_pair_across_new_documents_is_rewritten_per_target(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 나눔은 같은 새 문서 안에서만이다 — 문서가 다르면 중복 배정이다(설계 §6.7, §6.9)
    make_cross_document_pair(client, fake_ai, monkeypatch)

    (suggestion,) = read_suggestions("split")
    assert suggestion.content["change_type"] == "rewritten"
    assert read_suggested_types(suggestion) == {read_target(NEW_SPLIT_A).id: "rewritten", read_target(NEW_SPLIT_B).id: "rewritten"}


def test_pair_across_new_documents_needs_a_reason_to_confirm(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle, unit_id = make_cross_document_pair(client, fake_ai, monkeypatch)
    body = build_use_body(find_live(unit_id=unit_id), disposition="assigned")

    refused = save_group(client, bundle.id, body)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"]["reason"] == "duplicate_without_reason"

    body["units"][0]["reason"] = REASON
    save_ok(client, bundle.id, body)

    assert (read_target(NEW_SPLIT_A).status, read_target(NEW_SPLIT_B).change_type) == ("confirmed", "rewritten")
    (suggestion,) = read_suggestions("split")
    assert suggestion.adoption == "as_is"


def test_split_inside_one_of_two_new_documents(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD_SPLIT), p(NEW_OTHER_DOC))  # 첫 새 문장이 나눔이 아니어야 기록 칸의 순서를 본다
    add_new_document(client, bundle.id, p(NEW_SPLIT_A) + p(NEW_SPLIT_B))
    use_vectors(monkeypatch, fake_ai, {OLD_SPLIT: 0, NEW_SPLIT_A: 0, NEW_SPLIT_B: 0, NEW_OTHER_DOC: 0})

    pair_up(client, bundle.id)

    (suggestion,) = read_suggestions("split")
    types = read_suggested_types(suggestion)
    assert [types[read_target(text).id] for text in (NEW_SPLIT_A, NEW_SPLIT_B, NEW_OTHER_DOC)] == ["split", "split", "rewritten"]
    assert suggestion.content["change_type"] == "split"  # 제안 기록의 한 칸에는 가장 큰 변화를 적는다


def test_old_units_stay_unassigned_under_a_planned_pair(client: TestClient, fake_ai: FakeAi) -> None:
    """계획이 쓴 짝도 판단을 쓰지 않는다 — 옛 단위의 처분(배정)은 짝 모양에 담겨 사람이 받을 때 쓰인다."""
    _, unit_id = make_pair(client, fake_ai)

    (suggestion,) = read_suggestions("one_to_one")
    assert (suggestion.content["unit_ids"], suggestion.content["shape"]) == ([unit_id], "one_to_one")
    assert_unit_untouched(unit_id)
    assert read_decision(unit_id).reason == ""  # 사유는 사람이 적는 칸이다


def test_source_links_ride_in_the_suggestion(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    """출처 연결은 제안 content에 실리고 사람이 받을 때 그 순서대로 걸린다 — 합침의 출처는 문서 순서다."""
    bundle = make_match_bundle(
        client, p(OLD_SPLIT) + p(OLD_MERGE_A) + p(OLD_MERGE_B), p(NEW_SPLIT_A) + p(NEW_SPLIT_B) + p(NEW_MERGED)
    )
    use_vectors(monkeypatch, fake_ai, {
        OLD_SPLIT: 0, NEW_SPLIT_A: 0, NEW_SPLIT_B: 0, OLD_MERGE_A: 1, OLD_MERGE_B: 1, NEW_MERGED: 1,
    })

    pair_up(client, bundle.id)

    split, first, second = read_old_ids(client, bundle, OLD_SPLIT, OLD_MERGE_A, OLD_MERGE_B)
    a, b, merged = (read_target(text).id for text in (NEW_SPLIT_A, NEW_SPLIT_B, NEW_MERGED))
    (split_suggestion,) = read_suggestions("split")
    (merged_suggestion,) = read_suggestions("merged")
    assert set(read_suggested_links(split_suggestion)) == {(a, split), (b, split)}
    assert read_suggested_links(merged_suggestion) == [(merged, first), (merged, second)]
    assert read_links() == set()  # AI는 출처를 잇지 않는다

    save_ok(client, bundle.id, build_use_body(merged_suggestion))

    seqs = {(row.target_id, row.unit_id): row.seq for row in read_rows(TargetSource)}
    assert seqs == {(merged, first): 0, (merged, second): 1}


def test_plan_calls_no_llm(client: TestClient, fake_ai: FakeAi, clean_ai_usage: None) -> None:
    # 말투·고침을 묻던 변경 종류 작업을 걷었다 — 계획의 종류가 마지막이고 프롬프트도 쓰지 않는다(설계 2026-11-20-change-type-two D6)
    make_pair(client, fake_ai)

    assert fake_ai.requests == [] and read_rows(AiUsageEvent) == []
    assert {job.kind for job in read_rows(AiJob)} == {"match_plan"}
    (suggestion,) = read_suggestions("one_to_one")
    assert (suggestion.result, suggestion.kind, suggestion.guideline_versions, suggestion.model) == ("applied", "match", {}, "")


def test_suggestion_follows_the_api_contract(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit_id = make_pair(client, fake_ai)

    target = read_target(ORIGINAL_NEW_TEXT)
    (suggestion,) = read_suggestions("one_to_one")
    assert set(suggestion.content) == CONTENT_KEYS
    assert suggestion.content == {
        "unit_ids": [unit_id], "target_ids": [target.id], "shape": "one_to_one", "change_type": "rewritten",
        "links": [[target.id, unit_id]], "target_change_types": {str(target.id): "rewritten"},
        "reason": "", "rule_ids": [], "retrieval": "no_index",
    }
    assert suggestion.document_id == bundle.old_document_id
    assert set(suggestion.input_refs) == {"sha256", "extraction_id"}


# --- 문장 검사 ---


def test_number_warning_compares_old_and_new_text(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD_DOSE), p(NEW_DOSE))
    use_vectors(monkeypatch, fake_ai, {OLD_DOSE: 0, NEW_DOSE: 0})

    pair_up(client, bundle.id)

    warning = {"kind": "number_mismatch", "source": "5", "target": "10"}
    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.warnings == [warning]
    assert read_target(NEW_DOSE).warnings == []  # 새 문장에는 쓰지 않는다


def test_merged_warning_compares_with_every_source(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    first, second, merged = "합성 시료를 5 mL 넣는다.", "합성 용액을 10 mL 넣는다.", "합성 시료 5 mL와 합성 용액 10 mL를 넣는다."
    bundle = make_match_bundle(client, p(first) + p(second), p(merged))
    use_vectors(monkeypatch, fake_ai, {first: 0, second: 0, merged: 0})

    pair_up(client, bundle.id)

    (suggestion,) = read_suggestions("merged")
    assert suggestion.warnings == []


# --- 사람 확정과 채택 ---


def test_human_confirm_of_a_match_pair_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit_id = make_pair(client, fake_ai)
    (suggestion,) = read_suggestions("one_to_one")

    saved = save_ok(client, bundle.id, build_use_body(suggestion))

    (suggestion,) = read_suggestions("one_to_one")
    assert (suggestion.adoption, suggestion.adopted_by) == ("as_is", "qa.member")
    (target,) = saved["targets"]
    assert (target["status"], target["change_type"], target["confirmed_text"]) == ("confirmed", "rewritten", ORIGINAL_NEW_TEXT)
    decision = read_decision(unit_id)
    assert (decision.status, decision.suggestion_id) == ("confirmed", suggestion.id)  # 받은 저장이 판단을 제안에 잇는다
    assert read_links() == {(target["id"], unit_id)}


def test_confirming_split_and_merged_keeps_the_structure(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(
        client, p(OLD_SPLIT) + p(OLD_MERGE_A) + p(OLD_MERGE_B), p(NEW_SPLIT_A) + p(NEW_SPLIT_B) + p(NEW_MERGED)
    )
    split, merged = read_old_ids(client, bundle, OLD_SPLIT, OLD_MERGE_A)
    use_vectors(monkeypatch, fake_ai, {
        OLD_SPLIT: 0, NEW_SPLIT_A: 0, NEW_SPLIT_B: 0, OLD_MERGE_A: 1, OLD_MERGE_B: 1, NEW_MERGED: 1,
    })
    pair_up(client, bundle.id)

    for unit_id in (split, merged):  # 저장은 종류를 받지 않는다 — 서버가 구조에서 다시 정한다
        save_ok(client, bundle.id, build_use_body(find_live(unit_id=unit_id)))

    assert {row.content["shape"]: row.adoption for row in read_suggestions("split", "merged")} == {
        "split": "as_is", "merged": "as_is",
    }
    assert read_target(NEW_SPLIT_A).change_type == "split"
    assert read_target(NEW_MERGED).change_type == "merged"


def test_blank_confirm_after_holding_a_used_pair_keeps_its_type(client: TestClient, fake_ai: FakeAi) -> None:
    """받아서 보류해 둔 짝을 그대로 확정하면 글로 정한 같은 종류라 그대로 채택이다."""
    bundle, unit_id = make_pair(client, fake_ai)
    hold_suggestion(client, bundle.id, find_live(unit_id=unit_id))

    save_ok(client, bundle.id, build_group_body(client, bundle.id, unit_id, disposition="assigned"))

    target = read_target(ORIGINAL_NEW_TEXT)
    assert (target.status, target.change_type) == ("confirmed", "rewritten")
    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.adoption == "as_is"


def test_blank_confirm_after_holding_a_used_table_keeps_a_rewritten_cell(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, tbl(CELLS), tbl(CHANGED_CELLS))
    table = find_kind(get_view(client, bundle.id, bundle.old_document_id), "table")["id"]
    pair_up(client, bundle.id)
    changed_cell = CHANGED_CELLS[1][0]
    (suggestion,) = read_suggestions("table")
    assert read_suggested_types(suggestion)[read_target(changed_cell).id] == "rewritten"
    hold_suggestion(client, bundle.id, suggestion)

    save_ok(client, bundle.id, build_group_body(client, bundle.id, table, disposition="assigned"))

    assert (read_target(changed_cell).status, read_target(changed_cell).change_type) == ("confirmed", "rewritten")
    (table_target,) = [row for row in read_rows(TargetSentence) if row.kind == "table"]
    assert table_target.change_type == "as_is"
    (suggestion,) = read_suggestions("table")
    assert suggestion.adoption == "as_is"


def test_blank_confirm_with_changed_sources_decides_the_type_again(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 받아 둔 짝이라도 출처를 바꾸면 지난 종류는 근거가 없다 — 새 출처의 글과 다시 견준다
    bundle = make_match_bundle(client, p(OLD) + p(OTHER_OLD), p(ORIGINAL_NEW_TEXT))
    paired, other = read_old_ids(client, bundle, OLD, OTHER_OLD)
    use_vectors(monkeypatch, fake_ai, {OLD: 0, ORIGINAL_NEW_TEXT: 0, OTHER_OLD: 1})
    pair_up(client, bundle.id)
    hold_suggestion(client, bundle.id, find_live(unit_id=paired))
    body = build_group_body(client, bundle.id, paired, disposition="delete", reason=REASON)
    body["units"].append({"unit_id": other, "revision": read_decision(other).revision, "disposition": "assigned"})
    body["targets"][0]["source_unit_ids"] = [other]

    save_ok(client, bundle.id, body)

    assert read_target(ORIGINAL_NEW_TEXT).change_type == "rewritten"


@pytest.mark.parametrize(("new_text", "expected"), [(OLD, "as_is"), (ORIGINAL_NEW_TEXT, "rewritten")])
def test_hand_made_pair_gets_its_type_from_the_text(client: TestClient, fake_ai: FakeAi, new_text: str, expected: str) -> None:
    # 사람이 고르지 않는다 — 입구 2 새 문장의 글이 출처 글과 같으면 그대로, 다르면 고침(설계 2026-11-20-change-type-two D2)
    bundle = make_match_bundle(client, p(OLD), p(new_text))
    (unit_id,) = read_old_ids(client, bundle, OLD)
    body = build_target_body(read_target(new_text), source_unit_ids=[unit_id])
    body["units"] = [{"unit_id": unit_id, "revision": read_decision(unit_id).revision, "disposition": "assigned"}]

    save_ok(client, bundle.id, body)

    assert (read_target(new_text).status, read_target(new_text).change_type) == ("confirmed", expected)


def test_restructuring_an_as_is_table_records_edited(client: TestClient, fake_ai: FakeAi) -> None:
    # 칸 연결을 하나 떼면 원문 표 모양이 아니라 표가 고침이 된다 — 제안(그대로)과 종류가 달라 고친 것이다
    bundle = make_match_bundle(client, tbl(CELLS), tbl(CHANGED_CELLS))
    table = find_kind(get_view(client, bundle.id, bundle.old_document_id), "table")["id"]
    pair_up(client, bundle.id)
    suggestion = find_live(unit_id=table)
    assert suggestion.content["change_type"] == "as_is"
    body = build_use_body(suggestion)
    (cell_item,) = [item for item in body["targets"] if item["id"] == read_target(CELLS[0][0]).id]
    cell_item["source_unit_ids"] = []

    save_ok(client, bundle.id, body)

    (table_row,) = [row for row in read_rows(TargetSentence) if row.kind == "table"]
    assert table_row.change_type == "rewritten"
    (suggestion,) = read_suggestions("table")
    assert suggestion.adoption == "edited"


def test_hold_leaves_the_adoption_open(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit_id = make_pair(client, fake_ai)
    (suggestion,) = read_suggestions("one_to_one")

    hold_suggestion(client, bundle.id, suggestion)

    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.adoption is None
    assert read_decision(unit_id).suggestion_id == suggestion.id  # 보류 저장도 제안에 잇는다 — 뒤의 확정이 채택을 정한다
    save_ok(client, bundle.id, build_group_body(client, bundle.id, unit_id, disposition="assigned"))
    assert read_suggestions("one_to_one")[0].adoption == "as_is"


@pytest.mark.usefixtures("hidden_ai_on")
def test_human_changing_sources_records_edited(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD) + p(OTHER_OLD), p(ORIGINAL_NEW_TEXT))
    paired, other = read_old_ids(client, bundle, OLD, OTHER_OLD)
    use_vectors(monkeypatch, fake_ai, {OLD: 0, ORIGINAL_NEW_TEXT: 0, OTHER_OLD: 1})
    pair_up(client, bundle.id)
    body = build_use_body(find_live(unit_id=paired), disposition="delete", reason=REASON)
    body["units"].append({
        "unit_id": other, "revision": read_decision(other).revision, "disposition": "assigned",
    })
    body["targets"][0].update(source_unit_ids=[other])

    save_ok(client, bundle.id, body)

    (pair,) = read_suggestions("one_to_one")
    assert pair.adoption == "edited"  # 처분이 바뀌어도 새 문장에 출처가 있으면 고친 것이다
    # 저장이 받은 제안은 짝 하나다 — 다른 단위의 삭제 후보는 받지 않고 배정으로 정해 버림이다(설계 §5 2-7)
    (candidate,) = read_suggestions("delete_candidate")
    assert candidate.adoption == "rejected"
    assert read_decision(other).suggestion_id is None


def test_adding_a_source_records_edited(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = make_match_bundle(client, p(OLD) + p(OTHER_OLD), p(ORIGINAL_NEW_TEXT))
    paired, other = read_old_ids(client, bundle, OLD, OTHER_OLD)
    use_vectors(monkeypatch, fake_ai, {OLD: 0, ORIGINAL_NEW_TEXT: 0, OTHER_OLD: 1})
    pair_up(client, bundle.id)
    body = build_use_body(find_live(unit_id=paired))
    body["units"].append({"unit_id": other, "revision": read_decision(other).revision, "disposition": "assigned"})
    body["targets"][0]["source_unit_ids"] = [paired, other]

    saved = save_ok(client, bundle.id, body)

    assert saved["targets"][0]["change_type"] == "merged"
    (pair,) = read_suggestions("one_to_one")
    assert pair.adoption == "edited"


def test_emptying_the_sources_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit_id = make_pair(client, fake_ai)
    body = build_use_body(find_live(unit_id=unit_id), disposition="delete", reason=REASON)
    body["targets"][0]["source_unit_ids"] = []

    saved = save_ok(client, bundle.id, body)

    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.adoption == "rejected"
    assert saved["targets"][0]["change_type"] == "new"


def test_removing_the_targets_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit_id = make_pair(client, fake_ai)
    body = build_use_body(find_live(unit_id=unit_id), disposition="delete", reason=REASON)
    body["removed_target_ids"] = [item["id"] for item in body.pop("targets")]

    save_ok(client, bundle.id, {**body, "targets": []})

    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.adoption == "rejected"
    target = read_target(ORIGINAL_NEW_TEXT)
    assert (target.status, target.suggestion_id) == ("unassigned", None)


def test_dropping_one_piece_of_a_split_records_edited(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD_SPLIT), p(NEW_SPLIT_A) + p(NEW_SPLIT_B))
    (unit_id,) = read_old_ids(client, bundle, OLD_SPLIT)
    use_vectors(monkeypatch, fake_ai, {OLD_SPLIT: 0, NEW_SPLIT_A: 0, NEW_SPLIT_B: 0})
    pair_up(client, bundle.id)
    body = build_use_body(find_live(unit_id=unit_id))
    kept, dropped = body["targets"]

    save_ok(client, bundle.id, {**body, "targets": [kept], "removed_target_ids": [dropped["id"]]})

    (suggestion,) = read_suggestions("split")
    assert suggestion.adoption == "edited"


@pytest.mark.usefixtures("hidden_ai_on")
def test_confirming_delete_candidate_without_a_reason(client: TestClient, fake_ai: FakeAi) -> None:
    """삭제의 Remark는 선택이다(요청서 4번) — 이유 없는 삭제 후보도 그대로 받아 삭제로 확정된다."""
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    (unit_id,) = read_old_ids(client, bundle, LONE_OLD)
    pair_up(client, bundle.id)
    (candidate,) = read_suggestions("delete_candidate")
    assert candidate.content["unit_ids"] == [unit_id]
    assert candidate.content["reason"] == ""
    assert_unit_untouched(unit_id)

    response = save_group(client, bundle.id, build_use_body(candidate))

    assert response.status_code == 200, response.text
    decision = next(row for row in read_rows(UnitDecision) if row.unit_id == unit_id)
    assert (decision.disposition, decision.reason) == ("delete", "")


@pytest.mark.usefixtures("hidden_ai_on")
def test_confirming_delete_candidate_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    (unit_id,) = read_old_ids(client, bundle, LONE_OLD)
    pair_up(client, bundle.id)

    save_ok(client, bundle.id, build_use_body(find_live(unit_id=unit_id), reason=REASON))

    (suggestion,) = read_suggestions("delete_candidate")
    assert suggestion.adoption == "as_is"
    assert (read_decision(unit_id).disposition, read_decision(unit_id).suggestion_id) == ("delete", suggestion.id)


@pytest.mark.usefixtures("hidden_ai_on")
def test_moving_a_delete_candidate_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    (unit_id,) = read_old_ids(client, bundle, LONE_OLD)
    pair_up(client, bundle.id)
    body = build_use_body(
        find_live(unit_id=unit_id), disposition="move_external", reason=REASON, move_target_code="SOP-OTHER",
    )

    save_ok(client, bundle.id, body)

    (suggestion,) = read_suggestions("delete_candidate")
    assert suggestion.adoption == "rejected"


def test_new_confirmed_through_group_save_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    pair_up(client, bundle.id)
    target_id = read_target(LONE_NEW).id

    saved = save_ok(client, bundle.id, build_use_body(find_live(target_id=target_id)))

    (suggestion,) = read_suggestions("new")
    assert (suggestion.adoption, suggestion.adopted_by) == ("as_is", "qa.member")
    assert saved["targets"][0]["change_type"] == "new"
    assert read_target(LONE_NEW).suggestion_id == suggestion.id  # 받은 저장이 판단 없는 새 문장을 제안에 잇는다


def test_new_table_confirmed_through_group_save_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), tbl(CELLS))
    pair_up(client, bundle.id)
    (table,) = [row for row in read_rows(TargetSentence) if row.kind == "table"]
    suggestion = find_live(target_id=table.id)
    body = build_use_body(suggestion)
    assert {item["id"] for item in body["targets"]} == {row.id for row in read_rows(TargetSentence) if row.origin == "new_doc"}

    save_ok(client, bundle.id, body)

    (suggestion,) = read_suggestions("new")
    assert suggestion.adoption == "as_is"


@pytest.mark.usefixtures("hidden_ai_on")
def test_giving_a_new_target_a_source_records_edited(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    (unit_id,) = read_old_ids(client, bundle, LONE_OLD)
    pair_up(client, bundle.id)
    body = build_use_body(find_live(target_id=read_target(LONE_NEW).id))
    body["targets"][0].update(source_unit_ids=[unit_id])
    body["units"] = [{"unit_id": unit_id, "revision": read_decision(unit_id).revision, "disposition": "assigned"}]

    save_ok(client, bundle.id, body)

    (new,) = read_suggestions("new")
    assert new.adoption == "edited"
    # 저장이 받은 제안은 신규 하나다 — 그 단위의 삭제 후보는 받지 않고 배정으로 정해 버림이다(설계 §5 2-7)
    (candidate,) = read_suggestions("delete_candidate")
    assert candidate.adoption == "rejected"


def test_removing_a_held_new_target_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    # 받아서 보류해 둔 신규는 새 문장이 제안에 이어져 있다 — reset_target가 제안 칸을 비우므로 지우기 전에 버림을 남긴다
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    pair_up(client, bundle.id)
    hold_suggestion(client, bundle.id, find_live(target_id=read_target(LONE_NEW).id))
    target = read_target(LONE_NEW)

    save_ok(client, bundle.id, {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [target.id]})

    (suggestion,) = read_suggestions("new")
    assert suggestion.adoption == "rejected"
    after = read_target(LONE_NEW)
    assert (after.status, after.suggestion_id) == ("unassigned", None)


def test_removing_a_confirmed_new_target_keeps_the_first_verdict(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    pair_up(client, bundle.id)
    save_ok(client, bundle.id, build_use_body(find_live(target_id=read_target(LONE_NEW).id)))
    target = read_target(LONE_NEW)

    save_ok(client, bundle.id, {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [target.id]})

    (suggestion,) = read_suggestions("new")
    assert suggestion.adoption == "as_is"


def test_cell_link_edit_on_a_restructured_table_stays_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    # 제안 기록에 칸 연결이 없어 표 새 문장만 견준다 — 칸 연결만 더한 저장은 일부러 그대로 채택이다
    bundle = make_match_bundle(client, tbl(CELLS), tbl([[*row, "합성 비고"] for row in CELLS]))
    view = get_view(client, bundle.id, bundle.old_document_id)
    table, cell = find_kind(view, "table")["id"], find_unit(view, CELLS[0][0])["id"]
    pair_up(client, bundle.id)
    suggestion = find_live(unit_id=table)
    assert suggestion.content["change_type"] == "rewritten"  # 격자가 달라 원문 모양이 아니다
    body = build_use_body(suggestion)
    (cell_item,) = [item for item in body["targets"] if item["id"] == read_target(CELLS[0][0]).id]
    cell_item["source_unit_ids"] = [cell]

    save_ok(client, bundle.id, body)

    assert (read_target(CELLS[0][0]).id, cell) in read_links()
    (suggestion,) = read_suggestions("table")
    assert suggestion.adoption == "as_is"


def test_table_suggestion_compares_the_table_target(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, tbl(CELLS), tbl(CHANGED_CELLS))
    table = find_kind(get_view(client, bundle.id, bundle.old_document_id), "table")["id"]
    pair_up(client, bundle.id)

    save_ok(client, bundle.id, build_use_body(find_live(unit_id=table)))

    (suggestion,) = read_suggestions("table")
    assert suggestion.adoption == "as_is"


def test_figure_suggestion_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    figure = f"<w:p>{make_drawing_run('image1.png')}</w:p>" + p(CAPTION, "Caption")
    bundle = make_match_bundle(client, figure, figure, media=MEDIA)
    unit_id = find_kind(get_view(client, bundle.id, bundle.old_document_id), "figure")["id"]
    pair_up(client, bundle.id)

    save_ok(client, bundle.id, build_use_body(find_live(unit_id=unit_id)))

    (suggestion,) = read_suggestions("figure")
    assert suggestion.adoption == "as_is"


def test_adoption_stats_count_match_suggestions(client: TestClient, fake_ai: FakeAi) -> None:
    """받은 짝은 그대로로, 받기를 기다리는 신규(새 문장이 아직 미배정)는 대기로 센다."""
    bundle = make_match_bundle(client, p(OLD), p(ORIGINAL_NEW_TEXT) + p(LONE_NEW))
    (unit_id,) = read_old_ids(client, bundle, OLD)
    pair_up(client, bundle.id)
    save_ok(client, bundle.id, build_use_body(find_live(unit_id=unit_id)))

    response = client.get(f"/api/bundles/{bundle.id}/ai/status", headers=AUTHOR)

    assert response.status_code == 200, response.text
    assert response.json()["adoption"]["match"] == {
        "applied": 2, "as_is": 1, "edited": 0, "rejected": 0, "pending": 1, "adoption_rate": 1.0,
    }


# --- 판정 규칙 ---


NO_PLACE = (None, None, None, None)


def links(*sources: frozenset[int]) -> tuple[TargetShape, ...]:
    return tuple(TargetShape(NO_PLACE, "", source) for source in sources)


@pytest.mark.parametrize(
    ("suggested", "saved", "expected"),
    [
        (links(frozenset((1,))), links(frozenset((1,))), "as_is"),
        (links(frozenset((1,))), links(frozenset((2,))), "edited"),
        (links(frozenset((1,))), links(frozenset((1, 2))), "edited"),
        (links(frozenset((1,))), links(frozenset()), "rejected"),
        (links(frozenset((1,))), (), "rejected"),
        (links(frozenset((1,)), frozenset((1,))), links(frozenset((1,)), frozenset()), "edited"),
        (links(frozenset()), links(frozenset()), "as_is"),
        (links(frozenset()), links(frozenset((1,))), "edited"),
    ],
)
def test_decide_adoption_for_match_compares_sources_only(
    suggested: tuple[TargetShape, ...], saved: tuple[TargetShape, ...], expected: str
) -> None:
    shape = SuggestedShape("assigned", suggested, is_locked=True)

    assert decide_adoption(shape, SavedShape(frozenset(("delete",)), saved)) == expected


@pytest.mark.parametrize(
    ("saved", "expected"),
    [
        (TargetShape(NO_PLACE, "", frozenset((1,)), change_type="rewritten"), "as_is"),
        (TargetShape(NO_PLACE, "", frozenset((1,)), change_type="as_is"), "edited"),
        (TargetShape(NO_PLACE, "", frozenset(), change_type="new"), "rejected"),
    ],
)
def test_decide_adoption_compares_the_type_when_the_shape_carries_one(saved: TargetShape, expected: str) -> None:
    suggested = SuggestedShape(
        "assigned", (TargetShape(NO_PLACE, "", frozenset((1,)), change_type="rewritten"),), is_locked=True
    )

    assert decide_adoption(suggested, SavedShape(frozenset(("assigned",)), (saved,))) == expected
