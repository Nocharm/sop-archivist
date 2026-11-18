"""추출 측정 — DOCX·PDF 파일을 지금 추출기로 읽어 구조 숫자만 출력한다(파싱 규칙을 고치기 전후를 견주는 용도). 로컬 전용.

실제 문서를 가진 사람이 제 PC에서 돌려 결과 숫자만 알려 주는 도구다. 그래서 경로·파일 이름·원문 글자는 출력하지 않고,
파일은 인자 순서대로 `#1`, `#2`로만 표시한다. DB·서버를 쓰지 않는다(단위는 초안까지만 만든다).
줄마다 `#n {JSON}` 하나 — 받지 않는 파일은 {"rejected": 코드}, 읽다 죽으면 {"failed": 예외 클래스 이름}.
아직 추출기에 없는 지표(아이콘 표시·잡음 표시·한글 절반의 영어 단위·번호 대조)는 null이다.

실행 (backend/ 에서):
    bash:       .venv/bin/python -m scripts.measure_extraction <파일…> [--no-aux]
    PowerShell: .venv\\Scripts\\python -m scripts.measure_extraction <파일…> [--no-aux]
--no-aux는 MarkItDown 보조 대조(느리다)를 건너뛴다.
"""

import argparse
import json
import re
import sys
from collections import Counter
from collections.abc import Iterable
from pathlib import Path

from app.sop.doc_meta import detect_header_fields, detect_language_layout
from app.sop.extract.aux_compare import convert_with_markitdown, find_missing_text
from app.sop.extract.docx_reader import FLAG_AUTO_NUMBERING, SIGNAL_BAND, SIGNAL_NUMBERS, SIGNAL_TOC, read_docx
from app.sop.extract.pdf_reader import read_pdf
from app.sop.extract.types import ExtractionRejected, ExtractResult
from app.sop.ingest import build_limits
from app.sop.segment import BlockView, TableView, build_unit_drafts, build_unit_text, split_sentences
from app.sop.units import LINE_SPLIT_FORMAT

SENTENCE_LIKE_LABEL_CHARS = 20  # 절 이름이 이보다 길면 제목이 아니라 문장을 절 이름으로 삼은 것으로 센다
_BARE_LABEL_RE = re.compile(r"[A-Z](?:-\d+)?|\d+(?:\.\d+)*\.?")
_READERS = {"docx": read_docx, "pdf": read_pdf}
_NOT_MEASURED = ("icon_marks", "icon_figures", "noise_marked_units", "en_units_in_ko_half", "numbering_mismatch")


def measure_extraction(data: bytes, file_format: str, *, with_aux: bool = True) -> dict[str, object]:
    """파일 하나의 지표 — 키는 설계(2026-11-17 template-fit) 작업 2의 측정 도구 표와 같고, 신호 수 몇 개를 더한다."""
    result = _READERS[file_format](data, build_limits())
    layout = detect_language_layout(result.blocks, has_language_halves=result.has_language_halves)
    header = detect_header_fields(result.blocks)
    metrics = _measure_units(result, layout, split_lines=file_format == LINE_SPLIT_FORMAT)
    blocks = result.blocks
    labels = [block.section_label for block in blocks if block.part not in ("header", "footer")]
    metrics.update(
        empty_section_blocks=sum(1 for label in labels if not label),
        sentence_like_section_labels=sum(
            1 for label in labels if len(label) > SENTENCE_LIKE_LABEL_CHARS or label.endswith(".")
        ),
        layout=layout,
        doc_meta_found={"doc_code": header.doc_code is not None, "version": header.version is not None},
        aux_missing_warnings=_count_aux_missing(data, file_format, result) if with_aux else None,
        unresolved_numbers=sum(1 for block in blocks if FLAG_AUTO_NUMBERING in block.flags),
        number_signals=_count_sorted(
            str(number[2]) for block in blocks for number in block.signals.get(SIGNAL_NUMBERS, ())
        ),
        toc_signal_blocks=_count_sorted(
            str(reason) for block in blocks for reason in block.signals.get(SIGNAL_TOC, ())
        ),
        band_tables=sum(1 for table in result.tables if SIGNAL_BAND in table.signals),
        nested_tables=sum(1 for table in result.tables if table.parent_index is not None),
        warnings_by_kind=_count_sorted(warning.kind for warning in result.warnings),
    )
    metrics.update(dict.fromkeys(_NOT_MEASURED))
    return metrics


def _measure_units(result: ExtractResult, layout: str, *, split_lines: bool) -> dict[str, object]:
    """단위 초안으로 세는 지표 — DB 없이 블록 seq를 블록 id로, 표 순번을 표 id로 쓴다(표는 모두 데이터 표)."""
    blocks = {block.seq: block for block in result.blocks}
    views = [
        BlockView(
            id=block.seq, seq=block.seq, kind=block.kind, part=block.part, text=block.text,
            heading_level=block.heading_level, flags=block.flags, table_id=block.table_index, row_index=block.row_index,
        )
        for block in result.blocks
    ]
    tables = [TableView(id=table.index, is_layout=False) for table in result.tables]
    drafts = build_unit_drafts(views, tables, layout, split_lines=split_lines)
    texts = {block.seq: block.text for block in result.blocks}
    unit_texts = [build_unit_text(draft.spans, texts) for draft in drafts]
    headings = [(draft, text) for draft, text in zip(drafts, unit_texts, strict=True) if draft.kind == "heading"]
    cell_counts = Counter(draft.group_index for draft in drafts if draft.kind == "cell_sentence")
    return {
        "units_by_kind": _count_sorted(draft.kind for draft in drafts),
        "headings_by_level": _count_sorted(str(blocks[draft.pos_seq].heading_level) for draft, _ in headings),
        "multi_sentence_headings": sum(1 for _, text in headings if len(split_sentences(text)) >= 2),
        "largest_table_unit_sentences": max(cell_counts.values(), default=0),
        "table_units": sum(1 for draft in drafts if draft.kind == "table"),
        "bare_label_units": sum(1 for text in unit_texts if _BARE_LABEL_RE.fullmatch(text.strip()) is not None),
        "textbox_units": sum(1 for draft in drafts if blocks[draft.pos_seq].part == "textbox"),
    }


def _count_sorted(values: Iterable[str]) -> dict[str, int]:
    return dict(sorted(Counter(values).items()))


def _count_aux_missing(data: bytes, file_format: str, result: ExtractResult) -> int | None:
    """보조 대조의 "빠진 글" 수 — 보조 변환이 실패하면 None(업로드에서도 경고 없이 넘어간다)."""
    try:
        markdown = convert_with_markitdown(data, file_format)
    except Exception:  # noqa: BLE001 — MarkItDown은 깨진 파일에 갖가지 예외를 낸다. 측정은 나머지 숫자를 계속 낸다
        return None
    return len(find_missing_text([block.text for block in result.blocks], markdown))


def measure_file(path: Path, *, with_aux: bool) -> dict[str, object]:
    """경로 하나 → 지표 또는 거절·실패 까닭. 경로·이름·예외 메시지(원문이 실릴 수 있다)는 돌려주지 않는다."""
    file_format = path.suffix.lower().lstrip(".")
    if file_format not in _READERS:
        return {"rejected": "invalid_format"}
    try:
        return measure_extraction(path.read_bytes(), file_format, with_aux=with_aux)
    except ExtractionRejected as error:
        return {"rejected": error.code}
    except Exception as error:  # noqa: BLE001 — 파일 하나가 죽어도 나머지를 잰다. 클래스 이름만 남긴다
        return {"failed": type(error).__name__}


def run(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Print extraction metrics (numbers only) for DOCX/PDF files.")
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--no-aux", action="store_true", help="skip the MarkItDown comparison")
    args = parser.parse_args(argv)
    for number, path in enumerate(args.paths, start=1):
        metrics = measure_file(path, with_aux=not args.no_aux)
        print(f"#{number} {json.dumps(metrics, ensure_ascii=False, sort_keys=True)}")
    return 0


if __name__ == "__main__":
    sys.exit(run(sys.argv[1:]))
