"""counterparts — 대응 표 판정(같은 꼴 · 비슷한 차례 · 둘 다 벗긴 표 맺기)과 같은 행 · 같은 순서 짝(F8a). 순수 함수만 본다."""

from dataclasses import dataclass, field

from app.sop.counterparts import (
    WIDTH_TOLERANCE_TWIPS,
    build_row_pairs,
    build_table_facts,
    count_table_langs,
    is_same_form,
    match_unwrapped_tables,
    read_table_lang,
)

WORK = [1588, 8050]
VALUE = [2000, 2000, 2000]


@dataclass
class _Table:
    id: int
    table_index: int
    n_rows: int
    n_cols: int
    is_layout: bool = False
    signals: dict | None = field(default_factory=dict)
    parent_table_id: int | None = None
    part: str = "body"


def _facts(tables: list[_Table], langs: dict[int, str]) -> list:
    return build_table_facts(tables, {table_id: {lang: 3} for table_id, lang in langs.items()})


def _work(table_id: int, index: int, rows: int, **kwargs: object) -> _Table:
    return _Table(table_id, index, rows, 2, signals={"widths": WORK}, **kwargs)


def _value(table_id: int, index: int, rows: int, **kwargs: object) -> _Table:
    return _Table(table_id, index, rows, 3, signals={"widths": VALUE}, **kwargs)


# 한글 절반: 작업 표(3행) · 값 표(2행) · 영어 절반: 작업 표(3행) · 값 표(3행) · 작업 표(3행, 더 뒤)
HALVES = [_work(10, 0, 3), _value(11, 1, 2), _work(20, 2, 3), _value(21, 3, 3), _work(22, 4, 3)]
LANGS = {10: "ko", 11: "ko", 20: "en", 21: "en", 22: "en"}


def test_table_language_follows_the_larger_count_and_a_tie_is_none() -> None:
    counts = count_table_langs([(1, "ko"), (1, "ko"), (1, "en"), (2, "en"), (2, "ko"), (None, "ko"), (3, "neutral")])

    assert [read_table_lang(counts.get(table_id, {})) for table_id in (1, 2, 3)] == ["ko", None, None]


def test_same_form_allows_column_widths_within_a_tenth_of_a_centimetre() -> None:
    base = _facts([_work(1, 0, 3)], {1: "ko"})[0]
    near = _facts([_Table(2, 1, 5, 2, signals={"widths": [WORK[0] + WIDTH_TOLERANCE_TWIPS, WORK[1]]})], {2: "en"})[0]
    far = _facts([_Table(3, 2, 3, 2, signals={"widths": [WORK[0] + WIDTH_TOLERANCE_TWIPS + 1, WORK[1]]})], {3: "en"})[0]
    banded = _facts([_Table(4, 3, 3, 2, signals={"widths": WORK, "first_row": [[0, "band"]]})], {4: "en"})[0]
    unknown = _facts([_Table(5, 4, 3, 2, signals=None)], {5: "en"})[0]

    assert is_same_form(base, near) and not is_same_form(base, far)
    assert not is_same_form(base, banded)  # 첫 행 칸 안의 표 꼴이 다르다
    assert is_same_form(base, unknown)  # 옛 추출(열 폭 신호 없음)은 열 수로만 본다


def test_matching_unwrapped_tables_takes_the_same_form_table_with_the_same_rows_and_place_first() -> None:
    unwrapped = [_Table(**{**vars(table), "is_layout": True}) for table in HALVES]

    # 작업 표 10은 같은 꼴 · 같은 행 수 · 같은 자리의 20과(더 뒤의 22가 아니라), 값 표 11은 행 수가 달라도 같은 꼴 21과
    assert match_unwrapped_tables(_facts(unwrapped, LANGS)) == [(10, 20), (11, 21)]


def test_matching_skips_wrapped_tables_and_other_forms() -> None:
    tables = [_work(10, 0, 3, is_layout=True), _value(11, 1, 2), _work(20, 2, 3), _value(21, 3, 3, is_layout=True)]

    # 벗긴 한글 표 10의 남은 벗긴 영어 표는 다른 꼴(값 표)뿐이고, 같은 꼴 20은 아직 묶여 있다
    assert match_unwrapped_tables(_facts(tables, {10: "ko", 11: "ko", 20: "en", 21: "en"})) == []


def test_matching_does_not_pair_tables_of_one_language() -> None:
    tables = [_work(10, 0, 3, is_layout=True), _work(11, 1, 3, is_layout=True), _work(20, 2, 3)]

    assert match_unwrapped_tables(_facts(tables, {10: "ko", 11: "ko", 20: "en"})) == []


def test_band_tables_header_tables_and_inner_tables_do_not_cross() -> None:
    tables = [
        _work(10, 0, 3), _Table(12, 1, 1, 3, signals={"band": {"number": "7.4", "level": 2}}),
        _work(13, 2, 3, parent_table_id=10), _Table(14, 3, 3, 2, signals={"widths": WORK}, part="header"),
        _work(20, 4, 3), _work(23, 5, 3, parent_table_id=20),
    ]
    unwrapped = [_Table(**{**vars(table), "is_layout": True}) for table in tables]

    matches = match_unwrapped_tables(_facts(unwrapped, {10: "ko", 12: "ko", 13: "ko", 14: "ko", 20: "en", 23: "en"}))

    assert matches == [(10, 20), (13, 23)]  # 바깥 표는 바깥 표끼리, 칸 안의 표는 칸 안의 표끼리 — 띠 표 · 머리말 표는 맺지 않는다


def test_row_pairs_go_one_to_one_in_order_and_a_row_with_other_counts_is_one_chunk() -> None:
    korean = {0: [1, 2], 1: [3, 4, 5], 2: [6], 3: [7, 8, 9, 10], 4: [11]}
    english = {0: [21, 22], 1: [23, 24], 2: [], 3: [27], 5: [29]}

    assert build_row_pairs(korean, english) == [([1], [21]), ([2], [22]), ([3, 4, 5], [23, 24])]
