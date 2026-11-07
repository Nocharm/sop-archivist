"""입구 2 짝 계획 — 요청, 후보 고르기, 임베딩·글자 점수, 문장 그룹 작업, 표·그림·남은 항목의 제안, 다시 돌리기, 낡은 항목 (설계 §6.7, §7.7, §7.10, §8.4, §12)."""

import asyncio
import json
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any, TypeVar

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.settings import settings
from app.sop.ai import embeddings
from app.sop.ai.constants import AI_CALL_ATTEMPTS
from app.sop.ai.runner import claim_next_job, process_job
from app.sop.models import AiJob, AiSuggestion, Bundle, TargetSentence, TargetSource, UnitDecision
from tests.access_helpers import run_in_session
from tests.ai_fixtures import (
    MatchBundle,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    clean_embedding_cache,  # noqa: F401
    edit_document,
    find_kind,
    make_ai_bundle,
    make_match_bundle,
    read_decision,
    read_rows,
    run_jobs,
    use_reply,
)
from tests.ai_helpers import enable_embed
from tests.docx_factory import TINY_PNG, make_drawing_run, p, tbl
from tests.fake_ai import FakeAi
from tests.sop_helpers import (
    AUTHOR,
    REVIEWER,
    assign_as_is,
    find_unit,
    get_group_by_unit,
    get_view,
    save_group,
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
CONTENT_KEYS = {"unit_ids", "target_ids", "shape", "change_type", "reason", "rule_ids", "retrieval"}


def make_figure(caption: str) -> str:
    return f"<w:p>{make_drawing_run('image1.png')}</w:p>" + (p(caption, "Caption") if caption else "")


def request_match(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR) -> httpx2.Response:
    return client.post(f"/api/bundles/{bundle_id}/ai/match", json={}, headers=headers)


def run_plan() -> None:
    """맨 앞 작업 하나만 돌린다 — 계획이 쌓은 변경 종류 작업은 큐에 남겨 그대로 본다."""

    async def _run() -> None:
        job_id = await claim_next_job()
        assert job_id is not None
        await process_job(job_id)

    asyncio.run(_run())


def plan(client: TestClient, bundle_id: int) -> None:
    response = request_match(client, bundle_id)
    assert response.status_code == 200, response.text
    assert response.json()["queued"] == 1, response.text
    run_plan()


def axis(index: int) -> list[float]:
    return [1.0 if position == index else 0.0 for position in range(8)]


def use_vectors(monkeypatch: pytest.MonkeyPatch, ai: FakeAi, axes: dict[str, int]) -> None:
    """글마다 축 하나를 준다 — 같은 축의 글끼리만 점수가 1이고 나머지는 0이다."""
    enable_embed(monkeypatch)
    ai.embed = lambda text: axis(axes[text])


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


def read_old_ids(client: TestClient, bundle: MatchBundle, *texts: str) -> list[int]:
    view = get_view(client, bundle.id, bundle.old_document_id)
    return [find_unit(view, text)["id"] for text in texts]


def read_target(text: str) -> TargetSentence:
    (target,) = [row for row in read_rows(TargetSentence) if row.confirmed_text == text]
    return target


def read_kind(kind: str) -> list[TargetSentence]:
    return [row for row in read_rows(TargetSentence) if row.kind == kind and row.parent_target_id is None]


def read_jobs(kind: str = "match") -> list[AiJob]:
    return [row for row in read_rows(AiJob) if row.kind == kind]


def read_links() -> set[tuple[int, int]]:
    return {(row.target_id, row.unit_id) for row in read_rows(TargetSource)}


def read_suggestion(shape: str) -> AiSuggestion:
    (suggestion,) = [row for row in read_rows(AiSuggestion) if row.content["shape"] == shape]
    return suggestion


def assert_untouched(decision: UnitDecision) -> None:
    assert (decision.status, decision.disposition, decision.suggestion_id) == ("unassigned", "unassigned", None)


# --- 요청 ---


def test_match_request_needs_a_match_document(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)

    response = request_match(client, bundle.id)

    assert (response.status_code, response.json()["detail"]["code"]) == (409, "no_match_documents")
    assert read_rows(AiJob) == []


def test_match_request_queues_one_plan_job_for_the_bundle(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))

    response = request_match(client, bundle.id)

    assert response.json() == {"queued": 1, "skipped_total": 0, "skipped": []}
    (job,) = read_rows(AiJob)
    assert (job.kind, job.status, job.unit_ids, job.target_ids) == ("match_plan", "queued", [], [])
    assert job.requested_by == AUTHOR["X-Dev-User"]


def test_active_plan_job_reports_already_queued(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))
    assert request_match(client, bundle.id).json()["queued"] == 1

    body = request_match(client, bundle.id).json()

    assert body == {"queued": 0, "skipped_total": 1, "skipped": [{"unit_id": 0, "reason": "already_queued"}]}
    assert len(read_jobs("match_plan")) == 1


def test_active_llm_job_also_blocks_a_new_plan(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))
    plan(client, bundle.id)
    assert [job.status for job in read_jobs()] == ["queued"]

    body = request_match(client, bundle.id).json()

    assert body["queued"] == 0 and body["skipped"][0]["reason"] == "already_queued"


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


# --- 후보 ---


def test_identical_candidates_are_left_to_bulk_confirm(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(SAME) + p(OLD_1), p(SAME) + p(NEW_1))
    same, old = read_old_ids(client, bundle, SAME, OLD_1)

    plan(client, bundle.id)

    (job,) = read_jobs()
    assert job.unit_ids == [old] and job.target_ids == [read_target(NEW_1).id]
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

    (job,) = read_jobs()
    assert job.unit_ids == [free] and job.target_ids == [read_target(NEW_2).id]
    after = read_decision(assigned)
    assert (after.status, after.disposition, after.revision) == ("confirmed", "assigned", before.revision)
    assert read_target(NEW_1).change_type == "new"  # 짝이 입구 1로 갔으니 새 문장은 짝이 없다


def test_units_with_a_classify_suggestion_are_excluded(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1) + p(OLD_2), p(NEW_1) + p(NEW_2), has_assign=True)
    suggested, free = read_old_ids(client, bundle, OLD_1, OLD_2)
    use_reply(fake_ai, rewrites={"ko": ["합성 고쳐 쓴 문장이다."]})
    response = client.post(f"/api/bundles/{bundle.id}/ai/classify", json={"unit_ids": [suggested]}, headers=AUTHOR)
    assert response.status_code == 200, response.text
    run_jobs()
    classified = read_decision(suggested)
    assert classified.status == "ai_suggested"

    plan(client, bundle.id)

    (job,) = read_jobs()
    assert job.unit_ids == [free]
    after = read_decision(suggested)
    assert (after.suggestion_id, after.revision) == (classified.suggestion_id, classified.revision)


def test_only_top_level_rows_become_candidates(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, tbl(CELLS), tbl(CELLS))
    view = get_view(client, bundle.id, bundle.old_document_id)
    cells = [unit["id"] for unit in view["units"] if unit["group_unit_id"] is not None]

    plan(client, bundle.id)

    assert read_jobs() == []  # 칸 문장은 표와 함께 가고 따로 짝이 되지 않는다
    assert read_suggestion("table").content["unit_ids"] == [find_kind(view, "table")["id"]]
    assert all(read_decision(cell).status == "unassigned" for cell in cells)  # 칸의 상태는 표 단위가 담는다


# --- 문장 그룹 ---


def test_plan_queues_one_llm_job_per_sentence_group(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    old_body = p(OLD_1) + p(OLD_3) + p(OLD_4) + p(OLD_5)
    bundle = make_match_bundle(client, old_body, p(NEW_1) + p(NEW_3A) + p(NEW_3B) + p(NEW_45))
    use_vectors(monkeypatch, fake_ai, {
        OLD_1: 0, NEW_1: 0, OLD_3: 1, NEW_3A: 1, NEW_3B: 1, OLD_4: 2, OLD_5: 2, NEW_45: 2,
    })
    one, split, merge_a, merge_b = read_old_ids(client, bundle, OLD_1, OLD_3, OLD_4, OLD_5)

    plan(client, bundle.id)

    jobs = {tuple(job.unit_ids): job for job in read_jobs()}
    assert {key: job.target_ids for key, job in jobs.items()} == {
        (one,): [read_target(NEW_1).id],
        (split,): [read_target(NEW_3A).id, read_target(NEW_3B).id],
        (merge_a, merge_b): [read_target(NEW_45).id],
    }
    assert {job.status for job in jobs.values()} == {"queued"}
    assert {job.document_id for job in jobs.values()} == {bundle.old_document_id}
    assert {job.requested_by for job in jobs.values()} == {AUTHOR["X-Dev-User"]}
    assert all(job.payload == {"retrieval": "embedding"} for job in jobs.values())
    # 문장 그룹은 변경 종류 작업이 끝나야 제안이 된다
    assert_untouched(read_decision(one))
    assert read_target(NEW_1).status == "unassigned"
    assert read_rows(AiSuggestion) == []


def test_repeated_text_pairs_one_to_one_and_leaves_no_delete_candidate(client: TestClient, fake_ai: FakeAi) -> None:
    """같은 문장이 두 곳에 있으면 거짓 나눔과 거짓 삭제 후보가 나오던 자리다. 이 짝은 한 번에 확정 후보가 아니라 변경 종류 작업으로 간다."""
    bundle = make_match_bundle(client, p(SAME) + p(OLD_1) + p(SAME), p(SAME) + p(NEW_1) + p(SAME))
    view = get_view(client, bundle.id, bundle.old_document_id)
    first, second = find_unit(view, SAME, 1)["id"], find_unit(view, SAME, 2)["id"]
    old_once = find_unit(view, OLD_1)["id"]

    plan(client, bundle.id)

    same_targets = [row.id for row in read_rows(TargetSentence) if row.confirmed_text == SAME]
    assert {tuple(job.unit_ids): job.target_ids for job in read_jobs()} == {
        (first,): [same_targets[0]], (old_once,): [read_target(NEW_1).id], (second,): [same_targets[1]],
    }
    assert read_rows(AiSuggestion) == []
    assert client.get(f"/api/bundles/{bundle.id}/match/identical-candidates", headers=AUTHOR).json() == []


def test_same_vector_across_languages_never_pairs(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(LONE_EN))
    use_vectors(monkeypatch, fake_ai, {OLD_1: 0, LONE_EN: 0})

    plan(client, bundle.id)

    assert read_jobs() == []
    assert read_suggestion("delete_candidate").content["unit_ids"] == read_old_ids(client, bundle, OLD_1)
    assert read_target(LONE_EN).change_type == "new"


# --- 남은 항목 ---


@pytest.mark.parametrize("has_assign", [False, True])
def test_unmatched_old_is_delete_candidate_only_without_assign_docs(
    client: TestClient, fake_ai: FakeAi, has_assign: bool
) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW), has_assign=has_assign)
    (unit,) = read_old_ids(client, bundle, LONE_OLD)

    plan(client, bundle.id)

    decision = read_decision(unit)
    if has_assign:  # 입구 1로 갈 문장이 삭제 후보로 쏟아지지 않게 미배정으로 남는다
        assert_untouched(decision)
        assert decision.revision == 1
        return
    suggestion = read_suggestion("delete_candidate")
    assert (decision.status, decision.disposition, decision.reason) == ("ai_suggested", "delete", "")
    assert decision.suggestion_id == suggestion.id
    assert decision.revision == 2
    assert suggestion.content == {
        "unit_ids": [unit], "target_ids": [], "shape": "delete_candidate", "change_type": "deleted", "reason": "",
        "rule_ids": [], "retrieval": "no_index",
    }
    assert (suggestion.kind, suggestion.result, suggestion.document_id) == ("match", "applied", bundle.old_document_id)


def test_unmatched_new_is_suggested_as_new(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))

    plan(client, bundle.id)

    target = read_target(LONE_NEW)
    suggestion = read_suggestion("new")
    assert (target.status, target.change_type, target.suggestion_id) == ("ai_suggested", "new", suggestion.id)
    assert (target.confirmed_text, target.ai_text) == (LONE_NEW, "")  # 글자는 새 문서 원문 그대로다
    assert target.revision == 2
    assert suggestion.content == {
        "unit_ids": [], "target_ids": [target.id], "shape": "new", "change_type": "new", "reason": "", "rule_ids": [],
        "retrieval": "no_index",
    }
    assert (suggestion.kind, suggestion.document_id) == ("match", bundle.new_document_id)


def test_unmatched_new_table_takes_its_cells_along(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), tbl(CELLS))

    plan(client, bundle.id)

    suggestion = read_suggestion("new")
    (table,) = read_kind("table")
    cells = [row for row in read_rows(TargetSentence) if row.parent_target_id == table.id]
    assert suggestion.content["target_ids"] == [table.id, *(cell.id for cell in cells)]
    assert {(cell.status, cell.change_type, cell.suggestion_id) for cell in cells} == {
        ("ai_suggested", "new", suggestion.id)
    }


def test_new_suggestions_can_be_confirmed_in_bulk(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW) + tbl(CELLS))
    plan(client, bundle.id)
    rows = [row for row in read_rows(TargetSentence) if row.origin == "new_doc"]
    assert {row.status for row in rows} == {"ai_suggested"}

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
    assert read_links() == {
        (table.id, table_unit),
        (cells[CELLS[0][0]].id, cell_of[CELLS[0][0]]),
        (cells[CELLS[0][1]].id, cell_of[CELLS[0][1]]),
        (cells[REWRITTEN_CELL].id, cell_of[CELLS[1][0]]),
        (cells[CELLS[1][1]].id, cell_of[CELLS[1][1]]),
    }
    assert (table.status, table.change_type, table.suggestion_id) == ("ai_suggested", "as_is", suggestion.id)
    assert {text: (row.status, row.change_type) for text, row in cells.items()} == {
        CELLS[0][0]: ("ai_suggested", "as_is"),
        CELLS[0][1]: ("ai_suggested", "as_is"),
        REWRITTEN_CELL: ("ai_suggested", "rewritten"),
        CELLS[1][1]: ("ai_suggested", "as_is"),
    }
    assert (suggestion.content["shape"], suggestion.content["change_type"]) == ("table", "as_is")
    assert suggestion.content["unit_ids"] == [table_unit]
    assert set(suggestion.content["target_ids"]) == {table.id, *(row.id for row in cells.values())}
    decision = read_decision(table_unit)
    assert (decision.status, decision.disposition, decision.suggestion_id) == ("ai_suggested", "assigned", suggestion.id)
    assert fake_ai.requests == [] and read_jobs() == []


def test_cell_warning_compares_the_old_and_new_cell(client: TestClient, fake_ai: FakeAi) -> None:
    old = [["합성 온도 기준", "합성 값 10 ℃ 이하"], ["합성 압력", "합성 결과"]]
    new = [["합성 온도 기준", "합성 값 20 ℃ 이하"], ["합성 압력", "합성 결과"]]
    bundle = make_match_bundle(client, tbl(old), tbl(new))

    plan(client, bundle.id)

    mismatch = [{"kind": "number_mismatch", "source": "10", "target": "20"}]
    assert read_target(new[0][1]).warnings == mismatch
    assert read_target(new[0][0]).warnings == []
    assert read_suggestion("table").warnings == mismatch  # 제안을 읽는 쪽도 같은 경고를 본다
    body = client.get(f"/api/bundles/{bundle.id}/ai/suggestions", params={"kind": "match"}, headers=AUTHOR).json()
    assert body["items"][0]["warnings"] == mismatch


def test_different_shape_table_suggests_restructured(client: TestClient, fake_ai: FakeAi) -> None:
    wider = [[*row, "합성 비고"] for row in CELLS]
    bundle = make_match_bundle(client, tbl(CELLS), tbl(wider))
    table_unit = find_kind(get_view(client, bundle.id, bundle.old_document_id), "table")["id"]

    plan(client, bundle.id)

    suggestion = read_suggestion("table")
    (table,) = read_kind("table")
    assert read_links() == {(table.id, table_unit)}  # 칸 연결은 없다
    assert (table.status, table.change_type) == ("ai_suggested", "table_restructured")
    assert suggestion.content["change_type"] == "table_restructured"
    cells = [row for row in read_rows(TargetSentence) if row.parent_target_id == table.id]
    assert {(row.status, row.change_type, row.suggestion_id) for row in cells} == {("ai_suggested", "new", suggestion.id)}


def test_same_grid_with_an_old_cell_left_over_is_not_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    """옛 칸 문장이 남으면 그대로로 확정할 수 없다(table_cells_missing) — 격자가 같아도 표 구성 변경이다."""
    two_sentences = [CELLS[0], [f"{CELLS[1][0]}. {EXTRA_CELL}", CELLS[1][1]]]
    bundle = make_match_bundle(client, tbl(two_sentences), tbl(CELLS))
    view = get_view(client, bundle.id, bundle.old_document_id)
    left_over = find_unit(view, EXTRA_CELL)["id"]

    plan(client, bundle.id)

    (table,) = read_kind("table")
    assert table.change_type == "table_restructured"
    assert left_over not in {unit_id for _, unit_id in read_links()}
    assert read_target(CELLS[0][0]).change_type == "as_is"


def test_same_grid_with_a_new_cell_sentence_stays_as_is(client: TestClient, fake_ai: FakeAi) -> None:
    """옛 칸이 모두 이어지면 그대로로 확정할 수 있다 — 새 문서가 덧붙인 칸 문장만 신규다."""
    two_sentences = [CELLS[0], [f"{CELLS[1][0]}. {EXTRA_CELL}", CELLS[1][1]]]
    bundle = make_match_bundle(client, tbl(CELLS), tbl(two_sentences))

    plan(client, bundle.id)

    (table,) = read_kind("table")
    assert table.change_type == "as_is"
    extra = read_target(EXTRA_CELL)
    assert (extra.status, extra.change_type) == ("ai_suggested", "new")
    assert extra.id not in {target_id for target_id, _ in read_links()}


def test_table_rows_pair_with_a_table_of_one_row(client: TestClient, fake_ai: FakeAi) -> None:
    old_row = [CELLS[1]]
    bundle = make_match_bundle(client, tbl(CELLS), tbl([["무관한 머리 칸", "다른 머리 칸"], *old_row]))
    view = get_view(client, bundle.id, bundle.old_document_id)
    edit_document(client, bundle.id, bundle.old_document_id, {"type": "split_table_rows", "table_unit_id": find_kind(view, "table")["id"]})
    new_view = get_view(client, bundle.id, bundle.new_document_id)
    edit_document(client, bundle.id, bundle.new_document_id, {"type": "split_table_rows", "table_unit_id": find_kind(new_view, "table")["id"]})

    plan(client, bundle.id)

    rows = [unit for unit in get_view(client, bundle.id, bundle.old_document_id)["units"] if unit["kind"] == "table_row"]
    second = next(unit for unit in rows if unit["row_index"] == 1)
    target = next(row for row in read_kind("table") if row.status == "ai_suggested" and row.change_type == "as_is")
    assert (target.id, second["id"]) in read_links()
    cells = [row for row in read_rows(TargetSentence) if row.parent_target_id == target.id]
    assert {(row.cell_row, row.cell_col, row.change_type) for row in cells} == {(0, 0, "as_is"), (0, 1, "as_is")}


def test_figures_pair_as_is_without_llm(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, make_figure(CAPTION), make_figure(CAPTION), media=MEDIA)
    unit = find_kind(get_view(client, bundle.id, bundle.old_document_id), "figure")["id"]

    plan(client, bundle.id)

    suggestion = read_suggestion("figure")
    (figure,) = read_kind("figure")
    assert read_links() == {(figure.id, unit)}
    assert (figure.status, figure.change_type, figure.suggestion_id) == ("ai_suggested", "as_is", suggestion.id)
    assert figure.confirmed_text == ""
    decision = read_decision(unit)
    assert (decision.status, decision.disposition) == ("ai_suggested", "assigned")
    assert suggestion.content == {
        "unit_ids": [unit], "target_ids": [figure.id], "shape": "figure", "change_type": "as_is", "reason": "",
        "rule_ids": [], "retrieval": "no_index",
    }
    assert fake_ai.requests == [] and read_jobs() == []


def test_figures_with_other_captions_do_not_pair(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, make_figure(CAPTION), make_figure(OTHER_CAPTION), media=MEDIA)

    plan(client, bundle.id)

    assert read_links() == set()
    assert read_suggestion("new").content["target_ids"] == [read_kind("figure")[0].id]


# --- 점수 ---


def test_text_similarity_is_used_without_embeddings(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))

    plan(client, bundle.id)

    (job,) = read_jobs()
    assert job.payload == {"retrieval": "no_index"}


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

    (job,) = read_jobs()
    assert job.payload == {"retrieval": "embedding_failed"}  # 꺼짐(no_index)과 다른 상태다


def test_embedding_threshold_differs_from_the_text_threshold(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """글자 임계값(0.5)이면 짝이 될 점수지만 임베딩 임계값(0.75) 아래다."""
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))
    enable_embed(monkeypatch)
    fake_ai.embed = lambda text: [1.0, 0.0] if text == OLD_1 else [0.6, 0.8]  # 코사인 0.6

    plan(client, bundle.id)

    assert read_jobs() == []
    assert read_suggestion("delete_candidate").content["retrieval"] == "embedding"


def test_blank_texts_are_not_embedded(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    """캡션 없는 그림은 글이 없다 — 빈 글을 보내면 서버가 거절해 묶음 전체가 임베딩을 잃을 수 있다."""
    bundle = make_match_bundle(client, make_figure("") + p(OLD_1), make_figure("") + p(NEW_1), media=MEDIA)
    use_vectors(monkeypatch, fake_ai, {OLD_1: 0, NEW_1: 0})

    plan(client, bundle.id)

    (job,) = read_jobs()
    assert job.payload == {"retrieval": "embedding"}
    assert read_links() == set()


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


def test_table_without_text_stays_unassigned(client: TestClient, fake_ai: FakeAi) -> None:
    empty_cells = [["", ""], ["", ""]]
    bundle = make_match_bundle(client, p(LONE_OLD) + tbl(empty_cells), p(LONE_NEW) + tbl(empty_cells))
    table_unit = find_kind(get_view(client, bundle.id, bundle.old_document_id), "table")["id"]

    plan(client, bundle.id)

    assert_untouched(read_decision(table_unit))
    assert [row.status for row in read_kind("table")] == ["unassigned"]
    assert {row.content["shape"] for row in read_rows(AiSuggestion)} == {"delete_candidate", "new"}


def test_scores_are_not_stored(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = make_match_bundle(
        client, p(OLD_1) + p(LONE_OLD) + tbl(CELLS), p(NEW_1) + p(LONE_NEW) + tbl(CELLS),
    )
    use_vectors(monkeypatch, fake_ai, {
        OLD_1: 0, NEW_1: 0, LONE_OLD: 1, LONE_NEW: 2, " ".join(cell for row in CELLS for cell in row): 3,
    })

    plan(client, bundle.id)

    suggestions = read_rows(AiSuggestion)
    assert {row.content["shape"] for row in suggestions} == {"delete_candidate", "new", "table"}
    assert all(set(row.content) == CONTENT_KEYS for row in suggestions)
    (plan_job,) = read_jobs("match_plan")
    assert set(plan_job.input_snapshot) == {"unit_revisions", "target_revisions"}
    assert read_jobs()[0].payload == {"retrieval": "embedding"}


def test_suggestions_are_read_as_kind_match(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    plan(client, bundle.id)

    body = client.get(f"/api/bundles/{bundle.id}/ai/suggestions", params={"kind": "match"}, headers=AUTHOR).json()

    assert {item["content"]["shape"] for item in body["items"]} == {"delete_candidate", "new"}
    assert "score" not in json.dumps(body)


# --- 다시 돌리기 ---


def test_rerun_replaces_previous_match_suggestions(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, p(LONE_OLD), p(LONE_NEW))
    (unit,) = read_old_ids(client, bundle, LONE_OLD)
    plan(client, bundle.id)
    first_delete, first_new = read_suggestion("delete_candidate").id, read_suggestion("new").id

    plan(client, bundle.id)

    rows = {row.id: row for row in read_rows(AiSuggestion)}
    assert (rows[first_delete].result, rows[first_new].result) == ("stale", "stale")
    applied = {row.content["shape"]: row_id for row_id, row in rows.items() if row.result == "applied"}
    assert set(applied) == {"delete_candidate", "new"}
    delete_now, new_now = applied["delete_candidate"], applied["new"]
    decision = read_decision(unit)
    assert (decision.status, decision.disposition, decision.suggestion_id) == ("ai_suggested", "delete", delete_now)
    target = read_target(LONE_NEW)
    assert (target.status, target.change_type, target.suggestion_id) == ("ai_suggested", "new", new_now)


def test_rerun_that_finds_a_pair_clears_the_old_suggestions(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """앞 계획의 삭제 후보·신규가 뒤 계획에서 짝이 되면 변경 종류 작업을 기다리며 미배정으로 돌아간다."""
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))
    use_vectors(monkeypatch, fake_ai, {OLD_1: 0, NEW_1: 1})
    plan(client, bundle.id)
    (unit,) = read_old_ids(client, bundle, OLD_1)
    suggested = read_decision(unit)
    assert suggested.status == "ai_suggested"

    monkeypatch.setattr(settings, "embed_enabled", False)  # 글자 유사도로는 짝이 된다
    plan(client, bundle.id)

    (job,) = read_jobs()
    assert job.unit_ids == [unit]
    decision = read_decision(unit)
    assert_untouched(decision)
    assert decision.revision > suggested.revision  # 낡은 화면이 덮어쓰지 않게
    target = read_target(NEW_1)
    assert (target.status, target.change_type, target.suggestion_id) == ("unassigned", None, None)


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
    assert {row.result for row in read_rows(AiSuggestion)} == {"stale", "applied"}


def test_rerun_unlinks_a_table_and_sweeps_its_ai_translation(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_match_bundle(client, tbl(CELLS), tbl(CELLS))
    view = get_view(client, bundle.id, bundle.old_document_id)
    cell = find_unit(view, CELLS[0][0])["id"]
    plan(client, bundle.id)
    fake_ai.chat = lambda data: json.dumps({"text": "Synthetic item"})
    translate = client.post(
        f"/api/bundles/{bundle.id}/ai/translate", json={"direction": "ko_to_en", "unit_ids": [cell]}, headers=AUTHOR,
    )
    assert translate.json()["queued"] == 1, translate.text
    run_jobs()
    (translation,) = [row for row in read_rows(TargetSentence) if row.origin == "translation"]

    plan(client, bundle.id)

    assert all(row.origin == "new_doc" for row in read_rows(TargetSentence))  # 출처가 바뀐 AI 번역은 지운다
    suggestion = next(row for row in read_rows(AiSuggestion) if row.id == translation.suggestion_id)
    assert (suggestion.kind, suggestion.result) == ("translate", "stale")
    (table,) = read_kind("table")
    assert table.status == "ai_suggested"
    assert (read_target(CELLS[0][0]).id, cell) in read_links()


def test_new_target_with_a_previous_suggestion_is_reset_not_deleted(client: TestClient, fake_ai: FakeAi) -> None:
    """판단 행이 없는 신규 제안도 걷히고, 새 문서의 글은 남는다."""
    bundle = make_match_bundle(client, p(SAME), p(SAME) + p(LONE_NEW))
    plan(client, bundle.id)
    target = read_target(LONE_NEW)
    first = target.suggestion_id

    plan(client, bundle.id)

    again = read_target(LONE_NEW)
    assert again.id == target.id and again.suggestion_id != first
    assert next(row for row in read_rows(AiSuggestion) if row.id == first).result == "stale"


# --- 사람 확정 ---


def confirm_group(client: TestClient, bundle_id: int, unit_id: int, **unit_fields: object) -> dict:
    """제안 그대로 관계 묶음을 저장한다 — 화면이 묶음을 읽어 되보내는 모습이다."""
    group = get_group_by_unit(client, bundle_id, unit_id)
    body = {
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
    response = save_group(client, bundle_id, body)
    assert response.status_code == 200, response.text
    return response.json()


def test_person_confirms_plan_suggestions_through_group_save(client: TestClient, fake_ai: FakeAi) -> None:
    changed = [CELLS[0], [REWRITTEN_CELL, CELLS[1][1]]]
    old_body = tbl(CELLS) + make_figure(CAPTION) + p(LONE_OLD)
    bundle = make_match_bundle(client, old_body, tbl(changed) + make_figure(CAPTION), media=MEDIA)
    view = get_view(client, bundle.id, bundle.old_document_id)
    table, figure = find_kind(view, "table")["id"], find_kind(view, "figure")["id"]
    (lone,) = read_old_ids(client, bundle, LONE_OLD)
    plan(client, bundle.id)
    texts = {row.id: row.confirmed_text for row in read_rows(TargetSentence)}

    confirmed_table = confirm_group(client, bundle.id, table, disposition="assigned")
    confirmed_figure = confirm_group(client, bundle.id, figure, disposition="assigned")
    deleted = confirm_group(client, bundle.id, lone, disposition="delete", reason=REASON)

    for group in (confirmed_table, confirmed_figure, deleted):
        assert {unit["decision"]["status"] for unit in group["units"]} == {"confirmed"}
    assert {target["status"] for target in (*confirmed_table["targets"], *confirmed_figure["targets"])} == {"confirmed"}
    assert deleted["targets"] == []
    assert (read_decision(lone).disposition, read_decision(lone).reason) == ("delete", REASON)
    assert read_target(REWRITTEN_CELL).change_type == "rewritten"
    assert {row.id: row.confirmed_text for row in read_rows(TargetSentence)} == texts  # 입구 2 글자는 그대로다


# --- 낡은 항목 ---


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

    (job,) = read_jobs("match_plan")
    assert job.status == "done"
    decision = read_decision(changed)
    assert (decision.status, decision.reason, decision.suggestion_id) == ("confirmed", REASON, None)
    remaining = read_decision(other)  # 바뀌지 않은 행은 그대로 처리된다
    assert (remaining.status, remaining.disposition) == ("ai_suggested", "delete")
    assert read_target(LONE_NEW).change_type == "new"


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

    (job,) = read_jobs()
    assert job.unit_ids == [other]
    assert_untouched(read_decision(changed))
    assert read_target(NEW_1).status == "confirmed"
    assert read_rows(AiSuggestion) == []


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

    assert read_jobs() == []
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

    (job,) = read_jobs()
    assert job.unit_ids == [kept]
    assert read_rows(AiSuggestion) == []  # 은퇴한 단위에 삭제 후보를 쓰지 않는다
