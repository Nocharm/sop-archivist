"""한글 표 따라 하기 1 — 영어 표의 짝 한글 표를 꼴 + 토큰 + 뜻으로 고르고(11-23 명세 D2-R1 · R2), 애매하면 사람이 정한 것을 저장한다(R3).

표는 합성이다 — S18의 한글 표 3 · 영어 표 5(같은 토큰) · 영어 표 6(같은 꼴, 토큰 없음)을 본뜬다.
"""

import math

import numpy as np

from app.sop.constants import TABLE_FOLLOW_THRESHOLD
from app.sop.counterparts import TableFacts
from app.sop.table_follow import FollowTable, list_counterpart_candidates, pick_counterpart, read_tokens, score_tables


def table(*rows: str, n_cols: int = 2) -> FollowTable:
    return FollowTable(n_rows=len(rows), n_cols=n_cols, rows=rows)


KO3 = table("1 장비를 준비한다.", "2 시료 10 mL를 채취한다.", "3 채취 뒤 4 °C에 둔다.", "4 (빈 칸)")
KO3_COPY = table("1 장비를 준비한다.", "2 시료 10 mL를 채취한다.", "3 채취 뒤 4 °C에 둔다.", "4 (빈 칸)")
EN5 = table("1 Take 10 mL of sample.", "2 Prepare the equipment.", "3 Keep at 4 °C after.", "4 (blank)")
EN6 = table("1 Training record", "2 Trainee signs the form.", "3 Trainer checks the record.", "4 (blank)")
KO_PLAIN = table("장비를 준비한다.", "기록을 남긴다.")
EN_PLAIN = table("Prepare the equipment.", "Keep the record.")


def pick(english: FollowTable, korean: dict[int, FollowTable]) -> tuple[str, int | None]:
    scores = {table_id: score_tables(source, english, None) for table_id, source in korean.items()}
    answer = pick_counterpart(scores, None, has_choice=False)
    return answer.status, answer.source_table_id


def vectors(cosine: float) -> dict[str, np.ndarray]:
    """KO_PLAIN 행 i와 EN_PLAIN 행 i의 코사인이 cosine, 다른 행끼리는 0인 가짜 벡터."""
    size = 2 * KO_PLAIN.n_rows
    out: dict[str, np.ndarray] = {}
    for index, (korean, english) in enumerate(zip(KO_PLAIN.rows, EN_PLAIN.rows, strict=True)):
        base = np.zeros(size, dtype=np.float32)
        base[2 * index] = 1.0
        near = np.zeros(size, dtype=np.float32)
        near[2 * index], near[2 * index + 1] = cosine, math.sqrt(1 - cosine * cosine)
        out[korean], out[english] = base, near
    return out


def test_same_shape_with_other_content_is_not_a_pair() -> None:
    assert pick(EN6, {3: KO3}) == ("none", None)  # AC1 — 꼴만으로 잇지 않는다


def test_shared_tokens_make_the_pair() -> None:
    assert pick(EN5, {3: KO3}) == ("matched", 3)  # S18: 10 mL · 4 °C


def test_tokens_ignore_number_cells_and_case() -> None:
    assert read_tokens(["1", "Take 10 mL of sample.", "Keep at 4 °C after."]) == {"10 ml": 1, "4 °c": 1}


def test_tokens_read_ph_document_numbers_abbreviations_and_dates() -> None:
    texts = ["pH 7.0으로 맞춘다.", "SOP-QC-0101을 따른다.", "HPLC로 잰다.", "2026.11.26에 적는다.", "37℃ · 10mL"]
    assert read_tokens(texts) == {"ph 7.0": 1, "sop-qc-0101": 1, "hplc": 1, "2026-11-26": 1, "37 °c": 1, "10 ml": 1}


def test_close_scores_ask_a_person() -> None:
    assert pick(EN5, {3: KO3, 4: KO3_COPY})[0] == "ambiguous"


def test_other_column_count_scores_zero() -> None:
    assert score_tables(table("시료 10 mL", n_cols=3), table("10 mL sample", n_cols=2), None) == 0


def test_embeddings_lift_a_tokenless_pair() -> None:
    assert score_tables(KO_PLAIN, EN_PLAIN, vectors(0.9)) >= TABLE_FOLLOW_THRESHOLD
    assert score_tables(KO_PLAIN, EN_PLAIN, None) < TABLE_FOLLOW_THRESHOLD


def test_far_meaning_keeps_a_tokenless_pair_apart() -> None:
    assert score_tables(KO_PLAIN, EN_PLAIN, vectors(0.3)) < TABLE_FOLLOW_THRESHOLD


def test_a_persons_choice_wins_both_ways() -> None:
    assert pick_counterpart({3: 0.1}, 3, has_choice=True).status == "matched"
    assert pick_counterpart({3: 0.9}, None, has_choice=True).status == "none"


def facts(table_id: int, index: int, lang: str, *, n_cols: int = 2, parent_id: int | None = None) -> TableFacts:
    return TableFacts(
        id=table_id, index=index, parent_id=parent_id, part="body", n_rows=4, n_cols=n_cols, is_layout=False,
        widths=None, first_row=(), is_band=False, lang=lang,
    )


TABLES = [facts(1, 0, "ko"), facts(2, 1, "ko", n_cols=3), facts(3, 2, "ko"), facts(5, 3, "en"), facts(6, 4, "en")]


def test_interleaved_offers_the_nearest_korean_table_of_the_same_form_above() -> None:
    assert [item.id for item in list_counterpart_candidates(TABLES[3], TABLES, interleaved=True)] == [3]
    assert [item.id for item in list_counterpart_candidates(TABLES[4], TABLES, interleaved=True)] == [3]
    assert list_counterpart_candidates(facts(9, 0, "en"), [facts(9, 0, "en"), facts(1, 1, "ko")], interleaved=True) == []


def test_separate_offers_every_korean_table_of_the_same_layer() -> None:
    inner = facts(7, 5, "ko", parent_id=1)
    candidates = list_counterpart_candidates(TABLES[3], [*TABLES, inner], interleaved=False)
    assert [item.id for item in candidates] == [1, 2, 3]
