"""DOCX 메인 추출기 — 부분 순서·감싸는 요소·상자·병합 칸·표 안 표·제목·쪽·그림·자동 번호·거절 규칙."""

import pickle
import struct
import tracemalloc
import zipfile
from dataclasses import replace
from io import BytesIO

import pytest

from app.sop.extract.docx_reader import read_docx
from app.sop.extract.types import ExtractedWarning, ExtractionRejected, ExtractLimits
from tests.docx_factory import (
    make_list,
    numbered,
    NAMESPACES,
    TINY_PNG,
    build_docx,
    get_media_rel_id,
    make_drawing_run,
    make_textbox_run,
    p,
    tbl,
)

LIMITS = ExtractLimits(
    max_unzipped_bytes=20 * 1024 * 1024,
    max_zip_entries=100,
    max_compression_ratio=100,
    max_pdf_pages=500,
    max_chars=100_000,
)
NUMBERED = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'


def _read(body_xml: str, **parts: object) -> list:
    return list(read_docx(build_docx(body_xml, **parts), LIMITS).blocks)


def _rewrite_zip(data: bytes, entries: dict[str, bytes | None]) -> bytes:
    """zip 항목 바꾸기·더하기(None은 빼기) — 팩토리가 만들지 않는 망가진 파일을 흉내 낸다."""
    buffer = BytesIO()
    with zipfile.ZipFile(BytesIO(data)) as source, zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            if info.filename not in entries:
                target.writestr(info, source.read(info))
        for name, content in entries.items():
            if content is not None:
                target.writestr(name, content)
    return buffer.getvalue()


def _patch_declared_size(data: bytes, name: str, size: int) -> bytes:
    """중앙 디렉터리에 적힌 항목의 풀린 크기만 바꾼다 — 크기를 속여 헤더 검사를 지나가는 압축 폭탄."""
    patched = bytearray(data)
    position = patched.find(b"PK\x01\x02")
    while position >= 0:
        name_length = struct.unpack_from("<H", patched, position + 28)[0]
        if bytes(patched[position + 46 : position + 46 + name_length]) == name.encode():
            struct.pack_into("<I", patched, position + 24, size)
        position = patched.find(b"PK\x01\x02", position + 4)
    return bytes(patched)


def test_docx_paragraph_order_and_parts() -> None:
    blocks = _read(
        p("  첫 문단 & <A>  ") + p("둘째 문단"),
        headers=[p("머리말")],
        footers=[p("꼬리말")],
        footnotes=[p("각주")],
    )

    assert [b.part for b in blocks] == ["body", "body", "header", "footer", "footnote"]
    assert [b.text for b in blocks] == ["  첫 문단 & <A>  ", "둘째 문단", "머리말", "꼬리말", "각주"]
    assert [b.seq for b in blocks] == [0, 1, 2, 3, 4]
    # 구분선 각주 둘(footnote[1]·[2])은 건너뛰지만 경로 순번에는 그대로 센다
    assert [b.xml_path for b in blocks] == [
        "document/body/p[1]",
        "document/body/p[2]",
        "header1/p[1]",
        "footer1/p[1]",
        "footnotes/footnote[3]/p[1]",
    ]
    assert [b.page for b in blocks] == [1, 1, None, None, None]
    assert {b.kind for b in blocks} == {"paragraph"}


def test_docx_endnotes_follow_footnotes() -> None:
    blocks = _read(p("본문"), footnotes=[p("각주")], endnotes=[p("미주 하나"), p("미주 둘")])

    assert [(b.part, b.text) for b in blocks] == [
        ("body", "본문"),
        ("footnote", "각주"),
        ("endnote", "미주 하나"),
        ("endnote", "미주 둘"),
    ]
    assert blocks[3].xml_path == "endnotes/endnote[4]/p[1]"


def test_docx_keeps_text_inside_wrappers() -> None:
    body = (
        # 문단 속성의 탭 위치 정의(w:tabs/w:tab)는 글자가 아니다
        '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>'
        '<w:hyperlink w:anchor="sec1"><w:r><w:t>A</w:t></w:r></w:hyperlink>'
        "<w:r><w:tab/></w:r>"
        '<w:sdt><w:sdtPr><w:alias w:val="필드"/></w:sdtPr><w:sdtContent><w:r><w:t>B</w:t></w:r></w:sdtContent></w:sdt>'
        "<w:r><w:br/></w:r>"
        '<w:smartTag w:uri="urn:x" w:element="place"><w:r><w:t>C</w:t></w:r></w:smartTag>'
        '<w:r><w:t xml:space="preserve"> </w:t></w:r>'
        '<w:fldSimple w:instr=" DOCPROPERTY Owner "><w:r><w:t>D</w:t></w:r></w:fldSimple>'
        # 목록에 없는 감싸는 요소(양방향 dir) 속 customXml 속 하이퍼링크도 일반 하강으로 읽는다
        '<w:dir w:val="ltr"><w:customXml w:element="x"><w:hyperlink w:anchor="sec2">'
        '<w:r><w:t xml:space="preserve"> E</w:t></w:r></w:hyperlink></w:customXml></w:dir>'
        "</w:p>"
        "<w:p><w:r>"
        "<w:t>x</w:t><w:noBreakHyphen/><w:t>y</w:t><w:cr/><w:t>z</w:t><w:softHyphen/><w:t>w</w:t>"
        '<w:sym w:font="Wingdings" w:char="F0FC"/><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="none"/>'
        '<w:t>v</w:t><w:br w:type="page"/><w:t>u</w:t>'
        "</w:r></w:p>"
        "<w:p><w:r><w:t xml:space=\"preserve\">식 </w:t></w:r>"
        "<m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath></w:p>"
    )

    blocks = _read(body)

    assert [b.text for b in blocks] == ["A\tB\nC D E", "x-y\nzw\tvu", "식 x=1"]


def test_docx_reads_block_level_wrappers() -> None:
    body = (
        '<w:sdt><w:sdtPr><w:alias w:val="블록"/></w:sdtPr><w:sdtContent>'
        + p("상자 안 문단")
        + "</w:sdtContent></w:sdt>"
        + '<w:customXml w:element="part">'
        + tbl([["칸"]])
        + "</w:customXml>"
    )

    blocks = _read(body)

    assert [(b.kind, b.text, b.xml_path) for b in blocks] == [
        ("paragraph", "상자 안 문단", "document/body/sdt[1]/sdtContent[1]/p[1]"),
        ("table_cell", "칸", "document/body/customXml[1]/tbl[1]/tr[1]/tc[1]"),
    ]


def test_docx_skips_field_instructions() -> None:
    body = (
        '<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>'
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
        '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
        "<w:r><w:t>3</w:t></w:r>"
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    )

    blocks = _read(body)

    assert [b.text for b in blocks] == ["Page 3"]
    assert "PAGE" not in blocks[0].text


def test_docx_textbox_once() -> None:
    body = (
        '<w:p><w:r><w:t xml:space="preserve">앞 </w:t></w:r>'
        + make_textbox_run(p("상자 글"))
        + "<w:r><w:t>뒤</w:t></w:r></w:p>"
        + p("다음 문단")
    )

    blocks = _read(body)

    # 도형은 그림 블록이 되고, 상자 글은 담은 문단 바로 뒤에 한 번만 나온다(Fallback은 읽지 않는다)
    assert [(b.part, b.kind, b.text) for b in blocks] == [
        ("body", "paragraph", "앞 뒤"),
        ("body", "figure", ""),
        ("textbox", "paragraph", "상자 글"),
        ("body", "paragraph", "다음 문단"),
    ]
    assert blocks[2].xml_path == "document/body/p[1]/txbx[1]/p[1]"
    assert blocks[2].page == 1


def test_docx_merged_cells_not_duplicated() -> None:
    # 보이는 모양은 2×2 — 왼쪽 열은 두 행이 vMerge로 한 칸, 오른쪽 칸들은 격자 두 열을 gridSpan=2로 차지한다
    body = (
        '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>'
        '<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>' + p("왼쪽") + "</w:tc>"
        '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' + p("오른쪽 위") + "</w:tc></w:tr>"
        "<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>" + p("") + "</w:tc>"
        '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' + p("오른쪽 아래") + "</w:tc></w:tr>"
        "</w:tbl>"
    )

    result = read_docx(build_docx(body), LIMITS)

    cells = [(b.text, b.row_index, b.col_index, b.grid_span, b.row_span) for b in result.blocks]
    assert cells == [("왼쪽", 0, 0, 1, 2), ("오른쪽 위", 0, 1, 2, 1), ("오른쪽 아래", 1, 1, 2, 1)]
    assert all(b.kind == "table_cell" and b.table_index == 0 for b in result.blocks)
    assert all("merged_cell" in b.flags for b in result.blocks)
    assert result.warnings == (ExtractedWarning(kind="merged_cell", block_seq=0, detail={"table_index": "0"}),)
    assert [(t.index, t.n_rows, t.n_cols) for t in result.tables] == [(0, 2, 3)]


def test_docx_nested_table_path() -> None:
    inner = tbl([["안 하나", "안 둘"]])
    body = (
        '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid><w:tr>'
        f"<w:tc>{p('바깥 칸')}{inner}{p('')}</w:tc><w:tc>{p('바깥 둘')}</w:tc>"
        "</w:tr></w:tbl>"
    )

    result = read_docx(build_docx(body), LIMITS)

    assert [(b.text, b.table_index, b.col_index) for b in result.blocks] == [
        ("바깥 칸\n", 0, 0),
        ("안 하나", 1, 0),
        ("안 둘", 1, 1),
        ("바깥 둘", 0, 1),
    ]
    assert result.blocks[1].xml_path == "document/body/tbl[1]/tr[1]/tc[1]/tbl[1]/tr[1]/tc[1]"
    assert [(t.index, t.parent_index, t.xml_path) for t in result.tables] == [
        (0, None, "document/body/tbl[1]"),
        (1, 0, "document/body/tbl[1]/tr[1]/tc[1]/tbl[1]"),
    ]


def test_docx_keeps_merged_continuation_content() -> None:
    # 생성 도구가 만든 파일은 vMerge 이어지는 칸에도 글을 남긴다 — 버리지 않고 제자리 칸 블록으로 낸다
    body = (
        '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>'
        '<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>' + p("위") + "</w:tc>"
        "<w:tc>" + p("오른쪽 1") + "</w:tc></w:tr>"
        "<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>" + p("숨은 글") + "</w:tc><w:tc>" + p("오른쪽 2") + "</w:tc></w:tr>"
        "<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>" + p("") + "</w:tc><w:tc>" + p("오른쪽 3") + "</w:tc></w:tr>"
        "</w:tbl>"
    )

    result = read_docx(build_docx(body), LIMITS)

    # 빈 이어지는 칸(셋째 행)은 여전히 블록을 만들지 않고, 시작 칸의 row_span은 세 행을 덮는다
    assert [(b.text, b.row_index, b.col_index, b.row_span, b.flags) for b in result.blocks] == [
        ("위", 0, 0, 3, ("merged_cell",)),
        ("오른쪽 1", 0, 1, 1, ()),
        ("숨은 글", 1, 0, 1, ("merged_cell",)),
        ("오른쪽 2", 1, 1, 1, ()),
        ("오른쪽 3", 2, 1, 1, ()),
    ]
    assert result.warnings == (
        ExtractedWarning(kind="merged_cell", block_seq=0, detail={"table_index": "0"}),
        ExtractedWarning(kind="merged_cell_content", block_seq=2, detail={"table_index": "0", "count": "1"}),
    )


def test_docx_merged_continuation_keeps_nested_table() -> None:
    body = (
        '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>'
        '<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>' + p("위") + "</w:tc></w:tr>"
        "<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>" + p("") + tbl([["안쪽"]]) + p("") + "</w:tc></w:tr>"
        "</w:tbl>"
    )

    result = read_docx(build_docx(body), LIMITS)

    assert [(b.text, b.table_index, b.row_index, b.flags) for b in result.blocks] == [
        ("위", 0, 0, ("merged_cell",)),
        ("\n", 0, 1, ("merged_cell",)),
        ("안쪽", 1, 0, ()),
    ]
    assert [(t.index, t.parent_index) for t in result.tables] == [(0, None), (1, 0)]
    assert [w.kind for w in result.warnings] == ["merged_cell", "merged_cell_content"]


def test_docx_rendered_pages_per_table_row() -> None:
    # 한 행의 칸들은 나란히 흐른다 — 두 칸이 모두 다음 쪽으로 넘어가도 문서는 한 쪽만 넘어간다
    split_cell = "<w:tc><w:p><w:r><w:t>{0}</w:t></w:r><w:r><w:lastRenderedPageBreak/><w:t>{0} 뒤</w:t></w:r></w:p></w:tc>"
    body = (
        p("앞")
        + '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>'
        + "<w:tr>" + split_cell.format("칸1") + split_cell.format("칸2") + "</w:tr>"
        # 마지막 칸이 넘어가지 않아도 행 뒤는 가장 멀리 간 칸(앞 칸)을 따른다
        + "<w:tr>" + split_cell.format("칸3") + "<w:tc>" + p("칸4") + "</w:tc></w:tr>"
        + "<w:tr><w:tc>" + p("셋째 행") + "</w:tc><w:tc>" + p("") + "</w:tc></w:tr>"
        + "</w:tbl>"
        + p("뒤")
    )

    blocks = _read(body)

    assert [(b.text, b.page) for b in blocks] == [
        ("앞", 1),
        ("칸1칸1 뒤", 1),
        ("칸2칸2 뒤", 1),
        ("칸3칸3 뒤", 2),
        ("칸4", 2),
        ("셋째 행", 3),
        ("", 3),
        ("뒤", 3),
    ]
    assert {b.page_basis for b in blocks} == {"rendered"}


def test_docx_figure_inside_table_cell() -> None:
    images = f"<w:p>{make_drawing_run('image1.png')}{make_drawing_run('image2.png')}</w:p>"
    body = (
        '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid><w:tr>'
        f"<w:tc>{p('칸 글')}{images}{p('그림 3 캡션')}</w:tc><w:tc>{p('옆 칸')}</w:tc>"
        "</w:tr></w:tbl>"
    )

    blocks = _read(body, media={"image1.png": TINY_PNG, "image2.png": TINY_PNG})

    # 칸 안 그림은 그림마다 칸 블록 바로 뒤에 나오고, 캡션은 묶지 않아 칸 글에 그대로 남는다
    assert [(b.kind, b.text, b.table_index, b.row_index, b.col_index, b.image_part) for b in blocks] == [
        ("table_cell", "칸 글\n\n그림 3 캡션", 0, 0, 0, None),
        ("figure", "", 0, 0, 0, "word/media/image1.png"),
        ("figure", "", 0, 0, 0, "word/media/image2.png"),
        ("table_cell", "옆 칸", 0, 0, 1, None),
    ]
    assert blocks[1].xml_path == "document/body/tbl[1]/tr[1]/tc[1]/p[2]"


def test_docx_picture_only_in_table_cell_is_not_empty() -> None:
    body = (
        '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr>'
        f"<w:tc><w:p>{make_drawing_run('image1.png')}</w:p></w:tc></w:tr></w:tbl>"
    )

    blocks = _read(body, media={"image1.png": TINY_PNG})

    assert [(b.kind, b.text, b.image_part) for b in blocks] == [
        ("table_cell", "", None),
        ("figure", "", "word/media/image1.png"),
    ]


def test_docx_long_xml_path_is_shortened() -> None:
    # source_blocks·source_tables.xml_path는 500자 — 첫 조각과 끝을 남기고 가운데를 줄인다
    depth = 60
    body = '<w:customXml w:element="x">' * depth + tbl([["깊은 칸"]]) + "</w:customXml>" * depth

    result = read_docx(build_docx(body), LIMITS)

    block, table = result.blocks[0], result.tables[0]
    assert block.text == "깊은 칸"
    assert len(block.xml_path) == 500
    assert block.xml_path.startswith("document/…/")
    assert block.xml_path.endswith("/customXml[1]/tbl[1]/tr[1]/tc[1]")
    assert len(table.xml_path) == 500
    assert table.xml_path.startswith("document/…/")
    assert table.xml_path.endswith("/customXml[1]/tbl[1]")


def test_docx_too_long_image_part_is_dropped_with_a_flag() -> None:
    # source_blocks.image_part는 200자 — 더 긴 관계 대상(조작한 DOCX)은 저장하지 않고 블록에 표시만 남긴다(문단·칸 그림 모두)
    too_long, longest = "a" * 190 + ".png", "b" * 185 + ".png"  # word/media/ 를 붙이면 205자, 200자
    body = (
        f"<w:p>{make_drawing_run(too_long)}</w:p>"
        '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr>'
        f"<w:tc><w:p>{make_drawing_run(too_long)}</w:p></w:tc></w:tr></w:tbl>"
        f"<w:p>{make_drawing_run(longest)}</w:p>"
    )

    blocks = _read(body, media={too_long: TINY_PNG, longest: TINY_PNG})

    assert [(b.image_part, b.flags) for b in blocks if b.kind == "figure"] == [
        (None, ("image_part_too_long",)),
        (None, ("image_part_too_long",)),
        (f"word/media/{longest}", ()),
    ]


def test_docx_long_clause_number_label_fits_the_column() -> None:
    # source_blocks.section_label은 200자 — 조항 번호로 쓰는 앞머리 숫자 묶음이 그보다 길어도 잘라 넣는다
    number = ".".join(["1"] * 150)

    blocks = _read(p(f"{number} 제목", "Heading1") + p("본문"))

    assert [b.section_label for b in blocks] == [number[:200], number[:200]]


def test_docx_headings_and_section_labels() -> None:
    body = (
        p("5. 절차", "Heading1")
        + p("본문 하나")
        + p("Scope", "Heading2")
        + p("본문 둘")
        + p("5.1")
        + p("본문 셋")
        + '<w:p><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:r><w:t>개요 수준</w:t></w:r></w:p>'
        + p("목차 제목", "제목1")
        + tbl([["칸 글"]])
    )

    blocks = _read(body, headers=[p("머리말")])

    assert [(b.text, b.heading_level, b.section_label) for b in blocks] == [
        ("5. 절차", 1, "5"),
        ("본문 하나", None, "5"),
        ("Scope", 2, "Scope"),
        ("본문 둘", None, "Scope"),
        ("5.1", None, "5.1"),
        ("본문 셋", None, "5.1"),
        ("개요 수준", 3, "개요 수준"),
        ("목차 제목", 1, "목차 제목"),
        ("칸 글", None, "목차 제목"),
        ("머리말", None, ""),
    ]
    assert blocks[4].flags == ("clause_number",)
    assert all("clause_number" not in b.flags for i, b in enumerate(blocks) if i != 4)


@pytest.mark.parametrize(
    ("body", "basis", "pages"),
    [
        (
            p("가")
            + '<w:p><w:r><w:lastRenderedPageBreak/><w:t>나</w:t></w:r></w:p>'
            + '<w:p><w:r><w:t>다</w:t><w:br w:type="page"/></w:r></w:p>'
            + p("라"),
            "rendered",
            [1, 2, 2, 2],
        ),
        (
            '<w:p><w:r><w:t>가</w:t><w:br w:type="page"/></w:r></w:p>' + p("나") + p("다"),
            "manual",
            [1, 2, 2],
        ),
        (p("가" * 1800) + p("나") + tbl([["다"]]), "estimated", [1, 2, 2]),
    ],
    ids=["rendered", "manual", "estimated"],
)
def test_docx_pages_rendered_manual_estimated(body: str, basis: str, pages: list[int]) -> None:
    blocks = _read(body, footers=[p("꼬리말")])

    assert [b.page for b in blocks] == [*pages, None]
    assert {b.page_basis for b in blocks} == {basis}


def test_docx_figure_with_caption() -> None:
    body = p("앞 문단") + f"<w:p>{make_drawing_run('image1.png')}</w:p>" + p("그림 1 로터", "Caption") + p("뒤 문단")

    blocks = _read(body, media={"image1.png": TINY_PNG})

    assert [(b.kind, b.text) for b in blocks] == [
        ("paragraph", "앞 문단"),
        ("figure", "그림 1 로터"),
        ("paragraph", "뒤 문단"),
    ]
    assert blocks[1].image_part == "word/media/image1.png"
    assert blocks[1].xml_path == "document/body/p[2]"


def test_docx_figure_takes_caption_from_previous_paragraph() -> None:
    body = (
        p("Figure 2 Pump")
        + f'<w:p><w:r><w:t xml:space="preserve">설명 </w:t></w:r>{make_drawing_run("image1.png")}</w:p>'
        + p("뒤 문단")
    )

    blocks = _read(body, media={"image1.png": TINY_PNG})

    # 그림 문단의 다른 글자는 그 문단 블록으로 먼저 나오고, 다음 문단이 캡션이 아니면 앞 문단을 캡션으로 묶는다
    assert [(b.kind, b.text) for b in blocks] == [
        ("paragraph", "설명 "),
        ("figure", "Figure 2 Pump"),
        ("paragraph", "뒤 문단"),
    ]


def test_docx_vml_picture_is_figure() -> None:
    # Word 2003 시절 그림(w:pict + v:imagedata)은 a:blip이 없어 VML 관계로 그림 파일을 찾는다
    body = (
        '<w:p><w:r><w:pict><v:shape style="width:10pt;height:10pt">'
        f'<v:imagedata r:id="{get_media_rel_id("image1.png")}" o:title=""/></v:shape></w:pict></w:r></w:p>'
    )

    blocks = _read(body, media={"image1.png": TINY_PNG})

    assert [(b.kind, b.text, b.image_part) for b in blocks] == [("figure", "", "word/media/image1.png")]


def test_docx_reads_fallback_when_no_choice() -> None:
    body = (
        '<w:p><w:r><w:t xml:space="preserve">앞 </w:t></w:r><mc:AlternateContent><mc:Fallback>'
        "<w:r><w:t>대체 글</w:t></w:r></mc:Fallback></mc:AlternateContent></w:p>"
    )

    blocks = _read(body)

    assert [b.text for b in blocks] == ["앞 대체 글"]


def test_docx_style_chain_numbering_and_outline() -> None:
    # 회사 양식은 번호·개요 수준을 스타일(과 그 basedOn 조상)에 둔다. 개요 수준 9·numId 0은 "끔"이다
    styles = (
        f"<w:styles {NAMESPACES}>"
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
        '<w:pPr><w:numPr><w:numId w:val="5"/></w:numPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="SopTitle"><w:name w:val="SOP Title"/><w:basedOn w:val="Heading1"/>'
        "</w:style>"
        '<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/>'
        '<w:basedOn w:val="Heading1"/><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr><w:outlineLvl w:val="9"/>'
        "</w:pPr></w:style></w:styles>"
    ).encode()
    body = p("목적", "Heading1") + p("양식 제목", "SopTitle") + p("목차", "TOCHeading")
    data = _rewrite_zip(build_docx(body), {"word/styles.xml": styles})

    result = read_docx(data, LIMITS)

    assert [(b.text, b.heading_level, b.flags) for b in result.blocks] == [
        ("목적", 1, ("auto_numbering",)),
        ("양식 제목", 1, ("auto_numbering",)),
        ("목차", None, ()),
    ]
    assert result.warnings == (ExtractedWarning(kind="auto_numbering", block_seq=None, detail={"count": "2"}),)


def test_docx_auto_numbering_warning() -> None:
    # 번호 부분(numbering.xml)이 없어 번호를 풀지 못한 문단만 표시·경고가 남는다
    body = (
        f"<w:p>{NUMBERED}<w:r><w:t>첫 항목</w:t></w:r></w:p>"
        f"<w:p>{NUMBERED}<w:r><w:t>둘째 항목</w:t></w:r></w:p>"
        '<w:p><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>번호 끔</w:t></w:r></w:p>'
        + p("번호 없음")
    )

    result = read_docx(build_docx(body), LIMITS)

    assert [b.flags for b in result.blocks] == [("auto_numbering",), ("auto_numbering",), (), ()]
    assert result.warnings == (ExtractedWarning(kind="auto_numbering", block_seq=None, detail={"count": "2"}),)


DECIMAL_LEVELS = [("decimal", "%1."), ("decimal", "%1.%2"), ("lowerLetter", "%3)")]


def test_docx_writes_list_numbers_into_the_text() -> None:
    # 카운터는 문서 순서로 늘고, 위 수준이 나아가면 아래 수준은 처음부터 다시 센다
    body = (
        numbered("첫 항목", 1)
        + numbered("아래 하나", 1, 1)
        + numbered("아래 둘", 1, 1)
        + numbered("더 아래", 1, 2)
        + p("번호 없는 줄")
        + numbered("둘째 항목", 1)
        + numbered("다시 아래", 1, 1)
    )

    result = read_docx(build_docx(body, numbering=make_list(0, DECIMAL_LEVELS, [1])), LIMITS)

    assert [b.text for b in result.blocks] == [
        "1. 첫 항목", "1.1 아래 하나", "1.2 아래 둘", "a) 더 아래", "번호 없는 줄", "2. 둘째 항목", "2.1 다시 아래",
    ]
    assert all(b.flags == () for b in result.blocks)
    assert result.warnings == ()


@pytest.mark.parametrize(
    ("fmt", "labels"),
    [
        ("decimal", ["1", "2", "3"]),
        ("decimalZero", ["01", "02", "03"]),
        ("lowerLetter", ["a", "b", "c"]),
        ("upperLetter", ["A", "B", "C"]),
        ("lowerRoman", ["i", "ii", "iii"]),
        ("upperRoman", ["I", "II", "III"]),
        ("ganada", ["가", "나", "다"]),
        ("chosung", ["ㄱ", "ㄴ", "ㄷ"]),
        ("decimalEnclosedCircle", ["①", "②", "③"]),
        ("koreanCounting", ["1", "2", "3"]),
    ],
)
def test_docx_number_formats(fmt: str, labels: list[str]) -> None:
    body = "".join(numbered("항목", 1) for _ in labels)

    blocks = _read(body, numbering=make_list(0, [(fmt, "%1.")], [1]))

    assert [b.text for b in blocks] == [f"{label}. 항목" for label in labels]


def test_docx_letter_and_roman_numbers_past_the_first_cycle() -> None:
    body = "".join(numbered("x", 1) + numbered("y", 2) for _ in range(28))

    blocks = _read(body, numbering=make_list(0, [("lowerLetter", "%1)")], [1]) + make_list(1, [("upperRoman", "%1.")], [2]))

    assert [blocks[index].text for index in (50, 52, 54)] == ["z) x", "aa) x", "bb) x"]
    assert [blocks[index].text for index in (7, 17, 55)] == ["IV. y", "IX. y", "XXVIII. y"]


@pytest.mark.parametrize("start", ["99999999", "9" * 5000])
def test_docx_huge_number_start_cannot_blow_up_the_label(start: str) -> None:
    # 조작한 시작 값: 글자 번호가 값에 비례해 길어지면 문단 하나가 메모리를 다 쓴다
    numbering = make_list(0, [("lowerLetter", "%1)" + "%1" * 400)], [1]).replace('w:start w:val="1"', f'w:start w:val="{start}"')

    blocks = _read(numbered("x", 1), numbering=numbering)

    assert len(blocks[0].text) < 2000


def test_docx_bullets_become_a_plain_mark() -> None:
    # Symbol·Wingdings 글꼴의 사설 영역 글자와 글자 모양 표("o")는 "•"로, 뜻이 남는 기호는 그대로 쓴다
    lists = (
        make_list(0, [("bullet", "\uf0b7"), ("bullet", "o")], [1]) + make_list(1, [("bullet", "-")], [2])
    )

    blocks = _read(numbered("가", 1) + numbered("나", 1, 1) + numbered("다", 2), numbering=lists)

    assert [b.text for b in blocks] == ["• 가", "• 나", "- 다"]


def test_docx_numbers_headings_through_style_linked_lists() -> None:
    # 제목 스타일이 목록에 묶인 문서 — 문단에는 numPr가 없고, 수준은 목록 정의의 pStyle이 정한다
    styles = (
        f"<w:styles {NAMESPACES}>"
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
        '<w:pPr><w:numPr><w:numId w:val="3"/></w:numPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>'
        '<w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="3"/></w:numPr><w:outlineLvl w:val="1"/></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="SopHeading2"><w:name w:val="SOP Heading 2"/>'
        '<w:basedOn w:val="Heading2"/></w:style>'
        "</w:styles>"
    ).encode()
    numbering = (
        '<w:abstractNum w:abstractNumId="7">'
        '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading1"/>'
        '<w:lvlText w:val="%1."/></w:lvl>'
        '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading2"/>'
        '<w:lvlText w:val="%1.%2"/></w:lvl>'
        '</w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="7"/></w:num>'
    )
    body = (
        p("목적", "Heading1") + p("본문 문장.") + p("범위", "Heading1") + p("적용 대상", "Heading2")
        + p("예외", "SopHeading2") + p("책임", "Heading1")
    )
    data = _rewrite_zip(build_docx(body, numbering=numbering), {"word/styles.xml": styles})

    result = read_docx(data, LIMITS)

    assert [(b.text, b.heading_level, b.section_label) for b in result.blocks] == [
        ("1. 목적", 1, "1"),
        ("본문 문장.", None, "1"),
        ("2. 범위", 1, "2"),
        ("2.1 적용 대상", 2, "2.1"),
        ("2.2 예외", 2, "2.2"),
        ("3. 책임", 1, "3"),
    ]
    assert result.warnings == ()


def test_docx_lists_sharing_a_definition_continue_and_overrides_restart() -> None:
    numbering = (
        make_list(0, [("decimal", "%1.")], [1, 2])
        + '<w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/>'
        "</w:lvlOverride></w:num>"
        + '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="5"/><w:numFmt w:val="decimal"/>'
        '<w:lvlText w:val="(%1)"/><w:suff w:val="nothing"/></w:lvl></w:abstractNum>'
        '<w:num w:numId="4"><w:abstractNumId w:val="1"/></w:num>'
    )
    body = (
        numbered("가", 1) + numbered("나", 2) + numbered("다", 3) + numbered("라", 3) + numbered("마", 4) + numbered("바", 4)
    )

    blocks = _read(body, numbering=numbering)

    assert [b.text for b in blocks] == ["1. 가", "2. 나", "1. 다", "2. 라", "(5)마", "(6)바"]


def test_docx_numbers_paragraphs_inside_table_cells() -> None:
    cell = f"<w:tc>{numbered('칸 첫 줄', 1)}{numbered('칸 둘째 줄', 1)}</w:tc>"
    body = numbered("표 앞", 1) + f"<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr>{cell}</w:tr></w:tbl>"

    blocks = _read(body, numbering=make_list(0, [("decimal", "%1.")], [1]))

    assert [(b.kind, b.text, b.flags) for b in blocks] == [
        ("paragraph", "1. 표 앞", ()),
        ("table_cell", "2. 칸 첫 줄\n3. 칸 둘째 줄", ()),
    ]


def test_docx_empty_numbered_paragraph_counts_without_a_block() -> None:
    # Word는 빈 번호 문단에도 번호를 그린다 — 카운터는 나아가지만 번호만 있는 블록은 만들지 않는다
    blocks = _read(numbered("가", 1) + numbered("", 1) + numbered("나", 1), numbering=make_list(0, [("decimal", "%1.")], [1]))

    assert [b.text for b in blocks] == ["1. 가", "3. 나"]


def test_docx_unresolved_numbering_keeps_the_flag() -> None:
    # 목록 정의에 없는 numId·수준은 번호를 붙이지 못한다 — 그 문단만 표시가 남고 경고가 개수를 센다
    body = numbered("풀림", 1) + numbered("모르는 목록", 9) + numbered("없는 수준", 1, 4)

    result = read_docx(build_docx(body, numbering=make_list(0, [("decimal", "%1.")], [1])), LIMITS)

    assert [(b.text, b.flags) for b in result.blocks] == [
        ("1. 풀림", ()), ("모르는 목록", ("auto_numbering",)), ("없는 수준", ("auto_numbering",)),
    ]
    assert result.warnings == (ExtractedWarning(kind="auto_numbering", block_seq=None, detail={"count": "2"}),)


def test_docx_section_references_per_part_are_capped() -> None:
    # 구역이 아주 많은 문서: 구역 표시는 머리말 블록마다 실리므로 부분마다 상한까지만 남긴다
    section = '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/></w:sectPr></w:pPr></w:p>'

    result = read_docx(build_docx(p("본문") + section * 100, headers=[p("머리말")]), LIMITS)

    header = next(block for block in result.blocks if block.part == "header")
    assert len([flag for flag in header.flags if flag.startswith("section_ref:")]) == 24


def test_docx_header_parts_carry_their_section_references() -> None:
    # 구역마다 다른 머리말 — 첫 구역은 문단의 sectPr, 마지막 구역은 본문 끝 sectPr가 건다(build_docx는 끝 구역에 건다)
    first_section = '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rIdHeader2"/></w:sectPr></w:pPr></w:p>'
    body = p("앞 구역") + first_section + p("뒤 구역")

    blocks = _read(body, headers=[p("표준 머리말"), p("표지 머리말")], footers=[p("꼬리말")])

    assert [(b.part, b.xml_path.split("/")[0], b.flags) for b in blocks if b.part != "body"] == [
        ("header", "header1", ("section_ref:2:default",)),
        ("header", "header2", ("section_ref:1:default", "section_ref:2:first")),
        ("footer", "footer1", ("section_ref:2:default",)),
    ]


OLE_BYTES = bytes.fromhex("d0cf11e0a1b11ae1") + b"\0" * 504
INS_BODY = '<w:p><w:ins w:id="1" w:author="qa" w:date="2026-11-05T00:00:00Z"><w:r><w:t>새 글</w:t></w:r></w:ins></w:p>'
DEL_BODY = (
    '<w:p><w:del w:id="1" w:author="qa" w:date="2026-11-05T00:00:00Z"><w:r><w:delText>옛 글</w:delText></w:r>'
    "</w:del><w:r><w:t>남은 글</w:t></w:r></w:p>"
)


@pytest.mark.parametrize(
    ("data", "limits", "code"),
    [
        (OLE_BYTES, LIMITS, "not_a_zip_or_encrypted"),
        (b"not a zip", LIMITS, "not_a_zip_or_encrypted"),
        (build_docx(INS_BODY), LIMITS, "tracked_changes"),
        (build_docx(DEL_BODY), LIMITS, "tracked_changes"),
        (build_docx(p("본문"), headers=[INS_BODY]), LIMITS, "tracked_changes"),
        (
            build_docx('<w:altChunk r:id="rIdAltChunk1"/>' + p("본문"), alt_chunks=["<html><body>x</body></html>"]),
            LIMITS,
            "alt_chunk",
        ),
        (_rewrite_zip(build_docx(p("본문")), {"../evil": b"x"}), LIMITS, "unsafe_zip"),
        (_rewrite_zip(build_docx(p("본문")), {"/abs/evil": b"x"}), LIMITS, "unsafe_zip"),
        (build_docx(p("0123456789")), replace(LIMITS, max_chars=5), "too_many_chars"),
        (build_docx(""), LIMITS, "empty_document"),
        (build_docx(p("​ 　") + tbl([[""]])), LIMITS, "empty_document"),
    ],
    ids=[
        "ole",
        "not-zip",
        "ins",
        "del",
        "ins-in-header",
        "alt-chunk",
        "dotdot",
        "absolute",
        "too-many-chars",
        "empty",
        "blank-only",
    ],
)
def test_docx_rejects(data: bytes, limits: ExtractLimits, code: str) -> None:
    with pytest.raises(ExtractionRejected) as caught:
        read_docx(data, limits)

    assert caught.value.code == code


@pytest.mark.parametrize("tag", ["moveFrom", "moveTo"])
def test_docx_rejects_move_tracking(tag: str) -> None:
    body = f'<w:p><w:{tag} w:id="1" w:author="qa" w:date="2026-11-05T00:00:00Z"><w:r><w:t>옮긴 글</w:t></w:r></w:{tag}></w:p>'

    with pytest.raises(ExtractionRejected) as caught:
        read_docx(build_docx(body), LIMITS)

    assert caught.value.code == "tracked_changes"


@pytest.mark.parametrize(
    "document_xml",
    [
        b'<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY x "y">]>'
        b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        b"<w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>",
        b"<w:document><w:body>",
        None,
    ],
    ids=["dtd", "broken-xml", "missing"],
)
def test_docx_rejects_dtd(document_xml: bytes | None) -> None:
    data = _rewrite_zip(build_docx(p("본문")), {"word/document.xml": document_xml})

    with pytest.raises(ExtractionRejected) as caught:
        read_docx(data, LIMITS)

    assert caught.value.code == "invalid_format"


@pytest.mark.parametrize(
    ("extra", "limits"),
    [
        ({f"extra/{n}.bin": b"x" for n in range(5)}, replace(LIMITS, max_zip_entries=8)),
        ({"extra/big.bin": bytes(range(256)) * 4096}, replace(LIMITS, max_unzipped_bytes=512 * 1024)),
        ({"extra/zeros.bin": b"\0" * (2 * 1024 * 1024)}, replace(LIMITS, max_compression_ratio=50)),
    ],
    ids=["entries", "unzipped-size", "compression-ratio"],
)
def test_docx_rejects_unsafe_zip_limits(extra: dict[str, bytes], limits: ExtractLimits) -> None:
    data = _rewrite_zip(build_docx(p("본문")), extra)

    with pytest.raises(ExtractionRejected) as caught:
        read_docx(data, limits)

    assert caught.value.code == "unsafe_zip"


def test_docx_rejects_lying_entry_size_without_inflating() -> None:
    # 중앙 디렉터리는 1000바이트라고 적었지만 실제로는 20 MiB로 풀리는 document.xml
    real_content = b" " * (20 * 1024 * 1024)
    rewritten = _rewrite_zip(build_docx(p("본문")), {"word/document.xml": real_content})
    data = _patch_declared_size(rewritten, "word/document.xml", 1000)
    del real_content, rewritten

    tracemalloc.start()
    try:
        with pytest.raises(ExtractionRejected) as caught:
            read_docx(data, LIMITS)
        peak_bytes = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()

    assert caught.value.code == "unsafe_zip"
    # 선언한 크기까지만 풀어야 한다 — 다 풀면 20 MiB를 넘는다
    assert peak_bytes < 4 * 1024 * 1024


def test_extract_result_survives_pickle() -> None:
    result = read_docx(build_docx(p("본문") + tbl([["칸"]])), LIMITS)
    rejected = ExtractionRejected("tracked_changes")

    # 추출 자식 프로세스가 결과를 피클로 넘긴다 — 여기서는 방금 만든 자기 객체만 왕복한다
    assert pickle.loads(pickle.dumps(result)) == result
    assert pickle.loads(pickle.dumps(rejected)).code == "tracked_changes"
