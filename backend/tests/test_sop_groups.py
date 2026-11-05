"""관계 묶음 ID — 나눔·합침 연결 요소에만 붙고, 표 하나(표 단위·칸 문장·표/칸 새 문장)는 접어서 묶음으로 잡지 않는다."""

from app.sop.groups import build_group_ids, collapse_table_members

# 단위 정렬 키(쪽, 문서, pos_seq, pos_start, id) — 단위 4는 id가 더 크지만 앞 문서라 3보다 앞선다
UNIT_ORDER = {
    1: (0, 1, 1, 0, 1),
    2: (0, 1, 2, 0, 2),
    3: (0, 2, 1, 0, 3),
    4: (0, 1, 9, 0, 4),
}
DISPLAY_IDS = {1: "OLD-1-001", 2: "OLD-1-002", 3: "OLD-2-001", 4: "OLD-1-009"}


def test_build_group_ids_only_for_splits_and_merges() -> None:
    edges = [
        (10, 1),  # 1:1 — 묶음 없음
        (11, 2), (12, 2),  # 한 단위 → 새 문장 둘(나눔)
        (13, 3), (13, 4),  # 두 단위 → 새 문장 하나(합침)
    ]

    unit_groups, target_groups = build_group_ids(edges, UNIT_ORDER, DISPLAY_IDS)

    assert unit_groups == {2: "G-OLD-1-002", 3: "G-OLD-1-009", 4: "G-OLD-1-009"}
    assert target_groups == {11: "G-OLD-1-002", 12: "G-OLD-1-002", 13: "G-OLD-1-009"}


def test_a_table_with_its_cells_is_one_to_one_after_collapsing() -> None:
    # 표 단위 7(칸 문장 8·9) → 표 새 문장 20, 칸 새 문장 21·22 — 접으면 (20, 7) 하나
    edges = [(20, 7), (21, 8), (22, 9)]
    order = {7: (0, 1, 5, -1, 7), 8: (0, 1, 5, 0, 8), 9: (0, 1, 6, 0, 9)}
    display = {7: "OLD-1-007", 8: "OLD-1-008", 9: "OLD-1-009"}

    collapsed = collapse_table_members(edges, {8: 7, 9: 7}, {21: 20, 22: 20})

    assert collapsed == [(20, 7)]
    assert build_group_ids(collapsed, order, display) == ({}, {})
    # 표 단위가 표 새 문장 말고 다른 새 문장으로도 가면 접은 뒤 단위 하나 → 새 문장 둘이라 나눔 묶음이다
    split = collapse_table_members([(20, 7), (21, 8), (23, 7)], {8: 7}, {21: 20})
    assert build_group_ids(split, order, display) == ({7: "G-OLD-1-007"}, {20: "G-OLD-1-007", 23: "G-OLD-1-007"})
