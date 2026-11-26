"""벗긴 표 번호 이어 매기기 · 합치면 뒤 번호 당기기(11-23 명세 D1, 쪼개기 먼저 설계 §9 · §11-1) — 순수 규칙의 정답 표와
Old 표를 벗긴 뒤 따로 한 칸으로 남는 번호 편집(되돌리기 두 칸), 합치기 · 여럿 합치기가 같은 목록의 뒤 번호를 당기기(같은 칸).
자료는 시나리오 S17을 본뜬 합성 문서다."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import UnitEdit
from app.sop.numbering import FlowLine, plan_continue, plan_pull
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p, tbl
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_view, upload

TABLE = 9  # 벗기는 표


def H(number: str, lang: str = "ko") -> FlowLine:  # 정답 표의 기호(제목)
    return FlowLine(number=number, lang=lang, kind="heading")


def B(number: str, lang: str = "ko") -> FlowLine:  # 본문
    return FlowLine(number=number, lang=lang, kind="sentence")


def C(number: str, lang: str = "ko", *, is_cell: bool = True) -> FlowLine:  # 벗기는 표의 숫자 칸
    return FlowLine(number=number, lang=lang, kind="cell_sentence", table_id=TABLE, is_cell=is_cell)


def T(table_id: int, number: str, lang: str = "ko") -> FlowLine:  # 이미 매긴 앞 표의 줄
    return FlowLine(number=number, lang=lang, kind="cell_sentence", table_id=table_id)


def L(number: str | None, lang: str = "ko") -> FlowLine:  # 벗기는 표의 숫자 칸이 아닌 줄
    return FlowLine(number=number, lang=lang, kind="cell_sentence", table_id=TABLE)


ANSWERS = [
    ([H("5"), C("1"), C("2"), C("3")], {1: "5.1", 2: "5.2", 3: "5.3"}),
    ([H("5"), T(8, "5.1"), T(8, "5.2"), T(8, "5.3"), C("1"), C("2")], {4: "5.4", 5: "5.5"}),
    ([H("5"), B("5.1"), C("1"), C("2")], {2: "5.2", 3: "5.3"}),
    ([B("5.2"), C("1"), C("2")], {1: "5.2.1", 2: "5.2.2"}),
    ([H("5"), B("1)"), C("1"), C("2")], {2: "5.1", 3: "5.2"}),
    ([H("5"), B("•"), C("1"), C("2")], {2: "5.1", 3: "5.2"}),
    ([C("1"), C("2"), C("3")], {}),
    ([H("5"), B("5.1"), H("5", lang="en"), C("1", lang="en"), C("2", lang="en")], {3: "5.1", 4: "5.2"}),
]


@pytest.mark.parametrize(("lines", "expected"), ANSWERS)
def test_answer_table(lines: list[FlowLine], expected: dict[int, str]) -> None:
    assert plan_continue(lines, TABLE) == expected


def test_only_number_cells_change() -> None:
    assert plan_continue([H("5"), C("1"), L("•"), L("A-1"), L(None), C("2")], TABLE) == {1: "5.1", 5: "5.2"}


def test_heading_above_is_always_the_parent() -> None:
    assert plan_continue([H("5"), H("5.1"), C("1")], TABLE) == {2: "5.1.1"}


def test_two_languages_share_the_numbers() -> None:
    lines = [H("5"), H("5", lang="en"), C("1"), C("1", lang="en"), C("2"), C("2", lang="en")]

    assert plan_continue(lines, TABLE) == {2: "5.1", 3: "5.1", 4: "5.2", 5: "5.2"}


def test_numbers_a_person_fixed_stay() -> None:
    assert plan_continue([H("5"), C("7", is_cell=False), C("1")], TABLE) == {2: "5.1"}


def test_the_cell_keeps_its_trailing_dot_and_a_deeper_cell_follows_the_row_above() -> None:
    assert plan_continue([H("5."), C("1."), C("1.1"), C("2")], TABLE) == {1: "5.1.", 2: "5.1.1", 3: "5.2"}


# ── 벗긴 뒤 한 칸으로(편집 continue_numbers) ─────────────────────────────────

STEPS = ["전원을 켠다.", "압력이 0.2 MPa가 되면", "밸브를 연다.", "10분 동안 순환한다."]
# 번호로 읽히려면 타자 번호에 점이 있어야 한다
BODY = p("5. 조작 순서", "Heading1") + tbl([[str(n), text] for n, text in enumerate(STEPS, 1)]) + p("6. 기록", "Heading1")
SECOND = ["시료를 받는다.", "시료를 나눈다."]
TWO_TABLES = (
    p("5. 조작 순서", "Heading1") + tbl([[str(n), text] for n, text in enumerate(STEPS[:3], 1)]) + p("다음 표를 따른다.")
    + tbl([[str(n), text] for n, text in enumerate(SECOND, 1)]) + p("6. 기록", "Heading1")
)
UNDO = {"session": "s1"}
ROW_TWO = f"2 {STEPS[1]}"  # 번호 칸과 내용 칸이 한 줄이 된 벗긴 줄의 글
clean = pytest.mark.usefixtures("clean_sop")


def _setup(client: TestClient, body: str = BODY, *, side: str = "old") -> tuple[int, int]:
    """(묶음, 문서)."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    extra = {"side": "new", "doc_type": "sop"} if side == "new" else {}
    response = upload(client, bundle_id, build_docx(body), f"SYNTHETIC_{side.upper()}-5_Steps.docx", **extra)
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    return bundle_id, response.json()["id"]


def _edit(client: TestClient, bundle_id: int, doc_id: int, op: dict, *, undo: dict | None = UNDO) -> dict:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    body = {"revision": revision, "op": op, **({"undo": undo} if undo is not None else {})}
    response = client.post(f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _unwrap(client: TestClient, bundle_id: int, doc_id: int, index: int = 0, *, undo: dict | None = UNDO) -> dict:
    table_id = get_view(client, bundle_id, doc_id)["tables"][index]["id"]
    return _edit(client, bundle_id, doc_id, {"type": "set_layout_table", "table_id": table_id, "is_layout": True}, undo=undo)


def _assign_step(client: TestClient, bundle_id: int, action: str) -> None:
    response = client.post(f"/api/bundles/{bundle_id}/decisions/{action}", json=UNDO, headers=AUTHOR)
    assert response.status_code == 200, response.text


def _doc_step(client: TestClient, bundle_id: int, doc_id: int, action: str) -> None:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits/{action}", json={"revision": revision}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text


def _numbers(client: TestClient, bundle_id: int, doc_id: int, index: int = 0) -> list[str | None]:
    """그 표 칸 줄(묶이지 않은 칸 문장)의 번호 칸 값 — 원문 순. 아직 표면 표 단위에 묶인 칸이다."""
    view = get_view(client, bundle_id, doc_id)
    table_id = view["tables"][index]["id"]
    return [
        unit["number"]["value"] for unit in view["units"]
        if unit["kind"] == "cell_sentence" and unit["table_id"] == table_id and unit["number"] and unit["number"]["value"]
    ]


def _is_layout(client: TestClient, bundle_id: int, doc_id: int, index: int = 0) -> bool:
    return get_view(client, bundle_id, doc_id)["tables"][index]["is_layout"]


def _edit_ops(doc_id: int) -> list[str]:
    async def _run(session: AsyncSession) -> list[str]:
        rows = await session.scalars(
            select(UnitEdit.op).where(UnitEdit.document_id == doc_id, UnitEdit.state == "applied").order_by(UnitEdit.seq)
        )
        return list(rows)

    return run_in_session(_run)


@clean
def test_unwrapping_numbers_the_cells_and_undoes_in_two_steps(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)

    _unwrap(client, bundle_id, doc_id)

    assert _numbers(client, bundle_id, doc_id) == ["5.1", "5.2", "5.3", "5.4"]
    assert _edit_ops(doc_id) == ["set_layout_table", "continue_numbers"]
    _assign_step(client, bundle_id, "undo")
    assert (_numbers(client, bundle_id, doc_id), _is_layout(client, bundle_id, doc_id)) == (["1", "2", "3", "4"], True)
    _assign_step(client, bundle_id, "undo")
    assert _is_layout(client, bundle_id, doc_id) is False
    _assign_step(client, bundle_id, "redo")
    _assign_step(client, bundle_id, "redo")
    assert _numbers(client, bundle_id, doc_id) == ["5.1", "5.2", "5.3", "5.4"]


@clean
def test_document_undo_also_takes_two_presses(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    _unwrap(client, bundle_id, doc_id, undo=None)

    _doc_step(client, bundle_id, doc_id, "undo")
    assert (_numbers(client, bundle_id, doc_id), _is_layout(client, bundle_id, doc_id)) == (["1", "2", "3", "4"], True)
    _doc_step(client, bundle_id, doc_id, "undo")
    assert _is_layout(client, bundle_id, doc_id) is False
    _doc_step(client, bundle_id, doc_id, "redo")
    _doc_step(client, bundle_id, doc_id, "redo")
    assert _numbers(client, bundle_id, doc_id) == ["5.1", "5.2", "5.3", "5.4"]


@clean
def test_second_table_under_the_same_heading_goes_on(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client, TWO_TABLES)

    _unwrap(client, bundle_id, doc_id, 0)
    _unwrap(client, bundle_id, doc_id, 1)

    assert _numbers(client, bundle_id, doc_id, 0) == ["5.1", "5.2", "5.3"]
    assert _numbers(client, bundle_id, doc_id, 1) == ["5.4", "5.5"]


@clean
def test_several_tables_at_once_are_two_undo_steps(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client, TWO_TABLES)
    table_ids = [table["id"] for table in get_view(client, bundle_id, doc_id)["tables"]]

    result = _edit(client, bundle_id, doc_id, {"type": "set_layout_tables", "table_ids": table_ids[::-1]})

    assert result["document_revision"] == get_view(client, bundle_id, doc_id)["document"]["revision"]
    assert [_numbers(client, bundle_id, doc_id, 0), _numbers(client, bundle_id, doc_id, 1)] == [["5.1", "5.2", "5.3"], ["5.4", "5.5"]]
    _assign_step(client, bundle_id, "undo")
    assert [_numbers(client, bundle_id, doc_id, 0), _numbers(client, bundle_id, doc_id, 1)] == [["1", "2", "3"], ["1", "2"]]
    assert _is_layout(client, bundle_id, doc_id, 0) and _is_layout(client, bundle_id, doc_id, 1)
    _assign_step(client, bundle_id, "undo")
    assert not _is_layout(client, bundle_id, doc_id, 0) and not _is_layout(client, bundle_id, doc_id, 1)


@clean
def test_a_new_document_is_never_numbered(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client, side="new")

    _unwrap(client, bundle_id, doc_id)

    assert _numbers(client, bundle_id, doc_id) == ["1", "2", "3", "4"]
    assert _edit_ops(doc_id) == ["set_layout_table"]


@clean
def test_back_to_table_and_unwrap_again_keeps_the_numbers(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    _unwrap(client, bundle_id, doc_id)
    table_id = get_view(client, bundle_id, doc_id)["tables"][0]["id"]
    _edit(client, bundle_id, doc_id, {"type": "set_layout_table", "table_id": table_id, "is_layout": False})

    _unwrap(client, bundle_id, doc_id)

    assert _numbers(client, bundle_id, doc_id) == ["5.1", "5.2", "5.3", "5.4"]


@clean
def test_a_value_cell_in_the_middle_of_a_row_is_left_alone(client: TestClient) -> None:
    body = p("5. 조작 순서", "Heading1") + tbl([["1", "농도를 잰다.", ""], ["농도", "5", "%"]])
    bundle_id, doc_id = _setup(client, body)

    _unwrap(client, bundle_id, doc_id)

    assert _numbers(client, bundle_id, doc_id) == ["5.1", "5"]


@clean
def test_decided_lines_keep_their_decisions(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    _unwrap(client, bundle_id, doc_id, undo=None)
    _doc_step(client, bundle_id, doc_id, "undo")  # 번호만 되돌린다 — 벗긴 줄은 그대로
    line = find_unit(get_view(client, bundle_id, doc_id), ROW_TWO)
    deleted = client.post(
        f"/api/bundles/{bundle_id}/decisions/bulk",
        json={"action": "delete", "reason": "합성 사유", "units": [{"unit_id": line["id"], "revision": 1}]},
        headers=AUTHOR,
    )
    assert deleted.status_code == 200, deleted.text
    decided = find_unit(get_view(client, bundle_id, doc_id), ROW_TWO)["status"]

    _doc_step(client, bundle_id, doc_id, "redo")

    after = find_unit(get_view(client, bundle_id, doc_id), ROW_TWO)
    assert _numbers(client, bundle_id, doc_id) == ["5.1", "5.2", "5.3", "5.4"]
    assert (after["id"], after["status"]) == (line["id"], decided) and decided != line["status"]


# ── 합치면 뒤 번호 당기기(D1-R6) ─────────────────────────────────────────────

def test_pull() -> None:
    assert plan_pull(["5.1", "5.2", "5.4"], 1, ["5.3"]) == {2: "5.3"}


def test_pull_takes_children_along() -> None:
    assert plan_pull(["5.2", "5.3.1", "5.4", "5.4.1"], 0, ["5.3"]) == {1: "5.2.1", 2: "5.3", 3: "5.3.1"}


def test_no_number_absorbed_pulls_nothing() -> None:
    assert plan_pull(["5.1", "5.2"], 0, []) == {}
    assert plan_pull(["5.1", "5.2", "6"], 1, ["7"]) == {}


ROW_THREE = f"3 {STEPS[2]}"
KO_BODY = ["6.1 기록지를 쓴다.", "6.2 서명한다.", "6.3 보관한다."]
EN_BODY = ["6.1 Fill in the record.", "6.2 Sign it.", "6.3 Keep it."]
LISTS = BODY + "".join(p(text) for text in KO_BODY + EN_BODY)  # 표 · 한글 본문 목록 · 영어 본문 목록
ROWS = p("6. 기록", "Heading1") + "".join(p(ko) + p(en) for ko, en in zip(KO_BODY, EN_BODY, strict=True))  # 한/영 번갈아


def _merge(client: TestClient, bundle_id: int, doc_id: int, *texts: str, op: str = "merge") -> dict:
    view = get_view(client, bundle_id, doc_id)
    return _edit(client, bundle_id, doc_id, {"type": op, "unit_ids": [find_unit(view, text)["id"] for text in texts]})


def _body_numbers(client: TestClient, bundle_id: int, doc_id: int, lang: str) -> list[str]:
    """표 밖 본문 줄(제목 아님)의 번호 — 원문 순."""
    view = get_view(client, bundle_id, doc_id)
    return [
        unit["number"]["value"] for unit in view["units"]
        if unit["kind"] == "sentence" and unit["table_id"] is None and unit["lang"] == lang and unit["number"] and unit["number"]["value"]
    ]


@clean
def test_s17_merge_and_undo(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    _unwrap(client, bundle_id, doc_id)

    _merge(client, bundle_id, doc_id, ROW_TWO, ROW_THREE)

    assert _numbers(client, bundle_id, doc_id) == ["5.1", "5.2", "5.3"]
    assert find_unit(get_view(client, bundle_id, doc_id), f"{ROW_TWO} {ROW_THREE}")["number"]["value"] == "5.2"
    _assign_step(client, bundle_id, "undo")
    assert _numbers(client, bundle_id, doc_id) == ["5.1", "5.2", "5.3", "5.4"]
    _assign_step(client, bundle_id, "undo")
    assert (_numbers(client, bundle_id, doc_id), _is_layout(client, bundle_id, doc_id)) == (["1", "2", "3", "4"], True)
    _assign_step(client, bundle_id, "undo")
    assert not _is_layout(client, bundle_id, doc_id)


@clean
def test_unmerge_does_not_leave_twin_numbers(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    _unwrap(client, bundle_id, doc_id)
    merged = _merge(client, bundle_id, doc_id, ROW_TWO, ROW_THREE)["created_unit_ids"][0]

    _edit(client, bundle_id, doc_id, {"type": "unmerge", "unit_id": merged})

    assert _numbers(client, bundle_id, doc_id) == ["5.1", "5.2", "5.3", "5.4"]


@clean
def test_body_lines_pull_too(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client, LISTS)

    _merge(client, bundle_id, doc_id, KO_BODY[0], KO_BODY[1])

    assert _body_numbers(client, bundle_id, doc_id, "ko") == ["6.1", "6.2"]


@clean
def test_other_language_and_other_table_do_not_move(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client, LISTS)
    _unwrap(client, bundle_id, doc_id)

    _merge(client, bundle_id, doc_id, KO_BODY[1], KO_BODY[2])
    _merge(client, bundle_id, doc_id, ROW_TWO, ROW_THREE)

    assert _body_numbers(client, bundle_id, doc_id, "ko") == ["6.1", "6.2"]
    assert _body_numbers(client, bundle_id, doc_id, "en") == ["6.1", "6.2", "6.3"]
    assert _numbers(client, bundle_id, doc_id) == ["5.1", "5.2", "5.3"]


@clean
def test_merge_rows_pulls_each_language(client: TestClient) -> None:
    from tests.test_sop_lang_shape import _pair
    from tests.test_sop_merge_rows import _clear_pairs

    bundle_id, doc_id = _setup(client, ROWS)
    _clear_pairs(client, bundle_id, doc_id)
    view = get_view(client, bundle_id, doc_id)
    for ko, en in zip(KO_BODY, EN_BODY, strict=True):
        _pair(client, bundle_id, doc_id, [find_unit(view, ko)["id"], find_unit(view, en)["id"]])

    _merge(client, bundle_id, doc_id, KO_BODY[0], EN_BODY[0], KO_BODY[1], EN_BODY[1], op="merge_rows")

    assert _body_numbers(client, bundle_id, doc_id, "ko") == ["6.1", "6.2"]
    assert _body_numbers(client, bundle_id, doc_id, "en") == ["6.1", "6.2"]


@clean
def test_new_merge_keeps_written_numbers(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client, side="new")
    _unwrap(client, bundle_id, doc_id)

    _merge(client, bundle_id, doc_id, ROW_TWO, ROW_THREE)

    assert _numbers(client, bundle_id, doc_id) == ["1", "2", "4"]


@clean
def test_only_applied_continue_records_count_as_continued(client: TestClient) -> None:
    bundle_id, doc_id = _setup(client)
    _unwrap(client, bundle_id, doc_id, undo=None)
    lines = [unit["id"] for unit in get_view(client, bundle_id, doc_id)["units"] if unit["text"] in (ROW_TWO, ROW_THREE)]

    applied = _load_continued(doc_id)
    _doc_step(client, bundle_id, doc_id, "undo")
    undone = _load_continued(doc_id)

    assert [applied.get(unit_id) for unit_id in lines] == ["5.2", "5.3"] and undone == {}


@clean
def test_a_table_already_unwrapped_in_the_same_request_keeps_its_numbers(client: TestClient) -> None:
    """set_layout_tables에 이미 벗긴 표(번호 1 2 3, 이 기능 전 운영의 표)가 섞여도 이번에 벗긴 표만 매긴다."""
    bundle_id, doc_id = _setup(client, TWO_TABLES)
    _unwrap(client, bundle_id, doc_id, 0, undo=None)
    _doc_step(client, bundle_id, doc_id, "undo")  # 번호만 되돌린다 — 벗긴 채 1 2 3
    table_ids = [table["id"] for table in get_view(client, bundle_id, doc_id)["tables"]]

    _edit(client, bundle_id, doc_id, {"type": "set_layout_tables", "table_ids": table_ids})

    assert [_numbers(client, bundle_id, doc_id, 0), _numbers(client, bundle_id, doc_id, 1)] == [["1", "2", "3"], ["5.1", "5.2"]]


def _load_continued(doc_id: int) -> dict[int, str]:
    from app.sop.editing import load_continued_numbers

    return run_in_session(lambda session: load_continued_numbers(session, doc_id))
