"""Excel 내보내기와 미리보기 — 시트·머리·요약, 함께 쓰는 칸의 되풀이·흐림, Graphite 테두리, 제어 문자·수식 글, 긴 글 이어짐,
흐름도 그림, 파일 이름, 미리보기와 파일의 같은 칸 글, 작업 기록, 실패 응답.

합성 옛 문서 하나(To-Be는 SOP 하나)로 묶음을 만들고, 내보낸 파일을 openpyxl로 다시 읽어 칸을 단언한다.
"""

import re
import zipfile
from datetime import UTC, datetime
from io import BytesIO
from math import floor
from typing import NamedTuple
from urllib.parse import quote, unquote

import httpx2
import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook
from openpyxl.cell.cell import Cell
from openpyxl.worksheet.worksheet import Worksheet
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import KST
from app.sop import sheet_model
from app.sop.excel_export import (
    CELL_TEXT_LIMIT,
    build_export_file_name,
    split_cell_text,
    write_text_cell,
)
from app.sop.flow_image import KIND_COLORS, MAX_COLUMN_NODES, _limit_nodes, draw_flow_png
from app.sop.models import Bundle, BundleEvent, SourceBlock, Unit
from app.sop.outputs import FlowGraph, FlowNode
from app.sop.sheet_model import A_HEADERS, SHEET_NAMES, format_rate
from tests.access_helpers import run_in_session, update_row
from tests.docx_factory import build_docx, p, tbl
from tests.sop_helpers import (
    AUTHOR,
    OUTSIDER,
    REVIEWER,
    assign_as_is,
    create_bundle,
    find_unit,
    get_group_by_unit,
    get_view,
    put_tobe,
    save_group,
    set_members,
    upload,
)
from tests.test_sop_outputs import DUPLICATE, DUPLICATE_REASON
from tests.test_sop_outputs import _setup as _setup_outputs_bundle

pytestmark = pytest.mark.usefixtures("clean_sop")

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
OLD_NAME = "SYNTHETIC_OLD-1_Excel.docx"
TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]
FAINT = "FF9AA0A6"

KEEP = "합성 장비를 켠다."
DROP = "합성 메모는 지운다."
OPEN = "합성 시료를 넣는다."
DROP_REASON = "Synthetic: obsolete note"
PAIR_KO = "합성 결과를 적는다."
PAIR_EN = "Record the synthetic result."
PAIR_REASON = "Synthetic: one meaning in two languages"
SHARED_HEADERS = ("Row", "Destination", "New doc", "New doc title", "Remark")


class Fixture(NamedTuple):
    bundle_id: int
    sop_id: int
    doc_id: int
    view: dict


def _setup(
    client: TestClient,
    paragraphs: list[str],
    *,
    title: str = "Excel Bundle",
    assign: bool = True,
    body_xml: str | None = None,
    na_slots: list[dict] | None = None,
) -> Fixture:
    """To-Be(SOP 하나) + 합성 옛 문서 하나 — assign이면 문단마다 SOP '책임' 칸으로 원문 그대로 확정한다.

    body_xml을 주면 문단 대신 그 본문(표 포함)을 올린다.
    """
    bundle_id = create_bundle(client, title=title, is_synthetic=True)["id"]
    assert set_members(client, bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200
    response = put_tobe(client, bundle_id, TOBE_DOCS, na_slots=na_slots or [])
    assert response.status_code == 200, response.text
    sop_id = response.json()["docs"][0]["id"]
    body = build_docx(body_xml if body_xml is not None else "".join(p(text) for text in paragraphs))
    uploaded = upload(client, bundle_id, body, OLD_NAME)
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text
    doc_id = uploaded.json()["id"]
    view = get_view(client, bundle_id, doc_id)
    if assign:
        for unit in view["units"]:
            assign_as_is(client, bundle_id, unit, sop_id, slot_key="responsibilities")
    return Fixture(bundle_id, sop_id, doc_id, view)


def _setup_pair(client: TestClient, ko: str, en: str, reason: str = PAIR_REASON) -> tuple[Fixture, list[dict]]:
    """한 문단·영 문단을 사람이 짝으로 잇고 둘 다 SOP '책임' 칸에 원문 그대로 reason과 함께 확정한 묶음 — A에서 두 줄 한 묶음이다."""
    fx = _setup(client, [ko, en], assign=False)
    units = [find_unit(fx.view, ko), find_unit(fx.view, en)]
    paired = client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/pairs",
        json={"revision": fx.view["document"]["revision"], "unit_ids": [unit["id"] for unit in units]}, headers=AUTHOR,
    )
    assert paired.status_code == 201, paired.text
    for unit in units:
        group = get_group_by_unit(client, fx.bundle_id, unit["id"])
        entry = next(member for member in group["units"] if member["unit_id"] == unit["id"])
        saved = save_group(client, fx.bundle_id, {
            "action": "confirm",
            "units": [{
                "unit_id": unit["id"], "revision": entry["decision"]["revision"], "disposition": "assigned",
                "reason": reason,
            }],
            "targets": [{
                "key": "t", "target_doc_id": fx.sop_id, "slot_key": "responsibilities", "source_unit_ids": [unit["id"]],
            }],
        })
        assert saved.status_code == 200, saved.text
    return fx, units


def _export(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR) -> httpx2.Response:
    response = client.get(f"/api/bundles/{bundle_id}/export.xlsx", headers=headers)
    assert response.status_code == 200, response.text
    return response


def _load(client: TestClient, bundle_id: int) -> Workbook:
    return load_workbook(BytesIO(_export(client, bundle_id).content))


def _get_preview(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/export/preview", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _load_events(bundle_id: int, action: str) -> list[tuple[str, str, list, str]]:
    async def _load(session: AsyncSession) -> list[tuple[str, str, list, str]]:
        rows = await session.execute(
            select(BundleEvent.actor, BundleEvent.target_type, BundleEvent.target_ids, BundleEvent.reason)
            .where(BundleEvent.bundle_id == bundle_id, BundleEvent.action == action)
            .order_by(BundleEvent.id)
        )
        return [tuple(row) for row in rows]

    return run_in_session(_load)


def _inject_text(unit_id: int, block_id: int, old: str, new: str) -> None:
    """DB의 단위·블록 글자에서 old를 new로 바꾼다 — 추출기는 XML에 못 쓰는 제어 문자를 만들지 못해 직접 심는다."""

    async def _update(session: AsyncSession) -> None:
        unit, block = await session.get(Unit, unit_id), await session.get(SourceBlock, block_id)
        assert unit is not None and block is not None
        unit.text, block.text = unit.text.replace(old, new), block.text.replace(old, new)
        await session.commit()

    run_in_session(_update)


def _load_unit_text(unit_id: int) -> str:
    async def _load(session: AsyncSession) -> str:
        unit = await session.get(Unit, unit_id)
        assert unit is not None
        return unit.text

    return run_in_session(_load)


def _find_column(sheet: Worksheet, header: str, header_row: int = 2) -> int:
    return next(cell.column for cell in sheet[header_row] if cell.value == header)


def _find_a_line(sheet: Worksheet, display_id: str) -> tuple[Cell, ...]:
    """A 시트에서 Unit ID 칸이 display_id인 줄 하나."""
    (line,) = [row for row in sheet.iter_rows(min_row=3) if row[A_HEADERS.index("Unit ID")].value == display_id]
    return line


def _is_faint(cell: Cell) -> bool:
    return cell.font.color is not None and cell.font.color.rgb == FAINT


def _read_text(value: object) -> str:
    """xlsx 칸 값을 미리보기 칸 글로 — 빈 칸은 "", 숫자 칸은 그 숫자 글."""
    if value is None:
        return ""
    return value if isinstance(value, str) else str(value)


def _bulk(client: TestClient, bundle_id: int, action: str, unit: dict, reason: str, **fields: str) -> None:
    body = {"action": action, "reason": reason, "units": [{"unit_id": unit["id"], "revision": 1}], **fields}
    response = client.post(f"/api/bundles/{bundle_id}/decisions/bulk", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text


# ── 시트·머리·요약 ───────────────────────────────────────────────────────────


def test_workbook_sheets_and_headers(client: TestClient) -> None:
    fx = _setup(client, [KEEP, DROP, OPEN, "Synthetic English line."], title="QC Bundle", assign=False)
    keep, drop = find_unit(fx.view, KEEP), find_unit(fx.view, DROP)
    assign_as_is(client, fx.bundle_id, keep, fx.sop_id, slot_key="responsibilities")
    _bulk(client, fx.bundle_id, "delete", drop, DROP_REASON)

    wb = _load(client, fx.bundle_id)
    assert wb.sheetnames == ["A Comparison", "B Flow", "C New documents", "Info"]
    sheet_a = wb["A Comparison"]
    assert sheet_a["A1"].value == "Status: In progress"
    assert [cell.value for cell in sheet_a[2]] == list(A_HEADERS)
    assert sheet_a.freeze_panes == "A3" and sheet_a.auto_filter.ref.startswith("A2:T")
    rows = {row[_find_column(sheet_a, "Unit ID") - 1].value: row for row in sheet_a.iter_rows(min_row=3)}
    by_header = {header: rows[keep["display_id"]][index].value for index, header in enumerate(A_HEADERS)}
    assert (by_header["Row"], by_header["Old doc"], by_header["Old text"]) == (1, "OLD-1", KEEP)
    assert (by_header["Destination"], by_header["New doc"], by_header["Place"]) == (
        "New SOP", "SOP-NEW", "Responsibilities",
    )
    assert (by_header["New text"], by_header["Change"], by_header["Status"]) == (KEEP, "As is", "Confirmed")
    dropped = {header: rows[drop["display_id"]][index].value for index, header in enumerate(A_HEADERS)}
    assert (dropped["Destination"], dropped["Change"], dropped["Remark"]) == ("Deleted", "Deleted", DROP_REASON)
    assert len(rows) == 4  # 결과물 A가 한 벌이라 영어 문장도 같은 시트에 있다

    summary = client.get(f"/api/bundles/{fx.bundle_id}/summary", headers=AUTHOR).json()
    sheet_b = wb["B Flow"]
    assert sheet_b["A1"].value == "Status: In progress"
    labels = {row[0].value: row[1].value for row in sheet_b.iter_rows(min_row=3, max_row=14) if row[0].value}
    names = (
        "Old rows", "Assigned", "No destination", "Duplicate assignments", "Deleted", "Moved", "New", "Translated",
        "Single language",
    )
    keys = (
        "old_rows", "assigned", "no_destination", "duplicate", "deleted", "moved", "new", "translated", "single_language",
    )
    assert [labels[name] for name in names] == [summary[key] for key in keys]
    assert labels["Confirmed rate"] == format_rate(summary["confirmed_rate"])
    header_row = next(row for row in sheet_b.iter_rows() if row[0].value == "Old document")
    assert [cell.value for cell in header_row[:2]] == ["Old document", "Rows"]
    body = sheet_b.iter_rows(min_row=header_row[0].row + 1)
    flow = next(row for row in body if str(row[0].value).startswith("OLD-1"))
    counts = {header.value: cell.value for header, cell in zip(header_row[2:], flow[2:], strict=False) if header.value}
    # 흐름은 한 벌의 줄로 센다 — 영어 문장도 미배정 줄 하나
    assert flow[1].value == 4
    assert counts == {"SOP-NEW Synthetic SOP": 1, "Deleted": 1, "Unassigned": 2}

    sheet_c = wb["C New documents"]
    assert sheet_c["A1"].value == "Status: In progress"
    assert sheet_c.freeze_panes == "A3"
    assert [cell.value for cell in sheet_c[3]][:2] == ["SOP SOP-NEW · Synthetic SOP", None]

    info = {row[0].value: row[1].value for row in wb["Info"].iter_rows()}
    assert info["Synthetic data"] == "Yes"
    assert (info["Bundle title"], info["Status"], info["Exported by"], info["Created by"], info["Guideline version"]) == (
        "QC Bundle", "In progress", "qa.member", "qa.member", "rules v1",
    )
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", info["Exported at (KST)"])


def test_a_warnings_column_lists_kind_source_and_target(client: TestClient) -> None:
    source, changed = "합성 시료를 3 mL 넣는다.", "합성 시료를 5 mL 넣는다."
    fx = _setup(client, [source], assign=False)
    unit = find_unit(fx.view, source)
    group = {"key": "t", "target_doc_id": fx.sop_id, "slot_key": "responsibilities", "source_unit_ids": [unit["id"]]}
    body = {
        "action": "confirm", "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"}],
        "targets": [{**group, "text": changed, "change_type": "rewritten"}],
    }
    saved = save_group(client, fx.bundle_id, body)
    assert saved.status_code == 200, saved.text

    api_rows = client.get(f"/api/bundles/{fx.bundle_id}/outputs/a", headers=AUTHOR).json()
    warnings = api_rows[0]["warnings"]
    assert warnings  # 숫자가 바뀌어 경고가 붙는다
    sheet = _load(client, fx.bundle_id)["A Comparison"]
    assert sheet.cell(3, _find_column(sheet, "Checks")).value == "; ".join(
        f"{w['kind']}: {w['source']} → {w['target']}" for w in warnings
    )


def test_sheet_c_indents_docs_slots_items_and_tails(client: TestClient) -> None:
    na_reason, moved_reason = "Synthetic: covered elsewhere", "Synthetic: owned by another SOP"
    body_xml = p(KEEP) + tbl([["항목", "값"], ["합성 값", "합성 결과"]]) + p(DROP)
    fx = _setup(
        client, [], body_xml=body_xml, assign=False,
        na_slots=[{"code": "SOP-NEW", "slot_key": "scope", "reason": na_reason}],
    )
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    assign_as_is(client, fx.bundle_id, table, fx.sop_id, slot_key="general_requirements")
    assign_as_is(client, fx.bundle_id, find_unit(fx.view, KEEP), fx.sop_id, slot_key="responsibilities")
    dropped = find_unit(fx.view, DROP)
    _bulk(client, fx.bundle_id, "move_external", dropped, moved_reason, move_target_code="SOP-OTHER-1")

    workbook = _load(client, fx.bundle_id)
    sheet = workbook["C New documents"]
    rows = [[cell.value for cell in row] for row in sheet.iter_rows(min_row=3)]
    doc, doc_col, slot_col, number_col, item_col, cell_col = "SOP SOP-NEW · Synthetic SOP", 0, 1, 2, 3, 4
    assert rows[0][doc_col] == doc
    scope = next(row for row in rows if row[slot_col] == "Scope")
    assert (scope[number_col], scope[9], scope[12]) == ("2", "N/A", na_reason)

    responsibilities = rows.index(next(row for row in rows if row[slot_col] == "Responsibilities"))
    assert rows[responsibilities][number_col] == "4"
    keep_row = rows[responsibilities + 1]
    assert (keep_row[number_col], keep_row[item_col], keep_row[10]) == ("4.1", KEEP, "← OLD-1")

    table_row = rows.index(next(row for row in rows if row[item_col] == "[Table]"))
    assert rows[table_row][number_col] == "5.1"
    cells = rows[table_row + 1 : table_row + 5]
    assert [(row[cell_col], row[5]) for row in cells] == [
        ("항목", "R 1 C 1"), ("값", "R 1 C 2"), ("합성 값", "R 2 C 1"), ("합성 결과", "R 2 C 2"),
    ]
    assert all(row[item_col] is None for row in cells)  # 칸 문장은 항목보다 한 단계 더 들여쓴 열에 있다
    assert all(row[number_col] is None for row in cells)  # 표 칸은 표의 번호라 표 줄에만 적는다

    tail = rows.index(next(row for row in rows if row[doc_col] == "Moved to another document"))
    assert rows[tail + 1][item_col] == DROP
    moved_row = rows[tail + 1]
    assert (moved_row[6], moved_row[11], moved_row[12]) == (dropped["display_id"], "SOP-OTHER-1", moved_reason)

    # 결과물 A의 No. 열은 결과물 A 응답의 dest_number를 옮겨 쓴 값이다
    sheet_a = workbook["A Comparison"]
    number_a_col = _find_column(sheet_a, "No.")
    keep_a = _find_a_line(sheet_a, find_unit(fx.view, KEEP)["display_id"])
    assert keep_a[number_a_col - 1].value == "4.1"


# ── 함께 쓰는 칸·테두리·확정률 ───────────────────────────────────────────────


def test_shared_cells_repeat_and_fade_from_the_second_line(client: TestClient) -> None:
    fx, (ko, en) = _setup_pair(client, PAIR_KO, PAIR_EN)
    sheet = _load(client, fx.bundle_id)["A Comparison"]
    first, second = _find_a_line(sheet, ko["display_id"]), _find_a_line(sheet, en["display_id"])

    for header in SHARED_HEADERS:
        column = A_HEADERS.index(header)
        assert first[column].value == second[column].value and first[column].value not in (None, ""), header
        assert (_is_faint(first[column]), _is_faint(second[column])) == (False, True), header
    assert second[A_HEADERS.index("Remark")].value == PAIR_REASON
    for header in ("Status", "Change", "Unit ID", "Location", "Old doc"):
        assert not _is_faint(second[A_HEADERS.index(header)]), header  # 줄마다 자기 값이라 흐리지 않는다

    # 중복 배정 묶음 — 둘째 줄은 보낸 새 문서가 달라 그 칸은 흐리지 않고, 같은 Row·Remark만 흐리다
    outputs = _setup_outputs_bundle(client)
    duplicate_id = find_unit(outputs.old1, DUPLICATE)["display_id"]
    sheet = _load(client, outputs.bundle_id)["A Comparison"]
    lines = [row for row in sheet.iter_rows(min_row=3) if row[A_HEADERS.index("Unit ID")].value == duplicate_id]
    column = {header: A_HEADERS.index(header) for header in (*SHARED_HEADERS, "Status", "Change")}
    assert [line[column["New doc"]].value for line in lines] == ["SOP-NEW", "WI-01"]
    second = lines[1]
    assert second[column["Remark"]].value == DUPLICATE_REASON
    assert {header: _is_faint(second[index]) for header, index in column.items()} == {
        "Row": True, "Destination": False, "New doc": False, "New doc title": False, "Remark": True,
        "Status": False, "Change": False,
    }


def test_graphite_borders(client: TestClient) -> None:
    fx, (ko, en) = _setup_pair(client, PAIR_KO, PAIR_EN)
    sheet = _load(client, fx.bundle_id)["A Comparison"]

    for cell in sheet[2]:
        assert (cell.fill.fill_type, cell.fill.fgColor.rgb) == ("solid", "FF2B2F36")
        assert (cell.font.b, cell.font.color.rgb) == (True, "FFFFFFFF")
        assert (cell.border.bottom.style, cell.border.bottom.color.rgb) == ("thick", "FF202124")
    first, second = _find_a_line(sheet, ko["display_id"]), _find_a_line(sheet, en["display_id"])
    assert {(cell.border.top.style, cell.border.top.color.rgb) for cell in first} == {("medium", "FF5F6368")}
    assert {(cell.border.top.style, cell.border.top.color.rgb) for cell in second} == {("thin", "FF9AA0A6")}
    assert {cell.fill.fill_type for cell in (*first, *second)} == {None}  # 묶음 줄에는 바탕색이 없다


def test_confirmed_rate_is_percent_text(client: TestClient) -> None:
    fx = _setup(client, [KEEP, DROP, OPEN], assign=False)
    assign_as_is(client, fx.bundle_id, find_unit(fx.view, KEEP), fx.sop_id, slot_key="responsibilities")
    rate = client.get(f"/api/bundles/{fx.bundle_id}/summary", headers=AUTHOR).json()["confirmed_rate"]

    sheet_b = _load(client, fx.bundle_id)["B Flow"]
    (row,) = [row for row in sheet_b.iter_rows() if row[0].value == "Confirmed rate"]

    assert (row[1].value, row[1].data_type) == (f"{floor(rate * 100 + 0.5)}%", "s")
    assert row[1].value == "33%"
    assert [format_rate(value) for value in (0.0, 0.28, 2 / 7, 1.0)] == ["0%", "28%", "29%", "100%"]


# ── 미리보기 ─────────────────────────────────────────────────────────────────


def test_preview_matches_the_file(client: TestClient) -> None:
    fx = _setup_outputs_bundle(client)  # 나눔·합침·중복 배정·표·그림·입구 2·번역 줄이 모두 있는 묶음
    preview = _get_preview(client, fx.bundle_id)
    wb = _load(client, fx.bundle_id)

    assert [sheet["name"] for sheet in preview["sheets"]] == list(SHEET_NAMES) == wb.sheetnames
    for sheet in preview["sheets"]:
        ws = wb[sheet["name"]]
        texts = [[cell["text"] for cell in row["cells"]] for row in sheet["rows"]]
        file_texts = [[_read_text(cell.value) for cell in row] for row in ws.iter_rows(max_col=len(sheet["widths"]))]
        assert texts == file_texts[: len(sheet["rows"])], sheet["name"]
        assert not sheet["truncated"] and sheet["total_rows"] == len(sheet["rows"])
        # 흐림·기울임·머리 모양·접기도 모델 값 그대로 쓴다 — 쓰는 쪽이 따로 판정하지 않는다
        for row_no, row in enumerate(sheet["rows"], start=1):
            for col_no, cell in enumerate(row["cells"], start=1):
                written = ws.cell(row_no, col_no)
                assert (written.fill.fill_type == "solid") == cell["head"], (sheet["name"], row_no, col_no)
                if cell["text"]:
                    assert (_is_faint(written), bool(written.font.i)) == (cell["faint"], cell["italic"])
                    assert bool(written.alignment.wrap_text) == row["wrap"], (sheet["name"], row_no, col_no)
    (b,) = [sheet for sheet in preview["sheets"] if sheet["name"] == "B Flow"]
    assert b["image_png"] and b["image_row"] == len(b["rows"]) + 2
    # B의 두 칸짜리 Item·Value 머리는 뒤 채움 칸에 머리 모양이 없고, 상태·plain 줄은 접지 않는다
    (item_value,) = [row for row in b["rows"] if row["cells"][0]["text"] == "Item"]
    assert len(b["widths"]) > 2
    assert [cell["head"] for cell in item_value["cells"]] == [True, True] + [False] * (len(b["widths"]) - 2)
    assert wb["B Flow"].cell(b["rows"].index(item_value) + 1, 3).fill.fill_type is None
    assert {row["kind"]: row["wrap"] for row in b["rows"]} == {"status": False, "header": True, "plain": False}
    assert not wb["B Flow"]["A1"].alignment.wrap_text
    assert {sheet["name"]: sheet["filter_columns"] for sheet in preview["sheets"]} == {
        "A Comparison": 20, "B Flow": 0, "C New documents": 0, "Info": 0,
    }


def test_continued_rows_stay_in_their_group(client: TestClient) -> None:
    long_ko = "가" * 40_000
    fx, (ko, en) = _setup_pair(client, long_ko, PAIR_EN)
    preview = _get_preview(client, fx.bundle_id)
    (a,) = [sheet for sheet in preview["sheets"] if sheet["name"] == "A Comparison"]
    unit_id_col, row_col = A_HEADERS.index("Unit ID"), A_HEADERS.index("Row")

    start = next(index for index, row in enumerate(a["rows"]) if row["cells"][unit_id_col]["text"] == ko["display_id"])
    group = a["rows"][start : start + 3]
    assert [row["kind"] for row in group] == ["group_start", "in_group", "in_group"]
    assert [row["cells"][unit_id_col]["text"] for row in group] == [ko["display_id"], "(continued)", en["display_id"]]
    # 이어짐 줄도 함께 쓰는 칸을 되풀이해 흐림 판정이 끊기지 않는다
    assert [row["cells"][row_col]["faint"] for row in group] == [False, True, True]
    old_text_col = A_HEADERS.index("Old text")
    assert "".join(row["cells"][old_text_col]["text"] for row in group[:2]) == long_ko

    sheet = _load(client, fx.bundle_id)["A Comparison"]
    assert sheet.max_row == len(a["rows"])
    continued = sheet[start + 2]  # 미리보기 줄 index는 0부터, 시트 줄은 1부터
    assert continued[unit_id_col].value == "(continued)"
    assert {cell.border.top.style for cell in continued} == {"thin"}


def test_preview_caps_rows_per_sheet(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    fx = _setup(client, [KEEP, DROP, OPEN])
    monkeypatch.setattr(sheet_model, "MAX_PREVIEW_ROWS", 3)

    a = _get_preview(client, fx.bundle_id)["sheets"][0]

    assert (len(a["rows"]), a["truncated"], a["total_rows"] > 3) == (3, True, True)
    assert _load(client, fx.bundle_id)["A Comparison"].max_row == a["total_rows"]  # 파일에는 전체


def test_preview_of_an_empty_bundle(client: TestClient) -> None:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]

    preview = _get_preview(client, bundle_id)

    sheets = {sheet["name"]: sheet for sheet in preview["sheets"]}
    assert list(sheets) == list(SHEET_NAMES)
    assert [row["kind"] for row in sheets["A Comparison"]["rows"]] == ["status", "header"]
    assert [row["kind"] for row in sheets["C New documents"]["rows"]] == ["status", "header"]
    summary = {row["cells"][0]["text"]: row["cells"][1]["text"] for row in sheets["B Flow"]["rows"]}
    assert (summary["Old rows"], summary["Confirmed rate"]) == ("0", "0%")
    assert preview["file_name"].startswith(f"BND-{bundle_id:04d}_")
    assert _load(client, bundle_id).sheetnames == list(SHEET_NAMES)


# ── 제어 문자·수식 글 ────────────────────────────────────────────────────────


def test_export_survives_control_chars_and_formula_text(client: TestClient) -> None:
    fx = _setup(client, ["=SUM(A1)#끝"], assign=False)
    (unit,) = fx.view["units"]
    _inject_text(unit["id"], unit["block_id"], "#", "\x0b")  # 원문 그대로 확정할 글에 제어 문자를 심는다
    assert _load_unit_text(unit["id"]) == "=SUM(A1)\x0b끝"
    fresh = next(u for u in get_view(client, fx.bundle_id, fx.doc_id)["units"] if u["id"] == unit["id"])
    assign_as_is(client, fx.bundle_id, fresh, fx.sop_id, slot_key="responsibilities")

    response = _export(client, fx.bundle_id)
    workbook = load_workbook(BytesIO(response.content))

    expected = "=SUM(A1)\N{REPLACEMENT CHARACTER}끝"
    sheet_a = workbook["A Comparison"]
    hits = [cell for row in sheet_a.iter_rows(min_row=3) for cell in row if cell.value == expected]
    assert len(hits) == 2  # Old text 칸과 New text 칸
    assert {cell.data_type for cell in hits} == {"s"}
    assert all(cell.quotePrefix for cell in hits)
    assert not [cell for sheet in workbook for row in sheet.iter_rows() for cell in row if cell.data_type == "f"]
    with zipfile.ZipFile(BytesIO(response.content)) as archive:
        assert not any(b"<f>" in archive.read(name) for name in archive.namelist() if name.startswith("xl/worksheets/"))
    assert _load_unit_text(unit["id"]) == "=SUM(A1)\x0b끝"  # DB 원문은 그대로

    # 미리보기도 파일과 같은 글 — 제어 문자는 모델에서 이미 대체 문자다
    preview_a = _get_preview(client, fx.bundle_id)["sheets"][0]
    preview_hits = [
        (row_no, col_no) for row_no, row in enumerate(preview_a["rows"], start=1)
        for col_no, cell in enumerate(row["cells"], start=1) if cell["text"] == expected
    ]
    assert preview_hits == [(cell.row, cell.column) for cell in hits]
    assert not any("\x0b" in cell["text"] for row in preview_a["rows"] for cell in row["cells"])


def test_write_text_cell_never_makes_formulas() -> None:
    sheet = Workbook().active
    for row, text in enumerate(["=1+1", "+1", "-1", "@SUM(A1)", "a\x00b\x07c￾d"], start=1):
        write_text_cell(sheet.cell(row, 1), text)
    reloaded = load_workbook(_save(sheet.parent)).active
    assert [(c.data_type, c.value) for c in reloaded["A"]] == [
        ("s", "=1+1"), ("s", "+1"), ("s", "-1"), ("s", "@SUM(A1)"), ("s", "a�b�c�d"),
    ]


def _save(workbook: Workbook) -> BytesIO:
    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


# ── 긴 글 ────────────────────────────────────────────────────────────────────


def test_long_text_continues_on_next_row(client: TestClient) -> None:
    long_text = "가" * 70_000
    fx = _setup(client, [long_text, KEEP])
    long_unit = find_unit(fx.view, long_text)

    sheet = _load(client, fx.bundle_id)["A Comparison"]
    source_col, confirmed_col = _find_column(sheet, "Old text"), _find_column(sheet, "New text")
    id_col, status_col = _find_column(sheet, "Unit ID"), _find_column(sheet, "Status")
    first = next(row[0].row for row in sheet.iter_rows(min_row=3) if row[id_col - 1].value == long_unit["display_id"])
    block = [[cell.value for cell in sheet[first + offset]] for offset in range(4)]

    assert [row[id_col - 1] for row in block[:3]] == [long_unit["display_id"], "(continued)", "(continued)"]
    assert block[3][id_col - 1] not in (long_unit["display_id"], "(continued)")  # 다음 단위 줄
    for col in (source_col, confirmed_col):
        chunks = [row[col - 1] for row in block[:3]]
        assert [len(chunk) for chunk in chunks] == [CELL_TEXT_LIMIT, CELL_TEXT_LIMIT, 70_000 - 2 * CELL_TEXT_LIMIT]
        assert "".join(chunks) == long_text
    assert block[0][status_col - 1] == "Confirmed" and block[1][status_col - 1] is None  # 이어짐 줄은 글만 잇는다


def test_split_cell_text_limits() -> None:
    assert split_cell_text("") == [""]
    assert split_cell_text("abc") == ["abc"]
    assert split_cell_text("abcdef", limit=4) == ["abcd", "ef"]
    # 한 글자가 UTF-16 두 칸을 차지하는 글자는 쌍을 가르지 않고 칸 한계를 넘지 않는다
    chunks = split_cell_text("\U0001f600" * 5, limit=5)
    assert chunks == ["\U0001f600" * 2, "\U0001f600" * 2, "\U0001f600"]
    assert "".join(split_cell_text("가" * 70_000)) == "가" * 70_000


# ── 흐름도 그림 ──────────────────────────────────────────────────────────────


def test_flow_image_embedded(client: TestClient) -> None:
    fx = _setup(client, [KEEP, DROP], assign=False)
    assign_as_is(client, fx.bundle_id, find_unit(fx.view, KEEP), fx.sop_id, slot_key="responsibilities")
    response = _export(client, fx.bundle_id)

    sheet = load_workbook(BytesIO(response.content))["B Flow"]
    assert len(sheet._images) == 1
    with zipfile.ZipFile(BytesIO(response.content)) as archive:
        media = [name for name in archive.namelist() if name.startswith("xl/media/")]
        assert len(media) == 1
        assert archive.read(media[0]).startswith(PNG_SIGNATURE)


def _build_graph(old_label: str, count: int = 3) -> FlowGraph:
    return FlowGraph(
        nodes=[
            FlowNode(id="old:1", kind="old", label=old_label, title="제목", count=count),
            FlowNode(id="target:1", kind="sop", label="SOP-NEW", title="Synthetic SOP", count=count),
            FlowNode(id="unassigned", kind="unassigned", label="미배정", title="", count=1),
        ],
        edges=[
            {"source": "old:1", "target": "target:1", "count": count},
            {"source": "old:1", "target": "unassigned", "count": 1},
        ],
    )


def test_flow_image_uses_the_bundled_hangul_font() -> None:
    first, second = draw_flow_png(_build_graph("가나다"), "ko"), draw_flow_png(_build_graph("라마바"), "ko")
    assert first.startswith(PNG_SIGNATURE) and second.startswith(PNG_SIGNATURE)
    assert first != second  # 글꼴에 글리프가 없으면 두 한글이 같은 빈 상자로 그려져 같아진다


def test_flow_image_caps_the_drawn_nodes() -> None:
    nodes = [FlowNode(id=f"old:{n}", kind="old", label=f"OLD-{n}", title="", count=n + 1) for n in range(100)]
    nodes += [FlowNode(id=f"target:{n}", kind="wi", label=f"WI-{n}", title="", count=n + 1) for n in range(100)]
    edges = [{"source": f"old:{n}", "target": f"target:{n}", "count": n + 1} for n in range(100)]
    with Image.open(BytesIO(draw_flow_png(FlowGraph(nodes=nodes, edges=edges), "en"))) as image:
        width, height = image.size
    assert width == 1100 and height < 2400  # 열마다 30개까지만 그려 문서가 많아도 그림(메모리)이 커지지 않는다


def _count_color_pixels(png: bytes, color: tuple[int, int, int]) -> int:
    with Image.open(BytesIO(png)) as image:
        rgb = image.convert("RGB")
        colors = rgb.getcolors(maxcolors=rgb.width * rgb.height) or []
    return sum(count for count, pixel in colors if pixel == color)


def test_flow_image_always_draws_unassigned_delete_and_move_nodes() -> None:
    # 보낸 곳 문서가 상한보다 많아도 건수가 작은 미배정·삭제·이동 노드는 빠지지 않는다(스펙 §7.13 B)
    tail = [
        FlowNode(id="delete", kind="delete", label="삭제", title="", count=1),
        FlowNode(id="move_external", kind="move_external", label="이동", title="", count=1),
        FlowNode(id="unassigned", kind="unassigned", label="미배정", title="", count=1),
    ]
    docs = [FlowNode(id=f"target:{n}", kind="wi", label=f"WI-{n}", title="", count=10 + n) for n in range(40)]
    old = [FlowNode(id="old:1", kind="old", label="OLD-1", title="", count=50)]
    edges = [{"source": "old:1", "target": node.id, "count": node.count} for node in [*docs, *tail]]

    kept, omitted = _limit_nodes([*docs, *tail])
    assert {node.id for node in tail} <= {node.id for node in kept}
    assert (len(kept), omitted) == (MAX_COLUMN_NODES + 3, 40 - MAX_COLUMN_NODES)  # 상한은 문서 노드에만 걸린다

    png = draw_flow_png(FlowGraph(nodes=[*old, *docs, *tail], edges=edges), "ko")
    without = draw_flow_png(FlowGraph(nodes=[*old, *docs], edges=edges[:-3]), "ko")
    assert _count_color_pixels(png, KIND_COLORS["unassigned"]) > 0  # 빨간 굵은 테두리
    assert _count_color_pixels(without, KIND_COLORS["unassigned"]) == 0


def test_flow_image_handles_empty_graph() -> None:
    assert draw_flow_png(FlowGraph(nodes=[], edges=[]), "en").startswith(PNG_SIGNATURE)


# ── 파일 이름 ────────────────────────────────────────────────────────────────


def test_export_file_name(client: TestClient) -> None:
    at = datetime(2026, 11, 13, 9, 5, tzinfo=KST)
    name = build_export_file_name(4, 'a/b:c*?"<>| 제목', at)
    assert name == "BND-0004_a_b_c______ 제목_20261113-0905.xlsx"
    assert build_export_file_name(4, "", at) == "BND-0004_20261113-0905.xlsx"
    assert build_export_file_name(4, "   ", at) == "BND-0004_20261113-0905.xlsx"
    assert build_export_file_name(4, "a\x07b", at) == "BND-0004_a_b_20261113-0905.xlsx"  # 제어 문자도 _
    assert build_export_file_name(12345, "가" * 400, at) == f"BND-12345_{'가' * 150}_20261113-0905.xlsx"
    assert build_export_file_name(4, "한", at) == "BND-0004_한_20261113-0905.xlsx"  # NFD → NFC
    assert build_export_file_name(4, "", datetime(2026, 11, 13, 0, 5, tzinfo=UTC)) == "BND-0004_20261113-0905.xlsx"

    fx = _setup(client, [KEEP], title="QC/원심분리기:1")
    response = _export(client, fx.bundle_id)
    assert response.headers["content-type"] == XLSX_TYPE
    disposition = response.headers["content-disposition"]
    assert "filename*=UTF-8''" in disposition
    code = f"BND-{fx.bundle_id:04d}"
    assert re.fullmatch(rf"{code}_QC_원심분리기_1_\d{{8}}-\d{{4}}\.xlsx", unquote(disposition.split("filename*=UTF-8''")[1]))
    assert disposition.split("filename*=UTF-8''")[1].startswith(quote(f"{code}_QC_원심분리기_1_", safe=""))
    assert re.search(r'filename="[\x20-\x7e]+"', disposition)  # ASCII 대체 이름


def test_file_name_is_the_same_in_preview_and_download(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    title = "=cmd|" + "한글"  # =로 시작하고 못 쓰는 글자, NFD 한글 "한글"
    fx = _setup(client, [KEEP], title=title)
    # 두 요청이 분(minute) 경계를 넘으면 이름이 달라지므로 시계를 멈춘다
    monkeypatch.setattr("app.routers.sop_outputs.now", lambda: datetime(2026, 11, 13, 9, 5, tzinfo=KST))

    preview = _get_preview(client, fx.bundle_id)
    disposition = _export(client, fx.bundle_id).headers["content-disposition"]

    assert unquote(disposition.split("filename*=UTF-8''")[1]) == preview["file_name"]
    assert preview["file_name"] == f"BND-{fx.bundle_id:04d}_=cmd_한글_20261113-0905.xlsx"


# ── 작업 기록·상태·실패 ──────────────────────────────────────────────────────


def test_export_records_event_and_works_in_review(client: TestClient) -> None:
    fx = _setup(client, [KEEP])
    update_row(Bundle, fx.bundle_id, status="in_review")

    as_author = _load(client, fx.bundle_id)
    assert as_author["A Comparison"]["A1"].value == "Status: Awaiting review"
    _export(client, fx.bundle_id, headers=REVIEWER)
    assert _get_preview(client, fx.bundle_id, headers=REVIEWER)["sheets"][0]["rows"][0]["cells"][0]["text"] == (
        "Status: Awaiting review"
    )

    # 미리보기는 기록을 남기지 않는다
    assert _load_events(fx.bundle_id, "export") == [
        ("qa.member", "bundle", [fx.bundle_id], ""),
        ("qa.lead", "bundle", [fx.bundle_id], ""),
    ]
    update_row(Bundle, fx.bundle_id, status="done")
    assert {row[0].value: row[1].value for row in _load(client, fx.bundle_id)["Info"].iter_rows()}["Status"] == (
        "Review complete"
    )

    for path in ("export.xlsx", "export/preview"):
        outsider = client.get(f"/api/bundles/{fx.bundle_id}/{path}", headers=OUTSIDER)
        assert (outsider.status_code, outsider.json()["detail"]["code"]) == (404, "bundle_not_found"), path


def test_export_failure_is_reported_apart_from_save_failure(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fx = _setup(client, [KEEP])

    def _fail(*_args: object, **_kwargs: object) -> bytes:
        raise RuntimeError("secret sentence")

    monkeypatch.setattr("app.routers.sop_outputs.build_workbook", _fail)
    response = client.get(f"/api/bundles/{fx.bundle_id}/export.xlsx", headers=AUTHOR)

    assert response.status_code == 500
    assert response.json() == {"detail": {"code": "export_failed"}}  # 원문·예외 메시지가 응답에 새지 않는다
    assert _load_events(fx.bundle_id, "export") == []
