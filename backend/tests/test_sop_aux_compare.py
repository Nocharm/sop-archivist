"""MarkItDown 보조 대조 — 정규화·누락 조각 판정, 실제 라이브러리 변환(오프라인), 진짜 변환 결과와의 오탐 점검."""

import socket
import sys
import time
from collections.abc import Iterator

import pytest
from markitdown import FileConversionException

from app.sop.extract import aux_compare
from app.sop.extract.aux_compare import (
    MissingText,
    _drop_blank_chars,
    convert_with_markitdown,
    find_missing_text,
    normalize_for_compare,
)
from app.sop.extract.docx_reader import read_docx
from app.sop.extract.pdf_reader import read_pdf
from app.sop.extract.types import ExtractLimits
from app.sop.segment import is_blank_char
from tests.docx_factory import build_docx, p, tbl
from tests.pdf_factory import build_text_pdf

LIMITS = ExtractLimits(
    max_unzipped_bytes=20 * 1024 * 1024,
    max_zip_entries=100,
    max_compression_ratio=100,
    max_pdf_pages=500,
    max_chars=100_000,
)


@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """변환 중 소켓을 열면 실패한다 — 보조 추출이 외부로 나가지 않는다는 보증."""

    def refuse(*args: object, **kwargs: object) -> None:
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    yield


def test_find_missing_text_flags_only_absent_pieces() -> None:
    blocks = ["회전 속도를 확인한다.", "Check the speed."]
    markdown = "# 회전 속도를 확인한다.\n\n| Check the speed. | **숨은 글자 조각** |"

    assert find_missing_text(blocks, markdown) == [MissingText("**숨은 글자 조각**", 1)]


def test_normalize_ignores_spacing_and_markup() -> None:
    assert normalize_for_compare("- **A  b**\\_c") == normalize_for_compare("A b_c")


def test_normalize_strips_markdown_marks_keeps_link_text() -> None:
    markdown = "## 제목\n> 인용\n![그림](data:image/png;base64...)\n[링크 글](https://example.invalid/a_b) `코드`"

    assert normalize_for_compare(markdown) == "제목인용링크글코드"


def test_normalize_strips_list_markers_at_every_depth() -> None:
    markdown = "* 첫째\n  + 둘째\n    - 셋째\n1. 숫자\n   1. 하위"

    assert normalize_for_compare(markdown) == "첫째둘째셋째숫자하위"


def test_normalize_strips_strike_underline_and_nested_link_brackets() -> None:
    markdown = "[[SOP-001] 장비](#a(b)c) ~~삭제~~ <u>밑줄</u>"

    assert normalize_for_compare(markdown) == "SOP-001장비삭제밑줄"


def test_normalize_strips_line_heads_hidden_behind_inline_marks() -> None:
    plain = normalize_for_compare("1. 목적 및 범위")

    assert plain == "목적및범위"
    assert normalize_for_compare("[1. 목적 및 범위](#sec1)") == plain
    assert normalize_for_compare("**1. 목적 및 범위**") == plain
    assert normalize_for_compare("## ~~1. 목적 및 범위~~") == plain
    assert normalize_for_compare("[- 항목](#a)") == normalize_for_compare("- 항목") == "항목"


def test_normalize_keeps_long_link_text_and_targets() -> None:
    link = f"[{'가' * 700}](#{'x' * 3000})"

    assert normalize_for_compare(link) == "가" * 700


def test_normalize_stays_linear_on_unclosed_markup() -> None:
    hostile = ["[" * 300_000, "![" * 150_000, "[a](" * 100_000, "](" * 150_000, "[" + "[a]" * 100_000, "](" + "(a)" * 100_000]

    started = time.perf_counter()
    for text in hostile:
        normalize_for_compare(text)

    # 제곱 시간이면 분 단위가 걸린다 — 로컬은 1초 안쪽이지만 GitLab CI 러너는 몇 배 느려서(같은 꼴의
    # test_sop_checks 선형성 시험이 로컬 1.8초 → CI 6.6초), 러너 속도와 상관없이 회귀만 잡도록 30초로 둔다
    assert time.perf_counter() - started < 30


def test_normalize_drops_note_reference_marks() -> None:
    markdown = "본문 글자입니다[[1]](#footnote-1)\n\n1. 각주 글자입니다 [↑](#footnote-ref-1)"

    assert normalize_for_compare(markdown) == "본문글자입니다각주글자입니다"


def test_blank_removal_matches_the_extractor_blank_rule() -> None:
    every_char = "".join(map(chr, range(sys.maxunicode + 1)))

    # 쪼개기·커버리지와 같은 "빈 글자" 판정 — segment.is_blank_char와 글자 하나도 어긋나지 않는다
    assert _drop_blank_chars(every_char) == "".join(char for char in every_char if not is_blank_char(char))
    assert normalize_for_compare("\u00a0\u3000\u200b\ufeff \t\n") == ""


def test_short_pieces_are_ignored() -> None:
    assert find_missing_text(["본문 글자"], "abc\n\n| xyz |") == []
    assert find_missing_text(["본문 글자"], "abcd", min_chars=5) == []
    assert find_missing_text(["본문 글자"], "abcd") == [MissingText("abcd", None)]


def test_missing_text_after_block_index_follows_last_found_piece() -> None:
    blocks = ["첫째 블록 글자", "둘째 블록 글자", "셋째 블록 글자"]
    markdown = "빠진 첫 조각\n\n첫째 블록 글자\n\n둘째 블록 글자\n\n빠진 둘째 조각\n\n셋째 블록 글자"

    missing = find_missing_text(blocks, markdown)

    assert [(item.snippet, item.after_block_index) for item in missing] == [("빠진 첫 조각", None), ("빠진 둘째 조각", 1)]


def test_piece_found_out_of_order_still_counts_as_present() -> None:
    blocks = ["머리말 글자", "본문 글자", "꼬리말 글자"]

    assert find_missing_text(blocks, "꼬리말 글자\n\n머리말 글자\n\n본문 글자") == []


def test_snippet_is_cut_to_200_chars() -> None:
    piece = "가" * 300

    assert find_missing_text(["다른 글"], piece) == [MissingText("가" * 200, None)]


def test_table_separator_row_is_not_a_piece() -> None:
    markdown = "| 이름 값 | 속도 값 |\n| --- | :---: |"

    assert find_missing_text(["이름 값", "속도 값"], markdown, min_chars=3) == []


def test_escaped_pipe_stays_inside_the_cell() -> None:
    assert find_missing_text(["abcd|efgh"], "| abcd\\|efgh |") == []


def test_piece_overlapping_the_previous_hit_is_found() -> None:
    # 앞 조각이 찾힌 자리(cursor) 안쪽에서 시작하는 조각도 앞쪽 재검색에 잡힌다
    assert find_missing_text(["가나다라마바사아"], "가나다라마바\n\n라마바사아") == []


def test_missing_text_stops_at_max_items() -> None:
    markdown = "\n\n".join(f"빠진 조각 번호 {n}" for n in range(10))

    missing = find_missing_text(["본문 글자"], markdown, max_items=3)

    assert [item.snippet for item in missing] == ["빠진 조각 번호 0", "빠진 조각 번호 1", "빠진 조각 번호 2"]


def test_max_items_below_one_is_rejected() -> None:
    with pytest.raises(ValueError, match="max_items"):
        find_missing_text(["본문 글자"], "빠진 조각 번호", max_items=0)


def test_missing_text_default_cap_is_200() -> None:
    markdown = "\n\n".join(f"빠진 조각 번호 {n}" for n in range(250))

    assert len(find_missing_text(["본문 글자"], markdown)) == 200


def test_missing_text_scan_stops_once_the_cap_is_reached(monkeypatch: pytest.MonkeyPatch) -> None:
    normalized: list[str] = []
    real_normalize = aux_compare.normalize_for_compare

    def spy_normalize(text: str) -> str:
        normalized.append(text)
        return real_normalize(text)

    monkeypatch.setattr(aux_compare, "normalize_for_compare", spy_normalize)
    markdown = "\n\n".join(f"빠진 조각 번호 {n}" for n in range(10))

    find_missing_text(["본문 글자"], markdown, max_items=2)

    # 블록 하나 + 누락 조각 둘 — 셋째 조각부터는 정규화도 하지 않는다
    assert len(normalized) == 3


def test_markitdown_converts_docx_and_pdf(no_network: None) -> None:
    docx = build_docx(p("회전 속도를 확인한다.") + tbl([["이름", "Check the speed."]]))
    pdf = build_text_pdf([["Rotor speed must be checked."]])

    docx_markdown = convert_with_markitdown(docx, "docx")
    pdf_markdown = convert_with_markitdown(pdf, "pdf")

    assert "회전 속도를 확인한다." in docx_markdown
    assert "Check the speed." in docx_markdown
    assert "Rotor speed must be checked." in pdf_markdown


def test_markitdown_only_reads_docx_and_pdf(no_network: None) -> None:
    # 일반 글·CSV 변환기가 대신 받아 주면 깨진 파일이 성공처럼 보인다 — DOCX·PDF 변환기만 켠다
    with pytest.raises(FileConversionException):
        convert_with_markitdown(b"a,b\n1,2\n", "docx")
    with pytest.raises(FileConversionException):
        convert_with_markitdown(b"not a pdf at all", "pdf")


def test_real_conversion_of_a_faithful_docx_reports_nothing_missing(no_network: None) -> None:
    merged = (
        '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>'
        '<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>' + p("왼쪽 칸") + "</w:tc>"
        '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' + p("오른쪽 위 칸") + "</w:tc></w:tr>"
        "<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>" + p("") + "</w:tc>"
        "<w:tc>" + p("가운데 칸") + "</w:tc><w:tc>" + p("1500 rpm | max") + "</w:tc></w:tr></w:tbl>"
    )
    body = (
        p("1. 목적", "Heading1")
        + p("A & B < C > D * E _ F # G [x](y) 가_나 `t`")
        + '<w:p><w:r><w:t>각주가 달린 본문</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>'
        + '<w:p><w:hyperlink w:anchor="sec1"><w:r><w:t>하이퍼 글자</w:t></w:r></w:hyperlink>'
        + '<w:r><w:rPr><w:b/></w:rPr><w:t> 굵은 글 </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>기울임</w:t></w:r></w:p>'
        + merged
    )
    data = build_docx(body, footnotes=[p("각주 글자입니다")], headers=[p("머리말 글자")])
    blocks = read_docx(data, LIMITS).blocks

    assert find_missing_text([block.text for block in blocks], convert_with_markitdown(data, "docx")) == []


def _run(text: str, properties: str = "") -> str:
    run_properties = f"<w:rPr>{properties}</w:rPr>" if properties else ""
    return f'<w:r>{run_properties}<w:t xml:space="preserve">{text}</w:t></w:r>'


def _link(text: str, anchor: str) -> str:
    return f'<w:p><w:hyperlink w:anchor="{anchor}">{_run(text)}</w:hyperlink></w:p>'


UNDERLINE = '<w:u w:val="single"/>'
# (MarkItDown이 실제로 내는 표시, 본문 XML) — 표시가 안 나오면 이 케이스가 아무것도 검증하지 못하므로 먼저 확인한다
MARKUP_SHAPES = {
    "strikethrough": (
        "~~삭제선이 있는 글자~~",
        f"<w:p>{_run('이 문장은 ')}{_run('삭제선이 있는 글자', '<w:strike/>')}{_run(' 입니다')}</w:p>",
    ),
    "underline": (
        "<u>밑줄 있는 글자</u>",
        f"<w:p>{_run('밑줄 ')}{_run('밑줄 있는 글자', UNDERLINE)}{_run(' 입니다')}</w:p>",
    ),
    "link text with brackets": ("[[SOP-001] 장비 점검 절차](#sec1)", _link("[SOP-001] 장비 점검 절차", "sec1")),
    "link anchor with parentheses": ("(#a(b)c)", _link("괄호 앵커 링크 글자", "a(b)c")),
    "link anchor over 2000 chars": ("x" * 3000, _link("긴 앵커 링크 글자", "x" * 3000)),
    "link text over 500 chars": ("](#sec1)", _link("가나다라마바사 " * 100, "sec1")),
    # 줄 머리처럼 보이는 글로 시작하는 링크·강조 — 여는 표시가 줄 머리를 가리면 메인 글과 어긋난다
    "link text starting with a number": ("[1. 목적 및 범위](#sec1)", _link("1. 목적 및 범위", "sec1")),
    "link text starting with a dash": ("[- 항목 설명입니다](#sec1)", _link("- 항목 설명입니다", "sec1")),
    "link text starting with a hash": ("[# 번호 제목입니다](#sec1)", _link("# 번호 제목입니다", "sec1")),
    "link text starting with a quote mark": ("[> 인용문 글자입니다](#sec1)", _link("&gt; 인용문 글자입니다", "sec1")),
    "bold numbered heading": ("**1. 목적 및 범위**", f"<w:p>{_run('1. 목적 및 범위', '<w:b/>')}</w:p>"),
    "strikethrough numbered heading": ("~~1. 목적 및 범위~~", f"<w:p>{_run('1. 목적 및 범위', '<w:strike/>')}</w:p>"),
    "partly bold numbered line": ("**3.** 일부만 굵은 번호 글자", f"<w:p>{_run('3. ', '<w:b/>')}{_run('일부만 굵은 번호 글자')}</w:p>"),
}


@pytest.mark.parametrize(("marker", "body"), MARKUP_SHAPES.values(), ids=MARKUP_SHAPES.keys())
def test_real_conversion_of_markup_shapes_reports_nothing_missing(marker: str, body: str, no_network: None) -> None:
    data = build_docx(body)
    blocks = read_docx(data, LIMITS).blocks
    markdown = convert_with_markitdown(data, "docx")

    assert marker in markdown
    assert find_missing_text([block.text for block in blocks], markdown) == []


def test_real_conversion_still_flags_missing_text_next_to_markup(no_network: None) -> None:
    data = build_docx(_link("[SOP-001] 장비 점검 절차", "sec1") + p("일반 문단 글자입니다"))
    blocks = read_docx(data, LIMITS).blocks

    missing = find_missing_text([blocks[1].text], convert_with_markitdown(data, "docx"))

    assert missing == [MissingText("[[SOP-001] 장비 점검 절차](#sec1)", None)]


def test_real_conversion_flags_text_the_main_blocks_lack(no_network: None) -> None:
    data = build_docx(p("첫째 문단 글자") + p("둘째 문단 글자"))
    blocks = read_docx(data, LIMITS).blocks

    missing = find_missing_text([blocks[0].text], convert_with_markitdown(data, "docx"))

    assert missing == [MissingText("둘째 문단 글자", 0)]


def test_real_conversion_of_a_text_pdf_reports_nothing_missing(no_network: None) -> None:
    data = build_text_pdf([["Line one", "line two", "", "Second para | x"], ["Third page text"]])
    blocks = read_pdf(data, LIMITS).blocks

    assert find_missing_text([block.text for block in blocks], convert_with_markitdown(data, "pdf")) == []
