"""규칙 쪼개기 — 문장 경계·언어 판정·빈 글자 규칙·블록 → 단위 초안·연달아 짝·커버리지 검사(순수 함수)."""

import pytest

from app.sop.coverage import find_coverage_problems
from app.sop.extract import docx_reader
from app.sop.segment import (
    CLAUSE_NUMBER_FLAG,
    BlockView,
    TableView,
    build_unit_drafts,
    build_unit_text,
    detect_language,
    split_sentences,
    suggest_interleaved_pairs,
)


def _cell(block_id: int, seq: int, text: str, table_id: int, row_index: int, flags: tuple[str, ...] = ()) -> BlockView:
    return BlockView(block_id, seq, "table_cell", "body", text, None, flags, table_id, row_index)


def _para(block_id: int, seq: int, text: str, heading_level: int | None = None, flags: tuple[str, ...] = ()) -> BlockView:
    return BlockView(block_id, seq, "paragraph", "body", text, heading_level, flags, None, None)


@pytest.mark.parametrize(
    ("text", "sentences"),
    [
        ("QC 팀장은 책임자를 지정한다. 기록은 보관한다.", ["QC 팀장은 책임자를 지정한다.", "기록은 보관한다."]),
        ("Use e.g. a 50 mL tube. Then close the lid.", ["Use e.g. a 50 mL tube.", "Then close the lid."]),
        ("See Fig. 3 for details. Done.", ["See Fig. 3 for details.", "Done."]),
        ("Set to 3.5 rpm. Check No. 5 before use.", ["Set to 3.5 rpm.", "Check No. 5 before use."]),
        ('He said "Stop." Then left.', ['He said "Stop."', "Then left."]),
        ("Refer to SOP-QC-00005. Next step.", ["Refer to SOP-QC-00005.", "Next step."]),
        ("J. Smith approves it.", ["J. Smith approves it."]),
        ("첫 줄\n둘째 줄.", ["첫 줄\n둘째 줄."]),
        ("SOP-QC-001 Rev. 2 applies. Ver. 3 follows.", ["SOP-QC-001 Rev. 2 applies.", "Ver. 3 follows."]),
        ("J.R. Smith approves it.", ["J.R. Smith approves it."]),
        ("U.S. FDA requires it. Done.", ["U.S. FDA requires it.", "Done."]),
        ("1. Turn on the unit. Close the lid.", ["1. Turn on the unit.", "Close the lid."]),
        (" 5.1. 장비를 켠다.", ["5.1. 장비를 켠다."]),
        # 목록 번호는 블록 첫 토큰일 때만 — 문장 가운데 "Step 1."은 보통 문장 끝이다
        ("Go to Step 1. Then stop.", ["Go to Step 1.", "Then stop."]),
    ],
    ids=[
        "korean", "e.g.", "Fig.", "decimal-and-No.", "closing-quote", "doc-code", "initial", "newline",
        "Rev.-and-Ver.", "dotted-initials", "U.S.", "list-number", "dotted-list-number", "number-not-first",
    ],
)
def test_split_sentences(text: str, sentences: list[str]) -> None:
    assert [text[start:end] for start, end in split_sentences(text)] == sentences


@pytest.mark.parametrize(
    ("text", "lang"),
    [("원심분리기의 rpm을 확인한다.", "ko"), ("Press START (시작).", "en"), ("12.5 %", None)],
)
def test_detect_language(text: str, lang: str | None) -> None:
    assert detect_language(text) == lang


def test_invisible_chars_follow_one_blank_rule() -> None:
    # 앞의 ZWSP와 뒤의 NBSP·전각 공백은 문장에 붙지 않는다
    assert split_sentences("\u200b가나다.\u00a0\u3000") == [(1, 5)]
    # 보이지 않는 글자뿐인 블록은 단위가 없고, 덮이지 않아도 커버리지 문제가 아니다
    assert build_unit_drafts([_para(1, 0, "\ufeff")], [], "ko_en_interleaved") == []
    assert find_coverage_problems({1: "\ufeff"}, []) == []


def test_find_coverage_problems_reports_overlap_gap_and_blank_edges() -> None:
    texts = {1: "가나다. 라마바.", 2: "Synthetic"}

    assert find_coverage_problems(texts, [[(1, 0, 4)], [(1, 5, 9)], [(2, 0, 9)]]) == []
    assert find_coverage_problems(texts, [[(1, 0, 4), (1, 5, 9)], [(2, 0, 9)]]) == []
    assert find_coverage_problems(texts, [[(1, 0, 4)], [(1, 3, 9)], [(2, 0, 9)]]) == ["block 1: spans overlap at 3"]
    assert find_coverage_problems(texts, [[(1, 0, 5)], [(1, 5, 9)], [(2, 0, 9)]]) == [
        "unit #0: span 1:0-5 has a blank char at an edge",
    ]
    assert find_coverage_problems(texts, [[(1, 0, 4)], [(2, 0, 9)]]) == ["block 1: uncovered text at 5"]
    assert find_coverage_problems(texts, [[(1, 0, 9)], [(2, 4, 4), (2, 0, 99)], [(3, 0, 1)]]) == [
        "unit #1: invalid span 2:4-4",
        "unit #1: invalid span 2:0-99",
        "unit #2: span on unknown block 3",
        "block 2: uncovered text at 0",
    ]


def test_build_drafts_tables_figures_headings() -> None:
    blocks = [
        _para(11, 0, "1. 목적", heading_level=1),
        _para(12, 1, "합성 장비의 전원을 켠다."),
        _cell(13, 2, "항목", 7, 0),
        _cell(14, 3, "Item", 7, 0),
        _cell(15, 4, "합성 값", 7, 1),
        _cell(16, 5, "Synthetic value", 7, 1),
        BlockView(17, 6, "figure", "body", " 그림 1 합성 장비 ", None, (), None, None),
    ]

    drafts = build_unit_drafts(blocks, [TableView(7, False)], "ko_en_interleaved")

    assert [draft.kind for draft in drafts] == [
        "heading", "sentence", "table", "cell_sentence", "cell_sentence", "cell_sentence", "cell_sentence", "figure",
    ]
    table = drafts[2]
    assert (table.spans, table.lang, table.table_id, table.pos_seq, table.pos_start) == ([], "neutral", 7, 2, -1)
    cells = drafts[3:7]
    assert [cell.group_index for cell in cells] == [2, 2, 2, 2]
    assert [(cell.table_id, cell.row_index, cell.lang) for cell in cells] == [
        (7, 0, "ko"), (7, 0, "en"), (7, 1, "ko"), (7, 1, "en"),
    ]
    assert drafts[0].spans == [(11, 0, 5)]
    # 그림은 캡션 글자를 앞뒤 빈 글자 없이 범위로 갖는다
    assert (drafts[7].spans, drafts[7].lang, drafts[7].group_index) == ([(17, 1, 11)], "neutral", None)


def test_build_drafts_cell_figures_merged_cells_and_layout_tables() -> None:
    blocks = [
        _para(10, 0, "5.1", flags=("clause_number",)),
        _cell(11, 1, "합친 칸 글. Merged cell text.", 7, 0, flags=("merged_cell",)),
        BlockView(12, 2, "figure", "body", "", None, (), 7, 0),
        _cell(13, 3, "합성 한글 칸.", 8, 0),
        _cell(14, 4, "Synthetic English cell.", 8, 0),
    ]

    drafts = build_unit_drafts(blocks, [TableView(7, False), TableView(8, True)], "ko_en_interleaved")

    assert [(draft.kind, draft.group_index, draft.table_id) for draft in drafts] == [
        ("heading", None, None),
        ("table", None, 7),
        # 병합 칸도 보통 칸처럼 칸 문장으로 쪼개 표에 묶는다
        ("cell_sentence", 1, 7),
        ("cell_sentence", 1, 7),
        # 칸 안 그림은 표에 묶이지 않는 독립 그림 단위다
        ("figure", None, None),
        # 레이아웃 표는 표 단위가 없고 칸 문장은 묶이지 않는다
        ("cell_sentence", None, 8),
        ("cell_sentence", None, 8),
    ]
    assert (drafts[4].spans, drafts[4].pos_seq, drafts[4].pos_start) == ([], 2, 0)
    assert CLAUSE_NUMBER_FLAG == docx_reader.FLAG_CLAUSE_NUMBER  # 추출기가 붙이는 표시와 같은 값을 본다


def test_drafts_fill_unknown_language_from_neighbors() -> None:
    blocks = [_para(1, 0, "12.5 %"), _para(2, 1, "Synthetic step."), _para(3, 2, "3.5"), _para(4, 3, "합성 단계.")]

    assert [draft.lang for draft in build_unit_drafts(blocks, [], "ko_only")] == ["en", "en", "en", "ko"]
    # 앞뒤 어디에도 언어가 없으면 배치 기본값(영어만 → en, 나머지 → ko)
    assert [draft.lang for draft in build_unit_drafts(blocks[:1], [], "en_only")] == ["en"]
    assert [draft.lang for draft in build_unit_drafts(blocks[:1], [], "ko_en_separate")] == ["ko"]


def test_build_unit_text_joins_spans_by_block() -> None:
    texts = {1: "가나. 다라.", 2: "Synthetic"}

    assert build_unit_text([(1, 0, 3), (1, 4, 7), (2, 0, 9)], texts) == "가나. 다라.\nSynthetic"


def test_suggest_interleaved_pairs() -> None:
    units = [(1, "ko"), (2, "en"), (3, "ko"), (4, "ko"), (5, "en"), (6, "neutral"), (7, "en")]

    assert suggest_interleaved_pairs(units) == [([1], [2]), ([3, 4], [5, 7])]
    # 한쪽이 MAX_PAIR_SIDE(3)를 넘는 두 덩어리는 짝을 만들지 않고 다음 두 덩어리로 넘어간다
    crowded = [(1, "ko"), (2, "ko"), (3, "ko"), (4, "ko"), (5, "en"), (6, "ko"), (7, "en")]
    assert suggest_interleaved_pairs(crowded) == [([6], [7])]


def test_interleaved_pairs_start_at_korean() -> None:
    # 앞머리 영어 줄(회사명·제목) 하나가 짝 방향을 뒤집지 않는다 — 한글 덩어리 뒤의 영어 덩어리만 잇는다
    assert suggest_interleaved_pairs([(1, "en"), (2, "ko"), (3, "en"), (4, "ko"), (5, "en")]) == [([2], [3]), ([4], [5])]
    # 짝을 못 찾은 덩어리는 그것만 건너뛴다 — 끝의 한글, 한글 앞의 영어
    assert suggest_interleaved_pairs([(1, "ko"), (2, "en"), (3, "en"), (4, "ko")]) == [([1], [2, 3])]
    assert suggest_interleaved_pairs([(1, "en"), (2, "neutral"), (3, "ko")]) == []
