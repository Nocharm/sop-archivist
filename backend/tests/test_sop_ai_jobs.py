"""AI 작업 실행기와 진행 API — load/compute/apply 순서·세션 없는 compute·취소와 늦은 결과·재시작 복구·워커 루프·상태/취소/다시 시도 경로."""

import asyncio
import inspect
import logging
import sys
from collections.abc import Callable, Sequence
from typing import Any

import httpx2
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import main as main_mod
from app.db import SessionLocal, engine
from app.routers.sop_ai import require_ai_enabled
from app.settings import settings
from app.sop.ai import jobs, runner
from app.sop.ai.constants import MAX_AI_TEXT_CHARS, MAX_JOBS_PER_REQUEST
from app.sop.ai.handlers import HANDLERS
from app.sop.ai.jobs import JobItem, cancel_active_jobs, enqueue_jobs, find_active_unit_ids, load_job_counts
from app.sop.ai.runner import AiCallFailed, claim_next_job, process_job, requeue_running_jobs, run_ai_worker
from app.sop.ai.schemas import (
    MAX_SCOPE_UNITS,
    AdoptionStats,
    AiJobCounts,
    AiRequestOut,
    ScopeIn,
    SkippedOut,
    SuggestionOut,
)
from app.sop.constants import AI_JOB_STATUSES, SEMANTIC_CHECK_KEYS
from app.sop.decisions import TargetIn
from app.sop.models import AiJob, AiSuggestion, Bundle
from tests.access_helpers import run_in_session
from tests.ai_fixtures import AiBundle, make_ai_bundle, run_jobs
from tests.ai_fixtures import clean_ai_jobs  # noqa: F401 -- 픽스처는 아래 usefixtures가 이름으로 찾는다
from tests.fake_ai import FakeAi
from tests.sop_helpers import (
    AUTHOR,
    OUTSIDER,
    REVIEWER,
    assign_as_is,
    create_bundle,
    get_bundle,
    get_view,
    set_members,
)

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs")

NO_JOBS = dict.fromkeys(AI_JOB_STATUSES, 0)
WITH_REVIEWER = [("qa.member", "author"), ("qa.lead", "reviewer")]
SENTINEL = "SENTINEL-TEXT"
FAST_POLL_SECONDS = 0.01
# 멈춤(교착)을 잡는 상한일 뿐 시간을 재는 단언이 아니다 — 느린 GitLab CI 러너에서도 정상 경로가 넘지 않게 넉넉히 둔다
HANG_GUARD_SECONDS = 30


class StubHandler:
    """호출을 기록하고 시험이 끼어들 자리를 주는 가짜 핸들러 — 실행기의 순서·세션·상태만 본다."""

    def __init__(self, *, on_compute: Callable[[], object] | None = None) -> None:
        self.on_compute = on_compute
        self.loaded: object | None = "loaded"
        self.computed: object = "computed"
        self.compute_raises: Exception | None = None
        self.apply_raises: Exception | None = None
        self.apply_result = "done"
        self.calls: list[str] = []
        self.apply_args: tuple[object, object] | None = None

    @property
    def apply_calls(self) -> int:
        return self.calls.count("apply")

    async def load(self, session: AsyncSession, job: AiJob) -> object | None:
        self.calls.append("load")
        return self.loaded

    async def compute(self, job: AiJob, loaded: object) -> object:
        self.calls.append("compute")
        if self.on_compute is not None:
            outcome = self.on_compute()
            if inspect.isawaitable(outcome):
                await outcome
        if self.compute_raises is not None:
            raise self.compute_raises
        return self.computed

    async def apply(self, session: AsyncSession, job: AiJob, loaded: object, computed: object) -> str:
        self.calls.append("apply")
        self.apply_args = (loaded, computed)
        if self.apply_raises is not None:
            job.payload = {"half_written": True}
            await session.flush()
            raise self.apply_raises
        return self.apply_result


@pytest.fixture
def stub(monkeypatch: pytest.MonkeyPatch) -> StubHandler:
    handler = StubHandler()
    monkeypatch.setitem(HANDLERS, "classify", handler)
    return handler


def _new_bundle(client: TestClient) -> int:
    return create_bundle(client, is_synthetic=True)["id"]


def _enqueue(bundle_id: int, kind: str = "classify", *, unit_ids: Sequence[int] = (1, 2), **columns: Any) -> int:
    """작업 하나를 쌓고 id를 돌려준다 — columns로 상태·시도 횟수 같은 칸을 바로 정한다."""

    async def _add(session: AsyncSession) -> int:
        items = [JobItem(document_id=None, unit_ids=list(unit_ids), target_ids=[], payload={})]
        job = enqueue_jobs(session, bundle_id=bundle_id, kind=kind, requested_by="qa.member", items=items)[0]
        for name, value in columns.items():
            setattr(job, name, value)
        await session.commit()
        return job.id

    return run_in_session(_add)


def _get_job(job_id: int) -> AiJob | None:
    return run_in_session(lambda session: session.get(AiJob, job_id))


def _set_bundle_status(bundle_id: int, status: str) -> None:
    async def _update(session: AsyncSession) -> None:
        await session.execute(update(Bundle).where(Bundle.id == bundle_id).values(status=status))
        await session.commit()

    run_in_session(_update)


async def _cancel_from_another_session(bundle_id: int) -> None:
    async with SessionLocal() as session:
        await cancel_active_jobs(session, bundle_id)
        await session.commit()


async def _set_in_review_from_another_session(bundle_id: int) -> None:
    async with SessionLocal() as session:
        await session.execute(update(Bundle).where(Bundle.id == bundle_id).values(status="in_review"))
        await session.commit()


async def _delete_bundle_from_another_session(bundle_id: int) -> None:
    async with SessionLocal() as session:
        await session.execute(delete(Bundle).where(Bundle.id == bundle_id))
        await session.commit()


async def _wait_for_statuses(job_ids: Sequence[int], expected: Sequence[str]) -> None:
    """작업들이 기대한 상태가 될 때까지 짧게 읽는다 — 끝내 안 되면 시간 초과로 실패한다."""

    async def _poll() -> None:
        while True:
            async with SessionLocal() as session:
                rows = await session.scalars(select(AiJob.status).where(AiJob.id.in_(job_ids)).order_by(AiJob.id))
                if list(rows) == list(expected):
                    return
            await asyncio.sleep(FAST_POLL_SECONDS)

    await asyncio.wait_for(_poll(), timeout=HANG_GUARD_SECONDS)


def _post_ai(
    client: TestClient, bundle_id: int, path: str, body: dict | None = None, headers: dict[str, str] = AUTHOR
) -> httpx2.Response:
    return client.post(f"/api/bundles/{bundle_id}/ai/{path}", json=body or {}, headers=headers)


def _get_status(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/ai/status", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _list_events(client: TestClient, bundle_id: int) -> list[dict]:
    """작업 기록 — 가장 새 것이 앞."""
    response = client.get(f"/api/bundles/{bundle_id}/events", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _make_ready(client: TestClient) -> AiBundle:
    """모든 단위를 확정하고 의미 검토 4항목을 표시해 검토 요청이 통과하는 묶음."""
    bundle = make_ai_bundle(client)
    for unit in get_view(client, bundle.id, bundle.document_id)["units"]:
        assign_as_is(client, bundle.id, unit, bundle.sop_id, slot_key="purpose")
    body = {"revision": get_bundle(client, bundle.id)["revision"], "checks": dict.fromkeys(SEMANTIC_CHECK_KEYS, True)}
    response = client.put(f"/api/bundles/{bundle.id}/semantic-checks", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text
    return bundle


def _request_review(client: TestClient, bundle_id: int) -> httpx2.Response:
    body = {"revision": get_bundle(client, bundle_id)["revision"]}
    return client.post(f"/api/bundles/{bundle_id}/review/request", json=body, headers=AUTHOR)


# --- 실행 순서와 결과 ---


def test_job_runs_load_compute_apply_and_ends_done(client: TestClient, stub: StubHandler) -> None:
    job_id = _enqueue(_new_bundle(client))

    run_jobs()

    job = _get_job(job_id)
    assert stub.calls == ["load", "compute", "apply"]
    assert stub.apply_args == ("loaded", "computed")
    assert (job.status, job.attempts, job.error) == ("done", 1, "")
    assert job.started_at is not None and job.finished_at is not None


def test_apply_decides_the_final_status(client: TestClient, stub: StubHandler) -> None:
    stub.apply_result = "stale"
    job_id = _enqueue(_new_bundle(client))

    run_jobs()

    job = _get_job(job_id)
    assert job.status == "stale" and job.finished_at is not None


def test_compute_runs_with_no_db_connection_checked_out(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[int] = []
    handler = StubHandler(on_compute=lambda: seen.append(engine.pool.checkedout()))
    monkeypatch.setitem(HANDLERS, "classify", handler)
    _enqueue(_new_bundle(client))

    run_jobs()

    assert seen == [0]


def test_load_returning_none_ends_stale(client: TestClient, stub: StubHandler) -> None:
    stub.loaded = None
    job_id = _enqueue(_new_bundle(client))

    run_jobs()

    job = _get_job(job_id)
    assert stub.calls == ["load"]
    assert job.status == "stale" and job.finished_at is not None


def test_ai_call_failure_records_only_the_code(client: TestClient, stub: StubHandler) -> None:
    stub.compute_raises = AiCallFailed("timeout")
    job_id = _enqueue(_new_bundle(client))

    run_jobs()

    job = _get_job(job_id)
    assert (job.status, job.error) == ("failed", "timeout")
    assert stub.apply_calls == 0 and job.finished_at is not None


def test_unexpected_exception_is_internal_and_logs_no_text(
    client: TestClient, stub: StubHandler, caplog: pytest.LogCaptureFixture
) -> None:
    stub.compute_raises = RuntimeError(SENTINEL)
    job_id = _enqueue(_new_bundle(client))

    with caplog.at_level(logging.INFO, logger=runner.__name__):
        run_jobs()

    job = _get_job(job_id)
    assert (job.status, job.error) == ("failed", "internal")
    assert SENTINEL not in caplog.text
    assert "RuntimeError" in caplog.text and str(job_id) in caplog.text
    # 트레이스백은 지역 변수와 메시지로 값을 실어 나를 수 있다 — logger.exception 금지
    assert all(record.exc_info is None for record in caplog.records)


def test_kind_without_a_handler_ends_failed_as_internal(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delitem(HANDLERS, "classify", raising=False)
    job_id = _enqueue(_new_bundle(client))

    run_jobs()

    job = _get_job(job_id)
    assert (job.status, job.error) == ("failed", "internal")


def test_handler_module_that_cannot_be_imported_fails_the_job(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_id = _enqueue(_new_bundle(client))
    # sys.modules의 None은 다음 import를 ImportError로 막는다 — 태스크 밖으로 새면 작업이 running에 갇힌다
    monkeypatch.setitem(sys.modules, "app.sop.ai.handlers", None)

    run_jobs()

    job = _get_job(job_id)
    assert (job.status, job.error) == ("failed", "internal")


def test_failure_in_apply_rolls_back_what_it_wrote(client: TestClient, stub: StubHandler) -> None:
    stub.apply_raises = RuntimeError(SENTINEL)
    job_id = _enqueue(_new_bundle(client))

    run_jobs()

    job = _get_job(job_id)
    assert (job.status, job.error, job.payload) == ("failed", "internal", {})


def test_claim_takes_the_smallest_queued_id_and_counts_the_attempt(client: TestClient) -> None:
    bundle_id = _new_bundle(client)
    first, second = _enqueue(bundle_id), _enqueue(bundle_id)

    assert asyncio.run(claim_next_job()) == first

    claimed = _get_job(first)
    assert (claimed.status, claimed.attempts) == ("running", 1) and claimed.started_at is not None
    assert _get_job(second).status == "queued"
    assert asyncio.run(claim_next_job()) == second
    assert asyncio.run(claim_next_job()) is None


# --- 재시작 복구 ---


def test_running_jobs_return_to_queued_on_restart(client: TestClient) -> None:
    job_id = _enqueue(_new_bundle(client), status="running", attempts=1)

    asyncio.run(requeue_running_jobs())

    job = _get_job(job_id)
    assert (job.status, job.attempts, job.error) == ("queued", 1, "")


def test_job_failing_three_interrupted_attempts_ends_failed(client: TestClient) -> None:
    job_id = _enqueue(_new_bundle(client), status="running", attempts=3)

    asyncio.run(requeue_running_jobs())

    job = _get_job(job_id)
    assert (job.status, job.error) == ("failed", "interrupted")
    assert job.finished_at is not None


def test_restart_leaves_jobs_that_are_not_running_alone(client: TestClient) -> None:
    bundle_id = _new_bundle(client)
    job_ids = {status: _enqueue(bundle_id, status=status) for status in AI_JOB_STATUSES if status != "running"}

    asyncio.run(requeue_running_jobs())

    assert {status: _get_job(job_id).status for status, job_id in job_ids.items()} == {
        status: status for status in job_ids
    }


# --- 취소와 늦은 결과 ---


def test_cancel_during_compute_drops_the_result(client: TestClient, stub: StubHandler) -> None:
    bundle_id = _new_bundle(client)
    job_id = _enqueue(bundle_id)
    stub.on_compute = lambda: _cancel_from_another_session(bundle_id)

    run_jobs()

    job = _get_job(job_id)
    assert job.status == "cancelled" and stub.apply_calls == 0
    assert job.finished_at is not None


def test_failure_after_cancel_stays_cancelled(client: TestClient, stub: StubHandler) -> None:
    bundle_id = _new_bundle(client)
    job_id = _enqueue(bundle_id)
    stub.on_compute = lambda: _cancel_from_another_session(bundle_id)
    stub.compute_raises = AiCallFailed("timeout")

    run_jobs()

    job = _get_job(job_id)
    assert (job.status, job.error) == ("cancelled", "")


def test_job_cancelled_right_after_the_claim_is_not_started(client: TestClient, stub: StubHandler) -> None:
    bundle_id = _new_bundle(client)
    _enqueue(bundle_id)
    job_id = asyncio.run(claim_next_job())
    asyncio.run(_cancel_from_another_session(bundle_id))

    asyncio.run(process_job(job_id))

    assert stub.calls == []
    assert _get_job(job_id).status == "cancelled"


def test_bundle_deleted_during_compute_is_dropped_without_error(
    client: TestClient, stub: StubHandler, caplog: pytest.LogCaptureFixture
) -> None:
    bundle_id = _new_bundle(client)
    job_id = _enqueue(bundle_id)
    stub.on_compute = lambda: _delete_bundle_from_another_session(bundle_id)

    with caplog.at_level(logging.INFO, logger=runner.__name__):
        run_jobs()

    assert stub.apply_calls == 0
    assert _get_job(job_id) is None
    assert caplog.records == []


def test_failure_after_the_bundle_is_deleted_ends_quietly(client: TestClient, stub: StubHandler) -> None:
    bundle_id = _new_bundle(client)
    job_id = _enqueue(bundle_id)
    stub.on_compute = lambda: _delete_bundle_from_another_session(bundle_id)
    stub.compute_raises = AiCallFailed("timeout")

    run_jobs()

    assert _get_job(job_id) is None


def test_review_request_cancels_active_jobs(client: TestClient) -> None:
    bundle = _make_ready(client)
    _enqueue(bundle.id)
    _enqueue(bundle.id, status="running")
    _enqueue(bundle.id, status="done")

    response = _request_review(client, bundle.id)

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "in_review"
    assert response.json()["ai_jobs"] == {**NO_JOBS, "done": 1, "cancelled": 2}


def test_refused_review_request_leaves_jobs_alone(client: TestClient) -> None:
    bundle = make_ai_bundle(client)
    job_id = _enqueue(bundle.id)

    assert _request_review(client, bundle.id).status_code == 422

    assert _get_job(job_id).status == "queued"


def test_late_result_after_review_request_is_not_applied(client: TestClient, stub: StubHandler) -> None:
    bundle_id = _new_bundle(client)
    job_id = _enqueue(bundle_id)
    stub.on_compute = lambda: _set_in_review_from_another_session(bundle_id)

    run_jobs()

    job = _get_job(job_id)
    assert job.status == "cancelled" and stub.apply_calls == 0
    assert job.finished_at is not None


# --- 쌓기와 집계 ---


def test_enqueue_writes_queued_rows_for_the_caller_to_commit(client: TestClient) -> None:
    bundle_id = _new_bundle(client)

    async def _enqueue_two(session: AsyncSession) -> list[int]:
        items = [
            JobItem(document_id=None, unit_ids=[1, 2], target_ids=[9], payload={"direction": "ko_to_en"}),
            JobItem(document_id=None, unit_ids=[3], target_ids=[], payload={}),
        ]
        jobs = enqueue_jobs(session, bundle_id=bundle_id, kind="translate", requested_by="qa.member", items=items)
        await session.commit()
        return [job.id for job in jobs]

    first, second = run_in_session(_enqueue_two)

    job = _get_job(first)
    assert (job.kind, job.status, job.unit_ids, job.target_ids) == ("translate", "queued", [1, 2], [9])
    assert (job.payload, job.requested_by, job.attempts) == ({"direction": "ko_to_en"}, "qa.member", 0)
    assert _get_job(second).unit_ids == [3]


def test_find_active_unit_ids_reads_queued_and_running_of_the_kinds(client: TestClient) -> None:
    bundle_id = _new_bundle(client)
    _enqueue(bundle_id, unit_ids=[1, 2])
    _enqueue(bundle_id, unit_ids=[3], status="running")
    _enqueue(bundle_id, unit_ids=[4], status="done")
    _enqueue(bundle_id, "translate", unit_ids=[5])
    _enqueue(_new_bundle(client), unit_ids=[6])

    found = run_in_session(lambda session: find_active_unit_ids(session, bundle_id, ["classify"]))

    assert found == {1, 2, 3}


def test_job_counts_cover_only_the_bundle(client: TestClient) -> None:
    bundle_id = _new_bundle(client)
    _enqueue(bundle_id)
    _enqueue(bundle_id, status="done")
    _enqueue(_new_bundle(client), status="done")

    counts = run_in_session(lambda session: load_job_counts(session, bundle_id))

    assert counts == AiJobCounts(queued=1, done=1)


def test_bundle_overview_carries_job_counts(client: TestClient) -> None:
    created = create_bundle(client, is_synthetic=True)
    assert created["ai_jobs"] == NO_JOBS

    bundle_id = created["id"]
    _enqueue(bundle_id)
    _enqueue(bundle_id, status="failed", error="timeout")
    expected = {**NO_JOBS, "queued": 1, "failed": 1}

    assert get_bundle(client, bundle_id)["ai_jobs"] == expected
    assert set_members(client, bundle_id, WITH_REVIEWER).json()["ai_jobs"] == expected


# --- 진행 API ---


def test_status_reports_counts_by_kind_and_failed_codes(client: TestClient) -> None:
    bundle_id = _new_bundle(client)
    _enqueue(bundle_id)
    _enqueue(bundle_id, status="running")
    _enqueue(bundle_id, "translate", status="failed", error="timeout")
    _enqueue(bundle_id, "translate", status="failed", error="timeout")
    _enqueue(bundle_id, "pair", status="failed", error="internal")
    _enqueue(bundle_id, "pair", status="done")
    _enqueue(_new_bundle(client), "pair", status="failed", error="connection")

    assert _get_status(client, bundle_id) == {
        "ai_enabled": False,
        "embed_enabled": False,
        "jobs": {**NO_JOBS, "queued": 1, "running": 1, "failed": 3, "done": 1},
        "by_kind": {
            "classify": {**NO_JOBS, "queued": 1, "running": 1},
            "translate": {**NO_JOBS, "failed": 2},
            "pair": {**NO_JOBS, "failed": 1, "done": 1},
        },
        "failed_errors": {"timeout": 2, "internal": 1},
        "adoption": {},
    }


def test_status_shows_whether_ai_and_embedding_are_on(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle_id = _new_bundle(client)
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "embed_enabled", True)

    status = _get_status(client, bundle_id)

    assert (status["ai_enabled"], status["embed_enabled"]) == (True, True)


def test_status_is_for_members_and_cancel_for_authors(client: TestClient) -> None:
    bundle_id = _new_bundle(client)
    assert set_members(client, bundle_id, WITH_REVIEWER).status_code == 200

    outsider = client.get(f"/api/bundles/{bundle_id}/ai/status", headers=OUTSIDER)
    assert (outsider.status_code, outsider.json()["detail"]["code"]) == (404, "bundle_not_found")
    assert _post_ai(client, bundle_id, "cancel", headers=OUTSIDER).status_code == 404
    assert _post_ai(client, bundle_id, "retry", headers=OUTSIDER).status_code == 404

    assert _get_status(client, bundle_id, REVIEWER)["jobs"] == NO_JOBS
    for path in ("cancel", "retry"):
        refused = _post_ai(client, bundle_id, path, headers=REVIEWER)
        assert (refused.status_code, refused.json()["detail"]["code"]) == (403, "role_required")
        assert _post_ai(client, bundle_id, path).status_code == 200


def test_cancel_and_retry_need_a_bundle_in_progress(client: TestClient) -> None:
    bundle_id = _new_bundle(client)
    job_id = _enqueue(bundle_id)
    _set_bundle_status(bundle_id, "in_review")

    for path in ("cancel", "retry"):
        refused = _post_ai(client, bundle_id, path)
        assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "bundle_not_editable")
    assert _get_job(job_id).status == "queued"


def test_cancel_stops_queued_and_running_and_leaves_a_record(client: TestClient) -> None:
    bundle_id = _new_bundle(client)
    queued, running = _enqueue(bundle_id), _enqueue(bundle_id, status="running")
    done = _enqueue(bundle_id, status="done")
    other = _enqueue(_new_bundle(client))

    response = _post_ai(client, bundle_id, "cancel")

    assert (response.status_code, response.json()) == (200, {"cancelled": 2})
    assert _get_job(queued).status == "cancelled" and _get_job(queued).finished_at is not None
    assert _get_job(running).status == "cancelled"
    assert _get_job(done).status == "done"
    assert _get_job(other).status == "queued"
    event = _list_events(client, bundle_id)[0]
    assert (event["action"], event["target_type"], event["reason"]) == ("ai.cancel", "ai_job", "count=2")
    assert event["actor"] == "qa.member"


def test_cancel_and_retry_can_narrow_to_one_kind(client: TestClient) -> None:
    bundle_id = _new_bundle(client)
    classify, translate = _enqueue(bundle_id), _enqueue(bundle_id, "translate")
    failed_classify = _enqueue(bundle_id, status="failed", error="timeout")
    failed_translate = _enqueue(bundle_id, "translate", status="failed", error="timeout")

    assert _post_ai(client, bundle_id, "cancel", {"kind": "translate"}).json() == {"cancelled": 1}
    assert _post_ai(client, bundle_id, "retry", {"kind": "translate"}).json() == {"queued": 1}

    assert _get_job(classify).status == "queued" and _get_job(translate).status == "cancelled"
    assert _get_job(failed_classify).status == "failed" and _get_job(failed_translate).status == "queued"


def test_cancel_and_retry_refuse_an_unknown_kind(client: TestClient) -> None:
    bundle_id = _new_bundle(client)

    for path in ("cancel", "retry"):
        assert _post_ai(client, bundle_id, path, {"kind": "nope"}).status_code == 422


def test_cancel_and_retry_accept_a_post_without_a_body(client: TestClient) -> None:
    # 계약은 `{kind?}`라 본문을 아예 안 보내도 "모든 종류"다 — 필수 본문이면 422가 된다
    bundle_id = _new_bundle(client)
    queued = _enqueue(bundle_id)
    failed = _enqueue(bundle_id, "translate", status="failed", error="timeout")

    cancelled = client.post(f"/api/bundles/{bundle_id}/ai/cancel", headers=AUTHOR)
    retried = client.post(f"/api/bundles/{bundle_id}/ai/retry", headers=AUTHOR)

    assert (cancelled.status_code, cancelled.json()) == (200, {"cancelled": 1})
    assert (retried.status_code, retried.json()) == (200, {"queued": 1})
    assert (_get_job(queued).status, _get_job(failed).status) == ("cancelled", "queued")


def test_retry_requeues_only_failed(client: TestClient) -> None:
    bundle_id = _new_bundle(client)
    failed = _enqueue(bundle_id, status="failed", error="timeout", attempts=2)
    others = {status: _enqueue(bundle_id, status=status) for status in AI_JOB_STATUSES if status != "failed"}

    response = _post_ai(client, bundle_id, "retry")

    assert (response.status_code, response.json()) == (200, {"queued": 1})
    job = _get_job(failed)
    assert (job.status, job.attempts, job.error, job.finished_at) == ("queued", 0, "", None)
    assert {status: _get_job(job_id).status for status, job_id in others.items()} == {status: status for status in others}
    event = _list_events(client, bundle_id)[0]
    assert (event["action"], event["target_type"], event["reason"]) == ("ai.retry", "ai_job", "count=1")


def test_retried_job_runs_again(client: TestClient, stub: StubHandler) -> None:
    bundle_id = _new_bundle(client)
    stub.compute_raises = AiCallFailed("timeout")
    job_id = _enqueue(bundle_id)
    run_jobs()
    stub.compute_raises = None

    assert _post_ai(client, bundle_id, "retry").json() == {"queued": 1}
    run_jobs()

    job = _get_job(job_id)
    assert (job.status, job.error, job.attempts) == ("done", "", 1)


def test_require_ai_enabled_refuses_with_503_when_ai_is_off(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ai_enabled", False)
    with pytest.raises(HTTPException) as refused:
        require_ai_enabled()
    assert (refused.value.status_code, refused.value.detail) == (503, {"code": "ai_disabled"})

    monkeypatch.setattr(settings, "ai_enabled", True)
    require_ai_enabled()


@pytest.mark.parametrize(
    ("kind", "scope"), [("classify", {}), ("translate", {"direction": "ko_to_en"}), ("split", {})]
)
def test_unit_not_found_reports_the_first_ids_and_the_total(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch, kind: str, scope: dict[str, str]
) -> None:
    bundle = make_ai_bundle(client)
    missing = [9_000_001, 9_000_002, 9_000_003]
    monkeypatch.setattr(jobs, "MAX_SKIPPED_REPORTED", 2)

    refused = client.post(f"/api/bundles/{bundle.id}/ai/{kind}", json={**scope, "unit_ids": missing}, headers=AUTHOR)

    assert (refused.status_code, refused.json()["detail"]) == (
        404, {"code": "unit_not_found", "unit_ids": missing[:2], "missing_total": 3},
    )


# --- 워커 루프 ---


def test_worker_loop_stops_cleanly_on_cancel(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    job_id = _enqueue(_new_bundle(client))
    seen: list[str] = []

    async def _run() -> None:
        started = asyncio.Event()

        async def hold_until_cancelled() -> None:
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                seen.append("cancelled")
                raise

        monkeypatch.setitem(HANDLERS, "classify", StubHandler(on_compute=hold_until_cancelled))
        worker = asyncio.create_task(run_ai_worker())
        await asyncio.wait_for(started.wait(), timeout=HANG_GUARD_SECONDS)

        worker.cancel()
        with pytest.raises(asyncio.CancelledError):
            await worker
        # 돌던 작업이 워커와 함께 끝났다 — 루프가 닫히며 정리되길 기다리지 않는다
        assert seen == ["cancelled"]

    with caplog.at_level(logging.WARNING):
        asyncio.run(_run())

    assert _get_job(job_id).status == "running"  # 재시작 때 requeue_running_jobs가 회수한다
    assert caplog.records == []


def test_worker_runs_at_most_ai_max_concurrency_jobs(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle_id = _new_bundle(client)
    job_ids = [_enqueue(bundle_id) for _ in range(3)]
    monkeypatch.setattr(settings, "ai_max_concurrency", 2)
    monkeypatch.setattr(runner, "AI_POLL_SECONDS", FAST_POLL_SECONDS)

    async def _run() -> None:
        release = asyncio.Event()
        stub = StubHandler(on_compute=release.wait)
        monkeypatch.setitem(HANDLERS, "classify", stub)
        worker = asyncio.create_task(run_ai_worker())

        await _wait_for_statuses(job_ids, ["running", "running", "queued"])
        await asyncio.sleep(FAST_POLL_SECONDS * 5)  # 세 번째를 꺼낼 기회를 몇 주기 준다
        await _wait_for_statuses(job_ids, ["running", "running", "queued"])

        release.set()
        await _wait_for_statuses(job_ids, ["done", "done", "done"])
        worker.cancel()
        with pytest.raises(asyncio.CancelledError):
            await worker

    asyncio.run(_run())


def test_worker_keeps_polling_after_a_failed_claim(
    client: TestClient, stub: StubHandler, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    job_id = _enqueue(_new_bundle(client))
    real_claim = runner.claim_next_job
    claims: list[int] = []

    async def fail_once() -> int | None:
        claims.append(1)
        if len(claims) == 1:
            raise RuntimeError(SENTINEL)
        return await real_claim()

    monkeypatch.setattr(runner, "claim_next_job", fail_once)
    monkeypatch.setattr(runner, "AI_POLL_SECONDS", FAST_POLL_SECONDS)

    async def _run() -> None:
        worker = asyncio.create_task(run_ai_worker())
        await _wait_for_statuses([job_id], ["done"])
        worker.cancel()
        with pytest.raises(asyncio.CancelledError):
            await worker

    with caplog.at_level(logging.INFO, logger=runner.__name__):
        asyncio.run(_run())

    assert "RuntimeError" in caplog.text and SENTINEL not in caplog.text


def _run_lifespan_and_report_worker(monkeypatch: pytest.MonkeyPatch) -> dict[str, bool]:
    """lifespan을 한 번 돌려 워커 태스크가 떴는지·종료 때 취소됐는지 돌려준다."""
    state = {"started": False, "cancelled": False}

    async def fake_worker() -> None:
        state["started"] = True
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            state["cancelled"] = True
            raise

    monkeypatch.setattr(main_mod, "run_ai_worker", fake_worker)
    with TestClient(main_mod.app):
        pass
    return state


@pytest.mark.parametrize(
    ("ai_enabled", "embed_enabled", "expected"),
    [(True, False, True), (False, True, True), (False, False, False)],
)
def test_lifespan_runs_the_worker_only_when_ai_or_embedding_is_on(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, ai_enabled: bool, embed_enabled: bool, expected: bool
) -> None:
    monkeypatch.setattr(settings, "ai_enabled", ai_enabled)
    monkeypatch.setattr(settings, "embed_enabled", embed_enabled)

    assert _run_lifespan_and_report_worker(monkeypatch) == {"started": expected, "cancelled": expected}


def test_lifespan_requeues_running_jobs_even_with_ai_off(client: TestClient) -> None:
    job_id = _enqueue(_new_bundle(client), status="running", attempts=1)

    with TestClient(main_mod.app):
        pass

    assert _get_job(job_id).status == "queued"


# --- 스키마 ---


def test_scope_needs_a_document_or_units(client: TestClient) -> None:
    assert ScopeIn(document_id=3).document_id == 3
    assert ScopeIn(unit_ids=[1, 2]).unit_ids == [1, 2]

    for empty in ({}, {"unit_ids": []}):
        with pytest.raises(HTTPException) as refused:
            ScopeIn(**empty)
        assert (refused.value.status_code, refused.value.detail) == (422, {"code": "scope_required"})


def test_scope_refusal_reaches_the_client_with_the_rule_code(client: TestClient) -> None:
    probe = FastAPI()

    @probe.post("/scope")
    async def post_scope(body: ScopeIn) -> dict:
        return body.model_dump()

    response = TestClient(probe).post("/scope", json={})

    assert (response.status_code, response.json()["detail"]["code"]) == (422, "scope_required")


def test_scope_input_is_bounded(client: TestClient) -> None:
    with pytest.raises(ValidationError):
        ScopeIn(document_id=2**31)
    with pytest.raises(ValidationError):
        ScopeIn(unit_ids=[0])
    with pytest.raises(ValidationError):
        ScopeIn(unit_ids=[1] * (MAX_SCOPE_UNITS + 1))


def test_scope_list_may_exceed_the_job_cap_so_the_excess_is_reported_not_refused(client: TestClient) -> None:
    assert len(ScopeIn(unit_ids=[1] * (MAX_JOBS_PER_REQUEST + 1)).unit_ids) == MAX_JOBS_PER_REQUEST + 1


def test_job_counts_have_a_field_per_status(client: TestClient) -> None:
    assert set(AiJobCounts.model_fields) == set(AI_JOB_STATUSES)


def test_ai_text_cap_matches_the_target_text_cap(client: TestClient) -> None:
    assert TargetIn(key="t", source_unit_ids=[], text="x" * MAX_AI_TEXT_CHARS).text
    with pytest.raises(ValidationError):
        TargetIn(key="t", source_unit_ids=[], text="x" * (MAX_AI_TEXT_CHARS + 1))


def test_request_out_has_the_contract_shape(client: TestClient) -> None:
    out = AiRequestOut(queued=1, skipped_total=1, skipped=[SkippedOut(unit_id=7, reason="not_unassigned")])

    assert out.model_dump() == {
        "queued": 1,
        "skipped_total": 1,
        "skipped": [{"unit_id": 7, "reason": "not_unassigned"}],
    }
    with pytest.raises(ValidationError):
        SkippedOut(unit_id=7, reason="made_up")


def test_adoption_stats_has_the_contract_shape(client: TestClient) -> None:
    stats = AdoptionStats(applied=3, as_is=1, edited=1, rejected=0, pending=1, adoption_rate=0.5)

    assert set(stats.model_dump()) == {"applied", "as_is", "edited", "rejected", "pending", "adoption_rate"}


def test_suggestion_out_reads_a_suggestion_row(client: TestClient) -> None:
    bundle_id = _new_bundle(client)
    job_id = _enqueue(bundle_id)

    async def _add(session: AsyncSession) -> dict:
        row = AiSuggestion(
            job_id=job_id, bundle_id=bundle_id, kind="classify", content={"unit_ids": [1]},
            warnings=[{"code": "evidence_not_found"}], result="applied", guideline_versions={"rules": 1}, model="fake",
        )
        session.add(row)
        await session.commit()
        return SuggestionOut.model_validate(row).model_dump(mode="json")

    out = run_in_session(_add)

    assert set(out) == {
        "id", "job_id", "kind", "document_id", "result", "content", "warnings", "guideline_versions", "model",
        "adoption", "adopted_by", "adopted_at", "created_at",
    }
    assert (out["job_id"], out["kind"], out["result"], out["adoption"]) == (job_id, "classify", "applied", None)
    assert out["created_at"].endswith("+09:00")


def test_make_ai_bundle_has_paired_lines_and_both_new_documents(client: TestClient) -> None:
    bundle = make_ai_bundle(client)

    view = get_view(client, bundle.id, bundle.document_id)

    assert [unit["lang"] for unit in view["units"]] == ["ko", "en", "ko", "en"]
    assert len(view["pairs"]) == 2
    assert bundle.sop_id != bundle.wi_id
