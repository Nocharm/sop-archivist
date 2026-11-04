"""AI 테스트 공유 헬퍼 — httpx2 전송 모의(MockTransport)·응답 빌더·설정 위장 (test_ai_client/test_ai_admin 공용)."""

import json
from collections.abc import Awaitable, Callable

import httpx2
import pytest

from app import ai_client
from app.settings import settings

# 실주소가 아닌 예약 TLD — 오류 응답·로그에 새면 안 되는 값이라 누출 검사의 전제가 된다
AI_TEST_BASE_URL = "http://ai.test/v1"
AI_TEST_TOKEN = "tok-secret-123"

Handler = Callable[[httpx2.Request], httpx2.Response | Awaitable[httpx2.Response]]

# 패치되기 전의 실제 클라이언트 — import 시점에 잡아 둬서, 한 테스트에서 전송을 다시 설치해도 겹겹이 감싸지 않는다
_REAL_ASYNC_CLIENT = httpx2.AsyncClient


def build_chat_body(
    content: str | None, prompt_tokens: int | None = 11, completion_tokens: int | None = 7
) -> dict:
    """OpenAI 호환 chat/completions 응답 본문 — 토큰이 None이면 usage 키 자체를 뺀다(비표준 서버)."""
    body: dict = {"choices": [{"message": {"content": content}}]}
    if prompt_tokens is not None or completion_tokens is not None:
        body["usage"] = {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens}
    return body


def install_ai_transport(monkeypatch: pytest.MonkeyPatch, handler: Handler) -> None:
    """call_ai/list_models가 만드는 AsyncClient를 MockTransport 클라이언트로 바꾼다 — 실제 네트워크는 타지 않는다."""

    def make_client(**kwargs: object) -> httpx2.AsyncClient:
        return _REAL_ASYNC_CLIENT(transport=httpx2.MockTransport(handler), **kwargs)

    monkeypatch.setattr(ai_client.httpx2, "AsyncClient", make_client)


def reply_with(content: str | None, **tokens: int | None) -> Handler:
    """항상 같은 본문을 200으로 돌려주는 핸들러."""

    def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, json=build_chat_body(content, **tokens))

    return handler


def capture_requests(monkeypatch: pytest.MonkeyPatch, content: str | None = "{}") -> list[httpx2.Request]:
    """모든 요청을 모아 두고 `content`를 돌려주는 전송을 설치한다 — 돌려받은 리스트에 요청이 쌓인다."""
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(200, json=build_chat_body(content))

    install_ai_transport(monkeypatch, handler)
    return seen


def read_payload(request: httpx2.Request) -> dict:
    return json.loads(request.content)


def enable_ai(monkeypatch: pytest.MonkeyPatch) -> None:
    """AI를 켜고 단일 엔드포인트를 가리킨다 — 로컬 .env 값이 새도 이 설정을 보게 명시한다."""
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "ai_endpoints", "")
    monkeypatch.setattr(settings, "ai_base_url", AI_TEST_BASE_URL)
    monkeypatch.setattr(settings, "ai_api_token", AI_TEST_TOKEN)
    monkeypatch.setattr(settings, "ai_model", "glm-test")
