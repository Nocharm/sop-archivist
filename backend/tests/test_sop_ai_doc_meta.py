"""AI 문서 정보 제안 — 규칙이 비운 문서 번호·버전만 묻고, 값은 제안으로만 남기며(문서에 쓰지 않는다) 사람이 저장하면 채택을 남긴다."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import AiJob, AiSuggestion
from tests.access_helpers import run_in_session
from tests.ai_fixtures import clean_ai_jobs, run_jobs  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
from tests.docx_factory import build_docx, p
from tests.fake_ai import FakeAi, install_fake_ai
from tests.sop_helpers import AUTHOR, create_bundle, upload

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs")


@pytest.fixture
def fake_ai(monkeypatch: pytest.MonkeyPatch) -> FakeAi:
    """이 파일만 업로드 때 쌓이는 문서 정보 작업을 켠다(공용 fake_ai는 끈다)."""
    return install_fake_ai(monkeypatch, chat=lambda data: "{}", doc_meta=True)

PLAIN_BODY = p("QC 원심분리기 운전") + p("보호 장갑을 착용한다.") + p("Wear protective gloves.")
PLAIN_NAME = "SYNTHETIC_Centrifuge_Operation.docx"


def _list_documents(client: TestClient, bundle_id: int) -> list[dict]:
    response = client.get(f"/api/bundles/{bundle_id}/documents", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _load_doc_meta_rows() -> tuple[list[AiJob], list[AiSuggestion]]:
    async def _load(session: AsyncSession) -> tuple[list[AiJob], list[AiSuggestion]]:
        jobs = list(await session.scalars(select(AiJob).where(AiJob.kind == "doc_meta")))
        suggestions = list(await session.scalars(select(AiSuggestion).where(AiSuggestion.kind == "doc_meta")))
        return jobs, suggestions

    return run_in_session(_load)


def _upload_plain(client: TestClient) -> tuple[int, dict]:
    bundle_id = create_bundle(client)["id"]
    response = upload(client, bundle_id, build_docx(PLAIN_BODY), PLAIN_NAME)
    assert response.status_code == 201, response.text
    return bundle_id, response.json()


def test_suggests_missing_fields_without_writing_them(client: TestClient, fake_ai: FakeAi) -> None:
    fake_ai.chat = lambda data: json.dumps({"doc_code": "SOP-QC-2207", "version": "2.0"})
    bundle_id, uploaded = _upload_plain(client)

    run_jobs()
    listed = _list_documents(client, bundle_id)[0]

    assert (listed["doc_code"], listed["doc_version"]) == ("", "")
    assert listed["ai_meta"]["doc_code"] == "SOP-QC-2207"
    assert listed["ai_meta"]["doc_version"] == "2.0"
    jobs, suggestions = _load_doc_meta_rows()
    assert [job.status for job in jobs] == ["done"]
    assert [(suggestion.document_id, suggestion.result) for suggestion in suggestions] == [(uploaded["id"], "applied")]


def test_asks_nothing_when_ai_is_off(client: TestClient) -> None:
    _upload_plain(client)

    jobs, _ = _load_doc_meta_rows()

    assert jobs == []


def test_asks_nothing_when_the_rules_filled_both(client: TestClient, fake_ai: FakeAi) -> None:
    bundle_id = create_bundle(client)["id"]
    upload(client, bundle_id, build_docx(p("Doc No.: SOP-QC-2207") + p("Version 2.1") + p("Wear gloves.")), PLAIN_NAME)

    jobs, _ = _load_doc_meta_rows()

    assert jobs == []


def test_drops_a_field_the_person_filled_meanwhile(client: TestClient, fake_ai: FakeAi) -> None:
    fake_ai.chat = lambda data: json.dumps({"doc_code": "SOP-QC-2207", "version": "2.0"})
    bundle_id, uploaded = _upload_plain(client)
    patched = client.patch(
        f"/api/bundles/{bundle_id}/documents/{uploaded['id']}", json={"revision": uploaded["revision"], "doc_code": "SOP-MANUAL-1"}, headers=AUTHOR
    )
    assert patched.status_code == 200, patched.text

    run_jobs()
    listed = _list_documents(client, bundle_id)[0]

    assert listed["doc_code"] == "SOP-MANUAL-1"
    assert listed["ai_meta"]["doc_code"] is None
    assert listed["ai_meta"]["doc_version"] == "2.0"


def test_rejects_values_outside_the_format(client: TestClient, fake_ai: FakeAi) -> None:
    fake_ai.chat = lambda data: json.dumps({"doc_code": "hello world", "version": "v two"})
    bundle_id, _ = _upload_plain(client)

    run_jobs()

    assert _list_documents(client, bundle_id)[0]["ai_meta"] is None
    _, suggestions = _load_doc_meta_rows()
    assert [suggestion.result for suggestion in suggestions] == ["invalid"]


def test_saving_the_suggested_value_records_adoption(client: TestClient, fake_ai: FakeAi) -> None:
    fake_ai.chat = lambda data: json.dumps({"doc_code": "SOP-QC-2207", "version": "2.0"})
    bundle_id, uploaded = _upload_plain(client)
    run_jobs()

    saved = client.patch(
        f"/api/bundles/{bundle_id}/documents/{uploaded['id']}", json={"revision": uploaded["revision"], "doc_code": "SOP-QC-2207"}, headers=AUTHOR
    )

    assert saved.status_code == 200, saved.text
    assert saved.json()["ai_meta"]["doc_code"] is None  # 채운 칸은 더 제안하지 않는다
    _, suggestions = _load_doc_meta_rows()
    assert [(suggestion.adoption, suggestion.adopted_by) for suggestion in suggestions] == [("as_is", "qa.member")]
