"""들여쓰기 차이(B8 항목 7) — 편집 set_indents(여러 줄 한 칸 되돌리기) · set_number의 indent_shift · 나누기 물려받기."""

import pytest
from fastapi.testclient import TestClient

from tests.sop_helpers import find_unit, get_view
from tests.test_sop_numbers import BAND, PLAIN, STEP, TYPED, UNREAD, _edit, _setup, _step

pytestmark = pytest.mark.usefixtures("clean_sop")


def _shifts(view: dict) -> dict[str, int]:
    return {unit["text"]: unit["indent_shift"] for unit in view["units"] if unit["number"] is not None}


def _set_indents(client: TestClient, bundle_id: int, doc_id: int, items: list[tuple[dict, int]]) -> dict:
    op = {"type": "set_indents", "units": [{"unit_id": unit["id"], "indent_shift": shift} for unit, shift in items]}
    response = _edit(client, bundle_id, doc_id, op)
    assert response.status_code == 200, response.text
    return response.json()


def test_units_start_with_no_indent_shift(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)

    assert set(_shifts(get_view(client, bundle_id, doc_id)).values()) == {0}


def test_set_indents_moves_several_lines_in_one_undo_step(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)

    _set_indents(client, bundle_id, doc_id, [(find_unit(view, UNREAD), -1), (find_unit(view, PLAIN), 2)])
    moved = _shifts(get_view(client, bundle_id, doc_id))
    _step(client, bundle_id, doc_id, "undo")
    undone = _shifts(get_view(client, bundle_id, doc_id))
    _step(client, bundle_id, doc_id, "redo")
    redone = _shifts(get_view(client, bundle_id, doc_id))

    assert (moved[UNREAD], moved[PLAIN], moved[TYPED]) == (-1, 2, 0)
    assert set(undone.values()) == {0}
    assert redone == moved


def test_set_indents_that_changes_nothing_writes_nothing(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)

    result = _set_indents(client, bundle_id, doc_id, [(find_unit(view, PLAIN), 0)])

    assert result["document_revision"] == view["document"]["revision"]
    assert get_view(client, bundle_id, doc_id)["edits"] == view["edits"]


def test_set_indents_refuses_units_without_a_number_cell_and_out_of_range_values(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    band = find_unit(get_view(client, bundle_id, doc_id), BAND)
    back = _edit(client, bundle_id, doc_id, {"type": "set_layout_table", "table_id": band["table_id"], "is_layout": False})
    assert back.status_code == 200, back.text
    view = get_view(client, bundle_id, doc_id)
    table = next(unit for unit in view["units"] if unit["kind"] == "table")
    plain = find_unit(view, PLAIN)

    refused = _edit(client, bundle_id, doc_id, {"type": "set_indents", "units": [{"unit_id": table["id"], "indent_shift": 1}]})
    too_far = _edit(client, bundle_id, doc_id, {"type": "set_indents", "units": [{"unit_id": plain["id"], "indent_shift": 10}]})
    twice = _edit(client, bundle_id, doc_id, {"type": "set_indents", "units": [
        {"unit_id": plain["id"], "indent_shift": 1}, {"unit_id": plain["id"], "indent_shift": 2},
    ]})

    assert (refused.status_code, refused.json()["detail"]["code"]) == (422, "invalid_unit_kind")
    assert too_far.status_code == 422
    assert twice.status_code == 422


def test_set_number_with_indent_shift_changes_both_in_one_undo_step(client: TestClient) -> None:
    # 기호를 고를 때 위 기호 줄의 단계를 따른다(B8 7-5) — 번호와 들여쓰기가 한 편집
    bundle_id, _, doc_id = _setup(client)
    plain = find_unit(get_view(client, bundle_id, doc_id), PLAIN)

    response = _edit(client, bundle_id, doc_id, {"type": "set_number", "unit_id": plain["id"], "number": "•", "follow": False, "indent_shift": 1})
    assert response.status_code == 200, response.text
    bullet = find_unit(get_view(client, bundle_id, doc_id), PLAIN)
    _step(client, bundle_id, doc_id, "undo")
    undone = find_unit(get_view(client, bundle_id, doc_id), PLAIN)

    assert (bullet["number"]["value"], bullet["indent_shift"]) == ("•", 1)
    assert (undone["number"]["value"], undone["indent_shift"]) == (None, 0)


def test_split_pieces_keep_the_indent_shift(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    step = find_unit(get_view(client, bundle_id, doc_id), STEP)
    _set_indents(client, bundle_id, doc_id, [(step, 1)])

    split = _edit(client, bundle_id, doc_id, {"type": "split", "unit_id": step["id"], "at": len("1.3.1 합성 ")})
    assert split.status_code == 200, split.text
    pieces = {unit["id"]: unit for unit in get_view(client, bundle_id, doc_id)["units"]}

    assert [pieces[unit_id]["indent_shift"] for unit_id in split.json()["created_unit_ids"]] == [1, 1]
