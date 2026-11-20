"""문단 Excel — 다섯 열(Section No. · Text · Lang · Number note · Remark), 섹션 번호, 아직 표인 표는 행마다 한 줄,
벗긴 표의 칸 줄은 보통 줄, 그림은 `[Figure] 캡션`, Old 문서 모두는 문서마다 시트, 미리 보기 = 파일(시안 2 D4)."""

from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet

from app.sop.numbering import build_section_numbers
from app.sop.paragraph_excel import (
    FIGURE_MARKER,
    PARAGRAPH_HEADERS,
    UnitLine,
    build_paragraph_preview,
    build_paragraph_sheet,
    format_number_note,
    make_sheet_name,
)
from app.sop.sheet_model import Sheet
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, make_list, numbered, p, tbl
from tests.sop_helpers import OUTSIDER, create_bundle, find_unit, get_group_by_unit, get_view, save_group, upload

NUMBERING = make_list(0, [("decimal", "%1."), ("decimal", "%1.%2")], [1])
BODY = (
    numbered("목적", 1) + p("이 절차는 합성 장비의 사용법을 정한다.") + numbered("범위", 1, 1)
    + tbl([["Rotor", "Speed"], ["F-45", "14,000 rpm"]]) + p("표 아래 문장이다.")
    + f"<w:p>{make_drawing_run('image1.png')}</w:p>"
)
MEMBER = {"X-Dev-User": "qa.member"}


def _line(unit_id: int, kind: str, text: str, *, part: str = "body", block_id: int | None = None, **fields) -> UnitLine:
    return UnitLine(unit_id=unit_id, kind=kind, text=text, part=part, block_id=block_id or unit_id, **fields)


def _texts(sheet: Sheet) -> list[list[str]]:
    return [[cell.text for cell in row.cells] for row in sheet.rows]


def _read(response) -> list[Worksheet]:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/vnd.openxmlformats")
    return load_workbook(BytesIO(response.content)).worksheets


def _values(sheet: Worksheet) -> list[list[str]]:
    return [["" if value is None else str(value) for value in row] for row in sheet.iter_rows(values_only=True)]


def _setup(client: TestClient) -> tuple[int, int]:
    bundle_id = create_bundle(client, title="Paragraphs", is_synthetic=True)["id"]
    uploaded = upload(client, bundle_id, build_docx(BODY, numbering=NUMBERING, media={"image1.png": TINY_PNG}), "SYNTHETIC_OLD-1_Para.docx")
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text
    return bundle_id, uploaded.json()["id"]


class _Numbered:
    def __init__(self, lang: str, number: str | None) -> None:
        self.lang, self.number = lang, number


def test_section_numbers_carry_the_nearest_number_of_the_same_language() -> None:
    lines = [
        _Numbered("en", None), _Numbered("en", "3."), _Numbered("en", "•"), _Numbered("en", None), _Numbered("ko", None),
        _Numbered("ko", "가."), _Numbered("en", None), _Numbered("neutral", None), _Numbered("ko", "○"),
    ]

    assert build_section_numbers(lines) == [None, "3.", "3.", "3.", "3.", "가.", "3.", "가.", "가."]


def test_number_note_names_the_source_number() -> None:
    assert format_number_note("3.", "4.") == "Source 3. → 4."
    assert format_number_note("3.", None) == "Source 3. → none"
    assert format_number_note(None, "4.") == ""


def test_sheet_has_five_columns_section_numbers_bullets_notes_and_remarks() -> None:
    lines = [
        _line(1, "heading", "목적", lang="ko", number="1."),
        _line(2, "sentence", "점 기호 줄.", lang="ko", number="•"),
        _line(3, "sentence", "고친 번호 줄.", lang="en", number="4.", number_note="Source 3. → 4.", remark="moved here"),
        _line(4, "sentence", "머리말 글", part="header"),
        _line(5, "sentence", "REF-1 참조", lang="ref"),
    ]

    sheet = build_paragraph_sheet(lines, include_tables=True)

    assert _texts(sheet) == [
        list(PARAGRAPH_HEADERS),
        ["1.", "목적", "KO", "", ""],
        ["1.", "• 점 기호 줄.", "KO", "", ""],
        ["4.", "고친 번호 줄.", "EN", "Source 3. → 4.", "moved here"],
        ["4.", "REF-1 참조", "REF", "", ""],
    ]
    assert sheet.freeze == "A2" and sheet.widths == [12, 90, 6, 18, 40]
    assert sheet.rows[0].kind == "header" and all(cell.head for cell in sheet.rows[0].cells)
    assert [row.unit_id for row in sheet.rows] == [None, 1, 2, 3, 5]


def test_data_table_rows_join_cells_and_unwrapped_lines_are_paragraphs() -> None:
    lines = [
        _line(1, "heading", "범위", number="1.1"),
        _line(2, "table", "", table_id=7, remark="표 사유"),
        _line(3, "cell_sentence", "Rotor", table_id=7, row_index=0, col_index=0, group_unit_id=2),
        _line(4, "cell_sentence", "Speed", table_id=7, row_index=0, col_index=1, group_unit_id=2),
        _line(5, "cell_sentence", "첫 문장.", block_id=50, table_id=7, row_index=1, col_index=1, group_unit_id=2),
        _line(6, "cell_sentence", "둘째 문장.", block_id=50, table_id=7, row_index=1, col_index=1, group_unit_id=2),
        # 벗긴 표의 칸 줄 — 묶음이 풀려 보통 줄이다(같은 행이어도 줄마다)
        _line(7, "cell_sentence", "벗긴 칸 하나.", table_id=8, row_index=0, col_index=0),
        _line(8, "cell_sentence", "벗긴 칸 둘.", table_id=8, row_index=0, col_index=1),
    ]

    with_tables = _texts(build_paragraph_sheet(lines, include_tables=True))[1:]
    without_tables = _texts(build_paragraph_sheet(lines, include_tables=False))[1:]

    assert with_tables == [
        ["1.1", "범위", "", "", ""],
        ["1.1", "Rotor | Speed", "", "", "표 사유"],
        ["1.1", " | 첫 문장. 둘째 문장.", "", "", ""],
        ["1.1", "벗긴 칸 하나.", "", "", ""],
        ["1.1", "벗긴 칸 둘.", "", "", ""],
    ]
    assert [row[1] for row in without_tables] == ["범위", "벗긴 칸 하나.", "벗긴 칸 둘."]


def test_figure_keeps_its_place_with_its_caption() -> None:
    lines = [
        _line(1, "figure", ""),
        _line(2, "caption", "그림 1. 로터", lang="ko", group_unit_id=1),
        _line(3, "figure", ""),
        _line(4, "caption", "표 1. 따로 선 캡션", lang="ko"),
    ]

    texts = [row[1] for row in _texts(build_paragraph_sheet(lines, include_tables=True))[1:]]

    assert texts == [f"{FIGURE_MARKER} 그림 1. 로터", FIGURE_MARKER, "표 1. 따로 선 캡션"]


def test_preview_windows_the_file_rows_around_the_picked_unit() -> None:
    lines = [_line(index, "sentence", f"문장 {index}.") for index in range(1, 21)]
    sheet = build_paragraph_sheet(lines, include_tables=True, name="OLD-1")

    preview = build_paragraph_preview(lines, True, "OLD-1", around_unit_id=15, max_rows=6)
    whole = build_paragraph_preview(lines, True, "OLD-1", around_unit_id=None)

    assert whole == sheet
    assert preview.truncated and preview.total_rows == 21 and preview.offset == 12
    assert preview.rows[0] == sheet.rows[0] and [row.unit_id for row in preview.rows[1:]] == [13, 14, 15, 16, 17]


def test_sheet_names_drop_forbidden_chars_and_never_repeat() -> None:
    taken: set[str] = set()

    names = [make_sheet_name(name, taken) for name in ("OLD/1", "old_1", "", "x" * 40, "x" * 40)]

    assert names == ["OLD_1", "old_1 (2)", "Sheet", "x" * 31, "x" * 27 + " (2)"]


def test_document_download_has_five_columns_and_can_drop_tables(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    url = f"/api/bundles/{bundle_id}/documents/{doc_id}/paragraphs.xlsx"

    with_tables = _values(_read(client.get(url, headers=MEMBER))[0])
    without_tables = _values(_read(client.get(f"{url}?tables=false", headers=MEMBER))[0])

    assert with_tables[0] == list(PARAGRAPH_HEADERS)
    assert [row[:2] for row in with_tables[1:4]] == [
        ["1.", "목적"], ["1.", "이 절차는 합성 장비의 사용법을 정한다."], ["1.1", "범위"],
    ]
    assert [row[1] for row in with_tables[4:]] == ["Rotor | Speed", "F-45 | 14,000 rpm", "표 아래 문장이다.", FIGURE_MARKER]
    assert [row[0] for row in with_tables[4:]] == ["1.1"] * 4
    assert [row[1] for row in without_tables[1:]] == ["목적", "이 절차는 합성 장비의 사용법을 정한다.", "범위", "표 아래 문장이다.", FIGURE_MARKER]


def test_remark_column_shows_the_decision_reason_and_the_preview_matches_the_file(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    unit = find_unit(get_view(client, bundle_id, doc_id), "표 아래 문장이다.")
    group = get_group_by_unit(client, bundle_id, unit["id"])
    saved = save_group(client, bundle_id, {
        "action": "confirm",
        "units": [{"unit_id": unit["id"], "revision": group["units"][0]["decision"]["revision"], "disposition": "delete", "reason": "합성 사유"}],
        "targets": [], "removed_target_ids": [],
    })
    assert saved.status_code == 200, saved.text

    rows = _values(_read(client.get(f"/api/bundles/{bundle_id}/documents/{doc_id}/paragraphs.xlsx", headers=MEMBER))[0])
    preview = client.get(f"/api/bundles/{bundle_id}/documents/{doc_id}/paragraphs/preview?around={unit['id']}", headers=MEMBER)

    assert next(row for row in rows if row[1] == "표 아래 문장이다.")[4] == "합성 사유"
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["truncated"] is False and body["freeze"] == "A2"
    assert [[cell["text"] for cell in row["cells"]] for row in body["rows"]] == rows
    assert unit["id"] in [row["unit_id"] for row in body["rows"]]


def test_old_download_has_a_sheet_per_old_document(client: TestClient) -> None:
    bundle_id, _ = _setup(client)
    second = upload(client, bundle_id, build_docx(p("둘째 문서 문장이다.")), "SYNTHETIC_OLD-2_Para.docx")
    assert second.status_code == 201, second.text
    new = upload(client, bundle_id, build_docx(p("새 문서 문장이다.")), "SYNTHETIC_SOP-N_Para.docx", side="new", doc_type="sop")
    assert new.status_code == 201, new.text

    sheets = _read(client.get(f"/api/bundles/{bundle_id}/old-paragraphs.xlsx", headers=MEMBER))
    new_preview = client.get(f"/api/bundles/{bundle_id}/documents/{new.json()['id']}/paragraphs/preview", headers=MEMBER)

    assert len(sheets) == 2
    assert _values(sheets[1]) == [list(PARAGRAPH_HEADERS), ["", "둘째 문서 문장이다.", "KO", "", ""]]
    assert new_preview.status_code == 200 and new_preview.json()["rows"][1]["cells"][1]["text"] == "새 문서 문장이다."


def test_outsider_cannot_download_or_preview(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)

    single = client.get(f"/api/bundles/{bundle_id}/documents/{doc_id}/paragraphs.xlsx", headers=OUTSIDER)
    every = client.get(f"/api/bundles/{bundle_id}/old-paragraphs.xlsx", headers=OUTSIDER)
    preview = client.get(f"/api/bundles/{bundle_id}/documents/{doc_id}/paragraphs/preview", headers=OUTSIDER)

    assert {single.status_code, every.status_code, preview.status_code} <= {403, 404}
