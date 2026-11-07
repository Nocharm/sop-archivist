"""유사도 순수 함수 — 코사인 행렬, 상위 k 고르기, 임베딩이 꺼졌을 때 쓰는 글자 2-gram 유사도. 호출부가 큰 행렬은 asyncio.to_thread로 돌린다."""

from collections import Counter
from dataclasses import dataclass

import numpy as np


def _normalize_rows(matrix: np.ndarray) -> np.ndarray:
    """행마다 길이를 1로 맞춘다. 영벡터는 그대로 둬서 점수가 NaN 대신 0이 되게 한다."""
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    return matrix / np.where(norms == 0, 1.0, norms)


def cosine_matrix(queries: np.ndarray, items: np.ndarray) -> np.ndarray:
    """질의 행 × 항목 행의 코사인 유사도 — 결과 (질의 수, 항목 수)의 [i][j]가 i번째 질의와 j번째 항목의 점수."""
    return _normalize_rows(queries) @ _normalize_rows(items).T


def top_k_indices(scores: np.ndarray, k: int) -> list[int]:
    """1차원 점수에서 높은 순 상위 k개의 위치. 점수가 같으면 앞 번호가 먼저다(안정 정렬)."""
    if k <= 0:
        return []
    order = np.argsort(-scores, kind="stable")
    return [int(index) for index in order[:k]]


def _count_bigrams(text: str) -> Counter[str]:
    return Counter(text[index : index + 2] for index in range(len(text) - 1))


@dataclass(frozen=True)
class TextBigrams:
    """글 하나를 세어 둔 값 — 행렬은 글을 수천 번 견주니 짝마다 세지 않고 재사용한다. text는 공백을 뺀 글이다."""

    text: str
    counts: Counter[str]
    total: int


def build_text_bigrams(text: str) -> TextBigrams:
    compact = "".join(text.split())
    counts = _count_bigrams(compact)
    return TextBigrams(compact, counts, counts.total())


def compare_bigrams(a: TextBigrams, b: TextBigrams) -> float:
    """문자 2-gram Dice 유사도(0~1) — 공백은 무시하고 같은 2-gram이 되풀이되면 횟수까지 센다.

    한 글자 글은 2-gram이 없어 같을 때만 1.0이다. 정답 확률이 아니라 후보를 줄이는 눈금이다.
    """
    if not a.text or not b.text:
        return 0.0
    if a.text == b.text:
        return 1.0
    total = a.total + b.total
    if total == 0:
        return 0.0
    # Counter의 &는 없는 키마다 파이썬 쪽 __missing__을 탄다 — 키 교집합은 C에서 끝나 겹친 키만 돈다
    shared = sum(min(a.counts[gram], b.counts[gram]) for gram in a.counts.keys() & b.counts.keys())
    return 2 * shared / total


def text_similarity(a: str, b: str) -> float:
    """글 둘을 한 번 견주는 compare_bigrams — 같은 글을 여러 번 견주면 build_text_bigrams로 세어 두고 쓴다."""
    return compare_bigrams(build_text_bigrams(a), build_text_bigrams(b))
