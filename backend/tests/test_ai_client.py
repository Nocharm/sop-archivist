"""사내 AI 어댑터(app.ai_client) — 엔드포인트 파싱·라우팅, 사고량 페이로드, 빈 content, 동시성 상한, 모델 목록."""

import asyncio
import json

import httpx2
import pytest

from app import ai_client
from app.settings import settings
from tests.ai_helpers import (
    AI_TEST_BASE_URL,
    AI_TEST_TOKEN,
    build_chat_body,
    capture_requests,
    enable_ai,
    install_ai_transport,
    read_payload,
    reply_with,
)

MESSAGES = [{"role": "user", "content": "hi"}]

TWO_ENDPOINTS = json.dumps(
    [
        {
            "name": "a",
            "base_url": "http://a.test/v1",
            "token": "tok-a",
            "model": "m1",
            "models": ["m1", "m1-small"],
        },
        {"name": "b", "base_url": "http://b.test/v1/", "token": "tok-b", "model": "m2"},
    ]
)


# ── 엔드포인트 설정 ─────────────────────────────────────────────────────────────


def test_endpoints_fallback_to_single_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_ai(monkeypatch)

    endpoints = ai_client.get_ai_endpoints()

    assert len(endpoints) == 1
    assert (endpoints[0].name, endpoints[0].base_url) == ("default", AI_TEST_BASE_URL)
    assert (endpoints[0].token, endpoints[0].model) == (AI_TEST_TOKEN, "glm-test")


def test_endpoints_json_parses_and_rejects_bad_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_endpoints", TWO_ENDPOINTS)

    endpoints = ai_client.get_ai_endpoints()

    assert [e.name for e in endpoints] == ["a", "b"]
    assert endpoints[0].models == ("m1", "m1-small")
    assert endpoints[1].models == ()  # 목록을 안 주면 /models 자동 조회 대상
    # 설정 오류는 조용히 넘기지 않는다 — 잘못된 JSON·빈 배열·이름/주소 누락
    for raw, message in (("not-json", "invalid JSON"), ("[]", "non-empty"), (json.dumps([{"name": "x"}]), "base_url")):
        monkeypatch.setattr(settings, "ai_endpoints", raw)
        with pytest.raises(ValueError, match=message):
            ai_client.get_ai_endpoints()


def test_resolve_endpoint_by_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_endpoints", TWO_ENDPOINTS)

    assert ai_client.resolve_endpoint("b::m2-x")[0].name == "b"
    assert ai_client.resolve_endpoint("b::m2-x")[1] == "m2-x"
    # 접두어 없는 구형 저장값 → 첫 엔드포인트, 선택 없음 → 첫 엔드포인트 기본 모델
    assert ai_client.resolve_endpoint("m1-small") == (ai_client.get_ai_endpoints()[0], "m1-small")
    assert ai_client.resolve_endpoint(None)[1] == "m1"
    assert ai_client.resolve_endpoint("b::")[1] == "m2"  # 모델을 비운 접두어 → 그 엔드포인트 기본 모델


# ── call_ai 요청·응답 ──────────────────────────────────────────────────────────


def test_endpoints_json_and_selector(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_endpoints", TWO_ENDPOINTS)
    seen = capture_requests(monkeypatch)

    asyncio.run(ai_client.call_ai(MESSAGES, model="b::m2"))

    [request] = seen
    assert str(request.url) == "http://b.test/v1/chat/completions"  # 끝 슬래시는 정리된다
    assert request.headers["Authorization"] == "Bearer tok-b"
    assert read_payload(request)["model"] == "m2"


def test_payload_low_reasoning(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_ai(monkeypatch)
    seen = capture_requests(monkeypatch)

    asyncio.run(ai_client.call_ai(MESSAGES, reasoning="low", max_tokens=256))

    payload = read_payload(seen[0])
    # GLM-5.3(SGLang)에는 enable_thinking이 없다 — 사고를 줄이는 자리는 low + clear_thinking
    assert payload["chat_template_kwargs"] == {"reasoning_effort": "low", "clear_thinking": True}
    assert payload["max_tokens"] == 256
    assert payload["model"] == "glm-test"
    assert payload["messages"] == MESSAGES
    assert payload["response_format"] == {"type": "json_object"}


def test_payload_high_reasoning(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_ai(monkeypatch)
    seen = capture_requests(monkeypatch)

    asyncio.run(ai_client.call_ai(MESSAGES, reasoning="high"))

    assert read_payload(seen[0])["chat_template_kwargs"] == {"reasoning_effort": "high", "clear_thinking": True}


def test_payload_max_reasoning_omits_kwargs(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_ai(monkeypatch)
    seen = capture_requests(monkeypatch)

    asyncio.run(ai_client.call_ai(MESSAGES))

    payload = read_payload(seen[0])
    assert "chat_template_kwargs" not in payload  # 최대 사고는 파라미터를 통째로 생략한다
    # max_tokens는 상시 포함 — 너무 작으면 사고가 예산을 소진해 빈 응답이 온다
    assert payload["max_tokens"] == settings.ai_max_tokens


def test_null_content_becomes_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_ai(monkeypatch)
    install_ai_transport(monkeypatch, reply_with(None))

    reply = asyncio.run(ai_client.call_ai(MESSAGES))

    assert reply.content == ""  # 사고만 하고 끝난 응답이 호출부에서 None.strip()으로 죽지 않게


def test_reply_carries_usage_or_none(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_ai(monkeypatch)
    install_ai_transport(monkeypatch, reply_with("{}", prompt_tokens=11, completion_tokens=7))
    reply = asyncio.run(ai_client.call_ai(MESSAGES))
    assert (reply.prompt_tokens, reply.completion_tokens) == (11, 7)

    install_ai_transport(monkeypatch, reply_with("{}", prompt_tokens=None, completion_tokens=None))
    bare = asyncio.run(ai_client.call_ai(MESSAGES))
    assert (bare.prompt_tokens, bare.completion_tokens) == (None, None)  # usage를 안 주는 서버


def test_http_error_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_ai(monkeypatch)
    install_ai_transport(monkeypatch, lambda request: httpx2.Response(500))

    with pytest.raises(httpx2.HTTPStatusError):
        asyncio.run(ai_client.call_ai(MESSAGES))


# ── 동시성 ─────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("limit", [1, 2])
def test_concurrency_limit(monkeypatch: pytest.MonkeyPatch, limit: int) -> None:
    # limit=2 쪽은 대조군이다 — 상한이 1로 고정된 게 아니라 설정을 따른다는 것, 그리고 이 측정이 동시 진입을 실제로 센다는 것
    enable_ai(monkeypatch)
    monkeypatch.setattr(settings, "ai_max_concurrency", limit)
    monkeypatch.setattr(ai_client, "_semaphores", {})  # 새 상한으로 세마포어를 다시 만들게 한다

    async def scenario() -> int:
        active = 0
        peak = 0
        release = asyncio.Event()  # 실행 중인 루프 안에서 만든다

        async def handler(request: httpx2.Request) -> httpx2.Response:
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await release.wait()
            active -= 1
            return httpx2.Response(200, json=build_chat_body("{}"))

        install_ai_transport(monkeypatch, handler)
        tasks = [asyncio.create_task(ai_client.call_ai(MESSAGES)) for _ in range(limit + 1)]
        for _ in range(100):  # 상한까지 찰 때까지(최대 1초) 기다린다
            if active == limit:
                break
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.05)  # 상한을 넘겨 들어오려는 호출이 있다면 들어올 시간을 준다
        release.set()
        await asyncio.gather(*tasks)
        return peak

    assert asyncio.run(scenario()) == limit


# ── 모델 목록 ──────────────────────────────────────────────────────────────────


def _build_models_handler(seen_urls: list[str]):
    def handler(request: httpx2.Request) -> httpx2.Response:
        seen_urls.append(str(request.url))
        return httpx2.Response(200, json={"data": [{"id": "remote-a"}, {"id": "remote-b"}]})

    return handler


def test_list_models_prefers_env_list_and_discovers_the_rest(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_endpoints", TWO_ENDPOINTS)
    urls: list[str] = []
    install_ai_transport(monkeypatch, _build_models_handler(urls))

    models = asyncio.run(ai_client.list_models())

    # a는 .env 목록 그대로(조회 생략), b는 /models 자동 조회 — 다중 엔드포인트라 "이름::모델" id
    assert models == ["a::m1", "a::m1-small", "b::remote-a", "b::remote-b"]
    assert urls == ["http://b.test/v1/models"]


def test_list_models_single_endpoint_keeps_bare_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        settings, "ai_endpoints", json.dumps([{"name": "a", "base_url": "http://a.test/v1", "models": ["m1"]}])
    )

    assert asyncio.run(ai_client.list_models()) == ["m1"]  # 단일이면 모델명 그대로


def test_list_models_discovery_failure_falls_back_to_default_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_endpoints", TWO_ENDPOINTS)

    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("down")

    install_ai_transport(monkeypatch, handler)

    # b의 조회가 실패해도 기본 모델로 폴백하고, a는 영향이 없다
    assert asyncio.run(ai_client.list_models()) == ["a::m1", "a::m1-small", "b::m2"]
