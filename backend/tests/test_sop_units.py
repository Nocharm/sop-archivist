"""처음 단위 만들기와 원문 대조 데이터(view) — 업로드가 만든 단위·판단 행·코드 짝, 언어 배치 변경, 커버리지 가드, 쿼리 수."""

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine
from app.sop.constants import COVER_KINDS
from app.sop.coverage import find_coverage_problems
from app.sop.models import Unit, UnitDecision, UnitPair
from app.sop.units import verify_document_coverage
from tests.access_helpers import run_in_session
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, p, tbl
from tests.sop_helpers import AUTHOR, OUTSIDER, REVIEWER, create_bundle, find_unit, get_view, set_members, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-1_Interleaved.docx"
# 한/영 연달아 — 제목 한 쌍, 두 문장짜리 문단 한 쌍, 2×2 데이터 표, 캡션 있는 그림
INTERLEAVED_BODY = (
    p("1. 목적", "Heading1")
    + p("1. Purpose", "Heading1")
    + p("합성 장비의 전원을 켠다. 합성 기록은 보관한다.")
    + p("Turn on the synthetic unit. Synthetic records are kept.")
    + tbl([["항목", "Item"], ["합성 값", "Synthetic value"]])
    + f"<w:p>{make_drawing_run('image1.png')}</w:p>"
    + p("그림 1 합성 장비", "Caption")
)


def _interleaved_docx() -> bytes:
    return build_docx(INTERLEAVED_BODY, media={"image1.png": TINY_PNG})


def _upload_ready(client: TestClient, bundle_id: int, data: bytes, name: str, **kwargs: str) -> dict:
    response = upload(client, bundle_id, data, name, **kwargs)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ready", response.json()
    return response.json()


def _patch_layout(client: TestClient, bundle_id: int, doc: dict, revision: int, layout: str) -> dict:
    response = client.patch(
        f"/api/bundles/{bundle_id}/documents/{doc['id']}",
        json={"revision": revision, "language_layout": layout},
        headers=AUTHOR,
    )
    assert response.status_code == 200, response.text
    return response.json()


def _get_pair_texts(view: dict) -> list[tuple[str, list[str]]]:
    text_by_id = {unit["id"]: unit["text"] for unit in view["units"]}
    return [(pair["status"], [text_by_id[unit_id] for unit_id in pair["unit_ids"]]) for pair in view["pairs"]]


def _count_decisions(extraction_id: int) -> int:
    async def _run(session: AsyncSession) -> int:
        return await session.scalar(
            select(func.count()).select_from(UnitDecision).join(Unit).where(Unit.extraction_id == extraction_id)
        )

    return run_in_session(_run)


@contextmanager
def _count_queries() -> Iterator[list[str]]:
    statements: list[str] = []

    def _record(_conn: object, _cursor: object, statement: str, *_args: object) -> None:
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _record)
    try:
        yield statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _record)


def test_upload_creates_units_with_full_coverage(client: TestClient) -> None:
    bundle = create_bundle(client)
    doc = _upload_ready(client, bundle["id"], _interleaved_docx(), OLD_NAME)

    view = get_view(client, bundle["id"], doc["id"])

    units = view["units"]
    assert [unit["kind"] for unit in units] == [
        "heading", "heading", "sentence", "sentence", "sentence", "sentence",
        "table", "cell_sentence", "cell_sentence", "cell_sentence", "cell_sentence", "figure",
    ]
    block_texts = {block["id"]: block["text"] for block in view["blocks"]}
    assert find_coverage_problems(block_texts, [unit["spans"] for unit in units if unit["kind"] in COVER_KINDS]) == []
    assert {unit["status"] for unit in units} == {"unassigned"}
    assert [unit["display_id"] for unit in units] == [f"OLD-1-{n:03d}" for n in range(1, len(units) + 1)]
    assert [unit["lang"] for unit in units] == ["ko", "en", "ko", "ko", "en", "en", "neutral", "ko", "en", "ko", "en", "neutral"]
    table = units[6]
    assert {unit["group_unit_id"] for unit in units[7:11]} == {table["id"]}
    assert (table["spans"], table["text"]) == ([], "")
    assert find_unit(view, "그림 1 합성 장비")["kind"] == "figure"
    # 연달아: 표에 묶인 칸 문장과 중립 단위는 건너뛰고 이웃한 한글·영어 덩어리를 짝으로 제안한다
    assert _get_pair_texts(view) == [
        ("suggested", ["1. 목적", "1. Purpose"]),
        ("suggested", [
            "합성 장비의 전원을 켠다.", "합성 기록은 보관한다.", "Turn on the synthetic unit.", "Synthetic records are kept.",
        ]),
    ]
    assert {pair["source"] for pair in view["pairs"]} == {"code"}
    first_pair = view["pairs"][0]
    assert find_unit(view, "1. 목적")["pair_id"] == first_pair["id"]
    assert table["pair_id"] is None
    assert _count_decisions(doc["extraction"]["id"]) == len(units)
    assert view["document"]["id"] == doc["id"] and view["extraction"]["id"] == doc["extraction"]["id"]
    assert view["edits"] == {"can_undo": False, "can_redo": False}
    figure_block = next(block for block in view["blocks"] if block["kind"] == "figure")
    assert figure_block["has_image"] is True
    run_in_session(lambda session: verify_document_coverage(session, doc["id"]))  # 버그 가드가 조용하다


def test_view_is_for_members_only(client: TestClient) -> None:
    bundle = create_bundle(client)
    doc = _upload_ready(client, bundle["id"], _interleaved_docx(), OLD_NAME)
    assert set_members(client, bundle["id"], [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200

    url = f"/api/bundles/{bundle['id']}/documents/{doc['id']}/view"
    assert client.get(url, headers=REVIEWER).status_code == 200
    outsider = client.get(url, headers=OUTSIDER)
    assert outsider.status_code == 404
    assert outsider.json()["detail"] == {"code": "bundle_not_found"}


def test_nested_merged_tables_and_cell_figures(client: TestClient) -> None:
    # 바깥 표: vMerge 이어지는 칸에 남은 글, 칸 안 그림, 칸 안의 표
    body = (
        '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>'
        '<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>' + p("Synthetic top") + "</w:tc>"
        "<w:tc>" + p("Synthetic right") + f"<w:p>{make_drawing_run('image1.png')}</w:p></w:tc></w:tr>"
        "<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>" + p("Synthetic hidden") + "</w:tc>"
        "<w:tc>" + tbl([["Synthetic inner"]]) + p("") + "</w:tc></w:tr>"
        "</w:tbl>"
    )
    bundle = create_bundle(client)
    doc = _upload_ready(client, bundle["id"], build_docx(body, media={"image1.png": TINY_PNG}), OLD_NAME)

    view = get_view(client, bundle["id"], doc["id"])

    outer, inner = view["tables"]
    units = view["units"]
    assert [(unit["kind"], unit["text"]) for unit in units] == [
        ("table", ""), ("cell_sentence", "Synthetic top"), ("cell_sentence", "Synthetic right"), ("figure", ""),
        ("cell_sentence", "Synthetic hidden"), ("table", ""), ("cell_sentence", "Synthetic inner"),
    ]
    outer_unit, inner_unit = units[0], units[5]
    assert (outer_unit["table_id"], inner_unit["table_id"]) == (outer["id"], inner["id"])
    # 이어지는 칸에 남은 글도 보통 칸 문장으로 바깥 표에 묶이고, 안쪽 표의 칸은 안쪽 표 단위에 묶인다
    assert [unit["group_unit_id"] for unit in units if unit["kind"] == "cell_sentence"] == [
        outer_unit["id"], outer_unit["id"], outer_unit["id"], inner_unit["id"],
    ]
    # 칸 안 그림은 표에 묶이지 않는 독립 단위로 자기 판단을 갖는다
    figure = units[3]
    assert (figure["group_unit_id"], figure["table_id"], figure["spans"], figure["status"]) == (
        None, None, [], "unassigned",
    )
    assert view["pairs"] == []  # 묶인 칸 문장과 중립 단위뿐이라 코드 짝이 없다
    run_in_session(lambda session: verify_document_coverage(session, doc["id"]))


def test_new_doc_units_have_no_decisions(client: TestClient) -> None:
    bundle = create_bundle(client)
    doc = _upload_ready(
        client, bundle["id"], _interleaved_docx(), "SYNTHETIC_SOP-NEW-1_Interleaved.docx", side="new", doc_type="sop"
    )

    view = get_view(client, bundle["id"], doc["id"])

    assert len(view["units"]) == 12
    assert {unit["status"] for unit in view["units"]} == {None}
    assert _count_decisions(doc["extraction"]["id"]) == 0
    assert [unit["display_id"] for unit in view["units"]][:2] == ["SOP-NEW-1-001", "SOP-NEW-1-002"]


def test_display_id_falls_back_to_document_id(client: TestClient) -> None:
    bundle = create_bundle(client)
    doc = _upload_ready(client, bundle["id"], build_docx(p("합성 문장이다.")), "합성 문서.docx")

    view = get_view(client, bundle["id"], doc["id"])

    assert [unit["display_id"] for unit in view["units"]] == [f"D{doc['id']}-001"]


def test_layout_change_refreshes_code_pairs(client: TestClient) -> None:
    bundle = create_bundle(client)
    doc = _upload_ready(client, bundle["id"], _interleaved_docx(), OLD_NAME)

    ko_only = _patch_layout(client, bundle["id"], doc, 1, "ko_only")
    view_ko_only = get_view(client, bundle["id"], doc["id"])
    interleaved = _patch_layout(client, bundle["id"], doc, 2, "ko_en_interleaved")
    view_interleaved = get_view(client, bundle["id"], doc["id"])

    assert (ko_only["revision"], interleaved["revision"]) == (2, 3)
    assert view_ko_only["pairs"] == []
    assert {unit["pair_id"] for unit in view_ko_only["units"]} == {None}
    assert [status for status, _ in _get_pair_texts(view_interleaved)] == ["suggested", "suggested"]
    assert view_interleaved["document"]["revision"] == 3


def test_refresh_keeps_confirmed_pairs(client: TestClient) -> None:
    bundle = create_bundle(client)
    doc = _upload_ready(client, bundle["id"], _interleaved_docx(), OLD_NAME)
    confirmed_id = get_view(client, bundle["id"], doc["id"])["pairs"][0]["id"]

    async def _confirm(session: AsyncSession) -> None:
        await session.execute(
            update(UnitPair).where(UnitPair.id == confirmed_id).values(status="confirmed", source="human")
        )
        await session.commit()

    run_in_session(_confirm)
    _patch_layout(client, bundle["id"], doc, 1, "en_only")
    kept = get_view(client, bundle["id"], doc["id"])
    _patch_layout(client, bundle["id"], doc, 2, "ko_en_interleaved")
    refreshed = get_view(client, bundle["id"], doc["id"])

    assert _get_pair_texts(kept) == [("confirmed", ["1. 목적", "1. Purpose"])]
    assert [pair["id"] for pair in refreshed["pairs"]][0] == confirmed_id
    assert _get_pair_texts(refreshed) == [
        ("confirmed", ["1. 목적", "1. Purpose"]),
        ("suggested", [
            "합성 장비의 전원을 켠다.", "합성 기록은 보관한다.", "Turn on the synthetic unit.", "Synthetic records are kept.",
        ]),
    ]


def test_verify_document_coverage_raises_on_broken_units(client: TestClient) -> None:
    bundle = create_bundle(client)
    doc = _upload_ready(client, bundle["id"], _interleaved_docx(), OLD_NAME)
    view = get_view(client, bundle["id"], doc["id"])
    victim = find_unit(view, "합성 기록은 보관한다.")

    async def _break_and_verify(session: AsyncSession) -> None:
        await session.execute(update(Unit).where(Unit.id == victim["id"]).values(spans=[]))
        await verify_document_coverage(session, doc["id"])

    with pytest.raises(RuntimeError, match=rf"document {doc['id']}: 1 problem") as raised:
        run_in_session(_break_and_verify)
    assert "합성" not in str(raised.value)  # 버그 가드 메시지에도 원문 글자를 싣지 않는다


def test_view_of_rejected_document_is_empty(client: TestClient) -> None:
    bundle = create_bundle(client)
    rejected = upload(client, bundle["id"], b"Synthetic plain text", "SYNTHETIC_OLD-2 notes.txt").json()

    view = get_view(client, bundle["id"], rejected["id"])

    assert view["extraction"] is None
    assert (view["tables"], view["blocks"], view["units"], view["pairs"]) == ([], [], [], [])


def test_view_query_count_does_not_grow_with_units(client: TestClient) -> None:
    bundle = create_bundle(client)
    small = _upload_ready(client, bundle["id"], _interleaved_docx(), OLD_NAME)
    many = "".join(p(f"합성 문장 {n}이다. Synthetic sentence {n}.") for n in range(40))
    large = _upload_ready(
        client, bundle["id"], build_docx(many + tbl([["가", "A", "나"], ["다", "B", "라"], ["마", "C", "바"]])),
        "SYNTHETIC_OLD-3_Large.docx",
    )

    with _count_queries() as small_queries:
        small_view = get_view(client, bundle["id"], small["id"])
    with _count_queries() as large_queries:
        large_view = get_view(client, bundle["id"], large["id"])

    assert len(large_view["units"]) > 4 * len(small_view["units"])
    assert len(large_queries) == len(small_queries)
