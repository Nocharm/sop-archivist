"""새 문장을 문서 안 순서에 끼워 넣는 자리 계산 — 새로 놓이는 짝·번역의 기본 번호 표시와 순서(설계 §6 O10), manual_order 문서에서 번역을 출처 바로 뒤에 둔다."""

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import NUMBER_OMITTED, NUMBERED, NumberStyle
from app.sop.models import TargetSentence
from app.sop.segment import NEUTRAL

ENGLISH = "en"

Spot = tuple[int, str | None, int | None, str | None]  # 새 문서·칸 키·WI 단계·부분 — 기본값이 "같은 칸"으로 보는 범위


@dataclass(frozen=True)
class NewTarget:
    """저장이 새로 만드는 새 문장 하나(칸 새 문장 아님) — 기본 표시와 붙일 순서를 정하는 재료."""

    key: str  # 저장 요청의 TargetIn.key
    place: Spot
    meaning: int  # 첫 출처 단위의 짝 id, 짝 없으면 -단위 id
    lang: str
    source_unit_id: int  # 첫 출처 단위
    is_translation: bool  # 결정된 변경 종류가 translated
    source_placed: bool  # 같은 자리에 같은 출처 단위의 번역 아닌 기존 새 문장이 있다


@dataclass(frozen=True)
class Arranged:
    key: str
    number_style: NumberStyle
    after_existing_source: bool  # manual_order 문서에서 기존 출처 바로 뒤에 끼운다


def arrange_new_targets(items: Sequence[NewTarget]) -> list[Arranged]:
    """새로 놓이는 새 문장의 기본 표시와 순서 — 돌려준 순서가 끝에 붙일 순서다(설계 §6 기본값·나중 번역).

    자리별로 의미가 처음 나온 순서를 지키고, 한 의미 안에서는 번역 아닌 문장을 영어 먼저, 번역은 같은 출처 바로 뒤(없으면
    의미 끝)에 둔다. 결과물 C의 정렬 키(outputs._get_item_key)와 같은 순서라 manual_order 문서에서도 같은 모습이 된다.
    """
    by_place: dict[Spot, dict[int, list[NewTarget]]] = {}
    for item in items:
        by_place.setdefault(item.place, {}).setdefault(item.meaning, []).append(item)
    return [
        arranged
        for meanings in by_place.values()
        for group in meanings.values()
        for arranged in _arrange_meaning(group)
    ]


def _arrange_meaning(group: list[NewTarget]) -> list[Arranged]:
    """한 자리·한 의미 — 한/영 짝이 함께 처음 놓이면 첫 영어만 번호, 나머지는 생략(1:N이면 영어들 다음 한글들)."""
    ordered = sorted((item for item in group if not item.is_translation), key=lambda item: item.lang != ENGLISH)
    here = {item.source_unit_id for item in ordered}
    for item in group:
        if item.is_translation:
            # 같은 출처의 앞 번역이 이미 들었으면 그 뒤 — 번역끼리는 보낸 순서
            at = len(ordered)
            if item.source_unit_id in here:
                at = max(i for i, other in enumerate(ordered) if other.source_unit_id == item.source_unit_id) + 1
            ordered.insert(at, item)
    langs = {item.lang for item in group if not item.is_translation}
    is_pair_together = ENGLISH in langs and bool(langs - {ENGLISH, NEUTRAL})
    arranged = []
    for index, item in enumerate(ordered):
        if is_pair_together:
            style = NUMBERED if index == 0 else NUMBER_OMITTED  # 영어가 앞으로 와서 첫 줄이 첫 영어다
        elif item.is_translation and (item.source_unit_id in here or item.source_placed):
            style = NUMBER_OMITTED
        else:
            style = NUMBERED
        is_inserted = item.is_translation and item.source_placed and item.source_unit_id not in here
        arranged.append(Arranged(item.key, style, is_inserted))
    return arranged


async def insert_after(session: AsyncSession, source: TargetSentence) -> int:
    """출처 뒤 새 문장을 한 칸씩 밀고 출처 바로 뒤 order_index를 돌려준다 — 칸 새 문장은 순서에 들지 않아 건드리지 않는다.

    문서가 manual_order일 때만 부른다(아니면 순서는 결과물이 정한다). 묶음 잠금 안에서 부르므로 한 번의 UPDATE로 충분하다.
    """
    await session.execute(
        update(TargetSentence)
        .where(
            TargetSentence.target_doc_id == source.target_doc_id,
            TargetSentence.parent_target_id.is_(None),
            TargetSentence.order_index > source.order_index,
        )
        .values(order_index=TargetSentence.order_index + 1)
    )
    return source.order_index + 1
