"""AI 테스트 공유 픽스처 — 작업을 끝까지 돌리기·AI용 합성 묶음 만들기·작업 큐 비우기·분류 응답과 요청·행 읽기 (태스크마다 이어서 더한다)."""

import asyncio
import json
from collections.abc import Iterator, Sequence
from typing import Any, NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.sop.ai.runner import run_jobs_until_idle
from app.sop.models import AiJob, AiSuggestion, EmbeddingCache, TargetSentence, UnitDecision
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p
from tests.fake_ai import FakeAi
from tests.sop_helpers import (
    AUTHOR,
    create_bundle,
    find_unit,
    get_group_by_unit,
    get_view,
    put_tobe,
    set_members,
    upload,
)

AI_OLD_NAME = "SYNTHETIC_OLD-AI.docx"
AI_NEW_NAME = "SYNTHETIC_SOP-M_New.docx"
AI_MEMBERS = [("qa.member", "author"), ("qa.lead", "reviewer")]
AI_SOP_DOC = {"code": "SOP-AI", "title": "Synthetic AI SOP", "doc_type": "sop", "parent_code": None}
AI_WI_DOC = {"code": "WI-AI", "title": "Synthetic AI WI", "doc_type": "wi", "parent_code": "SOP-AI"}
AI_KO_1 = "합성 장비의 전원을 켠다."
AI_EN_1 = "Turn on the synthetic instrument."
AI_KO_2 = "합성 시료를 장비에 넣는다."
AI_EN_2 = "Load the synthetic sample into the instrument."
REWRITES = {"ko": "합성 장비의 전원을 켜야 한다.", "en": "The synthetic instrument shall be turned on."}
REWRITE = REWRITES["ko"]
TEXT_KINDS = ("sentence", "heading", "cell_sentence")
SECOND_FILE = "SYNTHETIC_OLD-TABLE.docx"


class AiBundle(NamedTuple):
    id: int
    document_id: int
    sop_id: int
    wi_id: int


class MatchBundle(NamedTuple):
    id: int
    old_document_id: int
    new_document_id: int
    target_doc_id: int
    sop_id: int | None


def run_jobs() -> None:
    """쌓인 작업을 끝까지 돌린다 — 테스트에는 워커가 없어(AI_ENABLED=false) 이 호출이 큐를 결정적으로 비운다."""
    asyncio.run(run_jobs_until_idle())


def make_ai_bundle(client: TestClient) -> AiBundle:
    """멤버(작성자·검토자), assign SOP·WI, 한/영 문장이 연달아 나오는 옛 문서 하나를 갖춘 묶음."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    assert set_members(client, bundle_id, AI_MEMBERS).status_code == 200
    response = put_tobe(client, bundle_id, [AI_SOP_DOC, AI_WI_DOC])
    assert response.status_code == 200, response.text
    ids = {doc["code"]: doc["id"] for doc in response.json()["docs"]}
    uploaded = upload(client, bundle_id, build_docx(p(AI_KO_1) + p(AI_EN_1) + p(AI_KO_2) + p(AI_EN_2)), AI_OLD_NAME)
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text
    return AiBundle(bundle_id, uploaded.json()["id"], ids[AI_SOP_DOC["code"]], ids[AI_WI_DOC["code"]])


def make_match_bundle(
    client: TestClient, old_body: str, new_body: str, *, has_assign: bool = False, **docx: Any
) -> MatchBundle:
    """옛 문서 하나와 입구 2 새 문서 하나를 갖춘 묶음 — has_assign이면 입구 1 SOP도 둔다. docx는 두 파일에 함께 간다(그림 미디어)."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    assert set_members(client, bundle_id, AI_MEMBERS).status_code == 200
    sop_id = None
    if has_assign:
        response = put_tobe(client, bundle_id, [AI_SOP_DOC])
        assert response.status_code == 200, response.text
        sop_id = response.json()["docs"][0]["id"]
    old_doc = upload(client, bundle_id, build_docx(old_body, **docx), AI_OLD_NAME)
    assert old_doc.status_code == 201 and old_doc.json()["status"] == "ready", old_doc.text
    # 머리말은 새 문장을 만들지 않으니 같은 본문이어도 파일 내용만 다르게 한다(같은 파일은 duplicate_file)
    data = build_docx(new_body, headers=[p("합성 새 문서")], **docx)
    new_doc = upload(client, bundle_id, data, AI_NEW_NAME, side="new", doc_type="sop")
    assert new_doc.status_code == 201 and new_doc.json()["status"] == "ready", new_doc.text
    return MatchBundle(bundle_id, old_doc.json()["id"], new_doc.json()["id"], new_doc.json()["target_doc_id"], sop_id)


def build_reply(data: dict, **changes: object) -> str:
    """data에 맞는 유효한 응답 — 첫 칸 후보를 고르고 들어온 언어마다 고쳐 쓴 문장을 낸다. changes가 칸을 덮는다."""
    unit = data["units"][0]
    langs = {member["lang"] for member in data["units"] if member["kind"] in TEXT_KINDS}
    reply = {
        "candidate": data["candidates"][0]["key"],
        "reason": "합성 이유.",
        "rule_ids": ["R01"],
        "evidence": [{"unit_id": unit["id"], "quote": unit["text"]}] if unit["text"] else [],
        "change_type": "tone" if langs else "as_is",
        "rewrites": {lang: [REWRITES[lang]] for lang in langs},
    }
    return json.dumps({**reply, **changes}, ensure_ascii=False)


def use_reply(ai: FakeAi, **changes: object) -> None:
    ai.chat = lambda data: build_reply(data, **changes)


def request_classify(
    client: TestClient, bundle_id: int, *, headers: dict[str, str] = AUTHOR, **scope: object
) -> httpx2.Response:
    return client.post(f"/api/bundles/{bundle_id}/ai/classify", json=scope, headers=headers)


def queue_units(client: TestClient, bundle_id: int, unit_ids: Sequence[int]) -> None:
    response = request_classify(client, bundle_id, unit_ids=list(unit_ids))
    assert response.status_code == 200, response.text
    assert response.json()["skipped_total"] == 0, response.text


def find_ids(client: TestClient, bundle: AiBundle, *texts: str) -> list[int]:
    view = get_view(client, bundle.id, bundle.document_id)
    return [find_unit(view, text)["id"] for text in texts]


def read_rows(model: type[Any]) -> list[Any]:
    async def _read(session: AsyncSession) -> list[Any]:
        return list(await session.scalars(select(model).order_by(*model.__table__.primary_key.columns)))

    return run_in_session(_read)


def read_decision(unit_id: int) -> UnitDecision:
    return run_in_session(lambda session: session.get(UnitDecision, unit_id))


def get_target(client: TestClient, bundle_id: int, unit_id: int) -> dict:
    (target,) = get_group_by_unit(client, bundle_id, unit_id)["targets"]
    return target


def upload_second_document(client: TestClient, bundle_id: int, body: str, **options: Any) -> dict:
    response = upload(client, bundle_id, build_docx(body, **options), SECOND_FILE)
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    return get_view(client, bundle_id, response.json()["id"])


def find_kind(view: dict, kind: str) -> dict:
    return next(unit for unit in view["units"] if unit["kind"] == kind)


def edit_document(client: TestClient, bundle_id: int, document_id: int, op: dict, *, confirm: bool = False) -> None:
    revision = get_view(client, bundle_id, document_id)["document"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/documents/{document_id}/edits",
        json={"revision": revision, "confirm": confirm, "op": op}, headers=AUTHOR,
    )
    assert response.status_code == 200, response.text


async def _add_match_suggestion(session: AsyncSession, bundle_id: int) -> AiSuggestion:
    job = AiJob(bundle_id=bundle_id, kind="match", status="done", requested_by="qa.member")
    session.add(job)
    await session.flush()
    suggestion = AiSuggestion(job_id=job.id, bundle_id=bundle_id, kind="match", content={}, result="applied")
    session.add(suggestion)
    await session.flush()
    return suggestion


def attach_match_suggestion(bundle_id: int, unit_id: int) -> int:
    """입구 2 제안이 그 단위를 채운 모습 — 다른 종류 제안 위에 분류가 쓰면 안 되는지를 보려고 DB에 직접 둔다."""

    async def _attach(session: AsyncSession) -> int:
        suggestion = await _add_match_suggestion(session, bundle_id)
        decision = await session.get(UnitDecision, unit_id)
        decision.status, decision.disposition, decision.suggestion_id = "ai_suggested", "assigned", suggestion.id
        decision.revision += 1
        await session.commit()
        return suggestion.id

    return run_in_session(_attach)


def attach_new_target_suggestion(bundle_id: int, target_doc_id: int) -> int:
    """입구 2 새 문장 하나를 신규 제안 상태로 두고 그 id를 돌려준다 — 그 제안을 만드는 작업은 아직 없어 DB에 직접 둔다."""

    async def _attach(session: AsyncSession) -> int:
        suggestion = await _add_match_suggestion(session, bundle_id)
        target = await session.scalar(select(TargetSentence).where(TargetSentence.target_doc_id == target_doc_id))
        target.status, target.suggestion_id, target.change_type = "ai_suggested", suggestion.id, "new"
        target.revision += 1
        await session.commit()
        return target.id

    return run_in_session(_attach)


def _clear_ai_jobs() -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            await session.execute(delete(AiJob))
            await session.commit()

    asyncio.run(_run())


@pytest.fixture
def clean_ai_jobs(client: TestClient) -> Iterator[None]:
    """AI 작업을 비운 채로 시작하고 끝낸다 — 세션이 DB 하나를 공유해 남은 queued 작업이 다음 시험의 run_jobs()로 새지 않게."""
    _clear_ai_jobs()
    yield
    _clear_ai_jobs()


def _clear_embedding_cache() -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            await session.execute(delete(EmbeddingCache))
            await session.commit()

    asyncio.run(_run())


@pytest.fixture
def clean_embedding_cache(client: TestClient) -> Iterator[None]:
    """임베딩 캐시를 비운 채로 시작하고 끝낸다 — 세션이 DB 하나를 공유해 다른 시험이 캐시한 글이 호출 횟수 검사에 새지 않게."""
    _clear_embedding_cache()
    yield
    _clear_embedding_cache()
