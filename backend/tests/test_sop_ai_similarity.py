"""유사도 순수 함수(app.sop.ai.similarity) — 코사인 행렬·상위 k(동점은 앞 번호)·문자 2-gram Dice."""

import numpy as np
import pytest

from app.sop.ai.similarity import cosine_matrix, text_similarity, top_k_indices


def test_cosine_matrix_scores_every_query_against_every_item() -> None:
    queries = np.array([[1.0, 0.0], [1.0, 1.0]], dtype=np.float32)
    items = np.array([[2.0, 0.0], [0.0, 3.0], [-1.0, 0.0]], dtype=np.float32)

    scores = cosine_matrix(queries, items)

    assert scores.shape == (2, 3)
    # 길이가 달라도 방향만 본다 — 같은 방향 1, 직각 0, 반대 -1
    assert scores[0].tolist() == pytest.approx([1.0, 0.0, -1.0])
    assert scores[1].tolist() == pytest.approx([2**-0.5, 2**-0.5, -(2**-0.5)])


def test_cosine_matrix_gives_zero_for_a_zero_vector_instead_of_nan() -> None:
    queries = np.array([[0.0, 0.0], [1.0, 0.0]], dtype=np.float32)
    items = np.array([[1.0, 0.0], [0.0, 0.0]], dtype=np.float32)

    scores = cosine_matrix(queries, items)

    assert np.isfinite(scores).all()
    assert scores.tolist() == [[0.0, 0.0], [1.0, 0.0]]


def test_cosine_matrix_with_no_items_is_an_empty_column() -> None:
    queries = np.ones((2, 3), dtype=np.float32)

    assert cosine_matrix(queries, np.empty((0, 3), dtype=np.float32)).shape == (2, 0)


def test_top_k_returns_the_highest_scores_first() -> None:
    assert top_k_indices(np.array([0.1, 0.9, 0.5, 0.7], dtype=np.float32), 2) == [1, 3]


def test_top_k_breaks_ties_by_position() -> None:
    scores = np.array([0.5, 0.9, 0.5, 0.9, 0.5], dtype=np.float32)

    assert top_k_indices(scores, 3) == [1, 3, 0]
    assert top_k_indices(scores, 5) == [1, 3, 0, 2, 4]


def test_top_k_handles_k_beyond_the_length_and_non_positive_k() -> None:
    scores = np.array([0.2, 0.8], dtype=np.float32)

    assert top_k_indices(scores, 10) == [1, 0]
    assert top_k_indices(scores, 0) == []
    assert top_k_indices(scores, -1) == []
    assert top_k_indices(np.array([], dtype=np.float32), 3) == []


def test_top_k_returns_plain_ints() -> None:
    [first] = top_k_indices(np.array([0.3], dtype=np.float32), 1)

    assert type(first) is int


def test_text_similarity_handles_korean_and_empty() -> None:
    assert text_similarity("로터를 장착한다", "로터를 장착한다") == 1.0
    assert text_similarity("", "abc") == 0.0
    assert text_similarity("abc", "") == 0.0
    assert text_similarity("", "") == 0.0


def test_text_similarity_ignores_whitespace() -> None:
    assert text_similarity("로터를  장착한다", "로터를\n장착한다") == 1.0
    assert text_similarity(" a b c ", "abc") == 1.0


def test_text_similarity_is_dice_over_character_bigrams() -> None:
    # "abcd"={ab,bc,cd}, "abce"={ab,bc,ce} → 겹침 2, 2*2/(3+3)
    assert text_similarity("abcd", "abce") == pytest.approx(4 / 6)
    assert text_similarity("abc", "xyz") == 0.0
    # 대칭이고 겹친 구간이 많을수록 높다
    assert text_similarity("로터를 장착한다", "로터를 분리한다") == text_similarity("로터를 분리한다", "로터를 장착한다")
    assert text_similarity("로터를 장착한다", "로터를 장착합니다") > text_similarity("로터를 장착한다", "전원을 끈다")


def test_text_similarity_counts_repeated_bigrams_once_per_occurrence() -> None:
    # "aaa"={aa,aa}, "aa"={aa} → 겹침 1, 2*1/(2+1). 집합으로 세면 1.0이 된다
    assert text_similarity("aaa", "aa") == pytest.approx(2 / 3)


def test_text_similarity_of_single_characters() -> None:
    # 2-gram이 없는 한 글자 글은 같을 때만 1.0
    assert text_similarity("a", "a") == 1.0
    assert text_similarity("a", "b") == 0.0
    assert text_similarity("a", "ab") == 0.0
