"""의미 묶음 줄 — 진행 숫자(`load_bundle_progress`)·배정 화면(`buildRows`)과 같은 줄(짝 하나·짝 없는 판단 단위 하나)의 스냅숏 목록."""

from collections import defaultdict
from dataclasses import dataclass

from app.sop.captions import CAPTION_KIND
from app.sop.refs import REF_LANG
from app.sop.snapshot import (
    NEUTRAL,
    SINGLE_LANGUAGE_KINDS,
    TWO_LANGUAGE_LAYOUTS,
    BundleSnapshot,
    TargetInfo,
    UnitInfo,
)
from app.sop.status import get_cover_status, pick_row_status


@dataclass(frozen=True)
class MeaningRow:
    key: int  # 짝 id, 짝이 없으면 -단위 id(진행 숫자의 row_key와 같은 값)
    unit_ids: tuple[int, ...]  # 판단 단위(묶인 칸 제외) order_key 순
    status: str  # 구성 단위 중 가장 덜 끝난 상태


def _list_old_free_units(snap: BundleSnapshot) -> list[UnitInfo]:
    """옛 문서의 활성·묶이지 않은 단위(표·행 단위 포함), order_key 순."""
    old_document_ids = {document.id for document in snap.documents.values() if document.side == "old"}
    return sorted(
        (unit for unit in snap.units.values() if unit.document_id in old_document_ids and unit.group_unit_id is None),
        key=lambda unit: unit.order_key,
    )


def _list_judged_units(snap: BundleSnapshot) -> list[UnitInfo]:
    """판단 단위 — 옛 문서의 활성·묶이지 않은 단위 중 잡음 표시가 없는 것, order_key 순. 진행 숫자의 판단 단위와 같다."""
    return [unit for unit in _list_old_free_units(snap) if unit.noise_kind is None]


def list_noise_units(snap: BundleSnapshot) -> list[UnitInfo]:
    """잡음 표시(목차 줄)가 붙은 옛 문서 단위, order_key 순 — 판단 줄이 아니라 결과물 A의 "삭제 · 목차" 줄과 요약의 수로만 나간다."""
    return [unit for unit in _list_old_free_units(snap) if unit.noise_kind is not None]


def get_meaning_key(snap: BundleSnapshot, unit_id: int) -> int:
    return snap.pair_of.get(unit_id, -unit_id)


def build_meaning_rows(snap: BundleSnapshot) -> list[MeaningRow]:
    """의미 묶음 줄 목록 — 첫 단위 order_key 순."""
    members: dict[int, list[UnitInfo]] = defaultdict(list)
    for unit in _list_judged_units(snap):
        members[get_meaning_key(snap, unit.id)].append(unit)
    return [
        MeaningRow(
            key=key,
            unit_ids=tuple(unit.id for unit in units),
            status=pick_row_status(get_cover_status(unit, snap.decisions) for unit in units),
        )
        for key, units in members.items()  # 삽입 순서 = 첫 단위 order_key 순
    ]


def _has_other_language_target(unit: UnitInfo, targets: list[TargetInfo]) -> bool:
    return any(target.lang != unit.lang and target.lang != NEUTRAL for target in targets)


def _list_assigned_captions(snap: BundleSnapshot) -> list[UnitInfo]:
    """판단이 배정인 묶음(표·행·그림)에 딸린 옛 문서의 활성 캡션 단위 — 묶음이 지워지거나 미배정이면 캡션은 나가지 않는다."""
    old_document_ids = {document.id for document in snap.documents.values() if document.side == "old"}
    return [
        unit for unit in snap.units.values()
        if unit.kind == CAPTION_KIND and unit.document_id in old_document_ids and unit.group_unit_id is not None
        and (decision := snap.decisions.get(unit.group_unit_id)) is not None and decision.disposition == "assigned"
    ]


def count_single_language(snap: BundleSnapshot) -> int:
    """두 언어 문서에서 짝도 다른 언어 새 문장(번역 출처·출처 연결)도 없는 글 단위(문장·제목) 수.

    칸 문장은 세지 않지만 캡션은 표·그림 이름이라 한 언어뿐이면 센다 — 배정한 묶음의 것만(표·그림 명세 §3.2).
    """
    targets_of: dict[int, list[TargetInfo]] = defaultdict(list)
    for target in snap.targets.values():
        if target.translation_source_unit_id is not None:
            targets_of[target.translation_source_unit_id].append(target)
        for unit_id in target.source_unit_ids:
            targets_of[unit_id].append(target)
    texts = [unit for unit in _list_judged_units(snap) if unit.kind in SINGLE_LANGUAGE_KINDS]
    return sum(
        1
        for unit in (*texts, *_list_assigned_captions(snap))
        if unit.id not in snap.pair_of
        and unit.lang != REF_LANG
        and snap.documents[unit.document_id].language_layout in TWO_LANGUAGE_LAYOUTS
        and not _has_other_language_target(unit, targets_of[unit.id])
    )


def get_new_meaning_key(snap: BundleSnapshot, target: TargetInfo) -> int:
    """입구 2 새 문장이 놓일 의미 묶음 키(제품 명세 §7.13 줄 규칙 (4)) — 출처 단위의 짝, 짝이 없으면 -단위 id."""
    assert target.new_unit_id is not None
    return get_meaning_key(snap, target.new_unit_id)
