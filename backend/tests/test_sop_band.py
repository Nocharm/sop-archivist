"""띠 표 → 제목 줄(표 풀기·표준화 명세 F4) — 꼴이 확실한 띠 표는 올리자마자 번호 칸을 품은 제목 줄이고, "표로 되돌리기"
(set_layout_table)와 그 되돌리기·다시 하기로 표와 제목 줄 사이를 오간다. 번호는 번호 칸에만, 결과물 A 위치는 "§ · 띠 표"."""

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.coverage import find_coverage_problems
from app.sop.models import Extraction
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, make_band_table, make_grid_table, make_row, p
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_view, put_tobe, save_group, upload
from tests.test_sop_decisions import _body, _unit_in
from tests.test_sop_outputs import _get_output

pytestmark = pytest.mark.usefixtures("clean_sop")

TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]
CHAPTER, SECTION = "절차 (Procedure)", "필터 교체 (Filter change)"
SENTENCE = "필터 차압이 0.8 bar를 넘으면 교체한다."
BODY = (
    p("이 절차는 정제수 시스템의 필터 관리를 정한다.") + make_band_table("7", CHAPTER)
    + make_band_table("7.4", SECTION) + p(SENTENCE)
)
BAND = f"7.4 {SECTION}"  # 제목 줄의 글 — 번호 칸 블록과 제목 칸 블록을 띄어쓰기로 잇는다(번호는 범위로 가릴 뿐 글에 남는다)


def _setup(client: TestClient, body: str = BODY) -> tuple[int, int, int]:
    """(묶음, 새 SOP, 옛 문서) — 합성 띠 표 옛 문서 하나."""
    bundle = create_bundle(client, is_synthetic=True)
    tobe = put_tobe(client, bundle["id"], TOBE_DOCS)
    assert tobe.status_code == 200, tobe.text
    response = upload(client, bundle["id"], build_docx(body), "SYNTHETIC_OLD-BAND_Band_Table.docx")
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    return bundle["id"], tobe.json()["docs"][0]["id"], response.json()["id"]


def _edit(client: TestClient, bundle_id: int, doc_id: int, op: dict) -> httpx2.Response:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    return client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json={"revision": revision, "op": op}, headers=AUTHOR
    )


def _step(client: TestClient, bundle_id: int, doc_id: int, action: str) -> None:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits/{action}", json={"revision": revision}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text


def _content(unit: dict) -> str:
    return unit["text"][unit["number"]["content_start"]:]


def _covered(view: dict) -> tuple[list[str], set[tuple[int, int]]]:
    """(커버리지 문제, 덮인 빈 글자 아닌 글자 자리) — 범위가 있는 활성 단위가 모든 글자를 빠짐없이 · 겹침 없이 덮는가."""
    texts = {block["id"]: block["text"] for block in view["blocks"]}
    spans = [[tuple(span) for span in unit["spans"]] for unit in view["units"] if unit["spans"]]
    covered = {
        (block_id, offset)
        for unit_spans in spans for block_id, start, end in unit_spans for offset in range(start, end)
        if not texts[block_id][offset].isspace()
    }
    return find_coverage_problems(texts, spans), covered


def _band_table_id(view: dict) -> int:
    return find_unit(view, BAND)["table_id"]


def test_certain_band_table_is_a_heading_line_from_upload(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)

    view = get_view(client, bundle_id, doc_id)

    band = find_unit(view, BAND)
    assert band["kind"] == "heading"
    # 번호는 번호 칸에만 — 번호 칸 블록 전체가 번호 범위이고 글(내용)은 제목만이다
    assert (band["number"]["value"], band["number"]["source"], _content(band)) == ("7.4", "cell", SECTION)
    chapter = find_unit(view, f"7 {CHAPTER}")
    assert (chapter["kind"], chapter["number"]["value"], _content(chapter)) == ("heading", "7", CHAPTER)
    # 표 단위·칸 문장은 없고 벗긴 표로 남는다 — 가운데 빈 칸에는 덮을 글자가 없다
    assert [unit for unit in view["units"] if unit["kind"] in ("table", "cell_sentence")] == []
    assert [table["is_layout"] for table in view["tables"]] == [True, True]
    assert _covered(view)[0] == []
    # 띠 표가 연 절을 뒤 문장이 받는다
    sentence = find_unit(view, SENTENCE)
    sections = {block["id"]: block["section_label"] for block in view["blocks"]}
    assert sections[sentence["spans"][0][0]] == "7.4"


@pytest.mark.parametrize(
    "body",
    [
        # 가운데 칸에 글이 있으면 띠 표 꼴이 아니다
        pytest.param(make_band_table("7.4", SECTION, middle="합성 가운데 글"), id="middle-text"),
        # 아직 벗기지 않은 데이터 표 안의 띠 표는 표 안에 둔다(바깥 표를 벗길 때 — 브랜치 6)
        pytest.param(
            make_grid_table(2, make_row([p("") + make_band_table("7.4", SECTION), "합성 작업 내용이다."])),
            id="nested",
        ),
    ],
)
def test_ambiguous_band_tables_stay_tables(client: TestClient, body: str) -> None:
    bundle_id, _, doc_id = _setup(client, body + p(SENTENCE))

    view = get_view(client, bundle_id, doc_id)

    assert [unit for unit in view["units"] if unit["kind"] == "heading"] == []
    assert all(table["is_layout"] is False for table in view["tables"])
    assert len([unit for unit in view["units"] if unit["kind"] == "table"]) == len(view["tables"])


def test_unwrapping_a_band_left_as_a_table_makes_the_heading_line(client: TestClient) -> None:
    # 데이터 표 안에 있어 표로 둔 띠 표도 사람이 벗기면 제목 줄이 된다 — 번호는 한 번
    nested = make_grid_table(2, make_row([p("") + make_band_table("7.4", SECTION), "합성 작업 내용이다."]))
    bundle_id, _, doc_id = _setup(client, nested)
    view = get_view(client, bundle_id, doc_id)
    band_table = next(table for table in view["tables"] if table["parent_table_id"] is not None)

    response = _edit(client, bundle_id, doc_id, {"type": "set_layout_table", "table_id": band_table["id"], "is_layout": True})
    assert response.status_code == 200, response.text

    band = find_unit(get_view(client, bundle_id, doc_id), BAND)
    assert (band["kind"], band["number"]["value"], _content(band)) == ("heading", "7.4", SECTION)


def test_back_to_table_is_one_edit_and_undo_redo_keep_the_same_units(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    before = get_view(client, bundle_id, doc_id)
    heading = find_unit(before, BAND)

    response = _edit(client, bundle_id, doc_id, {"type": "set_layout_table", "table_id": heading["table_id"], "is_layout": False})
    assert response.status_code == 200, response.text
    table_view = get_view(client, bundle_id, doc_id)

    # 처음 쪼개기의 데이터 표 그대로 — 표 단위 하나에 번호 칸과 제목 칸 문장이 묶인다
    table = next(unit for unit in table_view["units"] if unit["kind"] == "table" and unit["table_id"] == heading["table_id"])
    cells = sorted(
        (unit["text"], unit["group_unit_id"]) for unit in table_view["units"] if unit["table_id"] == heading["table_id"]
        and unit["kind"] == "cell_sentence"
    )
    assert cells == [("7.4", table["id"]), (SECTION, table["id"])]
    assert heading["id"] in response.json()["retired_unit_ids"]
    assert next(t for t in table_view["tables"] if t["id"] == heading["table_id"])["is_layout"] is False
    # 커버리지는 그대로 — 같은 글자를 빠짐없이 한 번씩 덮는다
    assert _covered(table_view) == _covered(before) and _covered(before)[0] == []

    _step(client, bundle_id, doc_id, "undo")
    undone = get_view(client, bundle_id, doc_id)
    again = find_unit(undone, BAND)
    assert (again["id"], again["kind"], again["number"]["value"]) == (heading["id"], "heading", "7.4")
    assert table["id"] not in {unit["id"] for unit in undone["units"]}

    _step(client, bundle_id, doc_id, "redo")
    redone = get_view(client, bundle_id, doc_id)
    assert table["id"] in {unit["id"] for unit in redone["units"]}
    assert BAND not in {unit["text"] for unit in redone["units"]}
    assert _covered(redone)[0] == []


def test_band_heading_takes_back_to_table_not_to_sentence(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    heading = find_unit(get_view(client, bundle_id, doc_id), BAND)

    response = _edit(client, bundle_id, doc_id, {"type": "set_heading", "unit_ids": [heading["id"]], "heading": False})

    assert (response.status_code, response.json()["detail"]["code"]) == (422, "heading_shift_kind")


def test_back_to_table_refuses_a_line_joined_past_the_band(client: TestClient) -> None:
    bundle_id, _, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)
    heading, sentence = find_unit(view, BAND), find_unit(view, SENTENCE)
    merged = _edit(client, bundle_id, doc_id, {"type": "merge", "unit_ids": [heading["id"], sentence["id"]]})
    assert merged.status_code == 200, merged.text

    response = _edit(client, bundle_id, doc_id, {"type": "set_layout_table", "table_id": heading["table_id"], "is_layout": False})

    assert (response.status_code, response.json()["detail"]["code"]) == (422, "cell_crosses_table")


def test_output_a_locates_the_band_heading_with_the_title_only(client: TestClient) -> None:
    bundle_id, sop_id, doc_id = _setup(client)
    heading = find_unit(get_view(client, bundle_id, doc_id), BAND)
    # 칸 제목으로 보낸다(F12 G5) — 칸 제목의 글은 칸 이름이다
    target = {
        "key": "h", "kind": "slot_heading", "target_doc_id": sop_id, "slot_key": "procedures.p1",
        "source_unit_ids": [heading["id"]],
    }
    saved = save_group(client, bundle_id, _body([_unit_in(heading)], [target]))
    assert saved.status_code == 200, saved.text

    ko, en = (
        next(row for row in _get_output(client, bundle_id, "outputs/a", lang) if row["unit_id"] == heading["id"])
        for lang in ("ko", "en")
    )

    assert (ko["location"]["section"], ko["location"]["place"], ko["source_text"]) == ("7.4", "띠 표", SECTION)
    assert (en["location"]["section"], en["location"]["place"]) == ("7.4", "Band table")
    assert ko["dest_kind"] == "sop"
    # Excel A의 위치 칸도 같은 위치다(미리보기 라벨은 영어, 뒤에 쪽)
    preview = client.get(f"/api/bundles/{bundle_id}/export/preview", headers=AUTHOR).json()
    sheet = next(sheet for sheet in preview["sheets"] if sheet["name"] == "A Comparison")
    texts = [[cell["text"] for cell in row["cells"]] for row in sheet["rows"]]
    head = next(row for row in texts if "Location" in row)
    location, old_text = head.index("Location"), head.index("Old text")
    assert [row[location] for row in texts if row[old_text] == SECTION] == ["§7.4 · Band table · ~p. 1"]


def test_follow_renumbering_reaches_the_next_band_chapter_and_the_lines_under_it(client: TestClient) -> None:
    # 장 제목이 띠 표마다 자기 원문 표를 가리켜도 같은 목록이다 — 7 → 6이면 다음 장 8과 그 아래 8.1도 따라 내려간다
    purpose, scope = "Purpose of the synthetic procedure", "Scope of the synthetic procedure"
    body = (
        make_band_table("7", purpose) + p("7.1 The synthetic purpose line.", "Heading2")
        + make_band_table("8", scope) + p("8.1 The synthetic scope line.", "Heading2")
    )
    bundle_id, _, doc_id = _setup(client, body)
    chapter = find_unit(get_view(client, bundle_id, doc_id), f"7 {purpose}")

    response = _edit(client, bundle_id, doc_id, {"type": "set_number", "unit_id": chapter["id"], "number": "6", "follow": True})
    assert response.status_code == 200, response.text

    view = get_view(client, bundle_id, doc_id)
    numbers = {_content(unit): unit["number"]["value"] for unit in view["units"] if unit["number"]}
    assert numbers[purpose] == "6" and numbers[scope] == "7"
    assert numbers["The synthetic purpose line."] == "6.1" and numbers["The synthetic scope line."] == "7.1"


def test_a_fixed_band_number_survives_back_to_table_and_unwrapping_again(client: TestClient) -> None:
    # 제목 줄 번호를 사람이 고쳤으면 표의 번호 칸 줄도, 다시 벗긴 제목 줄도 고친 번호다
    bundle_id, _, doc_id = _setup(client)
    heading = find_unit(get_view(client, bundle_id, doc_id), BAND)
    fixed = _edit(client, bundle_id, doc_id, {"type": "set_number", "unit_id": heading["id"], "number": "7.5", "follow": False})
    assert fixed.status_code == 200, fixed.text

    back = _edit(client, bundle_id, doc_id, {"type": "set_layout_table", "table_id": heading["table_id"], "is_layout": False})
    assert back.status_code == 200, back.text
    cell = find_unit(get_view(client, bundle_id, doc_id), "7.4")
    assert (cell["kind"], cell["number"]["value"], cell["number"]["is_set"]) == ("cell_sentence", "7.5", True)

    again = _edit(client, bundle_id, doc_id, {"type": "set_layout_table", "table_id": heading["table_id"], "is_layout": True})
    assert again.status_code == 200, again.text
    assert find_unit(get_view(client, bundle_id, doc_id), BAND)["number"]["value"] == "7.5"


LONG_TITLE = "필터를 교체한다. 차압을 적는다. 서명한다."


def _set_split_rule(doc_id: int, rule: int) -> None:
    async def _run(session: AsyncSession) -> None:
        await session.execute(update(Extraction).where(Extraction.document_id == doc_id).values(split_rule=rule))
        await session.commit()

    run_in_session(_run)


@pytest.mark.parametrize(
    ("rule", "cells"),
    [(1, ["7.4", "필터를 교체한다.", "차압을 적는다.", "서명한다."]), (2, ["7.4", LONG_TITLE])],
)
def test_band_back_to_table_keeps_the_documents_rule(client: TestClient, rule: int, cells: list[str]) -> None:
    bundle_id, _, doc_id = _setup(client, make_band_table("7.4", LONG_TITLE) + p(SENTENCE))
    _set_split_rule(doc_id, rule)
    heading = find_unit(get_view(client, bundle_id, doc_id), f"7.4 {LONG_TITLE}")

    response = _edit(client, bundle_id, doc_id, {"type": "set_layout_table", "table_id": heading["table_id"], "is_layout": False})

    assert response.status_code == 200, response.text
    view = get_view(client, bundle_id, doc_id)
    assert [unit["text"] for unit in view["units"] if unit["kind"] == "cell_sentence"] == cells
    assert _covered(view)[0] == []
