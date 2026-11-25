"""숨긴 AI — 자동 칸 추천과 묶기 계획의 삭제 후보가 멈추고, 숨긴 자료가 있는 묶음도 검토 요청까지 간다 (쪼개기 먼저 설계 §5 H4·H5)."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings
from app.sop.ai import constants
from app.sop.models import AiSuggestion
from tests.ai_fixtures import clean_ai_jobs  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
from tests.ai_fixtures import AI_SOP_DOC, make_match_bundle, plan, read_rows, run_jobs, run_plan, use_reply
from tests.docx_factory import p
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, put_tobe
from tests.test_sop_ai_match_plan import LONE_NEW, LONE_OLD, NEW_1, NEW_2, OLD_1, OLD_2, find_live, queue_plan, read_old_ids
from tests.test_sop_ai_prepare import post_prepare, read_jobs

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
