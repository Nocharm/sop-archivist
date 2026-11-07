"""입구 2 짝 묶기(순수) — 1:1·나눔·합침, N:M 줄이기, 임계값, 언어·종류 규칙, 표·그림 1:1, 글자 점수 (설계 §7.10)."""

import numpy as np

from app.sop.ai.matching import MatchGroup, MatchItem, build_text_scores, propose_groups
from app.sop.ai.similarity import text_similarity

THRESHOLD = 0.75
TEXT_KO = "합성 장비의 전원을 켠다."
TEXT_EN = "Turn on the synthetic instrument."


def item(item_id: int, lang: str = "ko", kind: str = "sentence", text: str = "") -> MatchItem:
    return MatchItem(id=item_id, lang=lang, kind=kind, text=text)


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


def test_text_scores_of_an_empty_side_are_an_empty_matrix() -> None:
    assert build_text_scores([], [item(10)]).shape == (0, 1)
