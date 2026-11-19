"""문단 Excel — 단위 한 줄씩 한 열, 자동 번호는 글 그대로, 표는 고를 수 있고(행 = 줄, 칸 = 옆 열), Old 문서 모두는 문서마다 시트."""

from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet

from app.sop.paragraph_excel import FIGURE_MARKER, UnitLine, build_paragraph_rows, make_sheet_name
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, make_list, numbered, p, tbl
from tests.sop_helpers import OUTSIDER, create_bundle, upload

NUMBERING = make_list(0, [("decimal", "%1."), ("decimal", "%1.%2")], [1])
BODY = (
    numbered("목적", 1) + p("이 절차는 합성 장비의 사용법을 정한다.") + numbered("범위", 1, 1)
    + tbl([["Rotor", "Speed"], ["F-45", "14,000 rpm"]]) + p("표 아래 문장이다.")
    + f"<w:p>{make_drawing_run('image1.png')}</w:p>"
)


def _line(kind: str, text: str, *, part: str = "body", block: int = 1, table: int | None = None,
          row: int | None = None, col: int | None = None) -> UnitLine:
    return UnitLine(kind=kind, text=text, part=part, block_id=block, table_id=table, row_index=row, col_index=col)


def _read(response) -> list[Worksheet]:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/vnd.openxmlformats")
    return load_workbook(BytesIO(response.content)).worksheets


def _values(sheet: Worksheet) -> list[list[str | None]]:
    return [list(row) for row in sheet.iter_rows(values_only=True)]


def _setup(client: TestClient) -> tuple[int, int]:
    bundle_id = create_bundle(client, title="Paragraphs", is_synthetic=True)["id"]
    uploaded = upload(client, bundle_id, build_docx(BODY, numbering=NUMBERING, media={"image1.png": TINY_PNG}), "SYNTHETIC_OLD-1_Para.docx")
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text
    return bundle_id, uploaded.json()["id"]


def test_rows_put_one_unit_per_line_and_table_rows_across_columns() -> None:
    units = [
        _line("heading", "1. 목적", block=1),
        _line("figure", "", block=2),
        _line("table", "", table=7),
        _line("cell_sentence", "Rotor", block=3, table=7, row=0, col=0),
        _line("cell_sentence", "Speed", block=4, table=7, row=0, col=1),
        _line("cell_sentence", "첫 문장.", block=5, table=7, row=1, col=1),
        _line("cell_sentence", "둘째 문장.", block=5, table=7, row=1, col=1),
        _line("cell_sentence", "다른 문단.", block=6, table=7, row=1, col=1),
        _line("sentence", "머리말 글", part="header", block=8),
        _line("caption", "그림 1. 로터", block=9),
    ]

    with_tables = build_paragraph_rows(units, include_tables=True)
    without_tables = build_paragraph_rows(units, include_tables=False)

    assert with_tables == [
        ["1. 목적"], [FIGURE_MARKER], ["Rotor", "Speed"], ["", "첫 문장. 둘째 문장.\n다른 문단."], ["그림 1. 로터"],
    ]
    assert without_tables == [["1. 목적"], [FIGURE_MARKER], ["그림 1. 로터"]]


def test_sheet_names_drop_forbidden_chars_and_never_repeat() -> None:
    taken: set[str] = set()

    names = [make_sheet_name(name, taken) for name in ("OLD/1", "old_1", "", "x" * 40, "x" * 40)]

    assert names == ["OLD_1", "old_1 (2)", "Sheet", "x" * 31, "x" * 27 + " (2)"]


def test_document_download_keeps_word_numbers_and_can_drop_tables(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    url = f"/api/bundles/{bundle_id}/documents/{doc_id}/paragraphs.xlsx"

    with_tables = _read(client.get(url, headers={"X-Dev-User": "qa.member"}))
    without_tables = _read(client.get(f"{url}?tables=false", headers={"X-Dev-User": "qa.member"}))

    rows = _values(with_tables[0])
    assert rows[0][0].startswith("1.") and rows[0][0].endswith("목적")
    assert rows[1][0] == "이 절차는 합성 장비의 사용법을 정한다."
    assert rows[2][0].startswith("1.1") and rows[2][0].endswith("범위")
    assert rows[3:5] == [["Rotor", "Speed"], ["F-45", "14,000 rpm"]]
    assert [row[0] for row in rows[5:]] == ["표 아래 문장이다.", FIGURE_MARKER]
    assert [row[0] for row in _values(without_tables[0])] == [rows[0][0], rows[1][0], rows[2][0], rows[5][0], FIGURE_MARKER]


def test_old_download_has_a_sheet_per_old_document(client: TestClient) -> None:
    bundle_id, _ = _setup(client)
    second = upload(client, bundle_id, build_docx(p("둘째 문서 문장이다.")), "SYNTHETIC_OLD-2_Para.docx")
    assert second.status_code == 201, second.text
    new = upload(client, bundle_id, build_docx(p("새 문서 문장이다.")), "SYNTHETIC_SOP-N_Para.docx", side="new", doc_type="sop")
    assert new.status_code == 201, new.text

    sheets = _read(client.get(f"/api/bundles/{bundle_id}/old-paragraphs.xlsx", headers={"X-Dev-User": "qa.member"}))

    assert len(sheets) == 2
    assert _values(sheets[1]) == [["둘째 문서 문장이다."]]


def test_outsider_cannot_download(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)

    single = client.get(f"/api/bundles/{bundle_id}/documents/{doc_id}/paragraphs.xlsx", headers=OUTSIDER)
    every = client.get(f"/api/bundles/{bundle_id}/old-paragraphs.xlsx", headers=OUTSIDER)

    assert single.status_code in (403, 404) and every.status_code in (403, 404)
