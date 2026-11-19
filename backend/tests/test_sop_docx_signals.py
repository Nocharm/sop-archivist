"""DOCX 구조 신호 — 번호 범위·목차·띠 표·표 꼴·안쪽 표 자리를 블록·표의 signals에 남기고, 띠 표 번호로 절 경로를 잡는다."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.extract.docx_reader import read_docx
from app.sop.extract.types import EXTRACTOR_VERSION, ExtractResult
from app.sop.models import Extraction, SourceBlock, SourceTable
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, make_grid_table, make_list, make_row, make_style, numbered, p
from tests.sop_helpers import create_bundle, upload
from tests.test_sop_docx_reader import LIMITS, TEMPLATE_HEADING_LIST, TEMPLATE_HEADING_STYLES

# 띠 표 열 폭 0.9 / 0.4 / 8.0 cm, 작업 표 2.8 / 14.2 cm (twip, 1 cm = 567)
BAND_WIDTHS = [510, 227, 4536]
WORK_WIDTHS = [1588, 8051]


def _band(number: str, title: str) -> str:
    return make_grid_table(3, make_row([number, "", title]), BAND_WIDTHS)


def _read(body: str, **parts: str) -> ExtractResult:
    return read_docx(build_docx(body, **parts), LIMITS)


def _signals(result: ExtractResult) -> list[tuple[str, dict]]:
    return [(block.text, block.signals) for block in result.blocks]


def test_auto_number_label_range_is_kept_with_its_source() -> None:
    body = p("가", "H1") + p("나", "H2") + p("다", "H3")

    result = _read(body, numbering=TEMPLATE_HEADING_LIST, styles=TEMPLATE_HEADING_STYLES)

    assert _signals(result) == [
        ("1. 가", {"numbers": [[0, 2, "auto"]]}),
        ("1.1. 나", {"numbers": [[0, 4, "auto"]]}),
        ("1.1.1. 다", {"numbers": [[0, 6, "auto"]]}),
    ]


def test_typed_numbers_need_a_dot_and_bullets_count_as_auto_labels() -> None:
    body = (
        p("1.10. 필터를 꺼낸다.") + p("6.1 목적") + p("3 times a day the filter is checked.") + p("차압은 0.8 bar이다.")
        + numbered("덮개를 연다", 1)
    )

    result = _read(body, numbering=make_list(0, [("bullet", "")], [1]))

    assert _signals(result) == [
        ("1.10. 필터를 꺼낸다.", {"numbers": [[0, 5, "typed"]]}),
        ("6.1 목적", {"numbers": [[0, 3, "typed"]]}),
        ("3 times a day the filter is checked.", {}),
        ("차압은 0.8 bar이다.", {}),
        ("• 덮개를 연다", {"numbers": [[0, 1, "auto"]]}),
    ]


def test_same_number_typed_after_the_auto_label_is_one_number() -> None:
    # 자동 번호 "1.1."이 걸린 제목에 같은 번호를 타자로 또 친 문단 — 번호 범위가 둘을 함께 덮는다
    body = p("가", "H1") + p("1.1 목적", "H2") + p("9.9 다른 번호", "H2")

    result = _read(body, numbering=TEMPLATE_HEADING_LIST, styles=TEMPLATE_HEADING_STYLES)

    assert _signals(result)[1:] == [
        ("1.1. 1.1 목적", {"numbers": [[0, 8, "auto"]]}),
        ("1.2. 9.9 다른 번호", {"numbers": [[0, 4, "auto"]]}),
    ]


def test_cell_keeps_paragraph_starts_and_a_number_range_per_paragraph() -> None:
    cell = numbered("덮개를 연다", 1) + p("주의한다.") + numbered("차압을 적는다", 1)
    table = make_grid_table(2, make_row(["A-1", cell]) + make_row([" 7 ", "필터 (Filter)"]))

    result = _read(table, numbering=make_list(0, [("decimal", "%1.")], [1]))

    assert _signals(result) == [
        ("A-1", {"numbers": [[0, 3, "cell"]]}),
        (
            "1. 덮개를 연다\n주의한다.\n2. 차압을 적는다",
            {"numbers": [[0, 2, "auto"], [16, 18, "auto"]], "paras": [0, 10, 16]},
        ),
        (" 7 ", {"numbers": [[1, 2, "cell"]]}),
        ("필터 (Filter)", {}),
    ]


def test_band_table_opens_a_section_counted_by_the_dots_of_its_number() -> None:
    body = (
        p("머리말이다.") + _band("7", "절차 (Procedure)") + p("절차를 따른다.")
        + _band("7.4.", "필터 교체 (Filter change)") + p("필터를 교체한다.")
    )

    result = _read(body)

    assert [(block.text, block.section_label) for block in result.blocks] == [
        ("머리말이다.", ""),
        ("7", "7"), ("", "7"), ("절차 (Procedure)", "7"), ("절차를 따른다.", "7"),
        ("7.4.", "7.4"), ("", "7.4"), ("필터 교체 (Filter change)", "7.4"), ("필터를 교체한다.", "7.4"),
    ]
    assert [table.signals for table in result.tables] == [
        {"widths": BAND_WIDTHS, "band": {"number": "7", "level": 1}},
        {"widths": BAND_WIDTHS, "band": {"number": "7.4", "level": 2}},
    ]
    # 칸 블록은 그대로 표 칸이다 — 제목 수준을 붙이지 않는다(단위 종류·화면이 달라지지 않게)
    assert {block.heading_level for block in result.blocks} == {None}


@pytest.mark.parametrize(
    "rows",
    [
        pytest.param(make_row(["7", "가운데", "절차"]), id="middle_cell_has_text"),
        pytest.param(make_row(["7", "", ""]), id="no_title"),
        pytest.param(make_row(["준비", "", "절차"]), id="first_cell_is_not_a_number"),
        pytest.param(make_row(["7", "", "절차"]) + make_row(["8", "", "기록"]), id="two_rows"),
    ],
)
def test_tables_that_only_resemble_a_band_stay_plain_tables(rows: str) -> None:
    result = _read(p("앞 문단이다.") + make_grid_table(3, rows) + p("뒤 문단이다."))

    assert "band" not in result.tables[0].signals
    assert result.blocks[-1].section_label == ""


def test_inner_tables_keep_their_place_and_mark_the_first_row_of_the_outer_table() -> None:
    # 표형 옛 SOP의 작업 표 — 첫 행 칸 안에 띠 표, 둘째 행 내용 칸의 두 문단 뒤에 값 표
    values = make_grid_table(2, make_row(["항목", "기준"]) + make_row(["차압", "0.8 bar"]))
    first_cell = p("") + _band("7.1", "준비 (Preparation)")
    content_cell = p("필터를 꺼낸다.") + p("기준은 아래와 같다.") + values + p("기록한다.")
    work = make_grid_table(
        2, make_row([first_cell], spans=[2]) + make_row(["준비", content_cell]), WORK_WIDTHS
    )

    result = _read(work + p("표 뒤 문단이다."))

    outer, band, inner = result.tables
    assert outer.signals == {"widths": WORK_WIDTHS, "first_row": [[0, "band"]]}
    assert band.signals == {
        "widths": BAND_WIDTHS, "band": {"number": "7.1", "level": 2}, "place": {"row": 0, "col": 0, "para": 1},
    }
    assert (band.parent_index, inner.parent_index) == (outer.index, outer.index)
    assert inner.signals == {"widths": [2000, 2000], "place": {"row": 1, "col": 1, "para": 2}}
    # 안쪽 띠 표도 절을 연다 — 바깥 표의 뒤 칸과 표 뒤 문단이 그 절이다
    labels = {block.text: block.section_label for block in result.blocks}
    assert (labels["준비"], labels["표 뒤 문단이다."]) == ("7.1", "7.1")
    content = next(block for block in result.blocks if block.text.startswith("필터를 꺼낸다."))
    assert content.signals == {"paras": [0, 9, 21]}


def _field(kind: str) -> str:
    return f'<w:r><w:fldChar w:fldCharType="{kind}"/></w:r>'


def _run(text: str) -> str:
    return f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'


def _toc_entry(text: str, page: str, *, head: str = "", tail: str = "") -> str:
    """목차 줄 하나 — 줄마다 쪽 번호 필드(PAGEREF)를 품는다."""
    page_field = _field("begin") + '<w:r><w:instrText> PAGEREF _Toc1 \\h </w:instrText></w:r>' + _field("separate")
    return f"<w:p>{head}{_run(text)}<w:r><w:tab/></w:r>{page_field}{_run(page)}{_field('end')}{tail}</w:p>"


def test_toc_field_result_paragraphs_are_marked_and_the_text_after_it_is_not() -> None:
    toc_head = _field("begin") + '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h </w:instrText></w:r>' + _field("separate")
    body = (
        p("목차")
        + _toc_entry("1. 목적", "3", head=toc_head)
        + _toc_entry("2. 범위", "4")
        + f"<w:p>{_field('end')}</w:p>"
        + f"<w:p>{_field('begin')}<w:r><w:instrText> PAGE </w:instrText></w:r>{_field('separate')}{_run('5')}{_field('end')}"
        + f"{_run(' 쪽부터 본문이다.')}</w:p>"
    )

    result = _read(body)

    assert _signals(result) == [
        ("목차", {}),
        ("1. 목적\t3", {"numbers": [[0, 2, "typed"]], "toc": ["field"]}),
        ("2. 범위\t4", {"numbers": [[0, 2, "typed"]], "toc": ["field"]}),
        ("5 쪽부터 본문이다.", {}),
    ]


def test_toc_style_content_control_and_dot_leaders_are_separate_reasons() -> None:
    gallery = '<w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj></w:sdtPr>'
    dot_tab = '<w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs></w:pPr>'
    body = (
        f"<w:sdt>{gallery}<w:sdtContent>{p('목차 제목')}{p('1 목적', 'TOC1')}</w:sdtContent></w:sdt>"
        + p("2 범위 ........ 4", "TOC1")
        + p("관련 서식 : 합성 기록지 ........ 별첨")
        + f"<w:p>{dot_tab}{_run('3 책임')}<w:r><w:tab/></w:r>{_run('5')}</w:p>"
        + p("이름\t값")
        + p("본문 문장이다.")
    )

    result = _read(body, styles=make_style("TOC1", "toc 1"))

    assert [(block.text, block.signals.get("toc")) for block in result.blocks] == [
        ("목차 제목", ["sdt"]),
        ("1 목적", ["style", "sdt"]),
        ("2 범위 ........ 4", ["style", "leader"]),
        ("관련 서식 : 합성 기록지 ........ 별첨", ["leader"]),
        ("3 책임\t5", ["leader"]),
        ("이름\t값", None),
        ("본문 문장이다.", None),
    ]


def test_toc_reasons_are_only_read_in_the_body() -> None:
    result = _read(p("본문 문장이다."), headers=[p("머리말 ........ 1", "TOC1")], styles=make_style("TOC1", "toc 1"))

    assert _signals(result) == [("본문 문장이다.", {}), ("머리말 ........ 1", {})]


def test_upload_stores_signals_and_leaves_plain_blocks_null(client: TestClient) -> None:
    bundle = create_bundle(client)
    body = _band("7.4", "필터 교체 (Filter change)") + p("필터를 교체한다.") + p("1.1. 덮개를 연다.")

    response = upload(client, bundle["id"], build_docx(body), "SYNTHETIC_Band_Table.docx")

    assert response.status_code == 201, response.text
    document_id = response.json()["id"]

    async def _load(session: AsyncSession) -> tuple[str, list, list]:
        extraction = (await session.scalars(select(Extraction).where(Extraction.document_id == document_id))).one()
        blocks = await session.execute(
            select(SourceBlock.text, SourceBlock.section_label, SourceBlock.signals)
            .where(SourceBlock.extraction_id == extraction.id).order_by(SourceBlock.seq)
        )
        tables = await session.scalars(select(SourceTable.signals).where(SourceTable.extraction_id == extraction.id))
        return extraction.extractor_version, [tuple(row) for row in blocks], list(tables)

    version, blocks, tables = run_in_session(_load)
    assert version == EXTRACTOR_VERSION == "5"
    assert blocks == [
        ("7.4", "7.4", {"numbers": [[0, 3, "cell"]]}),
        ("", "7.4", None),
        ("필터 교체 (Filter change)", "7.4", None),
        ("필터를 교체한다.", "7.4", None),
        ("1.1. 덮개를 연다.", "7.4", {"numbers": [[0, 4, "typed"]]}),
    ]
    assert tables == [{"widths": BAND_WIDTHS, "band": {"number": "7.4", "level": 2}}]
