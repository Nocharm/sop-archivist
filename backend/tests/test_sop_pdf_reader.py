"""PDF 보조 추출기 — 문단 블록 자르기·쪽 번호·경고, 스캔본·암호화·쪽 수 초과·깨진 파일 거절."""

from dataclasses import replace
from io import BytesIO

import pytest
from pdfminer.pdfdocument import PDFDocument, PDFPasswordIncorrect
from pdfminer.pdfparser import PDFParser

from app.sop.extract.pdf_reader import read_pdf
from app.sop.extract.types import ExtractionRejected, ExtractLimits
from tests.pdf_factory import assemble_pdf, build_image_pdf, build_mapped_glyph_pdf, build_text_pdf

LIMITS = ExtractLimits(
    max_unzipped_bytes=20 * 1024 * 1024,
    max_zip_entries=100,
    max_compression_ratio=100,
    max_pdf_pages=500,
    max_chars=100_000,
)
PARAGRAPH_PAGE = ["Line one", "line two", "", "Second para"]


def test_pdf_blocks_split_on_blank_lines() -> None:
    blocks = read_pdf(build_text_pdf([PARAGRAPH_PAGE]), LIMITS).blocks

    assert [block.text for block in blocks] == ["Line one\nline two", "Second para"]
    assert blocks[0].page == 1


def test_pdf_whitespace_only_lines_are_not_blocks() -> None:
    blocks = read_pdf(build_text_pdf([["First", "   ", "Second"]]), LIMITS).blocks

    assert [block.text for block in blocks] == ["First", "Second"]


@pytest.mark.parametrize("unicode_value", ["<0000>", "55296"], ids=["nul", "lone_surrogate"])
def test_pdf_replaces_unstorable_chars_keeping_the_text_length(unicode_value: str) -> None:
    """글꼴 맵이 낸 NUL·짝 없는 서로게이트는 Postgres에 들어가지 못한다 — 글자 수가 같은 대체 문자로 바꿔 위치가 밀리지 않게 한다."""
    blocks = read_pdf(build_mapped_glyph_pdf("Synthetic ABC line", "B", unicode_value), LIMITS).blocks

    assert [block.text for block in blocks] == ["Synthetic A\ufffdC line"]


def _build_form_pdf(form: str, page: str = "q /Fm1 Do Q BT /F1 12 Tf 72 700 Td (Body line) Tj ET") -> bytes:
    """쪽 내용(page) 하나가 Form XObject(form)를 부르는 PDF — 머리말·꼬리말처럼 재사용 조각에 든 글을 흉내 낸다."""
    return assemble_pdf(
        [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            "/Resources << /Font << /F1 3 0 R >> /XObject << /Fm1 6 0 R >> >> /Contents 5 0 R >>",
            f"<< /Length {len(page)} >>\nstream\n{page}\nendstream",
            "<< /Type /XObject /Subtype /Form /BBox [0 0 200 200] /Matrix [1 0 0 1 72 600] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Length {len(form)} >>\nstream\n{form}\nendstream",
        ]
    )


def test_pdf_keeps_form_text_free_of_page_break_char() -> None:
    """변환기가 쪽 끝에 쓰는 쪽 나눔 글자(\\f)가 Form XObject 안의 글 끝에 붙어 원문에 남지 않아야 한다."""
    blocks = read_pdf(_build_form_pdf("BT /F1 12 Tf 10 10 Td (Inside form) Tj ET"), LIMITS).blocks

    assert [block.text for block in blocks] == ["Body line", "Inside form"]


def test_pdf_lays_out_text_inside_form_objects() -> None:
    """Form XObject 안 글도 줄·낱말 배치를 분석한다 — 안 하면 줄과 낱말이 구분 없이 붙어 나온다."""
    form = (
        "BT /F1 12 Tf 14 TL 10 100 Td (Header line one) Tj T* (Header line two) Tj ET\n"
        "BT /F1 12 Tf 10 20 Td [(Word) -300 (gap)] TJ ET"
    )

    blocks = read_pdf(_build_form_pdf(form), LIMITS).blocks

    assert [block.text for block in blocks] == ["Body line", "Header line one\nHeader line two", "Word gap"]


def test_pdf_pages_numbered() -> None:
    blocks = read_pdf(build_text_pdf([PARAGRAPH_PAGE, ["Other page"]]), LIMITS).blocks

    assert blocks[-1].text == "Other page"
    assert blocks[-1].page == 2
    assert blocks[-1].xml_path == "page[2]/block[1]"


def test_pdf_block_shape() -> None:
    result = read_pdf(build_text_pdf([PARAGRAPH_PAGE, ["Other page"]]), LIMITS)

    assert [block.seq for block in result.blocks] == [0, 1, 2]
    assert [block.xml_path for block in result.blocks] == ["page[1]/block[1]", "page[1]/block[2]", "page[2]/block[1]"]
    first = result.blocks[0]
    assert (first.part, first.kind, first.page_basis) == ("body", "paragraph", "rendered")
    assert (first.section_label, first.heading_level, first.table_index, first.image_part) == ("", None, None, None)
    assert (first.grid_span, first.row_span, first.flags) == (1, 1, ())
    assert result.tables == ()


def test_pdf_always_warns_layout() -> None:
    warnings = read_pdf(build_text_pdf([["Only line"]]), LIMITS).warnings

    assert [(warning.kind, warning.block_seq) for warning in warnings] == [("pdf_layout", None)]


@pytest.mark.parametrize(
    ("data", "limits", "code"),
    [
        pytest.param(build_image_pdf(), LIMITS, "scanned_pdf", id="scanned"),
        pytest.param(build_text_pdf([[""]]), LIMITS, "scanned_pdf", id="no_text_at_all"),
        pytest.param(build_text_pdf([["a"], ["b"]]), replace(LIMITS, max_pdf_pages=1), "too_many_pages", id="too_many_pages"),
        pytest.param(build_text_pdf([["Line one"]]), replace(LIMITS, max_chars=5), "too_many_chars", id="too_many_chars"),
        pytest.param(b"hello", LIMITS, "invalid_format", id="not_a_pdf"),
        pytest.param(b"%PDF-1.4\nnot really a pdf", LIMITS, "invalid_format", id="header_only"),
        pytest.param(build_text_pdf([PARAGRAPH_PAGE])[:150], LIMITS, "invalid_format", id="truncated"),
        pytest.param(build_text_pdf([["x"]], encrypt="empty_password"), LIMITS, "encrypted_pdf", id="encrypted_opens_blank"),
        pytest.param(build_text_pdf([["x"]], encrypt="needs_password"), LIMITS, "encrypted_pdf", id="encrypted_needs_password"),
    ],
)
def test_pdf_rejects(data: bytes, limits: ExtractLimits, code: str) -> None:
    with pytest.raises(ExtractionRejected) as rejected:
        read_pdf(data, limits)

    assert rejected.value.code == code


def test_encrypted_variants_cover_both_detection_paths() -> None:
    """두 암호화 변형이 각자 다른 검출 길(열리지만 encryption이 있음 / 암호를 물음)을 타는지 — 팩토리가 몰래 한 길로 합쳐지지 않게."""
    opens = PDFDocument(PDFParser(BytesIO(build_text_pdf([["x"]], encrypt="empty_password"))))
    assert opens.encryption is not None

    with pytest.raises(PDFPasswordIncorrect):
        PDFDocument(PDFParser(BytesIO(build_text_pdf([["x"]], encrypt="needs_password"))))
