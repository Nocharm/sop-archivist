"""문단 번호(F5) — 추출 신호에서 읽은 번호 범위, 번호 고치기 편집(set_number)과 따라 고치기·되돌리기, 번호를 뺀 내용(새 문장·결과물 A)."""

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.sop.extract import docx_reader
from app.sop.numbering import (
    NUMBER_AUTO,
    NUMBER_TYPED,
    NumberRange,
    get_content_start,
    plan_follow,
    read_number_range,
)
from app.sop.segment import NUMBER_CELL, NUMBERS_SIGNAL, BlockView, TableView, build_unit_drafts
from tests.docx_factory import build_docx, make_list, numbered, p, tbl
from tests.sop_helpers import AUTHOR, assign_as_is, create_bundle, find_unit, get_view, put_tobe, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-4_Numbers.docx"
TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]
LEVELS = [("decimal", "%1"), ("decimal", "%1.%2"), ("decimal", "%1.%2.%3")]
# P-NUM1 꼴 — 셋째 줄의 "1.2"는 1.1.1을 잘못 읽은 번호이고 그 뒤 번호가 하나씩 밀렸다
TOP, CHECK, MISREAD, CHANGE = "1 합성 절차", "1.1 합성 필터 점검", "1.2 합성 필터 확인", "1.3 합성 필터 교체"
STEP, TYPED, UNREAD, PLAIN = "1.3.1 합성 필터를 교체한다.", "2.1 합성 타자 번호 줄이다.", "합성 못 읽은 줄이다.", "합성 보통 문장이다."
TYPED_HEADING = "3. 합성 타자 제목"
BODY = (
    numbered("합성 절차", 1, 0, "Heading1") + numbered("합성 필터 점검", 1, 1, "Heading2")
    + numbered("합성 필터 확인", 1, 1, "Heading2") + p("합성 확인 내용이다.") + numbered("합성 필터 교체", 1, 1, "Heading2")
    + numbered("합성 필터를 교체한다.", 1, 2) + p(TYPED) + numbered(UNREAD, 99) + p(PLAIN)
    + p(TYPED_HEADING, "Heading1")
    + tbl([["7", "", "합성 띠 제목"]])
)


def _setup(client: TestClient) -> tuple[int, int, int]:
    """(묶음, 새 SOP, 옛 문서) — 번호 엉킨 합성 문서 하나."""
    bundle = create_bundle(client, is_synthetic=True)
    tobe = put_tobe(client, bundle["id"], TOBE_DOCS)
    assert tobe.status_code == 200, tobe.text
    response = upload(client, bundle["id"], build_docx(BODY, numbering=make_list(0, LEVELS, [1])), OLD_NAME)
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    return bundle["id"], tobe.json()["docs"][0]["id"], response.json()["id"]


def _edit(client: TestClient, bundle_id: int, doc_id: int, op: dict) -> httpx2.Response:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    return client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json={"revision": revision, "op": op}, headers=AUTHOR
    )


def _set_number(
    client: TestClient, bundle_id: int, doc_id: int, unit: dict, number: str | None, *, follow: bool = True
) -> dict:
    op = {"type": "set_number", "unit_id": unit["id"], "number": number, "follow": follow}
    response = _edit(client, bundle_id, doc_id, op)
    assert response.status_code == 200, response.text
    return response.json()


def _step(client: TestClient, bundle_id: int, doc_id: int, action: str) -> None:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits/{action}", json={"revision": revision}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text


def _numbers(view: dict) -> dict[str, str | None]:
    return {unit["text"]: unit["number"]["value"] for unit in view["units"] if unit["number"] is not None}


def _content(unit: dict) -> str:
    return unit["text"][unit["number"]["content_start"]:]


def _sections(view: dict) -> list[str]:
    return [block["section_label"] for block in view["blocks"] if block["kind"] == "paragraph"]


# --- 순수 계산 ---


def test_signal_names_match_the_extractor() -> None:
    assert (NUMBERS_SIGNAL, NUMBER_CELL) == (docx_reader.SIGNAL_NUMBERS, docx_reader.NUMBER_CELL)
    assert (NUMBER_AUTO, NUMBER_TYPED) == (docx_reader.NUMBER_AUTO, docx_reader.NUMBER_TYPED)


@pytest.mark.parametrize(
    ("numbers", "index", "new", "expected"),
    [
        # 수준이 바뀐 줄은 새 부모로 가고 옛 목록은 당긴다 — 다시 센 줄 아래의 줄은 앞머리만 따라간다
        (["6.1", "6.2", "6.3", "6.3.1", "6.4", "7"], 1, "6.1.1", {2: "6.2", 3: "6.2.1", 4: "6.3"}),
        # 새 부모 아래의 뒤 줄도 차례로 센다
        (["6.1", "6.2", "6.1.1", "6.3"], 1, "6.1.1", {2: "6.1.2", 3: "6.2"}),
        # 같은 수준이면 그 값부터 차례로 — 끝 점은 줄마다 쓰던 그대로, 순번이 줄어든 곳에서 목록이 끝난다
        (["1.", "2.", "2.", "3.", "1."], 2, "3.", {3: "4."}),
        (["6.1", "6.2", "6.2.1", "6.3"], 1, "6.5", {2: "6.5.1", 3: "6.6"}),
        (["A", "B", "C", "A-1"], 0, "B", {1: "C", 2: "D"}),
        # 번호가 없던 줄에 써 넣으면 뒤 줄이 밀린다 — 번호 없는 줄은 건너뛴다
        ([None, "6.1", None, "6.2", "7"], 0, "6.1", {1: "6.2", 3: "6.3"}),
        # 셀 수 없는 꼴은 따라 고치지 않는다
        (["가.", "나."], 0, "다.", {}),
    ],
)
def test_plan_follow(numbers: list[str | None], index: int, new: str, expected: dict[int, str]) -> None:
    assert plan_follow(numbers, index, new) == expected


def test_number_range_reads_the_leading_signal() -> None:
    texts = {1: "6.1 6.1 합성 목적", 2: "7", 3: "합성 제목", 4: "3.", 5: "가\n2.1 합성 줄"}
    signals = {
        1: {NUMBERS_SIGNAL: [[0, 7, "auto"]]}, 2: {NUMBERS_SIGNAL: [[0, 1, "cell"]]},
        4: {NUMBERS_SIGNAL: [[0, 2, "typed"]]}, 5: {NUMBERS_SIGNAL: [[2, 5, "typed"]]},
    }

    assert read_number_range([(1, 0, 13)], signals, texts) == NumberRange("6.1", "auto", 7)  # 타자로 또 친 번호까지 한 번호
    assert read_number_range([(2, 0, 1), (3, 0, 5)], signals, texts) == NumberRange("7", "cell", 1)  # 번호 칸 블록 전체
    assert read_number_range([(2, 0, 1)], signals, texts) is None  # 번호뿐인 단위는 글이다
    assert read_number_range([(4, 0, 2)], signals, texts) is None
    assert read_number_range([(5, 2, 10)], signals, texts) == NumberRange("2.1", "typed", 3)  # 칸 안 둘째 문단
    assert read_number_range([(5, 0, 1)], signals, texts) is None
    assert read_number_range([(3, 0, 5)], {}, texts) is None  # 신호가 없는 옛 추출
    assert get_content_start("6.1 6.1 합성 목적", 7) == 8 and get_content_start("7", 1) == 0


def test_number_cell_joins_the_first_line_of_its_row_in_a_layout_table() -> None:
    def cell(block_id: int, row: int, text: str, *, number: bool = False) -> BlockView:
        signals = {NUMBERS_SIGNAL: [[0, len(text), NUMBER_CELL]]} if number else None
        return BlockView(block_id, block_id, "table_cell", "body", text, None, (), 9, row, signals)

    blocks = [
        cell(1, 0, "7", number=True), cell(2, 0, ""), cell(3, 0, "합성 띠 제목"),
        cell(4, 1, "A", number=True), cell(5, 1, "합성 첫 줄이다. 합성 둘째 줄이다."),
        cell(6, 2, "B", number=True),  # 붙을 줄이 없으면 제 줄
    ]

    layout = build_unit_drafts(blocks, [TableView(9, True)], "ko_only")
    data = build_unit_drafts(blocks, [TableView(9, False)], "ko_only")

    assert [draft.spans for draft in layout] == [
        [(1, 0, 1), (3, 0, 7)], [(4, 0, 1), (5, 0, 9)], [(5, 10, 20)], [(6, 0, 1)],
    ]
    assert [(draft.pos_seq, draft.row_index) for draft in layout] == [(1, 0), (4, 1), (5, 1), (6, 2)]
    # 데이터 표의 칸은 표에 묶인 채 칸마다 제 줄이다
    assert [draft.spans for draft in data if draft.kind == "cell_sentence"] == [
        [(1, 0, 1)], [(3, 0, 7)], [(4, 0, 1)], [(5, 0, 9)], [(5, 10, 20)], [(6, 0, 1)],
    ]


# --- 추출 → 단위 ---


def test_auto_numbers_go_to_the_number_cell_and_typed_numbers_stay_text(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)

    view = get_view(client, bundle_id, doc_id)

    assert view["has_number_ranges"] is True
    misread, typed = find_unit(view, MISREAD), find_unit(view, TYPED)
    assert misread["number"] == {
        "value": "1.2", "read": "1.2", "source": "auto", "is_set": False, "content_start": 4, "typed_len": 0,
    }
    assert _content(misread) == "합성 필터 확인"
    assert typed["number"] == {
        "value": None, "read": "2.1", "source": "typed", "is_set": False, "content_start": 0, "typed_len": 3,
    }
    assert find_unit(view, UNREAD)["number"]["value"] is None
    # 절을 여는 줄(제목)의 타자 번호는 처음부터 번호 칸에 있다 — 본문 줄의 타자 번호만 글로 남는다
    heading = find_unit(view, TYPED_HEADING)
    assert heading["number"] == {
        "value": "3.", "read": "3.", "source": "typed", "is_set": False, "content_start": 3, "typed_len": 0,
    }
    assert _content(heading) == "합성 타자 제목"
    assert next(unit for unit in view["units"] if unit["kind"] == "table")["number"] is None
    # 단위 목록의 줄도 같은 내용 경계를 싣는다 — 배정 화면의 새 문장 초안이 쓴다
    listed = client.get(f"/api/bundles/{bundle_id}/units", params={"document_id": doc_id}, headers=AUTHOR).json()["items"]
    starts = {row["unit_id"]: row["content_start"] for row in listed}
    assert (starts[misread["id"]], starts[typed["id"]]) == (4, 0)


# --- 번호 고치기 ---


def test_fixing_a_misread_number_renumbers_the_list_and_moves_the_sections(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    before = get_view(client, bundle_id, doc_id)
    assert _sections(before)[:6] == ["1", "1.1", "1.2", "1.2", "1.3", "1.3"]

    result = _set_number(client, bundle_id, doc_id, find_unit(before, MISREAD), "1.1.1")

    view = get_view(client, bundle_id, doc_id)
    assert (result["created_unit_ids"], result["retired_unit_ids"]) == ([], [])  # 단위는 그대로다
    numbers = _numbers(view)
    assert (numbers[TOP], numbers[CHECK], numbers[MISREAD], numbers[CHANGE], numbers[STEP]) == (
        "1", "1.1", "1.1.1", "1.2", "1.2.1",
    )
    fixed = find_unit(view, MISREAD)
    assert fixed["id"] == find_unit(before, MISREAD)["id"] and fixed["number"]["is_set"] is True
    assert (fixed["number"]["read"], _content(fixed)) == ("1.2", "합성 필터 확인")  # 원문 글자와 내용 경계는 그대로
    # 제목 번호를 고치면 그 아래 줄의 절이 따라온다
    assert _sections(view)[:6] == ["1", "1.1", "1.1.1", "1.1.1", "1.2", "1.2"]


def test_a_number_fix_is_one_undo_step(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    before = get_view(client, bundle_id, doc_id)
    _set_number(client, bundle_id, doc_id, find_unit(before, MISREAD), "1.1.1")

    _step(client, bundle_id, doc_id, "undo")
    undone = get_view(client, bundle_id, doc_id)
    _step(client, bundle_id, doc_id, "redo")
    redone = get_view(client, bundle_id, doc_id)

    assert (_numbers(undone), _sections(undone)) == (_numbers(before), _sections(before))
    assert [unit["number"] for unit in undone["units"]] == [unit["number"] for unit in before["units"]]
    assert (_numbers(redone)[MISREAD], _numbers(redone)[CHANGE], _sections(redone)[4]) == ("1.1.1", "1.2", "1.2")


def test_fixing_without_follow_changes_only_that_line(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)

    _set_number(client, bundle_id, doc_id, find_unit(view, MISREAD), "1.1.1", follow=False)

    numbers = _numbers(get_view(client, bundle_id, doc_id))
    assert (numbers[MISREAD], numbers[CHANGE], numbers[STEP]) == ("1.1.1", "1.3", "1.3.1")


def test_adding_a_number_to_an_unread_line(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)

    _set_number(client, bundle_id, doc_id, find_unit(view, UNREAD), "2.2", follow=False)

    added = find_unit(get_view(client, bundle_id, doc_id), UNREAD)
    assert added["number"] == {
        "value": "2.2", "read": None, "source": None, "is_set": True, "content_start": 0, "typed_len": 0,
    }


def test_typed_number_becomes_the_number_and_no_number_turns_it_back(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)
    typed = find_unit(view, TYPED)

    _set_number(client, bundle_id, doc_id, typed, typed["number"]["read"], follow=False)
    as_number = find_unit(get_view(client, bundle_id, doc_id), TYPED)
    _set_number(client, bundle_id, doc_id, typed, None)
    as_text = find_unit(get_view(client, bundle_id, doc_id), TYPED)

    assert (as_number["number"]["value"], _content(as_number)) == ("2.1", "합성 타자 번호 줄이다.")
    assert as_number["number"]["typed_len"] == 0
    assert (as_text["number"]["value"], _content(as_text), as_text["number"]["is_set"]) == (None, TYPED, True)


def test_no_number_turns_an_auto_number_back_into_text(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)

    _set_number(client, bundle_id, doc_id, find_unit(view, CHECK), None)

    cleared = find_unit(get_view(client, bundle_id, doc_id), CHECK)
    assert (cleared["number"]["value"], _content(cleared)) == (None, CHECK)


def test_set_number_that_changes_nothing_writes_nothing(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)

    same = _set_number(client, bundle_id, doc_id, find_unit(view, CHECK), "1.1", follow=False)
    none = _set_number(client, bundle_id, doc_id, find_unit(view, PLAIN), None)

    assert same["document_revision"] == none["document_revision"] == view["document"]["revision"]
    assert get_view(client, bundle_id, doc_id)["edits"] == view["edits"]


def test_set_number_refuses_units_without_a_number_cell(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)
    table = next(unit for unit in view["units"] if unit["kind"] == "table")

    refused = _edit(client, bundle_id, doc_id, {"type": "set_number", "unit_id": table["id"], "number": "7"})
    multiline = _edit(
        client, bundle_id, doc_id, {"type": "set_number", "unit_id": find_unit(view, PLAIN)["id"], "number": "1\n2"}
    )

    assert (refused.status_code, refused.json()["detail"]["code"]) == (422, "invalid_unit_kind")
    assert multiline.status_code == 422


# --- 쪼개기 편집과 함께 ---


def test_split_keeps_the_number_on_the_front_piece_and_merge_takes_the_front_number(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)
    step = find_unit(view, STEP)
    _set_number(client, bundle_id, doc_id, step, "1.3.9", follow=False)

    split = _edit(client, bundle_id, doc_id, {"type": "split", "unit_id": step["id"], "at": len("1.3.1 합성 ")})
    assert split.status_code == 200, split.text
    pieces = {unit["id"]: unit for unit in get_view(client, bundle_id, doc_id)["units"]}
    front, back = (pieces[unit_id] for unit_id in split.json()["created_unit_ids"])
    merged = _edit(client, bundle_id, doc_id, {"type": "merge", "unit_ids": [front["id"], back["id"]]})
    assert merged.status_code == 200, merged.text
    again = find_unit(get_view(client, bundle_id, doc_id), STEP)

    assert (front["number"]["value"], front["number"]["read"], _content(front)) == ("1.3.9", "1.3.1", "합성")
    assert (back["number"]["value"], back["number"]["content_start"]) == (None, 0)
    assert (again["number"]["value"], _content(again)) == ("1.3.9", "합성 필터를 교체한다.")


def test_band_table_number_shows_once_after_unwrapping_and_merging(client: TestClient) -> None:
    # 띠 표를 풀면 번호 칸이 같은 행 첫 줄의 번호가 되고(F3), 잘랐다가 다시 합쳐도 번호 칸 블록 전체가 그 줄의 번호 범위다 — "7"이 글에 또 나오지 않는다
    bundle_id, _, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)
    table = next(unit for unit in view["units"] if unit["kind"] == "table")
    unwrap = _edit(
        client, bundle_id, doc_id, {"type": "set_layout_table", "table_id": table["table_id"], "is_layout": True}
    )
    assert unwrap.status_code == 200, unwrap.text
    joined = find_unit(get_view(client, bundle_id, doc_id), "7\n합성 띠 제목")
    assert (joined["number"]["value"], _content(joined)) == ("7", "합성 띠 제목")
    cut = _edit(client, bundle_id, doc_id, {"type": "split", "unit_id": joined["id"], "at": joined["number"]["content_start"]})
    assert cut.status_code == 200, cut.text
    view = get_view(client, bundle_id, doc_id)

    merged = _edit(
        client, bundle_id, doc_id,
        {"type": "merge", "unit_ids": [find_unit(view, "7")["id"], find_unit(view, "합성 띠 제목")["id"]]},
    )
    assert merged.status_code == 200, merged.text

    title = find_unit(get_view(client, bundle_id, doc_id), "7\n합성 띠 제목")
    assert (title["number"]["value"], title["number"]["source"], _content(title)) == ("7", "cell", "합성 띠 제목")


# --- 내용(번호를 뺀 글) ---


def test_new_sentence_and_output_a_use_the_content_and_the_fixed_number(client: TestClient) -> None:
    bundle_id, sop_id, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)
    _set_number(client, bundle_id, doc_id, find_unit(view, MISREAD), "1.1.1")
    view = get_view(client, bundle_id, doc_id)

    # 글 없이 보낸 새 문장은 원문의 내용이다 — 번호가 따라가지 않고, 번호가 없다는 숫자 불일치도 없다
    group = assign_as_is(client, bundle_id, find_unit(view, MISREAD), sop_id, slot_key="purpose")
    assign_as_is(client, bundle_id, find_unit(view, TYPED), sop_id, slot_key="purpose")

    target = group["targets"][0]
    assert (target["confirmed_text"], target["change_type"], target["warnings"]) == ("합성 필터 확인", "as_is", [])
    ko, en = (
        {
            row["unit_id"]: row
            for row in client.get(f"/api/bundles/{bundle_id}/outputs/a", params={"lang": lang}, headers=AUTHOR).json()
        }
        for lang in ("ko", "en")
    )
    fixed, followed, typed, top = (ko[find_unit(view, text)["id"]] for text in (MISREAD, CHANGE, TYPED, TOP))
    assert fixed["location"]["section"] == "1.1.1 (읽은 값 1.2)"
    assert en[fixed["unit_id"]]["location"]["section"] == "1.1.1 (read as 1.2)"
    assert (fixed["source_text"], fixed["confirmed_text"]) == ("합성 필터 확인", "합성 필터 확인")
    assert (followed["location"]["section"], followed["source_text"]) == ("1.2 (읽은 값 1.3)", "합성 필터 교체")
    assert (top["location"]["section"], top["source_text"]) == ("1", "합성 절차")
    # 본문 줄의 고친 번호는 속한 절 뒤에 잇는다(따라 고쳐진 1.3.1 → 1.2.1), 제목의 타자 번호는 내용에서 빠진다
    step, heading = (ko[find_unit(view, text)["id"]] for text in (STEP, TYPED_HEADING))
    assert (step["location"]["section"], step["source_text"]) == ("1.2 · 1.2.1 (읽은 값 1.3.1)", "합성 필터를 교체한다.")
    assert en[step["unit_id"]]["location"]["section"] == "1.2 · 1.2.1 (read as 1.3.1)"
    assert (heading["location"]["section"], heading["source_text"]) == ("3", "합성 타자 제목")
    # 타자로 친 번호는 번호로 삼기 전에는 글이다
    assert (typed["source_text"], typed["confirmed_text"]) == (TYPED, TYPED)
