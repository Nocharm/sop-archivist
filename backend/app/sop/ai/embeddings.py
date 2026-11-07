"""임베딩 캐시 — 글을 (모델, 글 해시)로 캐시하고 없는 글만 /embeddings에 보내 단위 벡터로 돌려준다 (설계 §8.4).

임베딩 호출 동안 DB 연결을 잡지 않는다 — 캐시 읽기·쓰기·사용량 기록은 각자 짧은 세션이다.
로그에는 건수와 예외 클래스 이름만 남긴다(글과 서버 응답은 남기지 않는다).
"""

import asyncio
import hashlib
import logging
from collections.abc import Sequence
from typing import Literal

import numpy as np
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.ai_client import call_embeddings
from app.ai_usage import record_ai_usage
from app.db import SessionLocal, engine
from app.settings import settings
from app.sop.ai.constants import AI_CALL_ATTEMPTS, AI_RETRY_DELAYS, EMBED_BATCH_SIZE, MAX_EMBED_CHARS
from app.sop.groups import select_in_chunks
from app.sop.models import EmbeddingCache

logger = logging.getLogger(__name__)

EMBED_USAGE_FEATURE = "sop.embed"  # 사용량 표에서 채팅 호출과 구분하는 기능 이름

UnavailableReason = Literal["disabled", "failed"]


class EmbeddingUnavailable(Exception):
    """임베딩을 쓸 수 없다. reason은 "disabled"(꺼져 있음) 또는 "failed"(호출이 끝내 실패) — 호출부가 검색 상태로 옮긴다."""

    def __init__(self, reason: UnavailableReason) -> None:
        super().__init__(reason)
        self.reason = reason


def _to_unit_vector(values: object) -> np.ndarray:
    """서버가 준 벡터를 길이 1의 float32로 바꾼다. 숫자가 아니거나 비었거나 NaN·영벡터면 ValueError — 캐시에 영영 남으면 안 된다."""
    vector = np.asarray(values, dtype=np.float32)
    if vector.ndim != 1 or vector.size == 0 or not np.isfinite(vector).all():
        raise ValueError("embedding is not a finite vector")
    norm = float(np.linalg.norm(vector))
    if norm == 0.0:
        raise ValueError("embedding is a zero vector")
    return vector / norm


async def _call_with_retries(texts: list[str]) -> tuple[list[np.ndarray], int | None]:
    """/embeddings를 한 번 부르고 벡터를 단위 벡터로 바꾼다. 어떤 예외든 AI_RETRY_DELAYS만큼 쉬며 AI_CALL_ATTEMPTS번까지 다시 해 보고, 끝내 실패하면 마지막 예외를 올린다.

    예외 종류를 가리지 않는 이유: 망가진 응답 본문은 KeyError·IndexError·TypeError·JSON 오류로도 나오고 서버가 잠깐 이상한 값을 줄 수도 있다.
    """
    for attempt in range(AI_CALL_ATTEMPTS):
        try:
            reply = await call_embeddings(texts)
            return [_to_unit_vector(vector) for vector in reply.vectors], reply.prompt_tokens
        except Exception as exc:  # noqa: BLE001 -- 호출 실패는 종류와 상관없이 재시도 뒤 EmbeddingUnavailable로 모인다
            logger.warning(
                "embedding call failed: texts=%d attempt=%d/%d error=%s",
                len(texts),
                attempt + 1,
                AI_CALL_ATTEMPTS,
                type(exc).__name__,
            )
            if attempt == AI_CALL_ATTEMPTS - 1:
                raise
        await asyncio.sleep(AI_RETRY_DELAYS[attempt])


async def _record_embed_usage(*, login_id: str, model: str, prompt_tokens: int | None, ok: bool) -> None:
    await record_ai_usage(
        login_id=login_id,
        feature=EMBED_USAGE_FEATURE,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=None,
        ok=ok,
    )


async def _embed_batch(model: str, login_id: str, texts: list[str]) -> list[np.ndarray]:
    """배치 하나를 부르고 사용량 한 행을 남긴다(재시도는 한 호출로 센다). 끝내 실패하면 실패 행을 남기고 EmbeddingUnavailable("failed")."""
    try:
        vectors, prompt_tokens = await _call_with_retries(texts)
    except Exception as exc:
        try:
            await _record_embed_usage(login_id=login_id, model=model, prompt_tokens=None, ok=False)
        except Exception as record_exc:  # noqa: BLE001 -- 계량 실패가 임베딩 실패 판정을 바꾸지 않는다
            logger.warning("embedding usage event insert failed (failure path): %s", type(record_exc).__name__)
        raise EmbeddingUnavailable("failed") from exc
    # 성공 쪽 기록 실패는 삼키지 않는다 — DB가 죽었는데 계량이 조용히 빠지면 안 된다
    await _record_embed_usage(login_id=login_id, model=model, prompt_tokens=prompt_tokens, ok=True)
    return vectors


async def _load_cached_vectors(model: str, text_hashes: list[str]) -> dict[str, np.ndarray]:
    async with SessionLocal() as session:
        # 글이 많아도 IN 목록이 asyncpg 바인드 상한(32767)을 넘지 않게 IN_CHUNK_SIZE씩 나눠 읽는다
        rows = await select_in_chunks(
            session,
            lambda chunk: select(EmbeddingCache.text_hash, EmbeddingCache.vector).where(
                EmbeddingCache.model == model, EmbeddingCache.text_hash.in_(chunk)
            ),
            text_hashes,
        )
        return {text_hash: np.frombuffer(vector, dtype=np.float32).copy() for text_hash, vector in rows}


async def _store_vectors(model: str, vectors: dict[str, np.ndarray]) -> None:
    """캐시에 넣는다. 같은 글을 동시에 넣는 다른 요청이 먼저 이겨도 충돌 없이 넘어간다(어느 쪽 벡터든 같은 글의 값)."""
    insert = postgresql_insert if engine.dialect.name == "postgresql" else sqlite_insert
    rows = [
        {"model": model, "text_hash": text_hash, "dim": len(vector), "vector": vector.tobytes()}
        for text_hash, vector in vectors.items()
    ]
    async with SessionLocal() as session:
        await session.execute(insert(EmbeddingCache).values(rows).on_conflict_do_nothing())
        await session.commit()


async def embed_texts(texts: Sequence[str], *, login_id: str) -> dict[str, np.ndarray]:
    """글마다 단위 정규화된 float32 벡터를 돌려준다 — 키는 넘긴 글 그대로이고, 캐시에 없는 글만 배치로 임베딩 서버에 보낸다.

    MAX_EMBED_CHARS까지만 잘라 보내고 해시도 자른 글로 만든다(같은 앞부분은 같은 벡터). 배치는 성공할 때마다 캐시에 써서
    뒤 배치가 실패해도 앞 배치는 남는다. 꺼져 있으면 EmbeddingUnavailable("disabled"), 호출이 끝내 실패하면 ("failed").
    """
    if not settings.embed_enabled:
        raise EmbeddingUnavailable("disabled")
    model = settings.embed_model  # 한 호출은 한 모델로 읽고 쓴다
    hash_of: dict[str, str] = {}
    sent_text_of: dict[str, str] = {}
    for text in texts:
        sent_text = text[:MAX_EMBED_CHARS]
        text_hash = hashlib.sha256(sent_text.encode("utf-8")).hexdigest()
        hash_of[text] = text_hash
        sent_text_of.setdefault(text_hash, sent_text)
    if not hash_of:
        return {}

    vectors = await _load_cached_vectors(model, list(sent_text_of))  # 세션은 읽고 바로 닫힌다 — 아래 호출 동안 연결이 없다
    missing = [text_hash for text_hash in sent_text_of if text_hash not in vectors]
    for start in range(0, len(missing), EMBED_BATCH_SIZE):
        batch = missing[start : start + EMBED_BATCH_SIZE]
        fresh = await _embed_batch(model, login_id, [sent_text_of[text_hash] for text_hash in batch])
        added = dict(zip(batch, fresh, strict=True))
        await _store_vectors(model, added)
        vectors.update(added)
    return {text: vectors[text_hash] for text, text_hash in hash_of.items()}
