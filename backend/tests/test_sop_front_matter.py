"""본문 앞부분(front) · 개정 이력(history) — 저절로 삭제된 줄을 찾는 규칙, 잠금, 사유, 여기부터 본문, 결과물(쪼개기 먼저 설계 §7 R3)."""

from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import TargetSentence, Unit
from app.sop.noise import (
    NOISE_FRONT,
    NOISE_HISTORY,
    NOISE_KINDS,
    NOISE_TOC,
    NoiseLine,
    find_body_starts,
    find_noise_lines,
    is_history_heading,
)
from tests.access_helpers import run_in_session, update_row
from tests.docx_factory import (
    TINY_PNG,
    build_docx,
    make_band_table,
    make_drawing_run,
    make_grid_table,
    make_row,
    make_style,
    p,
    tbl,
)
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_bundle, get_view, upload
from tests.split_golden.builder import cell

pytestmark = pytest.mark.usefixtures("clean_sop")

KO, EN, BOTH, NEUTRAL = frozenset({"ko"}), frozenset({"en"}), frozenset({"ko", "en"}), frozenset()


# --- 판정 규칙(순수) ---


def _line(kind: str, text: str, langs: frozenset[str] = KO, **fields) -> NoiseLine:
    return NoiseLine(
        kind=kind, text=text, langs=langs, number=fields.get("number"), level=fields.get("level"),
        is_body=fields.get("is_body", True), is_flow=fields.get("is_flow", True), noise=fields.get("noise"),
    )


def _p(text: str, langs: frozenset[str] = KO, **fields) -> NoiseLine:
    return _line("sentence", text, langs, **fields)


def _h(text: str, langs: frozenset[str] = KO, *, level: int = 1, number: str | None = None, **fields) -> NoiseLine:
    return _line("heading", text, langs, level=level, number=number, **fields)


def _toc(text: str, langs: frozenset[str] = KO) -> NoiseLine:
    return _p(text, langs, noise=NOISE_TOC)


def _table(*cells: str, langs: frozenset[str] = KO) -> list[NoiseLine]:
    return [
        _line("table", "", langs, is_flow=False), *(_line("cell_sentence", cell, langs, is_flow=False) for cell in cells),
    ]


def _find(lines: list[NoiseLine], *, separate: bool = False) -> list[str | None]:
    found = find_noise_lines(lines, separate=separate)
    return [found.get(index) for index in range(len(lines))]


BODY = [_h("1. 목적", number="1."), _p("탱크 세척 방법을 정한다."), _h("2. 범위", number="2."), _p("합성 공정에 적용한다.")]
EN_BODY = [
    _h("1. Purpose", EN, number="1."), _p("This procedure defines how to clean the tank.", EN),
    _h("2. Scope", EN, number="2."), _p("It applies to the synthetic process.", EN),
]


def test_everything_before_chapter_one_is_front_and_contents_stay_contents() -> None:
    front = [
        _p("합성 표준 절차서"), *_table("문서 번호", "SOP-QC-0001", langs=BOTH), *_table("작성", "검토", "승인"),
        _h("Summary of Changes", EN), *_table("개정", "1. 처음 만듦"), _p("목차"),
    ]
    contents = [_toc("1. 목적 ........ 3"), _toc("2. 범위 ........ 3")]

    assert _find([*front, *contents, *BODY]) == [NOISE_FRONT] * len(front) + [None] * (len(contents) + len(BODY))


def test_each_half_of_a_separate_document_drops_its_own_front() -> None:
    korean = [_p("합성 표준 절차서"), *_table("승인", "홍보팀"), _toc("1. 목적 ........ 3")]
    tail = [_p("첨부 1 기록지"), *_table("항목", "온도")]
    english = [_p("Synthetic Standard Procedure", EN), *_table("Approved", langs=EN), _toc("1. Purpose ........ 3", EN)]
    lines = [*korean, *BODY, *tail, *english, *EN_BODY]

    assert _find(lines, separate=True) == [
        *[NOISE_FRONT] * 4, None, *[None] * (len(BODY) + len(tail)), *[NOISE_FRONT] * 3, None, *[None] * len(EN_BODY)
    ]
    assert find_body_starts(lines, separate=True) == [5, 5 + len(BODY) + len(tail) + len(english)]


def test_a_korean_attachment_table_is_not_taken_by_the_second_half() -> None:
    bilingual = _table("항목 Item", "온도", langs=BOTH)
    english = [_p("Synthetic Standard Procedure", EN)]

    found = _find([*BODY, *bilingual, *english, *EN_BODY], separate=True)

    assert found == [None] * (len(BODY) + len(bilingual)) + [NOISE_FRONT] + [None] * len(EN_BODY)


def test_a_leading_figure_of_the_second_run_is_left_alone() -> None:
    # 첫 반쪽 끝의 그림은 어느 쪽인지 알 수 없다 — 사이에 낀 그림은 앞부분이다
    figure = _line("figure", "", NEUTRAL, is_flow=False)
    english = [_p("Synthetic Standard Procedure", EN), figure, _p("Issued by the synthetic team", EN)]

    found = _find([*BODY, figure, *english, *EN_BODY], separate=True)

    assert found == [None] * (len(BODY) + 1) + [NOISE_FRONT] * 3 + [None] * len(EN_BODY)


def test_interleaved_documents_have_one_start() -> None:
    lines = [_p("합성 표준 절차서"), *BODY, _p("Synthetic note", EN), *EN_BODY]

    assert find_body_starts(lines, separate=False) == [1]
    assert _find(lines) == [NOISE_FRONT] + [None] * (len(lines) - 1)


def test_a_one_inside_a_table_is_not_a_start() -> None:
    cells = [_line("table", "", KO, is_flow=False), _line("cell_sentence", "1. 처음 만듦", KO, is_flow=False, number="1.")]

    assert _find([_p("표지"), *cells]) == [None] * 3
    assert _find([_p("표지"), *cells, *BODY]) == [NOISE_FRONT] * 3 + [None] * len(BODY)


def test_a_band_heading_is_a_start() -> None:
    assert _find([_p("표지"), _h("1 목적", number="1")]) == [NOISE_FRONT, None]


def test_header_and_footer_lines_are_never_marked() -> None:
    header = _p("합성 머리말", is_body=False)

    assert _find([header, _p("표지"), *BODY, _h("개정 이력", number="9."), header]) == [
        None, NOISE_FRONT, *[None] * len(BODY), NOISE_HISTORY, None
    ]


def test_history_before_chapter_one_is_front() -> None:
    assert _find([_h("Revision History", EN), _p("처음 만들었다."), *BODY]) == [NOISE_FRONT] * 2 + [None] * len(BODY)


def test_history_ends_at_a_heading_of_the_same_or_higher_level() -> None:
    history = [
        _h("9. Document Change History", EN, number="9."), _p("개정 내용을 적는다."), _h("9.1 개정 1", level=2, number="9.1"),
        *_table("Rev", "Change", langs=EN),
    ]
    after = [_h("10. 첨부", number="10."), _p("기록지를 붙인다.")]

    assert _find([*BODY, *history, *after]) == [None] * len(BODY) + [NOISE_HISTORY] * len(history) + [None] * 2
    nested = [_h("9. 기록", number="9."), _h("9.1 개정 이력", level=2, number="9.1"), _p("처음 만들었다."), *after]
    assert _find([*BODY, *nested]) == [None] * (len(BODY) + 1) + [NOISE_HISTORY] * 2 + [None] * 2


def test_no_chapter_one_marks_nothing() -> None:
    lines = [_p("합성 안내문"), *_table("작성"), _h("2. 범위", number="2."), _h("개정 이력"), _p("처음 만들었다.")]

    assert _find(lines) == [None] * len(lines)
    assert find_body_starts(lines, separate=False) == []


def test_a_list_one_inside_a_body_that_starts_elsewhere_marks_nothing() -> None:
    # 5장에서 시작하는 문서의 단계 "1." — 앞의 장을 앞부분으로 지우지 않는다(Review Focus 4)
    numbered = [_h("5. 절차", number="5."), _p("탱크를 비운다."), _p("1. 전원을 켠다.", number="1.")]
    clauses = [_p("5.1 탱크를 비운다.", number="5.1"), _p("1. 전원을 켠다.", number="1.")]
    # 번호 없는 장 제목 아래의 단계도 본문 시작이 아니다
    unnumbered = [_h("목적"), _p("탱크 세척 방법을 정한다."), _h("절차"), _p("1. 전원을 켠다.", number="1.")]
    deeper = [_h("절차"), _h("1. 준비", level=2, number="1."), _p("탱크를 비운다.")]

    for lines in (numbered, clauses, unnumbered, deeper):
        assert _find(lines) == [None] * len(lines)
        assert find_body_starts(lines, separate=False) == []


def test_front_titles_and_dates_do_not_hide_chapter_one() -> None:
    front = [_h("승인"), _p("2026.01.02 작성", number="2026.01.02"), _p("01 개정", number="01"), _h("개정 이력")]

    assert _find([*front, *BODY]) == [NOISE_FRONT] * 4 + [None] * len(BODY)
    # 장 번호를 글로만 쓴 문서 — 제목이 없으면 번호 문단이 본문 시작이다
    assert _find([_p("표지"), _p("1. 목적", number="1."), _p("글이다.")]) == [NOISE_FRONT, None, None]


@pytest.mark.parametrize(
    "text",
    ["Summary of Change", "SUMMARY OF CHANGES", "Revision History", "Document Change History", "개정 이력", "변경이력",
     "9. Document Change History", "변경 이력 (Revision History)", "개정 이력 / Revision History:"],
)
def test_history_headings(text: str) -> None:
    assert is_history_heading(text)


@pytest.mark.parametrize("text", ["변경 관리", "Change Control", "개정 이력 관리 절차", "Revision", "", "개정 이력 " * 60])
def test_other_headings_are_not_history(text: str) -> None:
    assert not is_history_heading(text)


def test_noise_kinds_fit_the_column() -> None:
    assert NOISE_KINDS == (NOISE_TOC, NOISE_FRONT, NOISE_HISTORY) == ("toc", "front", "history")
    assert max(map(len, NOISE_KINDS)) <= 8


# --- 올린 문서 (통합) ---

STYLES = make_style("Heading1", "heading 1", outline=0) + make_style("TOC1", "toc 1")
PICTURE, SECOND_PICTURE = (f"<w:p>{make_drawing_run(name)}</w:p>" for name in ("image1.png", "image2.png"))
TITLE, EN_TITLE = "합성 표준 절차서", "Synthetic Standard Procedure"
CAPTION = "그림 1. 합성 로고"
PURPOSE, SCOPE = "탱크 세척 방법을 정한다.", "합성 공정에 적용한다."
FRONT_BODY = (
    p(TITLE) + p(EN_TITLE) + tbl([["문서 번호", "제목"], ["SOP-QC-0001", "합성 세척 절차"]])
    + PICTURE + p(CAPTION, "Caption") + SECOND_PICTURE
    + p("Summary of Changes", "Heading1") + p("1. 목적 ........ 3", "TOC1") + p("2. 범위 ........ 3", "TOC1")
)
MAIN_BODY = (
    p("1. 목적", "Heading1") + p(PURPOSE) + tbl([["항목", "값"], ["온도", "측정"]]) + PICTURE
    + p("2. 범위", "Heading1") + p(SCOPE)
)
HISTORY_BODY = p("9. 개정 이력", "Heading1") + p("처음 만들었다.") + tbl([["개정", "내용"], ["01", "제정"]])
FULL_BODY = FRONT_BODY + MAIN_BODY + HISTORY_BODY
FRONT_TEXTS = [TITLE, EN_TITLE, "문서 번호", "제목", "SOP-QC-0001", "합성 세척 절차", CAPTION, "Summary of Changes"]
HISTORY_TEXTS = ["9. 개정 이력", "처음 만들었다.", "개정", "내용", "01", "제정"]
TOC_TEXTS = ["1. 목적 ........ 3", "2. 범위 ........ 3"]


class Fixture(NamedTuple):
    bundle_id: int
    doc_id: int
    view: dict


def _setup(client: TestClient, body: str = FULL_BODY, side: str = "old", **parts) -> Fixture:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    data = build_docx(body, styles=STYLES, media={"image1.png": TINY_PNG, "image2.png": TINY_PNG}, **parts)
    response = upload(client, bundle_id, data, "SYNTHETIC_SOP-FM_Front.docx", side=side, doc_type="sop" if side == "new" else None)
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    doc_id = response.json()["id"]
    return Fixture(bundle_id, doc_id, get_view(client, bundle_id, doc_id))


def _view(client: TestClient, fx: Fixture) -> dict:
    return get_view(client, fx.bundle_id, fx.doc_id)


def _edit(client: TestClient, fx: Fixture, op: dict) -> httpx2.Response:
    return client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits",
        json={"revision": _view(client, fx)["document"]["revision"], "op": op}, headers=AUTHOR,
    )


def _step(client: TestClient, fx: Fixture, action: str) -> dict:
    response = client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits/{action}",
        json={"revision": _view(client, fx)["document"]["revision"]}, headers=AUTHOR,
    )
    assert response.status_code == 200, response.text
    return response.json()


def _code(response: httpx2.Response) -> tuple[int, str]:
    return response.status_code, response.json()["detail"]["code"]


def _noise(view: dict) -> dict[int, str]:
    """표시가 붙은 단위 → 종류."""
    return {unit["id"]: unit["noise_kind"] for unit in view["units"] if unit["noise_kind"] is not None}


def _texts(view: dict, kind: str) -> list[str]:
    """그 종류 표시가 붙은 글 단위의 글(원문 순)."""
    return [unit["text"] for unit in view["units"] if unit["noise_kind"] == kind and unit["text"]]


def _load_written_units() -> list[int]:
    async def _load(session: AsyncSession) -> list[int]:
        return list(await session.scalars(select(TargetSentence.new_unit_id).where(TargetSentence.new_unit_id.is_not(None))))

    return run_in_session(_load)


def test_front_lines_leave_the_rows_and_make_no_new_sentences(client: TestClient) -> None:
    fx = _setup(client)
    assert (_texts(fx.view, NOISE_FRONT), _texts(fx.view, NOISE_HISTORY)) == (FRONT_TEXTS, HISTORY_TEXTS)
    assert _texts(fx.view, NOISE_TOC) == TOC_TEXTS
    # 판단 줄은 본문의 제목 둘 · 문장 둘 · 표 하나 · 그림 하나뿐이다
    assert get_bundle(client, fx.bundle_id)["progress"]["total"] == 6
    title = find_unit(fx.view, TITLE)
    body = {"action": "delete", "reason": "합성", "units": [{"unit_id": title["id"], "revision": 1}]}
    refused = client.post(f"/api/bundles/{fx.bundle_id}/decisions/bulk", json=body, headers=AUTHOR)
    assert _code(refused) == (422, "noise_unit")

    written = _setup(client, side="new")
    noise = _noise(written.view)
    assert _texts(written.view, NOISE_FRONT) == FRONT_TEXTS and _texts(written.view, NOISE_HISTORY) == HISTORY_TEXTS
    # 제목은 절 경로가 될 뿐 새 문장을 만들지 않는다
    assert sorted(_load_written_units()) == sorted(
        unit["id"] for unit in written.view["units"] if unit["id"] not in noise and unit["kind"] != "heading"
    )


def test_header_and_footer_are_never_front(client: TestClient) -> None:
    fx = _setup(client, headers=[p("합성 머리말") + tbl([["합성 머리 칸", "1"]])], footers=[p("합성 꼬리말")])

    for text in ("합성 머리말", "합성 머리 칸", "합성 꼬리말"):
        assert find_unit(fx.view, text)["noise_kind"] is None
    assert _texts(fx.view, NOISE_FRONT) == FRONT_TEXTS


def test_a_table_carries_its_mark_to_cells_and_captions(client: TestClient) -> None:
    fx = _setup(client)
    noise = _noise(fx.view)
    by_id = {unit["id"]: unit for unit in fx.view["units"]}

    bundles = [unit for unit in fx.view["units"] if unit["kind"] in ("table", "figure")]
    assert [unit["noise_kind"] for unit in bundles] == ["front", "front", "front", None, None, "history"]
    grouped = [unit for unit in fx.view["units"] if unit["group_unit_id"] is not None]
    assert {unit["kind"] for unit in grouped} == {"cell_sentence", "caption"}
    assert all(noise.get(unit["id"]) == by_id[unit["group_unit_id"]]["noise_kind"] for unit in grouped)


def test_front_lines_never_pair(client: TestClient) -> None:
    body = (
        p(TITLE) + p(EN_TITLE)
        + "".join(p(text, "Heading1" if text[0] == "1" else None) for text in (
            "1. 목적", "1. Purpose", "탱크를 비운다.", "Drain the tank.", "밸브를 닫는다.", "Close the valve.",
        ))
    )
    fx = _setup(client, body)
    pairs = {unit["text"]: unit["pair_id"] for unit in fx.view["units"]}

    assert _texts(fx.view, NOISE_FRONT) == [TITLE, EN_TITLE]
    assert (pairs[TITLE], pairs[EN_TITLE]) == (None, None)
    assert pairs["탱크를 비운다."] == pairs["Drain the tank."] is not None
    ids = [find_unit(fx.view, text)["id"] for text in (TITLE, EN_TITLE)]
    response = client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/pairs",
        json={"revision": fx.view["document"]["revision"], "unit_ids": ids}, headers=AUTHOR,
    )
    assert _code(response) == (422, "toc_line_locked")


def test_numbers_return_with_a_restored_line(client: TestClient) -> None:
    fx = _setup(client)
    heading = find_unit(fx.view, "9. 개정 이력")
    assert heading["number"] is None

    assert _edit(client, fx, {"type": "clear_noise", "unit_ids": [heading["id"]]}).status_code == 200

    assert find_unit(_view(client, fx), "9. 개정 이력")["number"]["value"] == "9."


@pytest.mark.usefixtures("legacy_split_rule")
def test_documents_of_rule_1_get_no_front_marks(client: TestClient) -> None:
    fx = _setup(client)

    assert _texts(fx.view, NOISE_TOC) == TOC_TEXTS and set(_noise(fx.view).values()) == {NOISE_TOC}


def _kinds(view: dict, kind: str) -> list[dict]:
    return [unit for unit in view["units"] if unit["kind"] == kind]


def _build_locked_ops(view: dict) -> dict[str, dict]:
    title, en_title, caption = (find_unit(view, text) for text in (TITLE, EN_TITLE, CAPTION))
    front_table, front_figure, second_figure = [unit for unit in view["units"] if unit["kind"] in ("table", "figure")][:3]
    body_figure = _kinds(view, "figure")[2]
    return {
        "split": {"type": "split", "unit_id": title["id"], "at": 3},
        "merge": {"type": "merge", "unit_ids": [title["id"], find_unit(view, PURPOSE)["id"]]},
        "carve": {"type": "carve", "block_id": title["spans"][0][0], "start": 0, "end": 2},
        "move_boundary": {"type": "move_boundary", "left_unit_id": title["id"], "right_unit_id": en_title["id"], "at": 3},
        "set_layout_table": {"type": "set_layout_table", "table_id": front_table["table_id"], "is_layout": True},
        "attach_caption": {"type": "attach_caption", "unit_id": en_title["id"], "bundle_unit_id": body_figure["id"]},
        "attach_to_front": {
            "type": "attach_caption", "unit_id": find_unit(view, PURPOSE)["id"], "bundle_unit_id": second_figure["id"],
        },
        "detach_caption": {"type": "detach_caption", "unit_id": caption["id"]},
        "set_first_row_caption": {"type": "set_first_row_caption", "table_unit_id": front_table["id"], "caption": True},
        "group_figures": {"type": "group_figures", "unit_ids": [front_figure["id"], body_figure["id"]]},
        "ungroup_figures": {"type": "ungroup_figures", "unit_id": front_figure["id"]},
        "switch_language": {"type": "switch_language", "unit_id": title["id"], "lang": "en"},
        "unmerge": {"type": "unmerge", "unit_id": title["id"]},
        "set_heading": {"type": "set_heading", "unit_ids": [title["id"]], "heading": True},
        "set_indents": {"type": "set_indents", "units": [{"unit_id": title["id"], "indent_shift": 1}]},
        "set_number": {"type": "set_number", "unit_id": title["id"], "number": "1"},
    }


# 이미 다른 코드로 막던 편집은 그 코드 그대로다
LOCK_CODES = {"set_heading": "heading_shift_kind", "set_indents": "invalid_unit_kind", "set_number": "invalid_unit_kind"}
LOCKED = (
    "split", "merge", "carve", "move_boundary", "set_layout_table", "attach_caption", "attach_to_front", "detach_caption",
    "set_first_row_caption", "group_figures", "ungroup_figures", "switch_language", "unmerge", "set_heading", "set_indents",
    "set_number",
)


@pytest.mark.parametrize("side", ["old", "new"])
@pytest.mark.parametrize("name", LOCKED)
def test_deleted_lines_are_locked(client: TestClient, name: str, side: str) -> None:
    fx = _setup(client, side=side)
    op = _build_locked_ops(fx.view)[name]

    response = _edit(client, fx, op)

    assert _code(response) == (422, LOCK_CODES.get(name, "toc_line_locked")), response.text
    assert _view(client, fx)["units"] == fx.view["units"]


def test_a_deleted_line_locks_its_unwrapped_table(client: TestClient) -> None:
    fx = _setup(client)
    table_id = next(unit["table_id"] for unit in _kinds(fx.view, "table") if unit["noise_kind"] is None)
    assert _edit(client, fx, {"type": "set_layout_table", "table_id": table_id, "is_layout": True}).status_code == 200
    cells = [unit["id"] for unit in _view(client, fx)["units"] if unit["table_id"] == table_id]
    update_row(Unit, cells[0], noise_kind=NOISE_FRONT)

    for op in (
        {"type": "reorder_unwrapped", "table_id": table_id, "unit_ids": cells[::-1]},
        {"type": "set_layout_table", "table_id": table_id, "is_layout": False},
    ):
        assert _code(_edit(client, fx, op)) == (422, "toc_line_locked")


def test_a_band_heading_of_the_history_stays_a_heading(client: TestClient) -> None:
    body = make_band_table("1", "목적") + p(PURPOSE) + make_band_table("9", "개정 이력") + p("처음 만들었다.")
    fx = _setup(client, body)
    band = find_unit(fx.view, "9 개정 이력")
    assert (band["noise_kind"], _texts(fx.view, NOISE_HISTORY)) == (NOISE_HISTORY, ["9 개정 이력", "처음 만들었다."])

    response = _edit(client, fx, {"type": "set_layout_table", "table_id": band["table_id"], "is_layout": False})

    assert _code(response) == (422, "toc_line_locked")


def test_a_band_inside_a_table_locks_the_unwrapping(client: TestClient) -> None:
    inner = make_band_table("1", "합성 안쪽")
    table = make_grid_table(2, make_row(["조제", cell(p("앞 글이다."), inner, p("뒤 글이다."))]))
    fx = _setup(client, p("1. 목적", "Heading1") + table)
    outer = next(unit for unit in _kinds(fx.view, "table") if unit["pos_seq"] == min(u["pos_seq"] for u in _kinds(fx.view, "table")))
    band = next(unit for unit in fx.view["units"] if unit["kind"] == "table" and unit["id"] != outer["id"])
    update_row(Unit, band["id"], noise_kind=NOISE_FRONT)

    response = _edit(client, fx, {"type": "set_layout_table", "table_id": outer["table_id"], "is_layout": True})

    assert _code(response) == (422, "toc_line_locked")


def test_the_reference_lines_of_the_korean_half_are_not_front(client: TestClient) -> None:
    body = (
        p("1. 목적", "Heading1") + p(PURPOSE) + p(SCOPE) + p("2. Reference", "Heading1")
        + p("SOP-QC-0012 Cleaning of tanks") + p(EN_TITLE) + p("Approved by the synthetic team")
        + p("1. Purpose", "Heading1") + p("This procedure defines how to clean the tank.") + p("It applies to the synthetic process.")
    )
    fx = _setup(client, body)
    assert fx.view["document"]["language_layout"] == "ko_en_separate"

    assert _texts(fx.view, NOISE_FRONT) == [EN_TITLE, "Approved by the synthetic team"]
    assert find_unit(fx.view, "SOP-QC-0012 Cleaning of tanks")["lang"] == "ref"
    assert {find_unit(fx.view, text)["lang"] for text in (EN_TITLE, "Approved by the synthetic team")} == {"en"}
