"""번호·참조 읽기(renumber) 순수 함수 시험."""

from app.sop.renumber import (
    NumberToken,
    PlaceToken,
    find_number_tokens,
    find_caption_number,
    find_place_tokens,
    format_caption_prefix,
    has_caption_head,
    read_caption_number,
    replace_numbers,
)


def test_reads_caption_head_numbers():
    assert read_caption_number("Fig.6 Lid lock") == NumberToken("figure", 6, 4, 5)
    assert read_caption_number("표 1에 따라") is None


def test_reads_caption_head_variants():
    assert read_caption_number("표 12. 운전 조건") == NumberToken("table", 12, 2, 4)
    assert read_caption_number("Table 3: Speeds") == NumberToken("table", 3, 6, 7)
    assert read_caption_number("그림 2") == NumberToken("figure", 2, 3, 4)
    assert read_caption_number("본문 표 1") is None


def test_finds_numbered_references_in_both_languages():
    tokens = find_number_tokens("운전 조건은 표 3을 따르고 See Figure 5 and Fig. 6.")
    assert [(t.kind, t.number) for t in tokens] == [("table", 3), ("figure", 5), ("figure", 6)]


def test_reference_digit_spans_cover_digits_only():
    text = "See Fig. 6 and 표 3"
    tokens = find_number_tokens(text)
    assert [text[t.start : t.end] for t in tokens] == ["6", "3"]


def test_finds_ranges_as_two_tokens():
    for sep in ("~", "-", "–"):
        text = f"표 1{sep}3 참조"
        tokens = find_number_tokens(text)
        assert [(t.kind, t.number, text[t.start : t.end]) for t in tokens] == [("table", 1, "1"), ("table", 3, "3")]


def test_does_not_match_inside_other_words():
    assert find_number_tokens("Portable 3 units, 표준 3종") == []


def test_finds_place_references():
    assert [(t.kind, t.direction) for t in find_place_tokens("회전 속도는 아래 표를 따른다. See the figure above.")] == [
        ("table", "next"),
        ("figure", "previous"),
    ]


def test_place_vocabulary_korean_and_english():
    cases = {
        "위 그림": ("figure", "previous"),
        "다음 표": ("table", "next"),
        "앞 그림": ("figure", "previous"),
        "아래 그림": ("figure", "next"),
        "The following table": ("table", "next"),
        "the table below": ("table", "next"),
        "the above figure": ("figure", "previous"),
        "The Below Table": ("table", "next"),
    }
    for text, expected in cases.items():
        tokens = find_place_tokens(text)
        assert [(t.kind, t.direction) for t in tokens] == [expected], text
        assert (tokens[0].start, tokens[0].end) == (0, len(text)), text


def test_place_ignores_lookalike_words():
    assert find_place_tokens("아래 표현은 위 표시와 다음 표준") == []


def test_replace_numbers_changes_only_digits():
    assert replace_numbers("See Fig. 6 and 표 3", {(9, 10): 2, (17, 18): 1}) == "See Fig. 2 and 표 1"


def test_replace_numbers_handles_length_change():
    assert replace_numbers("표 9 와 표 10", {(2, 3): 10, (8, 10): 9}) == "표 10 와 표 9"


def test_format_caption_prefix():
    assert format_caption_prefix("table", 3, "ko") == "표 3. "
    assert format_caption_prefix("table", 3, "en") == "Table 3. "
    assert format_caption_prefix("figure", 3, "ko") == "그림 3. "
    assert format_caption_prefix("figure", 3, "en") == "Figure 3. "
    assert format_caption_prefix("figure", 3, "ja") == "Figure 3. "


def test_place_token_is_frozen_dataclass():
    token = PlaceToken("table", "next", 0, 3)
    assert token.direction == "next"


def _refs(text: str) -> list[tuple[str, int, str]]:
    return [(t.kind, t.number, text[t.start : t.end]) for t in find_number_tokens(text)]


def test_compound_numbers_yield_no_tokens():
    for text in ("Table 3.2", "Fig. 6-2", "Table 3-1", "Figure 4–2 shows"):
        assert find_number_tokens(text) == [], text


def test_spaced_dash_is_not_a_range():
    assert _refs("Table 5 - 10 mm") == [("table", 5, "5")]


def test_dash_range_needs_no_spaces_and_increasing_numbers():
    assert _refs("표 1-3") == [("table", 1, "1"), ("table", 3, "3")]
    assert _refs("표 1 ~ 3") == [("table", 1, "1"), ("table", 3, "3")]


def test_trailing_period_still_a_reference():
    assert _refs("see Fig. 6.") == [("figure", 6, "6")]


def test_korean_compounds_are_not_references():
    assert find_number_tokens("도표 3, 일정표 3, 시간표 2") == []
    assert _refs("(표 3) 참조") == [("table", 3, "3")]


def test_compound_caption_heads_have_no_number():
    # "Table 3-1"은 3장 1번 표 — 머리 3으로 읽으면 결과물이 "Table 1-1"로 바꾼다
    for text in ("Table 3-1. Flow rates", "표 3.2 운전 조건", "Fig. 4.1 Pump", "그림 2–3 배관"):
        assert read_caption_number(text) is None, text
        assert has_caption_head(text), text
        assert find_caption_number(text, "table") is None and find_caption_number(text, "figure") is None, text
    assert read_caption_number("Table 3. 1단계 조건") == NumberToken("table", 3, 6, 7)  # 띄운 숫자는 복합 번호가 아니다


def test_bracketed_caption_number_is_the_first_own_kind_token():
    assert not has_caption_head("<표 3> 운전 조건")
    assert find_caption_number("<표 3> 운전 조건", "table") == NumberToken("table", 3, 3, 4)
    assert find_caption_number("[그림 2] 배관도 (표 5 참조)", "figure") == NumberToken("figure", 2, 4, 5)
    assert find_caption_number("[그림 2] 배관도", "table") is None
    assert find_caption_number("운전 조건", "table") is None


def test_caption_number_takes_the_head_of_its_own_kind_only():
    assert find_caption_number("표 3. 운전 (Table 3)", "table") == NumberToken("table", 3, 2, 3)
    assert find_caption_number("Figure 2 shows Table 4", "table") is None  # 다른 종류 머리 — 본문 토큰으로 넘어가지 않는다
    assert find_caption_number("<표 3> 운전", None) is None  # 묶음 종류를 모르면 머리만 본다
    assert find_caption_number("표 3. 운전", None) == NumberToken("table", 3, 2, 3)
