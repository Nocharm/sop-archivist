"""배정 화면 첫 진입 prepare — 남은 줄을 미리 분류하는 작업을 쌓고, 한 번도 없던 묶음에는 계획을 먼저 쌓는다 (설계 §5.2)."""

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.settings import settings
from app.sop.constants import AI_PRIORITY_PLAN, AI_PRIORITY_PRE_CLASSIFY
from app.sop.models import AiJob, AiSuggestion, Bundle, BundleEvent
from tests.access_helpers import run_in_session
from tests.ai_fixtures import (
    AI_EN_1,
    AI_EN_2,
    AI_KO_1,
    AI_KO_2,
    AI_SOP_DOC,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    find_ids,
    make_ai_bundle,
    make_match_bundle,
    queue_units,
    read_decision,
    read_rows,
    read_target,
    request_match,
    run_jobs,
    run_plan,
    upload_second_document,
    use_reply,
)
from tests.docx_factory import p
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, REVIEWER, get_view, put_tobe

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs", "hidden_ai_on")

SAME = "합성 압력 게이지의 눈금을 매일 아침 확인한다."
OLD_1 = "합성 장비의 전원을 켠 뒤 상태 표시등을 확인한다."
NEW_1 = "합성 장비의 전원을 켠 뒤 상태 표시등을 반드시 확인한다."
LONE = "합성 폐기물을 분류 용기에 나누어 담는다."
SECOND_KO = "합성 배관의 누수를 주 1회 점검한다."
SECOND_EN = "Inspect the synthetic piping for leaks weekly."


def post_prepare(
    client: TestClient, bundle_id: int, *, headers: dict[str, str] = AUTHOR, **body: object
) -> httpx2.Response:
    return client.post(f"/api/bundles/{bundle_id}/ai/prepare", json=body, headers=headers)


def read_jobs(kind: str) -> list[AiJob]:
    return sorted((row for row in read_rows(AiJob) if row.kind == kind), key=lambda job: job.id)


def test_prepare_queues_background_classify_per_old_document(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    second = upload_second_document(client, bundle.id, p(SECOND_KO) + p(SECOND_EN))["document"]["id"]

    out = post_prepare(client, bundle.id, document_id=second).json()

    jobs = read_jobs("classify")
    assert len(jobs) == 4 and out["queued"] == len(jobs) and out["skipped_total"] == 0
    assert {job.document_id for job in jobs} == {bundle.document_id, second}
    assert {(job.priority, job.background) for job in jobs} == {(AI_PRIORITY_PRE_CLASSIFY, True)}
    assert len({job.request_id for job in jobs}) == 1 and out["request_id"] == jobs[0].request_id
    assert {job.requested_by for job in jobs} == {AUTHOR["X-Dev-User"]}


def test_prepare_puts_the_open_document_first(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    second = upload_second_document(client, bundle.id, p(SECOND_KO) + p(SECOND_EN))["document"]["id"]

    post_prepare(client, bundle.id, document_id=second)

    jobs = read_jobs("classify")
    assert [job.document_id for job in jobs] == [second, second, bundle.document_id, bundle.document_id]


def test_prepare_twice_queues_nothing_more(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    first = post_prepare(client, bundle.id).json()

    again = post_prepare(client, bundle.id).json()

    assert first["queued"] == 2 and (again["queued"], again["request_id"]) == (0, None)
    assert len(read_jobs("classify")) == 2


def test_prepare_skips_documents_whose_background_jobs_were_cancelled(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    post_prepare(client, bundle.id)
    assert client.post(f"/api/bundles/{bundle.id}/ai/cancel", json={}, headers=AUTHOR).status_code == 200
    assert {job.status for job in read_jobs("classify")} == {"cancelled"}

    again = post_prepare(client, bundle.id).json()

    assert again["queued"] == 0 and len(read_jobs("classify")) == 2  # 취소한 문서는 다시 시작되지 않는다


def test_prepare_picks_up_an_old_document_uploaded_later(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle = make_ai_bundle(client)
    post_prepare(client, bundle.id)
    second = upload_second_document(client, bundle.id, p(SECOND_KO) + p(SECOND_EN))["document"]["id"]

    out = post_prepare(client, bundle.id).json()

    assert out["queued"] == 2
    assert [job.document_id for job in read_jobs("classify")][2:] == [second, second]


def test_prepare_leaves_identical_text_candidates_out(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle = make_match_bundle(client, p(SAME) + p(OLD_1), p(SAME) + p(NEW_1), has_assign=True)
    old_1, same = (
        unit["id"] for text in (OLD_1, SAME) for unit in _find_old_units(client, bundle.id, bundle.old_document_id, text)
    )

    out = post_prepare(client, bundle.id).json()

    (job,) = read_jobs("classify")
    assert out["queued"] == 1 and job.unit_ids == [old_1] and same not in job.unit_ids


def test_person_bulk_confirms_identical_text_after_the_automatic_work(client: TestClient, auto_prepare: FakeAi) -> None:
    # 설계 §2 목표 5 — 업로드 계획·첫 진입 분류가 다 돈 뒤에도 같은 글 일괄 확정이 그 줄을 받는다
    bundle = make_match_bundle(client, p(SAME) + p(OLD_1) + p(LONE), p(SAME) + p(NEW_1), has_assign=True)
    (same,) = (unit["id"] for unit in _find_old_units(client, bundle.id, bundle.old_document_id, SAME))
    use_reply(auto_prepare)
    assert post_prepare(client, bundle.id).json()["queued"] >= 1
    run_jobs()
    assert read_jobs("match_plan") and {job.status for job in read_jobs("classify")} <= {"done", "stale"}
    candidates = client.get(f"/api/bundles/{bundle.id}/match/identical-candidates", headers=AUTHOR).json()
    assert [candidate["unit_id"] for candidate in candidates] == [same]
    (candidate,) = candidates
    body = {"identical": [{key: candidate[key] for key in ("unit_id", "unit_revision", "target_id", "target_revision")}]}

    response = client.post(f"/api/bundles/{bundle.id}/match/bulk-confirm", json=body, headers=AUTHOR)

    assert response.status_code == 200, response.text
    assert read_decision(same).status == "confirmed"
    target = read_target(SAME)
    assert (target.status, target.suggestion_id) == ("confirmed", None)


def test_prepare_leaves_the_whole_pair_out_when_one_side_is_a_candidate(client: TestClient, auto_prepare: FakeAi) -> None:
    ko_text, en_text = SAME, "Check the synthetic pressure gauge every morning."
    bundle = make_match_bundle(client, p(ko_text) + p(en_text) + p(OLD_1), p(ko_text) + p(NEW_1), has_assign=True)
    old_1 = _find_old_units(client, bundle.id, bundle.old_document_id, OLD_1)[0]["id"]

    out = post_prepare(client, bundle.id).json()

    assert out["queued"] == 1 and [job.unit_ids for job in read_jobs("classify")] == [[old_1]]


def test_prepare_without_assign_documents_queues_no_classify(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1))

    out = post_prepare(client, bundle.id).json()

    assert out["queued"] == 0 and read_jobs("classify") == []


def test_prepare_queues_a_plan_when_none_ran_for_the_bundle(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1), has_assign=True)
    assert [job.payload["origin"] for job in read_jobs("match_plan")] == ["upload"]  # 업로드 계획만 있었다
    run_plan()

    out = post_prepare(client, bundle.id).json()

    plans = read_jobs("match_plan")
    assert [job.payload["origin"] for job in plans] == ["upload", "prepare"]
    assert (plans[1].priority, plans[1].background, plans[1].status) == (AI_PRIORITY_PLAN, False, "queued")
    assert out["queued"] == len(read_jobs("classify"))  # 응답은 분류 작업만 센다
    assert "ai.request" not in [row.action for row in read_rows(BundleEvent)]


def test_prepare_queues_no_plan_after_a_user_plan(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1), p(NEW_1), has_assign=True)
    run_jobs()
    assert request_match(client, bundle.id).json()["queued"] == 1
    run_jobs()
    plans_before = len(read_jobs("match_plan"))

    post_prepare(client, bundle.id)

    assert plans_before == 2 and len(read_jobs("match_plan")) == plans_before


def test_prepare_returns_zero_when_the_setting_is_off(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)

    out = post_prepare(client, bundle.id).json()

    assert (out["queued"], out["skipped_total"], out["request_id"]) == (0, 0, None)
    assert read_rows(AiJob) == []


def test_prepare_refuses_with_503_when_ai_is_off(
    client: TestClient, auto_prepare: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 화면은 503을 말없이 넘긴다(use-ai-prepare) — AI가 꺼져도 배정 화면의 사람 경로는 그대로다
    bundle = make_ai_bundle(client)
    monkeypatch.setattr(settings, "ai_enabled", False)

    refused = post_prepare(client, bundle.id)

    assert (refused.status_code, refused.json()["detail"]["code"]) == (503, "ai_disabled")
    assert read_rows(AiJob) == []


def test_prepare_is_for_authors_of_an_in_progress_bundle(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle = make_ai_bundle(client)

    assert post_prepare(client, bundle.id, headers=REVIEWER).status_code == 403

    async def _set_in_review(session: AsyncSession) -> None:
        await session.execute(update(Bundle).where(Bundle.id == bundle.id).values(status="in_review"))
        await session.commit()

    run_in_session(_set_in_review)
    refused = post_prepare(client, bundle.id)
    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "bundle_not_editable")
    assert read_rows(AiJob) == []


def test_uploaded_before_the_new_list_then_prepare_classifies_lone_units(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle = make_match_bundle(client, p(OLD_1) + p(LONE), p(NEW_1))  # 배정 New 문서가 아직 없다
    run_jobs()
    lone = _find_old_units(client, bundle.id, bundle.old_document_id, LONE)[0]["id"]
    assert read_decision(lone).status == "unassigned"
    assert put_tobe(client, bundle.id, [AI_SOP_DOC]).status_code == 200  # 사람이 배정 New 문서를 더한다
    use_reply(auto_prepare)

    assert post_prepare(client, bundle.id).json()["queued"] >= 1
    run_jobs()

    assert read_decision(lone).status == "unassigned"  # AI는 제안 기록에만 쓰고 판단은 사람이 받을 때 쓰인다
    assert any(
        row.kind == "classify" and row.result == "applied" and lone in row.content["unit_ids"] for row in read_rows(AiSuggestion)
    )


def test_user_classify_job_does_not_count_as_prepared(client: TestClient, auto_prepare: FakeAi) -> None:
    # 미리 돌린 문서는 background 분류 행으로만 가린다 — 사람이 누른 분류가 있던 문서도 남은 줄을 미리 분류한다
    bundle = make_ai_bundle(client)
    ko, en = find_ids(client, bundle, AI_KO_1, AI_EN_1)
    queue_units(client, bundle.id, [ko, en])
    (user_job,) = read_jobs("classify")
    assert (user_job.background, user_job.document_id) == (False, bundle.document_id)

    out = post_prepare(client, bundle.id).json()

    prepared = [job for job in read_jobs("classify") if job.background]
    assert out["queued"] == 1 and len(prepared) == 1
    assert prepared[0].document_id == bundle.document_id
    assert set(prepared[0].unit_ids) == set(find_ids(client, bundle, AI_KO_2, AI_EN_2))


def test_prepare_queues_no_plan_without_a_written_new_document(client: TestClient, auto_prepare: FakeAi) -> None:
    bundle = make_ai_bundle(client)  # 배정 New 문서만 있고 이미 쓴 New 문서는 없다

    out = post_prepare(client, bundle.id).json()

    assert read_jobs("match_plan") == []
    assert out["queued"] == len(read_jobs("classify")) == 2


def _find_old_units(client: TestClient, bundle_id: int, document_id: int, text: str) -> list[dict]:
    return [unit for unit in get_view(client, bundle_id, document_id)["units"] if unit["text"] == text]
