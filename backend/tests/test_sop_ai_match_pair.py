"""입구 2 변경 종류 — 문장 짝의 LLM 작업, 구조에서 나오는 종류, 출처 연결, 문장 검사, 무효·낡음, 사람 확정과 채택 (설계 §6.7, §6.11, §7.10, §7.12)."""

import json
import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AiUsageEvent
from app.sop.ai.adoption import SavedShape, SuggestedShape, TargetShape, decide_adoption
from app.sop.ai.guidelines import SEEDS_DIR
from app.sop.ai.llm import parse_reply
from app.sop.ai.match_jobs import MatchReply
from app.sop.constants import SYSTEM_HOLD_AI_INVALID
from app.sop.models import AiJob, AiSuggestion, GuidelineVersion, TargetSentence, TargetSource
from tests.access_helpers import run_in_session
from tests.ai_fixtures import (
    MatchBundle,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    clean_embedding_cache,  # noqa: F401
    edit_document,
    find_kind,
    make_match_bundle,
    read_decision,
    read_links,
    read_old_ids,
    read_rows,
    read_target,
    request_match,
    run_jobs,
    run_plan,
    use_vectors,
)
from tests.docx_factory import TINY_PNG, make_drawing_run, p, tbl
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, get_group_by_unit, get_view, save_group

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
REPEATED = "두 문서에 되풀이되는 합성 문장이다."
LONE_OLD = "옛 문서에만 남은 교육 일정 공지문이다."
LONE_NEW = "새로 넣은 비상 연락망 안내 문장이다."
OTHER_OLD = "전혀 다른 합성 창고 청소 안내문이다."
HEADING = "합성 절 제목"
TRANSLATION = "Synthetic translation."
REASON = "합성 사유."
REPLY_REASON = "문장 끝만 바뀌었다."
CELLS = [["합성 항목", "합성 값"], ["합성 압력", "합성 결과"]]
CHANGED_CELLS = [CELLS[0], ["합성 압력 범위", CELLS[1][1]]]
CAPTION = "그림 1 합성 장비 배치도"
MEDIA = {"image1.png": TINY_PNG}
CONTENT_KEYS = {"unit_ids", "target_ids", "shape", "change_type", "reason", "rule_ids", "retrieval"}


def build_match_reply(**changes: object) -> str:
    reply = {"change_type": "tone", "reason": REPLY_REASON, "rule_ids": ["R02"]}
    return json.dumps({**reply, **changes}, ensure_ascii=False)


def use_match_reply(ai: FakeAi, **changes: object) -> None:
    ai.chat = lambda data: build_match_reply(**changes)


def pair_up(client: TestClient, bundle_id: int) -> None:
    """계획과 그 변경 종류 작업을 끝까지 돌린다."""
    response = request_match(client, bundle_id)
    assert response.status_code == 200, response.text
    assert response.json()["queued"] == 1, response.text
    run_jobs()


def read_suggestions(*shapes: str) -> list[AiSuggestion]:
    rows = read_rows(AiSuggestion)
    return [row for row in rows if not shapes or row.content.get("shape") in shapes]


def read_jobs(kind: str = "match") -> list[AiJob]:
    return [row for row in read_rows(AiJob) if row.kind == kind]


def make_pair(client: TestClient, ai: FakeAi, old: str = OLD, new: str = ORIGINAL_NEW_TEXT, **reply: object) -> tuple[MatchBundle, int]:
    """1:1 짝 하나에 제안을 받아 둔 묶음."""
    bundle = make_match_bundle(client, p(old), p(new))
    (unit_id,) = read_old_ids(client, bundle, old)
    use_match_reply(ai, **reply)
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
                "source_unit_ids": target["source_unit_ids"], "change_type": target["change_type"],
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


# --- 변경 종류 ---


def test_one_to_one_applies_llm_change_type(client: TestClient, fake_ai: FakeAi) -> None:
    make_pair(client, fake_ai, change_type="tone")

    target = read_target(ORIGINAL_NEW_TEXT)
    assert (target.status, target.change_type) == ("ai_suggested", "tone")
    assert target.confirmed_text == ORIGINAL_NEW_TEXT  # 입구 2는 글자를 바꾸지 않는다
    assert target.ai_text == ""
    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.content["change_type"] == "tone"
    assert target.suggestion_id == suggestion.id


def test_same_text_is_as_is_regardless_of_reply(client: TestClient, fake_ai: FakeAi) -> None:
    # 되풀이되는 문장은 같은 글자 한 번에 확정 후보가 아니라 짝 작업으로 온다
    bundle = make_match_bundle(client, p(REPEATED) + p(REPEATED), p(REPEATED) + p(REPEATED))
    use_match_reply(fake_ai, change_type="rewritten")

    pair_up(client, bundle.id)

    targets = [row for row in read_rows(TargetSentence) if row.origin == "new_doc"]
    assert {(row.status, row.change_type) for row in targets} == {("ai_suggested", "as_is")}
    assert len(fake_ai.requests) == 2
    assert {row.content["change_type"] for row in read_suggestions("one_to_one")} == {"as_is"}


def test_ai_as_is_on_different_text_is_rewritten(client: TestClient, fake_ai: FakeAi) -> None:
    make_pair(client, fake_ai, change_type="as_is")

    assert read_target(ORIGINAL_NEW_TEXT).change_type == "rewritten"  # 원문과 다른 글을 그대로라고 적지 않는다


def test_split_and_merged_come_from_structure(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(
        client, p(OLD_SPLIT) + p(OLD_MERGE_A) + p(OLD_MERGE_B), p(NEW_SPLIT_A) + p(NEW_SPLIT_B) + p(NEW_MERGED)
    )
    axes = {OLD_SPLIT: 0, NEW_SPLIT_A: 0, NEW_SPLIT_B: 0, OLD_MERGE_A: 1, OLD_MERGE_B: 1, NEW_MERGED: 1}
    use_vectors(monkeypatch, fake_ai, axes)
    use_match_reply(fake_ai, change_type="tone")

    pair_up(client, bundle.id)

    split_a, split_b = read_target(NEW_SPLIT_A), read_target(NEW_SPLIT_B)
    assert (split_a.change_type, split_b.change_type) == ("split", "split")
    assert read_target(NEW_MERGED).change_type == "merged"
    (split,) = read_suggestions("split")
    assert split.content["change_type"] == "split"
    assert split.content["target_ids"] == [split_a.id, split_b.id]
    (merged,) = read_suggestions("merged")
    assert merged.content["change_type"] == "merged"
    assert sorted(merged.content["unit_ids"]) == read_old_ids(client, bundle, OLD_MERGE_A, OLD_MERGE_B)


def test_old_units_become_ai_suggested_assigned(client: TestClient, fake_ai: FakeAi) -> None:
    _, unit_id = make_pair(client, fake_ai)

    decision = read_decision(unit_id)
    (suggestion,) = read_suggestions("one_to_one")
    assert (decision.status, decision.disposition, decision.suggestion_id) == ("ai_suggested", "assigned", suggestion.id)
    assert decision.reason == ""  # 사유는 사람이 적는 칸이다


def test_source_links_are_written(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = make_match_bundle(
        client, p(OLD_SPLIT) + p(OLD_MERGE_A) + p(OLD_MERGE_B), p(NEW_SPLIT_A) + p(NEW_SPLIT_B) + p(NEW_MERGED)
    )
    use_vectors(monkeypatch, fake_ai, {
        OLD_SPLIT: 0, NEW_SPLIT_A: 0, NEW_SPLIT_B: 0, OLD_MERGE_A: 1, OLD_MERGE_B: 1, NEW_MERGED: 1,
    })
    use_match_reply(fake_ai)

    pair_up(client, bundle.id)

    split, first, second = read_old_ids(client, bundle, OLD_SPLIT, OLD_MERGE_A, OLD_MERGE_B)
    a, b, merged = (read_target(text).id for text in (NEW_SPLIT_A, NEW_SPLIT_B, NEW_MERGED))
    assert read_links() == {(a, split), (b, split), (merged, first), (merged, second)}
    seqs = {(row.target_id, row.unit_id): row.seq for row in read_rows(TargetSource)}
    assert (seqs[(merged, first)], seqs[(merged, second)]) == (0, 1)  # 합침의 출처는 문서 순서다


def test_payload_carries_text_and_section_only(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(HEADING, "Heading1") + p(OLD), p(HEADING, "Heading1") + p(ORIGINAL_NEW_TEXT))
    use_match_reply(fake_ai)

    pair_up(client, bundle.id)

    (data,) = [request for request in fake_ai.requests if request["old"][0]["text"] == OLD]
    assert data == {
        "task": "match",
        "old": [{"text": OLD, "section": HEADING}],
        "new": [{"text": ORIGINAL_NEW_TEXT, "section": HEADING}],
    }


def test_merged_payload_keeps_document_order(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD_MERGE_A) + p(OLD_MERGE_B), p(NEW_MERGED))
    use_vectors(monkeypatch, fake_ai, {OLD_MERGE_A: 0, OLD_MERGE_B: 0, NEW_MERGED: 0})
    use_match_reply(fake_ai)

    pair_up(client, bundle.id)

    (data,) = fake_ai.requests
    assert [item["text"] for item in data["old"]] == [OLD_MERGE_A, OLD_MERGE_B]


def test_guidelines_reasoning_and_feature(client: TestClient, fake_ai: FakeAi, clean_ai_usage: None) -> None:
    make_pair(client, fake_ai)

    assert fake_ai.bodies[0]["chat_template_kwargs"]["reasoning_effort"] == "low"
    assert {event.feature for event in read_rows(AiUsageEvent)} == {"sop.match"}
    (suggestion,) = read_suggestions("one_to_one")
    assert set(suggestion.guideline_versions) == {"rules", "prompt.match"}
    assert suggestion.model != ""
    assert (suggestion.result, suggestion.kind) == ("applied", "match")


def test_suggestion_follows_the_api_contract(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit_id = make_pair(client, fake_ai, rule_ids=["R02", "RW06"])

    target = read_target(ORIGINAL_NEW_TEXT)
    (suggestion,) = read_suggestions("one_to_one")
    assert set(suggestion.content) == CONTENT_KEYS
    assert suggestion.content == {
        "unit_ids": [unit_id], "target_ids": [target.id], "shape": "one_to_one", "change_type": "tone",
        "reason": REPLY_REASON, "rule_ids": ["R02", "RW06"], "retrieval": "no_index",
    }
    assert suggestion.document_id == bundle.old_document_id
    assert set(suggestion.input_refs) == {"sha256", "extraction_id"}


def test_unknown_rule_ids_are_dropped_with_a_warning(client: TestClient, fake_ai: FakeAi) -> None:
    make_pair(client, fake_ai, rule_ids=["R02", "R999"])

    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.content["rule_ids"] == ["R02"]
    warning = {"kind": "unknown_rule_id", "source": "R999", "target": ""}
    assert warning in suggestion.warnings
    assert warning in read_target(ORIGINAL_NEW_TEXT).warnings


def test_reply_warning_lands_once_on_a_split_suggestion(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD_SPLIT), p(NEW_SPLIT_A) + p(NEW_SPLIT_B))
    use_vectors(monkeypatch, fake_ai, {OLD_SPLIT: 0, NEW_SPLIT_A: 0, NEW_SPLIT_B: 0})
    use_match_reply(fake_ai, rule_ids=["R999"])

    pair_up(client, bundle.id)

    (suggestion,) = read_suggestions("split")
    kinds = [warning["kind"] for warning in suggestion.warnings]
    assert kinds.count("unknown_rule_id") == 1
    assert all("unknown_rule_id" in {item["kind"] for item in read_target(text).warnings} for text in (NEW_SPLIT_A, NEW_SPLIT_B))


def test_queued_match_jobs_finish_done(client: TestClient, fake_ai: FakeAi) -> None:
    make_pair(client, fake_ai)

    (job,) = read_jobs()
    assert (job.status, job.error) == ("done", "")


# --- 문장 검사 ---


def test_number_warning_compares_old_and_new_text(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD_DOSE), p(NEW_DOSE))
    use_vectors(monkeypatch, fake_ai, {OLD_DOSE: 0, NEW_DOSE: 0})
    use_match_reply(fake_ai, change_type="rewritten")

    pair_up(client, bundle.id)

    warning = {"kind": "number_mismatch", "source": "5", "target": "10"}
    assert read_target(NEW_DOSE).warnings == [warning]
    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.warnings == [warning]


def test_merged_warning_compares_with_every_source(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    first, second, merged = "합성 시료를 5 mL 넣는다.", "합성 용액을 10 mL 넣는다.", "합성 시료 5 mL와 합성 용액 10 mL를 넣는다."
    bundle = make_match_bundle(client, p(first) + p(second), p(merged))
    use_vectors(monkeypatch, fake_ai, {first: 0, second: 0, merged: 0})
    use_match_reply(fake_ai)

    pair_up(client, bundle.id)

    assert read_target(merged).warnings == []


# --- 무효 ---


def test_invalid_reply_holds_the_old_units_only(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD), p(ORIGINAL_NEW_TEXT))
    (unit_id,) = read_old_ids(client, bundle, OLD)
    secret = "응답에 실린 합성 비밀 글"
    fake_ai.chat = lambda data: f"not json {secret}"

    pair_up(client, bundle.id)

    decision = read_decision(unit_id)
    assert (decision.status, decision.hold_reason) == ("on_hold", SYSTEM_HOLD_AI_INVALID)
    assert (decision.disposition, decision.suggestion_id) == ("unassigned", None)
    target = read_target(ORIGINAL_NEW_TEXT)  # 새 문장 그대로, 출처 없음
    assert (target.status, target.change_type, target.suggestion_id, target.warnings) == ("unassigned", None, None, [])
    assert read_links() == set()
    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.result == "invalid"
    assert suggestion.warnings == [{"kind": "invalid_format", "source": "", "target": ""}]
    assert (suggestion.content["change_type"], suggestion.content["reason"]) == (None, "")
    assert secret not in json.dumps(suggestion.content, ensure_ascii=False)
    (job,) = read_jobs()
    assert job.status == "done"


@pytest.mark.parametrize(
    "reply",
    [
        '{"change_type": "split", "reason": "구조", "rule_ids": []}',  # 나눔은 응답으로 받지 않는다
        '{"change_type": "tone", "rule_ids": []}',
        '{"change_type": "tone", "reason": "이유"}',
        "{}",
    ],
)
def test_reply_outside_the_schema_is_invalid(client: TestClient, fake_ai: FakeAi, reply: str) -> None:
    bundle = make_match_bundle(client, p(OLD), p(ORIGINAL_NEW_TEXT))
    (unit_id,) = read_old_ids(client, bundle, OLD)
    fake_ai.chat = lambda data: reply

    pair_up(client, bundle.id)

    assert read_decision(unit_id).status == "on_hold"
    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.result == "invalid"


def test_reply_schema_cleans_text() -> None:
    parsed = MatchReply.model_validate({"change_type": "tone", "reason": " 합성\x00 ", "rule_ids": [" R02 "]})

    assert parsed.reason == "합성\ufffd"
    assert parsed.rule_ids == ["R02"]


def test_seed_example_parses_as_match_reply() -> None:
    seed = (SEEDS_DIR / "prompt.match.md").read_text(encoding="utf-8")

    example = re.findall(r"```json\n(.*?)\n```", seed, flags=re.DOTALL)[-1]

    assert parse_reply(example, MatchReply) is not None


# --- 낡음 ---


def test_stale_when_target_revision_changed(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD), p(ORIGINAL_NEW_TEXT))
    (unit_id,) = read_old_ids(client, bundle, OLD)
    target = read_target(ORIGINAL_NEW_TEXT)
    use_match_reply(fake_ai)
    fake_ai.on_chat = lambda data: save_ok(client, bundle.id, build_target_body(target))

    pair_up(client, bundle.id)

    (job,) = read_jobs()
    assert job.status == "stale"
    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.result == "stale"
    confirmed = read_target(ORIGINAL_NEW_TEXT)
    assert (confirmed.status, confirmed.change_type, confirmed.suggestion_id) == ("confirmed", "new", None)
    decision = read_decision(unit_id)
    assert (decision.status, decision.suggestion_id) == ("unassigned", None)
    assert read_links() == set()


def test_stale_when_a_person_decides_the_old_unit(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD), p(ORIGINAL_NEW_TEXT))
    (unit_id,) = read_old_ids(client, bundle, OLD)
    use_match_reply(fake_ai)

    def delete_by_hand(data: dict) -> None:
        body = {"action": "delete", "reason": REASON, "units": [{"unit_id": unit_id, "revision": 1}]}
        response = client.post(f"/api/bundles/{bundle.id}/decisions/bulk", json=body, headers=AUTHOR)
        assert response.status_code == 200, response.text

    fake_ai.on_chat = delete_by_hand

    pair_up(client, bundle.id)

    (job,) = read_jobs()
    assert job.status == "stale"
    assert read_decision(unit_id).status == "confirmed"
    assert read_target(ORIGINAL_NEW_TEXT).status == "unassigned"
    assert read_links() == set()


def test_language_change_during_call_is_stale(client: TestClient, fake_ai: FakeAi) -> None:
    # 언어 고치기는 판단 revision을 올리지 않지만 옛·새 문장이 다른 언어로 이어지면 저장이 거절한다
    bundle = make_match_bundle(client, p(OLD), p(ORIGINAL_NEW_TEXT))
    (unit_id,) = read_old_ids(client, bundle, OLD)
    use_match_reply(fake_ai)
    fake_ai.on_chat = lambda data: edit_document(
        client, bundle.id, bundle.old_document_id, {"type": "set_language", "unit_ids": [unit_id], "lang": "en"},
    )

    pair_up(client, bundle.id)

    (job,) = read_jobs()
    assert job.status == "stale"
    assert read_links() == set()


def test_split_of_the_old_unit_during_call_is_stale(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD), p(ORIGINAL_NEW_TEXT))
    (unit_id,) = read_old_ids(client, bundle, OLD)
    use_match_reply(fake_ai)
    fake_ai.on_chat = lambda data: edit_document(
        client, bundle.id, bundle.old_document_id, {"type": "split", "unit_id": unit_id, "at": OLD.index("상태")},
    )

    pair_up(client, bundle.id)

    (job,) = read_jobs()
    assert job.status == "stale"
    assert read_target(ORIGINAL_NEW_TEXT).status == "unassigned"
    assert read_links() == set()


@pytest.mark.parametrize("side", ["old", "new"])
def test_document_removed_during_call_ends_the_job_without_a_write(client: TestClient, fake_ai: FakeAi, side: str) -> None:
    bundle = make_match_bundle(client, p(OLD), p(ORIGINAL_NEW_TEXT))
    document_id = bundle.old_document_id if side == "old" else bundle.new_document_id
    use_match_reply(fake_ai)

    def delete_document(data: dict) -> None:
        revision = get_view(client, bundle.id, document_id)["document"]["revision"]
        url = f"/api/bundles/{bundle.id}/documents/{document_id}?revision={revision}&confirm=true"
        response = client.delete(url, headers=AUTHOR)
        assert response.status_code == 204, response.text

    fake_ai.on_chat = delete_document

    pair_up(client, bundle.id)

    (job,) = read_jobs()
    assert (job.status, job.error) == ("stale", "")
    assert read_links() == set()


def test_decided_before_start_is_stale_without_a_call(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD), p(ORIGINAL_NEW_TEXT))
    use_match_reply(fake_ai)
    response = request_match(client, bundle.id)
    assert response.status_code == 200, response.text
    run_plan()
    save_ok(client, bundle.id, build_target_body(read_target(ORIGINAL_NEW_TEXT)))

    run_jobs()

    (job,) = read_jobs()
    assert job.status == "stale"
    assert fake_ai.requests == []


@pytest.mark.usefixtures("restore_guidelines")
def test_missing_active_guideline_fails_the_job_as_config(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD), p(ORIGINAL_NEW_TEXT))

    async def _deactivate(session: AsyncSession) -> None:
        await session.execute(
            update(GuidelineVersion).where(GuidelineVersion.key == "prompt.match").values(is_active=False)
        )
        await session.commit()

    run_in_session(_deactivate)

    pair_up(client, bundle.id)

    (job,) = read_jobs()
    assert (job.status, job.error) == ("failed", "config")
    assert fake_ai.requests == []


# --- 다시 받기 ---


def queue_again(job: AiJob) -> None:
    """같은 짝을 다시 받는 모습 — 실패한 작업을 다시 시도하면 그사이 쓰인 제안 위에 쓴다."""

    async def _queue(session: AsyncSession) -> None:
        session.add(AiJob(
            bundle_id=job.bundle_id, kind="match", status="queued", document_id=job.document_id,
            unit_ids=job.unit_ids, target_ids=job.target_ids, payload=job.payload, requested_by=job.requested_by,
        ))
        await session.commit()

    run_in_session(_queue)


def test_replacing_a_pair_sweeps_its_ai_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD), p(ORIGINAL_NEW_TEXT))
    (unit_id,) = read_old_ids(client, bundle, OLD)
    fake_ai.chat = lambda data: json.dumps({"text": TRANSLATION}) if data["task"] == "translate" else build_match_reply()
    pair_up(client, bundle.id)
    translate = client.post(
        f"/api/bundles/{bundle.id}/ai/translate", json={"direction": "ko_to_en", "unit_ids": [unit_id]}, headers=AUTHOR,
    )
    assert translate.json()["queued"] == 1, translate.text
    run_jobs()
    (translation,) = [row for row in read_rows(TargetSentence) if row.origin == "translation"]
    (first,) = read_suggestions("one_to_one")
    queue_again(read_jobs()[0])
    use_match_reply(fake_ai, change_type="rewritten")

    run_jobs()

    assert all(row.origin == "new_doc" for row in read_rows(TargetSentence))  # 출처가 다시 쓰인 AI 번역은 지운다
    translated = next(row for row in read_rows(AiSuggestion) if row.id == translation.suggestion_id)
    assert (translated.kind, translated.result) == ("translate", "stale")
    replaced = next(row for row in read_rows(AiSuggestion) if row.id == first.id)
    assert replaced.result == "stale"
    target = read_target(ORIGINAL_NEW_TEXT)
    assert (target.status, target.change_type) == ("ai_suggested", "rewritten")
    assert target.suggestion_id != first.id
    assert read_links() == {(target.id, unit_id)}
    assert read_decision(unit_id).suggestion_id == target.suggestion_id


def test_invalid_reply_over_a_previous_pair_unlinks_it(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit_id = make_pair(client, fake_ai)
    queue_again(read_jobs()[0])
    fake_ai.chat = lambda data: "not json"

    run_jobs()

    assert read_decision(unit_id).status == "on_hold"
    target = read_target(ORIGINAL_NEW_TEXT)
    assert (target.status, target.change_type, target.confirmed_text) == ("unassigned", None, ORIGINAL_NEW_TEXT)
    assert read_links() == set()


# --- 사람 확정과 채택 ---


def test_human_confirm_of_a_match_pair_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit_id = make_pair(client, fake_ai)

    saved = save_ok(client, bundle.id, build_group_body(client, bundle.id, unit_id, disposition="assigned"))

    (suggestion,) = read_suggestions("one_to_one")
    assert (suggestion.adoption, suggestion.adopted_by) == ("as_is", "qa.member")
    (target,) = saved["targets"]
    assert (target["status"], target["change_type"], target["confirmed_text"]) == ("confirmed", "tone", ORIGINAL_NEW_TEXT)
    assert read_decision(unit_id).status == "confirmed"


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
    use_match_reply(fake_ai)
    pair_up(client, bundle.id)

    for unit_id in (split, merged):  # 저장 칸은 구조 종류를 받지 않는다 — 비워 보내면 서버가 구조에서 다시 정한다
        body = build_group_body(client, bundle.id, unit_id, disposition="assigned")
        for target in body["targets"]:
            target["change_type"] = None
        save_ok(client, bundle.id, body)

    assert {row.content["shape"]: row.adoption for row in read_suggestions("split", "merged")} == {
        "split": "as_is", "merged": "as_is",
    }
    assert read_target(NEW_SPLIT_A).change_type == "split"
    assert read_target(NEW_MERGED).change_type == "merged"


def test_change_type_alone_does_not_edit_the_adoption(client: TestClient, fake_ai: FakeAi) -> None:
    # 판정은 출처만 본다(계획 Task 13)
    bundle, unit_id = make_pair(client, fake_ai, change_type="tone")
    body = build_group_body(client, bundle.id, unit_id, disposition="assigned")
    body["targets"][0]["change_type"] = "rewritten"

    save_ok(client, bundle.id, body)

    assert read_target(ORIGINAL_NEW_TEXT).change_type == "rewritten"
    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.adoption == "as_is"


def test_hold_leaves_the_adoption_open(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit_id = make_pair(client, fake_ai)
    body = build_group_body(client, bundle.id, unit_id, disposition="assigned")

    save_ok(client, bundle.id, {**body, "action": "hold", "hold_reason": REASON})

    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.adoption is None
    save_ok(client, bundle.id, build_group_body(client, bundle.id, unit_id, disposition="assigned"))
    assert read_suggestions("one_to_one")[0].adoption == "as_is"


def test_human_changing_sources_records_edited(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD) + p(OTHER_OLD), p(ORIGINAL_NEW_TEXT))
    paired, other = read_old_ids(client, bundle, OLD, OTHER_OLD)
    use_vectors(monkeypatch, fake_ai, {OLD: 0, ORIGINAL_NEW_TEXT: 0, OTHER_OLD: 1})
    use_match_reply(fake_ai)
    pair_up(client, bundle.id)
    body = build_group_body(client, bundle.id, paired, disposition="delete", reason=REASON)
    body["units"].append({
        "unit_id": other, "revision": read_decision(other).revision, "disposition": "assigned",
    })
    body["targets"][0].update(source_unit_ids=[other], change_type="rewritten")

    save_ok(client, bundle.id, body)

    (pair,) = read_suggestions("one_to_one")
    assert pair.adoption == "edited"  # 처분이 바뀌어도 새 문장에 출처가 있으면 고친 것이다
    (candidate,) = read_suggestions("delete_candidate")
    assert candidate.adoption == "rejected"


def test_adding_a_source_records_edited(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = make_match_bundle(client, p(OLD) + p(OTHER_OLD), p(ORIGINAL_NEW_TEXT))
    paired, other = read_old_ids(client, bundle, OLD, OTHER_OLD)
    use_vectors(monkeypatch, fake_ai, {OLD: 0, ORIGINAL_NEW_TEXT: 0, OTHER_OLD: 1})
    use_match_reply(fake_ai)
    pair_up(client, bundle.id)
    body = build_group_body(client, bundle.id, paired, disposition="assigned")
    body["units"].append({"unit_id": other, "revision": read_decision(other).revision, "disposition": "assigned"})
    body["targets"][0]["source_unit_ids"] = [paired, other]

    saved = save_ok(client, bundle.id, body)

    assert saved["targets"][0]["change_type"] == "merged"
    (pair,) = read_suggestions("one_to_one")
    assert pair.adoption == "edited"


def test_emptying_the_sources_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit_id = make_pair(client, fake_ai)
    body = build_group_body(client, bundle.id, unit_id, disposition="delete", reason=REASON)
    body["targets"][0]["source_unit_ids"] = []

    saved = save_ok(client, bundle.id, body)

    (suggestion,) = read_suggestions("one_to_one")
    assert suggestion.adoption == "rejected"
    assert saved["targets"][0]["change_type"] == "new"


def test_removing_the_targets_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, unit_id = make_pair(client, fake_ai)
    body = build_group_body(client, bundle.id, unit_id, disposition="delete", reason=REASON)
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
    use_match_reply(fake_ai)
    pair_up(client, bundle.id)
    body = build_group_body(client, bundle.id, unit_id, disposition="assigned")
    kept, dropped = body["targets"]
    kept["change_type"] = "rewritten"

    save_ok(client, bundle.id, {**body, "targets": [kept], "removed_target_ids": [dropped["id"]]})

    (suggestion,) = read_suggestions("split")
    assert suggestion.adoption == "edited"


def test_confirming_delete_candidate_needs_a_reason(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    (unit_id,) = read_old_ids(client, bundle, LONE_OLD)
    pair_up(client, bundle.id)
    assert read_decision(unit_id).disposition == "delete"
    assert read_suggestions("delete_candidate")[0].content["reason"] == ""

    response = save_group(client, bundle.id, build_group_body(client, bundle.id, unit_id, disposition="delete"))

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["reason"] == "reason_required"
    assert read_decision(unit_id).status == "ai_suggested"


def test_confirming_delete_candidate_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    (unit_id,) = read_old_ids(client, bundle, LONE_OLD)
    pair_up(client, bundle.id)

    save_ok(client, bundle.id, build_group_body(client, bundle.id, unit_id, disposition="delete", reason=REASON))

    (suggestion,) = read_suggestions("delete_candidate")
    assert suggestion.adoption == "as_is"


def test_moving_a_delete_candidate_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    (unit_id,) = read_old_ids(client, bundle, LONE_OLD)
    pair_up(client, bundle.id)
    body = build_group_body(
        client, bundle.id, unit_id, disposition="move_external", reason=REASON, move_target_code="SOP-OTHER",
    )

    save_ok(client, bundle.id, body)

    (suggestion,) = read_suggestions("delete_candidate")
    assert suggestion.adoption == "rejected"


def test_new_confirmed_through_group_save_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    pair_up(client, bundle.id)

    saved = save_ok(client, bundle.id, build_target_body(read_target(LONE_NEW)))

    (suggestion,) = read_suggestions("new")
    assert (suggestion.adoption, suggestion.adopted_by) == ("as_is", "qa.member")
    assert saved["targets"][0]["change_type"] == "new"


def test_new_table_confirmed_through_group_save_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), tbl(CELLS))
    pair_up(client, bundle.id)
    rows = [row for row in read_rows(TargetSentence) if row.origin == "new_doc"]
    items = [
        {"key": str(row.id), "id": row.id, "revision": row.revision, "kind": row.kind, "source_unit_ids": []} for row in rows
    ]

    save_ok(client, bundle.id, {"action": "confirm", "units": [], "targets": items})

    (suggestion,) = read_suggestions("new")
    assert suggestion.adoption == "as_is"


def test_giving_a_new_target_a_source_records_edited(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    (unit_id,) = read_old_ids(client, bundle, LONE_OLD)
    pair_up(client, bundle.id)
    body = build_target_body(read_target(LONE_NEW), source_unit_ids=[unit_id], change_type="rewritten")
    body["units"] = [{"unit_id": unit_id, "revision": read_decision(unit_id).revision, "disposition": "assigned"}]

    save_ok(client, bundle.id, body)

    (new,) = read_suggestions("new")
    assert new.adoption == "edited"
    (candidate,) = read_suggestions("delete_candidate")
    assert candidate.adoption == "rejected"


def test_removing_a_new_target_records_rejected(client: TestClient, fake_ai: FakeAi) -> None:
    # reset_target가 제안 칸을 비우므로 판단 행 없는 제안은 지우기 전에 남겨야 한다
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    pair_up(client, bundle.id)
    target = read_target(LONE_NEW)

    save_ok(client, bundle.id, {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [target.id]})

    (suggestion,) = read_suggestions("new")
    assert suggestion.adoption == "rejected"
    after = read_target(LONE_NEW)
    assert (after.status, after.suggestion_id) == ("unassigned", None)


def test_removing_a_confirmed_new_target_keeps_the_first_verdict(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    pair_up(client, bundle.id)
    save_ok(client, bundle.id, build_target_body(read_target(LONE_NEW)))
    target = read_target(LONE_NEW)

    save_ok(client, bundle.id, {"action": "confirm", "units": [], "targets": [], "removed_target_ids": [target.id]})

    (suggestion,) = read_suggestions("new")
    assert suggestion.adoption == "as_is"


def test_table_suggestion_compares_the_table_target(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, tbl(CELLS), tbl(CHANGED_CELLS))
    table = find_kind(get_view(client, bundle.id, bundle.old_document_id), "table")["id"]
    pair_up(client, bundle.id)

    save_ok(client, bundle.id, build_group_body(client, bundle.id, table, disposition="assigned"))

    (suggestion,) = read_suggestions("table")
    assert suggestion.adoption == "as_is"


def test_figure_suggestion_records_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    figure = f"<w:p>{make_drawing_run('image1.png')}</w:p>" + p(CAPTION, "Caption")
    bundle = make_match_bundle(client, figure, figure, media=MEDIA)
    unit_id = find_kind(get_view(client, bundle.id, bundle.old_document_id), "figure")["id"]
    pair_up(client, bundle.id)

    save_ok(client, bundle.id, build_group_body(client, bundle.id, unit_id, disposition="assigned"))

    (suggestion,) = read_suggestions("figure")
    assert suggestion.adoption == "as_is"


def test_adoption_stats_count_match_suggestions(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD), p(ORIGINAL_NEW_TEXT) + p(LONE_NEW))
    (unit_id,) = read_old_ids(client, bundle, OLD)
    use_match_reply(fake_ai)
    pair_up(client, bundle.id)
    save_ok(client, bundle.id, build_group_body(client, bundle.id, unit_id, disposition="assigned"))

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
    shape = SuggestedShape("assigned", suggested, is_sources_only=True)

    assert decide_adoption(shape, SavedShape(frozenset(("delete",)), saved)) == expected
