"""캡션 자리(표 풀기·표준화 명세 F7) — 캡션 꼴 일곱 가지: ① 앞 문단 캡션 ② 한 줄 한/영 ③ 표 첫 행 ④ 두 칸 떨어진 캡션
⑤ 캡션으로 잘못 잡힌 문장 ⑥ 그림 둘에 캡션 하나 ⑦ 캡션 없음. 손잡이마다 커버리지는 그대로이고 되돌리기·다시 하기로 오간다."""

from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.sop.caption_slot import PlaceBlock, build_block_places, get_place_distance
from app.sop.constants import COVER_KINDS
from app.sop.coverage import find_coverage_problems
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, p, tbl
from tests.sop_helpers import (
    AUTHOR,
    assign_as_is,
    build_as_is_targets,
    create_bundle,
    find_unit,
    get_group_by_unit,
    get_view,
    put_tobe,
    save_group,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-9_Captions.docx"
TOBE_DOCS = [{"code": "SOP-CFM", "title": "Synthetic captions", "doc_type": "sop", "parent_code": None}]
HEADING = "1. 목적"
FAR_CAPTION = "표 3. 소모품 목록"
NOTE = "이 표는 참고용이다."
AFTER = "합성 표 뒤 문장이다."
FIRST_ROW = "표 2. 경보 목록"
PAIR_CAPTION = "표 5. 경보 목록 Table 5. Alarm list"
FIGURE_CAPTION = "그림 1. 펌프 구조"
CELL = "합성 칸이다."


class Fixture(NamedTuple):
    bundle_id: int
    sop_id: int
    doc_id: int
    view: dict


def _setup(client: TestClient, body: str, media: dict[str, bytes] | None = None) -> Fixture:
    bundle = create_bundle(client, is_synthetic=True)
    tobe = put_tobe(client, bundle["id"], TOBE_DOCS)
    assert tobe.status_code == 200, tobe.text
    data = build_docx(body) if media is None else build_docx(body, media=media)
    response = upload(client, bundle["id"], data, OLD_NAME)
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    doc_id = response.json()["id"]
    return Fixture(bundle["id"], tobe.json()["docs"][0]["id"], doc_id, get_view(client, bundle["id"], doc_id))


def _edit(client: TestClient, fx: Fixture, op: dict, *, confirm: bool = False) -> httpx2.Response:
    revision = get_view(client, fx.bundle_id, fx.doc_id)["document"]["revision"]
    return client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits",
        json={"revision": revision, "confirm": confirm, "op": op}, headers=AUTHOR,
    )


def _step(client: TestClient, fx: Fixture, action: str) -> dict:
    revision = get_view(client, fx.bundle_id, fx.doc_id)["document"]["revision"]
    response = client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits/{action}",
        json={"revision": revision, "confirm": False}, headers=AUTHOR,
    )
    return _ok(response)


def _ok(response: httpx2.Response) -> dict:
    assert response.status_code == 200, response.text
    return response.json()


def _code(response: httpx2.Response) -> tuple[int, str]:
    return response.status_code, response.json()["detail"]["code"]


def _view(client: TestClient, fx: Fixture) -> dict:
    return get_view(client, fx.bundle_id, fx.doc_id)


def _units(view: dict, kind: str) -> list[dict]:
    return [unit for unit in view["units"] if unit["kind"] == kind]


def _assert_covered(view: dict) -> None:
    """커버리지 불변식 — 보이는 글자를 빠짐없이, 겹침 없이 덮는다."""
    block_texts = {block["id"]: block["text"] for block in view["blocks"]}
    spans = [[tuple(span) for span in unit["spans"]] for unit in view["units"] if unit["kind"] in COVER_KINDS]
    assert find_coverage_problems(block_texts, spans) == []


def _attach(client: TestClient, fx: Fixture, unit: dict, bundle: dict) -> httpx2.Response:
    return _edit(client, fx, {"type": "attach_caption", "unit_id": unit["id"], "bundle_unit_id": bundle["id"]})


def _confirm_without_caption(client: TestClient, fx: Fixture, unit: dict) -> httpx2.Response:
    """그 묶음을 캡션 새 문장 없이 원문 그대로 확정해 본다."""
    targets, _ = build_as_is_targets(client, fx.bundle_id, unit, fx.sop_id, slot_key="purpose")
    entry = next(member for member in get_group_by_unit(client, fx.bundle_id, unit["id"])["units"] if member["unit_id"] == unit["id"])
    body = {
        "action": "confirm", "targets": targets,
        "units": [{"unit_id": unit["id"], "revision": entry["decision"]["revision"], "disposition": "assigned"}],
    }
    return save_group(client, fx.bundle_id, body)


# ── 블록 자리(순수) ───────────────────────────────────────────────────────────


def test_block_places_count_tables_once_and_skip_empty_paragraphs() -> None:
    """프런트 caption-slot-model.test.ts와 같은 사례 — 표 칸(안쪽 표 포함)은 바깥 표 한 자리, 빈 문단은 자리가 없다."""
    blocks = [
        PlaceBlock(1, 0, "paragraph", FAR_CAPTION, None),
        PlaceBlock(2, 1, "paragraph", "  ", None),
        PlaceBlock(3, 2, "paragraph", NOTE, None),
        PlaceBlock(4, 3, "table_cell", "a", 10),
        PlaceBlock(5, 4, "table_cell", "b", 11),  # 칸 안 표
        PlaceBlock(6, 5, "table_cell", "c", 10),
        PlaceBlock(7, 6, "figure", "", None),
        PlaceBlock(8, 7, "table_cell", "d", 12),
    ]
    places = build_block_places(blocks, {10: None, 11: 10, 12: None})

    assert places == {1: 0, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 8: 4}
    assert get_place_distance(places, [1], [4, 5, 6]) == 2
    assert get_place_distance(places, [2], [4]) is None


# ── ① 앞 문단 캡션 · ⑤ 문장 같은 캡션 ─────────────────────────────────────────


def test_preceding_caption_is_attached_and_a_sentence_like_caption_detaches(client: TestClient) -> None:
    long_caption = "표 4. 이 표는 설비마다 점검 주기를 정한 것으로 모든 설비를 매월 한 번씩 확인하고 결과를 남겨야 한다."
    fx = _setup(client, p(HEADING) + p(long_caption, "Caption") + tbl([[CELL]]))
    (table,) = _units(fx.view, "table")
    caption = find_unit(fx.view, long_caption)
    assert (caption["kind"], caption["group_unit_id"]) == ("caption", table["id"])

    _ok(_edit(client, fx, {"type": "detach_caption", "unit_id": caption["id"]}))

    sentence = find_unit(_view(client, fx), long_caption)
    assert (sentence["kind"], sentence["group_unit_id"], sentence["spans"]) == ("sentence", None, caption["spans"])
    _assert_covered(_view(client, fx))


# ── ② 한 줄 한/영 ─────────────────────────────────────────────────────────────


def test_one_line_korean_english_caption_splits_into_two_chips(client: TestClient) -> None:
    fx = _setup(client, p(HEADING) + p(PAIR_CAPTION, "Caption") + tbl([[CELL]]))
    (table,) = _units(fx.view, "table")
    caption = find_unit(fx.view, PAIR_CAPTION)

    _ok(_edit(client, fx, {"type": "split", "unit_id": caption["id"], "at": PAIR_CAPTION.index("Table")}))

    pieces = [unit for unit in _units(_view(client, fx), "caption") if unit["group_unit_id"] == table["id"]]
    assert sorted(unit["lang"] for unit in pieces) == ["en", "ko"]
    _assert_covered(_view(client, fx))


# ── ③ 표 첫 행 ────────────────────────────────────────────────────────────────


def test_first_row_becomes_the_caption_and_goes_back(client: TestClient) -> None:
    fx = _setup(client, p(HEADING) + tbl([[FIRST_ROW], [CELL]]) + p(AFTER))
    (table,) = _units(fx.view, "table")
    row_cell = find_unit(fx.view, FIRST_ROW)
    assert (row_cell["kind"], row_cell["group_unit_id"]) == ("cell_sentence", table["id"])
    op = {"type": "set_first_row_caption", "table_unit_id": table["id"], "caption": True}

    lifted = _ok(_edit(client, fx, op))

    caption = find_unit(_view(client, fx), FIRST_ROW)
    assert (caption["kind"], caption["group_unit_id"], caption["spans"]) == ("caption", table["id"], row_cell["spans"])
    assert lifted["retired_unit_ids"] == [row_cell["id"]]
    assert find_unit(_view(client, fx), CELL)["kind"] == "cell_sentence"  # 다른 행은 그대로 표 칸이다
    _assert_covered(_view(client, fx))
    # Ctrl+Z · 다시 하기는 같은 단위 ID로 오간다
    _step(client, fx, "undo")
    assert (find_unit(_view(client, fx), FIRST_ROW)["id"], find_unit(_view(client, fx), FIRST_ROW)["kind"]) == (row_cell["id"], "cell_sentence")
    _step(client, fx, "redo")
    assert find_unit(_view(client, fx), FIRST_ROW)["id"] == caption["id"]

    back = _ok(_edit(client, fx, {**op, "caption": False}))

    cell = find_unit(_view(client, fx), FIRST_ROW)
    assert (cell["kind"], cell["group_unit_id"], cell["row_index"]) == ("cell_sentence", table["id"], 0)
    assert back["retired_unit_ids"] == [caption["id"]]
    _assert_covered(_view(client, fx))


def test_a_lifted_first_row_caption_detaches_into_its_cell_and_unwraps_as_a_cell_line(client: TestClient) -> None:
    fx = _setup(client, p(HEADING) + tbl([[FIRST_ROW], [CELL]]))
    (table,) = _units(fx.view, "table")
    _ok(_edit(client, fx, {"type": "set_first_row_caption", "table_unit_id": table["id"], "caption": True}))
    caption = find_unit(_view(client, fx), FIRST_ROW)

    _ok(_edit(client, fx, {"type": "detach_caption", "unit_id": caption["id"]}))

    assert find_unit(_view(client, fx), FIRST_ROW)["kind"] == "cell_sentence"
    _step(client, fx, "undo")
    _ok(_edit(client, fx, {"type": "set_layout_table", "table_id": table["table_id"], "is_layout": True}))
    freed = find_unit(_view(client, fx), FIRST_ROW)
    assert (freed["kind"], freed["group_unit_id"], freed["table_id"]) == ("cell_sentence", None, table["table_id"])
    _assert_covered(_view(client, fx))


CELL_CAPTION = "표 1. 조제 탱크별 대상 장치"


def _setup_cell_caption(client: TestClient) -> tuple[Fixture, dict, dict]:
    """실사례 꼴(§6-1) — 바깥 표 1×2(왼쪽 "1", 오른쪽 작업 칸) 안에 "표 1." 줄 → 안쪽 표 → 빈 줄 → 본문. (바깥 표, 안쪽 표) 단위."""
    work = p("필요한 가스켓을 설치한다.") + p(CELL_CAPTION) + tbl([["탱크", "대상 장치"], ["A", "교반기"]]) + p("") + p("이 절차는 탱크 A–C에 적용한다.")
    outer_xml = (
        '<w:tbl><w:tblGrid><w:gridCol w:w="800"/><w:gridCol w:w="8000"/></w:tblGrid>'
        f"<w:tr><w:tc>{p('1')}</w:tc><w:tc>{work}</w:tc></w:tr></w:tbl>"
    )
    fx = _setup(client, p(HEADING) + outer_xml)
    outer, inner = sorted(_units(fx.view, "table"), key=lambda unit: unit["pos_seq"])
    return fx, outer, inner


def test_a_caption_line_inside_a_cell_becomes_the_inner_tables_caption(client: TestClient) -> None:
    fx, _, inner = _setup_cell_caption(client)

    caption = find_unit(fx.view, CELL_CAPTION)

    assert (caption["kind"], caption["group_unit_id"], caption["table_id"]) == ("caption", inner["id"], None)
    assert find_unit(fx.view, "필요한 가스켓을 설치한다.")["kind"] == "cell_sentence"
    _assert_covered(fx.view)


def test_a_cell_caption_goes_back_to_the_outer_cell_when_detached_or_its_table_unwraps(client: TestClient) -> None:
    fx, outer, inner = _setup_cell_caption(client)
    caption = find_unit(fx.view, CELL_CAPTION)
    outer_line = ("cell_sentence", outer["id"], outer["table_id"])

    _ok(_edit(client, fx, {"type": "detach_caption", "unit_id": caption["id"]}))
    freed = find_unit(_view(client, fx), CELL_CAPTION)
    assert (freed["kind"], freed["group_unit_id"], freed["table_id"]) == outer_line  # 안쪽 표의 칸이 아니라 바깥 칸 줄
    _step(client, fx, "undo")

    _ok(_edit(client, fx, {"type": "set_layout_table", "table_id": inner["table_id"], "is_layout": True}))
    freed = find_unit(_view(client, fx), CELL_CAPTION)
    assert (freed["kind"], freed["group_unit_id"], freed["table_id"]) == outer_line
    _step(client, fx, "undo")

    # 안쪽 표의 "첫 행 내림"은 바깥 칸 캡션을 첫 행으로 보지 않는다
    lowered = _ok(_edit(client, fx, {"type": "set_first_row_caption", "table_unit_id": inner["id"], "caption": False}))
    assert lowered["retired_unit_ids"] == []

    # 바깥 표를 벗겨도 안쪽 표의 캡션이고, 떼면 묶이지 않은 바깥 칸 줄이다
    _ok(_edit(client, fx, {"type": "set_layout_table", "table_id": outer["table_id"], "is_layout": True}))
    caption = find_unit(_view(client, fx), CELL_CAPTION)
    assert (caption["kind"], caption["group_unit_id"]) == ("caption", inner["id"])
    _ok(_edit(client, fx, {"type": "detach_caption", "unit_id": caption["id"]}))
    freed = find_unit(_view(client, fx), CELL_CAPTION)
    assert (freed["kind"], freed["group_unit_id"], freed["table_id"]) == ("cell_sentence", None, outer["table_id"])
    _assert_covered(_view(client, fx))


def test_a_table_confirms_with_its_lifted_first_row_caption(client: TestClient) -> None:
    fx = _setup(client, p(HEADING) + tbl([[FIRST_ROW], [CELL]]))
    (table,) = _units(fx.view, "table")
    _ok(_edit(client, fx, {"type": "set_first_row_caption", "table_unit_id": table["id"], "caption": True}))

    group = assign_as_is(client, fx.bundle_id, table, fx.sop_id, slot_key="purpose")

    captions = [target for target in group["targets"] if target["parent_target_id"] is not None and target["cell_row"] is None]
    assert [target["confirmed_text"] for target in captions] == [FIRST_ROW]


@pytest.mark.parametrize(
    ("rows", "code"),
    [([["부품", "번호"], [CELL, "1"]], "caption_exists"), ([[FIRST_ROW]], "empty_table")],
)
def test_first_row_refuses_two_lines_in_one_language_and_a_one_row_table(client: TestClient, rows: list, code: str) -> None:
    fx = _setup(client, p(HEADING) + tbl(rows))
    (table,) = _units(fx.view, "table")

    response = _edit(client, fx, {"type": "set_first_row_caption", "table_unit_id": table["id"], "caption": True})

    assert _code(response) == (422, code)


# ── ④ 두 칸 떨어진 캡션 ───────────────────────────────────────────────────────


def test_a_caption_two_blocks_above_attaches_and_the_paragraph_between_stays(client: TestClient) -> None:
    """빈 문단은 세지 않는다 — 캡션 꼴 문단과 표 사이에 빈 문단과 참고 문단이 있어도 두 칸이다."""
    fx = _setup(client, p(HEADING) + p(FAR_CAPTION) + p("") + p(NOTE) + tbl([[CELL]]) + p(AFTER))
    (table,) = _units(fx.view, "table")
    far, note = find_unit(fx.view, FAR_CAPTION), find_unit(fx.view, NOTE)
    assert far["kind"] == "sentence"  # 저절로 붙는 것은 바로 이웃뿐이다

    result = _ok(_attach(client, fx, far, table))

    view = _view(client, fx)
    caption = find_unit(view, FAR_CAPTION)
    assert (caption["kind"], caption["group_unit_id"]) == ("caption", table["id"])
    assert result["retired_unit_ids"] == [far["id"]]
    assert find_unit(view, NOTE) == {**note, "status": find_unit(view, NOTE)["status"]}  # 사이 문단은 그대로
    _assert_covered(view)
    _step(client, fx, "undo")
    assert find_unit(_view(client, fx), FAR_CAPTION)["id"] == far["id"]


def test_a_caption_three_blocks_away_is_too_far(client: TestClient) -> None:
    fx = _setup(client, p(HEADING) + p(FAR_CAPTION) + p(NOTE) + p(AFTER) + tbl([[CELL]]))
    (table,) = _units(fx.view, "table")

    assert _code(_attach(client, fx, find_unit(fx.view, FAR_CAPTION), table)) == (422, "caption_not_adjacent")


# ── ⑥ 그림 둘에 캡션 하나 ─────────────────────────────────────────────────────


def _setup_two_figures(client: TestClient) -> tuple[Fixture, dict, dict, dict]:
    """그림 둘 뒤에 캡션 하나 — 올릴 때 캡션은 바로 앞의 둘째 그림에 붙는다."""
    figure = f"<w:p>{make_drawing_run('image1.png')}</w:p>"
    fx = _setup(client, p(HEADING) + figure + figure + p(FIGURE_CAPTION, "Caption") + p(AFTER), {"image1.png": TINY_PNG})
    first, second = sorted(_units(fx.view, "figure"), key=lambda unit: unit["pos_seq"])
    caption = find_unit(fx.view, FIGURE_CAPTION)
    assert caption["group_unit_id"] == second["id"]
    return fx, first, second, caption


def test_two_figures_share_one_caption_kept_on_the_first(client: TestClient) -> None:
    fx, first, second, caption = _setup_two_figures(client)
    assert _code(_confirm_without_caption(client, fx, first)) == (422, "caption_required")  # ⑦ 캡션 없는 그림은 막는다

    _ok(_edit(client, fx, {"type": "group_figures", "unit_ids": [second["id"], first["id"]]}))

    view = _view(client, fx)
    units = {unit["id"]: unit for unit in view["units"]}
    assert (units[first["id"]]["caption_figure_id"], units[second["id"]]["caption_figure_id"]) == (None, first["id"])
    assert units[caption["id"]]["group_unit_id"] == first["id"]  # 캡션은 첫 그림으로 옮겨 간다(단위 그대로)
    _assert_covered(view)
    assert _code(_attach(client, fx, find_unit(view, AFTER), units[second["id"]])) == (422, "caption_shared")
    # 같이 쓰는 그림은 제 캡션 새 문장 없이 확정된다
    _ok(_confirm_without_caption(client, fx, units[second["id"]]))


def test_figure_group_undo_redo_and_ungroup(client: TestClient) -> None:
    fx, first, second, caption = _setup_two_figures(client)
    _ok(_edit(client, fx, {"type": "group_figures", "unit_ids": [first["id"], second["id"]]}))

    _step(client, fx, "undo")
    units = {unit["id"]: unit for unit in _view(client, fx)["units"]}
    assert (units[second["id"]]["caption_figure_id"], units[caption["id"]]["group_unit_id"]) == (None, second["id"])
    _step(client, fx, "redo")
    units = {unit["id"]: unit for unit in _view(client, fx)["units"]}
    assert (units[second["id"]]["caption_figure_id"], units[caption["id"]]["group_unit_id"]) == (first["id"], first["id"])

    _ok(_edit(client, fx, {"type": "ungroup_figures", "unit_id": second["id"]}))

    units = {unit["id"]: unit for unit in _view(client, fx)["units"]}
    assert (units[second["id"]]["caption_figure_id"], units[caption["id"]]["group_unit_id"]) == (None, first["id"])
    _step(client, fx, "undo")
    assert {unit["id"]: unit for unit in _view(client, fx)["units"]}[second["id"]]["caption_figure_id"] == first["id"]


def test_group_figures_refuses_non_figures(client: TestClient) -> None:
    fx, first, _, caption = _setup_two_figures(client)

    assert _code(_edit(client, fx, {"type": "group_figures", "unit_ids": [first["id"], caption["id"]]})) == (
        422, "invalid_unit_kind",
    )
