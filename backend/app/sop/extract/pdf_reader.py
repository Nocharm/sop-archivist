"""PDF 보조 추출기 — 텍스트 PDF만. pdfminer가 읽은 쪽 글자를 빈 줄로 잘라 문단 블록으로 낸다(순수 함수)."""

from collections.abc import Iterator
from io import BytesIO, StringIO
from itertools import islice

from pdfminer.converter import TextConverter
from pdfminer.layout import LAParams
from pdfminer.pdfdocument import PDFDocument, PDFEncryptionError
from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfparser import PDFParser
from pdfminer.psexceptions import PSException

# 빈 글자 판정과 본문·문단 코드는 DOCX 추출기와 같은 것을 쓴다(빈 글자 판정은 쪼개기 단계로 옮겨질 때 함께 옮긴다)
from app.sop.extract.docx_reader import KIND_PARAGRAPH, PART_BODY, _has_visible_char
from app.sop.extract.types import (
    ExtractedBlock,
    ExtractedWarning,
    ExtractionRejected,
    ExtractLimits,
    ExtractResult,
)

PDF_HEADER = b"%PDF"
PAGE_BASIS_RENDERED = "rendered"  # PDF의 쪽은 보이는 쪽 그대로다
WARNING_PDF_LAYOUT = "pdf_layout"


def read_pdf(data: bytes, limits: ExtractLimits) -> ExtractResult:
    """PDF 바이트 → 문단 블록(표 구조 없음)과 레이아웃 경고. 받지 않는 파일은 ExtractionRejected(code)를 던진다."""
    if not data.startswith(PDF_HEADER):
        raise ExtractionRejected("invalid_format")
    pages = _list_pages(_open_document(data), limits)

    blocks: list[ExtractedBlock] = []
    total_chars = 0
    for page_number, page_text in enumerate(_iter_page_texts(pages), start=1):
        for block_number, paragraph in enumerate(_split_paragraphs(page_text), start=1):
            total_chars += len(paragraph)
            blocks.append(_build_block(len(blocks), paragraph, page_number, block_number))
        # 쪽마다 확인해 이상하게 큰 PDF가 끝까지 읽히기 전에 멈춘다
        if total_chars > limits.max_chars:
            raise ExtractionRejected("too_many_chars")
    if not blocks:
        # 글자가 하나도 없으면 그림만 있는 스캔본이다 — 빈 추출을 성공으로 처리하지 않는다
        raise ExtractionRejected("scanned_pdf")
    return ExtractResult(
        blocks=tuple(blocks),
        tables=(),
        warnings=(ExtractedWarning(WARNING_PDF_LAYOUT, None, {}),),
    )


def _open_document(data: bytes) -> PDFDocument:
    """문서 열기 — 암호가 걸렸으면 열리든 안 열리든 거절하고, 구조가 깨졌으면 invalid_format으로 거절한다."""
    try:
        document = PDFDocument(PDFParser(BytesIO(data)))
    except PDFEncryptionError as error:
        raise ExtractionRejected("encrypted_pdf") from error
    except PSException as error:
        raise ExtractionRejected("invalid_format") from error
    # 빈 암호로 열리는 PDF(쓰기·복사 제한만 건 것)도 암호화 PDF로 본다
    if document.encryption is not None:
        raise ExtractionRejected("encrypted_pdf")
    return document


def _list_pages(document: PDFDocument, limits: ExtractLimits) -> list[PDFPage]:
    """쪽 목록 — 상한보다 하나만 더 읽어 넘는지 알아본다(쪽 트리를 끝까지 걷지 않는다)."""
    try:
        pages = list(islice(PDFPage.create_pages(document), limits.max_pdf_pages + 1))
    except PSException as error:
        raise ExtractionRejected("invalid_format") from error
    if len(pages) > limits.max_pdf_pages:
        raise ExtractionRejected("too_many_pages")
    return pages


def _iter_page_texts(pages: list[PDFPage]) -> Iterator[str]:
    """쪽마다 pdfminer 글자 — 문서 하나를 한 번만 열고 출력 버퍼만 비워 가며 쓴다."""
    resources = PDFResourceManager()
    output = StringIO()
    # all_texts: 기본값(False)이면 Form XObject·그림 안 글은 배치 분석을 건너뛰고 글자만 이어 붙어 나와 줄·낱말이 붙는다
    laparams = LAParams(all_texts=True)
    interpreter = PDFPageInterpreter(resources, TextConverter(resources, output, laparams=laparams))
    try:
        for page in pages:
            interpreter.process_page(page)
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)
    except PSException as error:
        raise ExtractionRejected("invalid_format") from error


def _split_paragraphs(page_text: str) -> list[str]:
    """빈 줄(공백뿐인 줄 포함)이 문단 경계다. 문단 안 줄은 이어 붙이지 않고 "\\n"으로 둔다.

    split("\\n")을 쓴다 — splitlines는 \\x0b·\\x1c 같은 글자에서도 잘라 원문 줄을 바꾼다.
    """
    paragraphs: list[str] = []
    lines: list[str] = []
    for line in page_text.split("\n"):
        if _has_visible_char(line):
            lines.append(line)
        elif lines:
            paragraphs.append("\n".join(lines))
            lines = []
    if lines:
        paragraphs.append("\n".join(lines))
    return paragraphs


def _build_block(seq: int, text: str, page_number: int, block_number: int) -> ExtractedBlock:
    return ExtractedBlock(
        seq=seq,
        part=PART_BODY,
        kind=KIND_PARAGRAPH,
        text=text,
        xml_path=f"page[{page_number}]/block[{block_number}]",
        page=page_number,
        page_basis=PAGE_BASIS_RENDERED,
        section_label="",
        heading_level=None,
        table_index=None,
        row_index=None,
        col_index=None,
        grid_span=1,
        row_span=1,
        image_part=None,
        flags=(),
    )
