"""To-Be 칸 후보 — assign 새 문서의 칸·WI 단계로 후보 목록을 만들고, 임베딩(꺼졌거나 실패하면 글자 유사도)으로 LLM에 보낼 만큼만 추린다 (설계 §7.8 1단계, §8.4).

"다른 문서로 이동"은 후보에 없다(묶음 밖 대상을 모른다). "삭제"는 추려진 목록의 마지막에 늘 붙는다.
임베딩 호출은 DB 연결을 잡지 않고, 행렬 계산은 이벤트 루프를 막지 않게 스레드에서 돈다.
"""

import asyncio
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np

from app.sop.ai.constants import CANDIDATE_TOP_K, MAX_TEXT_CANDIDATES
from app.sop.ai.embeddings import EmbeddingUnavailable, UnavailableReason, embed_texts
from app.sop.ai.similarity import build_text_bigrams, compare_bigrams, cosine_matrix, top_k_indices
from app.sop.constants import NUMBERED, WI_PARTS, NumberStyle
from app.sop.outline import DocOutline, get_parent_key
from app.sop.snapshot import TargetDocInfo
from app.sop.target_placement import get_default_style
from app.sop.tobe import is_within_slot

Retrieval = Literal["embedding", "embedding_failed", "no_index"]  # 후보를 어떻게 골랐나 — 셋은 화면에서 서로 다른 상태다

# 임베딩이 꺼진 것(색인 없음)과 호출이 끝내 실패한 것(검색 실패)은 같은 폴백이어도 다른 상태로 남긴다
RETRIEVAL_OF_UNAVAILABLE: dict[UnavailableReason, Retrieval] = {"disabled": "no_index", "failed": "embedding_failed"}

# AI 규칙 글(seeds/rules.md)의 칸 ID → (이름, 넣는 것). 도메인 문서 §2의 일곱 칸 — 규칙 글은 옛 칸 이름으로 남아 있고(바꾸지 않는다),
# 실제 후보는 문서의 골격 사본에서 나온다. match_rule_slot이 골격 항목을 이 ID에 대어 후보 라벨의 안내 글("넣는 것")을 고른다
RULE_SLOT_GUIDE: dict[str, tuple[str, str]] = {
    "S1": ("Purpose", "절차가 필요한 이유, 관리 목적"),
    "S2": ("Scope", "적용 대상(공정, 장비, 시스템, 부서)"),
    "S3": ("Definitions", "문서 이해에 꼭 필요한 용어"),
    "S4": ("Responsibilities", "절차 안의 역할별 주요 책임"),
    "S5": ("General Requirements", "이 SOP의 모든 절차에 공통인 요구사항"),
    "S5.1": ("General Requirements > 안전(Safety)", ""),
    "S5.2": ("General Requirements > 작업(Operation)", ""),
    "S6": ("Procedures", "업무·절차별 목적과 적용 시점, 업무 흐름, 주요 수행 단계"),
    "S6.1": ("Procedures > Procedure", ""),
    "S6.2": ("Procedures > Electronic Record Control (Audit Trail, Recipe 등)", ""),
    "S6.3": ("Procedures > Troubleshooting", ""),
    "S6.4": ("Procedures > Maintenance", ""),
    "S7": ("Document Relationships", "관련 문서 맵핑"),
    "S7.1": ("Document Relationships > Attachments", ""),
    "S7.2": ("Document Relationships > Appendices", ""),
}
# 표준 골격의 최상위 키 → 그 항목 자신의 규칙 칸 ID(7장 묶음 제목은 줄을 받지 않아 여기 없다)
_RULE_OF_TOP_KEY = {
    "purpose": "S1", "scope": "S2", "definitions": "S3", "responsibilities": "S4", "general_requirements": "S5",
    "procedures": "S6", "attachments": "S7.1", "appendices": "S7.2",
}
_RULE_OF_CATEGORY = {"safety": "S5.1", "work": "S5.2"}  # 5장 범주의 영문 제목(소문자) → 규칙 칸 ID, 그 밖의 범주는 S5
# 6장 절차의 영문 제목에 든 말(소문자) → 규칙 칸 ID, 어느 것도 없으면 S6.1
_RULE_OF_PROCEDURE_WORD = (("electronic record", "S6.2"), ("troubleshoot", "S6.3"), ("maintenance", "S6.4"))


def match_rule_slot(outline: DocOutline, key: str) -> str | None:
    """골격 항목이 AI 규칙의 어느 칸(S1 … S7.2)에 해당하는가 — 줄을 받지 않는 항목(묶음 제목·자동 목록)과 표준 밖 항목은 None.

    문서마다 선언한 하위 항목은 영문 제목으로 댄다(설계 2026-11-17-template-fit §6 작업 1 #11).
    """
    item = outline.find(key)
    if item is None or not outline.is_assignable(key):
        return None
    top_key = key.split(".", 1)[0]
    if key == top_key:
        return _RULE_OF_TOP_KEY.get(key)
    title = item.title_en.strip().casefold()
    if top_key == "general_requirements":
        return _RULE_OF_CATEGORY.get(title, "S5")
    if top_key == "procedures":
        return next((rule for word, rule in _RULE_OF_PROCEDURE_WORD if word in title), "S6.1")
    if top_key == "document_relationships":
        return "S7"
    if top_key == "appendices":
        return "S7.2"
    return None


def _find_guide(outline: DocOutline, key: str) -> str:
    """후보 라벨의 안내 글 — 그 항목이 대응하는 규칙 칸의 "넣는 것", 대응이 없으면 가장 가까운 조상의 것(끝까지 없으면 빈 글)."""
    current: str | None = key
    while current is not None:
        rule = match_rule_slot(outline, current)
        if rule is not None:
            return RULE_SLOT_GUIDE[rule][1]
        current = get_parent_key(current)
    return ""


@dataclass(frozen=True)
class Candidate:
    """LLM에 보이는 놓을 자리 하나. SOP 칸이면 slot_key, WI면 wi_part(와 선언된 단계면 wi_step), 삭제면 모두 None."""

    key: str
    target_doc_id: int | None
    slot_key: str | None
    wi_step: int | None
    wi_part: str | None
    label: str
    default_style: NumberStyle = NUMBERED  # 그 자리에 놓이는 줄의 기본 번호 표시(SOP 골격 항목의 것, WI는 번호)


DELETE_CANDIDATE = Candidate(
    key="delete", target_doc_id=None, slot_key=None, wi_step=None, wi_part=None, label="삭제 (Delete): 새 문서에 싣지 않는다"
)

# (slot_key, wi_step, wi_part, label) — 문서 하나가 내놓는 자리, 키와 문서 id는 목록을 이을 때 붙인다
_Place = tuple[str | None, int | None, str | None, str]


def _name_of(doc: TargetDocInfo) -> str:
    """라벨에 쓰는 문서 이름 — 제목은 비어 있을 수 있고 문서를 가르는 건 번호뿐이라 비면 번호로 보인다."""
    return doc.title or doc.code


def _list_sop_places(doc: TargetDocInfo) -> Iterator[_Place]:
    """그 SOP의 골격 사본에서 줄을 받는 항목을 골격 순서대로 — 묶음 제목·자동 목록과 N/A 항목은 후보가 아니다. 문서에 없는 절을 지어내지 않는다."""
    head = _name_of(doc)
    for item in doc.outline.items:
        slot_key = item.key
        if not doc.outline.is_assignable(slot_key):
            continue
        if any(is_within_slot(slot_key, na_slot) for na_slot in doc.na_slots):  # 상위 칸 N/A는 하위 칸도 덮는다
            continue
        name, guide = doc.outline.get_label(slot_key), _find_guide(doc.outline, slot_key)
        yield slot_key, None, None, (f"{head} / {name}: {guide}" if guide else f"{head} / {name}")


def _list_wi_places(doc: TargetDocInfo, parent: TargetDocInfo | None) -> Iterator[_Place]:
    head = f"{_name_of(doc)}({_name_of(parent)})" if parent is not None else _name_of(doc)
    # 단계를 선언하지 않은 WI는 단계 없이 Instruction·Why만 내놓는다
    steps: list[tuple[int | None, str]] = [(step_no, f"단계 {step_no} {title}".rstrip()) for step_no, title in doc.steps]
    for step_no, step_name in steps or [(None, "")]:
        for part in WI_PARTS:
            # 단계가 없으면 그 칸을 통째로 뺀다(` /  / `가 되지 않게)
            names = [head, step_name, part.capitalize()]
            yield None, step_no, part, " / ".join(name for name in names if name)


def list_candidates(docs: Iterable[TargetDocInfo]) -> list[Candidate]:
    """assign 문서(match는 사람이 맞춘다)의 후보 목록 — 문서는 순서 열 순, 키는 `c1`부터. WI의 부모 SOP 제목은 넘긴 문서 안에서 푼다."""
    by_id = {doc.id: doc for doc in docs}
    candidates: list[Candidate] = []
    for doc in sorted(by_id.values(), key=lambda doc: (doc.order_index, doc.id)):
        if doc.entrance != "assign":
            continue
        places = (
            _list_sop_places(doc)
            if doc.doc_type == "sop"
            else _list_wi_places(doc, by_id.get(doc.parent_id) if doc.parent_id is not None else None)
        )
        for slot_key, wi_step, wi_part, label in places:
            candidates.append(
                Candidate(
                    f"c{len(candidates) + 1}", doc.id, slot_key, wi_step, wi_part, label,
                    get_default_style(doc.outline, slot_key),
                )
            )
    return candidates


def _pick_by_embedding(
    query: str, candidates: Sequence[Candidate], vectors: Mapping[str, np.ndarray]
) -> list[Candidate]:
    """질의와 코사인 유사도가 높은 순 상위 CANDIDATE_TOP_K — 같은 글의 벡터는 공유되니 새 행렬로 쌓는다(제자리 수정 금지)."""
    if not candidates:
        return []
    items = np.stack([vectors[candidate.label] for candidate in candidates])
    scores = cosine_matrix(vectors[query][np.newaxis, :], items)[0]
    return [candidates[index] for index in top_k_indices(scores, CANDIDATE_TOP_K)]


def _narrow_by_text(query: str, candidates: Sequence[Candidate]) -> list[Candidate]:
    """MAX_TEXT_CANDIDATES 이하면 목록 그대로, 넘으면 글자 유사도 높은 순으로 그만큼(동점은 목록 순)."""
    if len(candidates) <= MAX_TEXT_CANDIDATES:
        return list(candidates)
    query_bigrams = build_text_bigrams(query)
    scores = np.asarray([compare_bigrams(query_bigrams, build_text_bigrams(candidate.label)) for candidate in candidates])
    return [candidates[index] for index in top_k_indices(scores, MAX_TEXT_CANDIDATES)]


async def rank_candidates(
    query: str, candidates: Sequence[Candidate], *, login_id: str
) -> tuple[list[Candidate], Retrieval]:
    """질의(옛 단위 글)에 맞는 후보를 추리고 어떻게 골랐는지(`retrieval`)를 함께 돌려준다 — 삭제는 늘 마지막에 붙는다.

    임베딩이 켜져 있으면 상위 CANDIDATE_TOP_K("embedding"). 꺼져 있으면("no_index")·호출이 실패하면("embedding_failed")
    글자 유사도로 줄인다. 어느 쪽이든 단위 처리를 멈추지 않는다.
    """
    try:
        vectors = await embed_texts([query, *(candidate.label for candidate in candidates)], login_id=login_id)
    except EmbeddingUnavailable as unavailable:
        narrowed = await asyncio.to_thread(_narrow_by_text, query, candidates)
        return [*narrowed, DELETE_CANDIDATE], RETRIEVAL_OF_UNAVAILABLE[unavailable.reason]
    picked = await asyncio.to_thread(_pick_by_embedding, query, candidates, vectors)
    return [*picked, DELETE_CANDIDATE], "embedding"
