"""문단 Excel — 다섯 열(Section No. · Text · Lang · Number note · Remark), 섹션 번호, 아직 표인 표는 행마다 한 줄,
벗긴 표의 칸 줄은 보통 줄, 그림은 `[Figure] 캡션`, Old 문서 모두는 문서마다 시트, 미리 보기 = 파일(시안 2 D4)."""

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet

from app.sop.models import Unit
from app.sop.numbering import LevelRow, build_row_levels, build_section_numbers
from app.sop.paragraph_excel import (
    FIGURE_MARKER,
    PARAGRAPH_HEADERS,
    ParagraphInclude,
    UnitLine,
    build_paragraph_file,
    build_paragraph_preview,
    build_paragraph_sheet,
    format_number_note,
    make_sheet_name,
)
from app.sop.sheet_model import Sheet
from tests.access_helpers import update_row
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, make_list, numbered, p, tbl
from tests.sop_helpers import AUTHOR, OUTSIDER, create_bundle, find_unit, get_group_by_unit, get_view, save_group, upload

pytestmark = pytest.mark.usefixtures("legacy_split_rule")

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
    def __init__(self, lang: str, number: str | None, blocks: tuple[int, ...] = (), is_cell_number: bool = False) -> None:
        self.lang, self.number, self.blocks, self.is_cell_number = lang, number, blocks, is_cell_number


def test_section_numbers_carry_the_nearest_number_of_the_same_language() -> None:
    lines = [
        _Numbered("en", None), _Numbered("en", "3."), _Numbered("en", "•"), _Numbered("en", None), _Numbered("ko", None),
        _Numbered("ko", "가."), _Numbered("en", None), _Numbered("neutral", None), _Numbered("ko", "○"),
    ]

    assert build_section_numbers(lines) == [None, "3.", "3.", "3.", "3.", "가.", "3.", "가.", "가."]


def test_cell_numbers_of_an_unwrapped_table_stay_inside_it() -> None:
    """§6-3 — 절 "5" 아래 벗긴 표의 숫자 칸 "1" "2" "3"은 덩이 안에서만 Section No.이고, 표 뒤 문단은 "5"로 돌아간다.
    덩이 안에서 사람이 정한 번호는 보통 번호처럼 표 뒤로 이어진다."""
    lines = [
        _Numbered("ko", "5"), _Numbered("neutral", "1", (9,), True), _Numbered("neutral", "•", (9,)), _Numbered("neutral", "2", (9,), True),
        _Numbered("ko", None), _Numbered("neutral", "3", (7,), True), _Numbered("ko", "5.1", (7,)), _Numbered("ko", None),
    ]

    assert build_section_numbers(lines) == ["5", "1", "1", "2", "5", "3", "5.1", "5.1"]


def test_a_nested_unwrapped_table_carries_the_outer_cell_number_and_drops_its_own() -> None:
    """바깥 덩이 9의 칸 "1" 안에 안쪽 덩이 4 — 안쪽 줄은 "1"을 이어받고, 안쪽 칸 "A"는 안쪽 덩이를 나오면 버려 바깥 줄은 다시 "1",
    바깥 덩이를 나오면 "5"."""
    lines = [
        _Numbered("ko", "5"), _Numbered("ko", "1", (9,), True), _Numbered("ko", None, (9, 4)), _Numbered("ko", "A", (9, 4), True),
        _Numbered("ko", None, (9, 4)), _Numbered("ko", None, (9,)), _Numbered("ko", "2", (9,), True), _Numbered("ko", None, (9, 6)),
        _Numbered("ko", None),
    ]

    assert build_section_numbers(lines) == ["5", "1", "1", "A", "A", "1", "2", "2", "5"]


def test_row_levels_follow_the_paper_tabs() -> None:
    """용지 번호 칸 단계의 사본 — 숫자 번호는 마디 수, 기호는 숫자 깊이 + 1 + 순번 + 차이, 번호 없는 줄은 기댄 줄 + 차이,
    번호 칸 없는 줄은 직전 줄, 짝 카드 둘째 줄은 첫 줄."""
    rows = [
        LevelRow("5"), LevelRow("5.1"), LevelRow("•"), LevelRow("", shift=-1), LevelRow("○"), LevelRow("", has_cell=False),
        LevelRow("6", shift=3), LevelRow("", pair_top=6), LevelRow("가."), LevelRow("•", shift=9),
    ]

    assert build_row_levels(rows) == [1, 2, 3, 2, 4, 4, 1, 1, 1, 8]


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

    sheet = build_paragraph_sheet(lines)

    assert _texts(sheet) == [
        list(PARAGRAPH_HEADERS),
        ["1.", "목적", "KO", "", ""],
        ["1. •", "점 기호 줄.", "KO", "", ""],
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

    with_tables = _texts(build_paragraph_sheet(lines))[1:]
    without_tables = _texts(build_paragraph_sheet(lines, ParagraphInclude(tables=False)))[1:]

    assert with_tables == [
        ["1.1", "범위", "", "", ""],
        ["1.1", "Rotor | Speed", "", "", "표 사유"],
        ["1.1", " | 첫 문장. 둘째 문장.", "", "", ""],
        ["1.1", "벗긴 칸 하나.", "", "", ""],
        ["1.1", "벗긴 칸 둘.", "", "", ""],
    ]
    assert [row[1] for row in without_tables] == ["범위", "벗긴 칸 하나.", "벗긴 칸 둘."]


def test_deleted_line_stays_as_a_struck_row_without_a_language() -> None:
    lines = [
        _line(1, "sentence", "남는 줄.", lang="ko", number="3."),
        _line(2, "sentence", "지운 줄.", lang="ko", number="4.", number_note="Source 3. → 4.", deleted=True),
        _line(3, "sentence", "사유 있는 지운 줄.", lang="en", deleted=True, remark="중복"),
    ]

    sheet = build_paragraph_sheet(lines)

    assert _texts(sheet)[1:] == [
        ["3.", "남는 줄.", "KO", "", ""],
        ["4.", "지운 줄.", "", "Source 3. → 4.", "Deleted"],
        ["4.", "사유 있는 지운 줄.", "", "", "Deleted — 중복"],
    ]
    assert [row.deleted for row in sheet.rows] == [False, False, True, True]
    text_cells = [row.cells[1] for row in sheet.rows[1:]]
    assert [(cell.strike, cell.faint) for cell in text_cells] == [(False, False), (True, True), (True, True)]
    font = load_workbook(BytesIO(build_paragraph_file([sheet]))).worksheets[0]["B3"].font
    assert font.strike and font.color.rgb == "FF9AA0A6"


def test_adjacent_lines_sent_to_one_new_sentence_are_one_row() -> None:
    """9-c — 이어진 줄이 같은 새 문장 하나로 가면 한 행(첫 줄의 번호 · 노트, 사유는 " / "), 사이에 다른 줄이 끼면 각자 행."""
    lines = [
        _line(1, "sentence", "첫 줄.", lang="ko", number="2.", number_note="Read from text", target_id=40, remark="합침"),
        _line(2, "sentence", "둘째 줄.", lang="ko", target_id=40),
        _line(3, "sentence", "영어 줄.", lang="en", target_id=40, remark="번역"),
        _line(4, "sentence", "끼인 줄.", lang="ko", target_id=41),
        _line(5, "sentence", "떨어진 줄.", lang="ko", target_id=40),
    ]

    sheet = build_paragraph_sheet(lines)

    assert _texts(sheet)[1:] == [
        ["2.", "첫 줄. 둘째 줄. 영어 줄.", "", "Read from text", "합침 / 번역"],
        ["2.", "끼인 줄.", "KO", "", ""],
        ["2.", "떨어진 줄.", "KO", "", ""],
    ]
    assert [(row.unit_id, row.unit_ids) for row in sheet.rows[1:]] == [(1, [1, 2, 3]), (4, []), (5, [])]
    preview = build_paragraph_preview(lines * 1, ParagraphInclude(), "OLD-1", around_unit_id=3, max_rows=2)
    assert [row.unit_id for row in preview.rows[1:]] == [1]


def test_text_indent_is_the_paper_level() -> None:
    lines = [
        _line(1, "heading", "절.", number="5"),
        _line(2, "sentence", "하위.", number="5.1"),
        _line(3, "sentence", "기호.", number="•"),
        _line(4, "sentence", "내어 쓴 줄.", indent_shift=-1),
        _line(5, "sentence", "짝 첫째.", pair_id=8),
        _line(6, "sentence", "짝 둘째 — 번호가 있어도 첫 줄 단계.", number="6", pair_id=8),
    ]

    sheet = build_paragraph_sheet(lines)

    assert [row.cells[1].indent for row in sheet.rows[1:]] == [0, 1, 2, 1, 2, 2]


def test_figure_keeps_its_place_with_its_caption() -> None:
    lines = [
        _line(1, "figure", ""),
        _line(2, "caption", "그림 1. 로터", lang="ko", group_unit_id=1),
        _line(3, "figure", ""),
        _line(4, "caption", "표 1. 따로 선 캡션", lang="ko"),
    ]

    texts = [row[1] for row in _texts(build_paragraph_sheet(lines))[1:]]

    assert texts == [f"{FIGURE_MARKER} 그림 1. 로터", FIGURE_MARKER, "표 1. 따로 선 캡션"]


def test_preview_windows_the_file_rows_around_the_picked_unit() -> None:
    lines = [_line(index, "sentence", f"문장 {index}.") for index in range(1, 21)]
    sheet = build_paragraph_sheet(lines, name="OLD-1")

    preview = build_paragraph_preview(lines, ParagraphInclude(), "OLD-1", around_unit_id=15, max_rows=6)
    whole = build_paragraph_preview(lines, ParagraphInclude(), "OLD-1", around_unit_id=None)

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

    assert next(row for row in rows if row[1] == "표 아래 문장이다.")[2:] == ["", "", "Deleted — 합성 사유"]
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["truncated"] is False and body["freeze"] == "A2"
    assert [[cell["text"] for cell in row["cells"]] for row in body["rows"]] == [row for row in rows if row[1] != FIGURE_MARKER]
    assert [row["unit_id"] for row in body["rows"] if row["deleted"]] == [unit["id"]]


def test_lines_merged_into_one_new_sentence_download_as_one_row(client: TestClient) -> None:
    from tests.test_sop_decisions import RECORDS, WARM_UP, _merge
    from tests.test_sop_decisions import _setup as setup_tobe

    fx = setup_tobe(client)
    first, second = find_unit(fx.view, WARM_UP), find_unit(fx.view, RECORDS)
    _merge(client, fx, first, second)

    rows = _values(_read(client.get(f"/api/bundles/{fx.bundle_id}/documents/{fx.doc['id']}/paragraphs.xlsx", headers=MEMBER))[0])
    preview = client.get(f"/api/bundles/{fx.bundle_id}/documents/{fx.doc['id']}/paragraphs/preview", headers=MEMBER).json()

    assert f"{WARM_UP} {RECORDS}" in [row[1] for row in rows]
    assert WARM_UP not in [row[1] for row in rows]
    assert [row["unit_ids"] for row in preview["rows"] if row["unit_ids"]] == [[first["id"], second["id"]]]


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


def test_unwrapped_number_cells_do_not_leak_past_the_table(client: TestClient) -> None:
    """§6-3 합성 표 — 절 "5" 아래 숫자 칸 표를 벗기면 칸 줄은 "1" "2" "3"(기호 줄은 "1 •"), 표 뒤 문단은 "5"로 돌아간다."""
    from tests.docx_factory import make_grid_table, make_row
    from tests.test_sop_unwrap import _unwrap

    table = make_grid_table(2, (
        make_row(["1", p("탱크 밸브를 연다.") + numbered("밸브를 확인한다.", 1)])
        + make_row(["2", "펌프를 켠다."])
        + make_row(["3", "유량을 기록한다."])
    ))
    body = p("5. 조제 탱크 운전", "Heading1") + table + p("조제가 끝나면 기록을 남긴다.")
    bullets = make_list(0, [("bullet", "•")], [1])
    bundle_id = create_bundle(client, title="Cells", is_synthetic=True)["id"]
    uploaded = upload(client, bundle_id, build_docx(body, numbering=bullets), "SYNTHETIC_OLD-5_Cells.docx")
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text
    doc_id = uploaded.json()["id"]
    _unwrap(client, bundle_id, doc_id, 0)

    rows = _values(_read(client.get(f"/api/bundles/{bundle_id}/documents/{doc_id}/paragraphs.xlsx", headers=MEMBER))[0])

    assert [row[:2] for row in rows[1:]] == [
        ["5.", "조제 탱크 운전"], ["1", "탱크 밸브를 연다."], ["1 •", "밸브를 확인한다."], ["2", "펌프를 켠다."], ["3", "유량을 기록한다."],
        ["5.", "조제가 끝나면 기록을 남긴다."],
    ]


def test_an_unwrapped_table_inside_an_unwrapped_cell_keeps_the_outer_cell_number(client: TestClient) -> None:
    """바깥 숫자 칸 "1" 안의 안쪽 표까지 벗기면 안쪽 줄도 "1"(바깥 칸 번호를 이어받는다), 바깥 표 뒤는 "5."."""
    from tests.docx_factory import make_grid_table, make_row
    from tests.test_sop_unwrap import _unwrap

    inner = make_grid_table(1, make_row(["압력을 본다."]) + make_row(["온도를 본다."]))
    outer = make_grid_table(2, (
        make_row(["1", p("밸브를 연다.") + inner + p("밸브를 닫는다.")])
        + make_row(["2", "펌프를 켠다."])
    ))
    body = p("5. 조제 탱크 운전", "Heading1") + outer + p("조제가 끝나면 기록을 남긴다.")
    bundle_id = create_bundle(client, title="Nested", is_synthetic=True)["id"]
    uploaded = upload(client, bundle_id, build_docx(body), "SYNTHETIC_OLD-6_Nested.docx")
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text
    doc_id = uploaded.json()["id"]
    tables = get_view(client, bundle_id, doc_id)["tables"]
    outer_index = next(index for index, table in enumerate(tables) if table["parent_table_id"] is None)
    _unwrap(client, bundle_id, doc_id, outer_index)
    _unwrap(client, bundle_id, doc_id, 1 - outer_index)

    rows = _values(_read(client.get(f"/api/bundles/{bundle_id}/documents/{doc_id}/paragraphs.xlsx", headers=MEMBER))[0])

    assert [row[:2] for row in rows[1:]] == [
        ["5.", "조제 탱크 운전"], ["1", "밸브를 연다."], ["1", "밸브를 닫는다."], ["1", "압력을 본다."], ["1", "온도를 본다."],
        ["2", "펌프를 켠다."], ["5.", "조제가 끝나면 기록을 남긴다."],
    ]


def _mark(view: dict, kind: str, *texts: str, reason: str = "") -> None:
    for text in texts:
        update_row(Unit, find_unit(view, text)["id"], noise_kind=kind, noise_reason=reason)


@pytest.mark.parametrize("side", ["old", "new"])
def test_front_lines_are_struck_with_their_reason(client: TestClient, side: str) -> None:
    # 저절로 삭제된 줄은 확정 삭제한 줄처럼 — Text는 번호까지 원문 그대로, 번호 · Lang 칸은 비고 미리 보기는 숨긴다
    bundle_id = create_bundle(client, title="Paragraphs", is_synthetic=True)["id"]
    body = p("합성 표준 절차서") + p("0.1 합성 결재") + tbl([["작성", "검토"], ["서명", "날짜"]]) + p("1. 본문 문장이다.") + p("9. 개정 이력")
    uploaded = upload(client, bundle_id, build_docx(body), f"SYNTHETIC_{side}_Front.docx", side=side, doc_type="sop" if side == "new" else None)
    assert uploaded.status_code == 201, uploaded.text
    doc_id = uploaded.json()["id"]
    view = get_view(client, bundle_id, doc_id)
    _mark(view, "front", "합성 표준 절차서", "작성", "검토", "서명", "날짜")
    _mark(view, "front", "0.1 합성 결재", reason="1장 앞이라 삭제")
    _mark(view, "history", "9. 개정 이력")
    table_id = next(unit["id"] for unit in view["units"] if unit["kind"] == "table")
    update_row(Unit, table_id, noise_kind="front")

    rows = _values(_read(client.get(f"/api/bundles/{bundle_id}/documents/{doc_id}/paragraphs.xlsx", headers=AUTHOR))[0])
    preview = client.get(f"/api/bundles/{bundle_id}/documents/{doc_id}/paragraphs/preview", headers=AUTHOR).json()

    assert rows[1:] == [
        ["", "합성 표준 절차서", "", "", "Deleted — Before chapter 1"],
        ["", "0.1 합성 결재", "", "", "Deleted — 1장 앞이라 삭제"],
        ["", "작성 | 검토", "", "", "Deleted — Before chapter 1"],
        ["", "서명 | 날짜", "", "", "Deleted"],
        ["1.", "본문 문장이다.", "KO", "Read from text", ""],
        ["", "9. 개정 이력", "", "", "Deleted — Change history"],
    ]
    assert [[cell["text"] for cell in row["cells"]] for row in preview["rows"]] == rows
    assert [row["deleted"] for row in preview["rows"][1:]] == [True] * 4 + [False, True]
    assert [row["cells"][1]["strike"] for row in preview["rows"][1:]] == [True] * 4 + [False, True]
    assert preview["rows"][3]["unit_id"] == table_id


def test_contents_lines_are_left_out_unless_the_check_is_on(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    url = f"/api/bundles/{bundle_id}/documents/{doc_id}/paragraphs.xlsx"
    before = _values(_read(client.get(url, headers=MEMBER))[0])
    _mark(get_view(client, bundle_id, doc_id), "toc", "이 절차는 합성 장비의 사용법을 정한다.", reason="합성 사유")

    default = _values(_read(client.get(url, headers=MEMBER))[0])
    with_contents = _values(_read(client.get(f"{url}?toc=true", headers=MEMBER))[0])

    assert with_contents == before
    assert default == [row for row in before if row[1] != "이 절차는 합성 장비의 사용법을 정한다."]


# --- 받을 때 넣을 것 넷(F1-R2~R3) · 미리보기 접기(F1-R1) ---

def _mixed_lines() -> list[UnitLine]:
    """제목 · 목차 둘 · 본문 · 표 · 그림 · 확정 삭제 · 앞부분 한 줄이 든 합성 줄들."""
    return [
        _line(1, "heading", "범위", lang="ko", number="1."),
        _line(2, "sentence", "목차 줄 하나 ... 3", lang="ko", noise=True),
        _line(3, "sentence", "목차 줄 둘 ... 4", lang="ko", noise=True),
        _line(4, "sentence", "본문 문장.", lang="ko"),
        _line(5, "table", "", table_id=7),
        _line(6, "cell_sentence", "Rotor", table_id=7, row_index=0, col_index=0, group_unit_id=5),
        _line(7, "figure", ""),
        _line(8, "sentence", "확정 삭제 줄.", lang="ko", deleted=True),
        _line(9, "sentence", "앞부분 줄.", lang="ko", noise=True, auto_deleted=True, deleted=True),
    ]


def _body(sheet: Sheet) -> list[str]:
    return [row[1] for row in _texts(sheet)[1:]]


def test_default_download_is_today_minus_the_contents() -> None:
    lines = _mixed_lines()

    today = _texts(build_paragraph_sheet(lines, ParagraphInclude(toc=True)))
    default = _texts(build_paragraph_sheet(lines))

    assert default == [row for row in today if not row[1].startswith("목차 줄")]
    assert len(today) - len(default) == 2


def test_each_check_changes_the_file() -> None:
    lines = _mixed_lines()
    everything = ParagraphInclude(tables=True, deleted=True, figures=True, toc=True)

    full = _body(build_paragraph_sheet(lines, everything))

    assert "Rotor" in full and "확정 삭제 줄." in full and FIGURE_MARKER in full and "목차 줄 하나 ... 3" in full
    assert "Rotor" not in _body(build_paragraph_sheet(lines, ParagraphInclude(tables=False, toc=True)))
    no_deleted = _body(build_paragraph_sheet(lines, ParagraphInclude(deleted=False, toc=True)))
    assert "확정 삭제 줄." not in no_deleted and "앞부분 줄." not in no_deleted
    assert FIGURE_MARKER not in _body(build_paragraph_sheet(lines, ParagraphInclude(figures=False, toc=True)))
    assert "목차 줄 하나 ... 3" not in _body(build_paragraph_sheet(lines, ParagraphInclude(toc=False)))


def test_front_matter_follows_the_deleted_check() -> None:
    lines = _mixed_lines()

    assert "앞부분 줄." in _body(build_paragraph_sheet(lines))
    assert "앞부분 줄." not in _body(build_paragraph_sheet(lines, ParagraphInclude(deleted=False)))


def test_old_contents_follow_their_own_check_even_when_deleted_is_off() -> None:
    lines = _mixed_lines()

    body = _body(build_paragraph_sheet(lines, ParagraphInclude(deleted=False, toc=True)))

    assert "목차 줄 하나 ... 3" in body and "목차 줄 둘 ... 4" in body
    assert "확정 삭제 줄." not in body


def test_preview_hides_figures_and_marks_contents() -> None:
    lines = _mixed_lines()

    sheet = build_paragraph_sheet(lines, preview=True)

    assert FIGURE_MARKER not in _body(sheet)
    assert [(row.toc, row.noise) for row in sheet.rows[1:] if row.cells[1].text.startswith("목차 줄")] == [(True, "toc")] * 2
    assert all(not row.toc for row in sheet.rows if not row.cells[1].text.startswith("목차 줄"))
    # 지운 줄은 싣고(화면이 숨긴다), 받는 파일은 figures 체크를 따른다
    assert [row.deleted for row in sheet.rows[1:] if row.cells[1].text == "앞부분 줄."] == [True]
    assert FIGURE_MARKER in _body(build_paragraph_sheet(lines, preview=False))


def test_new_document_paragraphs_take_the_same_checks(client: TestClient) -> None:
    bundle_id = create_bundle(client, title="Paragraphs", is_synthetic=True)["id"]
    uploaded = upload(
        client, bundle_id, build_docx(p("합성 목차 줄이다.") + p("1. 본문 문장이다.") + f"<w:p>{make_drawing_run('image1.png')}</w:p>", media={"image1.png": TINY_PNG}),
        "SYNTHETIC_SOP-N_Checks.docx", side="new", doc_type="sop",
    )
    assert uploaded.status_code == 201, uploaded.text
    doc_id = uploaded.json()["id"]
    _mark(get_view(client, bundle_id, doc_id), "toc", "합성 목차 줄이다.")
    url = f"/api/bundles/{bundle_id}/documents/{doc_id}/paragraphs.xlsx"

    def read(query: str) -> list[str]:
        return [row[1] for row in _values(_read(client.get(f"{url}{query}", headers=AUTHOR))[0])[1:]]

    assert read("") == ["본문 문장이다.", FIGURE_MARKER]
    assert read("?toc=true") == ["합성 목차 줄이다.", "본문 문장이다.", FIGURE_MARKER]
    assert read("?figures=false") == ["본문 문장이다."]
