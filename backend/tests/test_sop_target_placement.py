"""새로 놓이는 새 문장의 기본 번호 표시와 붙일 순서(제품 명세 §7.13 섹션 번호 기본값 O10·나중 번역) — DB 없는 순수 함수."""

import pytest

from app.sop.target_placement import NewTarget, arrange_new_targets, get_default_style, restyle_moved
from tests.sop_helpers import build_sop_outline

P = (1, "procedures.p1", None, None)


def _t(
    key: str, meaning: int, lang: str, source: int, *, tr: bool = False, placed: bool = False,
    place: tuple[int, str | None, int | None, str | None] = P, style: str = "numbered",
) -> NewTarget:
    return NewTarget(key, place, meaning, lang, source, tr, placed, style)


def test_default_mark_is_the_one_of_the_place() -> None:
    # 글머리 기호가 기본인 절: 짝은 첫 영어만 글머리 기호, 나머지는 생략 — 번역이 출처 뒤에 생략으로 붙는 규칙은 그대로다
    pair = arrange_new_targets([_t("ko", 7, "ko", 1, style="bullet"), _t("en", 7, "en", 2, style="bullet")])
    lone = arrange_new_targets([_t("a", -1, "ko", 1, style="bullet"), _t("tr", -1, "en", 1, tr=True, style="bullet")])

    assert [(a.key, a.number_style) for a in pair] == [("en", "bullet"), ("ko", "omitted")]
    assert [(a.key, a.number_style) for a in lone] == [("a", "bullet"), ("tr", "omitted")]


def test_default_style_comes_from_the_outline_item() -> None:
    outline = build_sop_outline([("general_requirements.safety", "Safety"), ("appendices.a1", "Alarm list")])

    assert {key: get_default_style(outline, key) for key in (
        "purpose", "general_requirements", "general_requirements.safety", "procedures", "procedures.p1",
        "document_relationships.references", "attachments", "appendices.a1",
    )} == {
        "purpose": "bullet", "general_requirements": "bullet", "general_requirements.safety": "bullet",
        "procedures": "numbered", "procedures.p1": "numbered", "document_relationships.references": "bullet",
        "attachments": "bullet", "appendices.a1": "numbered",
    }
    # 골격 항목이 아닌 자리(WI 단계·절 경로)는 번호
    assert get_default_style(outline, None) == "numbered"


@pytest.mark.parametrize(
    ("style", "slot_key", "expected"),
    [
        ("numbered", "purpose", "bullet"),
        ("bullet", "procedures.p1", "numbered"),
        ("bullet", "scope", "bullet"),
        ("omitted", "purpose", "omitted"),
        ("note", "procedures.p1", "note"),
        ("bullet", None, "bullet"),  # SOP 절이 아닌 자리(WI 단계)로 가면 그대로
    ],
)
def test_restyle_moved_swaps_only_numbers_and_bullets(style: str, slot_key: str | None, expected: str) -> None:
    assert restyle_moved(style, build_sop_outline(), slot_key) == expected


def test_pair_placed_together_numbers_english_first() -> None:
    got = arrange_new_targets([_t("ko", 7, "ko", 1), _t("en", 7, "en", 2)])
    assert [(a.key, a.number_style) for a in got] == [("en", "numbered"), ("ko", "omitted")]


def test_one_to_two_pair_numbers_only_the_first_english() -> None:
    got = arrange_new_targets([_t("ko", 7, "ko", 1), _t("en1", 7, "en", 2), _t("en2", 7, "en", 3)])
    assert [(a.key, a.number_style) for a in got] == [("en1", "numbered"), ("en2", "omitted"), ("ko", "omitted")]


def test_unpaired_and_single_language_keep_numbered_in_given_order() -> None:
    got = arrange_new_targets([_t("a", -1, "ko", 1), _t("b", -2, "en", 2)])
    assert [(a.key, a.number_style) for a in got] == [("a", "numbered"), ("b", "numbered")]


def test_unpaired_meaning_in_both_languages_numbers_both() -> None:
    # 짝 없는 단위 하나가 자기 언어 새 문장과 다른 언어 합침 문장(번역 아님)의 첫 출처로 한 칸에 함께 놓여도 짝이 아니라서 둘 다 번호
    got = arrange_new_targets([_t("ko", -4, "ko", 4), _t("en", -4, "en", 4)])
    assert {a.key: a.number_style for a in got} == {"ko": "numbered", "en": "numbered"}


def test_translation_follows_its_source_omitted() -> None:
    got = arrange_new_targets([_t("en", -5, "en", 5), _t("ko", -5, "ko", 5, tr=True)])
    assert [(a.key, a.number_style, a.after_existing_source) for a in got] == [
        ("en", "numbered", False), ("ko", "omitted", False),
    ]


def test_later_translation_goes_after_the_placed_source() -> None:
    (got,) = arrange_new_targets([_t("ko", -5, "ko", 5, tr=True, placed=True)])
    assert (got.number_style, got.after_existing_source) == ("omitted", True)


def test_pair_in_different_places_is_not_the_default() -> None:
    got = arrange_new_targets([_t("ko", 7, "ko", 1), _t("en", 7, "en", 2, place=(1, "scope", None, None))])
    assert {a.number_style for a in got} == {"numbered"}


def test_meanings_keep_their_first_order_and_translations_sit_right_after_their_source() -> None:
    # 의미 7(짝)이 먼저 나왔으니 먼저, 한 의미 안에서는 영어 먼저, 번역은 같은 출처 바로 뒤
    got = arrange_new_targets([
        _t("ko", 7, "ko", 1), _t("x", -9, "en", 9), _t("ko-tr", 7, "en", 1, tr=True), _t("en", 7, "en", 2),
    ])
    assert [(a.key, a.number_style) for a in got] == [
        ("en", "numbered"), ("ko", "omitted"), ("ko-tr", "omitted"), ("x", "numbered"),
    ]


def test_translation_without_its_source_here_is_numbered() -> None:
    # 출처가 다른 칸에 있거나 아직 놓이지 않았으면 출처 바로 뒤가 아니라서 번호(기본값)이고 끼우지 않는다
    (got,) = arrange_new_targets([_t("ko", -5, "ko", 5, tr=True)])
    assert (got.number_style, got.after_existing_source) == ("numbered", False)
