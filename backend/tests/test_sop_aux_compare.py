"""MarkItDown 보조 대조 — 정규화·누락 조각 판정, 실제 라이브러리 변환(오프라인), 진짜 변환 결과와의 오탐 점검."""

import socket
import sys
from collections.abc import Iterator

import pytest
from markitdown import FileConversionException

from app.sop.extract.aux_compare import (
    MissingText,
    _drop_blank_chars,
    convert_with_markitdown,
    find_missing_text,
    normalize_for_compare,
)
from app.sop.extract.docx_reader import _has_visible_char, read_docx
from app.sop.extract.pdf_reader import read_pdf
from app.sop.extract.types import ExtractLimits
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


def test_normalize_drops_note_reference_marks() -> None:
    markdown = "본문 글자입니다[[1]](#footnote-1)\n\n1. 각주 글자입니다 [↑](#footnote-ref-1)"

    assert normalize_for_compare(markdown) == "본문글자입니다각주글자입니다"


def test_blank_removal_matches_the_extractor_blank_rule() -> None:
    every_char = "".join(map(chr, range(sys.maxunicode + 1)))

    # 쪼개기·커버리지와 같은 "빈 글자" 판정 — docx_reader의 정의와 글자 하나도 어긋나지 않는다
    assert _drop_blank_chars(every_char) == "".join(char for char in every_char if _has_visible_char(char))
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


def test_real_conversion_flags_text_the_main_blocks_lack(no_network: None) -> None:
    data = build_docx(p("첫째 문단 글자") + p("둘째 문단 글자"))
    blocks = read_docx(data, LIMITS).blocks

    missing = find_missing_text([blocks[0].text], convert_with_markitdown(data, "docx"))

    assert missing == [MissingText("둘째 문단 글자", 0)]


def test_real_conversion_of_a_text_pdf_reports_nothing_missing(no_network: None) -> None:
    data = build_text_pdf([["Line one", "line two", "", "Second para | x"], ["Third page text"]])
    blocks = read_pdf(data, LIMITS).blocks

    assert find_missing_text([block.text for block in blocks], convert_with_markitdown(data, "pdf")) == []
