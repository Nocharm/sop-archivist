"""추출 결과 타입 — 자식 프로세스 경계를 넘어 피클되므로 불변 dataclass·튜플·평범한 dict만 쓴다."""

from dataclasses import dataclass

# 추출 규칙이 바뀌면 올린다 — 같은 파일의 예전 추출과 새 추출을 구별하는 근거(extractions.extractor_version)
# 2: Word 자동 번호를 글 앞에 써 넣고 머리말·꼬리말에 구역 표시(section_ref)를 남긴다 — 1로 뽑은 추출은 번호·표시가 없다
EXTRACTOR_VERSION = "2"


@dataclass(frozen=True)
class ExtractLimits:
    """거절 기준 — 값은 Settings에서 오고, 추출기는 받기만 한다."""

    max_unzipped_bytes: int
    max_zip_entries: int
    max_compression_ratio: int
    max_pdf_pages: int
    max_chars: int


@dataclass(frozen=True)
class ExtractedTable:
    """표 하나 — index는 추출 안에서 읽은 순서(0부터), 칸 안의 표는 parent_index로 바깥 표를 가리킨다."""

    index: int
    parent_index: int | None
    part: str
    xml_path: str
    n_rows: int
    n_cols: int


@dataclass(frozen=True)
class ExtractedBlock:
    """원문 블록 하나 — seq는 0부터 읽은 순서대로 늘고, row_index·col_index도 0부터다.

    page_basis는 문서 전체에 하나(rendered|manual|estimated)이고, 본문 밖 부분은 page가 None이다.
    """

    seq: int
    part: str
    kind: str
    text: str
    xml_path: str
    page: int | None
    page_basis: str
    section_label: str
    heading_level: int | None
    table_index: int | None
    row_index: int | None
    col_index: int | None
    grid_span: int
    row_span: int
    image_part: str | None
    flags: tuple[str, ...]


@dataclass(frozen=True)
class ExtractedWarning:
    """추출 경고 — block_seq가 있으면 그 블록을 가리킨다(DB 저장 때 블록 id로 바뀐다)."""

    kind: str
    block_seq: int | None
    detail: dict[str, str]


@dataclass(frozen=True)
class ExtractResult:
    blocks: tuple[ExtractedBlock, ...]
    tables: tuple[ExtractedTable, ...]
    warnings: tuple[ExtractedWarning, ...]


class ExtractionRejected(Exception):
    """파일을 받지 않는 이유 — code: not_a_zip_or_encrypted | unsafe_zip | invalid_format | tracked_changes
    | alt_chunk | too_many_chars | empty_document | encrypted_pdf | scanned_pdf | too_many_pages."""

    def __init__(self, code: str) -> None:
        # args에 code를 넣어야 자식 프로세스에서 피클로 넘어온 뒤에도 같은 예외로 되살아난다
        super().__init__(code)
        self.code = code
