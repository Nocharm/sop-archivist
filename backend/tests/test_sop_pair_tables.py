"""한/영 따로 — 대응 표의 문장 짝(MD 1 F8a, 사용자 결정 2026-11-19). 표는 하나씩 벗기고, 다른 언어 절반의 같은 꼴 표를 함께 벗기면
(또는 나중에 따로 벗겨도) 두 표의 칸 줄이 같은 행 · 같은 순서로 한/영 짝 제안이 된다. 행 수가 다르면 짝 대신 경고가 남는다.
자료는 표형 옛 SOP의 한글 절반 → 영어 절반(명세 §7 사례 1 · 부록 C 장면)을 본뜬 합성 문서다."""

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.sop.constants import COVER_KINDS
from app.sop.coverage import find_coverage_problems
from tests.docx_factory import build_docx, make_grid_table, make_row, p
from tests.sop_helpers import AUTHOR, create_bundle, get_view, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_SYN-PAIR-1_Separate_tables.docx"
WORK_WIDTHS = [1588, 8050]  # 2.8 / 14.2 cm 작업 표(명세 §7)
VALUE_WIDTHS = [2000, 2000, 2000]
KO_WORK = [["단계", "작업 내용"], ["준비", ["세척액 농도를 확인한다.", "배수 밸브를 닫는다."]], ["점검", "펌프 압력을 기록한다."]]
EN_WORK = [
    ["Step", "Task"], ["Preparation", ["Check the detergent concentration.", "Close the drain valve."]],
    ["Check", "Record the pump pressure."],
]
EN_LATER = [["Step", "Task"], ["Drain", "Open the drain valve slowly."], ["Flush", "Flush the line with purified water."]]
KO_VALUE = [["항목", "기준", "단위"], ["농도", "5", "%"]]
EN_VALUE = [["Item", "Limit", "Unit"], ["Concentration", "5", "%"], ["Temperature", "40", "°C"]]
# 표 순번: 0 한글 작업 표 · 1 한글 값 표 · 2 영어 작업 표 · 3 영어 값 표(행 하나 더) · 4 영어 작업 표(같은 꼴, 절반 안 더 뒤)
KO_TABLE, KO_VALUE_TABLE, EN_TABLE, EN_VALUE_TABLE, EN_LATER_TABLE = range(5)


def _table(rows: list[list[object]], widths: list[int]) -> str:
    xml = "".join(
        make_row([cell if isinstance(cell, str) else "".join(p(text) for text in cell) for cell in row]) for row in rows
    )
    return make_grid_table(len(widths), xml, widths)


BODY = (
    p("1. 세척 준비", "Heading1") + p("이 절은 세척 준비를 다룬다.")
    + _table(KO_WORK, WORK_WIDTHS) + _table(KO_VALUE, VALUE_WIDTHS)
    + p("1. Cleaning preparation", "Heading1") + p("This section covers cleaning preparation.")
    + _table(EN_WORK, WORK_WIDTHS) + _table(EN_VALUE, VALUE_WIDTHS) + _table(EN_LATER, WORK_WIDTHS)
)
# 한글 작업 표 ↔ 영어 작업 표 — 같은 행 · 같은 순서로 1:1
WORK_PAIRS = {
    frozenset(pair) for pair in [
        ("단계", "Step"), ("작업 내용", "Task"), ("준비", "Preparation"),
        ("세척액 농도를 확인한다.", "Check the detergent concentration."), ("배수 밸브를 닫는다.", "Close the drain valve."),
        ("점검", "Check"), ("펌프 압력을 기록한다.", "Record the pump pressure."),
    ]
}


def _setup(client: TestClient) -> tuple[int, int]:
    bundle = create_bundle(client, is_synthetic=True)
    response = upload(client, bundle["id"], build_docx(BODY), OLD_NAME)
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    assert response.json()["language_layout"] == "ko_en_separate"
    return bundle["id"], response.json()["id"]


def _table_id(view: dict, index: int) -> int:
    return view["tables"][index]["id"]


def _unwrap(client: TestClient, bundle_id: int, doc_id: int, index: int, counterpart: int | None = None) -> httpx2.Response:
    view = get_view(client, bundle_id, doc_id)
    op: dict[str, object] = {"type": "set_layout_table", "table_id": _table_id(view, index), "is_layout": True}
    if counterpart is not None:
        op["counterpart_table_id"] = _table_id(view, counterpart)
    body = {"revision": view["document"]["revision"], "confirm": False, "op": op}
    response = client.post(f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response


def _step(client: TestClient, bundle_id: int, doc_id: int, action: str) -> None:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits/{action}", json={"revision": revision}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text


def _layouts(view: dict) -> list[bool]:
    return [table["is_layout"] for table in view["tables"]]


def _pairs(view: dict) -> set[frozenset[str]]:
    texts = {unit["id"]: unit["text"] for unit in view["units"]}
    return {frozenset(texts[unit_id] for unit_id in pair["unit_ids"]) for pair in view["pairs"]}


def _warnings(client: TestClient, bundle_id: int) -> list[dict]:
    response = client.get(f"/api/bundles/{bundle_id}/documents", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return [warning for warning in response.json()[0]["extraction"]["warnings"] if warning["kind"] == "pair_rows_differ"]


def _coverage_problems(view: dict) -> list[str]:
    block_texts = {block["id"]: block["text"] for block in view["blocks"]}
    return find_coverage_problems(
        block_texts, [[tuple(span) for span in unit["spans"]] for unit in view["units"] if unit["kind"] in COVER_KINDS]
    )


def test_view_offers_the_most_similar_table_of_the_other_half_first(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)

    view = get_view(client, bundle_id, doc_id)

    ids = [table["id"] for table in view["tables"]]
    assert [table["lang"] for table in view["tables"]] == ["ko", "ko", "en", "en", "en"]
    # 같은 꼴 · 같은 행 수 · 절반 안 같은 자리가 맨 앞, 같은 꼴이지만 더 뒤의 표, 다른 꼴 표 — 다른 표도 고를 수 있게 모두 싣는다
    assert view["tables"][KO_TABLE]["counterparts"] == [ids[EN_TABLE], ids[EN_LATER_TABLE], ids[EN_VALUE_TABLE]]
    assert view["tables"][KO_VALUE_TABLE]["counterparts"][0] == ids[EN_VALUE_TABLE]
    assert view["tables"][EN_TABLE]["counterparts"] == [ids[KO_TABLE], ids[KO_VALUE_TABLE]]


def test_unwrapping_with_the_counterpart_is_one_edit_and_pairs_rows_in_order(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    before = get_view(client, bundle_id, doc_id)

    _unwrap(client, bundle_id, doc_id, KO_TABLE, EN_TABLE)

    view = get_view(client, bundle_id, doc_id)
    assert _layouts(view) == [True, False, True, False, False]
    assert _pairs(view) == WORK_PAIRS
    assert {(pair["status"], pair["source"]) for pair in view["pairs"]} == {("suggested", "code")}
    # 둘 다 벗겼으니 대응 표 후보에서 빠진다 — 남은 표는 같은 꼴 대응 표가 없어 묻지 않는다
    assert view["tables"][EN_LATER_TABLE]["counterparts"] == []
    assert _coverage_problems(view) == []

    # 되돌리기 한 번에 두 표가 함께 표로 돌아오고 짝도 빠진다
    _step(client, bundle_id, doc_id, "undo")
    undone = get_view(client, bundle_id, doc_id)
    assert _layouts(undone) == _layouts(before) == [False] * 5
    assert sorted(unit["id"] for unit in undone["units"]) == sorted(unit["id"] for unit in before["units"])
    assert undone["pairs"] == []

    _step(client, bundle_id, doc_id, "redo")
    assert _pairs(get_view(client, bundle_id, doc_id)) == WORK_PAIRS


def test_another_chosen_table_is_honoured_even_on_redo(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    # 영어 작업 표를 먼저 따로 벗겨 둔다 — 같은 꼴 판정만이면 한글 작업 표는 이 표와 맺어질 것이다
    _unwrap(client, bundle_id, doc_id, EN_TABLE)

    _unwrap(client, bundle_id, doc_id, KO_TABLE, EN_LATER_TABLE)

    expected = {
        frozenset(("단계", "Step")), frozenset(("작업 내용", "Task")),
        # 줄 수가 다른 행(한글 셋 · 영어 둘)은 한 덩어리 짝이다
        frozenset(("준비", "세척액 농도를 확인한다.", "배수 밸브를 닫는다.", "Drain", "Open the drain valve slowly.")),
        frozenset(("점검", "Flush")), frozenset(("펌프 압력을 기록한다.", "Flush the line with purified water.")),
    }
    assert _pairs(get_view(client, bundle_id, doc_id)) == expected
    _step(client, bundle_id, doc_id, "undo")
    assert get_view(client, bundle_id, doc_id)["pairs"] == []
    _step(client, bundle_id, doc_id, "redo")
    assert _pairs(get_view(client, bundle_id, doc_id)) == expected


def test_this_table_only_unwraps_one_and_the_pairs_come_when_the_counterpart_is_unwrapped_later(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)

    _unwrap(client, bundle_id, doc_id, KO_TABLE)

    view = get_view(client, bundle_id, doc_id)
    assert _layouts(view) == [True, False, False, False, False]
    assert view["pairs"] == []
    # 대응 표가 이미 벗겨졌으니 영어 작업 표를 벗길 때는 묻지 않는다(남은 한글 후보는 다른 꼴뿐이다)
    assert view["tables"][EN_TABLE]["counterparts"] == []

    _unwrap(client, bundle_id, doc_id, EN_TABLE)

    assert _pairs(get_view(client, bundle_id, doc_id)) == WORK_PAIRS


def test_tables_with_different_row_counts_get_a_warning_instead_of_pairs(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)

    _unwrap(client, bundle_id, doc_id, KO_VALUE_TABLE, EN_VALUE_TABLE)

    view = get_view(client, bundle_id, doc_id)
    assert view["pairs"] == []
    warnings = _warnings(client, bundle_id)
    assert [(warning["detail"], warning["needs_ack"]) for warning in warnings] == [
        ({"ko_table": "2", "en_table": "4", "ko_rows": "2", "en_rows": "3"}, False)
    ]
    first_cell = min((block for block in view["blocks"] if block["table_id"] == _table_id(view, KO_VALUE_TABLE)), key=lambda block: block["seq"])
    assert warnings[0]["block_id"] == first_cell["id"]

    # 다른 표를 벗겨도 남은 경고는 그대로(같은 행), 되돌리면 지워진다
    _unwrap(client, bundle_id, doc_id, KO_TABLE, EN_TABLE)
    assert [warning["id"] for warning in _warnings(client, bundle_id)] == [warnings[0]["id"]]
    _step(client, bundle_id, doc_id, "undo")
    _step(client, bundle_id, doc_id, "undo")
    assert _warnings(client, bundle_id) == []


def test_a_confirmed_pair_row_is_kept_and_the_other_rows_are_proposed_again(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    _unwrap(client, bundle_id, doc_id, KO_TABLE, EN_TABLE)
    view = get_view(client, bundle_id, doc_id)
    texts = {unit["id"]: unit["text"] for unit in view["units"]}
    first = next(pair for pair in view["pairs"] if {texts[unit_id] for unit_id in pair["unit_ids"]} == {"점검", "Check"})
    response = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/pairs/{first['id']}/confirm",
        json={"revision": view["document"]["revision"]}, headers=AUTHOR,
    )
    assert response.status_code == 200, response.text

    # 다른 표를 벗기면 제안 짝은 다시 세워지고, 확정 짝은 그대로 남는다
    _unwrap(client, bundle_id, doc_id, KO_VALUE_TABLE)

    after = get_view(client, bundle_id, doc_id)
    assert _pairs(after) == WORK_PAIRS
    assert {pair["status"] for pair in after["pairs"] if pair["id"] == first["id"]} == {"confirmed"}


def test_counterpart_is_only_for_unwrapping_another_table(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)
    table_id = _table_id(view, KO_TABLE)

    for op in (
        {"type": "set_layout_table", "table_id": table_id, "is_layout": False, "counterpart_table_id": _table_id(view, EN_TABLE)},
        {"type": "set_layout_table", "table_id": table_id, "is_layout": True, "counterpart_table_id": table_id},
    ):
        body = {"revision": view["document"]["revision"], "confirm": False, "op": op}
        response = client.post(f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json=body, headers=AUTHOR)
        assert response.status_code == 422, response.text
