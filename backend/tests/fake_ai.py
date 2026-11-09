"""가짜 AI — 채팅·임베딩 전송을 갈아 끼워 요청의 data 구간을 모으고 시험이 정한 답을 돌려준다 (AI 작업 시험 공용).

`SyntheticAnswers`는 합성 묶음의 기대 정답으로 답하고, `fake_ai_session`은 같은 전송을 pytest 픽스처 없이 쓴다(E2E 시험·로컬 데모 시드). 합성이고 실제 모델이 아니다.
"""

import json
import re
from collections import Counter, defaultdict
from collections.abc import Callable, Iterator
from contextlib import contextmanager

import httpx2
import pytest

from app.sop.ai.candidates import list_candidates
from app.sop.snapshot import TargetDocInfo
from scripts.synthetic_sop import TOBE_DOCS, TOBE_STEPS
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
_Place = tuple[str, str | None, int | None, str | None]  # (새 문서 번호, 칸, WI 단계, WI 부분)

_DELETE_KEY = "delete"  # 분류 후보 목록 끝에 늘 붙는 삭제 후보의 키
_ANSWER_KINDS = ("table", "figure")  # 기대 정답에서 `kind`로 찾는 단위 종류 — 나머지는 글 단위로 찾는다
_REPLY_CHANGE_TYPES = ("as_is", "tone", "rewritten")  # LLM이 낼 수 있는 종류 — 나눔·합침은 서버가 구조로 정한다
_REPLY_RULE_IDS = ["R01"]  # 규칙 문서에 있는 ID — 없는 ID는 서버가 경고를 남긴다
_ANSWER_REASON = "합성: 기대 정답으로 답한 가짜 AI 제안이다."


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


def _skip_doc_meta(*_args: object, **_kwargs: object) -> bool:
    return False


def install_fake_ai(
    monkeypatch: pytest.MonkeyPatch, *, chat: Chat, embed: Embed | None = None, doc_meta: bool = False
) -> FakeAi:
    """AI를 켜고 전송을 가짜로 바꾼다 — embed를 주면 임베딩도 켠다. 망은 타지 않는다.

    업로드마다 자동으로 쌓이는 문서 정보 작업(doc_meta)은 doc_meta=True인 시험만 켠다 — 다른 AI 시험의 작업·제안 수를 바꾸지 않게.
    """
    if not doc_meta:
        from app.routers import sop_documents

        monkeypatch.setattr(sop_documents, "enqueue_doc_meta", _skip_doc_meta)
    enable_ai(monkeypatch)
    if embed is not None:
        enable_embed(monkeypatch)
    fake = FakeAi(chat, embed)
    install_ai_transport(monkeypatch, fake.handle)
    return fake


@contextmanager
def fake_ai_session() -> Iterator[FakeAi]:
    """pytest 픽스처 없이 쓰는 가짜 AI — 안에서만 AI·임베딩이 켜지고 전송이 바뀐다. 답은 돌려받은 FakeAi의 `chat`·`embed`로 정한다."""
    with pytest.MonkeyPatch.context() as monkeypatch:
        yield install_fake_ai(monkeypatch, chat=lambda data: "{}", embed=hash_vector)


def _get_place(spec: dict) -> _Place:
    return (spec["code"], spec.get("slot_key"), spec.get("wi_step"), spec.get("wi_part"))


def _build_place_labels(expected: dict) -> dict[_Place, str]:
    """자리 → 후보 라벨 — 합성 To-Be 목록을 서버와 같은 함수에 넣어 라벨이 서버가 보내는 글과 어긋나지 않게 한다."""
    ids = {doc[0]: doc_id for doc_id, doc in enumerate(TOBE_DOCS, start=1)}
    na_slots: dict[str, dict[str, str]] = defaultdict(dict)
    for slot in expected["tobe_na_slots"]:
        na_slots[slot["code"]][slot["slot_key"]] = slot["reason"]
    docs = [
        TargetDocInfo(
            id=ids[code], code=code, title=title, doc_type=doc_type.lower(), parent_id=ids.get(parent), entrance="assign",
            is_equipment_sop=equipment == "Y", order_index=ids[code], manual_order=False, na_slots=na_slots[code],
            steps=tuple((step_no, name) for wi_code, step_no, name in TOBE_STEPS if wi_code == code),
        )
        for code, title, doc_type, parent, equipment in TOBE_DOCS
    ]
    codes = {doc.id: doc.code for doc in docs}
    return {
        (codes[item.target_doc_id], item.slot_key, item.wi_step, item.wi_part): item.label
        for item in list_candidates(docs)
    }


class SyntheticAnswers:
    """합성 묶음의 기대 정답으로 답하는 가짜 AI — 단순한 답(한 자리, 같은 언어)은 정답으로, 나머지는 무효 응답으로 돌려 사람 경로를 타게 한다.

    나머지는 합침·중복 배정·표, 분류 후보에 없는 외부 이동, 한 응답에 담을 수 없는 짝(두 언어의 자리나 변경 종류가 갈린다)이다.
    임베딩은 정답끼리 같은 벡터를 줘 후보 추리기와 입구 2 짝 계획이 정답을 고르게 한다. 작업이 문서 순서로 돈다고 본다(같은 글의 몇 번째인지).
    """

    def __init__(self, expected: dict) -> None:
        self._answers = {(answer.get("kind"), answer["text"], answer["occurrence"]): answer for answer in expected["answers"]}
        self._labels = _build_place_labels(expected)
        keys = Counter(spec["key"] for answer in expected["answers"] for spec in answer["targets"])
        self._merged_keys = {key for key, count in keys.items() if count >= 2}
        self._seen: dict[tuple[str | None, str], list[int]] = defaultdict(list)  # (종류, 글) → 나온 단위 id
        self._anchors: dict[str, str] = {}  # 글 → 같은 벡터를 받을 글
        for answer in expected["answers"]:
            for spec in answer["targets"]:
                if "section_path" in spec:  # 입구 2 — 옛 글과 새 문장이 첫 새 문장의 벡터를 나눠 갖는다
                    self._anchors[answer["text"]] = self._anchors[spec["text"]] = answer["targets"][0]["text"]
                elif "parent_key" not in spec:
                    self._anchors.setdefault(answer["text"], self._labels[_get_place(spec)])

    def embed(self, text: str) -> list[float]:
        """정답끼리 같은 벡터 — 분류 질의는 짝의 글을 줄바꿈으로 이어서 첫 줄로 찾는다. 정답이 없는 글(라벨 포함)은 자기 벡터다."""
        return hash_vector(self._anchors.get(text.partition("\n")[0], text))

    def chat(self, data: dict) -> str:
        reply = {"classify": self._answer_classify, "match": self._answer_match}[data["task"]](data)
        return json.dumps(reply, ensure_ascii=False)

    def _find_answer(self, unit: dict) -> dict:
        """단위의 정답 — 같은 글이 되풀이되면(같은 문장 반복) 처음 본 순서가 몇 번째인지다."""
        kind = unit["kind"] if unit["kind"] in _ANSWER_KINDS else None
        seen = self._seen[(kind, unit["text"])]
        if unit["id"] not in seen:
            seen.append(unit["id"])
        return self._answers[(kind, unit["text"], seen.index(unit["id"]) + 1)]

    def _is_simple(self, answer: dict) -> bool:
        if answer["disposition"] != "assigned" or len(answer["targets"]) != 1:
            return False
        (spec,) = answer["targets"]
        return spec["key"] not in self._merged_keys and spec["lang"] == answer["lang"]

    def _answer_classify(self, data: dict) -> dict:
        answers = [self._find_answer(unit) for unit in data["units"]]
        if all(answer["disposition"] == "delete" for answer in answers):
            return self._build_classify_reply(data, _DELETE_KEY, "as_is", {})
        if not all(self._is_simple(answer) for answer in answers):
            return {}
        specs = [answer["targets"][0] for answer in answers]
        places = {_get_place(spec) for spec in specs}
        change_types = {spec["change_type"] for spec in specs} - {"as_is"}  # 글이 같은 쪽은 서버가 그대로로 둔다
        if len(places) != 1 or len(change_types) > 1:
            return {}
        label = self._labels[places.pop()]
        candidate = next(item["key"] for item in data["candidates"] if item["label"] == label)
        rewrites = {spec["lang"]: [spec["text"]] for spec in specs if spec["kind"] == "sentence"}
        return self._build_classify_reply(data, candidate, change_types.pop() if change_types else "as_is", rewrites)

    def _build_classify_reply(
        self, data: dict, candidate: str, change_type: str, rewrites: dict[str, list[str]]
    ) -> dict:
        return {
            "candidate": candidate,
            "reason": _ANSWER_REASON,
            "rule_ids": _REPLY_RULE_IDS,
            "evidence": [{"unit_id": unit["id"], "quote": unit["text"]} for unit in data["units"] if unit["text"]],
            "change_type": change_type,
            "rewrites": rewrites,
        }

    def _answer_match(self, data: dict) -> dict:
        """문장 그룹의 변경 종류 — 나눔은 구조에서 나와 응답 값이 쓰이지 않는다. 입구 2 옛 글은 합성 자료에서 되풀이되지 않는다."""
        answer = self._answers[(None, data["old"][0]["text"], 1)]
        change_type = answer["targets"][0]["change_type"]
        return {
            "change_type": change_type if change_type in _REPLY_CHANGE_TYPES else "rewritten",
            "reason": _ANSWER_REASON,
            "rule_ids": _REPLY_RULE_IDS,
        }
