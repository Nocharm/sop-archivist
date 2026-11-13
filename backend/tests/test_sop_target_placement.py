"""새로 놓이는 새 문장의 기본 번호 표시와 붙일 순서(설계 §6 기본값 O10·나중 번역) — DB 없는 순수 함수."""

from app.sop.target_placement import NewTarget, arrange_new_targets

P = (1, "procedures.procedure", None, None)


def _t(
    key: str, meaning: int, lang: str, source: int, *, tr: bool = False, placed: bool = False,
    place: tuple[int, str | None, int | None, str | None] = P,
) -> NewTarget:
    return NewTarget(key, place, meaning, lang, source, tr, placed)


def test_pair_placed_together_numbers_english_first() -> None:
    got = arrange_new_targets([_t("ko", 7, "ko", 1), _t("en", 7, "en", 2)])
    assert [(a.key, a.number_style) for a in got] == [("en", "numbered"), ("ko", "omitted")]


def test_one_to_two_pair_numbers_only_the_first_english() -> None:
    got = arrange_new_targets([_t("ko", 7, "ko", 1), _t("en1", 7, "en", 2), _t("en2", 7, "en", 3)])
    assert [(a.key, a.number_style) for a in got] == [("en1", "numbered"), ("en2", "omitted"), ("ko", "omitted")]


def test_unpaired_and_single_language_keep_numbered_in_given_order() -> None:
    got = arrange_new_targets([_t("a", -1, "ko", 1), _t("b", -2, "en", 2)])
    assert [(a.key, a.number_style) for a in got] == [("a", "numbered"), ("b", "numbered")]


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
