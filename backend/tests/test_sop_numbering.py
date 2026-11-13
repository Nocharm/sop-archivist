"""섹션 번호 — 칸 번호(SLOT_KEYS 고정 자리)와 들여쓰기 깊이로 세는 순수 함수, 결과물 A·C의 번호, 순서 바꾸기의 깊이 저장·거절.

묶음은 결과물 시험(test_sop_outputs)의 픽스처를 그대로 쓴다 — SOP·WI·입구 2 문서와 표·그림·나눔·중복 배정이 다 있다.
"""

from functools import partial
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import MAX_INDENT_LEVEL, SLOT_KEYS
from app.sop.models import TargetSentence
from app.sop.outputs import SLOT_NUMBERS, number_lines
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p
from tests.sop_helpers import AUTHOR, assign_as_is, create_bundle, find_unit, get_bundle, get_view, put_tobe, upload
from tests.test_sop_outputs import (
    DUPLICATE,
    MERGED,
    RECORDS_EN,
    SPLIT_A,
    SPLIT_B,
    SPLIT_SOURCE,
    _display,
    _display_of_kind,
    _get_output,
    _list_top_target_ids,
    _put_order,
    _setup,
)

pytestmark = pytest.mark.usefixtures("clean_sop")


@pytest.mark.parametrize(
    ("depths", "expected"),
    [
        ([], []),
        ([0, 0, 0], ["5.1", "5.2", "5.3"]),
        ([0, 1, 1, 2, 0], ["5.1", "5.1.1", "5.1.2", "5.1.2.1", "5.2"]),
        # 첫 줄은 앞줄이 없어 맨 바깥, 앞줄 깊이 + 1을 넘는 깊이는 눌러 읽는다
        ([3], ["5.1"]),
        # 앞줄의 "눌러 읽은" 깊이 + 1이 상한이라 같은 깊이를 연달아 보내면 한 단계씩 내려간다
        ([0, 4, 4], ["5.1", "5.1.1", "5.1.1.1"]),
        ([0, 1, 2, 3, 1, 0], ["5.1", "5.1.1", "5.1.1.1", "5.1.1.1.1", "5.1.2", "5.2"]),
        # 깊은 줄 뒤에서 한 번에 여러 단계 내어 쓴다
        ([0, 1, 2, 0, 2], ["5.1", "5.1.1", "5.1.1.1", "5.2", "5.2.1"]),
    ],
)
def test_number_lines(depths: list[int], expected: list[str]) -> None:
    assert number_lines("5", depths) == expected


def test_slot_numbers_follow_the_fixed_slot_positions() -> None:
    assert list(SLOT_NUMBERS) == list(SLOT_KEYS)
    assert SLOT_NUMBERS == {
        "purpose": "1", "scope": "2", "definitions": "3", "responsibilities": "4",
        "general_requirements": "5", "general_requirements.safety": "5.1", "general_requirements.operation": "5.2",
        "procedures": "6", "procedures.procedure": "6.1", "procedures.electronic_record_control": "6.2",
        "procedures.troubleshooting": "6.3", "procedures.maintenance": "6.4",
        "document_relationships": "7", "document_relationships.attachments": "7.1",
        "document_relationships.appendices": "7.2",
    }


def _read_numbers(doc: dict) -> list[tuple[str, str | None, list[tuple[str, str | None]]]]:
    """(칸 키, 칸 번호, [(글, 번호)]) — 글이 빈 항목(그림·표)은 종류로 적는다."""
    return [
        (
            section["location_key"], section["number"],
            [(item["text"] or item["kind"], item["number"]) for item in section["items"]],
        )
        for section in doc["sections"]
    ]


def test_output_c_numbers_slots_steps_and_lines(client: TestClient) -> None:
    fx = _setup(client)

    output = _get_output(client, fx.bundle_id, "outputs/c")

    sop, wi, match = output["docs"]
    sop_numbers = {key: (number, items) for key, number, items in _read_numbers(sop)}
    # N/A 칸(scope·document_relationships)도 자기 번호를 지켜 다른 칸 번호가 밀리지 않는다
    assert {key: number for key, (number, _) in sop_numbers.items()} == SLOT_NUMBERS
    assert sop_numbers["responsibilities"][1] == [(DUPLICATE, "4.1")]
    assert sop_numbers["general_requirements"][1] == [("table", "5.1")]
    # 한 칸의 한글·영어 문장을 C 순서대로 한 줄로 센다
    assert sop_numbers["general_requirements.operation"][1] == [(MERGED, "5.2.1"), (RECORDS_EN, "5.2.2")]
    # 표 칸은 언어와 무관하게 표의 번호를 따른다
    (table,) = next(section["items"] for section in sop["sections"] if section["location_key"] == "general_requirements")
    assert [cell["number"] for cell in table["children"]] == ["5.1"] * 4
    # WI는 단계 번호 아래로 Instruction·Why를 이어 센다
    assert _read_numbers(wi) == [
        ("step:1:instruction", "1", [(SPLIT_A, "1.1")]),
        ("step:1:why", "1", [(DUPLICATE, "1.2")]),
        ("step:2:instruction", "2", [(SPLIT_B, "2.1"), ("figure", "2.2")]),
        ("step:2:why", "2", []),
    ]
    # 입구 2 문서는 번호를 새로 매기지 않는다
    assert all(number is None and all(n is None for _, n in items) for _, number, items in _read_numbers(match))


def test_indent_changes_numbers_in_outputs_a_and_c(client: TestClient) -> None:
    fx = _setup(client)
    wi = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]
    (split_a,), (duplicate,), (split_b, figure), () = [section["items"] for section in wi["sections"]]
    revision = get_bundle(client, fx.bundle_id)["revision"]
    items = [
        {"target_id": split_a["target_id"]},
        {"target_id": duplicate["target_id"], "indent_level": 1},
        {"target_id": split_b["target_id"]},
        # 앞줄보다 넷 깊게 보내도 저장은 그대로, 번호는 한 단계로 눌러 읽는다
        {"target_id": figure["target_id"], "indent_level": 4},
    ]

    response = _put_order(client, fx.bundle_id, {"revision": revision, "target_doc_id": fx.wi_id, "items": items})

    assert response.status_code == 200, response.text
    assert [(item["target_id"], item["indent_level"]) for item in response.json()["items"]] == [
        (split_a["target_id"], 0), (duplicate["target_id"], 1), (split_b["target_id"], 0), (figure["target_id"], 4),
    ]
    wi = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]
    assert [[(item["number"], item["indent_level"]) for item in section["items"]] for section in wi["sections"]] == [
        [("1.1", 0)], [("1.1.1", 1)], [("2.1", 0), ("2.1.1", 4)], [],
    ]

    # 결과물 A의 새 위치 번호는 결과물 C와 같은 값 — 나눔은 ①② 순서, 중복 배정은 보낸 곳마다
    rows = _get_output(client, fx.bundle_id, "outputs/a", "ko")
    by_display: dict[str, list[dict]] = {}
    for row in rows:
        by_display.setdefault(row["display_id"], []).append(row)
    d1 = partial(_display, fx.old1)
    (split_row,) = by_display[d1(SPLIT_SOURCE)]
    assert split_row["dest_number"] == "① 1.1\n② 2.1"
    assert [(row["dest_doc_code"], row["dest_number"]) for row in by_display[d1(DUPLICATE)]] == [
        ("SOP-NEW", "4.1"), ("WI-01", "1.1.1"),
    ]
    (figure_row,) = by_display[_display_of_kind(fx.old1, "figure")]
    assert figure_row["dest_number"] == "2.1.1"
    # 삭제·이동·미배정과 입구 2 줄은 번호가 비어 있다
    assert {row["dest_number"] for row in rows if row["dest_kind"] in ("delete", "move_external", "")} == {""}
    assert {row["dest_number"] for row in rows if row["dest_doc_code"] == "SOP-9"} == {""}


def test_moving_a_line_to_another_step_resets_its_depth_unless_sent(client: TestClient) -> None:
    fx = _setup(client)
    wi = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]
    (split_a,), (duplicate,), (split_b, figure), () = [section["items"] for section in wi["sections"]]
    ids = [split_a["target_id"], duplicate["target_id"], split_b["target_id"], figure["target_id"]]

    def put(changes: dict[int, dict]) -> dict[int, tuple[int | None, int]]:
        revision = get_bundle(client, fx.bundle_id)["revision"]
        items = [{"target_id": target_id, **changes.get(target_id, {})} for target_id in ids]
        response = _put_order(client, fx.bundle_id, {"revision": revision, "target_doc_id": fx.wi_id, "items": items})
        assert response.status_code == 200, response.text
        return {item["target_id"]: (item["wi_step"], item["indent_level"]) for item in response.json()["items"]}

    assert put({figure["target_id"]: {"indent_level": 1}})[figure["target_id"]] == (2, 1)
    # 깊이를 보내지 않고 다른 단계로 옮기면 0 — 깊이는 그 칸 앞뒤 줄에 기댄 값이다
    assert put({figure["target_id"]: {"wi_step": 1}})[figure["target_id"]] == (1, 0)
    # 옮기면서 깊이를 함께 보내면 그 값을 지킨다
    assert put({figure["target_id"]: {"wi_step": 2, "indent_level": 1}})[figure["target_id"]] == (2, 1)
    # 단계가 그대로면(같은 단계를 보내도) 깊이는 그대로다
    assert put({figure["target_id"]: {"wi_step": 2}})[figure["target_id"]] == (2, 1)


def test_reorder_rejects_bad_indents(client: TestClient) -> None:
    fx = _setup(client)
    revision = get_bundle(client, fx.bundle_id)["revision"]
    sop_items = [{"target_id": target_id} for target_id in _list_top_target_ids(client, fx.bundle_id, 0)]
    match_items = [{"target_id": target_id} for target_id in _list_top_target_ids(client, fx.bundle_id, 2)]

    too_deep = _put_order(client, fx.bundle_id, {
        "revision": revision, "target_doc_id": fx.sop_id,
        "items": [{**sop_items[0], "indent_level": MAX_INDENT_LEVEL + 1}, *sop_items[1:]],
    })
    negative = _put_order(client, fx.bundle_id, {
        "revision": revision, "target_doc_id": fx.sop_id, "items": [{**sop_items[0], "indent_level": -1}, *sop_items[1:]],
    })
    on_match = _put_order(client, fx.bundle_id, {
        "revision": revision, "target_doc_id": fx.match_id,
        "items": [{**match_items[0], "indent_level": 1}, *match_items[1:]],
    })
    same_on_match = _put_order(client, fx.bundle_id, {
        "revision": revision, "target_doc_id": fx.match_id,
        "items": [{**match_items[0], "indent_level": 0}, *match_items[1:]],
    })
    deepest = _put_order(client, fx.bundle_id, {
        "revision": revision + 1, "target_doc_id": fx.sop_id,
        "items": [{**sop_items[0], "indent_level": MAX_INDENT_LEVEL}, *sop_items[1:]],
    })

    assert (too_deep.status_code, too_deep.json()["detail"][0]["type"]) == (422, "less_than_equal")
    assert (negative.status_code, negative.json()["detail"][0]["type"]) == (422, "greater_than_equal")
    assert (on_match.status_code, on_match.json()["detail"]) == (
        422, {"code": "indent_not_allowed", "target_ids": [match_items[0]["target_id"]]},
    )
    # 지금 깊이 그대로(0)를 보내는 것은 바꾸지 않는 것이라 입구 2 문서의 순서 바꾸기를 막지 않는다
    assert same_on_match.status_code == 200, same_on_match.text
    assert deepest.status_code == 200, deepest.text


# ── 번호 표시: 번호·생략·주석 ───────────────────────────────────────────────


@pytest.mark.parametrize(
    ("depths", "expected"),
    [
        # 생략·주석 줄(None)은 번호가 없고 다음 번호 줄이 이어 센다
        ([0, None, 0], ["5.1", None, "5.2"]),
        # 첫 줄이 생략이면 다음 번호 줄이 칸의 첫 번호다
        ([None, 0, 0], [None, "5.1", "5.2"]),
        ([None, 3], [None, "5.1"]),
        # 깊은 자리의 생략은 그 깊이의 세기를 멈추지 않는다
        ([0, 1, None, 1], ["5.1", "5.1.1", None, "5.1.2"]),
        # 눌러 읽기의 상한은 앞 번호 줄만 본다 — 생략 줄의 깊이는 세지 않는다
        ([0, None, 2], ["5.1", None, "5.1.1"]),
        ([0, 1, None, 0, 1], ["5.1", "5.1.1", None, "5.2", "5.2.1"]),
        ([None, None], [None, None]),
    ],
)
def test_number_lines_skips_unnumbered_lines(depths: list[int | None], expected: list[str | None]) -> None:
    assert number_lines("5", depths) == expected


def _put_styles(client: TestClient, bundle_id: int, target_doc_id: int, ids: list[int], styles: dict[int, str]) -> dict:
    revision = get_bundle(client, bundle_id)["revision"]
    items = [
        {"target_id": target_id, **({"number_style": styles[target_id]} if target_id in styles else {})}
        for target_id in ids
    ]
    response = _put_order(client, bundle_id, {"revision": revision, "target_doc_id": target_doc_id, "items": items})
    assert response.status_code == 200, response.text
    return {item["target_id"]: item["number_style"] for item in response.json()["items"]}


def test_omitted_and_note_lines_take_no_number_in_outputs_a_and_c(client: TestClient) -> None:
    fx = _setup(client)
    wi = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]
    (split_a,), (duplicate,), (split_b, figure), () = [section["items"] for section in wi["sections"]]
    ids = [split_a["target_id"], duplicate["target_id"], split_b["target_id"], figure["target_id"]]
    assert {item["number_style"] for item in (split_a, duplicate, split_b, figure)} == {"numbered"}

    styles = _put_styles(
        client, fx.bundle_id, fx.wi_id, ids, {duplicate["target_id"]: "note", split_b["target_id"]: "omitted"}
    )

    assert styles == {
        split_a["target_id"]: "numbered", duplicate["target_id"]: "note", split_b["target_id"]: "omitted",
        figure["target_id"]: "numbered",
    }
    wi = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]
    assert [[(item["number"], item["number_style"]) for item in section["items"]] for section in wi["sections"]] == [
        [("1.1", "numbered")], [(None, "note")], [(None, "omitted"), ("2.1", "numbered")], [],
    ]
    # 결과물 A — 번호 없는 새 문장은 번호 칸이 비고(나눔이면 그 자리만), 주석 줄이면 dest_is_note
    rows = _get_output(client, fx.bundle_id, "outputs/a", "ko")
    d1 = partial(_display, fx.old1)
    (split_row,) = [row for row in rows if row["display_id"] == d1(SPLIT_SOURCE)]
    assert (split_row["dest_number"], split_row["dest_is_note"]) == ("① 1.1\n② ", False)
    duplicate_rows = [row for row in rows if row["display_id"] == d1(DUPLICATE)]
    assert [(row["dest_doc_code"], row["dest_number"], row["dest_is_note"]) for row in duplicate_rows] == [
        ("SOP-NEW", "4.1", False), ("WI-01", "", True),
    ]
    (figure_row,) = [row for row in rows if row["display_id"] == _display_of_kind(fx.old1, "figure")]
    assert figure_row["dest_number"] == "2.1"

    # 다시 번호로 돌리면 번호가 돌아온다
    _put_styles(client, fx.bundle_id, fx.wi_id, ids, {duplicate["target_id"]: "numbered", split_b["target_id"]: "numbered"})
    wi = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]
    assert [[item["number"] for item in section["items"]] for section in wi["sections"]] == [
        ["1.1"], ["1.2"], ["2.1", "2.2"], [],
    ]


def test_a_marked_table_carries_its_mark_to_its_cells(client: TestClient) -> None:
    fx = _setup(client)
    sop = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][0]
    (table,) = next(section["items"] for section in sop["sections"] if section["location_key"] == "general_requirements")
    ids = _list_top_target_ids(client, fx.bundle_id, 0)

    _put_styles(client, fx.bundle_id, fx.sop_id, ids, {table["target_id"]: "omitted"})

    sop = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][0]
    (table,) = next(section["items"] for section in sop["sections"] if section["location_key"] == "general_requirements")
    assert (table["number"], table["number_style"]) == (None, "omitted")
    assert {(cell["number"], cell["number_style"]) for cell in table["children"]} == {(None, "omitted")}


def test_reorder_rejects_bad_number_styles(client: TestClient) -> None:
    fx = _setup(client)
    revision = get_bundle(client, fx.bundle_id)["revision"]
    sop_items = [{"target_id": target_id} for target_id in _list_top_target_ids(client, fx.bundle_id, 0)]
    match_items = [{"target_id": target_id} for target_id in _list_top_target_ids(client, fx.bundle_id, 2)]

    unknown = _put_order(client, fx.bundle_id, {
        "revision": revision, "target_doc_id": fx.sop_id,
        "items": [{**sop_items[0], "number_style": "hidden"}, *sop_items[1:]],
    })
    on_match = _put_order(client, fx.bundle_id, {
        "revision": revision, "target_doc_id": fx.match_id,
        "items": [{**match_items[0], "number_style": "note"}, *match_items[1:]],
    })
    same_on_match = _put_order(client, fx.bundle_id, {
        "revision": revision, "target_doc_id": fx.match_id,
        "items": [{**match_items[0], "number_style": "numbered"}, *match_items[1:]],
    })

    assert (unknown.status_code, unknown.json()["detail"][0]["type"]) == (422, "literal_error")
    assert (on_match.status_code, on_match.json()["detail"]) == (
        422, {"code": "number_style_not_allowed", "target_ids": [match_items[0]["target_id"]]},
    )
    # 지금 표시 그대로를 보내는 것은 바꾸지 않는 것이라 입구 2 문서의 순서 바꾸기를 막지 않는다
    assert same_on_match.status_code == 200, same_on_match.text


def test_excel_leaves_unnumbered_cells_empty_and_italicizes_notes(client: TestClient) -> None:
    fx = _setup(client)
    wi = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]
    (split_a,), (duplicate,), (split_b, figure), () = [section["items"] for section in wi["sections"]]
    ids = [split_a["target_id"], duplicate["target_id"], split_b["target_id"], figure["target_id"]]
    _put_styles(client, fx.bundle_id, fx.wi_id, ids, {duplicate["target_id"]: "note", split_b["target_id"]: "omitted"})

    response = client.get(f"/api/bundles/{fx.bundle_id}/export.xlsx", params={"lang": "ko"}, headers=AUTHOR)
    assert response.status_code == 200, response.text
    workbook = load_workbook(BytesIO(response.content))

    sheet_c = workbook["C 새 문서"]
    number_col, item_col = _find_header(sheet_c, "번호"), _find_header(sheet_c, "항목")
    rows = {row[item_col - 1].value: row for row in sheet_c.iter_rows(min_row=3) if row[item_col - 1].value}
    assert (rows[SPLIT_A][number_col - 1].value, rows[SPLIT_A][item_col - 1].font.i) == ("1.1", False)
    # 주석 줄 — 번호 칸이 비고 항목 글이 기울어 있다
    note_rows = [row for row in sheet_c.iter_rows(min_row=3) if row[item_col - 1].value == DUPLICATE]
    assert [(row[number_col - 1].value, row[item_col - 1].font.i) for row in note_rows] == [("4.1", False), (None, True)]
    # 생략 줄 — 번호 칸만 비고 기울이지 않는다
    assert (rows[SPLIT_B][number_col - 1].value, rows[SPLIT_B][item_col - 1].font.i) == (None, False)

    sheet_a = workbook["A 비교표"]
    dest_code_col, confirmed_col = _find_header(sheet_a, "새 문서 번호"), _find_header(sheet_a, "확정 문장")
    a_number_col = _find_header(sheet_a, "새 문서 안 번호")
    duplicate_rows = [
        (row[dest_code_col - 1].value, row[a_number_col - 1].value, row[confirmed_col - 1].font.i)
        for row in sheet_a.iter_rows(min_row=3) if row[confirmed_col - 1].value == DUPLICATE
    ]
    assert duplicate_rows == [("SOP-NEW", "4.1", False), ("WI-01", None, True)]


def _find_header(sheet: Worksheet, header: str) -> int:
    return next(cell.column for cell in sheet[2] if cell.value == header)


PAIRED = [
    ("합성 장비를 켠다.", "Turn on the synthetic unit."),
    ("합성 시료를 넣는다.", "Load the synthetic sample."),
    ("합성 결과를 적는다.", "Record the synthetic result."),
]
PAIR_SLOT = "procedures.procedure"


def _setup_pairs(client: TestClient) -> tuple[int, int, list[tuple[int, int]]]:
    """한/영 연달아 옛 문서의 짝 셋을 사람이 잇고 각 원문을 SOP 한 칸에 그대로 보낸 묶음 — (묶음, SOP, [(한 새 문장, 영 새 문장)])."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = put_tobe(client, bundle_id, [{"code": "SOP-P", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}])
    assert response.status_code == 200, response.text
    sop_id = response.json()["docs"][0]["id"]
    body = "".join(p(ko) + p(en) for ko, en in PAIRED)
    uploaded = upload(client, bundle_id, build_docx(body), "SYNTHETIC_OLD-P_Pairs.docx")
    assert uploaded.status_code == 201, uploaded.text
    doc_id = uploaded.json()["id"]
    targets = []
    for ko, en in PAIRED:
        view = get_view(client, bundle_id, doc_id)
        units = [find_unit(view, ko), find_unit(view, en)]
        assert [unit["lang"] for unit in units] == ["ko", "en"]
        paired = client.post(
            f"/api/bundles/{bundle_id}/documents/{doc_id}/pairs",
            json={"revision": view["document"]["revision"], "unit_ids": [unit["id"] for unit in units]}, headers=AUTHOR,
        )
        assert paired.status_code == 201, paired.text
        ids = []
        for unit in units:
            (target,) = assign_as_is(client, bundle_id, unit, sop_id, slot_key=PAIR_SLOT)["targets"]
            ids.append(target["id"])
        targets.append((ids[0], ids[1]))
    return bundle_id, sop_id, targets


def _read_pair_slot_items(client: TestClient, bundle_id: int) -> list[tuple[str, str | None, str]]:
    """짝 칸의 항목 — (언어, 번호, 번호 표시), 결과물 C 순서."""
    (sop,) = _get_output(client, bundle_id, "outputs/c")["docs"]
    section = next(section for section in sop["sections"] if section["location_key"] == PAIR_SLOT)
    return [(item["lang"], item["number"], item["number_style"]) for item in section["items"]]


def _read_pair_slot(client: TestClient, bundle_id: int) -> list[tuple[str | None, str]]:
    return [(number, style) for _, number, style in _read_pair_slot_items(client, bundle_id)]


def _set_number_styles(styles: dict[int, str]) -> None:
    """번호 표시를 DB에 바로 쓴다 — 순서 바꾸기가 아직 짝 상대에 표시를 옮겨서, 언어마다 다른 표시는 이 길로만 만든다."""

    async def _write(session: AsyncSession) -> None:
        for target_id, style in styles.items():
            await session.execute(update(TargetSentence).where(TargetSentence.id == target_id).values(number_style=style))
        await session.commit()

    run_in_session(_write)


def test_one_slot_counts_both_languages_in_one_sequence(client: TestClient) -> None:
    bundle_id, _sop_id, _targets = _setup_pairs(client)  # 짝 셋, 단위마다 따로 저장(기본 번호)

    items = _read_pair_slot_items(client, bundle_id)

    assert [lang for lang, _, _ in items] == ["en", "ko"] * 3  # 같은 의미끼리, 영어 먼저
    assert [number for _, number, _ in items] == ["6.1.1", "6.1.2", "6.1.3", "6.1.4", "6.1.5", "6.1.6"]


def test_omitted_and_note_lines_are_skipped_across_languages(client: TestClient) -> None:
    """설계 §6 예 — 5.1 English / 한글(생략) / Note(주석) / 한글(생략) / 5.2 English / 한글(생략)."""
    bundle_id, _sop_id, targets = _setup_pairs(client)
    (_, en_second) = targets[1]
    _set_number_styles({ko: "omitted" for ko, _ in targets} | {en_second: "note"})

    items = _read_pair_slot_items(client, bundle_id)

    assert items == [
        ("en", "6.1.1", "numbered"), ("ko", None, "omitted"), ("en", None, "note"), ("ko", None, "omitted"),
        ("en", "6.1.2", "numbered"), ("ko", None, "omitted"),
    ]


def test_a_pair_counts_as_one_and_a_mark_on_one_member_reaches_its_partner(client: TestClient) -> None:
    bundle_id, sop_id, targets = _setup_pairs(client)
    ids = [target_id for pair in targets for target_id in pair]
    # 한 칸의 두 언어를 한 줄로 센다
    numbered = [(f"6.1.{n}", "numbered") for n in range(1, 7)]
    assert _read_pair_slot(client, bundle_id) == numbered

    (ko_second, en_second) = targets[1]
    styles = _put_styles(client, bundle_id, sop_id, ids, {ko_second: "omitted"})

    # 한쪽만 보내도 서버가 짝 상대에 같은 표시를 옮긴다 — 순서를 보낸 대로(한글 먼저) 6.1.1, 6.1.2, 생략, 생략, 6.1.3, 6.1.4
    assert (styles[ko_second], styles[en_second]) == ("omitted", "omitted")
    assert _read_pair_slot(client, bundle_id) == [
        ("6.1.1", "numbered"), ("6.1.2", "numbered"), (None, "omitted"), (None, "omitted"), ("6.1.3", "numbered"),
        ("6.1.4", "numbered"),
    ]

    # 상대에 지금 값 그대로를 함께 보내도(프런트가 목록 전체를 실어 보내는 경우) 바꾼 쪽이 이긴다
    (ko_third, en_third) = targets[2]
    styles = _put_styles(client, bundle_id, sop_id, ids, {en_third: "note", ko_third: "numbered"})
    assert (styles[ko_third], styles[en_third]) == ("note", "note")


def test_a_pair_cannot_be_marked_two_ways_at_once(client: TestClient) -> None:
    bundle_id, sop_id, targets = _setup_pairs(client)
    ids = [target_id for pair in targets for target_id in pair]
    (ko_first, en_first) = targets[0]
    revision = get_bundle(client, bundle_id)["revision"]
    styles = {ko_first: "note", en_first: "omitted"}
    items = [{"target_id": target_id, **({"number_style": styles[target_id]} if target_id in styles else {})} for target_id in ids]

    response = _put_order(client, bundle_id, {"revision": revision, "target_doc_id": sop_id, "items": items})

    assert (response.status_code, response.json()["detail"]) == (
        422, {"code": "number_style_pair_mismatch", "target_ids": sorted((ko_first, en_first))},
    )
    assert _read_pair_slot(client, bundle_id)[0] == ("6.1.1", "numbered")
