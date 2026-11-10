"""배정 초기화 — 문서 단위·묶음 전체, 건수 미리 보기(dry_run), 거절(검토 대기·revision·진행 중 AI 작업·권한), 번역 줄 정리, 기록."""

import json

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.sop.models import AiJob, Bundle, BundleEvent, TargetSentence, UnitDecision, UnitDecisionHistory
from tests.access_helpers import run_in_session, update_row
from tests.ai_fixtures import (
    AI_KO_1,
    AiBundle,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    make_ai_bundle,
    read_rows,
    run_jobs,
    upload_second_document,
)
from tests.docx_factory import p
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, REVIEWER, assign_as_is, find_unit, get_bundle, get_view, save_group

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs")

SECOND_KO = "합성 세 번째 문장을 시험한다."
SECOND_KO_2 = "합성 네 번째 문장을 시험한다."
SLOT = "purpose"


class Setup:
    """둘째 문서 단위 a·b와 첫 문서 단위 k — a와 k는 SOP 문장 하나로 합쳐 확정, b는 그대로 확정."""

    def __init__(self, client: TestClient) -> None:
        self.bundle: AiBundle = make_ai_bundle(client)
        view = upload_second_document(client, self.bundle.id, p(SECOND_KO) + p(SECOND_KO_2))
        self.second_id: int = view["document"]["id"]
        self.a, self.b = find_unit(view, SECOND_KO), find_unit(view, SECOND_KO_2)
        self.k = find_unit(get_view(client, self.bundle.id, self.bundle.document_id), AI_KO_1)
        merged = save_group(client, self.bundle.id, {
            "action": "confirm",
            "units": [{"unit_id": u["id"], "revision": 1, "disposition": "assigned"} for u in (self.a, self.k)],
            "targets": [{
                "key": "m", "target_doc_id": self.bundle.sop_id, "slot_key": SLOT,
                "source_unit_ids": [self.a["id"], self.k["id"]], "text": "합성 합친 문장.", "change_type": "rewritten",
            }],
        })
        assert merged.status_code == 200, merged.text
        assign_as_is(client, self.bundle.id, self.b, self.bundle.sop_id, slot_key=SLOT)


def reset(client: TestClient, bundle_id: int, *, revision: int | None = None, headers: dict[str, str] = AUTHOR, **body: object) -> httpx2.Response:
    revision = get_bundle(client, bundle_id)["revision"] if revision is None else revision
    return client.post(
        f"/api/bundles/{bundle_id}/decisions/reset", json={"revision": revision, **body}, headers=headers
    )


def read_status(unit_id: int) -> str:
    return run_in_session(lambda session: session.get(UnitDecision, unit_id)).status


def count_active_targets() -> int:
    return len([t for t in read_rows(TargetSentence) if t.origin != "translation"])


def test_document_reset_unassigns_it_and_holds_what_other_documents_share(client: TestClient) -> None:
    fx = Setup(client)

    response = reset(client, fx.bundle.id, document_id=fx.second_id)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "dry_run": False, "unassigned_units": 2, "deleted_targets": 1, "held_units": 1, "held_targets": 1,
    }
    assert [read_status(u["id"]) for u in (fx.a, fx.b, fx.k)] == ["unassigned", "unassigned", "on_hold"]
    assert count_active_targets() == 1
    assert len([h for h in read_rows(UnitDecisionHistory) if h.cause == "cleared"]) == 2


def test_bundle_reset_clears_everything_without_holds(client: TestClient) -> None:
    fx = Setup(client)

    response = reset(client, fx.bundle.id)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "dry_run": False, "unassigned_units": 3, "deleted_targets": 2, "held_units": 0, "held_targets": 0,
    }
    assert {read_status(u["id"]) for u in (fx.a, fx.b, fx.k)} == {"unassigned"}
    assert count_active_targets() == 0
    (event,) = [e for e in read_rows(BundleEvent) if e.action == "decision.reset"]
    assert event.target_type == "bundle" and event.target_ids == [fx.bundle.id]
    assert event.detail == {"unassigned_units": 3, "deleted_targets": 2, "held_units": 0, "held_targets": 0}


def test_dry_run_returns_the_same_counts_and_changes_nothing(client: TestClient) -> None:
    fx = Setup(client)
    before = [(read_status(u["id"]), run_in_session(lambda s, u=u: s.get(UnitDecision, u["id"])).revision) for u in (fx.a, fx.b, fx.k)]

    preview = reset(client, fx.bundle.id, document_id=fx.second_id, dry_run=True)

    assert preview.status_code == 200, preview.text
    assert preview.json() == {
        "dry_run": True, "unassigned_units": 2, "deleted_targets": 1, "held_units": 1, "held_targets": 1,
    }
    after = [(read_status(u["id"]), run_in_session(lambda s, u=u: s.get(UnitDecision, u["id"])).revision) for u in (fx.a, fx.b, fx.k)]
    assert after == before and count_active_targets() == 2
    assert not [e for e in read_rows(BundleEvent) if e.action == "decision.reset"]
    assert not read_rows(UnitDecisionHistory)
    real = reset(client, fx.bundle.id, document_id=fx.second_id)
    assert {k: v for k, v in real.json().items() if k != "dry_run"} == {
        k: v for k, v in preview.json().items() if k != "dry_run"
    }


def test_reset_with_nothing_assigned_is_a_quiet_no_op(client: TestClient) -> None:
    bundle = make_ai_bundle(client)

    response = reset(client, bundle.id)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "dry_run": False, "unassigned_units": 0, "deleted_targets": 0, "held_units": 0, "held_targets": 0,
    }
    assert not [e for e in read_rows(BundleEvent) if e.action == "decision.reset"]


def test_reset_sweeps_ai_translation_lines_of_the_cleared_sources(client: TestClient, fake_ai: FakeAi) -> None:
    fx = Setup(client)
    fake_ai.chat = lambda data: json.dumps({"text": "The fourth synthetic sentence shall be tested."})
    queued = client.post(
        f"/api/bundles/{fx.bundle.id}/ai/translate", json={"direction": "ko_to_en", "unit_ids": [fx.b["id"]]}, headers=AUTHOR
    )
    assert queued.status_code == 200 and queued.json()["queued"] == 1, queued.text
    run_jobs()
    assert [t for t in read_rows(TargetSentence) if t.origin == "translation"]

    response = reset(client, fx.bundle.id, document_id=fx.second_id)

    assert response.status_code == 200, response.text
    assert response.json()["deleted_targets"] == 2  # b의 새 문장과 그 AI 번역
    assert not [t for t in read_rows(TargetSentence) if t.origin == "translation"]


def test_reset_is_refused_while_in_review(client: TestClient) -> None:
    fx = Setup(client)
    update_row(Bundle, fx.bundle.id, status="in_review")

    response = reset(client, fx.bundle.id)

    assert (response.status_code, response.json()["detail"]["code"]) == (409, "bundle_not_editable")
    assert read_status(fx.b["id"]) == "confirmed"


def test_reset_with_a_stale_revision_conflicts(client: TestClient) -> None:
    fx = Setup(client)

    response = reset(client, fx.bundle.id, revision=999)

    assert (response.status_code, response.json()["detail"]["code"]) == (409, "revision_conflict")
    assert read_status(fx.b["id"]) == "confirmed"


@pytest.mark.parametrize("status", ["queued", "running"])
def test_reset_is_refused_while_an_ai_job_is_active(client: TestClient, status: str) -> None:
    fx = Setup(client)

    async def _add(session) -> None:  # noqa: ANN001
        session.add(AiJob(bundle_id=fx.bundle.id, kind="classify", status=status, requested_by="qa.member"))
        await session.commit()

    run_in_session(_add)

    for dry_run in (False, True):
        response = reset(client, fx.bundle.id, dry_run=dry_run)
        assert (response.status_code, response.json()["detail"]["code"]) == (409, "ai_job_active")
    assert read_status(fx.b["id"]) == "confirmed"


def test_reset_needs_author_and_an_old_document_of_this_bundle(client: TestClient) -> None:
    fx = Setup(client)

    as_reviewer = reset(client, fx.bundle.id, headers=REVIEWER)
    missing = reset(client, fx.bundle.id, document_id=999999)

    assert (as_reviewer.status_code, as_reviewer.json()["detail"]["code"]) == (403, "role_required")
    assert (missing.status_code, missing.json()["detail"]["code"]) == (404, "document_not_found")
