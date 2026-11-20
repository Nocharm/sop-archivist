"""표 안 표(표 풀기·표준화 명세 F2, 같은 꼴 함께 벗기기는 뺌 — 사용자 결정 2026-11-19) — 안쪽 표의 바깥 칸 자리(문서 보기 anchor),
바깥 표를 벗기면 안쪽 띠 표는 제목 줄 · 안쪽 표는 그대로 표, 안쪽 표를 또 벗기기, 다시 표로는 누른 표만, 커버리지, 결과물 A 위치의 바깥 칸
앞붙이. 자료는 명세 §7 사례 1의 작업 표(2열 2.8 / 14.2 cm, 첫 행 칸에 띠 표)를 본뜬 합성 문서다."""

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.sop.constants import COVER_KINDS
from app.sop.coverage import find_coverage_problems
from app.sop.extract import docx_reader
from app.sop.segment import PARAS_SIGNAL, PLACE_SIGNAL, find_anchor_offset, read_table_place
from tests.docx_factory import build_docx, make_band_table, make_grid_table, make_row, p
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_view, put_tobe, save_group, upload
from tests.test_sop_decisions import _body, _unit_in

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_SYN-UNWRAP-2_Nested.docx"
TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]
INTRO = "이 절차는 공조기 점검을 정한다."
DAILY, ACCESS = "일상 점검 (Daily check)", "시스템 권한 (Access level)"
CHECK = ["전원 표시등이 켜졌는지 본다.", "차압계 값을 기록한다."]
LIMIT_BEFORE, LIMIT_AFTER = "차압은 아래 값 안이어야 한다.", "값을 넘으면 필터를 교체한다."
GRANT = "권한은 시스템 관리자가 부여한다."
ADMIN, WORKER = "설정 값을 바꾸고 기록을 승인한다.", "점검 결과를 입력한다."
WIDTHS = [1588, 8050]  # 2.8 / 14.2 cm(twip)
# 값 표(차압 기준)는 칸 안 두 문단 사이에, 권한 표(열쇠-내용)는 칸 안 첫 자리에 든다
VALUE_TABLE = make_grid_table(3, make_row(["공장", "1공장", "2공장"]) + make_row(["차압", "120 Pa", "150 Pa"]))
ACCESS_TABLE = make_grid_table(
    2, make_row(["권한 레벨", "할 수 있는 일"], header=True) + make_row(["관리자", ADMIN]) + make_row(["작업자", WORKER])
)
# 표 순번: 작업 표 1 = 0, 띠 표 7.1 = 1, 값 표 = 2, 작업 표 2 = 3, 띠 표 7.2 = 4, 권한 표 = 5
WORK_1 = make_grid_table(2, (
    make_row([make_band_table("7.1", DAILY) + p("")], spans=[2])
    + make_row(["점검 항목", "".join(p(text) for text in CHECK)])
    + make_row(["기준", p(LIMIT_BEFORE) + VALUE_TABLE + p(LIMIT_AFTER)])
), widths=WIDTHS)
WORK_2 = make_grid_table(2, (
    make_row([make_band_table("7.2", ACCESS) + p("")], spans=[2])
    + make_row(["권한 부여", GRANT])
    + make_row(["권한 표", ACCESS_TABLE + p("")])
), widths=WIDTHS)
BODY = p(INTRO) + WORK_1 + WORK_2


def _setup(client: TestClient) -> tuple[int, int, int]:
    """(묶음, 새 SOP, 옛 문서)."""
    bundle = create_bundle(client, is_synthetic=True)
    tobe = put_tobe(client, bundle["id"], TOBE_DOCS)
    assert tobe.status_code == 200, tobe.text
    response = upload(client, bundle["id"], build_docx(BODY), OLD_NAME)
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    return bundle["id"], tobe.json()["docs"][0]["id"], response.json()["id"]


def _set_layout(
    client: TestClient, bundle_id: int, doc_id: int, table_index: int, is_layout: bool, *, confirm: bool = False
) -> httpx2.Response:
    view = get_view(client, bundle_id, doc_id)
    table = view["tables"][table_index]
    body = {
        "revision": view["document"]["revision"], "confirm": confirm,
        "op": {"type": "set_layout_table", "table_id": table["id"], "is_layout": is_layout},
    }
    return client.post(f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json=body, headers=AUTHOR)


def _unwrap(client: TestClient, bundle_id: int, doc_id: int, table_index: int) -> None:
    response = _set_layout(client, bundle_id, doc_id, table_index, True)
    assert response.status_code == 200, response.text


def _step(client: TestClient, bundle_id: int, doc_id: int, action: str) -> None:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits/{action}", json={"revision": revision}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text


def _lines(view: dict, table_index: int) -> list[str]:
    """그 표의 칸 줄(묶이지 않은 칸 문장) 글 — 원문 순."""
    table_id = view["tables"][table_index]["id"]
    return [
        unit["text"] for unit in view["units"]
        if unit["kind"] == "cell_sentence" and unit["table_id"] == table_id and unit["group_unit_id"] is None
    ]


def _table_unit(view: dict, table_index: int) -> dict | None:
    table_id = view["tables"][table_index]["id"]
    return next((unit for unit in view["units"] if unit["kind"] == "table" and unit["table_id"] == table_id), None)


def _coverage_problems(view: dict) -> list[str]:
    texts = {block["id"]: block["text"] for block in view["blocks"]}
    return find_coverage_problems(
        texts, [[tuple(span) for span in unit["spans"]] for unit in view["units"] if unit["kind"] in COVER_KINDS]
    )


def _cell_block(view: dict, table_index: int, row: int, col: int) -> dict:
    table_id = view["tables"][table_index]["id"]
    return next(
        block for block in view["blocks"]
        if block["table_id"] == table_id and (block["row_index"], block["col_index"]) == (row, col)
    )


def test_place_signal_reading_matches_the_extractor() -> None:
    assert (PLACE_SIGNAL, PARAS_SIGNAL) == (docx_reader.SIGNAL_PLACE, docx_reader.SIGNAL_PARAS)
    assert read_table_place({PLACE_SIGNAL: {"row": 2, "col": 1, "para": 1}}) == (2, 1, 1)
    assert read_table_place({}) is None and read_table_place(None) is None
    # 문단 시작 자리는 문단이 둘 이상일 때만 남는다 — 없으면 문단 하나
    assert find_anchor_offset("가\n나", {PARAS_SIGNAL: [0, 2]}, 1) == 2
    assert find_anchor_offset("가\n나", {PARAS_SIGNAL: [0, 2]}, 2) == 3
    assert find_anchor_offset("가나", None, 0) == 0
    assert find_anchor_offset("가나", None, 1) == 2


def test_view_places_each_inner_table_at_its_paragraph_in_the_outer_cell(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)

    view = get_view(client, bundle_id, doc_id)

    tables = view["tables"]
    assert [table["is_band"] for table in tables] == [False, True, False, False, True, False]
    assert tables[0]["anchor"] is None and tables[3]["anchor"] is None  # 바깥 표
    limit_cell = _cell_block(view, 0, 2, 1)
    assert limit_cell["text"] == f"{LIMIT_BEFORE}\n{LIMIT_AFTER}"
    # 값 표는 칸의 둘째 문단 앞, 띠 표 · 권한 표는 칸 맨 앞
    assert tables[2]["anchor"] == {"block_id": limit_cell["id"], "at": len(LIMIT_BEFORE) + 1}
    assert tables[1]["anchor"] == {"block_id": _cell_block(view, 0, 0, 0)["id"], "at": 0}
    assert tables[5]["anchor"] == {"block_id": _cell_block(view, 3, 2, 1)["id"], "at": 0}


def test_unwrapping_the_outer_table_makes_inner_bands_headings_and_leaves_inner_tables_whole(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    before = get_view(client, bundle_id, doc_id)
    assert _table_unit(before, 1) is not None  # 데이터 표 안의 띠 표는 바깥을 벗길 때까지 표다

    _unwrap(client, bundle_id, doc_id, 0)

    view = get_view(client, bundle_id, doc_id)
    assert [table["is_layout"] for table in view["tables"]] == [True, True, False, False, False, False]
    heading = find_unit(view, f"7.1\n{DAILY}")
    assert (heading["kind"], heading["number"]["value"]) == ("heading", "7.1")
    assert _table_unit(view, 1) is None
    assert _table_unit(view, 2) is not None  # 값 표는 다시 보통 표 한 줄
    assert _lines(view, 0) == ["점검 항목", *CHECK, "기준", LIMIT_BEFORE, LIMIT_AFTER]
    assert _table_unit(view, 3) is not None and _table_unit(view, 4) is not None  # 다른 작업 표는 그대로(같은 꼴 함께 벗기기 없음)
    assert _coverage_problems(before) == _coverage_problems(view) == []

    _step(client, bundle_id, doc_id, "undo")  # 안쪽 띠 표까지 한 편집

    undone = get_view(client, bundle_id, doc_id)
    assert [table["is_layout"] for table in undone["tables"]] == [False] * 6
    assert sorted(unit["id"] for unit in undone["units"]) == sorted(unit["id"] for unit in before["units"])


def test_an_inner_table_unwraps_again_and_back_to_table_wraps_only_the_pressed_layer(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    before = get_view(client, bundle_id, doc_id)
    _unwrap(client, bundle_id, doc_id, 3)

    _unwrap(client, bundle_id, doc_id, 5)  # 안쪽 권한 표도 같은 표 벗기기

    view = get_view(client, bundle_id, doc_id)
    access_lines = ["권한 레벨", "할 수 있는 일", "관리자", ADMIN, "작업자", WORKER]
    assert _lines(view, 5) == access_lines
    assert _lines(view, 3) == ["권한 부여", GRANT, "권한 표"]
    assert _coverage_problems(view) == []

    assert _set_layout(client, bundle_id, doc_id, 3, False).status_code == 200  # 바깥만 다시 표로

    view = get_view(client, bundle_id, doc_id)
    assert [table["is_layout"] for table in view["tables"]] == [False, False, False, False, False, True]
    assert _lines(view, 5) == access_lines  # 누르지 않은 안쪽 표는 벗긴 그대로
    assert _table_unit(view, 4) is not None  # 바깥과 함께 제목 줄이 된 띠 표는 함께 표로
    assert _coverage_problems(view) == []

    assert _set_layout(client, bundle_id, doc_id, 5, False).status_code == 200

    view = get_view(client, bundle_id, doc_id)
    assert [table["is_layout"] for table in view["tables"]] == [False] * 6
    assert len([unit for unit in view["units"] if unit["kind"] == "table"]) == len(
        [unit for unit in before["units"] if unit["kind"] == "table"]
    )
    assert _coverage_problems(view) == []


def test_back_to_table_asks_first_when_an_inner_band_heading_is_assigned(client: TestClient) -> None:
    bundle_id, sop_id, doc_id = _setup(client)
    _unwrap(client, bundle_id, doc_id, 3)
    heading = find_unit(get_view(client, bundle_id, doc_id), f"7.2\n{ACCESS}")
    target = {
        "key": "h", "kind": "slot_heading", "target_doc_id": sop_id, "slot_key": "procedures.p1",
        "source_unit_ids": [heading["id"]],
    }
    saved = save_group(client, bundle_id, _body([_unit_in(heading)], [target]))
    assert saved.status_code == 200, saved.text

    refused = _set_layout(client, bundle_id, doc_id, 3, False)

    assert refused.status_code == 409
    assert refused.json()["detail"] == {"code": "confirm_required", "unit_ids": [heading["id"]]}
    assert _set_layout(client, bundle_id, doc_id, 3, False, confirm=True).status_code == 200
    assert _table_unit(get_view(client, bundle_id, doc_id), 4)["status"] == "unassigned"


def test_output_a_locates_inner_table_lines_from_the_outside_in(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    _unwrap(client, bundle_id, doc_id, 0)
    _unwrap(client, bundle_id, doc_id, 3)
    _unwrap(client, bundle_id, doc_id, 5)
    view = get_view(client, bundle_id, doc_id)

    ko, en = (
        {row["unit_id"]: row["location"]["place"] for row in _get_output_a(client, bundle_id, lang)}
        for lang in ("ko", "en")
    )

    admin = find_unit(view, "관리자")["id"]
    # 안쪽 표도 문서 안 표 순번을 그대로 쓰고, 바깥 칸부터 적는다(§11-6)
    assert ko[admin] == "표 4 · 3행 2열 › 표 6 · 2행 1열"
    assert en[admin] == "Table 4 · R 3 C 2 › Table 6 · R 2 C 1"
    assert ko[_table_unit(view, 2)["id"]] == "표 1 · 3행 2열 › 표 3"  # 벗기지 않은 안쪽 값 표 한 줄
    assert ko[find_unit(view, f"7.2\n{ACCESS}")["id"]] == "표 4 · 1행 1열 › 띠 표"
    assert ko[find_unit(view, CHECK[0])["id"]] == "표 1 · 2행 2열"  # 바깥 표의 줄은 지금 꼴 그대로


def _get_output_a(client: TestClient, bundle_id: int, lang: str) -> list[dict]:
    response = client.get(f"/api/bundles/{bundle_id}/outputs/a", params={"lang": lang}, headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _reorder(client: TestClient, bundle_id: int, doc_id: int, table_index: int, unit_ids: list[int]) -> httpx2.Response:
    view = get_view(client, bundle_id, doc_id)
    body = {
        "revision": view["document"]["revision"],
        "op": {"type": "reorder_unwrapped", "table_id": view["tables"][table_index]["id"], "unit_ids": unit_ids},
    }
    return client.post(f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json=body, headers=AUTHOR)


def test_an_unwrapped_block_holds_its_band_heading_and_inner_tables_but_not_an_unwrapped_inner_table(client: TestClient) -> None:
    # 덩이(설계 2026-11-20-assign-mockup2 D2) = 칸 줄 + 아직 표인 안쪽 표(표 단위) + 안쪽 띠 표의 제목 줄. 벗긴 안쪽 표의 줄은 제 덩이다
    bundle_id, _, doc_id = _setup(client)
    _unwrap(client, bundle_id, doc_id, 0)
    _unwrap(client, bundle_id, doc_id, 3)
    _unwrap(client, bundle_id, doc_id, 5)
    view = get_view(client, bundle_id, doc_id)
    first = [find_unit(view, f"7.1\n{DAILY}")["id"], *(find_unit(view, text)["id"] for text in ["점검 항목", *CHECK, "기준", LIMIT_BEFORE]),
             _table_unit(view, 2)["id"], find_unit(view, LIMIT_AFTER)["id"]]
    second = [find_unit(view, text)["id"] for text in [f"7.2\n{ACCESS}", "권한 부여", GRANT, "권한 표"]]

    refused = [_reorder(client, bundle_id, doc_id, index, [lines[0]]) for index, lines in ((0, first), (3, second))]

    assert [response.json()["detail"]["code"] for response in refused] == ["unwrap_lines_mismatch"] * 2
    assert [sorted(response.json()["detail"]["unit_ids"]) for response in refused] == [sorted(first), sorted(second)]

    # 안쪽 값 표를 맨 위로 — 표 단위 하나가 한 줄로 움직인다
    value_table = _table_unit(view, 2)["id"]
    moved = [value_table, *(unit_id for unit_id in refused[0].json()["detail"]["unit_ids"] if unit_id != value_table)]
    response = _reorder(client, bundle_id, doc_id, 0, moved)

    assert response.status_code == 200, response.text
    assert next(unit for unit in get_view(client, bundle_id, doc_id)["units"] if unit["id"] == value_table)["unwrap_seq"] == 0
