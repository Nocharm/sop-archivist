"""입구 2 짝 계획 — 요청, 후보 고르기, 임베딩·글자 점수, 문장 묶음·표·그림·남은 항목의 제안, 다시 돌리기, 낡은 항목
(설계 §6.7, §7.7, §7.10, §8.4, §12, 2026-11-20-change-type-two D6 — 문장 묶음의 종류도 계획이 바로 정한다)."""

import asyncio
import json
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from typing import Any, TypeVar
from unittest.mock import ANY

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.settings import settings
from app.sop.ai import embeddings
from app.sop.ai.match_jobs import _plan_captions
from app.sop.ai.constants import AI_CALL_ATTEMPTS
from app.sop.ai.jobs import JobItem, enqueue_jobs
from app.sop.constants import AI_PRIORITY_PLAN
from app.sop.ai.runner import claim_next_job
from app.sop.models import AiJob, AiSuggestion, Bundle, BundleEvent, TargetSentence, UnitDecision
from tests.access_helpers import run_in_session
from tests.ai_fixtures import (
    AI_MEMBERS,
    AI_NEW_NAME,
    AI_OLD_NAME,
    AI_SOP_DOC,
    axis,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    clean_embedding_cache,  # noqa: F401
    edit_document,
    find_kind,
    make_ai_bundle,
    make_match_bundle,
    plan,
    read_decision,
    read_links,
    read_old_ids,
    read_rows,
    read_target,
    request_match,
    run_jobs,
    run_plan,
    use_reply,
    use_vectors,
)
from tests.ai_helpers import enable_embed
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, p, tbl
from tests.fake_ai import FakeAi
from tests.sop_helpers import (
    AUTHOR,
    REVIEWER,
    assign_as_is,
    create_bundle,
    find_unit,
    get_group_by_unit,
    get_view,
    put_tobe,
    save_group,
    set_members,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs", "clean_embedding_cache")

T = TypeVar("T")

OLD_1 = "합성 장비의 전원을 켠 뒤 상태 표시등을 확인한다."
NEW_1 = "합성 장비의 전원을 켠 뒤 상태 표시등을 반드시 확인한다."
OLD_2 = "합성 시료를 냉장 보관함에서 꺼내 라벨을 대조한다."
NEW_2 = "합성 시료를 냉장 보관함에서 꺼내 라벨을 꼭 대조한다."
OLD_3 = "합성 배관의 누수를 주 1회 점검하여 결과를 기록한다."
NEW_3A = "합성 배관의 누수를 주 1회 점검한다."
NEW_3B = "합성 배관 점검 결과를 기록한다."
OLD_4 = "합성 필터를 교체한다."
OLD_5 = "합성 필터 교체일을 적는다."
NEW_45 = "합성 필터를 교체하고 교체일을 적는다."
SPACED_OLD = "사용 전에 밸브상태를 확인한다."
SPACED_NEW = "사용 전에 밸브 상태를 확인한다."
SAME = "두 문서에 똑같이 있는 합성 문장이다."
LONE_OLD = "옛 문서에만 남은 교육 일정 공지문이다."
LONE_NEW = "새로 넣은 비상 연락망 안내 문장이다."
LONE_EN = "This synthetic sentence appears only in English."
CAPTION = "그림 1 합성 장비 배치도"
OTHER_CAPTION = "그림 9 전혀 무관한 건물 약도"
CELLS = [["합성 항목", "합성 값"], ["합성 압력", "합성 결과"]]
REWRITTEN_CELL = "합성 압력 범위"
EXTRA_CELL = "합성 설명을 덧붙인다."
REASON = "사람이 정한 삭제 사유."
MEDIA = {"image1.png": TINY_PNG}
SECOND_NEW_FILE = "SYNTHETIC_SOP-N_New.docx"
CONTENT_KEYS = {
    "unit_ids", "target_ids", "shape", "change_type", "links", "target_change_types", "reason", "rule_ids", "retrieval",
}
SENTENCE_SHAPES = ("one_to_one", "split", "merged")


def make_figure(caption: str) -> str:
    return f"<w:p>{make_drawing_run('image1.png')}</w:p>" + (p(caption, "Caption") if caption else "")


def run_beside(work: Callable[..., T], *args: Any) -> T:
    """가짜 AI 훅은 실행기의 이벤트 루프 안에서 돈다 — 다른 스레드에서 끝날 때까지 기다린다."""
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(work, *args).result()


def change_once_during_embedding(ai: FakeAi, change: Callable[[], None]) -> None:
    """첫 임베딩 호출 안에서 한 번만 끼어든다 — 계획이 읽은 뒤이고 적용하기 전이다."""
    embed = ai.embed
    done: list[bool] = []

    def embed_and_change(text: str) -> list[float]:
        if not done:
            done.append(True)
            run_beside(change)
        return embed(text)

    ai.embed = embed_and_change


def read_kind(kind: str) -> list[TargetSentence]:
    return [row for row in read_rows(TargetSentence) if row.kind == kind and row.parent_target_id is None]


def read_jobs(kind: str = "match_plan") -> list[AiJob]:
    return [row for row in read_rows(AiJob) if row.kind == kind]


def read_groups() -> dict[tuple[int, ...], list[int]]:
    """살아 있는 문장 묶음 제안 — (옛 단위들) → 새 문장들."""
    return {
        tuple(row.content["unit_ids"]): row.content["target_ids"] for row in read_rows(AiSuggestion)
        if row.kind == "match" and row.content["shape"] in SENTENCE_SHAPES and row.result == "applied"
    }


def read_suggestion(shape: str) -> AiSuggestion:
    (suggestion,) = [row for row in read_rows(AiSuggestion) if row.content["shape"] == shape]
    return suggestion


def assert_untouched(decision: UnitDecision) -> None:
    assert (decision.status, decision.disposition, decision.suggestion_id) == ("unassigned", "unassigned", None)


def assert_target_untouched(target: TargetSentence) -> None:
    """AI는 입구 2 새 문장을 쓰지 않는다 — 사람이 제안을 받기 전까지 처음 그대로다(설계 2026-11-19-ai-suggest-only D1)."""
    assert (target.status, target.change_type, target.suggestion_id, target.revision) == ("unassigned", None, None, 1)
    assert target.warnings == []


def assert_only_suggestions_written() -> None:
    """계획은 제안 기록에만 쓴다 — 판단·입구 2 새 문장·출처 연결은 처음 그대로다(설계 2026-11-19-ai-suggest-only D1)."""
    decisions = {(row.status, row.disposition, row.suggestion_id, row.revision) for row in read_rows(UnitDecision)}
    assert decisions <= {("unassigned", "unassigned", None, 1)}
    for target in read_rows(TargetSentence):
        if target.origin == "new_doc":
            assert_target_untouched(target)
    assert read_links() == set()


def read_suggested_links(suggestion: AiSuggestion) -> set[tuple[int, int]]:
    """제안이 사람이 받을 때 걸 출처 연결 (새 문장 id, 단위 id)."""
    return {(target_id, unit_id) for target_id, unit_id in suggestion.content["links"]}


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


def build_use_body(suggestion: AiSuggestion, *, action: str = "confirm", **unit_fields: object) -> dict:
    """제안을 받는(Use) 저장 본문 — 화면이 제안 content의 묶음·출처로 초안을 채워 suggestion_id와 함께 보낸다. 변경 종류는 서버가 정한다."""
    content = suggestion.content
    disposition = "delete" if content["shape"] == "delete_candidate" else "assigned"
    targets = {row.id: row for row in read_rows(TargetSentence)}
    sources: dict[int, list[int]] = {target_id: [] for target_id in content["target_ids"]}
    for target_id, unit_id in content["links"]:
        sources[target_id].append(unit_id)
    return {
        "action": action,
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


def use_suggestion(
    client: TestClient, bundle_id: int, suggestion: AiSuggestion, *, action: str = "confirm", **unit_fields: object
) -> dict:
    body = build_use_body(suggestion, action=action, **unit_fields)
    if action == "hold":
        body["hold_reason"] = REASON
    response = save_group(client, bundle_id, body)
    assert response.status_code == 200, response.text
    return response.json()


# --- 요청 ---


def test_match_request_needs_a_match_document(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)

    response = request_match(client, bundle.id)

    assert (response.status_code, response.json()["detail"]["code"]) == (409, "no_match_documents")
    assert read_rows(AiJob) == []


def test_match_request_queues_one_plan_job_for_the_bundle(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))

    response = request_match(client, bundle.id)

    assert response.json() == {"queued": 1, "request_id": ANY, "skipped_total": 0, "skipped": [], "skipped_by_reason": {}}
    (job,) = read_rows(AiJob)
    assert (job.kind, job.status, job.unit_ids, job.target_ids) == ("match_plan", "queued", [], [])
    assert job.requested_by == AUTHOR["X-Dev-User"]
    assert job.payload == {"origin": "user"}


def test_active_plan_job_reports_already_queued(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))
    assert request_match(client, bundle.id).json()["queued"] == 1

    body = request_match(client, bundle.id).json()

    assert body == {
        "queued": 0, "request_id": None, "skipped_total": 1, "skipped": [{"unit_id": 0, "reason": "already_queued"}],
        "skipped_by_reason": {"already_queued": 1},
    }
    assert len(read_jobs()) == 1


def test_an_old_match_job_does_not_block_a_new_plan(client: TestClient, fake_ai: FakeAi) -> None:
    # 걷은 LLM match 작업의 옛 행이 줄에 남아 있어도 계획 요청을 막지 않는다(설계 2026-11-20-change-type-two D6)
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))

    async def _enqueue_old(session: AsyncSession) -> None:
        enqueue_jobs(session, bundle_id=bundle.id, kind="match", requested_by=AUTHOR["X-Dev-User"], items=[JobItem()])
        await session.commit()

    run_in_session(_enqueue_old)

    assert request_match(client, bundle.id).json()["queued"] == 1


def test_match_request_needs_ai_an_author_and_an_editable_bundle(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))

    disabled = request_match(client, bundle.id)
    assert (disabled.status_code, disabled.json()["detail"]["code"]) == (503, "ai_disabled")

    monkeypatch.setattr(settings, "ai_enabled", True)
    assert request_match(client, bundle.id, REVIEWER).status_code == 403

    async def _set_in_review(session: AsyncSession) -> None:
        await session.execute(update(Bundle).where(Bundle.id == bundle.id).values(status="in_review"))
        await session.commit()

    run_in_session(_set_in_review)
    refused = request_match(client, bundle.id)
    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "bundle_not_editable")


def test_queued_plan_sends_nothing_when_ai_is_off(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """다시 시도로 돌아온 계획 — 요청처럼 AI가 꺼지면 멈추고, 묶음 전체를 임베딩하지 않는다."""
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))
    assert request_match(client, bundle.id).status_code == 200
    enable_embed(monkeypatch)
    embedded: list[str] = []

    def embed(text: str) -> list[float]:
        embedded.append(text)
        return axis(0)

    fake_ai.embed = embed
    monkeypatch.setattr(settings, "ai_enabled", False)

    run_jobs()

    assert [(job.kind, job.status, job.error, job.attempts) for job in read_rows(AiJob)] == [
        ("match_plan", "failed", "config", 1)
    ]
    assert fake_ai.requests == [] and embedded == []
    assert read_rows(AiSuggestion) == []


# --- 후보 ---


def test_identical_candidates_are_left_to_bulk_confirm(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(SAME) + p(OLD_1), p(SAME) + p(NEW_1))
    same, old = read_old_ids(client, bundle, SAME, OLD_1)

    plan(client, bundle.id)

    assert read_groups() == {(old,): [read_target(NEW_1).id]}
    assert_untouched(read_decision(same))  # 입구 2 문서뿐이어도 삭제 후보가 되지 않는다
    target = read_target(SAME)
    assert (target.status, target.change_type, target.suggestion_id) == ("unassigned", None, None)
    candidates = client.get(f"/api/bundles/{bundle.id}/match/identical-candidates", headers=AUTHOR).json()
    assert [candidate["unit_id"] for candidate in candidates] == [same]


def test_units_assigned_to_entrance_1_are_excluded(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1) + p(OLD_2), p(NEW_1) + p(NEW_2), has_assign=True)
    assigned, free = read_old_ids(client, bundle, OLD_1, OLD_2)
    unit = find_unit(get_view(client, bundle.id, bundle.old_document_id), OLD_1)
    assign_as_is(client, bundle.id, unit, bundle.sop_id, slot_key="purpose")
    before = read_decision(assigned)

    plan(client, bundle.id)

    assert read_groups() == {(free,): [read_target(NEW_2).id]}
    after = read_decision(assigned)
    assert (after.status, after.disposition, after.revision) == ("confirmed", "assigned", before.revision)
    # 짝이 입구 1로 갔으니 새 문장은 짝이 없다 — 신규 제안이 덮고, 새 문장은 미배정 그대로다
    assert read_suggestion("new").content["target_ids"] == [read_target(NEW_1).id]
    assert_target_untouched(read_target(NEW_1))


@pytest.mark.usefixtures("hidden_ai_on")
def test_units_with_a_classify_suggestion_are_excluded(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1) + p(OLD_2), p(NEW_1) + p(NEW_2), has_assign=True)
    suggested, free = read_old_ids(client, bundle, OLD_1, OLD_2)
    use_reply(fake_ai, rewrites={"ko": ["합성 고쳐 쓴 문장이다."]})
    response = client.post(f"/api/bundles/{bundle.id}/ai/classify", json={"unit_ids": [suggested]}, headers=AUTHOR)
    assert response.status_code == 200, response.text
    run_jobs()
    (classify,) = [row for row in read_rows(AiSuggestion) if row.kind == "classify"]
    assert (classify.result, classify.adoption, classify.content["unit_ids"]) == ("applied", None, [suggested])
    classified = read_decision(suggested)
    assert_untouched(classified)  # 분류 제안은 판단을 쓰지 않는다 — 살아 있는 분류 제안이 단위를 덮는다

    plan(client, bundle.id)

    assert list(read_groups()) == [(free,)]
    assert all(suggested not in row.content["unit_ids"] for row in read_rows(AiSuggestion) if row.kind == "match")
    after = read_decision(suggested)
    assert (after.status, after.suggestion_id, after.revision) == ("unassigned", None, classified.revision)


def test_only_top_level_rows_become_candidates(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, tbl(CELLS), tbl(CELLS))
    view = get_view(client, bundle.id, bundle.old_document_id)
    cells = [unit["id"] for unit in view["units"] if unit["group_unit_id"] is not None]

    plan(client, bundle.id)

    assert read_groups() == {}  # 칸 문장은 표와 함께 가고 따로 짝이 되지 않는다
    assert read_suggestion("table").content["unit_ids"] == [find_kind(view, "table")["id"]]
    assert all(read_decision(cell).status == "unassigned" for cell in cells)  # 칸의 상태는 표 단위가 담는다


# --- 문장 그룹 ---


def test_plan_writes_one_suggestion_per_sentence_group(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    old_body = p(OLD_1) + p(OLD_3) + p(OLD_4) + p(OLD_5)
    bundle = make_match_bundle(client, old_body, p(NEW_1) + p(NEW_3A) + p(NEW_3B) + p(NEW_45))
    use_vectors(monkeypatch, fake_ai, {
        OLD_1: 0, NEW_1: 0, OLD_3: 1, NEW_3A: 1, NEW_3B: 1, OLD_4: 2, OLD_5: 2, NEW_45: 2,
    })
    one, split, merge_a, merge_b = read_old_ids(client, bundle, OLD_1, OLD_3, OLD_4, OLD_5)

    plan(client, bundle.id)

    assert read_groups() == {
        (one,): [read_target(NEW_1).id],
        (split,): [read_target(NEW_3A).id, read_target(NEW_3B).id],
        (merge_a, merge_b): [read_target(NEW_45).id],
    }
    suggestions = read_rows(AiSuggestion)
    assert {row.document_id for row in suggestions} == {bundle.old_document_id}
    assert {row.content["retrieval"] for row in suggestions} == {"embedding"}
    # 문장 묶음의 종류는 계획이 구조와 글로 정한 값이 마지막이다 — 뒤따르는 작업이 없다
    assert {
        (tuple(row.content["unit_ids"]), row.content["shape"], row.content["change_type"]) for row in suggestions
    } == {
        ((one,), "one_to_one", "rewritten"),
        ((split,), "split", "split"),
        ((merge_a, merge_b), "merged", "merged"),
    }
    assert {job.kind for job in read_rows(AiJob)} == {"match_plan"}
    types: dict[int, str] = {}
    for row in read_rows(AiSuggestion):
        types.update(read_suggested_types(row))
    assert {text: types[read_target(text).id] for text in (NEW_1, NEW_3A, NEW_3B, NEW_45)} == {
        NEW_1: "rewritten", NEW_3A: "split", NEW_3B: "split", NEW_45: "merged",
    }
    assert_only_suggestions_written()


def queue_plan(bundle_id: int, payload: dict[str, object]) -> None:
    """저절로 서는 계획을 직접 쌓는다 — 업로드·배정 화면 첫 진입의 자리는 아직 없다."""

    async def _enqueue(session: AsyncSession) -> None:
        enqueue_jobs(
            session, bundle_id=bundle_id, kind="match_plan", requested_by=AUTHOR["X-Dev-User"],
            items=[JobItem(payload=payload)], priority=AI_PRIORITY_PLAN,
        )
        await session.commit()

    run_in_session(_enqueue)


def test_plan_writes_a_sentence_group_without_any_llm_call(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))
    use_vectors(monkeypatch, fake_ai, {OLD_1: 0, NEW_1: 0})
    (unit_id,) = read_old_ids(client, bundle, OLD_1)

    plan(client, bundle.id)

    target, suggestion = read_target(NEW_1), read_suggestion("one_to_one")
    assert (suggestion.content["unit_ids"], suggestion.content["target_ids"]) == ([unit_id], [target.id])
    assert read_suggested_links(suggestion) == {(target.id, unit_id)}
    assert read_suggested_types(suggestion) == {target.id: "rewritten"}
    assert_only_suggestions_written()
    assert suggestion.content["shape"] == "one_to_one"
    assert (suggestion.content["change_type"], suggestion.content["reason"]) == ("rewritten", "")
    assert fake_ai.requests == []  # 채팅 호출 없이 쓰였다


def test_spacing_only_pair_is_rewritten(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 띄어쓰기만 달라도 글자가 다르면 고침이다(설계 2026-11-20-change-type-two D2)
    bundle = make_match_bundle(client, p(SPACED_OLD), p(SPACED_NEW))
    use_vectors(monkeypatch, fake_ai, {SPACED_OLD: 0, SPACED_NEW: 0})

    plan(client, bundle.id)

    target, suggestion = read_target(SPACED_NEW), read_suggestion("one_to_one")
    assert read_suggested_types(suggestion) == {target.id: "rewritten"}
    assert_target_untouched(target)
    assert suggestion.content["change_type"] == "rewritten"


def test_upload_origin_plan_writes_no_delete_candidates(client: TestClient, fake_ai: FakeAi) -> None:
    """파일을 읽은 직후에는 배정 New 문서 목록이 아직 비어 있을 수 있어 짝 없는 옛 단위를 분류 몫으로 남긴다."""
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    (unit,) = read_old_ids(client, bundle, LONE_OLD)
    queue_plan(bundle.id, {"origin": "upload"})

    run_plan()

    assert_untouched(read_decision(unit))
    # 신규는 그대로 제안한다
    assert [row.content["shape"] for row in read_rows(AiSuggestion)] == ["new"]
    assert read_suggestion("new").content["target_ids"] == [read_target(LONE_NEW).id]


@pytest.mark.usefixtures("hidden_ai_on")
def test_prepare_origin_plan_writes_delete_candidates(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    (unit,) = read_old_ids(client, bundle, LONE_OLD)
    queue_plan(bundle.id, {"origin": "prepare"})

    run_plan()

    assert read_suggestion("delete_candidate").content["unit_ids"] == [unit]
    assert_only_suggestions_written()


def test_repeated_text_pairs_one_to_one_and_leaves_no_delete_candidate(client: TestClient, fake_ai: FakeAi) -> None:
    """같은 문장이 두 곳에 있으면 거짓 나눔과 거짓 삭제 후보가 나오던 자리다. 이 짝은 한 번에 확정 후보가 아니라 짝 계획으로 간다."""
    bundle = make_match_bundle(client, p(SAME) + p(OLD_1) + p(SAME), p(SAME) + p(NEW_1) + p(SAME))
    view = get_view(client, bundle.id, bundle.old_document_id)
    first, second = find_unit(view, SAME, 1)["id"], find_unit(view, SAME, 2)["id"]
    old_once = find_unit(view, OLD_1)["id"]

    plan(client, bundle.id)

    same_targets = [row.id for row in read_rows(TargetSentence) if row.confirmed_text == SAME]
    assert read_groups() == {
        (first,): [same_targets[0]], (old_once,): [read_target(NEW_1).id], (second,): [same_targets[1]],
    }
    assert {tuple(row.content["unit_ids"]): row.content["change_type"] for row in read_rows(AiSuggestion)} == {
        (first,): "as_is", (old_once,): "rewritten", (second,): "as_is",
    }
    assert client.get(f"/api/bundles/{bundle.id}/match/identical-candidates", headers=AUTHOR).json() == []


@pytest.mark.usefixtures("hidden_ai_on")
def test_same_vector_across_languages_never_pairs(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(LONE_EN))
    use_vectors(monkeypatch, fake_ai, {OLD_1: 0, LONE_EN: 0})

    plan(client, bundle.id)

    assert read_groups() == {}
    assert read_suggestion("delete_candidate").content["unit_ids"] == read_old_ids(client, bundle, OLD_1)
    assert read_suggested_types(read_suggestion("new")) == {read_target(LONE_EN).id: "new"}


# --- 남은 항목 ---


@pytest.mark.usefixtures("hidden_ai_on")
@pytest.mark.parametrize("has_assign", [False, True])
def test_unmatched_old_is_delete_candidate_only_without_assign_docs(
    client: TestClient, fake_ai: FakeAi, has_assign: bool
) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW), has_assign=has_assign)
    (unit,) = read_old_ids(client, bundle, LONE_OLD)

    plan(client, bundle.id)

    decision = read_decision(unit)
    if has_assign:  # 입구 1로 갈 문장이 삭제 후보로 쏟아지지 않게 제안하지 않는다
        assert_untouched(decision)
        assert decision.revision == 1
        assert [row.content["shape"] for row in read_rows(AiSuggestion)] == ["new"]
        return
    suggestion = read_suggestion("delete_candidate")
    assert_only_suggestions_written()  # 처분·사유는 사람이 제안을 받아 확정할 때 쓴다
    assert suggestion.content == {
        "unit_ids": [unit], "target_ids": [], "shape": "delete_candidate", "change_type": "deleted", "links": [],
        "target_change_types": {}, "reason": "", "rule_ids": [], "retrieval": "no_index",
    }
    assert (suggestion.kind, suggestion.result, suggestion.document_id) == ("match", "applied", bundle.old_document_id)


def test_unmatched_new_is_suggested_as_new(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))

    plan(client, bundle.id)

    target = read_target(LONE_NEW)
    suggestion = read_suggestion("new")
    assert_target_untouched(target)
    assert (target.confirmed_text, target.ai_text) == (LONE_NEW, "")  # 글자는 새 문서 원문 그대로다
    assert suggestion.content == {
        "unit_ids": [], "target_ids": [target.id], "shape": "new", "change_type": "new", "links": [],
        "target_change_types": {str(target.id): "new"}, "reason": "", "rule_ids": [], "retrieval": "no_index",
    }
    assert (suggestion.kind, suggestion.document_id) == ("match", bundle.new_document_id)


def test_unmatched_new_table_takes_its_cells_along(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), tbl(CELLS))

    plan(client, bundle.id)

    suggestion = read_suggestion("new")
    (table,) = read_kind("table")
    cells = [row for row in read_rows(TargetSentence) if row.parent_target_id == table.id]
    assert suggestion.content["target_ids"] == [table.id, *(cell.id for cell in cells)]
    assert read_suggested_types(suggestion) == {target_id: "new" for target_id in suggestion.content["target_ids"]}
    for cell in cells:
        assert_target_untouched(cell)


def test_new_rows_left_by_the_plan_can_be_confirmed_in_bulk(client: TestClient, fake_ai: FakeAi) -> None:
    """신규 제안이 덮은 새 문장은 미배정 그대로라 같은 글자·신규 일괄 확정이 받는다.

    신규 확정은 신규 제안과 같은 결정이라 그 제안을 그대로 받은 것으로 남긴다 — 종류별 일괄 수락의 신규도 이 길이다(설계 §5 3-5).
    """
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW) + tbl(CELLS))
    plan(client, bundle.id)
    rows = [row for row in read_rows(TargetSentence) if row.origin == "new_doc"]
    assert {row.status for row in rows} == {"unassigned"}

    response = client.post(
        f"/api/bundles/{bundle.id}/match/bulk-confirm",
        json={"new": [{"target_id": row.id, "revision": row.revision} for row in rows]}, headers=AUTHOR,
    )

    assert response.status_code == 200, response.text
    assert {(row.status, row.change_type) for row in read_rows(TargetSentence)} == {("confirmed", "new")}
    assert {row.adoption for row in read_rows(AiSuggestion) if row.content["shape"] == "new"} == {"as_is"}


# --- 표·그림 ---


def test_same_shape_table_links_cells_by_position(client: TestClient, fake_ai: FakeAi) -> None:
    changed = [CELLS[0], [REWRITTEN_CELL, CELLS[1][1]]]
    bundle = make_match_bundle(client, tbl(CELLS), tbl(changed))
    view = get_view(client, bundle.id, bundle.old_document_id)
    table_unit = find_kind(view, "table")["id"]
    cell_of = {unit["text"]: unit["id"] for unit in view["units"] if unit["group_unit_id"] == table_unit}

    plan(client, bundle.id)

    suggestion = read_suggestion("table")
    (table,) = read_kind("table")
    cells = {row.confirmed_text: row for row in read_rows(TargetSentence) if row.parent_target_id == table.id}
    assert read_suggested_links(suggestion) == {
        (table.id, table_unit),
        (cells[CELLS[0][0]].id, cell_of[CELLS[0][0]]),
        (cells[CELLS[0][1]].id, cell_of[CELLS[0][1]]),
        (cells[REWRITTEN_CELL].id, cell_of[CELLS[1][0]]),
        (cells[CELLS[1][1]].id, cell_of[CELLS[1][1]]),
    }
    types = read_suggested_types(suggestion)
    assert types[table.id] == "as_is"
    assert {text: types[row.id] for text, row in cells.items()} == {
        CELLS[0][0]: "as_is", CELLS[0][1]: "as_is", REWRITTEN_CELL: "rewritten", CELLS[1][1]: "as_is",
    }
    assert (suggestion.content["shape"], suggestion.content["change_type"]) == ("table", "as_is")
    assert suggestion.content["unit_ids"] == [table_unit]
    assert set(suggestion.content["target_ids"]) == {table.id, *(row.id for row in cells.values())}
    assert_only_suggestions_written()  # 칸 연결도 사람이 받을 때 걸린다
    assert fake_ai.requests == []


def test_cell_warning_compares_the_old_and_new_cell(client: TestClient, fake_ai: FakeAi) -> None:
    old = [["합성 온도 기준", "합성 값 10 ℃ 이하"], ["합성 압력", "합성 결과"]]
    new = [["합성 온도 기준", "합성 값 20 ℃ 이하"], ["합성 압력", "합성 결과"]]
    bundle = make_match_bundle(client, tbl(old), tbl(new))

    plan(client, bundle.id)

    mismatch = [{"kind": "number_mismatch", "source": "10", "target": "20"}]
    assert read_suggestion("table").warnings == mismatch  # 칸마다의 문장 검사가 제안 하나의 경고로 모인다
    assert read_target(new[0][1]).warnings == read_target(new[0][0]).warnings == []  # 새 문장에는 쓰지 않는다
    body = client.get(f"/api/bundles/{bundle.id}/ai/suggestions", params={"kind": "match"}, headers=AUTHOR).json()
    assert body["items"][0]["warnings"] == mismatch


def test_different_shape_table_suggests_restructured(client: TestClient, fake_ai: FakeAi) -> None:
    wider = [[*row, "합성 비고"] for row in CELLS]
    bundle = make_match_bundle(client, tbl(CELLS), tbl(wider))
    table_unit = find_kind(get_view(client, bundle.id, bundle.old_document_id), "table")["id"]

    plan(client, bundle.id)

    suggestion = read_suggestion("table")
    (table,) = read_kind("table")
    assert read_suggested_links(suggestion) == {(table.id, table_unit)}  # 칸 연결은 없다
    assert suggestion.content["change_type"] == "rewritten"
    cells = [row for row in read_rows(TargetSentence) if row.parent_target_id == table.id]
    assert read_suggested_types(suggestion) == {table.id: "rewritten", **{row.id: "new" for row in cells}}
    assert_only_suggestions_written()


def test_table_caption_links_beside_the_cells_and_stays_out_of_the_table_text(client: TestClient, fake_ai: FakeAi) -> None:
    """캡션 새 문장은 칸 좌표 없이 표 아래에 있고 옛 표의 캡션에 이어진다 — 캡션 글이 달라도 칸이 같으면 표는 그대로다."""
    bundle = make_match_bundle(
        client, p("표 1 합성 조건", "Caption") + tbl(CELLS), p("표 1 합성 운전 조건", "Caption") + tbl(CELLS)
    )
    view = get_view(client, bundle.id, bundle.old_document_id)
    table_unit, old_caption = find_kind(view, "table")["id"], find_kind(view, "caption")["id"]

    plan(client, bundle.id)

    suggestion = read_suggestion("table")
    (table,) = read_kind("table")
    (caption,) = [row for row in read_rows(TargetSentence) if row.parent_target_id == table.id and row.cell_row is None]
    types = read_suggested_types(suggestion)
    assert (types[table.id], types[caption.id]) == ("as_is", "rewritten")
    assert {(table.id, table_unit), (caption.id, old_caption)} <= read_suggested_links(suggestion)
    assert caption.id in suggestion.content["target_ids"]
    assert_only_suggestions_written()


def test_captions_link_per_language_and_a_new_caption_without_an_old_one_is_new() -> None:
    """한/영 캡션 둘은 언어마다 잇고(문서 순서가 달라도), 옛 쪽에 남은 같은 언어 캡션이 없는 새 캡션은 신규다."""
    old_ko = SimpleNamespace(id=1, lang="ko", text="표 1 합성 조건")
    old_en = SimpleNamespace(id=2, lang="en", text="Table 1 Synthetic conditions")
    new_en = SimpleNamespace(id=10, lang="en", confirmed_text="Table 1 Synthetic conditions")
    new_ko = SimpleNamespace(id=11, lang="ko", confirmed_text="표 1 합성 운전 조건")
    new_ko_extra = SimpleNamespace(id=12, lang="ko", confirmed_text="표 1 합성 조건(계속)")

    writes, links = _plan_captions([old_ko, old_en], [new_en, new_ko, new_ko_extra])

    assert sorted(links) == [(10, 2), (11, 1)]
    assert [(write.target.id, write.change_type) for write in writes] == [(10, "as_is"), (11, "rewritten"), (12, "new")]


def test_same_grid_with_an_old_cell_left_over_is_not_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    """옛 칸 문장이 남으면 저장이 표를 그대로로 정하지 않는다(decisions._keeps_table_shape) — 격자가 같아도 고침이다."""
    two_sentences = [CELLS[0], [f"{CELLS[1][0]}. {EXTRA_CELL}", CELLS[1][1]]]
    bundle = make_match_bundle(client, tbl(two_sentences), tbl(CELLS))
    view = get_view(client, bundle.id, bundle.old_document_id)
    left_over = find_unit(view, EXTRA_CELL)["id"]

    plan(client, bundle.id)

    (table,) = read_kind("table")
    suggestion = read_suggestion("table")
    types = read_suggested_types(suggestion)
    assert types[table.id] == "rewritten"
    assert left_over not in {unit_id for _, unit_id in read_suggested_links(suggestion)}
    assert types[read_target(CELLS[0][0]).id] == "as_is"


def test_same_grid_with_a_new_cell_sentence_stays_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    """옛 칸이 모두 이어지면 그대로로 확정할 수 있다 — 새 문서가 덧붙인 칸 문장만 신규다."""
    two_sentences = [CELLS[0], [f"{CELLS[1][0]}. {EXTRA_CELL}", CELLS[1][1]]]
    bundle = make_match_bundle(client, tbl(CELLS), tbl(two_sentences))

    plan(client, bundle.id)

    (table,) = read_kind("table")
    suggestion = read_suggestion("table")
    extra = read_target(EXTRA_CELL)
    assert (read_suggested_types(suggestion)[table.id], read_suggested_types(suggestion)[extra.id]) == ("as_is", "new")
    assert extra.id not in {target_id for target_id, _ in read_suggested_links(suggestion)}
    assert_target_untouched(extra)


def test_figures_pair_as_is_without_llm(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, make_figure(CAPTION), make_figure(CAPTION), media=MEDIA)
    unit = find_kind(get_view(client, bundle.id, bundle.old_document_id), "figure")["id"]

    plan(client, bundle.id)

    suggestion = read_suggestion("figure")
    (figure,) = read_kind("figure")
    (caption,) = [row for row in read_rows(TargetSentence) if row.parent_target_id == figure.id]
    old_caption = find_unit(get_view(client, bundle.id, bundle.old_document_id), CAPTION)["id"]
    # 캡션 새 문장은 그림 아래 자식이고 옛 그림의 캡션 단위에 함께 이어진다 — 사람이 받을 때 걸 연결이다
    assert figure.confirmed_text == ""
    assert suggestion.content == {
        "unit_ids": [unit], "target_ids": [figure.id, caption.id], "shape": "figure", "change_type": "as_is",
        "links": [[figure.id, unit], [caption.id, old_caption]],
        "target_change_types": {str(figure.id): "as_is", str(caption.id): "as_is"},
        "reason": "", "rule_ids": [], "retrieval": "no_index",
    }
    assert_only_suggestions_written()
    assert fake_ai.requests == []


def test_confirming_a_figure_pair_with_its_caption_is_adopted_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    """그림 제안은 그림 새 문장의 출처로 채택을 본다 — 제안을 받아(suggestion_id) 캡션까지 이어 확정하면 그대로다."""
    bundle = make_match_bundle(client, make_figure(CAPTION), make_figure(CAPTION), media=MEDIA)
    view = get_view(client, bundle.id, bundle.old_document_id)
    unit, old_caption = find_kind(view, "figure")["id"], find_unit(view, CAPTION)["id"]
    plan(client, bundle.id)
    (figure,) = read_kind("figure")
    (caption,) = [row for row in read_rows(TargetSentence) if row.parent_target_id == figure.id]
    suggestion = read_suggestion("figure")

    response = save_group(client, bundle.id, {
        "action": "confirm",
        "suggestion_id": suggestion.id,
        "units": [{"unit_id": unit, "revision": read_decision(unit).revision, "disposition": "assigned"}],
        "targets": [
            {"key": "f", "id": figure.id, "revision": figure.revision, "kind": "figure", "source_unit_ids": [unit]},
            {"key": "c", "id": caption.id, "revision": caption.revision, "source_unit_ids": [old_caption]},
        ],
    })

    assert response.status_code == 200, response.text
    assert read_suggestion("figure").adoption == "as_is"
    assert read_decision(unit).suggestion_id == suggestion.id
    assert read_links() == {(figure.id, unit), (caption.id, old_caption)}


def test_figures_with_other_captions_do_not_pair(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, make_figure(CAPTION), make_figure(OTHER_CAPTION), media=MEDIA)

    plan(client, bundle.id)

    assert read_links() == set()
    # 새 문서의 캡션 새 문장은 그림 아래 자식이라 그림과 한 신규 제안이다
    (figure,) = read_kind("figure")
    (caption,) = [row for row in read_rows(TargetSentence) if row.parent_target_id == figure.id]
    new_groups = [row.content["target_ids"] for row in read_rows(AiSuggestion) if row.content["shape"] == "new"]
    assert new_groups == [[figure.id, caption.id]]


# --- 점수 ---


def test_text_similarity_is_used_without_embeddings(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))

    plan(client, bundle.id)

    assert read_suggestion("one_to_one").content["retrieval"] == "no_index"


def test_embedding_failure_falls_back_to_text(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))
    enable_embed(monkeypatch)
    monkeypatch.setattr(embeddings, "AI_RETRY_DELAYS", (0.0,) * (AI_CALL_ATTEMPTS - 1))  # 재시도를 기다리지 않는다

    def fail(text: str) -> list[float]:
        raise httpx2.ConnectError("embedding server is down")

    fake_ai.embed = fail

    plan(client, bundle.id)

    assert read_suggestion("one_to_one").content["retrieval"] == "embedding_failed"  # 꺼짐(no_index)과 다른 상태다


@pytest.mark.usefixtures("hidden_ai_on")
def test_embedding_threshold_differs_from_the_text_threshold(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """글자 임계값(0.5)이면 짝이 될 점수지만 임베딩 임계값(0.75) 아래다."""
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))
    enable_embed(monkeypatch)
    fake_ai.embed = lambda text: [1.0, 0.0] if text == OLD_1 else [0.6, 0.8]  # 코사인 0.6

    plan(client, bundle.id)

    assert read_groups() == {}
    assert read_suggestion("delete_candidate").content["retrieval"] == "embedding"


def test_blank_texts_are_not_embedded(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    """캡션 없는 그림은 글이 없다 — 빈 글을 보내면 서버가 거절해 묶음 전체가 임베딩을 잃을 수 있다."""
    bundle = make_match_bundle(client, make_figure("") + p(OLD_1), make_figure("") + p(NEW_1), media=MEDIA)
    use_vectors(monkeypatch, fake_ai, {OLD_1: 0, NEW_1: 0})

    plan(client, bundle.id)

    assert read_suggestion("one_to_one").content["retrieval"] == "embedding"
    suggested = {link for row in read_rows(AiSuggestion) for link in read_suggested_links(row)}
    assert suggested == {(read_target(NEW_1).id, *read_old_ids(client, bundle, OLD_1))}  # 그림은 잇지 않는다


@pytest.mark.usefixtures("hidden_ai_on")
@pytest.mark.parametrize(("old_blank", "new_blank"), [(True, True), (True, False), (False, True)])
def test_blank_units_stay_unassigned(
    client: TestClient, fake_ai: FakeAi, old_blank: bool, new_blank: bool
) -> None:
    """글자가 없으면 비교할 수 없어 사람이 손으로 맞춘다(설계 §7.10) — 삭제 후보도 신규도 아니다."""
    old_body = (make_figure("") if old_blank else "") + p(LONE_OLD)
    new_body = (make_figure("") if new_blank else "") + p(LONE_NEW)
    bundle = make_match_bundle(client, old_body, new_body, media=MEDIA)
    view = get_view(client, bundle.id, bundle.old_document_id)

    plan(client, bundle.id)

    if old_blank:
        unit = find_kind(view, "figure")["id"]
        assert_untouched(read_decision(unit))
        assert read_decision(unit).revision == 1
    if new_blank:
        (figure,) = read_kind("figure")
        assert (figure.status, figure.change_type, figure.suggestion_id) == ("unassigned", None, None)
        assert figure.revision == 1
    # 글이 있는 항목은 그대로 처리된다
    assert {row.content["shape"] for row in read_rows(AiSuggestion)} == {"delete_candidate", "new"}
    assert read_links() == set()


@pytest.mark.usefixtures("hidden_ai_on")
def test_table_without_text_stays_unassigned(client: TestClient, fake_ai: FakeAi) -> None:
    empty_cells = [["", ""], ["", ""]]
    bundle = make_match_bundle(client, p(LONE_OLD) + tbl(empty_cells), p(LONE_NEW) + tbl(empty_cells))
    table_unit = find_kind(get_view(client, bundle.id, bundle.old_document_id), "table")["id"]

    plan(client, bundle.id)

    assert_untouched(read_decision(table_unit))
    assert [row.status for row in read_kind("table")] == ["unassigned"]
    assert {row.content["shape"] for row in read_rows(AiSuggestion)} == {"delete_candidate", "new"}


@pytest.mark.usefixtures("hidden_ai_on")
def test_scores_are_not_stored(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = make_match_bundle(
        client, p(OLD_1) + p(LONE_OLD) + tbl(CELLS), p(NEW_1) + p(LONE_NEW) + tbl(CELLS),
    )
    use_vectors(monkeypatch, fake_ai, {
        OLD_1: 0, NEW_1: 0, LONE_OLD: 1, LONE_NEW: 2, " ".join(cell for row in CELLS for cell in row): 3,
    })

    plan(client, bundle.id)

    suggestions = read_rows(AiSuggestion)
    assert {row.content["shape"] for row in suggestions} == {"delete_candidate", "new", "table", "one_to_one"}
    assert all(set(row.content) == CONTENT_KEYS for row in suggestions)
    (plan_job,) = read_jobs()
    assert set(plan_job.input_snapshot) == {"unit_revisions", "target_revisions"}
    assert plan_job.payload == {"origin": "user"}


@pytest.mark.usefixtures("hidden_ai_on")
def test_suggestions_are_read_as_kind_match(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    plan(client, bundle.id)

    body = client.get(f"/api/bundles/{bundle.id}/ai/suggestions", params={"kind": "match"}, headers=AUTHOR).json()

    assert {item["content"]["shape"] for item in body["items"]} == {"delete_candidate", "new"}
    assert "score" not in json.dumps(body)


# --- 다시 돌리기 ---


@pytest.mark.usefixtures("hidden_ai_on")
def test_rerun_keeps_unchanged_suggestions(client: TestClient, fake_ai: FakeAi) -> None:
    """다시 세운 계획이 같은 것을 쓰려 하면 밀어내지도 다시 쓰지도 않는다 — 제안 id가 그대로다(설계 §4)."""
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    (unit,) = read_old_ids(client, bundle, LONE_OLD)
    plan(client, bundle.id)
    first_delete, first_new = read_suggestion("delete_candidate").id, read_suggestion("new").id

    plan(client, bundle.id)

    assert {(row.id, row.result) for row in read_rows(AiSuggestion)} == {(first_delete, "applied"), (first_new, "applied")}
    assert (find_live(unit_id=unit).id, find_live(target_id=read_target(LONE_NEW).id).id) == (first_delete, first_new)
    assert_only_suggestions_written()


@pytest.mark.usefixtures("hidden_ai_on")
def test_rerun_that_finds_a_pair_clears_the_old_suggestions(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """앞 계획의 삭제 후보·신규가 뒤 계획에서 짝이 되면 밀려나고(stale) 그 자리에 문장 묶음 제안이 쓰인다."""
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))
    use_vectors(monkeypatch, fake_ai, {OLD_1: 0, NEW_1: 1})
    plan(client, bundle.id)
    (unit,) = read_old_ids(client, bundle, OLD_1)
    first_delete, first_new = read_suggestion("delete_candidate").id, read_suggestion("new").id

    monkeypatch.setattr(settings, "embed_enabled", False)  # 글자 유사도로는 짝이 된다
    plan(client, bundle.id)

    rows = {row.id: row for row in read_rows(AiSuggestion)}
    assert (rows[first_delete].result, rows[first_new].result) == ("stale", "stale")
    pair = read_suggestion("one_to_one")
    target = read_target(NEW_1)
    assert find_live(unit_id=unit).id == find_live(target_id=target.id).id == pair.id
    assert read_suggested_links(pair) == {(target.id, unit)}
    assert read_suggested_types(pair) == {target.id: "rewritten"}
    # AI는 revision을 올리지 않는다 — 사람이 보던 화면의 저장을 막지 않는다
    assert_only_suggestions_written()


def test_rerun_keeps_new_doc_targets_and_their_text(client: TestClient, fake_ai: FakeAi) -> None:
    changed = [CELLS[0], [REWRITTEN_CELL, CELLS[1][1]]]
    body_old = tbl(CELLS) + make_figure(CAPTION)
    bundle = make_match_bundle(client, body_old, tbl(changed) + make_figure(CAPTION), media=MEDIA)
    plan(client, bundle.id)
    before = {row.id: row.confirmed_text for row in read_rows(TargetSentence)}
    links = read_links()

    plan(client, bundle.id)

    assert {row.id: row.confirmed_text for row in read_rows(TargetSentence)} == before
    assert read_links() == links
    assert {row.result for row in read_rows(AiSuggestion)} == {"applied"}  # 그대로인 표·그림은 다시 쓰지 않는다


def test_rerun_leaves_a_used_table_and_its_ai_translation(client: TestClient, fake_ai: FakeAi) -> None:
    """사람이 받아 확정한 표는 후보가 아니라 다시 세운 계획이 건드리지 않는다 — 칸에 청한 AI 번역도, 출처도 그대로다.

    AI 번역은 배정된 단위에만 청할 수 있어 사람이 제안을 받은 뒤의 모습이다.
    """
    bundle = make_match_bundle(client, tbl(CELLS), tbl(CELLS))
    view = get_view(client, bundle.id, bundle.old_document_id)
    cell = find_unit(view, CELLS[0][0])["id"]
    plan(client, bundle.id)
    table_suggestion = read_suggestion("table")
    use_suggestion(client, bundle.id, table_suggestion)
    links = read_links()
    fake_ai.chat = lambda data: json.dumps({"text": "Synthetic item"})
    translate = client.post(
        f"/api/bundles/{bundle.id}/ai/translate", json={"direction": "ko_to_en", "unit_ids": [cell]}, headers=AUTHOR,
    )
    assert translate.json()["queued"] == 1, translate.text
    run_jobs()
    (translation,) = [row for row in read_rows(TargetSentence) if row.origin == "translation"]

    plan(client, bundle.id)

    assert [row.id for row in read_rows(TargetSentence) if row.origin == "translation"] == [translation.id]
    suggestion = next(row for row in read_rows(AiSuggestion) if row.id == translation.suggestion_id)
    assert (suggestion.kind, suggestion.result) == ("translate", "applied")
    (table,) = read_kind("table")
    assert (table.status, table.suggestion_id) == ("confirmed", table_suggestion.id)
    assert (read_target(CELLS[0][0]).id, cell) in links
    assert read_links() == links
    # 새 표 제안을 쓰지 않는다 — 받은 제안의 채택만 남는다
    assert [(row.id, row.adoption) for row in read_rows(AiSuggestion) if row.kind == "match"] == [
        (table_suggestion.id, "as_is")
    ]


@pytest.mark.usefixtures("hidden_ai_on")
def test_replan_of_a_changed_table_marks_its_suggestion_stale(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """다시 세운 계획이 표 묶음을 바꾸면 살아 있는 표 제안을 밀어내고 다시 쓴다 — 새 문장·출처는 어느 쪽도 건드리지 않는다."""
    unrelated = [["전혀 다른 머리 칸", "무관한 칸"], ["엉뚱한 줄 이름", "관계없는 값"]]
    bundle = make_match_bundle(client, tbl(CELLS), tbl(unrelated))
    view = get_view(client, bundle.id, bundle.old_document_id)
    table = find_kind(view, "table")["id"]
    enable_embed(monkeypatch)
    fake_ai.embed = lambda text: axis(0)  # 임베딩으로는 두 표가 짝이다
    plan(client, bundle.id)
    table_suggestion = read_suggestion("table").id

    monkeypatch.setattr(settings, "embed_enabled", False)  # 글자 유사도로는 짝이 아니다 — 표 묶음이 바뀐다
    plan(client, bundle.id)

    rows = {row.id: row for row in read_rows(AiSuggestion)}
    assert rows[table_suggestion].result == "stale"
    (new_table,) = read_kind("table")
    new_suggestion = find_live(target_id=new_table.id)
    assert (new_suggestion.content["shape"], read_suggested_types(new_suggestion)[new_table.id]) == ("new", "new")
    assert find_live(unit_id=table).content["shape"] == "delete_candidate"
    assert_only_suggestions_written()


def test_new_target_with_a_previous_suggestion_keeps_its_row_and_text(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """판단 없이 새 문장만 덮던 신규 제안도 묶음이 달라지면 밀려난다 — 새 문장 행과 새 문서의 글은 처음 그대로다."""
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))
    use_vectors(monkeypatch, fake_ai, {OLD_1: 0, NEW_1: 1})
    plan(client, bundle.id)
    target = read_target(NEW_1)
    first = find_live(target_id=target.id).id
    assert read_suggestion("new").id == first

    monkeypatch.setattr(settings, "embed_enabled", False)  # 글자 유사도로는 짝이 된다
    plan(client, bundle.id)

    again = read_target(NEW_1)
    assert (again.id, again.confirmed_text) == (target.id, NEW_1)
    assert_target_untouched(again)
    assert find_live(target_id=target.id).content["shape"] == "one_to_one"
    assert next(row for row in read_rows(AiSuggestion) if row.id == first).result == "stale"


# --- 다시 세운 계획 ---


def add_new_document(client: TestClient, bundle_id: int, body: str) -> None:
    uploaded = upload(client, bundle_id, build_docx(body), SECOND_NEW_FILE, side="new", doc_type="sop")
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text


@pytest.mark.usefixtures("hidden_ai_on")
def test_replan_keeps_unchanged_groups(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    # 계획 → New 문서 하나 더 → 계획
    bundle = make_match_bundle(client, p(OLD_1) + p(OLD_2), p(NEW_1))
    use_vectors(monkeypatch, fake_ai, {OLD_1: 0, NEW_1: 0, OLD_2: 1, NEW_2: 1})
    unit_id, lone = read_old_ids(client, bundle, OLD_1, OLD_2)
    plan(client, bundle.id)
    first = find_live(unit_id=unit_id)
    assert read_suggested_types(first) == {read_target(NEW_1).id: "rewritten"}
    first_delete = find_live(unit_id=lone)
    assert first_delete.content["shape"] == "delete_candidate"
    add_new_document(client, bundle.id, p(NEW_2))

    plan(client, bundle.id)

    assert find_live(unit_id=unit_id).id == first.id  # 그대로인 묶음은 다시 쓰지 않는다
    # 삭제 후보였던 단위가 짝을 얻어 다시 제안됐다
    assert next(row for row in read_rows(AiSuggestion) if row.id == first_delete.id).result == "stale"
    paired = find_live(unit_id=lone)
    assert (paired.content["shape"], paired.content["target_ids"]) == ("one_to_one", [read_target(NEW_2).id])
    assert_untouched(read_decision(lone))


def test_replan_rewrites_a_changed_group(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = make_match_bundle(client, p(OLD_3), p(NEW_3A))
    use_vectors(monkeypatch, fake_ai, {OLD_3: 0, NEW_3A: 0, NEW_3B: 0})
    plan(client, bundle.id)
    first = read_suggestion("one_to_one").id
    add_new_document(client, bundle.id, p(NEW_3B))
    queue_plan(bundle.id, {"origin": "prepare"})

    run_plan()

    assert next(row for row in read_rows(AiSuggestion) if row.id == first).result == "stale"
    split = read_suggestion("split")
    assert (split.result, split.content["target_ids"]) == ("applied", [read_target(NEW_3A).id, read_target(NEW_3B).id])
    # 새 문서 둘에 걸친 1:N은 중복 배정이라 새 문장마다 고침이다(설계 §6.9)
    assert read_suggested_types(split) == {read_target(NEW_3A).id: "rewritten", read_target(NEW_3B).id: "rewritten"}


def clear_by_hand(client: TestClient, bundle_id: int, unit_id: int) -> None:
    """받아 둔 묶음을 사람이 Clear로 지운다 — 제안의 채택은 버림, 판단은 미배정, 새 문장은 출처 없이 돌아간다."""
    revision = get_group_by_unit(client, bundle_id, unit_id)["units"][0]["decision"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/decisions/clear", json={"unit_id": unit_id, "revision": revision}, headers=AUTHOR,
    )
    assert response.status_code == 200, response.text


def make_cleared_group(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> tuple[int, int, int]:
    """Match가 제안한 문장 묶음을 사람이 받아(보류) 두었다가 지운 묶음 — (묶음 id, 단위 id, 버린 제안 id).

    제안은 받은 뒤에야 판단에 이어져 Clear가 버림을 남긴다.
    """
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))
    use_vectors(monkeypatch, fake_ai, {OLD_1: 0, NEW_1: 0})
    (unit_id,) = read_old_ids(client, bundle, OLD_1)
    plan(client, bundle.id)
    suggestion = find_live(unit_id=unit_id)
    suggestion_id = suggestion.id
    use_suggestion(client, bundle.id, suggestion, action="hold")
    clear_by_hand(client, bundle.id, unit_id)
    assert next(row for row in read_rows(AiSuggestion) if row.id == suggestion_id).adoption == "rejected"
    return bundle.id, unit_id, suggestion_id


@pytest.mark.parametrize("origin", ["upload", "prepare"])
def test_auto_plan_does_not_resuggest_a_cleared_group(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch, origin: str
) -> None:
    bundle_id, unit_id, _ = make_cleared_group(client, fake_ai, monkeypatch)
    suggestions_before = len(read_rows(AiSuggestion))
    queue_plan(bundle_id, {"origin": origin})

    run_plan()

    assert read_jobs()[-1].status == "done"
    assert_untouched(read_decision(unit_id))
    target = read_target(NEW_1)
    assert (target.status, target.suggestion_id) == ("unassigned", None)
    assert read_links() == set()
    assert len(read_rows(AiSuggestion)) == suggestions_before


def test_user_plan_resuggests_a_cleared_group(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle_id, unit_id, cleared = make_cleared_group(client, fake_ai, monkeypatch)

    plan(client, bundle_id)  # Match를 누르는 것이 다시 청하는 길이다

    target = read_target(NEW_1)
    again = find_live(unit_id=unit_id)
    assert again.id != cleared and find_live(target_id=target.id).id == again.id
    assert read_suggested_links(again) == {(target.id, unit_id)}
    assert_untouched(read_decision(unit_id))
    assert (target.status, target.suggestion_id) == ("unassigned", None)
    assert read_links() == set()


@pytest.mark.usefixtures("hidden_ai_on")
def test_upload_plan_keeps_existing_delete_candidates(client: TestClient, fake_ai: FakeAi) -> None:
    """업로드 계획은 새 삭제 후보를 쓰지 않을 뿐이다 — 지금 규칙으로도 삭제 후보인 살아 있는 제안은 걷지 않는다."""
    bundle = make_match_bundle(client, p(LONE_OLD) + p(OLD_2), p(LONE_NEW))
    units = read_old_ids(client, bundle, LONE_OLD, OLD_2)
    plan(client, bundle.id)
    before = {unit_id: find_live(unit_id=unit_id).id for unit_id in units}
    queue_plan(bundle.id, {"origin": "upload"})

    run_plan()

    for unit_id in units:
        suggestion = find_live(unit_id=unit_id)
        assert (suggestion.id, suggestion.content["shape"]) == (before[unit_id], "delete_candidate")
        assert_untouched(read_decision(unit_id))
    assert {row.result for row in read_rows(AiSuggestion)} == {"applied"}


@pytest.mark.usefixtures("hidden_ai_on")
def test_upload_plan_clears_delete_candidates_once_assign_documents_exist(client: TestClient, fake_ai: FakeAi) -> None:
    """지금 규칙이 삭제 후보를 쓰지 않으면(배정 New 문서가 생겼다) 업로드 계획도 걷어 분류 몫으로 돌린다."""
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    (unit_id,) = read_old_ids(client, bundle, LONE_OLD)
    plan(client, bundle.id)
    first = read_suggestion("delete_candidate").id
    response = put_tobe(client, bundle.id, [AI_SOP_DOC])
    assert response.status_code == 200, response.text
    queue_plan(bundle.id, {"origin": "upload"})

    run_plan()

    assert_untouched(read_decision(unit_id))
    assert next(row for row in read_rows(AiSuggestion) if row.id == first).result == "stale"


# --- 사람 확정 ---


@pytest.mark.usefixtures("hidden_ai_on")
def test_person_confirms_plan_suggestions_through_group_save(client: TestClient, fake_ai: FakeAi) -> None:
    """사람이 제안을 받으면(Use) 화면이 content의 묶음·출처·변경 종류로 저장을 채운다 — 그 저장이 판단·새 문장·연결을 쓴다."""
    changed = [CELLS[0], [REWRITTEN_CELL, CELLS[1][1]]]
    old_body = tbl(CELLS) + make_figure(CAPTION) + p(LONE_OLD)
    bundle = make_match_bundle(client, old_body, tbl(changed) + make_figure(CAPTION), media=MEDIA)
    view = get_view(client, bundle.id, bundle.old_document_id)
    table, figure = find_kind(view, "table")["id"], find_kind(view, "figure")["id"]
    (lone,) = read_old_ids(client, bundle, LONE_OLD)
    plan(client, bundle.id)
    texts = {row.id: row.confirmed_text for row in read_rows(TargetSentence)}
    used = [find_live(unit_id=table), find_live(unit_id=figure), find_live(unit_id=lone)]

    confirmed_table = use_suggestion(client, bundle.id, used[0])
    confirmed_figure = use_suggestion(client, bundle.id, used[1])
    deleted = use_suggestion(client, bundle.id, used[2], reason=REASON)

    for group in (confirmed_table, confirmed_figure, deleted):
        assert {unit["decision"]["status"] for unit in group["units"]} == {"confirmed"}
    assert {target["status"] for target in (*confirmed_table["targets"], *confirmed_figure["targets"])} == {"confirmed"}
    assert deleted["targets"] == []
    assert (read_decision(lone).disposition, read_decision(lone).reason) == ("delete", REASON)
    assert read_target(REWRITTEN_CELL).change_type == "rewritten"
    assert read_links() == read_suggested_links(used[0]) | read_suggested_links(used[1])
    assert [read_decision(unit_id).suggestion_id for unit_id in (table, figure, lone)] == [row.id for row in used]
    assert {row.adoption for row in read_rows(AiSuggestion) if row.id in {item.id for item in used}} == {"as_is"}
    assert {row.id: row.confirmed_text for row in read_rows(TargetSentence)} == texts  # 입구 2 글자는 그대로다


# --- 낡은 항목 ---


@pytest.mark.usefixtures("hidden_ai_on")
def test_person_change_during_plan_is_left_alone(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD) + p(OLD_2), p(LONE_NEW))
    changed, other = read_old_ids(client, bundle, LONE_OLD, OLD_2)
    use_vectors(monkeypatch, fake_ai, {LONE_OLD: 0, OLD_2: 1, LONE_NEW: 2})

    def delete_by_hand() -> None:
        body = {"action": "delete", "reason": REASON, "units": [{"unit_id": changed, "revision": 1}]}
        response = client.post(f"/api/bundles/{bundle.id}/decisions/bulk", json=body, headers=AUTHOR)
        assert response.status_code == 200, response.text

    change_once_during_embedding(fake_ai, delete_by_hand)

    plan(client, bundle.id)

    (job,) = read_jobs()
    assert job.status == "done"
    decision = read_decision(changed)
    assert (decision.status, decision.reason, decision.suggestion_id) == ("confirmed", REASON, None)
    assert all(changed not in row.content["unit_ids"] for row in read_rows(AiSuggestion))
    # 바뀌지 않은 행은 그대로 제안된다
    assert find_live(unit_id=other).content["shape"] == "delete_candidate"
    assert_untouched(read_decision(other))
    assert find_live(target_id=read_target(LONE_NEW).id).content["shape"] == "new"


def test_group_with_a_changed_member_is_skipped_whole(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """짝의 새 문장을 사람이 정했으면 옛 단위가 삭제 후보로 떨어지지 않고 그대로 남는다."""
    bundle = make_match_bundle(client, p(OLD_1) + p(OLD_2), p(NEW_1) + p(NEW_2))
    changed, other = read_old_ids(client, bundle, OLD_1, OLD_2)
    use_vectors(monkeypatch, fake_ai, {OLD_1: 0, NEW_1: 0, OLD_2: 1, NEW_2: 1})
    target = read_target(NEW_1)

    def confirm_as_new() -> None:
        body = {"new": [{"target_id": target.id, "revision": target.revision}]}
        response = client.post(f"/api/bundles/{bundle.id}/match/bulk-confirm", json=body, headers=AUTHOR)
        assert response.status_code == 200, response.text

    change_once_during_embedding(fake_ai, confirm_as_new)

    plan(client, bundle.id)

    assert_untouched(read_decision(changed))
    assert read_target(NEW_1).status == "confirmed"
    assert [row.content["unit_ids"] for row in read_rows(AiSuggestion)] == [[other]]  # 그대로인 짝만 제안이 쓰인다


def test_language_change_during_plan_skips_the_unit(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """언어 고치기는 판단 revision을 올리지 않는다 — 같은 언어 규칙은 적용 때 글·언어로 다시 본다."""
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))
    (unit,) = read_old_ids(client, bundle, OLD_1)
    use_vectors(monkeypatch, fake_ai, {OLD_1: 0, NEW_1: 0})

    def set_english() -> None:
        edit_document(
            client, bundle.id, bundle.old_document_id, {"type": "set_language", "unit_ids": [unit], "lang": "en"}
        )

    change_once_during_embedding(fake_ai, set_english)

    plan(client, bundle.id)

    assert read_groups() == {}
    assert_untouched(read_decision(unit))
    assert read_target(NEW_1).status == "unassigned"


def test_retired_unit_during_plan_is_left_alone(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD_1) + p(OLD_2), p(NEW_2))
    retired, kept = read_old_ids(client, bundle, OLD_1, OLD_2)
    use_vectors(monkeypatch, fake_ai, {OLD_1: 0, OLD_2: 1, NEW_2: 1})

    def split_the_unit() -> None:
        edit_document(client, bundle.id, bundle.old_document_id, {"type": "split", "unit_id": retired, "at": 5})

    change_once_during_embedding(fake_ai, split_the_unit)

    plan(client, bundle.id)

    # 은퇴한 단위에 삭제 후보를 쓰지 않는다 — 남은 짝의 문장 묶음 제안 하나뿐이다
    assert [row.content["unit_ids"] for row in read_rows(AiSuggestion)] == [[kept]]


# --- 파일 읽기가 끝난 직후 ---


def start_old_only_bundle(client: TestClient, old_body: str) -> int:
    """옛 문서만 올린 묶음 — 이미 쓴 새 문서가 없어 계획이 설 수 없다."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    assert set_members(client, bundle_id, AI_MEMBERS).status_code == 200
    uploaded = upload(client, bundle_id, build_docx(old_body), AI_OLD_NAME)
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text
    return bundle_id


def upload_written_new(client: TestClient, bundle_id: int, body: str, file_name: str = AI_NEW_NAME) -> None:
    uploaded = upload(client, bundle_id, build_docx(body, headers=[p(file_name)]), file_name, side="new", doc_type="sop")
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text


def read_event_actions(bundle_id: int) -> list[str]:
    return [row.action for row in read_rows(BundleEvent) if row.bundle_id == bundle_id]


def test_upload_queues_a_plan_when_old_and_written_new_are_ready(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle_id = start_old_only_bundle(client, p(OLD_1))
    assert read_jobs() == []

    upload_written_new(client, bundle_id, p(NEW_1))

    (job,) = read_jobs()
    assert (job.kind, job.priority, job.background, job.payload) == ("match_plan", AI_PRIORITY_PLAN, False, {"origin": "upload"})
    assert (job.status, job.requested_by) == ("queued", AUTHOR["X-Dev-User"])
    assert "ai.request" not in read_event_actions(bundle_id)


def test_upload_does_not_stack_plans_while_one_is_queued(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle_id = start_old_only_bundle(client, p(OLD_1) + p(OLD_2))
    upload_written_new(client, bundle_id, p(NEW_1))

    upload_written_new(client, bundle_id, p(NEW_2), SECOND_NEW_FILE)

    (job,) = read_jobs()
    assert job.status == "queued"


def test_upload_queues_one_more_while_a_plan_runs(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle_id = start_old_only_bundle(client, p(OLD_1) + p(OLD_2))
    upload_written_new(client, bundle_id, p(NEW_1))
    assert asyncio.run(claim_next_job()) is not None  # 계획이 돌고 있다

    upload_written_new(client, bundle_id, p(NEW_2), SECOND_NEW_FILE)

    assert sorted(job.status for job in read_jobs()) == ["queued", "running"]


@pytest.mark.parametrize("switch", ["ai_auto_prepare", "ai_enabled"])
def test_upload_queues_nothing_when_the_setting_or_ai_is_off(
    client: TestClient, auto_prepare: FakeAi, monkeypatch: pytest.MonkeyPatch, switch: str
) -> None:
    monkeypatch.setattr(settings, switch, False)
    bundle_id = start_old_only_bundle(client, p(OLD_1))

    upload_written_new(client, bundle_id, p(NEW_1))

    assert read_rows(AiJob) == []


def test_upload_queues_nothing_without_a_written_new_document(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle_id = start_old_only_bundle(client, p(OLD_1))

    second = upload(client, bundle_id, build_docx(p(OLD_2)), "SYNTHETIC_OLD-2.docx")

    assert second.status_code == 201
    assert read_rows(AiJob) == []


def test_uploading_files_in_a_row_ends_with_every_pair_suggested(
    client: TestClient, auto_prepare: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_vectors(monkeypatch, auto_prepare, {OLD_1: 0, NEW_1: 0, OLD_2: 1, NEW_2: 1})
    bundle_id = start_old_only_bundle(client, p(OLD_1) + p(OLD_2))
    upload_written_new(client, bundle_id, p(NEW_1))
    run_jobs()
    first_id = find_live(target_id=read_target(NEW_1).id).id

    upload_written_new(client, bundle_id, p(NEW_2), SECOND_NEW_FILE)
    run_jobs()

    assert find_live(target_id=read_target(NEW_1).id).id == first_id
    second = find_live(target_id=read_target(NEW_2).id)
    assert second.content["shape"] == "one_to_one"
    assert_only_suggestions_written()
