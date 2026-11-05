"""Excel 내보내기 — 시트·머리·요약, 제어 문자·수식 글, 긴 글 이어짐, 흐름도 그림, 파일 이름, 작업 기록, 실패 응답.

합성 옛 문서 하나(To-Be는 SOP 하나)로 묶음을 만들고, 내보낸 파일을 openpyxl로 다시 읽어 칸을 단언한다.
"""

import re
import zipfile
from datetime import datetime
from io import BytesIO
from typing import NamedTuple
from urllib.parse import quote, unquote

import httpx2
import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook
from openpyxl.worksheet.worksheet import Worksheet
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import KST
from app.sop.excel_export import (
    CELL_TEXT_LIMIT,
    build_export_file_name,
    split_cell_text,
    write_text_cell,
)
from app.sop.flow_image import draw_flow_png
from app.sop.models import Bundle, BundleEvent, SourceBlock, Unit
from app.sop.outputs import FlowGraph, FlowNode
from tests.access_helpers import run_in_session, update_row
from tests.docx_factory import build_docx, p, tbl
from tests.sop_helpers import (
    AUTHOR,
    OUTSIDER,
    REVIEWER,
    assign_as_is,
    create_bundle,
    find_unit,
    get_view,
    put_tobe,
    save_group,
    set_members,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop")

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
OLD_NAME = "SYNTHETIC_OLD-1_Excel.docx"
TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]

KEEP = "합성 장비를 켠다."
DROP = "합성 메모는 지운다."
OPEN = "합성 시료를 넣는다."
DROP_REASON = "Synthetic: obsolete note"

KO_A_HEADERS = [
    "언어", "옛 문서 번호", "버전", "원문 위치", "단위 ID", "원문 문장", "보낸 곳 종류", "새 문서 번호", "새 문서 제목",
    "새 문서 안 위치", "확정 문장", "AI 제안 문장", "변경 종류", "관계 묶음 ID", "이유", "상태", "확정한 사람",
    "확정 시각", "경고",
]
EN_A_HEADERS = [
    "Language", "Old doc no.", "Version", "Source location", "Unit ID", "Source sentence", "Destination type",
    "New doc no.", "New doc title", "Location in new doc", "Confirmed sentence", "AI-suggested sentence",
    "Change type", "Relation group ID", "Reason", "Status", "Confirmed by", "Confirmed at", "Warnings",
]


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


def _export(client: TestClient, bundle_id: int, lang: str, headers: dict[str, str] = AUTHOR) -> httpx2.Response:
    response = client.get(f"/api/bundles/{bundle_id}/export.xlsx", params={"lang": lang}, headers=headers)
    assert response.status_code == 200, response.text
    return response


def _load(client: TestClient, bundle_id: int, lang: str) -> Workbook:
    return load_workbook(BytesIO(_export(client, bundle_id, lang).content))


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

    ko = _load(client, fx.bundle_id, "ko")
    assert ko.sheetnames == ["A 비교표", "B 흐름", "C 새 문서", "정보"]
    sheet_a = ko["A 비교표"]
    assert sheet_a["A1"].value == "상태: 작업 중"
    assert [cell.value for cell in sheet_a[2]] == KO_A_HEADERS
    rows = {row[_find_column(sheet_a, "단위 ID") - 1].value: row for row in sheet_a.iter_rows(min_row=3)}
    by_header = {header: rows[keep["display_id"]][index].value for index, header in enumerate(KO_A_HEADERS)}
    assert (by_header["언어"], by_header["옛 문서 번호"], by_header["원문 문장"]) == ("KO", "OLD-1", KEEP)
    assert (by_header["보낸 곳 종류"], by_header["새 문서 번호"], by_header["새 문서 안 위치"]) == (
        "새 SOP", "SOP-NEW", "Responsibilities",
    )
    assert (by_header["확정 문장"], by_header["변경 종류"], by_header["상태"]) == (KEEP, "그대로", "확정")
    dropped = {header: rows[drop["display_id"]][index].value for index, header in enumerate(KO_A_HEADERS)}
    assert (dropped["보낸 곳 종류"], dropped["변경 종류"], dropped["이유"]) == ("삭제", "삭제", DROP_REASON)
    assert len(rows) == 3  # 영어 문장은 한글 파일에 없다

    summary = client.get(f"/api/bundles/{fx.bundle_id}/summary", headers=AUTHOR).json()["ko"]
    sheet_b = ko["B 흐름"]
    assert sheet_b["A1"].value == "상태: 작업 중"
    labels = {row[0].value: row[1].value for row in sheet_b.iter_rows(min_row=3, max_row=13) if row[0].value}
    assert [labels[name] for name in ("옛 단위", "배정", "미배정", "중복 배정", "삭제", "이동", "신규", "번역")] == [
        summary[key]
        for key in ("old_units", "assigned", "unassigned", "duplicate", "deleted", "moved", "new", "translated")
    ]
    assert labels["확정률"] == pytest.approx(summary["confirmed_rate"])
    header_row = next(row for row in sheet_b.iter_rows() if row[0].value == "옛 문서")
    assert [cell.value for cell in header_row[:2]] == ["옛 문서", "단위 수"]
    body = sheet_b.iter_rows(min_row=header_row[0].row + 1)
    flow = next(row for row in body if str(row[0].value).startswith("OLD-1"))
    counts = {header.value: cell.value for header, cell in zip(header_row[2:], flow[2:], strict=False) if header.value}
    assert flow[1].value == 3
    assert counts == {"SOP-NEW Synthetic SOP": 1, "삭제": 1, "미배정": 1}

    sheet_c = ko["C 새 문서"]
    assert sheet_c["A1"].value == "상태: 작업 중"
    assert [cell.value for cell in sheet_c[3]][:2] == ["SOP SOP-NEW · Synthetic SOP", None]

    info = {row[0].value: row[1].value for row in ko["정보"].iter_rows()}
    assert info["합성 데이터 여부"] == "예"
    assert (info["묶음 제목"], info["상태"], info["내보낸 사람"], info["만든 사람"], info["지침 버전"]) == (
        "QC Bundle", "작업 중", "qa.member", "qa.member", "-",
    )
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", info["내보낸 시각 (KST)"])

    en = _load(client, fx.bundle_id, "en")
    assert en.sheetnames == ["A Comparison", "B Flow", "C New documents", "Info"]
    assert en["A Comparison"]["A1"].value == "Status: In progress"
    assert [cell.value for cell in en["A Comparison"][2]] == EN_A_HEADERS
    assert {row[0].value: row[1].value for row in en["Info"].iter_rows()}["Synthetic data"] == "Yes"


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

    api_rows = client.get(f"/api/bundles/{fx.bundle_id}/outputs/a", params={"lang": "ko"}, headers=AUTHOR).json()
    warnings = api_rows[0]["warnings"]
    assert warnings  # 숫자가 바뀌어 경고가 붙는다
    sheet = _load(client, fx.bundle_id, "ko")["A 비교표"]
    assert sheet.cell(3, _find_column(sheet, "경고")).value == "; ".join(
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

    sheet = _load(client, fx.bundle_id, "ko")["C 새 문서"]
    rows = [[cell.value for cell in row] for row in sheet.iter_rows(min_row=3)]
    doc, doc_col, slot_col, item_col, cell_col = "SOP SOP-NEW · Synthetic SOP", 0, 1, 2, 3
    assert rows[0][doc_col] == doc
    scope = next(row for row in rows if row[slot_col] == "Scope")
    assert (scope[8], scope[11]) == ("N/A", na_reason)

    responsibilities = rows.index(next(row for row in rows if row[slot_col] == "Responsibilities"))
    assert rows[responsibilities + 1][item_col] == KEEP and rows[responsibilities + 1][9] == "← OLD-1"

    table_row = rows.index(next(row for row in rows if row[item_col] == "[표]"))
    cells = rows[table_row + 1 : table_row + 5]
    assert [(row[cell_col], row[4]) for row in cells] == [
        ("항목", "1행 1열"), ("값", "1행 2열"), ("합성 값", "2행 1열"), ("합성 결과", "2행 2열"),
    ]
    assert all(row[item_col] is None for row in cells)  # 칸 문장은 항목보다 한 단계 더 들여쓴 열에 있다

    tail = rows.index(next(row for row in rows if row[doc_col] == "다른 문서로 이동"))
    assert rows[tail + 1][item_col] == DROP
    moved_row = rows[tail + 1]
    assert (moved_row[5], moved_row[10], moved_row[11]) == (dropped["display_id"], "SOP-OTHER-1", moved_reason)


# ── 제어 문자·수식 글 ────────────────────────────────────────────────────────


def test_export_survives_control_chars_and_formula_text(client: TestClient) -> None:
    fx = _setup(client, ["=SUM(A1)#끝"], assign=False)
    (unit,) = fx.view["units"]
    _inject_text(unit["id"], unit["block_id"], "#", "\x0b")  # 원문 그대로 확정할 글에 제어 문자를 심는다
    assert _load_unit_text(unit["id"]) == "=SUM(A1)\x0b끝"
    fresh = next(u for u in get_view(client, fx.bundle_id, fx.doc_id)["units"] if u["id"] == unit["id"])
    assign_as_is(client, fx.bundle_id, fresh, fx.sop_id, slot_key="responsibilities")

    response = _export(client, fx.bundle_id, fresh["lang"] if fresh["lang"] in ("ko", "en") else "ko")
    workbook = load_workbook(BytesIO(response.content))

    expected = "=SUM(A1)\N{REPLACEMENT CHARACTER}끝"
    sheet_a = workbook[workbook.sheetnames[0]]
    hits = [cell for row in sheet_a.iter_rows(min_row=3) for cell in row if cell.value == expected]
    assert len(hits) == 2  # 원문 문장 칸과 확정 문장 칸
    assert {cell.data_type for cell in hits} == {"s"}
    assert all(cell.quotePrefix for cell in hits)
    assert not [cell for sheet in workbook for row in sheet.iter_rows() for cell in row if cell.data_type == "f"]
    with zipfile.ZipFile(BytesIO(response.content)) as archive:
        assert not any(b"<f>" in archive.read(name) for name in archive.namelist() if name.startswith("xl/worksheets/"))
    assert _load_unit_text(unit["id"]) == "=SUM(A1)\x0b끝"  # DB 원문은 그대로


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

    sheet = _load(client, fx.bundle_id, "ko")["A 비교표"]
    source_col, confirmed_col = _find_column(sheet, "원문 문장"), _find_column(sheet, "확정 문장")
    id_col, status_col = _find_column(sheet, "단위 ID"), _find_column(sheet, "상태")
    first = next(row[0].row for row in sheet.iter_rows(min_row=3) if row[id_col - 1].value == long_unit["display_id"])
    block = [[cell.value for cell in sheet[first + offset]] for offset in range(4)]

    assert [row[id_col - 1] for row in block[:3]] == [long_unit["display_id"], "(이어짐)", "(이어짐)"]
    assert block[3][id_col - 1] not in (long_unit["display_id"], "(이어짐)")  # 다음 단위 줄
    for col in (source_col, confirmed_col):
        chunks = [row[col - 1] for row in block[:3]]
        assert [len(chunk) for chunk in chunks] == [CELL_TEXT_LIMIT, CELL_TEXT_LIMIT, 70_000 - 2 * CELL_TEXT_LIMIT]
        assert "".join(chunks) == long_text
    assert block[0][status_col - 1] == "확정" and block[1][status_col - 1] is None  # 이어짐 줄은 글만 잇는다


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
    response = _export(client, fx.bundle_id, "ko")

    sheet = load_workbook(BytesIO(response.content))["B 흐름"]
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


def test_flow_image_handles_empty_graph() -> None:
    assert draw_flow_png(FlowGraph(nodes=[], edges=[]), "en").startswith(PNG_SIGNATURE)


# ── 파일 이름 ────────────────────────────────────────────────────────────────


def test_export_file_name(client: TestClient) -> None:
    at = datetime(2026, 11, 5, 14, 30, tzinfo=KST)
    assert build_export_file_name("QC/원심분리기:1", "ko", at) == "QC_원심분리기_1_ko_20261105-1430.xlsx"
    assert build_export_file_name('a\\b*c?d"e<f>g|h\x07i', "en", at) == "a_b_c_d_e_f_g_h_i_en_20261105-1430.xlsx"
    assert build_export_file_name("가" * 400, "ko", at) == f"{'가' * 150}_ko_20261105-1430.xlsx"
    assert build_export_file_name("한글", "ko", at) == build_export_file_name("한글", "ko", at)  # NFC로 맞춘다
    decomposed = "\u1112\u1161\u11ab"  # NFD '한' — NFC로 맞춘다
    assert build_export_file_name(decomposed, "ko", at) == "한_ko_20261105-1430.xlsx"

    fx = _setup(client, [KEEP], title="QC/원심분리기:1")
    response = _export(client, fx.bundle_id, "ko")
    assert response.headers["content-type"] == XLSX_TYPE
    disposition = response.headers["content-disposition"]
    assert "filename*=UTF-8''" in disposition
    assert re.fullmatch(r"QC_원심분리기_1_ko_\d{8}-\d{4}\.xlsx", unquote(disposition.split("filename*=UTF-8''")[1]))
    assert disposition.split("filename*=UTF-8''")[1].startswith(quote("QC_원심분리기_1_ko_", safe=""))
    assert re.search(r'filename="[\x20-\x7e]+"', disposition)  # ASCII 대체 이름


# ── 작업 기록·상태·실패 ──────────────────────────────────────────────────────


def test_export_records_event_and_works_in_review(client: TestClient) -> None:
    fx = _setup(client, [KEEP])
    update_row(Bundle, fx.bundle_id, status="in_review")

    as_author = _load(client, fx.bundle_id, "ko")
    assert as_author["A 비교표"]["A1"].value == "상태: 검토 대기"
    _export(client, fx.bundle_id, "en", headers=REVIEWER)

    assert _load_events(fx.bundle_id, "export") == [
        ("qa.member", "bundle", [fx.bundle_id], "ko"),
        ("qa.lead", "bundle", [fx.bundle_id], "en"),
    ]
    update_row(Bundle, fx.bundle_id, status="done")
    assert {row[0].value: row[1].value for row in _load(client, fx.bundle_id, "ko")["정보"].iter_rows()}["상태"] == "검토 완료"

    outsider = client.get(f"/api/bundles/{fx.bundle_id}/export.xlsx", params={"lang": "ko"}, headers=OUTSIDER)
    assert (outsider.status_code, outsider.json()["detail"]["code"]) == (404, "bundle_not_found")
    bad_lang = client.get(f"/api/bundles/{fx.bundle_id}/export.xlsx", params={"lang": "fr"}, headers=AUTHOR)
    assert bad_lang.status_code == 422


def test_export_failure_is_reported_apart_from_save_failure(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fx = _setup(client, [KEEP])

    def _fail(*_args: object, **_kwargs: object) -> bytes:
        raise RuntimeError("secret sentence")

    monkeypatch.setattr("app.routers.sop_outputs.build_workbook", _fail)
    response = client.get(f"/api/bundles/{fx.bundle_id}/export.xlsx", params={"lang": "ko"}, headers=AUTHOR)

    assert response.status_code == 500
    assert response.json() == {"detail": {"code": "export_failed"}}  # 원문·예외 메시지가 응답에 새지 않는다
    assert _load_events(fx.bundle_id, "export") == []
