"""자식 프로세스 테스트 대상 — spawn 자식이 새 인터프리터에서 import하므로 모듈 최상위 함수로 둔다(합성 글만 쓴다)."""

import os
import time
from typing import NoReturn

from app.sop.extract.aux_compare import convert_with_markitdown
from app.sop.extract.types import ExtractedBlock, ExtractResult
from app.sop.extract.worker import WorkerResult

# 메인 추출이 놓친 척 보조 변환에만 붙이는 합성 줄
EXTRA_LINE = "Synthetic line the main reader missed"
MANY_MISSING_LINES = 250  # 누락 대조 상한(200)보다 많게


def sleep_forever(*_args: object) -> NoReturn:
    """시간 초과 흉내 — 부모가 끝낼 때까지 돌려주지 않는다."""
    while True:
        time.sleep(60)


def exit_hard(*_args: object) -> NoReturn:
    """결과 없이 죽는 자식 흉내 — 메모리 상한에 걸린 abort·OOM kill과 같은 모양이다."""
    os._exit(3)


def raise_with_text(*_args: object) -> NoReturn:
    """메시지에 원문이 든 예외 흉내 — 부모에는 클래스 이름만 넘어와야 한다."""
    raise ValueError("Synthetic secret sentence from the document")


def return_tiny_result(*_args: object) -> WorkerResult:
    """곧바로 끝나는 메인 추출 흉내 — 보조 자식만 따로 시험할 때 쓴다."""
    block = ExtractedBlock(
        seq=0, part="body", kind="paragraph", text="Synthetic body", xml_path="word/document.xml/body/p[1]",
        page=1, page_basis="estimated", section_label="", heading_level=None, table_index=None,
        row_index=None, col_index=None, grid_span=1, row_span=1, image_part=None, flags=(),
    )
    return WorkerResult("ok", "", ExtractResult(blocks=(block,), tables=(), warnings=()), None, None)


def convert_with_extra_line(data: bytes, file_format: str) -> WorkerResult:
    """진짜 MarkItDown 결과 끝에 메인에 없는 줄 하나를 붙인다."""
    markdown = convert_with_markitdown(data, file_format) + f"\n\n{EXTRA_LINE}\n"
    return WorkerResult("ok", "", None, markdown, None)


def convert_to_many_missing_lines(*_args: object) -> WorkerResult:
    """메인에 없는 줄만 상한보다 많이 돌려준다 — 누락 의심이 잘리는 경우."""
    markdown = "\n\n".join(f"Synthetic missing line {n:03d}" for n in range(MANY_MISSING_LINES))
    return WorkerResult("ok", "", None, markdown, None)
