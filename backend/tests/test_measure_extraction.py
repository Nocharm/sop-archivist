"""추출 측정 스크립트 — 숫자만 출력하고 경로·파일 이름·원문 글자를 내지 않는다."""

import json
from pathlib import Path

import pytest

from scripts.measure_extraction import measure_extraction, run
from tests.docx_factory import build_docx, make_grid_table, make_row, p

SENTENCE = "필터 차압이 0.8 bar를 넘으면 교체한다."
BODY = (
    make_grid_table(3, make_row(["7.4", "", "필터 교체 (Filter change)"]))
    + p("1.1. " + SENTENCE + " 교체한 날짜를 적는다.")
    + make_grid_table(2, make_row(["A", "덮개를 연다."]) + make_row(["A-1", "필터를 꺼낸다. 차압을 적는다."]))
    + p("관련 서식 ........ 별첨")
)


@pytest.mark.parametrize(("rule", "largest"), [(1, 5), (2, 4)])
def test_measure_counts_units_sections_and_signals(rule: int, largest: int) -> None:
    metrics = measure_extraction(build_docx(BODY), "docx", with_aux=False, rule=rule)

    # 타자로 친 점 끌기 줄은 규칙 1이 점 뒤에서 둘로 나눈다("관련 서식 ........" / "별첨") — 규칙 2는 같은 언어라 하나다
    assert metrics["units_by_kind"] == {
        "1": {"cell_sentence": 7, "sentence": 4, "table": 2}, "2": {"cell_sentence": 6, "sentence": 2, "table": 2},
    }
    assert (metrics["table_units"], metrics["largest_table_unit_sentences"]) == (2, largest)
    assert metrics["bare_label_units"] == 3  # "7.4", "A", "A-1"
    assert (metrics["empty_section_blocks"], metrics["sentence_like_section_labels"]) == (0, 0)
    assert (metrics["band_tables"], metrics["nested_tables"]) == (1, 0)
    assert metrics["number_signals"] == {"cell": 3, "typed": 1}
    assert metrics["toc_signal_blocks"] == {"leader": 1}
    assert (metrics["layout"], metrics["doc_meta_found"]) == ("ko_en_interleaved", {"doc_code": False, "version": False})
    assert metrics["aux_missing_warnings"] is None and metrics["icon_marks"] is None


def test_run_prints_numbers_only(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    good, drm, other = (tmp_path / name for name in ("SYNTHETIC_secret_name.docx", "SYNTHETIC_locked.docx", "notes.txt"))
    good.write_bytes(build_docx(BODY))
    drm.write_bytes(b"<## TEST DRM FILE ##>" + b"\x00" * 64)
    other.write_text(SENTENCE)

    assert run([str(good), str(drm), str(other), "--no-aux"]) == 0

    out = capsys.readouterr().out
    lines = out.splitlines()
    assert [line.split(" ", 1)[0] for line in lines] == ["#1", "#2", "#3"]
    assert json.loads(lines[0].split(" ", 1)[1])["table_units"] == 2
    assert [json.loads(line.split(" ", 1)[1]) for line in lines[1:]] == [
        {"rejected": "drm_protected"}, {"rejected": "invalid_format"},
    ]
    for leaked in ("SYNTHETIC", "secret_name", str(tmp_path), "필터", "Filter", "덮개"):
        assert leaked not in out
