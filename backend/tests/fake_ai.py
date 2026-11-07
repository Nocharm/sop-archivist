"""가짜 AI — 채팅·임베딩 전송을 갈아 끼워 요청의 data 구간을 모으고 시험이 정한 답을 돌려준다 (AI 작업 시험 공용)."""

import json
import re
from collections.abc import Callable

import httpx2
import pytest

from tests.ai_helpers import (
    build_chat_body,
    build_embed_body,
    enable_ai,
    enable_embed,
    install_ai_transport,
    read_payload,
    vector_for,
)

# wrap_data가 내보내는 구분 줄 사이의 JSON 한 줄 — 여는 줄과 닫는 줄의 nonce가 같아야 한 구간이다
_DATA_BLOCK_RE = re.compile(r"^<<<DATA (?P<nonce>[0-9a-f]+)>>>\n(?P<body>.*)\n<<<END DATA (?P=nonce)>>>$", re.MULTILINE)

Chat = Callable[[dict], str]
Embed = Callable[[str], list[float]]
OnChat = Callable[[dict], None]


def extract_data(messages: list[dict]) -> dict:
    """사용자 메시지의 data 구간을 JSON으로 읽는다."""
    user = next(message["content"] for message in messages if message["role"] == "user")
    match = _DATA_BLOCK_RE.search(user)
    assert match is not None, "the user message has no data block"
    return json.loads(match["body"])


def hash_vector(text: str) -> list[float]:
    """글마다 결정적이고 영벡터가 아닌 가짜 임베딩."""
    return vector_for(text)


class FakeAi:
    """시험이 `chat`(data → 응답 글)과 `on_chat`(호출 중 끼어들기, data를 받는다)을 언제든 갈아 끼운다.

    `requests`는 채팅 요청의 data, `messages`는 보낸 메시지 그대로, `bodies`는 요청 본문 전체(호출 순서대로)다.
    """

    def __init__(self, chat: Chat, embed: Embed | None) -> None:
        self.chat = chat
        self.embed = embed
        self.on_chat: OnChat | None = None
        self.requests: list[dict] = []
        self.messages: list[list[dict]] = []
        self.bodies: list[dict] = []

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        body = read_payload(request)
        if request.url.path.endswith("/embeddings"):
            assert self.embed is not None, "embedding call without a fake embed"
            return httpx2.Response(200, json=build_embed_body([self.embed(text) for text in body["input"]]))
        data = extract_data(body["messages"])
        self.requests.append(data)
        self.messages.append(body["messages"])
        self.bodies.append(body)
        if self.on_chat is not None:
            self.on_chat(data)
        return httpx2.Response(200, json=build_chat_body(self.chat(data)))


def install_fake_ai(monkeypatch: pytest.MonkeyPatch, *, chat: Chat, embed: Embed | None = None) -> FakeAi:
    """AI를 켜고 전송을 가짜로 바꾼다 — embed를 주면 임베딩도 켠다. 망은 타지 않는다."""
    enable_ai(monkeypatch)
    if embed is not None:
        enable_embed(monkeypatch)
    fake = FakeAi(chat, embed)
    install_ai_transport(monkeypatch, fake.handle)
    return fake
