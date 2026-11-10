"""최근 AI 작업 목록(GET /api/ai/jobs/recent) — 멤버십 거르기, 하루 범위, 상한, 요청별 진행 수, 이름 없는 응답."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.dev_users import DEV_USERS
from app.sop.ai.constants import MAX_RECENT_JOBS, RECENT_JOBS_WINDOW_HOURS
from app.sop.ai.jobs import JobItem, enqueue_jobs
from app.sop.models import AiJob
from tests.access_helpers import run_in_session
from tests.ai_fixtures import clean_ai_jobs, make_ai_bundle, request_classify  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, OUTSIDER, REVIEWER, create_bundle, set_members

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs")

RECENT = "/api/ai/jobs/recent"


def get_recent(client: TestClient, headers: dict[str, str] = AUTHOR) -> dict:
    response = client.get(RECENT, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def add_jobs(
    bundle_id: int, count: int = 1, *, kind: str = "classify", requested_by: str = "qa.member", **values: object
) -> list[int]:
    """같은 요청으로 작업을 쌓고 values(상태·시각 등)를 덮어쓴다 — 작업 id를 돌려준다."""

    async def _run(session: AsyncSession) -> list[int]:
        jobs = enqueue_jobs(
            session, bundle_id=bundle_id, kind=kind, requested_by=requested_by,
            items=[JobItem(unit_ids=[1, 2], target_ids=[3]) for _ in range(count)],
        )
        await session.flush()
        ids = [job.id for job in jobs]
        if values:
            await session.execute(update(AiJob).where(AiJob.id.in_(ids)).values(**values))
        await session.commit()
        return ids

    return run_in_session(_run)


def make_bundle(client: TestClient, title: str, headers: dict[str, str] = AUTHOR) -> int:
    return create_bundle(client, title=title, headers=headers)["id"]


def test_lists_only_jobs_of_bundles_i_am_a_member_of(client: TestClient) -> None:
    mine = make_bundle(client, "Mine")
    assert set_members(client, mine, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200
    theirs = make_bundle(client, "Theirs", headers=OUTSIDER)
    (mine_job,) = add_jobs(mine)
    (their_job,) = add_jobs(theirs, requested_by="prod.member")

    assert [job["id"] for job in get_recent(client)["jobs"]] == [mine_job]
    assert [job["id"] for job in get_recent(client, OUTSIDER)["jobs"]] == [their_job]
    # 역할과 상관없이 멤버면 보이고, 남이 요청한 작업은 나의 요청이 아니다
    (seen,) = get_recent(client, REVIEWER)["jobs"]
    assert (seen["id"], seen["requested_by_me"]) == (mine_job, False)


def test_job_row_carries_bundle_document_and_counts(client: TestClient) -> None:
    bundle = make_ai_bundle(client)
    (job_id,) = add_jobs(bundle.id)
    run_in_session(lambda session: _set_document(session, job_id, bundle.document_id))

    body = get_recent(client)

    (job,) = body["jobs"]
    assert job["bundle_code"] == f"BND-{bundle.id:04d}"
    assert (job["document_id"], job["unit_count"], job["target_count"]) == (bundle.document_id, 2, 1)
    assert job["document_file_name"].startswith("SYNTHETIC_")
    assert (job["status"], job["error"], job["attempts"], job["requested_by_me"]) == ("queued", "", 0, True)
    assert job["started_at"] is None and job["finished_at"] is None
    assert body["server_time"]


async def _set_document(session: AsyncSession, job_id: int, document_id: int) -> None:
    await session.execute(update(AiJob).where(AiJob.id == job_id).values(document_id=document_id))
    await session.commit()


def test_finished_jobs_stay_for_a_day_and_active_jobs_always(client: TestClient) -> None:
    bundle_id = make_bundle(client, "Window")
    long_ago = now() - timedelta(hours=RECENT_JOBS_WINDOW_HOURS + 1)
    (old_queued,) = add_jobs(bundle_id, created_at=long_ago)
    (old_done,) = add_jobs(bundle_id, status="done", created_at=long_ago, finished_at=long_ago)
    (recent_failed,) = add_jobs(bundle_id, status="failed", error="timeout", finished_at=now() - timedelta(hours=1))

    body = get_recent(client)

    assert [job["id"] for job in body["jobs"]] == [recent_failed, old_queued]
    assert old_done not in {job["id"] for job in body["jobs"]}
    assert body["jobs_total"] == 2


def test_jobs_are_newest_first_and_capped(client: TestClient) -> None:
    bundle_id = make_bundle(client, "Many")
    ids = add_jobs(bundle_id, MAX_RECENT_JOBS + 5)

    body = get_recent(client)

    assert [job["id"] for job in body["jobs"]] == sorted(ids, reverse=True)[:MAX_RECENT_JOBS]
    assert body["jobs_total"] == MAX_RECENT_JOBS + 5
    # 요청별 수는 작업 목록 상한과 상관없이 전부 센다
    (request,) = body["requests"]
    assert request["total"] == MAX_RECENT_JOBS + 5


def test_requests_group_their_jobs_and_count_progress(client: TestClient) -> None:
    bundle_id = make_bundle(client, "Progress")
    first = add_jobs(bundle_id, 3)
    second = add_jobs(bundle_id, 2, kind="translate", status="done", finished_at=now())
    run_in_session(lambda session: _finish(session, first[0], "done"))
    run_in_session(lambda session: _finish(session, first[1], "failed", error="timeout"))

    body = get_recent(client)

    newer, older = body["requests"]
    assert body["requests_total"] == 2
    assert (newer["kind"], newer["total"], newer["jobs"]["done"]) == ("translate", 2, 2)
    assert newer["finished_at"] is not None  # 모든 작업이 끝났다
    assert (older["kind"], older["kinds"], older["total"]) == ("classify", ["classify"], 3)
    assert {key: older["jobs"][key] for key in ("queued", "done", "failed")} == {"queued": 1, "done": 1, "failed": 1}
    assert older["error_counts"] == {"timeout": 1}
    assert older["finished_at"] is None  # 아직 대기 중인 작업이 있다
    by_id = {job["id"]: job["request_id"] for job in body["jobs"]}
    assert {by_id[job_id] for job_id in first} == {older["request_id"]}
    assert {by_id[job_id] for job_id in second} == {newer["request_id"]}
    assert older["bundle_code"] == f"BND-{bundle_id:04d}" and older["bundle_title"] == "Progress"


async def _finish(session: AsyncSession, job_id: int, status: str, error: str = "") -> None:
    await session.execute(update(AiJob).where(AiJob.id == job_id).values(status=status, error=error, finished_at=now()))
    await session.commit()


def test_request_total_includes_jobs_that_left_the_window(client: TestClient) -> None:
    # 일부 작업이 하루를 넘겨도 요청의 N은 줄지 않는다
    bundle_id = make_bundle(client, "Partial")
    ids = add_jobs(bundle_id, 2)
    long_ago = now() - timedelta(hours=RECENT_JOBS_WINDOW_HOURS + 1)

    async def _age_one(session: AsyncSession) -> None:
        await session.execute(update(AiJob).where(AiJob.id == ids[0]).values(status="done", finished_at=long_ago))
        await session.commit()

    run_in_session(_age_one)

    body = get_recent(client)

    assert [job["id"] for job in body["jobs"]] == [ids[1]]
    (request,) = body["requests"]
    assert (request["total"], request["jobs"]["done"], request["jobs"]["queued"]) == (2, 1, 1)


def test_request_out_returns_the_request_id_of_the_queued_jobs(client: TestClient, fake_ai: FakeAi) -> None:
    bundle = make_ai_bundle(client)

    body = request_classify(client, bundle.id, document_id=bundle.document_id).json()

    assert body["queued"] >= 1
    stored = run_in_session(lambda session: _read_request_ids(session, bundle.id))
    assert stored == {body["request_id"]}
    assert {request["request_id"] for request in get_recent(client)["requests"]} == {body["request_id"]}


async def _read_request_ids(session: AsyncSession, bundle_id: int) -> set[str]:
    return set(await session.scalars(select(AiJob.request_id).where(AiJob.bundle_id == bundle_id)))


def test_response_never_names_people(client: TestClient) -> None:
    bundle_id = make_bundle(client, "Names")
    assert set_members(client, bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200
    add_jobs(bundle_id, requested_by="qa.lead")

    text = client.get(RECENT, headers=AUTHOR).text

    for user in DEV_USERS:
        assert user.name not in text and user.korean_name not in text
        assert user.login_id not in text  # 요청한 사람은 requested_by_me로만 보인다


def test_inactive_account_is_refused(client: TestClient) -> None:
    response = client.get(RECENT, headers={"X-Dev-User": "nobody.here"})

    assert (response.status_code, response.json()["detail"]["code"]) == (403, "inactive_account")
