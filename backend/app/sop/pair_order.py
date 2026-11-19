"""짝 카드 안 순서(units.pair_seq, 편집 reorder_pair) — 문서 보기를 받는 화면과 문단 Excel이 같은 규칙으로 읽는다.

pair_seq는 사람이 카드 안 순서를 바꾼 짝의 구성원마다 0부터 매긴 값이다. 모두가 값을 갖고 겹치지 않을 때만 그 순서이고, 아니면
(바꾼 적 없음 · 그 뒤 새 구성원이 들었음 · 낡은 값이 겹침) 원문 순서다 — 짝이 바뀌어 남은 값이 순서를 흩뜨리지 않는다.
원문 글자 자리(pos_seq · pos_start)와 단위 글은 그대로다. 프런트 사본: frontend/src/lib/pair-order-model.ts `orderPairCard`.
"""

from collections.abc import Callable, Sequence
from typing import TypeVar

T = TypeVar("T")


def order_pair_card(members: Sequence[T], seq_of: Callable[[T], int | None]) -> list[T]:
    """원문 순서의 카드 구성원 → 카드 안 순서."""
    seqs = [seq_of(member) for member in members]
    if any(seq is None for seq in seqs) or len(set(seqs)) != len(seqs):
        return list(members)
    order = sorted(range(len(members)), key=lambda index: seqs[index])
    return [members[index] for index in order]
