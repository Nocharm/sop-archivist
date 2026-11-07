"""유사도 순수 함수 — 코사인 행렬, 상위 k 고르기, 임베딩이 꺼졌을 때 쓰는 글자 2-gram 유사도. 호출부가 큰 행렬은 asyncio.to_thread로 돌린다."""

from collections import Counter

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


def text_similarity(a: str, b: str) -> float:
    """문자 2-gram Dice 유사도(0~1) — 공백은 무시하고 같은 2-gram이 되풀이되면 횟수까지 센다.

    한 글자 글은 2-gram이 없어 같을 때만 1.0이다. 정답 확률이 아니라 후보를 줄이는 눈금이다.
    """
    a, b = "".join(a.split()), "".join(b.split())
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    bigrams_a, bigrams_b = _count_bigrams(a), _count_bigrams(b)
    total = bigrams_a.total() + bigrams_b.total()
    if total == 0:
        return 0.0
    return 2 * (bigrams_a & bigrams_b).total() / total
