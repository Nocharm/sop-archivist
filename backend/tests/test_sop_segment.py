"""규칙 쪼개기 — 문장 경계·언어 판정·빈 글자 규칙·블록 → 단위 초안·연달아 짝·커버리지 검사(순수 함수)."""

import pytest

from app.sop.coverage import find_coverage_problems
from app.sop.extract import docx_reader
from app.sop.spans import join_close_spans
from app.sop.segment import (
    CLAUSE_NUMBER_FLAG,
    BlockView,
    TableView,
    build_unit_drafts,
    build_unit_text,
    count_pair_directions,
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
    # 블록은 하나라 줄 단위들을 합치면 줄바꿈을 품은 한 범위로 돌아간다
    texts = {block.id: block.text for block in blocks}
    assert join_close_spans([*drafts[2].spans, *drafts[3].spans], texts) == [(2, 0, 25)]
    assert build_unit_text([(2, 0, 25)], texts) == "장비를 켠다.\nTurn on the unit."
    # 기본값(PDF)은 줄바꿈에서 나누지 않는다
    assert [draft.spans for draft in build_unit_drafts(blocks[:1], [], "ko_en_interleaved")] == [[(1, 0, 13)]]


def test_build_unit_text_joins_spans_by_block() -> None:
    texts = {1: "가나. 다라.", 2: "Synthetic"}

    assert build_unit_text([(1, 0, 3), (1, 4, 7), (2, 0, 9)], texts) == "가나. 다라.\nSynthetic"


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
