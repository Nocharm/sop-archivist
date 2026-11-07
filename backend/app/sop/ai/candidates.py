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
from app.sop.constants import SLOT_KEYS, WI_PARTS
from app.sop.snapshot import TargetDocInfo
from app.sop.tobe import is_within_slot

Retrieval = Literal["embedding", "embedding_failed", "no_index"]  # 후보를 어떻게 골랐나 — 셋은 화면에서 서로 다른 상태다

# 임베딩이 꺼진 것(색인 없음)과 호출이 끝내 실패한 것(검색 실패)은 같은 폴백이어도 다른 상태로 남긴다
RETRIEVAL_OF_UNAVAILABLE: dict[UnavailableReason, Retrieval] = {"disabled": "no_index", "failed": "embedding_failed"}

# 칸 키 → (이름, 넣는 것). 도메인 문서 §2 — 하위 칸은 이름 앞에 상위 칸을 붙이고(라벨만 봐도 어느 칸인지 보이게), 문서가 비워 둔 "넣는 것"은 비운다
SLOT_GUIDE: dict[str, tuple[str, str]] = {
    "purpose": ("Purpose", "절차가 필요한 이유, 관리 목적"),
    "scope": ("Scope", "적용 대상(공정, 장비, 시스템, 부서)"),
    "definitions": ("Definitions", "문서 이해에 꼭 필요한 용어"),
    "responsibilities": ("Responsibilities", "절차 안의 역할별 주요 책임"),
    "general_requirements": ("General Requirements", "이 SOP의 모든 절차에 공통인 요구사항"),
    "general_requirements.safety": ("General Requirements > 안전(Safety)", ""),
    "general_requirements.operation": ("General Requirements > 작업(Operation)", ""),
    "procedures": ("Procedures", "업무·절차별 목적과 적용 시점, 업무 흐름, 주요 수행 단계"),
    "procedures.procedure": ("Procedures > Procedure", ""),
    "procedures.electronic_record_control": ("Procedures > Electronic Record Control (Audit Trail, Recipe 등)", ""),
    "procedures.troubleshooting": ("Procedures > Troubleshooting", ""),
    "procedures.maintenance": ("Procedures > Maintenance", ""),
    "document_relationships": ("Document Relationships", "관련 문서 맵핑"),
    "document_relationships.attachments": ("Document Relationships > Attachments", ""),
    "document_relationships.appendices": ("Document Relationships > Appendices", ""),
}


@dataclass(frozen=True)
class Candidate:
    """LLM에 보이는 놓을 자리 하나. SOP 칸이면 slot_key, WI면 wi_part(와 선언된 단계면 wi_step), 삭제면 모두 None."""

    key: str
    target_doc_id: int | None
    slot_key: str | None
    wi_step: int | None
    wi_part: str | None
    label: str


DELETE_CANDIDATE = Candidate(
    key="delete", target_doc_id=None, slot_key=None, wi_step=None, wi_part=None, label="삭제 (Delete): 새 문서에 싣지 않는다"
)

# (slot_key, wi_step, wi_part, label) — 문서 하나가 내놓는 자리, 키와 문서 id는 목록을 이을 때 붙인다
_Place = tuple[str | None, int | None, str | None, str]


def _name_of(doc: TargetDocInfo) -> str:
    """라벨에 쓰는 문서 이름 — 제목은 비어 있을 수 있고 문서를 가르는 건 번호뿐이라 비면 번호로 보인다."""
    return doc.title or doc.code


def _list_sop_places(doc: TargetDocInfo) -> Iterator[_Place]:
    head = _name_of(doc)
    for slot_key in SLOT_KEYS:
        if any(is_within_slot(slot_key, na_slot) for na_slot in doc.na_slots):  # 상위 칸 N/A는 하위 칸도 덮는다
            continue
        name, guide = SLOT_GUIDE[slot_key]
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
            candidates.append(Candidate(f"c{len(candidates) + 1}", doc.id, slot_key, wi_step, wi_part, label))
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
