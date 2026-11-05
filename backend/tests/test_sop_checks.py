"""문장 검사 — 숫자·단위·부정 차이 경고(순수 함수)."""

import time

import pytest

from app.sop.checks import check_sentence


def _kinds(warnings: list[dict[str, str]]) -> list[str]:
    return [w["kind"] for w in warnings]


def test_numbers():
    warnings = check_sentence(["5분간 원심분리한다."], "10분간 원심분리한다.")

    assert warnings == [{"kind": "number_mismatch", "source": "5", "target": "10"}]


def test_thousands_separator_is_dropped_before_comparing():
    assert check_sentence(["10,000 rpm으로 돌린다."], "Spin at 10000 rpm.") == []
    assert check_sentence(["1,000.5 mL"], "1000.5 mL") == []


def test_number_lists_are_sorted_numerically_and_joined():
    warnings = check_sentence(["10분 뒤 5회 반복"], "10분 뒤 반복")

    assert warnings == [{"kind": "number_mismatch", "source": "5, 10", "target": "10"}]


def test_repeated_number_in_one_source_must_stay_repeated():
    assert _kinds(check_sentence(["5분간 5회 반복"], "5분간 반복")) == ["number_mismatch"]
    assert check_sentence(["5분간 5회 반복"], "Repeat 5 times for 5 min") == []


def test_units():
    assert check_sentence(["4 ℃에서 보관"], "Store at 4 °C") == []

    warnings = check_sentence(["4 ℃"], "4 mL")

    assert warnings == [{"kind": "unit_mismatch", "source": "℃", "target": "mL"}]


@pytest.mark.parametrize(
    ("source", "target"),
    [
        ("5 mL", "5 ml"),
        ("5 µL", "5 uL"),
        ("5 µL", "5 μL"),
        ("300 ×g", "300 xg"),
        ("300 × g", "300 xg"),
        ("10 min", "10 분"),
        ("2 h", "2 시간"),
        ("2 hr", "2시간"),
        ("5 sec", "5 초"),
        ("10,000 rpm", "10,000 RPM"),
        ("5 minutes", "5 min"),
        ("2 hours", "2 h"),
        ("30 seconds", "30 sec"),
        ("4 ℃", "4 °C"),
        ("4 ℃", "4℃"),
        ("4 ºC", "4 °C"),
        ("５ ㎖", "5 mL"),
        ("0.5 ㎕", "0.5 µL"),
        ("0.5 ul", "0.5 uL"),
        ("３０ ％", "30 %"),
    ],
)
def test_same_meaning_units_are_equal(source: str, target: str):
    assert check_sentence([source], target) == []


@pytest.mark.parametrize(
    ("source", "target", "source_value", "target_value"),
    [
        ("5 mL", "5 L", "mL", "L"),
        ("5 g", "5 mg", "g", "mg"),
        ("5 mg", "5 kg", "mg", "kg"),
        ("5 kPa", "5 MPa", "kPa", "MPa"),
        ("2 bar", "2 psi", "bar", "psi"),
        ("5 min", "5 h", "min", "h"),
        ("30 %", "30 g", "%", "g"),
        ("300 ×g", "300 rpm", "×g", "rpm"),
    ],
)
def test_different_units_warn_with_group_labels(source: str, target: str, source_value: str, target_value: str):
    assert check_sentence([source], target) == [
        {"kind": "unit_mismatch", "source": source_value, "target": target_value}
    ]


def test_unit_follows_number_through_korean_particles():
    assert check_sentence(["10 mL로 희석한다."], "Dilute with 10 mL.") == []
    assert check_sentence(["5분간 방치한다."], "Leave for 5 min.") == []
    assert check_sentence(["4 ℃에서 보관"], "Store at 4 mL") == [
        {"kind": "unit_mismatch", "source": "℃", "target": "mL"}
    ]


def test_words_containing_a_unit_string_never_count():
    # 숫자 바로 뒤가 아니면 단위가 아니다. 분리·부분·시간표·Label
    assert check_sentence(["원심분리한 부분을 시간표대로 둔다."], "Label the tube.") == []
    # 숫자 뒤라도 라틴 단위 뒤에 라틴 글자가 이어지면 다른 낱말이다
    assert check_sentence(["5 Label"], "5 tubes") == []
    assert check_sentence(["5 gal"], "5 tubes") == []
    assert check_sentence(["5 hours"], "5 hourglass") == [
        {"kind": "unit_mismatch", "source": "h", "target": ""}
    ]


def test_latin_unit_followed_by_latin_letter_is_not_a_unit():
    assert check_sentence(["5 mind"], "5 min") == [{"kind": "unit_mismatch", "source": "", "target": "min"}]


def test_long_spelling_maps_to_one_group_not_two():
    warnings = check_sentence(["Incubate for 5 minutes."], "Incubate for 5 hours.")

    assert warnings == [{"kind": "unit_mismatch", "source": "min", "target": "h"}]


def test_hyphenated_compound_still_counts_as_unit():
    assert check_sentence(["15 mL 튜브를 쓴다."], "Use a 15-mL tube.") == []
    assert check_sentence(["5분간 배양한다."], "Run a 5-minute incubation.") == []


def test_threshold_word_is_not_seconds():
    # "10 mL 초과"의 초과는 초(sec)가 아니다
    assert check_sentence(["10 mL 초과"], "More than 10 mL") == []
    assert check_sentence(["10초과"], "Over 10") == []
    assert check_sentence(["10초간 둔다."], "Leave 10") == [{"kind": "unit_mismatch", "source": "sec", "target": ""}]


def test_negation_cross_language():
    korean = "직사광선에 두지 않는다."

    assert check_sentence([korean], "Keep in direct sunlight.") == [
        {"kind": "negation_mismatch", "source": "yes", "target": "no"}
    ]
    assert check_sentence([korean], "Do not keep in direct sunlight.") == []
    assert check_sentence(["Keep in direct sunlight."], korean) == [
        {"kind": "negation_mismatch", "source": "no", "target": "yes"}
    ]


@pytest.mark.parametrize(
    "text",
    [
        "사용을 금지한다.",
        "열어 두지 말 것",
        "열어 두지 말것",
        "내용물이 없다.",
        "재사용 불가",
        "이 방법은 아니다.",
        "Do not open.",
        "DO NOT open.",
        "Never open.",
        "Open without gloves.",
        "Opening is prohibited.",
        "You cannot open it.",
        "Don't open it.",
        "Don’t open it.",
        "Nothing happens. None remain.",
        "Answer: no.",
        "No samples remain.",
    ],
)
def test_negation_dictionary_hits(text: str):
    assert _kinds(check_sentence(["열어 둔다."], text)) == ["negation_mismatch"]


@pytest.mark.parametrize(
    "text",
    [
        "Take note of the knowledge base.",
        "A notice is posted.",
        "Nothing is wrong.",
        "SOP No. 12 applies.",
        "Doc. no.5 applies.",
        "불가피한 경우 열어 둔다.",
        "Open the lid.",
    ],
)
def test_negation_dictionary_ignores_lookalikes(text: str):
    assert [w for w in check_sentence(["열어 둔다."], text) if w["kind"] == "negation_mismatch"] == []


def test_negation_present_on_both_sides_is_fine():
    assert check_sentence(["열어 두지 않는다."], "Do not open it.") == []
    assert check_sentence(["열어 두지 않는다. 사용을 금지한다."], "Do not open it.") == []


def test_merged_sources():
    sources = ["5분간 원심분리한다.", "그 뒤 10 mL를 옮긴다."]

    assert check_sentence(sources, "Centrifuge for 5 min, then transfer 10 mL.") == []
    # 합친 출처에 없는 숫자·단위가 새 문장에 생기면 경고
    warnings = check_sentence(sources, "Centrifuge for 5 min, then transfer 20 mL at 4 °C.")
    assert warnings == [
        {"kind": "number_mismatch", "source": "5, 10", "target": "4, 5, 20"},
        {"kind": "unit_mismatch", "source": "mL, min", "target": "℃, mL, min"},
    ]
    # 출처 한 문장에만 부정이 있어도 출처 쪽은 있음
    assert check_sentence(["열어 둔다.", "닫지 않는다."], "Close it.") == [
        {"kind": "negation_mismatch", "source": "yes", "target": "no"}
    ]


def test_bilingual_pair_sources_do_not_double_count_numbers():
    sources = ["5분간 원심분리한다.", "Centrifuge for 5 min."]

    assert check_sentence(sources, "Centrifuge for 5 min.") == []


def test_warnings_are_plain_ordered_and_hold_no_sentence_text():
    warnings = check_sentence(["5분간 두지 않는다."], "Leave it for 10 mL.")

    assert _kinds(warnings) == ["number_mismatch", "unit_mismatch", "negation_mismatch"]
    for warning in warnings:
        assert set(warning) == {"kind", "source", "target"}
        assert all(isinstance(value, str) for value in warning.values())
    assert warnings[0] == {"kind": "number_mismatch", "source": "5", "target": "10"}
    assert warnings[1] == {"kind": "unit_mismatch", "source": "min", "target": "mL"}
    assert warnings[2] == {"kind": "negation_mismatch", "source": "yes", "target": "no"}


def test_result_does_not_depend_on_source_order():
    sources = ["그 뒤 10 mL를 옮긴다.", "5분간 원심분리한다."]
    target = "Centrifuge for 7 min."

    assert check_sentence(sources, target) == check_sentence(list(reversed(sources)), target)
    assert check_sentence(sources, target) == check_sentence(sources, target)


def test_invisible_chars_do_not_hide_a_unit():
    assert check_sentence(["5\u200b분간 방치"], "Leave for 5 min") == []


def test_no_warning_when_nothing_to_compare():
    assert check_sentence(["원심분리한다."], "Centrifuge.") == []
    assert check_sentence([], "") == []


def test_long_input_stays_linear():
    # 흔한 역추적 폭발 모양을 10만 자씩 — 각각 끝나야 하고 합쳐 몇 초 안에 끝난다
    shapes = [
        "1," * 50_000,
        "1." * 50_000,
        "5 " * 50_000,
        "5" + " " * 100_000 + "x",
        "5-" * 50_000,
        "0" * 100_000,
        "No. " * 25_000,
        "5 mL " * 20_000,
        "않 " * 50_000,
    ]

    started = time.perf_counter()
    for text in shapes:
        check_sentence([text], text + " 끝")
    elapsed = time.perf_counter() - started

    assert elapsed < 5.0
