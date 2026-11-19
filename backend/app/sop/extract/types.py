"""추출 결과 타입 — 자식 프로세스 경계를 넘어 피클되므로 불변 dataclass·튜플·평범한 dict만 쓴다."""

from dataclasses import dataclass, field

# 추출 규칙이 바뀌면 올린다 — 같은 파일의 예전 추출과 새 추출을 구별하는 근거(extractions.extractor_version)
# 2: Word 자동 번호를 글 앞에 써 넣고 머리말·꼬리말에 구역 표시(section_ref)를 남긴다 — 1로 뽑은 추출은 번호·표시가 없다
# 3: 캡션 문단을 그림 블록 글로 넣지 않고 제 문단 블록으로 남겨 caption_of 표시로 그림·표를 가리킨다 — 표 캡션도 찾는다
# 4: 스타일이 물려받은 목록의 수준과 숨긴 윗수준 문단 뒤의 번호를 Word처럼 센다 — 3으로 뽑은 추출은 그런 문단의 번호가 다르다
# 5: 블록·표에 구조 신호(signals — 번호 범위, 목차, 띠 표, 표 꼴, 안쪽 표 자리)를 남기고 띠 표 번호로 절 경로를 잡는다 —
#    4까지의 추출은 signals가 비어 있다(다시 올려야 생긴다)
# 6: 블록은 5와 같다. 쪼개기가 Reference 절 아래 줄을 REF로 확정하고 글을 보고 제안하지 않는다(refs.FIRST_SECTION_REF_VERSION) —
#    5까지의 추출은 전처럼 제안한다
EXTRACTOR_VERSION = "6"


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
    """표 하나 — index는 추출 안에서 읽은 순서(0부터), 칸 안의 표는 parent_index로 바깥 표를 가리킨다.

    signals는 표 꼴 신호다(있는 것만 싣는다):
    - "widths": 격자 열 폭 목록(twip) — 같은 꼴 표 판정의 재료(열 수는 n_cols)
    - "first_row": 첫 행 칸 안의 표들 [[격자 열, "band" | "table"], …]
    - "band": 띠 표(1행 3칸: 번호 칸 | 빈 칸 | 제목 칸)의 {"number": "7.4", "level": 2} — 수준은 번호의 점 개수 + 1
    - "place": 안쪽 표가 바깥 칸에서 놓인 자리 {"row", "col", "para"} — para는 그 칸에서 표 앞에 있던 문단 수
    """

    index: int
    parent_index: int | None
    part: str
    xml_path: str
    n_rows: int
    n_cols: int
    signals: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ExtractedBlock:
    """원문 블록 하나 — seq는 0부터 읽은 순서대로 늘고, row_index·col_index도 0부터다.

    page_basis는 문서 전체에 하나(rendered|manual|estimated)이고, 본문 밖 부분은 page가 None이다.
    signals는 블록 신호다(있는 것만 싣는다, 글자 위치는 text 안의 자리):
    - "numbers": 번호 라벨 범위 [[시작, 끝, "auto" | "typed" | "cell"], …] — auto는 추출기가 써 넣은 Word 자동 번호(뒤에 같은 번호를
      타자로 또 쳤으면 거기까지), typed는 글 앞에 타자로 친 번호, cell은 글 전체가 번호 꼴인 칸("7", "A-1"). 칸 블록은 문단마다 하나
    - "paras": 칸 안 문단들의 시작 자리(문단이 둘 이상일 때)
    - "toc": 목차로 보이는 까닭들 — "style"(toc N 스타일) · "field"(TOC 필드 결과) · "sdt"(목차 구성 요소) · "leader"(점 끌기)
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
    signals: dict[str, object] = field(default_factory=dict)


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
    # 한글 절반·영어 절반을 가르는 책갈피나 스타일이 문서에 있다 — 언어 배치 판정(doc_meta)이 줄 순서보다 먼저 믿는다
    has_language_halves: bool = False


class ExtractionRejected(Exception):
    """파일을 받지 않는 이유 — code: not_a_zip_or_encrypted | unsafe_zip | invalid_format | tracked_changes
    | alt_chunk | too_many_chars | empty_document | encrypted_pdf | scanned_pdf | too_many_pages | drm_protected."""

    def __init__(self, code: str) -> None:
        # args에 code를 넣어야 자식 프로세스에서 피클로 넘어온 뒤에도 같은 예외로 되살아난다
        super().__init__(code)
        self.code = code
