"""AI 테스트 공유 픽스처 — 작업을 끝까지 돌리기·AI용 합성 묶음 만들기·작업 큐 비우기 (태스크마다 이어서 더한다)."""

import asyncio
from collections.abc import Iterator
from typing import NamedTuple

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db import SessionLocal
from app.sop.ai.runner import run_jobs_until_idle
from app.sop.models import AiJob, EmbeddingCache
from tests.docx_factory import build_docx, p
from tests.sop_helpers import create_bundle, put_tobe, set_members, upload

AI_OLD_NAME = "SYNTHETIC_OLD-AI.docx"
AI_MEMBERS = [("qa.member", "author"), ("qa.lead", "reviewer")]
AI_SOP_DOC = {"code": "SOP-AI", "title": "Synthetic AI SOP", "doc_type": "sop", "parent_code": None}
AI_WI_DOC = {"code": "WI-AI", "title": "Synthetic AI WI", "doc_type": "wi", "parent_code": "SOP-AI"}
AI_KO_1 = "합성 장비의 전원을 켠다."
AI_EN_1 = "Turn on the synthetic instrument."
AI_KO_2 = "합성 시료를 장비에 넣는다."
AI_EN_2 = "Load the synthetic sample into the instrument."


class AiBundle(NamedTuple):
    id: int
    document_id: int
    sop_id: int
    wi_id: int


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
