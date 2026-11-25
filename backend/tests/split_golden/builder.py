"""쪼개기 정답 문서 만들기 — 꼴(G01–G21)마다 합성 DOCX·PDF 하나를 시험 때 만들고, 원문 대조 응답을 기대 JSON과 같은 줄로 읽는다."""

import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from typing import Literal
from xml.sax.saxutils import escape

from tests.docx_factory import build_docx, make_band_table, make_grid_table, make_row, make_style, p
from tests.pdf_factory import build_text_pdf

STYLES: str = (
    make_style("Heading1", "heading 1", outline=0) + make_style("Heading2", "heading 2", outline=1)
    + make_style("Heading3", "heading 3", outline=2) + make_style("TOC1", "toc 1")
)
# New 문서에만 더하는, 본문이 쓰지 않는 스타일 — 같은 묶음에 같은 바이트를 올리면 duplicate_file로 거절된다
_UNUSED_STYLE = make_style("SyntheticUnused", "synthetic unused")


@dataclass(frozen=True)
class Case:
    key: str
    format: Literal["docx", "pdf"]
    build: Callable[[], bytes]


def h(text: str, level: int = 1) -> str:
    """제목 스타일 문단."""
    return p(text, f"Heading{level}")


def lines(*parts: str, style: str | None = None) -> str:
    """한 문단 안 Shift+Enter(<w:br/>) 줄."""
    p_pr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    runs = "<w:r><w:br/></w:r>".join(f'<w:r><w:t xml:space="preserve">{escape(part)}</w:t></w:r>' for part in parts)
    return f"<w:p>{p_pr}{runs}</w:p>"


def cell(*paragraphs: str) -> str:
    """칸 안 문단 여럿 — make_row는 "<"로 시작하는 글을 XML 그대로 넣는다."""
    return "".join(text if text.startswith("<") else p(text) for text in paragraphs)


def _table(*rows: list[str]) -> str:
    return make_grid_table(len(rows[0]), "".join(make_row(row) for row in rows))


def _docx(key: str, body: str) -> Case:
    return Case(key, "docx", lambda: build_docx(body, styles=STYLES))


def _pdf(key: str, *text_lines: str) -> Case:
    return Case(key, "pdf", lambda: build_text_pdf([list(text_lines)]))


_PROCEDURE = h("5. 절차")  # † — 본문 앞에 두는 한글 장 제목
_PURPOSE = "탱크 세척 방법을 정한다."
_SCOPE = "합성 공정에 적용한다."
_FRONT_BODY = (
    p("합성 표준 절차서")
    + _table(["문서 번호", "SOP-QC-0001"], ["제목", "합성 세척 절차"])
    + _table(["작성", "검토", "승인"], ["2026-01-02", "2026-01-03", "2026-01-04"])
    + h("Summary of Changes") + _table(["개정", "내용"], ["1", "1. 처음 만듦"])
    + p("목차") + p("1. 목적 ........ 3", "TOC1") + p("2. 범위 ........ 3", "TOC1")
    + h("1. 목적") + p(_PURPOSE) + h("2. 범위") + p(_SCOPE)
)
_HALVES_BODY = (
    p("합성 표준 절차서") + _table(["승인", "홍보팀"])
    + p("1. 목적 ........ 3", "TOC1") + p("2. 범위 ........ 3", "TOC1")
    + h("1. 목적") + p(_PURPOSE) + h("2. 범위") + p(_SCOPE)
    + p("첨부 1 기록지") + _table(["항목", "값"], ["온도", "측정"])
    + p("Synthetic Standard Procedure") + _table(["Approved", "Synthetic team"])
    + p("1. Purpose ........ 3", "TOC1") + p("2. Scope ........ 3", "TOC1")
    + h("1. Purpose") + p("This procedure defines how to clean the tank.")
    + h("2. Scope") + p("It applies to the synthetic process.")
)
_HISTORY_BODY = (
    h("1. 목적") + p(_PURPOSE)
    + h("9. Document Change History") + p("개정 내용을 적는다.") + _table(["Rev", "Change"], ["01", "New document"])
    + h("10. 첨부") + p("기록지를 붙인다.")
)
_LIST = [
    _docx("G01", _PROCEDURE + p("5.1 탱크를 비운다. 밸브를 닫는다. 잔량을 기록한다.")),
    _docx("G02", _PROCEDURE + p("탱크를 비운다. 밸브를 닫는다. Drain the tank completely. Close the outlet valve.")),
    _docx("G03", _PROCEDURE + p("탱크를 비운다. Drain the tank completely. 밸브를 닫는다. Close the outlet valve.")),
    _docx("G04", _PROCEDURE + lines("탱크를 비우고", "잔량을 확인한다.", "결과를 기록한다.")),
    _docx(
        "G05",
        _PROCEDURE + lines(
            "다음 순서로 준비한다.", "1) 전원을 켠다.", "2) 압력을 확인한다.", "• 장갑을 낀다.", "가. 기록지를 준비한다.",
        ),
    ),
    _docx("G06", _PROCEDURE + p("5.1 탱크를 비운다. 밸브를 닫는다.") + p("작업이 끝나면 기록한다. 서명한다.")),
    _docx(
        "G07", _PROCEDURE + p("Biosafety Cabinet(BSC-01)의 HEPA filter를 확인한다. SOP-QC-0012에 따라 pH meter를 교정한다."),
    ),
    _docx("G08", _PROCEDURE + p("세척액을 준비한다. Buffer A. 탱크에 넣는다.") + p("희석액을 준비한다. Buffer A.")),
    _docx(
        "G09",
        _PROCEDURE + _table(
            ["항목", "내용"], ["세척", cell("탱크를 비운다. 물을 채운다.", "밸브를 닫는다.", "결과를 기록한다.")],
        ),
    ),
    _docx(
        "G10",
        _PROCEDURE + _table(
            ["항목", "내용"], [cell(lines("온도", "Temperature")), cell(lines("탱크를 비운다.", "Drain it."))],
        ),
    ),
    _docx(
        "G11",
        _PROCEDURE + h(
            "5.1 배출 밸브를 모두 닫는다. 닫힌 것을 확인한다. Close all drain valves. Confirm that they are closed.", 2,
        ),
    ),
    _docx("G12", _PROCEDURE + h("5.2 Pre-cleaning", 2) + p("탱크를 비운다.")),
    _docx(
        "G13", make_band_table("5", "절차") + p("탱크를 비운다.") + make_band_table("5.1", "준비") + p("밸브를 닫는다."),
    ),
    _docx("G14", _FRONT_BODY),
    _docx("G15", _HALVES_BODY),
    _docx("G16", _HISTORY_BODY),
    _docx("G17", p("합성 안내문") + _table(["작성", "검토"]) + h("2. 범위") + p(_SCOPE) + h("개정 이력") + p("처음 만들었다.")),
    _pdf(
        "G18", "The operator drains the tank and then closes", "the outlet valve of the cleaning line. Record",
        "0.8 bar as the target pressure.",
    ),
    _docx("G19", "".join(p(f"합성 절차 {n}를 시작한다. Start the synthetic step {n} now.") for n in range(1, 5))),
    _docx(
        "G20",
        h("3. Reference") + lines("SOP-QC-0012 시료 채취 절차", "SOP-QC-0013 세척 절차", "ISO 9001:2015")
        + h("4. 책임") + p("담당자가 확인한다."),
    ),
    _pdf(
        "G21", "5.1 Drain the tank completely. Close the valve.", "5.2 Rinse the tank with purified water and",
        "wait for 10 minutes.", "5.3 Record the result.",
    ),
]
CASES: dict[str, Case] = {case.key: case for case in _LIST}


def build_new_bytes(case: Case) -> bytes:
    """New로 올릴 같은 문서 — 글은 같고 바이트만 다르다(DOCX는 쓰지 않는 스타일 하나, PDF는 끝의 주석 한 줄)."""
    data = case.build()
    if case.format == "pdf":
        return data + b"\n% SYNTHETIC\n"
    buffer = BytesIO()
    with zipfile.ZipFile(BytesIO(data)) as source, zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as target:
        for name in source.namelist():
            content = source.read(name)
            if name == "word/styles.xml":
                content = content.replace(b"</w:styles>", _UNUSED_STYLE.encode() + b"</w:styles>")
            target.writestr(name, content)
    return buffer.getvalue()


def read_boxes(view: dict) -> list[dict]:
    """본문 활성 Unit을 용지 순으로 — 기대 JSON의 boxes와 같은 열쇠."""
    parts = {block["id"]: block["part"] for block in view["blocks"]}
    return [
        {
            "text": unit["text"], "lang": unit["lang"], "kind": unit["kind"],
            "number": unit["number"]["value"] if unit["number"] else None, "excluded": unit["noise_kind"],
        }
        for unit in view["units"]
        if parts[unit["block_id"]] == "body"
    ]
