"""규칙 쪼개기 — 문장 경계·언어 판정·빈 글자 규칙·블록 → 단위 초안·연달아 짝·커버리지 검사(순수 함수)."""

from pathlib import Path

import pytest

from app.sop.coverage import find_coverage_problems
from app.sop.extract import docx_reader
from app.sop.extract.pdf_reader import read_pdf
from app.sop.ingest import build_limits
from app.sop.spans import join_close_spans
from app.sop.segment import (
    CAPTIONS_SIGNAL,
    CLAUSE_NUMBER_FLAG,
    PARAS_SIGNAL,
    RULE_LEGACY,
    RULE_PARAGRAPH,
    BlockView,
    TableView,
    build_unit_drafts,
    build_unit_text,
    count_pair_directions,
    detect_language,
    find_marker_lines,
    split_block_text,
    split_paragraph,
    split_sentences,
    suggest_interleaved_pairs,
)
from scripts.synthetic_sop import build_synthetic_bundle


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
        # 추출기가 써 넣는 글자·로마 숫자·가나다 번호도 문장 끝이 아니다
        ("a. Press START. Wait.", ["a. Press START.", "Wait."]),
        ("iv. Close the lid.", ["iv. Close the lid."]),
        ("가. 장비를 켠다. 나. 문을 닫는다.", ["가. 장비를 켠다.", "나.", "문을 닫는다."]),
        # 번호는 줄마다 첫 토큰을 본다 — 칸 안에 번호 문단이 이어진 글
        ("1. 장비를 켠다\n2. 문을 닫는다.", ["1. 장비를 켠다\n2. 문을 닫는다."]),
    ],
    ids=[
        "korean", "e.g.", "Fig.", "decimal-and-No.", "closing-quote", "doc-code", "initial", "newline",
        "Rev.-and-Ver.", "dotted-initials", "U.S.", "list-number", "dotted-list-number", "number-not-first",
        "letter-number", "roman-number", "ganada-number", "number-on-each-line",
    ],
)
def test_split_sentences(text: str, sentences: list[str]) -> None:
    assert [text[start:end] for start, end in split_sentences(text)] == sentences


@pytest.mark.parametrize(
    ("text", "sentences"),
    [
        # 줄 맨 앞의 라벨 낱말 + 선택 번호 + 마침표는 문장 끝이 아니다
        ("Chapter 1. Filter setup", ["Chapter 1. Filter setup"]),
        ("Note. Plant X needs no air.", ["Note. Plant X needs no air."]),
        ("Appendix 2. Alarm list", ["Appendix 2. Alarm list"]),
        ("그림. 장비 사진", ["그림. 장비 사진"]),
        ("Fig. 1. Pump layout. See below.", ["Fig. 1. Pump layout.", "See below."]),
        ("주의. 뜨거운 면에 닿지 않는다. 장갑을 낀다.", ["주의. 뜨거운 면에 닿지 않는다.", "장갑을 낀다."]),
        # 글머리 기호·자동 번호·여는 따옴표 바로 뒤도 줄 맨 앞이다
        ("• Note. Plant X needs no air.", ["• Note. Plant X needs no air."]),
        ("3. Step 2. Close the valve.", ["3. Step 2. Close the valve."]),
        ('"Table 3. Limits" is attached.', ['"Table 3. Limits" is attached.']),
        # e.g.·i.e.는 뒤에 대문자가 와도 끝이 아니고, No.는 괄호·따옴표 앞에서도 끝이 아니다
        ("(e.g. ABC) and managed by Y.", ["(e.g. ABC) and managed by Y."]),
        ("Use a clean tool, i.e. Tool Blue. Then stop.", ["Use a clean tool, i.e. Tool Blue.", "Then stop."]),
        ('"Lot No. (a)" is used.', ['"Lot No. (a)" is used.']),
        ("(예. 솔로) 닦는다.", ["(예. 솔로) 닦는다."]),
        ("예. 솔로 닦는다. 말린다.", ["예. 솔로 닦는다.", "말린다."]),
        # 줄 가운데의 라벨 낱말과 라벨로 시작하지 않는 낱말은 그대로 문장 끝이다
        ("See the note. Note. Plant X.", ["See the note.", "Note.", "Plant X."]),
        ("Tablet. Then swallow.", ["Tablet.", "Then swallow."]),
        ("표준. 다음 문장.", ["표준.", "다음 문장."]),
        ("Add salt etc. Then stir.", ["Add salt etc.", "Then stir."]),
    ],
)
def test_split_sentences_keeps_line_labels_and_examples_whole(text: str, sentences: list[str]) -> None:
    assert [text[start:end] for start, end in split_sentences(text)] == sentences


def test_split_sentences_checks_the_label_on_each_line() -> None:
    text = "Close the lid.\nNote. Plant X needs no air.\nStep 3. Open it. Wait."

    assert [text[start:end] for start, end in split_sentences(text, split_lines=True)] == [
        "Close the lid.", "Note. Plant X needs no air.", "Step 3. Open it.", "Wait.",
    ]


def test_split_sentences_can_split_at_line_breaks() -> None:
    # DOCX의 줄바꿈(Shift+Enter)·칸 안 문단 — 줄마다 단위가 되고, 줄 안에서는 문장 규칙이 그대로다
    text = "1. 장비를 켠다\n2. 문을 닫는다. 기록한다.\n\n Close the door "

    assert [text[start:end] for start, end in split_sentences(text, split_lines=True)] == [
        "1. 장비를 켠다", "2. 문을 닫는다.", "기록한다.", "Close the door",
    ]
    # 약어·소문자 뒤따름 예외는 줄을 넘지 않는다
    assert [(start, end) for start, end in split_sentences("See Fig.\n3 tubes", split_lines=True)] == [(0, 8), (9, 16)]


@pytest.mark.parametrize(
    ("text", "lang"),
    [
        ("원심분리기의 rpm을 확인한다.", "ko"),
        # 한글이 하나라도 있으면 ko — 영어 낱말이 더 많은 한글 문장
        ("Press START (시작).", "ko"),
        ("HPLC System Suitability Test 수행", "ko"),
        ("Press START.", "en"),
        ("12.5 %", None),
    ],
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



def test_caption_block_becomes_a_caption_draft_bound_to_its_table() -> None:
    drafts = build_unit_drafts(
        [_para(1, 0, "표 3. 운전 조건", flags=("caption_of:1",)), _cell(2, 1, "a", 9, 0)], [TableView(9, False)], "ko_only"
    )
    caption = next(d for d in drafts if d.kind == "caption")
    assert drafts[caption.group_index].kind == "table"
    assert caption.spans == [(1, 0, len("표 3. 운전 조건"))]


def test_caption_of_a_layout_table_is_a_sentence() -> None:
    drafts = build_unit_drafts(
        [_para(1, 0, "표 7. 양식", flags=("caption_of:1",)), _cell(2, 1, "a", 9, 0)], [TableView(9, True)], "ko_only"
    )
    assert [d.kind for d in drafts][:1] == ["sentence"]


CELL_TEXT = "필요한 가스켓을 설치한다.\n표 1. 조제 탱크별 대상 장치\n\n이 절차는 탱크 A–C에 적용한다."


def _cell_with_caption(outer_layout: bool, inner_layout: bool = False) -> list:
    start = CELL_TEXT.index("표 1.")
    work = BlockView(
        2, 1, "table_cell", "body", CELL_TEXT, None, (), 8, 0,
        {"captions": [[start, start + len("표 1. 조제 탱크별 대상 장치"), 2]]},
    )
    blocks = [_cell(1, 0, "1", 8, 0), work, _cell(3, 2, "탱크", 9, 0), _cell(4, 3, "대상 장치", 9, 0)]
    return build_unit_drafts(blocks, [TableView(8, outer_layout), TableView(9, inner_layout)], "ko_only", split_lines=True)


@pytest.mark.parametrize("outer_layout", [True, False])
def test_caption_line_in_a_cell_is_one_caption_bound_to_the_inner_table(outer_layout: bool) -> None:
    # 칸 블록은 쪼개지 않는다 — 그 줄만 캡션 단위가 되어 안쪽 표 묶음에 든다(바깥 표가 데이터 표여도 바깥 묶음이 아니다)
    drafts = _cell_with_caption(outer_layout)

    caption = next(d for d in drafts if d.kind == "caption")
    start = CELL_TEXT.index("표 1.")
    assert caption.spans == [(2, start, start + len("표 1. 조제 탱크별 대상 장치"))]
    assert (drafts[caption.group_index].kind, drafts[caption.group_index].table_id) == ("table", 9)
    assert caption.table_id is None
    lines = [CELL_TEXT[d.spans[0][1] : d.spans[0][2]] for d in drafts if d.spans and d.spans[0][0] == 2 and d.kind != "caption"]
    assert lines == ["필요한 가스켓을 설치한다.", "이 절차는 탱크 A–C에 적용한다."]
    assert CAPTIONS_SIGNAL == docx_reader.SIGNAL_CAPTIONS  # 추출기가 남기는 신호와 같은 키를 읽는다


def test_caption_line_of_a_layout_inner_table_stays_a_cell_line() -> None:
    drafts = _cell_with_caption(outer_layout=True, inner_layout=True)
    assert not any(d.kind == "caption" for d in drafts)


def test_number_cell_does_not_join_a_caption_line() -> None:
    # 번호 칸 "1" 바로 다음 칸 첫 줄이 캡션이면 번호는 캡션에 붙지 않고 제 줄로 남는다
    text = "표 2. 목록\n본문이다."
    head = len("표 2. 목록")
    work = BlockView(2, 1, "table_cell", "body", text, None, (), 8, 0, {"captions": [[0, head, 2]]})
    blocks = [
        BlockView(1, 0, "table_cell", "body", "1", None, (), 8, 0, {"numbers": [[0, 1, "cell"]]}),
        work,
        _cell(3, 2, "a", 9, 0),
    ]

    drafts = build_unit_drafts(blocks, [TableView(8, True), TableView(9, False)], "ko_only", split_lines=True)

    caption = next(d for d in drafts if d.kind == "caption")
    assert caption.spans == [(2, 0, head)]
    assert [d.spans for d in drafts if d.kind == "cell_sentence" and d.table_id == 8] == [
        [(1, 0, 1)], [(2, head + 1, len(text))]
    ]


def test_caption_after_a_figure_is_one_unit_bound_to_the_figure() -> None:
    # 문장 쪼개기를 하지 않는다 — "그림 5. 로터 (Figure 5. Rotor)"는 마침표가 있어도 단위 하나다
    text = " 그림 5. 로터 장착 (Figure 5. Rotor mounting) "
    blocks = [BlockView(1, 0, "figure", "body", "", None, (), None, None), _para(2, 1, text, flags=("caption_of:0",))]

    drafts = build_unit_drafts(blocks, [], "ko_en_interleaved")

    assert [(d.kind, d.spans, d.lang, d.group_index) for d in drafts] == [
        ("figure", [], "neutral", None),
        ("caption", [(2, 1, len(text) - 1)], "ko", 0),
    ]


def test_drafts_fill_unknown_language_from_neighbors() -> None:
    blocks = [_para(1, 0, "12.5 %"), _para(2, 1, "Synthetic step."), _para(3, 2, "3.5"), _para(4, 3, "합성 단계.")]

    assert [draft.lang for draft in build_unit_drafts(blocks, [], "ko_only")] == ["en", "en", "en", "ko"]
    # 앞뒤 어디에도 언어가 없으면 배치 기본값(영어만 → en, 나머지 → ko)
    assert [draft.lang for draft in build_unit_drafts(blocks[:1], [], "en_only")] == ["en"]
    assert [draft.lang for draft in build_unit_drafts(blocks[:1], [], "ko_en_separate")] == ["ko"]


def test_drafts_split_docx_blocks_at_line_breaks() -> None:
    blocks = [
        _para(1, 0, "1. 목적\nPurpose", heading_level=1),
        _para(2, 1, "장비를 켠다.\nTurn on the unit."),
        _cell(3, 2, "첫 줄\nSecond line", 7, 0),
    ]

    drafts = build_unit_drafts(blocks, [TableView(7, False)], "ko_en_interleaved", split_lines=True)

    assert [(draft.kind, draft.spans, draft.lang) for draft in drafts] == [
        ("heading", [(1, 0, 5)], "ko"),
        ("heading", [(1, 6, 13)], "en"),
        ("sentence", [(2, 0, 7)], "ko"),
        ("sentence", [(2, 8, 25)], "en"),
        ("table", [], "neutral"),
        ("cell_sentence", [(3, 0, 3)], "ko"),
        ("cell_sentence", [(3, 4, 15)], "en"),
    ]
    # 블록은 하나라 줄 단위들을 합치면 줄바꿈을 품은 한 범위로 돌아가고, 단위 글자에서는 줄바꿈이 띄어쓰기다(6-a, 길이 그대로)
    texts = {block.id: block.text for block in blocks}
    assert join_close_spans([*drafts[2].spans, *drafts[3].spans], texts) == [(2, 0, 25)]
    assert build_unit_text([(2, 0, 25)], texts) == "장비를 켠다. Turn on the unit."
    # 기본값(PDF)은 줄바꿈에서 나누지 않는다
    assert [draft.spans for draft in build_unit_drafts(blocks[:1], [], "ko_en_interleaved")] == [[(1, 0, 13)]]


def test_build_unit_text_joins_spans_with_a_space_and_keeps_the_length() -> None:
    texts = {1: "가나. 다라.", 2: "Synthetic", 3: "첫 줄\r\n둘째 줄"}
    assert build_unit_text([(3, 0, 9)], texts) == "첫 줄  둘째 줄"

    assert build_unit_text([(1, 0, 3), (1, 4, 7), (2, 0, 9)], texts) == "가나. 다라. Synthetic"


def _langs(*langs: str) -> list[tuple[int, str, str]]:
    """가드에 걸리지 않는 짧은 글(번호·숫자 없음)로 언어 순서만 시험한다."""
    return [(unit_id, lang, "합성" if lang == "ko" else "Synthetic") for unit_id, lang in enumerate(langs, start=1)]


def test_suggest_interleaved_pairs() -> None:
    assert suggest_interleaved_pairs(_langs("ko", "en", "ko", "ko", "en", "neutral", "en")) == [([1], [2]), ([3, 4], [5, 7])]
    # 한쪽이 MAX_PAIR_SIDE(3)를 넘는 두 덩어리는 짝을 만들지 않고 다음 두 덩어리로 넘어간다
    assert suggest_interleaved_pairs(_langs("ko", "ko", "ko", "ko", "en", "ko", "en")) == [([6], [7])]


def test_interleaved_pairs_start_at_korean() -> None:
    # 앞머리 영어 줄(회사명·제목) 하나가 짝 방향을 뒤집지 않는다 — 한글 덩어리 뒤의 영어 덩어리만 잇는다
    assert suggest_interleaved_pairs(_langs("en", "ko", "en", "ko", "en")) == [([2], [3]), ([4], [5])]
    # 영어 뒤 한글도 이제 짝이다(영어 먼저 문서) — 중립은 건너뛴다
    assert suggest_interleaved_pairs(_langs("en", "neutral", "ko")) == [([3], [1])]


def _pair(*units: tuple[str, str]) -> list[tuple[list[int], list[int]]]:
    return suggest_interleaved_pairs([(unit_id, lang, text) for unit_id, (lang, text) in enumerate(units, start=1)])


def test_interleaved_pairs_en_first() -> None:
    assert _pair(
        ("en", "1. Purpose"), ("ko", "1. 목적"),
        ("en", "2. Scope"), ("ko", "2. 범위"),
        ("en", "3. Responsibilities"), ("ko", "3. 책임"),
    ) == [([2], [1]), ([4], [3]), ([6], [5])]


def test_interleaved_pairs_ko_first_unchanged() -> None:
    assert _pair(
        ("ko", "1. 목적"), ("en", "1. Purpose"),
        ("ko", "2. 범위"), ("en", "2. Scope"),
        ("ko", "3. 책임"), ("en", "3. Responsibilities"),
    ) == [([1], [2]), ([3], [4]), ([5], [6])]


def test_interleaved_pairs_en_first_with_stray_leading_ko() -> None:
    # 첫 줄 외톨이 한글 뒤로 영어→한글이 반복된다 — 외톨이는 짝 없이 두고 나머지를 맞춘다
    assert _pair(
        ("ko", "문서 관리 표준"),
        ("en", "1. Purpose"), ("ko", "1. 목적"),
        ("en", "2. Scope"), ("ko", "2. 범위"),
        ("en", "3. Responsibilities"), ("ko", "3. 책임"),
    ) == [([3], [2]), ([5], [4]), ([7], [6])]


def test_interleaved_pairs_tie_uses_preferred_direction() -> None:
    # 번호·숫자가 없는 구간은 두 방향이 같은 수로 통과한다 — 기본은 한글 먼저, 문서 우세 순서를 넘기면 그쪽
    units = [
        (1, "en", "Put on gloves."), (2, "ko", "장갑을 낀다."), (3, "en", "Close the lid."),
        (4, "ko", "뚜껑을 닫는다."), (5, "en", "Wash hands."),
    ]
    assert suggest_interleaved_pairs(units) == [([2], [3]), ([4], [5])]
    assert suggest_interleaved_pairs(units, preferred="en_ko") == [([2], [1]), ([4], [3])]
    assert count_pair_directions(units) == (2, 2)


def test_interleaved_pairs_link_translations() -> None:
    assert _pair(
        ("ko", "3. 책임"),
        ("en", "3. Responsibilities"),
        ("ko", "5.1 장비의 전원을 켜고 30분간 예열한다."),
        ("en", "5.1 Turn on the equipment and warm it up for 30 minutes."),
        ("ko", "QC 팀장은 일탈 발생 시 1,000 mL 이상의 시료를 2024년 1월 기준으로 재검토한다."),
        ("en", "The QC lead reviews samples of 1000 mL or more against the January 2024 baseline when a deviation occurs."),
        # 번호가 한쪽에만 있으면 번호는 견주지 않는다 — 영어 제목에 번호를 다시 쓰지 않는 문서
        ("ko", "4. 정의"),
        ("en", "Definitions"),
    ) == [([1], [2]), ([3], [4]), ([5], [6]), ([7], [8])]


def test_interleaved_pairs_skip_a_sentence_without_translation() -> None:
    # 번역이 빠진 한글 문장이 끼면 덩어리 크기가 어긋난다 — 그 덩어리는 잇지 않고(사람이 잇는다) 다음 덩어리부터 다시 맞춘다
    assert _pair(
        ("ko", "작업 전 장갑을 착용한다."),
        ("en", "Put on gloves before work."),
        ("ko", "기록은 QA 부서가 보관한다."),
        ("ko", "작업대를 소독한다."),
        ("en", "Disinfect the workbench."),
        ("ko", "뚜껑을 닫는다."),
        ("en", "Close the lid."),
    ) == [([1], [2]), ([6], [7])]


def test_interleaved_pairs_link_uneven_runs_only_on_strong_evidence() -> None:
    # 한 문장을 두 문장으로 옮긴 번역 — 머리 번호가 같거나 숫자 토큰이 완전히 같을 때만 잇는다
    assert _pair(
        ("ko", "5.3 원심분리기를 3000 rpm으로 설정한다."),
        ("en", "5.3 Set the centrifuge to 3000 rpm."),
        ("en", "Close the lid."),
    ) == [([1], [2, 3])]
    assert _pair(
        ("ko", "시료를 2-8 °C에서 24시간 보관한다."),
        ("en", "Store the samples at 2-8 °C."),
        ("en", "Keep them for 24 hours."),
    ) == [([1], [2, 3])]
    assert _pair(("ko", "뚜껑을 닫고 결과를 기록한다."), ("en", "Close the lid."), ("en", "Record the result.")) == []


@pytest.mark.parametrize(
    ("korean", "english"),
    [
        # 머리 번호가 다르다 — 번역이 아니라 다음 항목
        ("3. 책임", "4. Procedure"),
        ("5.1 장비를 켠다.", "5.2 Close the door."),
        # 숫자가 한쪽에만 있다
        ("작업자는 장갑을 착용한다.", "Use form QA-001."),
        ("시료를 30분간 방치한다.", "Leave the samples to stand."),
        # 숫자가 서로 다르다
        ("온도를 25 °C로 맞춘다.", "Set the speed to 3000 rpm."),
        # 길이가 번역으로 보기에는 너무 다르다
        ("작업자는 반드시 보호 장갑과 보안경을 착용하고 작업 전 점검표를 작성하여야 한다.", "Note"),
        ("주의 사항을 확인한다.", "The operator shall confirm every precaution listed in the batch record before starting the work."),
    ],
    ids=["heading-labels", "clause-labels", "digits-en-only", "digits-ko-only", "digits-differ", "too-short", "too-long"],
)
def test_interleaved_pairs_reject_unlikely_translations(korean: str, english: str) -> None:
    assert _pair(("ko", korean), ("en", english)) == []


# --- 규칙 2 — 문단 안 언어별 박스(설계 2026-11-25 R2) ---


def _pieces(text: str, *, split_lines: bool = True, **options: object) -> list[str]:
    return [text[start:end] for start, end in split_paragraph(text, split_lines=split_lines, **options)]


PARAGRAPH_SHAPES = [
    pytest.param("5.1 탱크를 비운다. 밸브를 닫는다. 잔량을 기록한다.", True, ["5.1 탱크를 비운다. 밸브를 닫는다. 잔량을 기록한다."], id="G1"),
    pytest.param(
        "탱크를 비운다. 밸브를 닫는다. Drain the tank completely. Close the outlet valve.", True,
        ["탱크를 비운다. 밸브를 닫는다.", "Drain the tank completely. Close the outlet valve."], id="G2",
    ),
    pytest.param(
        "탱크를 비운다. Drain the tank completely. 밸브를 닫는다. Close the outlet valve.", True,
        ["탱크를 비운다.", "Drain the tank completely.", "밸브를 닫는다.", "Close the outlet valve."], id="G3",
    ),
    pytest.param(
        "탱크를 비우고\n잔량을 확인한다.\n결과를 기록한다.", True, ["탱크를 비우고\n잔량을 확인한다.\n결과를 기록한다."], id="G4",
    ),
    pytest.param(
        "다음 순서로 준비한다.\n1) 전원을 켠다.\n2) 압력을 확인한다.\n• 장갑을 낀다.\n가. 기록지를 준비한다.", True,
        ["다음 순서로 준비한다.", "1) 전원을 켠다.", "2) 압력을 확인한다.", "• 장갑을 낀다.", "가. 기록지를 준비한다."], id="G5",
    ),
    pytest.param("작업이 끝나면 기록한다. 서명한다.", True, ["작업이 끝나면 기록한다. 서명한다."], id="G6"),
    pytest.param(
        "Biosafety Cabinet(BSC-01)의 HEPA filter를 확인한다. SOP-QC-0012에 따라 pH meter를 교정한다.", True,
        ["Biosafety Cabinet(BSC-01)의 HEPA filter를 확인한다. SOP-QC-0012에 따라 pH meter를 교정한다."], id="G7",
    ),
    pytest.param("세척액을 준비한다. Buffer A. 탱크에 넣는다.", True, ["세척액을 준비한다. Buffer A. 탱크에 넣는다."], id="G8-middle"),
    pytest.param("희석액을 준비한다. Buffer A.", True, ["희석액을 준비한다. Buffer A."], id="G8-end"),
    pytest.param("온도\nTemperature", True, ["온도", "Temperature"], id="G10"),
    pytest.param(
        "The operator drains the tank and then closes\nthe outlet valve of the cleaning line. Record\n0.8 bar as the target pressure.",
        False,
        ["The operator drains the tank and then closes\nthe outlet valve of the cleaning line. Record\n0.8 bar as the target pressure."],
        id="G18",
    ),
    pytest.param(
        "5.1 Drain the tank completely. Close the valve.\n5.2 Rinse the tank with purified water and\nwait for 10 minutes.\n"
        "5.3 Record the result.",
        False,
        ["5.1 Drain the tank completely. Close the valve.", "5.2 Rinse the tank with purified water and\nwait for 10 minutes.",
         "5.3 Record the result."],
        id="G21",
    ),
]


@pytest.mark.parametrize(("text", "split_lines", "expected"), PARAGRAPH_SHAPES)
def test_split_paragraph(text: str, split_lines: bool, expected: list[str]) -> None:
    assert _pieces(text, split_lines=split_lines) == expected


def test_short_english_is_judged_as_a_run() -> None:
    # 조각마다 보면 "Buffer A."(낱말 둘)가 앞에 붙지만, 덩어리로는 낱말 넷이라 영어 박스다
    assert _pieces("시약을 준비한다. Buffer A. Buffer B.") == ["시약을 준비한다.", "Buffer A. Buffer B."]
    # 예외로 이은 영어 뒤의 한글도 다시 이어진다
    assert _pieces("시약을 준비한다. Dilution buffer. 탱크에 넣는다.") == ["시약을 준비한다. Dilution buffer. 탱크에 넣는다."]
    # 영어가 먼저면 예외가 아니다 — 앞 조각이 한글이어야 잇는다
    assert _pieces("Drain it. 탱크를 비운다.") == ["Drain it.", "탱크를 비운다."]


def test_kept_pieces_are_never_joined() -> None:
    text = "가. 첫째 줄\n나 둘째 줄\n다 셋째 줄"
    second = text.index("나 둘째")

    assert _pieces(text) == [text]
    assert _pieces(text, kept=[second]) == ["가. 첫째 줄", "나 둘째 줄", "다 셋째 줄"]


def test_paras_are_outer_boundaries() -> None:
    text = "탱크를 비운다. 물을 채운다.\n밸브를 닫는다."

    assert _pieces(text) == [text]
    assert _pieces(text, paras=[0, text.index("밸브")]) == ["탱크를 비운다. 물을 채운다.", "밸브를 닫는다."]


def test_unknown_pieces_follow_the_previous_one() -> None:
    assert _pieces("온도를 잰다. 25. 기록한다.") == ["온도를 잰다. 25. 기록한다."]


def test_leading_unknown_joins_the_next() -> None:
    assert _pieces("2026! 탱크를 비운다.") == ["2026! 탱크를 비운다."]
    assert _pieces("2026! Drain the tank now.") == ["2026! Drain the tank now."]


def test_pdf_number_lines_need_the_next_number() -> None:
    wrapped = "5.1 Set the target pressure to\n0.8 bar and wait."
    assert _pieces(wrapped, split_lines=False) == [wrapped]
    assert _pieces("5.1 Drain it.\n5.2 Rinse it.", split_lines=False) == ["5.1 Drain it.", "5.2 Rinse it."]
    # 첫 하위 · 윗 단계 다음
    nested = "5.1 Drain it.\n5.1.1 Open the valve.\n5.1.2 Wait.\n5.2 Rinse it.\n6. Record it."
    assert _pieces(nested, split_lines=False) == nested.split("\n")
    listed = "5.1 Prepare.\na) Turn it on.\nb) Check it.\n5.2 Rinse it.\na) Wait."
    assert _pieces(listed, split_lines=False) == listed.split("\n")
    skipped = "5.1 Wait until it reaches\n5.4 bar.\n3) Record it."
    assert _pieces(skipped, split_lines=False) == [skipped]
    # 앞 번호가 없으면 번호 줄로 보지 않는다 — 글머리 · 문서 번호는 늘 나눈다
    bare = "Set it to\n1. Record it."
    assert _pieces(bare, split_lines=False) == [bare]
    marked = "Prepare the following items\n• gloves\nSOP-QC-0012 Sampling"
    assert _pieces(marked, split_lines=False) == marked.split("\n")


@pytest.mark.parametrize(
    "line",
    ["0.8 bar로 맞춘다.", "1. 켠다.", "(1) 켠다.", "1) 켠다.", "a. 켠다.", "a) 켠다.", "가. 켠다.", "ㄱ) 켠다.", "iv. 켠다.",
     "① 켠다.", "• 켠다.", "- 켠다.", "※ 켠다.", "o 켠다.", "SOP-QC-0012 시료 채취"],
)
def test_docx_number_lines_always_split(line: str) -> None:
    text = f"다음을 준비한다\n{line}"
    assert find_marker_lines(text, split_lines=True) == [text.index("\n") + 1]
    assert _pieces(text) == ["다음을 준비한다", line]


@pytest.mark.parametrize("line", ["-5 °C 이하로 둔다.", "once 켠다.", "3 times 켠다.", "ivx) 켠다.", "가을에 켠다.", "SOP에 따라 켠다."])
def test_plain_lines_are_not_marker_lines(line: str) -> None:
    assert find_marker_lines(f"다음을 준비한다\n{line}", split_lines=True) == []


def test_numbers_with_too_many_parts_are_not_numbers() -> None:
    # 점 조각이 아주 많은 줄은 번호로 읽지 않는다 — 뒤따르는 "0.8" 줄 많은 글이 줄마다 긴 번호를 견주지 않게
    ten, eleven = ".".join(["1"] * 10), ".".join(["1"] * 11)
    assert find_marker_lines(f"시작\n{ten} 켠다.\n{eleven} 끈다.", split_lines=True) == [len("시작\n")]
    crafted = ".".join(["1"] * 20_000) + " start" + "\n0.8 bar" * 20_000
    assert find_marker_lines(crafted, split_lines=False) == []


def test_first_line_is_never_a_marker_line() -> None:
    assert find_marker_lines("1) 전원을 켠다.", split_lines=True) == []


@pytest.mark.parametrize(("text", "split_lines"), [shape.values[:2] for shape in PARAGRAPH_SHAPES])
def test_rule_1_is_untouched(text: str, split_lines: bool) -> None:
    legacy = split_block_text(text, rule=RULE_LEGACY, split_lines=split_lines, paras=[0, 3], kept=[0, 3])
    assert legacy == split_sentences(text, split_lines=split_lines)
    assert split_block_text(text, rule=RULE_PARAGRAPH, split_lines=split_lines) == split_paragraph(
        text, split_lines=split_lines
    )


def test_split_paragraph_covers_every_visible_character(tmp_path: Path) -> None:
    texts = [shape.values[0] for shape in PARAGRAPH_SHAPES]
    texts += ["\u200b가나다.\u00a0\u3000", "\n\n1) 켠다.\n\n  2) 끈다.\n", "-----\n\ufeff\n끝", f"가\n{'9' * 5000}. 나", "", "\ufeff"]
    for path in (document.path for document in build_synthetic_bundle(tmp_path).documents):
        read = docx_reader.read_docx if path.suffix == ".docx" else read_pdf
        texts += [block.text for block in read(path.read_bytes(), build_limits()).blocks]
    for split_lines in (True, False):
        for text in texts:
            spans = [[(1, start, end)] for start, end in split_paragraph(text, split_lines=split_lines)]
            assert find_coverage_problems({1: text}, spans) == []


def test_number_cell_takes_the_first_paragraph_box() -> None:
    text = "탱크를 비운다. 밸브를 닫는다."
    blocks = [
        BlockView(1, 0, "table_cell", "body", "A", None, (), 8, 0, {"numbers": [[0, 1, "cell"]]}), _cell(2, 1, text, 8, 0),
    ]

    drafts = build_unit_drafts(blocks, [TableView(8, True)], "ko_only", split_lines=True, rule=RULE_PARAGRAPH)

    assert [draft.spans for draft in drafts] == [[(1, 0, 1), (2, 0, len(text))]]
    assert (drafts[0].pos_seq, drafts[0].pos_start) == (0, 0)


def test_captions_in_a_cell_stay_whole_under_rule_2() -> None:
    starts = [0, CELL_TEXT.index("표 1."), CELL_TEXT.index("이 절차는")]
    caption_end = starts[1] + len("표 1. 조제 탱크별 대상 장치")
    work = BlockView(
        1, 0, "table_cell", "body", CELL_TEXT, None, (), 8, 0,
        {"captions": [[starts[1], caption_end, 1]], PARAS_SIGNAL: starts},
    )

    drafts = build_unit_drafts(
        [work, _cell(2, 1, "탱크", 9, 0)], [TableView(8, True), TableView(9, False)], "ko_only", split_lines=True,
        rule=RULE_PARAGRAPH,
    )

    lines = [(d.kind, CELL_TEXT[d.spans[0][1] : d.spans[0][2]]) for d in drafts if d.spans and d.spans[0][0] == 1]
    assert lines == [
        ("cell_sentence", "필요한 가스켓을 설치한다."), ("caption", "표 1. 조제 탱크별 대상 장치"),
        ("cell_sentence", "이 절차는 탱크 A–C에 적용한다."),
    ]


def test_headings_figures_and_toc_lines_do_not_follow_the_rule() -> None:
    blocks = [
        BlockView(1, 0, "paragraph", "body", "1. 목적. 범위. ........ 3", None, (), None, None, {"toc": ["style"]}),
        _para(2, 1, "목적\nPurpose", heading_level=1),
        BlockView(3, 2, "figure", "body", "그림 글. 둘째.", None, (), None, None),
    ]

    by_rule = [
        build_unit_drafts(blocks, [], "ko_only", split_lines=True, rule=rule) for rule in (RULE_LEGACY, RULE_PARAGRAPH)
    ]

    assert by_rule[0] == by_rule[1]
