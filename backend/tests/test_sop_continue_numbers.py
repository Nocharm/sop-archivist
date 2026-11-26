"""벗긴 표 번호 이어 매기기 · 합치면 뒤 번호 당기기(11-23 명세 D1, 쪼개기 먼저 설계 §9 · §11-1) — 순수 규칙의 정답 표."""

import pytest

from app.sop.numbering import FlowLine, plan_continue

TABLE = 9  # 벗기는 표


def H(number: str, lang: str = "ko") -> FlowLine:  # 정답 표의 기호(제목)
    return FlowLine(number=number, lang=lang, kind="heading")


def B(number: str, lang: str = "ko") -> FlowLine:  # 본문
    return FlowLine(number=number, lang=lang, kind="sentence")


def C(number: str, lang: str = "ko", *, is_cell: bool = True) -> FlowLine:  # 벗기는 표의 숫자 칸
    return FlowLine(number=number, lang=lang, kind="cell_sentence", table_id=TABLE, is_cell=is_cell)


def T(table_id: int, number: str, lang: str = "ko") -> FlowLine:  # 이미 매긴 앞 표의 줄
    return FlowLine(number=number, lang=lang, kind="cell_sentence", table_id=table_id)


def L(number: str | None, lang: str = "ko") -> FlowLine:  # 벗기는 표의 숫자 칸이 아닌 줄
    return FlowLine(number=number, lang=lang, kind="cell_sentence", table_id=TABLE)


ANSWERS = [
    ([H("5"), C("1"), C("2"), C("3")], {1: "5.1", 2: "5.2", 3: "5.3"}),
    ([H("5"), T(8, "5.1"), T(8, "5.2"), T(8, "5.3"), C("1"), C("2")], {4: "5.4", 5: "5.5"}),
    ([H("5"), B("5.1"), C("1"), C("2")], {2: "5.2", 3: "5.3"}),
    ([B("5.2"), C("1"), C("2")], {1: "5.2.1", 2: "5.2.2"}),
    ([H("5"), B("1)"), C("1"), C("2")], {2: "5.1", 3: "5.2"}),
    ([H("5"), B("•"), C("1"), C("2")], {2: "5.1", 3: "5.2"}),
    ([C("1"), C("2"), C("3")], {}),
    ([H("5"), B("5.1"), H("5", lang="en"), C("1", lang="en"), C("2", lang="en")], {3: "5.1", 4: "5.2"}),
]


@pytest.mark.parametrize(("lines", "expected"), ANSWERS)
def test_answer_table(lines: list[FlowLine], expected: dict[int, str]) -> None:
    assert plan_continue(lines, TABLE) == expected


def test_only_number_cells_change() -> None:
    assert plan_continue([H("5"), C("1"), L("•"), L("A-1"), L(None), C("2")], TABLE) == {1: "5.1", 5: "5.2"}


def test_heading_above_is_always_the_parent() -> None:
    assert plan_continue([H("5"), H("5.1"), C("1")], TABLE) == {2: "5.1.1"}


def test_two_languages_share_the_numbers() -> None:
    lines = [H("5"), H("5", lang="en"), C("1"), C("1", lang="en"), C("2"), C("2", lang="en")]

    assert plan_continue(lines, TABLE) == {2: "5.1", 3: "5.1", 4: "5.2", 5: "5.2"}


def test_numbers_a_person_fixed_stay() -> None:
    assert plan_continue([H("5"), C("7", is_cell=False), C("1")], TABLE) == {2: "5.1"}


def test_the_cell_keeps_its_trailing_dot_and_a_deeper_cell_follows_the_row_above() -> None:
    assert plan_continue([H("5."), C("1."), C("1.1"), C("2")], TABLE) == {1: "5.1.", 2: "5.1.1", 3: "5.2"}
