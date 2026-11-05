"""DOCX 메인 추출기 — 부분 순서·감싸는 요소·상자·병합 칸·표 안 표·제목·쪽·그림·자동 번호·거절 규칙."""

import pickle
import zipfile
from dataclasses import replace
from io import BytesIO

import pytest

from app.sop.extract.docx_reader import read_docx
from app.sop.extract.types import ExtractedWarning, ExtractionRejected, ExtractLimits
from tests.docx_factory import (
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
    body = (
        f"<w:p>{NUMBERED}<w:r><w:t>첫 항목</w:t></w:r></w:p>"
        f"<w:p>{NUMBERED}<w:r><w:t>둘째 항목</w:t></w:r></w:p>"
        '<w:p><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>번호 끔</w:t></w:r></w:p>'
        + p("번호 없음")
    )

    result = read_docx(build_docx(body), LIMITS)

    assert [b.flags for b in result.blocks] == [("auto_numbering",), ("auto_numbering",), (), ()]
    assert result.warnings == (ExtractedWarning(kind="auto_numbering", block_seq=None, detail={"count": "2"}),)


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


def test_extract_result_survives_pickle() -> None:
    result = read_docx(build_docx(p("본문") + tbl([["칸"]])), LIMITS)
    rejected = ExtractionRejected("tracked_changes")

    # 추출 자식 프로세스가 결과를 피클로 넘긴다 — 여기서는 방금 만든 자기 객체만 왕복한다
    assert pickle.loads(pickle.dumps(result)) == result
    assert pickle.loads(pickle.dumps(rejected)).code == "tracked_changes"
