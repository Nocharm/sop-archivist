"""본문 앞부분(front) · 개정 이력(history) — 저절로 삭제된 줄을 찾는 규칙, 잠금, 사유, 여기부터 본문, 결과물(쪼개기 먼저 설계 §7 R3)."""

import pytest

from app.sop.noise import (
    NOISE_FRONT,
    NOISE_HISTORY,
    NOISE_KINDS,
    NOISE_TOC,
    NoiseLine,
    find_body_starts,
    find_noise_lines,
    is_history_heading,
)

KO, EN, BOTH, NEUTRAL = frozenset({"ko"}), frozenset({"en"}), frozenset({"ko", "en"}), frozenset()


# --- 판정 규칙(순수) ---


def _line(kind: str, text: str, langs: frozenset[str] = KO, **fields) -> NoiseLine:
    return NoiseLine(
        kind=kind, text=text, langs=langs, number=fields.get("number"), level=fields.get("level"),
        is_body=fields.get("is_body", True), is_flow=fields.get("is_flow", True), noise=fields.get("noise"),
    )


def _p(text: str, langs: frozenset[str] = KO, **fields) -> NoiseLine:
    return _line("sentence", text, langs, **fields)


def _h(text: str, langs: frozenset[str] = KO, *, level: int = 1, number: str | None = None, **fields) -> NoiseLine:
    return _line("heading", text, langs, level=level, number=number, **fields)


def _toc(text: str, langs: frozenset[str] = KO) -> NoiseLine:
    return _p(text, langs, noise=NOISE_TOC)


def _table(*cells: str, langs: frozenset[str] = KO) -> list[NoiseLine]:
    return [
        _line("table", "", langs, is_flow=False), *(_line("cell_sentence", cell, langs, is_flow=False) for cell in cells),
    ]


def _find(lines: list[NoiseLine], *, separate: bool = False) -> list[str | None]:
    found = find_noise_lines(lines, separate=separate)
    return [found.get(index) for index in range(len(lines))]


BODY = [_h("1. 목적", number="1."), _p("탱크 세척 방법을 정한다."), _h("2. 범위", number="2."), _p("합성 공정에 적용한다.")]
EN_BODY = [
    _h("1. Purpose", EN, number="1."), _p("This procedure defines how to clean the tank.", EN),
    _h("2. Scope", EN, number="2."), _p("It applies to the synthetic process.", EN),
]


def test_everything_before_chapter_one_is_front_and_contents_stay_contents() -> None:
    front = [
        _p("합성 표준 절차서"), *_table("문서 번호", "SOP-QC-0001", langs=BOTH), *_table("작성", "검토", "승인"),
        _h("Summary of Changes", EN), *_table("개정", "1. 처음 만듦"), _p("목차"),
    ]
    contents = [_toc("1. 목적 ........ 3"), _toc("2. 범위 ........ 3")]

    assert _find([*front, *contents, *BODY]) == [NOISE_FRONT] * len(front) + [None] * (len(contents) + len(BODY))


def test_each_half_of_a_separate_document_drops_its_own_front() -> None:
    korean = [_p("합성 표준 절차서"), *_table("승인", "홍보팀"), _toc("1. 목적 ........ 3")]
    tail = [_p("첨부 1 기록지"), *_table("항목", "온도")]
    english = [_p("Synthetic Standard Procedure", EN), *_table("Approved", langs=EN), _toc("1. Purpose ........ 3", EN)]
    lines = [*korean, *BODY, *tail, *english, *EN_BODY]

    assert _find(lines, separate=True) == [
        *[NOISE_FRONT] * 4, None, *[None] * (len(BODY) + len(tail)), *[NOISE_FRONT] * 3, None, *[None] * len(EN_BODY)
    ]
    assert find_body_starts(lines, separate=True) == [5, 5 + len(BODY) + len(tail) + len(english)]


def test_a_korean_attachment_table_is_not_taken_by_the_second_half() -> None:
    bilingual = _table("항목 Item", "온도", langs=BOTH)
    english = [_p("Synthetic Standard Procedure", EN)]

    found = _find([*BODY, *bilingual, *english, *EN_BODY], separate=True)

    assert found == [None] * (len(BODY) + len(bilingual)) + [NOISE_FRONT] + [None] * len(EN_BODY)


def test_a_leading_figure_of_the_second_run_is_left_alone() -> None:
    # 첫 반쪽 끝의 그림은 어느 쪽인지 알 수 없다 — 사이에 낀 그림은 앞부분이다
    figure = _line("figure", "", NEUTRAL, is_flow=False)
    english = [_p("Synthetic Standard Procedure", EN), figure, _p("Issued by the synthetic team", EN)]

    found = _find([*BODY, figure, *english, *EN_BODY], separate=True)

    assert found == [None] * (len(BODY) + 1) + [NOISE_FRONT] * 3 + [None] * len(EN_BODY)


def test_interleaved_documents_have_one_start() -> None:
    lines = [_p("합성 표준 절차서"), *BODY, _p("Synthetic note", EN), *EN_BODY]

    assert find_body_starts(lines, separate=False) == [1]
    assert _find(lines) == [NOISE_FRONT] + [None] * (len(lines) - 1)


def test_a_one_inside_a_table_is_not_a_start() -> None:
    cells = [_line("table", "", KO, is_flow=False), _line("cell_sentence", "1. 처음 만듦", KO, is_flow=False, number="1.")]

    assert _find([_p("표지"), *cells]) == [None] * 3
    assert _find([_p("표지"), *cells, *BODY]) == [NOISE_FRONT] * 3 + [None] * len(BODY)


def test_a_band_heading_is_a_start() -> None:
    assert _find([_p("표지"), _h("1 목적", number="1")]) == [NOISE_FRONT, None]


def test_header_and_footer_lines_are_never_marked() -> None:
    header = _p("합성 머리말", is_body=False)

    assert _find([header, _p("표지"), *BODY, _h("개정 이력", number="9."), header]) == [
        None, NOISE_FRONT, *[None] * len(BODY), NOISE_HISTORY, None
    ]


def test_history_before_chapter_one_is_front() -> None:
    assert _find([_h("Revision History", EN), _p("처음 만들었다."), *BODY]) == [NOISE_FRONT] * 2 + [None] * len(BODY)


def test_history_ends_at_a_heading_of_the_same_or_higher_level() -> None:
    history = [
        _h("9. Document Change History", EN, number="9."), _p("개정 내용을 적는다."), _h("9.1 개정 1", level=2, number="9.1"),
        *_table("Rev", "Change", langs=EN),
    ]
    after = [_h("10. 첨부", number="10."), _p("기록지를 붙인다.")]

    assert _find([*BODY, *history, *after]) == [None] * len(BODY) + [NOISE_HISTORY] * len(history) + [None] * 2
    nested = [_h("9. 기록", number="9."), _h("9.1 개정 이력", level=2, number="9.1"), _p("처음 만들었다."), *after]
    assert _find([*BODY, *nested]) == [None] * (len(BODY) + 1) + [NOISE_HISTORY] * 2 + [None] * 2


def test_no_chapter_one_marks_nothing() -> None:
    lines = [_p("합성 안내문"), *_table("작성"), _h("2. 범위", number="2."), _h("개정 이력"), _p("처음 만들었다.")]

    assert _find(lines) == [None] * len(lines)
    assert find_body_starts(lines, separate=False) == []


def test_a_list_one_inside_a_body_that_starts_elsewhere_marks_nothing() -> None:
    # 5장에서 시작하는 문서의 단계 "1." — 앞의 장을 앞부분으로 지우지 않는다(Review Focus 4)
    numbered = [_h("5. 절차", number="5."), _p("탱크를 비운다."), _p("1. 전원을 켠다.", number="1.")]
    clauses = [_p("5.1 탱크를 비운다.", number="5.1"), _p("1. 전원을 켠다.", number="1.")]
    # 번호 없는 장 제목 아래의 단계도 본문 시작이 아니다
    unnumbered = [_h("목적"), _p("탱크 세척 방법을 정한다."), _h("절차"), _p("1. 전원을 켠다.", number="1.")]
    deeper = [_h("절차"), _h("1. 준비", level=2, number="1."), _p("탱크를 비운다.")]

    for lines in (numbered, clauses, unnumbered, deeper):
        assert _find(lines) == [None] * len(lines)
        assert find_body_starts(lines, separate=False) == []


def test_front_titles_and_dates_do_not_hide_chapter_one() -> None:
    front = [_h("승인"), _p("2026.01.02 작성", number="2026.01.02"), _p("01 개정", number="01"), _h("개정 이력")]

    assert _find([*front, *BODY]) == [NOISE_FRONT] * 4 + [None] * len(BODY)
    # 장 번호를 글로만 쓴 문서 — 제목이 없으면 번호 문단이 본문 시작이다
    assert _find([_p("표지"), _p("1. 목적", number="1."), _p("글이다.")]) == [NOISE_FRONT, None, None]


@pytest.mark.parametrize(
    "text",
    ["Summary of Change", "SUMMARY OF CHANGES", "Revision History", "Document Change History", "개정 이력", "변경이력",
     "9. Document Change History", "변경 이력 (Revision History)", "개정 이력 / Revision History:"],
)
def test_history_headings(text: str) -> None:
    assert is_history_heading(text)


@pytest.mark.parametrize("text", ["변경 관리", "Change Control", "개정 이력 관리 절차", "Revision", "", "개정 이력 " * 60])
def test_other_headings_are_not_history(text: str) -> None:
    assert not is_history_heading(text)


def test_noise_kinds_fit_the_column() -> None:
    assert NOISE_KINDS == (NOISE_TOC, NOISE_FRONT, NOISE_HISTORY) == ("toc", "front", "history")
    assert max(map(len, NOISE_KINDS)) <= 8
