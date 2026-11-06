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
        "안전하게 열어 둔다.",
        "마찬가지로 열어 둔다.",
        "안내에 따라 열어 둔다.",
        "말라리아 시료를 열어 둔다.",
        "마라톤 뒤 열어 둔다.",
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
        "-5 " * 33_000,
        ".5 " * 33_000,
        "5 to " * 20_000,
        "5 또는 " * 20_000,
        "5 ± " * 25_000,
        "5분과 " * 25_000,
        "4/-" * 33_000,
        "말라" * 50_000,
        "10" + "⁶" * 100_000,
        "1.1." * 25_000 + " x",
        "123." * 25_000,
        "1-" * 50_000,
        "5 mL ~ " * 15_000,
    ]

    started = time.perf_counter()
    for text in shapes:
        check_sentence([text], text + " 끝")
    elapsed = time.perf_counter() - started

    assert elapsed < 5.0


# 아래는 수정 1회차(R22~R26) 고정 테스트


def test_common_korean_prohibition_forms_match_english_do_not():
    english = "Do not open the lid."
    for korean in (
        "뚜껑을 열지 마십시오.",
        "뚜껑을 열면 안 된다.",
        "뚜껑을 열어서는 안 된다.",
        "뚜껑을 열지 말아야 한다.",
    ):
        assert check_sentence([korean], english) == []
        assert check_sentence([english], korean) == []


@pytest.mark.parametrize(
    "korean",
    [
        "뚜껑을 열지 마십시오.",
        "뚜껑을 열지 마시오.",
        "뚜껑을 열지 마세요.",
        "뚜껑을 열지 마라.",
        "뚜껑을 열지 말라.",
        "뚜껑을 열지 말아야 한다.",
        "뚜껑을 열지 말고 둔다.",
        "뚜껑을 열면 안 된다.",
        "뚜껑을 열면 안됨",
        "뚜껑을 열면 안 돼.",
        "뚜껑을 열면 안 됩니다.",
        "뚜껑을 열면 안 되며 닫아 둔다.",
        "뚜껑을 열 수 못 한다.",
        "뚜껑을 열지 못하다.",
        "뚜껑을 열지 못함",
        "뚜껑 개방을 금함",
        "뚜껑 개방을 금한다.",
    ],
)
def test_korean_prohibition_forms_count_as_negation(korean: str):
    assert check_sentence([korean], "Open the lid.") == [
        {"kind": "negation_mismatch", "source": "yes", "target": "no"}
    ]


def test_no_before_a_label_number_is_not_negation_but_bare_no_before_digit_is():
    assert check_sentence(["문서 번호 12"], "Document No. 12") == []
    assert check_sentence(["문서 번호 12"], "Document no.12") == []
    assert check_sentence(["남은 것은 5개"], "no 5 items remain") == [
        {"kind": "negation_mismatch", "source": "no", "target": "yes"}
    ]


def test_leading_sign_belongs_to_the_number():
    assert check_sentence(["-20 ℃에서 보관"], "Store at 20 °C") == [
        {"kind": "number_mismatch", "source": "-20", "target": "20"}
    ]
    assert check_sentence(["-20 ℃에서 보관"], "Store at -20 °C") == []
    assert check_sentence(["Store (-20 ℃)"], "Store at -20 °C") == []


@pytest.mark.parametrize("minus", ["−", "–", "‐", "－"])
def test_minus_sign_variants_fold_to_one_sign(minus: str):
    assert check_sentence([f"{minus}20 ℃에서 보관"], "Store at -20 °C") == []


def test_hyphen_between_numbers_is_a_range_not_a_sign():
    assert check_sentence(["2-8 ℃에서 보관"], "Store at 2 to 8 °C") == []
    assert check_sentence(["5–10 min"], "5-10 분") == []
    assert check_sentence(["5–10 min"], "10 min") == [
        {"kind": "number_mismatch", "source": "5, 10", "target": "10"}
    ]
    assert check_sentence(["-20 ~ -10 ℃"], "-20 to -10 °C") == []


def test_slash_before_a_minus_is_a_sign():
    assert check_sentence(["4 ℃/-20 ℃에서 보관"], "Store at 4 °C / -20 °C") == []
    assert check_sentence(["4 ℃/20 ℃에서 보관"], "Store at 4 °C / -20 °C") == [
        {"kind": "number_mismatch", "source": "4, 20", "target": "-20, 4"}
    ]


def test_hyphen_after_a_letter_is_a_name_not_a_sign():
    assert check_sentence(["Step-2 수행"], "Step 2") == []
    assert check_sentence(["COVID-19 시료"], "COVID 19 sample") == []


def test_leading_dot_decimal_is_zero_point():
    assert check_sentence([".5 mL를 넣는다."], "Add 0.5 mL.") == []
    assert check_sentence([".5 mL를 넣는다."], "Add 5 mL.") == [
        {"kind": "number_mismatch", "source": "0.5", "target": "5"}
    ]
    # 글자에 붙은 점은 소수가 아니다
    assert check_sentence(["Fig.5 참조"], "See Fig 5") == []


def test_superscript_exponent_keeps_its_identity():
    assert check_sentence(["1×10⁶ cells"], "1×10^6 cells") == []
    assert check_sentence(["1×10⁶ cells"], "106 cells") == [
        {"kind": "number_mismatch", "source": "1, 6, 10", "target": "106"}
    ]
    assert check_sentence(["10⁻⁶ M"], "10^-6 M") == []
    assert check_sentence(["10⁻⁶ M"], "10⁶ M") == [
        {"kind": "number_mismatch", "source": "-6, 10", "target": "6, 10"}
    ]


def test_swapped_number_unit_pairs_warn_as_unit_mismatch():
    assert check_sentence(["5 mL, 10 min"], "5 mL, 10 min") == []
    assert check_sentence(["5 mL, 10 min"], "10 mL, 5 min") == [
        {"kind": "unit_mismatch", "source": "5 mL, 10 min", "target": "5 min, 10 mL"}
    ]
    assert check_sentence(["5분간 원심분리 후 10 mL를 옮긴다."], "Transfer 5 mL after centrifuging for 10 min.") == [
        {"kind": "unit_mismatch", "source": "5 min, 10 mL", "target": "5 mL, 10 min"}
    ]


def test_unit_dropped_from_one_number_warns_as_pair_mismatch():
    assert check_sentence(["5 mL를 넣고 10 mL를 넣는다."], "Add 5 mL, then add 10.") == [
        {"kind": "unit_mismatch", "source": "5 mL, 10 mL", "target": "5 mL"}
    ]


def test_pair_check_stays_quiet_when_numbers_or_unit_sets_already_differ():
    assert [w["kind"] for w in check_sentence(["5 mL, 10 min"], "10 mL, 7 min")] == ["number_mismatch"]
    assert [w["kind"] for w in check_sentence(["5 mL, 10 min"], "5 mL, 10 h")] == ["unit_mismatch"]
    assert check_sentence(["5 mL, 10 min"], "5 mL, 10 h")[0]["source"] == "mL, min"


def test_range_shares_its_unit_so_spelling_the_range_differently_is_fine():
    assert check_sentence(["2~8 ℃에서 보관"], "Store at 2 °C to 8 °C") == []
    assert check_sentence(["2~8 ℃에서 보관"], "Store between 2 and 8 °C") == []
    assert check_sentence(["2-8 ℃에서 보관"], "Store at 2 to 8 °C") == []
    assert check_sentence(["5 내지 10 mL"], "5-10 mL") == []


@pytest.mark.parametrize(
    ("source", "target"),
    [
        ("5 mL 또는 10 mL를 넣는다.", "Add 5 or 10 mL."),
        ("5 mL 혹은 10 mL를 넣는다.", "Add 5 or 10 mL."),
        ("5 mL 및 10 mL를 넣는다.", "Add 5 mL OR 10 mL."),
        ("5 및 10 mL를 넣는다.", "Add 5 mL and 10 mL."),
        ("5 또는 10 mL를 넣는다.", "Add 5 mL or 10 mL."),
        ("2일 또는 3일간 둔다.", "Keep for 2 or 3 days."),
        ("37 ℃ ± 2 ℃로 유지한다.", "Keep at 37 ± 2 °C."),
    ],
)
def test_alternatives_and_tolerances_share_their_unit(source: str, target: str):
    assert check_sentence([source], target) == []


def test_shared_unit_connector_still_needs_a_shared_unit():
    # 뒤 숫자에 단위가 없으면 나눌 단위도 없다 — 숫자가 같아도 짝이 다르면 알린다
    assert check_sentence(["5 mL 또는 10 mL"], "5 mL or 10") == [
        {"kind": "unit_mismatch", "source": "5 mL, 10 mL", "target": "5 mL"}
    ]


@pytest.mark.parametrize(
    ("source", "target"),
    [
        ("5 µg", "5 ug"),
        ("5 µg", "5 μg"),
        ("5 ng", "5 nanograms"),
        ("5 µM", "5 uM"),
        ("5 μM", "5 µM"),
        ("5 mM", "5 mM"),
        ("5 nM", "5 nM"),
        ("3 days", "3일"),
        ("3 day", "3 days"),
        ("2 weeks", "2주"),
        ("5 grams", "5 g"),
        ("5 milligrams", "5 mg"),
        ("2 kilograms", "2 kg"),
        ("5 micrograms", "5 µg"),
        ("5 liters", "5 L"),
        ("5 litres", "5 L"),
        ("5 milliliters", "5 mL"),
        ("5 millilitres", "5 ml"),
        ("5 microliters", "5 µL"),
        ("50 percent", "50 %"),
        ("37 degrees C", "37 °C"),
        ("37 degrees Celsius", "37 ℃"),
        ("5 s", "5 sec"),
        ("5s", "5초"),
        ("2 bars", "2 bar"),
        ("30 psig", "30 psi"),
        ("100 kilopascals", "100 kPa"),
    ],
)
def test_new_unit_groups_and_spelled_out_forms(source: str, target: str):
    assert check_sentence([source], target) == []


@pytest.mark.parametrize(
    ("source", "target", "source_value", "target_value"),
    [
        ("5 mM", "5 µM", "mM", "µM"),
        ("5 µM", "5 nM", "µM", "nM"),
        ("5 mg", "5 µg", "mg", "µg"),
        ("5 µg", "5 ng", "µg", "ng"),
        ("3 days", "3 weeks", "day", "week"),
        ("3 days", "3 h", "day", "h"),
    ],
)
def test_new_unit_groups_stay_distinct(source: str, target: str, source_value: str, target_value: str):
    assert check_sentence([source], target) == [
        {"kind": "unit_mismatch", "source": source_value, "target": target_value}
    ]


def test_seconds_letter_s_counts_only_right_after_a_number():
    assert check_sentence(["Press the s key"], "Press the key") == []
    assert check_sentence(["5 samples"], "5 tubes") == []
    assert check_sentence(["Table 5S"], "Table 5") == []


def test_warning_values_are_cut_at_300_chars():
    many = " ".join(str(i) for i in range(1, 400))

    warnings = check_sentence([many], "")

    assert [w["kind"] for w in warnings] == ["number_mismatch"]
    assert len(warnings[0]["source"]) == 300
    assert warnings[0]["source"].startswith("1, 2, 3, 4")
    assert warnings[0]["source"].endswith("…")
    assert warnings[0]["target"] == ""
    # 짧은 값은 그대로
    assert check_sentence(["5분"], "6분")[0]["source"] == "5"


def test_warning_values_of_every_kind_are_capped():
    many_pairs = " ".join(f"{i} mL" for i in range(1, 200))
    swapped = " ".join(f"{i} mL" for i in range(2, 201))

    pair_warning = check_sentence([many_pairs + " 1 min"], swapped + " 1 min")[0]

    assert pair_warning["kind"] == "number_mismatch"
    assert max(len(pair_warning["source"]), len(pair_warning["target"])) <= 300


def test_leading_clause_number_is_not_a_quantity():
    assert check_sentence(["5.1 시료를 4 ℃에서 보관한다."], "Store the sample at 4 °C.") == []
    assert check_sentence(["시료를 4 ℃에서 보관한다."], "5.1 Store the sample at 4 °C.") == []
    assert check_sentence(["5. 시료를 4 ℃에서 보관한다."], "Store the sample at 4 °C.") == []
    assert check_sentence(["  5.1.2 시료를 4 ℃에서 보관한다."], "Store the sample at 4 °C.") == []


def test_leading_quantity_is_not_mistaken_for_a_clause_number():
    # 단위가 바로 오는 앞머리 소수, 점 없는 앞머리 수량은 수치로 남는다
    assert check_sentence(["0.5 mL를 넣는다."], "Add 1 mL.") == [
        {"kind": "number_mismatch", "source": "0.5", "target": "1"}
    ]
    assert check_sentence(["4 ℃에서 보관"], "Store at 5 °C") == [
        {"kind": "number_mismatch", "source": "4", "target": "5"}
    ]
    assert check_sentence(["10 시료를 취한다."], "Take 5 samples.") == [
        {"kind": "number_mismatch", "source": "10", "target": "5"}
    ]
    # 번호는 앞머리에서만 벗긴다
    assert check_sentence(["시료 5.1 를 취한다."], "Take the sample.") == [
        {"kind": "number_mismatch", "source": "5.1", "target": ""}
    ]


@pytest.mark.parametrize(
    ("korean", "english"),
    [
        ("5.2 일반 사항", "General requirements"),
        ("6.1 분석 절차", "Analysis procedure"),
        ("7.1 주의 사항", "Precautions"),
        ("2.3 초기 설정", "Initial setup"),
        ("1. 일반", "General"),
    ],
)
def test_clause_number_before_a_word_starting_with_a_unit_syllable(korean: str, english: str):
    # 일반·분석·주의·초기의 첫 글자는 단위(일·분·주·초)가 아니다 — 조항 번호를 수량으로 남기지 않는다
    assert check_sentence([korean], english) == []


@pytest.mark.parametrize(
    ("korean", "number", "label"),
    [
        ("5분간 둔다.", "5", "min"),
        ("10분 이내에 끝낸다.", "10", "min"),
        ("3일 후 확인한다.", "3", "day"),
        ("2주마다 점검한다.", "2", "week"),
        ("30초씩 섞는다.", "30", "sec"),
        ("1시간 동안 둔다.", "1", "h"),
        ("4 ℃에서 보관한다.", "4", "℃"),
        ("30분내 끝낸다.", "30", "min"),
        ("1시간당 점검한다.", "1", "h"),
        ("3일경 확인한다.", "3", "day"),
        ("5분과 함께 둔다.", "5", "min"),
        ("30초와 비교한다.", "30", "sec"),
        ("10분보다 길다.", "10", "min"),
        ("5분만 둔다.", "5", "min"),
        ("5분쯤 둔다.", "5", "min"),
        ("10분도 둔다.", "10", "min"),
    ],
)
def test_hangul_unit_with_a_following_particle_still_counts(korean: str, number: str, label: str):
    # 한글 단위 뒤에는 끝·한글 아닌 글자·정한 이음말(간·이내·후·마다·씩·동안·에서 …)만 온다
    assert check_sentence([korean], f"Do it {number}.") == [{"kind": "unit_mismatch", "source": label, "target": ""}]


@pytest.mark.parametrize(
    ("korean", "english"),
    [("5분과 10분 둔다.", "Keep for 5 min and 10 min."), ("30초와 60초 섞는다.", "Mix for 30 s and 60 s.")],
)
def test_hangul_units_joined_by_a_particle_both_count(korean: str, english: str):
    assert check_sentence([korean], english) == []


def test_excess_is_not_seconds():
    # 과는 이음말이지만 "초과"의 초는 단위가 아니다
    assert check_sentence(["10초과 시 폐기한다."], "Discard above 10.") == []
    assert check_sentence(["2.3 초과 시료"], "Excess samples") == []


def test_hangul_unit_followed_by_ui_is_not_a_unit():
    # 의는 이음말에 넣지 않는다 — "주의"의 주를 단위로 읽지 않으려는 선택이라 "2주의 기간"의 주도 세지 않는다
    assert check_sentence(["2주의 기간"], "A period of 2") == []


@pytest.mark.parametrize(
    ("korean", "number", "label"),
    [("2.3 초도 검사", "2.3", "sec"), ("6.1 분당 회전수", "6.1", "min")],
)
def test_clause_number_before_a_word_ending_in_a_particle_is_a_known_residual(korean: str, number: str, label: str):
    # 알려진 남은 오탐: 도·당을 이음말로 받으면 초도·분당은 "10초도"·"1분당"과 구별되지 않아 조항 번호가 수량으로 남는다
    assert check_sentence([korean], "Heading") == [
        {"kind": "number_mismatch", "source": number, "target": ""},
        {"kind": "unit_mismatch", "source": label, "target": ""},
    ]


def test_clause_number_before_the_word_time_is_a_known_residual():
    # 알려진 남은 오탐: 시간 뒤에 띄어쓰기가 오면 "1시간 동안"과 구별할 수 없어 "3.4 시간 관리"의 3.4는 수량으로 남는다
    assert check_sentence(["3.4 시간 관리"], "Time management") == [
        {"kind": "number_mismatch", "source": "3.4", "target": ""},
        {"kind": "unit_mismatch", "source": "h", "target": ""},
    ]
