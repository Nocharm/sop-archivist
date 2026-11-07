"""입구 2 짝 묶기 — 옛 단위와 새 문장의 점수 행렬에서 1:1·나눔·합침 그룹을 고른다. DB도 입출력도 없는 순수 계산이고 호출부가 스레드에서 돌린다 (설계 §7.10).

점수는 고르는 데만 쓰고 결과에 싣지 않는다 — 유사도는 정답 확률이 아니다(설계 §12).
"""

from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass

import numpy as np

from app.sop.ai.similarity import text_similarity

_ONE_TO_ONE_KINDS = ("table", "figure")  # 글자를 나누거나 합칠 수 없는 종류 — 묶지 않고 1:1로만 잇는다

_Component = tuple[set[int], set[int]]  # (옛 위치들, 새 위치들)


@dataclass(frozen=True)
class MatchItem:
    """비교할 항목 — 옛 단위 또는 새 문장. text는 표면 칸 글자를 이은 것, 그림이면 캡션이다."""

    id: int
    lang: str
    kind: str
    text: str


@dataclass(frozen=True)
class MatchGroup:
    """짝 하나 — 1:1, 1:N(나눔), N:1(합침)이라 한쪽은 늘 하나다."""

    old_ids: tuple[int, ...]
    target_ids: tuple[int, ...]


@dataclass(frozen=True)
class MatchProposal:
    """모든 id는 그룹이나 unmatched 중 정확히 한곳에 나온다."""

    groups: tuple[MatchGroup, ...]
    unmatched_old_ids: tuple[int, ...]
    unmatched_target_ids: tuple[int, ...]


def _is_comparable(old: MatchItem, new: MatchItem) -> bool:
    return (old.lang, old.kind) == (new.lang, new.kind)


def build_text_scores(olds: Sequence[MatchItem], news: Sequence[MatchItem]) -> np.ndarray:
    """글자 유사도 행렬 (옛 수, 새 수) — 임베딩이 없을 때의 점수다. 언어·종류가 다른 칸은 짝이 될 수 없어 계산을 건너뛴다."""
    scores = np.zeros((len(olds), len(news)), dtype=np.float32)
    for row, old in enumerate(olds):
        for col, new in enumerate(news):
            if _is_comparable(old, new):
                scores[row, col] = text_similarity(old.text, new.text)
    return scores


def _build_same_kind_mask(olds: Sequence[MatchItem], news: Sequence[MatchItem]) -> np.ndarray:
    """언어·종류가 같은 칸 — 점수가 아무리 높아도 이 규칙이 먼저다. 수천 × 수천이라 칸마다 비교하지 않고 숫자 코드로 견준다."""
    codes: dict[tuple[str, str], int] = {}
    old_codes = np.array([codes.setdefault((old.lang, old.kind), len(codes)) for old in olds], dtype=np.int32)
    new_codes = np.array([codes.setdefault((new.lang, new.kind), len(codes)) for new in news], dtype=np.int32)
    return old_codes[:, np.newaxis] == new_codes


def _pick_best(ranked: np.ndarray, eligible: np.ndarray, axis: int) -> dict[int, int]:
    """{위치: 그 위치의 최고 상대} — axis=1이면 옛 → 새, 0이면 새 → 옛. 첫 최댓값을 주는 argmax와 id 순 행렬 덕에 동점은 작은 id가 이긴다."""
    best = ranked.argmax(axis=axis)
    return {int(index): int(best[index]) for index in np.flatnonzero(eligible.any(axis=axis))}


def _split_components(edges: Iterable[tuple[int, int]]) -> list[_Component]:
    news_of: dict[int, set[int]] = defaultdict(set)
    olds_of: dict[int, set[int]] = defaultdict(set)
    for old, new in edges:
        news_of[old].add(new)
        olds_of[new].add(old)
    components: list[_Component] = []
    seen: set[int] = set()
    for start in news_of:
        if start in seen:
            continue
        old_side, new_side = {start}, set()
        pending = [start]
        while pending:
            for new in news_of[pending.pop()] - new_side:
                new_side.add(new)
                pending += olds_of[new] - old_side
                old_side |= olds_of[new]
        seen |= old_side
        components.append((old_side, new_side))
    return components


def _reduce_to_stars(component: _Component, best_olds: Mapping[int, int]) -> list[_Component]:
    """별 모양은 그대로, N:M은 새 문장마다 최고 옛 단위 간선만 남겨 다시 나눈다 — 어느 새 문장의 최고도 아닌 옛 단위는 짝이 없어진다."""
    old_side, new_side = component
    if len(old_side) < 2 or len(new_side) < 2:
        return [component]
    stars: dict[int, set[int]] = defaultdict(set)
    for new in new_side:
        stars[best_olds[new]].add(new)
    return [({old}, news) for old, news in stars.items()]


def _list_ids(items: Sequence[MatchItem], positions: Collection[int]) -> tuple[int, ...]:
    return tuple(items[position].id for position in sorted(positions))


def propose_groups(
    olds: Sequence[MatchItem], news: Sequence[MatchItem], scores: np.ndarray, threshold: float
) -> MatchProposal:
    """점수 행렬 scores[옛][새]에서 짝을 고른다 — 넘긴 순서와 상관없이 같은 입력은 같은 결과다.

    각 옛 → 최고 새, 각 새 → 최고 옛 간선(임계값 이상, 같은 언어·종류)의 연결 요소를 구해 별 모양은 그대로 쓰고 N:M은 줄인다.
    표·그림은 서로 최고인 간선만 쓴다. 임계값과 같은 점수는 짝이다.
    """
    if not olds or not news:
        return MatchProposal((), tuple(sorted(old.id for old in olds)), tuple(sorted(new.id for new in news)))
    old_order = sorted(range(len(olds)), key=lambda index: olds[index].id)
    new_order = sorted(range(len(news)), key=lambda index: news[index].id)
    ordered_olds = [olds[index] for index in old_order]
    ordered_news = [news[index] for index in new_order]
    ordered_scores = scores[np.ix_(old_order, new_order)]

    eligible = (ordered_scores >= threshold) & _build_same_kind_mask(ordered_olds, ordered_news)
    ranked = np.where(eligible, ordered_scores, -np.inf)
    best_news = _pick_best(ranked, eligible, axis=1)
    best_olds = _pick_best(ranked, eligible, axis=0)
    edges = {*best_news.items(), *((old, new) for new, old in best_olds.items())}
    kept = [
        (old, new)
        for old, new in edges
        if ordered_olds[old].kind not in _ONE_TO_ONE_KINDS or (best_news.get(old) == new and best_olds.get(new) == old)
    ]

    pairs = [star for component in _split_components(kept) for star in _reduce_to_stars(component, best_olds)]
    groups = sorted(
        (MatchGroup(_list_ids(ordered_olds, old_side), _list_ids(ordered_news, new_side)) for old_side, new_side in pairs),
        key=lambda group: group.old_ids,
    )
    matched_olds = {old for old_side, _ in pairs for old in old_side}
    matched_news = {new for _, new_side in pairs for new in new_side}
    return MatchProposal(
        tuple(groups),
        _list_ids(ordered_olds, set(range(len(olds))) - matched_olds),
        _list_ids(ordered_news, set(range(len(news))) - matched_news),
    )
