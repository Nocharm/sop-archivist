"""임베딩 캐시(app.sop.ai.embeddings) — 없는 글만 호출·배치 크기·자르기·사용량·실패 처리·동시 쓰기·DB 연결 비점유."""

import asyncio
import hashlib
import logging
import math
from collections.abc import Callable, Sequence

import httpx2
import numpy as np
import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine
from app.models import AiUsageEvent
from app.settings import settings
from app.sop import groups
from app.sop.ai import embeddings
from app.sop.ai.constants import AI_CALL_ATTEMPTS, AI_RETRY_DELAYS, EMBED_BATCH_SIZE, MAX_EMBED_CHARS
from app.sop.ai.embeddings import EmbeddingUnavailable, embed_texts
from app.sop.models import EmbeddingCache
from tests.access_helpers import run_in_session
from tests.ai_fixtures import clean_embedding_cache  # noqa: F401 -- 픽스처는 아래 usefixtures가 이름으로 찾는다
from tests.ai_helpers import (
    AI_TEST_TOKEN,
    build_embed_body,
    enable_embed,
    install_ai_transport,
    install_embed_transport,
    read_payload,
    vector_for,
)

pytestmark = pytest.mark.usefixtures("clean_embedding_cache", "clean_ai_usage")

SENTINEL = "SENTINEL-TEXT"
EMBED_USAGE_FEATURE = "sop.embed"
UNIT_NORM_TOLERANCE = 1e-6
# 멈춤(교착)을 잡는 상한일 뿐 시간을 재는 단언이 아니다 — 느린 GitLab CI 러너에서도 정상 경로가 넘지 않게 넉넉히 둔다
HANG_GUARD_SECONDS = 30

Handler = Callable[[httpx2.Request], httpx2.Response]


@pytest.fixture(autouse=True)
def embed_on(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_embed(monkeypatch)


@pytest.fixture(autouse=True)
def sleeps(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """재시도 대기를 기록만 하고 건너뛴다 — 시험이 1초·3초를 실제로 기다리지 않게."""
    delays: list[float] = []
    real_sleep = asyncio.sleep

    async def fake_sleep(delay: float) -> None:
        delays.append(delay)
        await real_sleep(0)

    monkeypatch.setattr(embeddings.asyncio, "sleep", fake_sleep)
    return delays


def _embed(texts: Sequence[str], login_id: str = "ops.member") -> dict[str, np.ndarray]:
    return asyncio.run(embed_texts(texts, login_id=login_id))


def _list_usage() -> list[AiUsageEvent]:
    async def _list(session: AsyncSession) -> list[AiUsageEvent]:
        return list(await session.scalars(select(AiUsageEvent).order_by(AiUsageEvent.id)))

    return run_in_session(_list)


def _list_cache_rows() -> list[EmbeddingCache]:
    async def _list(session: AsyncSession) -> list[EmbeddingCache]:
        return list(await session.scalars(select(EmbeddingCache).order_by(EmbeddingCache.text_hash)))

    return run_in_session(_list)


def _unit(values: list[float]) -> np.ndarray:
    vector = np.asarray(values, dtype=np.float32)
    return vector / np.linalg.norm(vector)


def test_embed_texts_returns_unit_float32_vectors_keyed_by_the_given_text(monkeypatch: pytest.MonkeyPatch) -> None:
    install_embed_transport(monkeypatch)

    result = _embed(["a", "b", "a"])

    assert list(result) == ["a", "b"]
    for text, vector in result.items():
        assert vector.dtype == np.float32
        assert np.linalg.norm(vector) == pytest.approx(1.0, abs=UNIT_NORM_TOLERANCE)
        np.testing.assert_allclose(vector, _unit(vector_for(text)), rtol=UNIT_NORM_TOLERANCE)


def test_embed_texts_calls_only_for_missing_texts(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = install_embed_transport(monkeypatch)

    first = _embed(["a", "b"])
    second = _embed(["a", "c"])
    third = _embed(["a", "b", "c"])

    assert calls == [["a", "b"], ["c"]]  # 셋째는 전부 캐시라 호출이 없다
    # 캐시에서 읽은 벡터는 처음 받은 값 그대로이고 같은 꼴이다
    np.testing.assert_array_equal(second["a"], first["a"])
    np.testing.assert_array_equal(third["b"], first["b"])
    assert third["c"].dtype == np.float32
    assert np.linalg.norm(third["a"]) == pytest.approx(1.0, abs=UNIT_NORM_TOLERANCE)


def test_embed_texts_with_no_texts_makes_no_call(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = install_embed_transport(monkeypatch)

    assert _embed([]) == {}
    assert calls == [] and _list_usage() == []


def test_embed_texts_batches_by_size(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = install_embed_transport(monkeypatch)
    texts = [f"text-{index}" for index in range(EMBED_BATCH_SIZE + 1)]

    result = _embed(texts)

    assert [len(batch) for batch in calls] == [EMBED_BATCH_SIZE, 1]  # 65개 → 2번
    assert calls[0] == texts[:EMBED_BATCH_SIZE] and calls[1] == texts[EMBED_BATCH_SIZE:]
    assert list(result) == texts


def test_embed_texts_reads_the_cache_in_chunks(monkeypatch: pytest.MonkeyPatch) -> None:
    chunk_size = 3
    real_iter_chunks = groups.iter_chunks
    # select_in_chunks가 기본 크기로 부르는 iter_chunks를 작은 크기로 바꿔, 글 수가 한 조각을 넘는 상황을 만든다
    monkeypatch.setattr(groups, "iter_chunks", lambda ids, size=chunk_size: real_iter_chunks(ids, size))
    calls = install_embed_transport(monkeypatch)
    cached_texts = [f"cached-{index}" for index in range(8)]
    new_texts = ["new-0", "new-1"]
    first = _embed(cached_texts)

    selects: list[str] = []

    def count_cache_selects(conn: object, cursor: object, statement: str, *args: object) -> None:
        if statement.lstrip().upper().startswith("SELECT") and "embedding_cache" in statement:
            selects.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", count_cache_selects)
    try:
        second = _embed(cached_texts + new_texts)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count_cache_selects)

    assert len(selects) == math.ceil(len(cached_texts + new_texts) / chunk_size)  # 읽기가 조각마다 한 번
    assert calls == [cached_texts, new_texts]  # 조각 사이에 합친 결과로도 없는 글만 보낸다
    assert list(second) == cached_texts + new_texts
    for text in cached_texts:
        np.testing.assert_array_equal(second[text], first[text])


def test_embed_texts_truncates_long_text_before_hashing(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = install_embed_transport(monkeypatch)
    head = "x" * MAX_EMBED_CHARS
    text_a, text_b = head + "A-tail", head + "B-tail"

    first = _embed([text_a])
    second = _embed([text_b])

    # 보내는 글은 상한까지만이고, 상한 뒤만 다른 두 글은 같은 캐시 행을 쓴다
    assert calls == [[head]]
    assert list(first) == [text_a] and list(second) == [text_b]  # 키는 넘긴 글 그대로
    np.testing.assert_array_equal(first[text_a], second[text_b])
    [row] = _list_cache_rows()
    assert row.text_hash == hashlib.sha256(head.encode("utf-8")).hexdigest()


def test_cache_row_holds_hash_dim_and_vector_but_not_the_text(monkeypatch: pytest.MonkeyPatch) -> None:
    install_embed_transport(monkeypatch)

    result = _embed(["a"])

    [row] = _list_cache_rows()
    assert row.model == "embed-test"
    assert row.text_hash == hashlib.sha256(b"a").hexdigest()
    assert row.dim == len(vector_for("a")) == len(row.vector) // 4
    assert row.vector == result["a"].tobytes()
    assert row.created_at is not None


def test_cache_is_keyed_by_model(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = install_embed_transport(monkeypatch)

    _embed(["a"])
    monkeypatch.setattr(settings, "embed_model", "embed-other")
    _embed(["a"])

    assert calls == [["a"], ["a"]]
    rows = _list_cache_rows()
    assert len(rows) == 2 and {row.model for row in rows} == {"embed-test", "embed-other"}


def test_embed_texts_records_usage_with_feature_embed(monkeypatch: pytest.MonkeyPatch) -> None:
    install_embed_transport(monkeypatch)

    _embed([f"text-{index}" for index in range(EMBED_BATCH_SIZE + 1)], login_id="ops.member")

    events = _list_usage()
    assert len(events) == 2  # 호출 한 번(배치 하나)에 한 행
    assert {(event.login_id, event.feature, event.model, event.ok) for event in events} == {
        ("ops.member", EMBED_USAGE_FEATURE, "embed-test", True)
    }
    assert [(event.prompt_tokens, event.completion_tokens) for event in events] == [(5, None), (5, None)]


def test_cached_texts_record_no_usage(monkeypatch: pytest.MonkeyPatch) -> None:
    install_embed_transport(monkeypatch)
    _embed(["a"])

    _embed(["a"])

    assert len(_list_usage()) == 1


def test_embed_texts_when_disabled_raises_without_calling(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = install_embed_transport(monkeypatch)
    monkeypatch.setattr(settings, "embed_enabled", False)

    with pytest.raises(EmbeddingUnavailable) as raised:
        _embed(["a"])
    with pytest.raises(EmbeddingUnavailable) as raised_empty:
        _embed([])

    assert raised.value.reason == "disabled" and raised_empty.value.reason == "disabled"
    assert calls == [] and _list_usage() == [] and _list_cache_rows() == []


def test_embed_failure_raises_unavailable_without_text_in_logs(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, sleeps: list[float]
) -> None:
    requests: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(500, json={"detail": f"echo {SENTINEL}"})

    install_ai_transport(monkeypatch, handler)

    with caplog.at_level(logging.DEBUG):
        with pytest.raises(EmbeddingUnavailable) as raised:
            _embed([SENTINEL])

    assert raised.value.reason == "failed"
    assert len(requests) == AI_CALL_ATTEMPTS and sleeps == list(AI_RETRY_DELAYS)
    assert "HTTPStatusError" in caplog.text  # 예외 클래스 이름만 남는다
    assert SENTINEL not in caplog.text and AI_TEST_TOKEN not in caplog.text
    assert all(record.exc_info is None for record in caplog.records)
    assert _list_cache_rows() == []
    [event] = _list_usage()  # 재시도 끝에 실패한 호출 하나가 실패 행 하나
    assert (event.feature, event.ok, event.prompt_tokens, event.completion_tokens) == (EMBED_USAGE_FEATURE, False, None, None)


@pytest.mark.parametrize("status", [400, 401, 404, 408, 429])
def test_embed_client_error_fails_without_retrying(
    monkeypatch: pytest.MonkeyPatch, sleeps: list[float], status: int
) -> None:
    requests: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(status)

    install_ai_transport(monkeypatch, handler)

    with pytest.raises(EmbeddingUnavailable) as raised:
        _embed(["a"])

    assert raised.value.reason == "failed"
    assert len(requests) == 1 and sleeps == []
    [event] = _list_usage()
    assert event.ok is False


def _raise_timeout(request: httpx2.Request) -> httpx2.Response:
    raise httpx2.ReadTimeout("timed out", request=request)


@pytest.mark.parametrize(
    "reply",
    [
        pytest.param(lambda request: httpx2.Response(500), id="server-error"),
        pytest.param(lambda request: httpx2.Response(200, content=b"<html>not json</html>"), id="broken-body"),
        pytest.param(_raise_timeout, id="timeout"),
    ],
)
def test_embed_server_side_failure_uses_every_attempt(
    monkeypatch: pytest.MonkeyPatch, sleeps: list[float], reply: Handler
) -> None:
    requests: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return reply(request)

    install_ai_transport(monkeypatch, handler)

    with pytest.raises(EmbeddingUnavailable):
        _embed(["a"])

    assert len(requests) == AI_CALL_ATTEMPTS and sleeps == list(AI_RETRY_DELAYS)


def _raise_connect_error(request: httpx2.Request) -> httpx2.Response:
    raise httpx2.ConnectError("connection refused", request=request)


@pytest.mark.parametrize(
    "handler",
    [
        pytest.param(_raise_connect_error, id="connect-error"),
        pytest.param(lambda request: httpx2.Response(200, content=b"<html>not json</html>"), id="not-json"),
        pytest.param(lambda request: httpx2.Response(200, json={"unexpected": 1}), id="no-data-key"),
        pytest.param(lambda request: httpx2.Response(200, json={"data": "oops"}), id="data-not-a-list"),
        pytest.param(lambda request: httpx2.Response(200, json={"data": []}), id="count-mismatch"),
        pytest.param(lambda request: httpx2.Response(200, json={"data": [{"embedding": [1.0]}]}), id="item-without-index"),
        pytest.param(lambda request: httpx2.Response(200, json={"data": [{"index": 0}]}), id="item-without-embedding"),
        pytest.param(
            lambda request: httpx2.Response(200, json={"data": [{"index": 0, "embedding": None}]}), id="embedding-null"
        ),
        pytest.param(
            lambda request: httpx2.Response(200, json={"data": [{"index": 0, "embedding": []}]}), id="embedding-empty"
        ),
        pytest.param(
            lambda request: httpx2.Response(200, json={"data": [{"index": 0, "embedding": ["x", "y"]}]}),
            id="embedding-not-numbers",
        ),
        pytest.param(
            lambda request: httpx2.Response(200, json={"data": [{"index": 0, "embedding": [0.0, 0.0]}]}),
            id="embedding-all-zero",
        ),
        pytest.param(
            lambda request: httpx2.Response(200, content=b'{"data": [{"index": 0, "embedding": [NaN, 1.0]}]}'),
            id="embedding-nan",
        ),
    ],
)
def test_every_kind_of_call_failure_ends_as_unavailable_failed(monkeypatch: pytest.MonkeyPatch, handler: Handler) -> None:
    install_ai_transport(monkeypatch, handler)

    with pytest.raises(EmbeddingUnavailable) as raised:
        _embed(["a"])

    assert raised.value.reason == "failed"
    assert _list_cache_rows() == []  # 망가진 벡터는 캐시에 남지 않는다


def test_embed_texts_retries_a_transient_failure(monkeypatch: pytest.MonkeyPatch, sleeps: list[float]) -> None:
    requests: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        if len(requests) == 1:
            return httpx2.Response(503)
        return httpx2.Response(200, json=build_embed_body([vector_for("a")]))

    install_ai_transport(monkeypatch, handler)

    result = _embed(["a"])

    assert list(result) == ["a"] and len(requests) == 2
    assert sleeps == [AI_RETRY_DELAYS[0]]
    [event] = _list_usage()  # 재시도해도 논리 호출은 하나라 성공 행 하나
    assert event.ok is True
    assert len(_list_cache_rows()) == 1


def test_a_failed_batch_keeps_the_batches_cached_before_it(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        inputs = read_payload(request)["input"]
        if len(inputs) == 1:  # 둘째 배치(1개)만 실패시킨다
            return httpx2.Response(500)
        return httpx2.Response(200, json=build_embed_body([vector_for(text) for text in inputs]))

    install_ai_transport(monkeypatch, handler)
    texts = [f"text-{index}" for index in range(EMBED_BATCH_SIZE + 1)]

    with pytest.raises(EmbeddingUnavailable):
        _embed(texts)

    # 첫 배치는 캐시에 남아, 다시 불러도 실패한 한 글만 다시 보낸다
    assert len(_list_cache_rows()) == EMBED_BATCH_SIZE
    calls = install_embed_transport(monkeypatch)
    _embed(texts)
    assert calls == [[texts[-1]]]


def test_concurrent_inserts_of_the_same_text_do_not_conflict(monkeypatch: pytest.MonkeyPatch) -> None:
    # 세마포어가 호출 하나만 들여보내면 아래 합류 지점에서 서로를 기다리므로 둘이 들어올 자리를 보장한다
    monkeypatch.setattr(settings, "ai_max_concurrency", 2)

    async def scenario() -> tuple[int, list[dict[str, np.ndarray]]]:
        both_reached_the_server = asyncio.Barrier(2)
        calls = 0

        async def handler(request: httpx2.Request) -> httpx2.Response:
            nonlocal calls
            calls += 1
            inputs = read_payload(request)["input"]
            await both_reached_the_server.wait()  # 둘 다 캐시가 비었다고 본 뒤에야 쓰기로 넘어간다
            return httpx2.Response(200, json=build_embed_body([vector_for(text) for text in inputs]))

        install_ai_transport(monkeypatch, handler)
        results = await asyncio.wait_for(
            asyncio.gather(embed_texts(["same"], login_id="ops.a"), embed_texts(["same"], login_id="ops.b")), timeout=HANG_GUARD_SECONDS
        )
        return calls, list(results)

    calls, [first, second] = asyncio.run(scenario())

    assert calls == 2  # 둘 다 호출했다 = 같은 행을 동시에 넣으려 했다
    np.testing.assert_array_equal(first["same"], second["same"])
    assert len(_list_cache_rows()) == 1
    assert len(_list_usage()) == 2


def test_no_db_connection_during_the_embedding_call(monkeypatch: pytest.MonkeyPatch) -> None:
    checked_out: list[int] = []
    requests = 0

    def handler(request: httpx2.Request) -> httpx2.Response:
        nonlocal requests
        requests += 1
        checked_out.append(engine.pool.checkedout())
        if requests == 1:  # 재시도 사이에도 연결을 잡지 않는지 본다
            return httpx2.Response(503)
        inputs = read_payload(request)["input"]
        return httpx2.Response(200, json=build_embed_body([vector_for(text) for text in inputs]))

    install_ai_transport(monkeypatch, handler)

    _embed([f"text-{index}" for index in range(EMBED_BATCH_SIZE + 1)])

    assert checked_out == [0, 0, 0]
