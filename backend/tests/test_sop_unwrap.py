"""표 벗기기(MD 1 F1 · F3 · F11의 표 부분) — 풀린 표의 칸 줄, 번호만 든 칸은 같은 행 첫 줄의 번호, 다시 표로(배정 확인), 되돌리기,
커버리지, 결과물 A 위치와 요약의 "풀린 표에서 온 줄". 자료는 표형 옛 SOP(명세 §7 사례 1)를 본뜬 합성 문서다."""

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.sop.constants import COVER_KINDS
from app.sop.coverage import find_coverage_problems
from tests.docx_factory import build_docx, make_grid_table, make_row, p
from tests.sop_helpers import AUTHOR, assign_as_is, create_bundle, find_unit, get_view, put_tobe, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_SYN-UNWRAP-1_Tables.docx"
TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]
INTRO = "이 절은 여과 장치의 일상 관리를 다룬다."
HEADS = ["단위 업무", "세부 업무 내용"]
PREP = ["보호 장갑과 보안경을 착용한다.", "교체용 필터의 유효 기간을 확인한다."]
SWAP = ["장치를 멈추고 압력이 0 bar인지 확인한다.", "필터를 시계 반대 방향으로 돌려 뺀다.", "새 필터를 끼우고 기록지에 적는다."]
STEP_A, STEP_A1 = "필터 차압이 0.8 bar를 넘으면 교체한다.", "교체 기록을 남긴다."
# 작업 표(2열 · 왼쪽 라벨, 칸 안 문단마다 줄) → 값 표(벗기지 않는다) → 단계 표(번호 칸 A · A-1, 내용이 빈 행의 7)
WORK_TABLE = make_grid_table(2, (
    make_row(HEADS, header=True)
    + make_row(["준비", "".join(p(text) for text in PREP)])
    + make_row(["교체", "".join(p(text) for text in SWAP)])
), widths=[1588, 8050])
VALUE_TABLE = make_grid_table(2, make_row(["항목", "값"]) + make_row(["구멍 크기", "0.2 µm"]))
STEP_TABLE = make_grid_table(2, make_row(["A", STEP_A]) + make_row(["A-1", STEP_A1]) + make_row(["7", ""]))
BODY = p("필터 교체", "Heading1") + p(INTRO) + WORK_TABLE + p("필터 사양은 표 2를 따른다.") + VALUE_TABLE + STEP_TABLE


def _setup(client: TestClient) -> tuple[int, int, int]:
    """(묶음, 새 SOP, 옛 문서)."""
    bundle = create_bundle(client, is_synthetic=True)
    tobe = put_tobe(client, bundle["id"], TOBE_DOCS)
    assert tobe.status_code == 200, tobe.text
    response = upload(client, bundle["id"], build_docx(BODY), OLD_NAME)
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    return bundle["id"], tobe.json()["docs"][0]["id"], response.json()["id"]


def _edit(client: TestClient, bundle_id: int, doc_id: int, op: dict, *, confirm: bool = False) -> httpx2.Response:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    body = {"revision": revision, "confirm": confirm, "op": op}
    return client.post(f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json=body, headers=AUTHOR)


def _set_layout(client: TestClient, bundle_id: int, doc_id: int, table_index: int, is_layout: bool, **kwargs: bool) -> httpx2.Response:
    table = get_view(client, bundle_id, doc_id)["tables"][table_index]
    return _edit(client, bundle_id, doc_id, {"type": "set_layout_table", "table_id": table["id"], "is_layout": is_layout}, **kwargs)


def _unwrap(client: TestClient, bundle_id: int, doc_id: int, table_index: int) -> None:
    response = _set_layout(client, bundle_id, doc_id, table_index, True)
    assert response.status_code == 200, response.text


def _table_lines(view: dict, table_index: int) -> list[dict]:
    """그 표의 칸 줄(묶이지 않은 칸 문장) — 원문 순."""
    table_id = view["tables"][table_index]["id"]
    return [unit for unit in view["units"] if unit["kind"] == "cell_sentence" and unit["table_id"] == table_id and unit["group_unit_id"] is None]


def _table_units(view: dict) -> list[dict]:
    return [unit for unit in view["units"] if unit["kind"] == "table"]


def _coverage_problems(view: dict) -> list[str]:
    block_texts = {block["id"]: block["text"] for block in view["blocks"]}
    return find_coverage_problems(
        block_texts, [[tuple(span) for span in unit["spans"]] for unit in view["units"] if unit["kind"] in COVER_KINDS]
    )


def _step(client: TestClient, bundle_id: int, doc_id: int, action: str) -> None:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits/{action}", json={"revision": revision}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text


def _get(client: TestClient, bundle_id: int, path: str, lang: str = "ko") -> object:
    response = client.get(f"/api/bundles/{bundle_id}/{path}", params={"lang": lang}, headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def test_unwrapping_turns_one_table_line_into_a_line_per_cell_and_sentence(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    before = get_view(client, bundle_id, doc_id)
    assert len(_table_units(before)) == 3  # 표마다 한 줄
    assert _table_lines(before, 0) == []

    _unwrap(client, bundle_id, doc_id, 0)

    view = get_view(client, bundle_id, doc_id)
    # 머리 행 칸 · 라벨 칸도 제 줄이고, 칸 안 문단마다 한 줄 — 읽는 순서는 행 → 왼쪽부터
    assert [unit["text"] for unit in _table_lines(view, 0)] == [*HEADS, "준비", *PREP, "교체", *SWAP]
    assert view["tables"][0]["is_layout"] is True
    assert len(_table_units(view)) == 2  # 값 표 · 단계 표는 그대로 표 한 줄
    assert _coverage_problems(before) == _coverage_problems(view) == []


def test_number_only_cells_become_the_number_of_the_first_line_in_their_row(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)

    _unwrap(client, bundle_id, doc_id, 2)

    view = get_view(client, bundle_id, doc_id)
    lines = _table_lines(view, 2)
    assert [(unit["text"], (unit["number"] or {}).get("value")) for unit in lines] == [
        (f"A\n{STEP_A}", "A"), (f"A-1\n{STEP_A1}", "A-1"), ("7", None),  # 붙을 줄이 없는 번호 칸은 제 줄(§11-7)
    ]
    joined = lines[0]
    assert (joined["number"]["source"], joined["text"][joined["number"]["content_start"]:]) == ("cell", STEP_A)
    assert _coverage_problems(view) == []


def test_unwrapping_is_one_undo_step(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    before = get_view(client, bundle_id, doc_id)
    _unwrap(client, bundle_id, doc_id, 2)

    _step(client, bundle_id, doc_id, "undo")

    view = get_view(client, bundle_id, doc_id)
    assert view["tables"][2]["is_layout"] is False
    assert sorted(unit["id"] for unit in view["units"]) == sorted(unit["id"] for unit in before["units"])
    assert {unit["id"]: unit["group_unit_id"] for unit in view["units"]} == {
        unit["id"]: unit["group_unit_id"] for unit in before["units"]
    }


def test_back_to_table_asks_once_clears_only_the_table_lines_and_keeps_the_number_line(client: TestClient) -> None:
    bundle_id, sop_id, doc_id = _setup(client)
    _unwrap(client, bundle_id, doc_id, 0)
    _unwrap(client, bundle_id, doc_id, 2)
    view = get_view(client, bundle_id, doc_id)
    cell, outside = find_unit(view, PREP[0]), find_unit(view, INTRO)
    assign_as_is(client, bundle_id, cell, sop_id, slot_key="purpose")
    assign_as_is(client, bundle_id, outside, sop_id, slot_key="purpose")

    refused = _set_layout(client, bundle_id, doc_id, 0, False)

    assert refused.status_code == 409
    assert refused.json()["detail"] == {"code": "confirm_required", "unit_ids": [cell["id"]]}
    assert _set_layout(client, bundle_id, doc_id, 0, False, confirm=True).status_code == 200
    view = get_view(client, bundle_id, doc_id)
    assert view["tables"][0]["is_layout"] is False
    assert find_unit(view, PREP[0])["status"] == "unassigned"
    assert find_unit(view, INTRO)["status"] == "confirmed"  # 표 밖 줄의 배정은 그대로
    # 번호를 받은 줄은 다시 표로 묶어도 한 줄로 묶인다 — 처음 모양은 Ctrl+Z가 돌린다
    assert _set_layout(client, bundle_id, doc_id, 2, False).status_code == 200
    view = get_view(client, bundle_id, doc_id)
    table_unit = next(unit for unit in _table_units(view) if unit["table_id"] == view["tables"][2]["id"])
    assert find_unit(view, f"A\n{STEP_A}")["group_unit_id"] == table_unit["id"]
    assert _coverage_problems(view) == []


def test_output_a_places_unwrapped_lines_by_cell_and_the_summary_counts_them(client: TestClient) -> None:
    bundle_id, sop_id, doc_id = _setup(client)
    _unwrap(client, bundle_id, doc_id, 0)
    _unwrap(client, bundle_id, doc_id, 2)
    view = get_view(client, bundle_id, doc_id)
    assign_as_is(client, bundle_id, find_unit(view, PREP[1]), sop_id, slot_key="purpose")

    ko = {row["unit_id"]: row for row in _get(client, bundle_id, "outputs/a")}
    en = {row["unit_id"]: row for row in _get(client, bundle_id, "outputs/a", "en")}
    summary = _get(client, bundle_id, "summary")

    second = find_unit(view, PREP[1])
    assert ko[second["id"]]["location"]["place"] == "표 1 · 2행 2열"  # 지금 dev 꼴 그대로(§11-6)
    assert en[second["id"]]["location"]["place"] == "Table 1 · R 2 C 2"
    # 번호 칸을 받은 줄은 내용 칸을 가리키고, 원문 칸은 번호를 뺀 내용이다
    joined = ko[find_unit(view, f"A\n{STEP_A}")["id"]]
    assert (joined["location"]["place"], joined["source_text"]) == ("표 3 · 1행 2열", STEP_A)
    assert ko[find_unit(view, "7")["id"]]["location"]["place"] == "표 3 · 3행 1열"
    unwrapped = len(_table_lines(view, 0)) + len(_table_lines(view, 2))
    assert summary["unwrapped_rows"] == unwrapped == 12
    assert summary["old_rows"] == unwrapped + 4  # 제목 · 앞 문장 · 표 2를 가리키는 문장 · 값 표 한 줄
