"""입구 2 짝 묶기(순수) — 1:1·나눔·합침, N:M 줄이기, 임계값, 언어·종류 규칙, 표·그림 1:1, 글자 점수 (설계 §7.10)."""

import numpy as np
import pytest

from app.sop.ai.constants import MATCH_TEXT_THRESHOLD
from app.sop.ai.matching import MatchGroup, MatchItem, build_text_scores, propose_groups
from app.sop.ai.similarity import text_similarity
from tests.ai_helpers import record_bigram_counts

THRESHOLD = 0.75
TEXT_KO = "합성 장비의 전원을 켠다."
TEXT_EN = "Turn on the synthetic instrument."
REPEATED = "되풀이되는 합성 문장이다."
ONCE_OLD = "한 번만 나오는 합성 절차를 적는다."
ONCE_NEW = "한 번만 나오는 합성 절차를 고쳐 적는다."


def item(item_id: int, lang: str = "ko", kind: str = "sentence", text: str = "") -> MatchItem:
    return MatchItem(id=item_id, lang=lang, kind=kind, text=text)


def repeated(*item_ids: int) -> list[MatchItem]:
    return [item(item_id, text=REPEATED) for item_id in item_ids]


def test_mutual_best_makes_one_to_one() -> None:
    scores = np.array([[0.9, 0.1], [0.2, 0.8]])

    proposal = propose_groups([item(1), item(2)], [item(10), item(20)], scores, THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10,)), MatchGroup((2,), (20,)))
    assert (proposal.unmatched_old_ids, proposal.unmatched_target_ids) == ((), ())


def test_two_olds_on_one_new_make_a_merge() -> None:
    scores = np.array([[0.9], [0.8]])

    proposal = propose_groups([item(1), item(2)], [item(10)], scores, THRESHOLD)

    assert proposal.groups == (MatchGroup((1, 2), (10,)),)


def test_one_old_on_two_news_makes_a_split() -> None:
    scores = np.array([[0.9, 0.8]])

    proposal = propose_groups([item(1)], [item(10), item(20)], scores, THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10, 20)),)


def test_many_to_many_reduces_to_stars_deterministically() -> None:
    olds = [item(1), item(2), item(3)]
    news = [item(10), item(20), item(30)]
    scores = np.array([[0.9, 0.85, 0.0], [0.88, 0.8, 0.0], [0.0, 0.82, 0.86]])

    first = propose_groups(olds, news, scores, THRESHOLD)
    again = propose_groups(olds, news, scores, THRESHOLD)
    shuffled = propose_groups(
        olds[::-1], news[::-1], scores[np.ix_([2, 1, 0], [2, 1, 0])], THRESHOLD
    )

    assert first == again == shuffled
    assert first.groups == (MatchGroup((1,), (10, 20)), MatchGroup((3,), (30,)))  # 20의 최고는 1이라 3에 붙지 않는다
    assert first.unmatched_old_ids == (2,)  # 어느 새 문장의 최고도 아니어서 짝이 없어진다
    assert all(1 in (len(group.old_ids), len(group.target_ids)) for group in first.groups)


def test_ties_go_to_the_lowest_id() -> None:
    olds = [item(2), item(1)]
    news = [item(20), item(10)]
    scores = np.full((2, 2), 0.9)

    proposal = propose_groups(olds, news, scores, THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10, 20)),)
    assert proposal.unmatched_old_ids == (2,)


def test_scores_below_threshold_stay_unmatched() -> None:
    scores = np.array([[0.74, 0.1], [0.75, 0.2]])

    proposal = propose_groups([item(1), item(2)], [item(10), item(20)], scores, THRESHOLD)

    assert proposal.groups == (MatchGroup((2,), (10,)),)  # 임계값과 같은 점수는 짝이다
    assert (proposal.unmatched_old_ids, proposal.unmatched_target_ids) == ((1,), (20,))


def test_languages_and_kinds_never_mix() -> None:
    olds = [item(1, "ko"), item(2, "neutral", "table")]
    news = [item(10, "en"), item(20, "neutral", "figure"), item(30, "neutral", "sentence")]
    scores = np.ones((2, 3))

    proposal = propose_groups(olds, news, scores, THRESHOLD)

    assert proposal.groups == ()
    assert (proposal.unmatched_old_ids, proposal.unmatched_target_ids) == ((1, 2), (10, 20, 30))


def test_tables_and_figures_pair_one_to_one_only() -> None:
    olds = [item(1, "neutral", "table"), item(2, "neutral", "table"), item(3, "neutral", "figure")]
    news = [item(10, "neutral", "table"), item(30, "neutral", "figure"), item(40, "neutral", "figure")]
    scores = np.array([[0.9, 0.0, 0.0], [0.8, 0.0, 0.0], [0.0, 0.9, 0.85]])

    proposal = propose_groups(olds, news, scores, THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10,)), MatchGroup((3,), (30,)))
    assert (proposal.unmatched_old_ids, proposal.unmatched_target_ids) == ((2,), (40,))


def test_tables_keep_the_pairs_the_sentence_path_keeps() -> None:
    olds = [item(1, "neutral", "table"), item(2, "neutral", "table")]
    news = [item(10, "neutral", "table"), item(20, "neutral", "table")]
    scores = np.array([[0.95, 0.80], [0.93, 0.92]])

    proposal = propose_groups(olds, news, scores, THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10,)), MatchGroup((2,), (20,)))
    assert (proposal.unmatched_old_ids, proposal.unmatched_target_ids) == ((), ())


def test_table_star_keeps_its_highest_pair_and_ties_go_to_the_lowest_id() -> None:
    olds = [item(1, "neutral", "figure")]
    news = [item(10, "neutral", "figure"), item(20, "neutral", "figure"), item(30, "neutral", "figure")]

    highest = propose_groups(olds, news, np.array([[0.8, 0.9, 0.85]]), THRESHOLD)
    tied = propose_groups(olds, news, np.array([[0.9, 0.9, 0.9]]), THRESHOLD)

    assert highest.groups == (MatchGroup((1,), (20,)),)
    assert highest.unmatched_target_ids == (10, 30)
    assert tied.groups == (MatchGroup((1,), (10,)),)


def test_repeated_text_pairs_one_to_one_in_id_order() -> None:
    olds, news = repeated(1, 2), repeated(10, 20)

    proposal = propose_groups(olds, news, build_text_scores(olds, news), THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10,)), MatchGroup((2,), (20,)))
    assert (proposal.unmatched_old_ids, proposal.unmatched_target_ids) == ((), ())


def test_repeated_text_leaves_a_surplus_old_unmatched() -> None:
    olds, news = repeated(1, 2, 3), repeated(10, 20)

    proposal = propose_groups(olds, news, build_text_scores(olds, news), THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10,)), MatchGroup((2,), (20,)))
    assert proposal.unmatched_old_ids == (3,)


def test_repeated_text_leaves_a_surplus_new_unmatched() -> None:
    olds, news = repeated(1, 2), repeated(10, 20, 30)

    proposal = propose_groups(olds, news, build_text_scores(olds, news), THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10,)), MatchGroup((2,), (20,)))
    assert proposal.unmatched_target_ids == (30,)


def test_repeated_old_reaches_a_new_with_a_tail() -> None:
    """이은 항목에는 다시 붙지 못해도 남은 새 문장에는 붙는다."""
    olds = repeated(1, 2)
    news = [item(10, text=REPEATED), item(20, text=f"{REPEATED} 합성 꼬리를 덧붙인다.")]
    scores = np.array([[1.0, 0.9], [1.0, 0.9]])

    proposal = propose_groups(olds, news, scores, THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10,)), MatchGroup((2,), (20,)))


def test_two_repeated_olds_on_one_new_leave_a_surplus_old() -> None:
    olds, news = repeated(1, 2), repeated(10)

    proposal = propose_groups(olds, news, build_text_scores(olds, news), THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10,)),)  # 합침이 아니다
    assert proposal.unmatched_old_ids == (2,)


def test_one_repeated_old_on_two_news_leaves_a_surplus_new() -> None:
    olds, news = repeated(1), repeated(10, 20)

    proposal = propose_groups(olds, news, build_text_scores(olds, news), THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10,)),)  # 나눔이 아니다
    assert proposal.unmatched_target_ids == (20,)


def test_repeated_text_around_a_rewritten_sentence_makes_no_false_split() -> None:
    olds = [item(1, text=REPEATED), item(2, text=ONCE_OLD), item(3, text=REPEATED)]
    news = [item(10, text=REPEATED), item(20, text=ONCE_NEW), item(30, text=REPEATED)]

    proposal = propose_groups(olds, news, build_text_scores(olds, news), MATCH_TEXT_THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10,)), MatchGroup((2,), (20,)), MatchGroup((3,), (30,)))
    assert (proposal.unmatched_old_ids, proposal.unmatched_target_ids) == ((), ())


def test_repeated_text_pairs_the_same_whatever_the_input_order() -> None:
    olds, news = repeated(1, 2, 3), repeated(10, 20)
    shuffled_olds, shuffled_news = [olds[2], olds[0], olds[1]], [news[1], news[0]]

    proposal = propose_groups(shuffled_olds, shuffled_news, np.ones((3, 2)), THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10,)), MatchGroup((2,), (20,)))


def test_repeated_tables_and_figures_pair_one_to_one_too() -> None:
    olds = [item(1, "neutral", "table", REPEATED), item(2, "neutral", "table", REPEATED)]
    news = [item(10, "neutral", "table", REPEATED), item(20, "neutral", "table", REPEATED)]

    proposal = propose_groups(olds, news, np.ones((2, 2)), THRESHOLD)

    assert proposal.groups == (MatchGroup((1,), (10,)), MatchGroup((2,), (20,)))


def test_identical_text_still_needs_a_passing_score() -> None:
    olds, news = repeated(1), repeated(10)

    proposal = propose_groups(olds, news, np.array([[0.1]]), THRESHOLD)

    assert proposal.groups == ()
    assert (proposal.unmatched_old_ids, proposal.unmatched_target_ids) == ((1,), (10,))


def test_identical_text_does_not_cross_languages_or_kinds() -> None:
    olds = [item(1, "ko", text=REPEATED), item(2, "ko", "table", REPEATED)]
    news = [item(10, "en", text=REPEATED), item(20, "ko", "figure", REPEATED)]

    proposal = propose_groups(olds, news, np.ones((2, 2)), THRESHOLD)

    assert proposal.groups == ()


def test_blank_text_is_never_identical() -> None:
    """글이 없으면 똑같다고 말할 수 없다 — 합침은 점수가 만든 그대로다."""
    olds = [item(1, text=" "), item(2, text=" ")]

    proposal = propose_groups(olds, [item(10, text=" ")], np.array([[0.9], [0.8]]), THRESHOLD)

    assert proposal.groups == (MatchGroup((1, 2), (10,)),)


def test_empty_sides_leave_everything_unmatched() -> None:
    assert propose_groups([], [item(10)], np.zeros((0, 1)), THRESHOLD).unmatched_target_ids == (10,)
    assert propose_groups([item(1)], [], np.zeros((1, 0)), THRESHOLD).unmatched_old_ids == (1,)


def test_text_scores_compare_only_the_same_language_and_kind() -> None:
    olds = [item(1, "ko", text=TEXT_KO), item(2, "en", text=TEXT_EN)]
    news = [item(10, "ko", text=TEXT_KO), item(20, "ko", text=TEXT_EN), item(30, "ko", "table", TEXT_KO)]

    scores = build_text_scores(olds, news)

    assert scores.shape == (2, 3)
    assert scores[0, 0] == 1.0
    assert scores[0, 1] == text_similarity(TEXT_KO, TEXT_EN)
    assert scores[0, 2] == 0.0  # 글자가 같아도 종류가 다르다
    assert scores[1].tolist() == [0.0, 0.0, 0.0]  # 글자가 같아도 언어가 다르다


def test_text_scores_count_each_item_once(monkeypatch: pytest.MonkeyPatch) -> None:
    counted = record_bigram_counts(monkeypatch)  # 짝마다 다시 세면 1000 × 1000에 20초가 걸렸다
    olds = [item(1, text=ONCE_OLD), item(2, text=REPEATED)]
    news = [item(10, text=ONCE_NEW), item(20, text=TEXT_KO), item(30, text=REPEATED)]

    build_text_scores(olds, news)

    assert len(counted) == len(olds) + len(news)


def test_text_scores_equal_text_similarity_on_every_pair() -> None:
    texts = [TEXT_KO, TEXT_EN, ONCE_OLD, ONCE_NEW, "aaa", "aa", "a", "", "   ", " a a ", "abab abab", "ababab"]
    items = [item(index, text=text) for index, text in enumerate(texts)]

    scores = build_text_scores(items, items)

    np.testing.assert_allclose(scores, [[text_similarity(old, new) for new in texts] for old in texts], rtol=1e-6)


def test_text_scores_of_an_empty_side_are_an_empty_matrix() -> None:
    assert build_text_scores([], [item(10)]).shape == (0, 1)
