"""DOCX 메인 추출기 — ZIP 안전 검사 뒤 WordprocessingML을 직접 읽어 원문 블록을 읽은 순서대로 낸다(순수 함수).

두 단계다. 1단계(_Collector)는 부분들을 문서 순서로 걸으며 문단·칸 레코드를 모으고 본문 흐름의 쪽 나눔을 센다.
2단계(_BlockWriter)는 캡션을 그림에 묶은 뒤 레코드를 블록으로 바꾸며 seq·구역 이름·쪽을 매긴다.
"""

import posixpath
import re
import zipfile
import zlib
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field, replace
from io import BytesIO
from xml.etree.ElementTree import Element, ParseError

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import fromstring

from app.sop.constants import BLOCK_KINDS, BLOCK_PARTS
from app.sop.extract.types import (
    ExtractedBlock,
    ExtractedTable,
    ExtractedWarning,
    ExtractionRejected,
    ExtractLimits,
    ExtractResult,
)

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
V = "urn:schemas-microsoft-com:vml"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"

PART_BODY, PART_HEADER, PART_FOOTER, PART_FOOTNOTE, PART_ENDNOTE, PART_TEXTBOX = BLOCK_PARTS
KIND_PARAGRAPH, KIND_TABLE_CELL, KIND_FIGURE = BLOCK_KINDS
FLAG_AUTO_NUMBERING = "auto_numbering"
FLAG_CLAUSE_NUMBER = "clause_number"
FLAG_MERGED_CELL = "merged_cell"

DOCUMENT_PART = "word/document.xml"
OLE_SIGNATURE = b"\xd0\xcf\x11\xe0"  # 암호·DRM이 걸린 Office 파일은 ZIP이 아니라 OLE 복합 문서다
# 압축 비율은 이 크기 이상인 항목만 본다 — 작은 XML은 비율이 높아도 풀린 크기가 작아 해가 없다
RATIO_CHECK_MIN_BYTES = 1024 * 1024
# 쪽 나눔 정보가 전혀 없을 때 한 쪽으로 치는 글자 수 — 추정 쪽(estimated)임을 함께 표시한다
ESTIMATED_CHARS_PER_PAGE = 1800
SECTION_LABEL_MAX_CHARS = 200  # source_blocks.section_label 길이
# 공백 외에 "빈 글자"로 보는 보이지 않는 글자 — 쪼개기의 빈 글자 판정과 같은 집합
INVISIBLE_CHARS = "​‌‍⁠﻿"
NO_PAGE_MARKS = (0, 0)  # 본문 밖 부분 — 쪽을 매기지 않으므로 값은 쓰이지 않는다

_HEADING_STYLE_RE = re.compile(r"(?:heading|제목)\s*([1-9])")
_CLAUSE_LINE_RE = re.compile(r"^\s*\d+(\.\d+)*\.?\s*$")
# 구역 이름으로 쓸 앞머리 조항 번호 — 번호만 있는 줄("5.1")도 번호가 되도록 끝($)도 받는다
_LABEL_NUMBER_RE = re.compile(r"(\d+(?:\.\d+)*)\.?(?:\s|$)")
_CAPTION_TEXT_RE = re.compile(r"^(그림|Figure|Fig\.)\s*\d+")
_DRIVE_RE = re.compile(r"^[A-Za-z]:")


def _w(local: str) -> str:
    return f"{{{W}}}{local}"


W_BODY, W_P, W_TBL, W_TR, W_TC = _w("body"), _w("p"), _w("tbl"), _w("tr"), _w("tc")
W_PPR, W_RPR, W_PSTYLE, W_NUM_PR, W_NUM_ID, W_OUTLINE_LVL = (
    _w("pPr"), _w("rPr"), _w("pStyle"), _w("numPr"), _w("numId"), _w("outlineLvl"),
)
W_TBL_PR, W_TBL_GRID, W_GRID_COL, W_TBL_PR_EX = _w("tblPr"), _w("tblGrid"), _w("gridCol"), _w("tblPrEx")
W_TR_PR, W_TC_PR, W_GRID_BEFORE, W_GRID_SPAN, W_V_MERGE = (
    _w("trPr"), _w("tcPr"), _w("gridBefore"), _w("gridSpan"), _w("vMerge"),
)
W_SECT_PR, W_SDT_PR, W_SDT_END_PR, W_CUSTOM_XML_PR = _w("sectPr"), _w("sdtPr"), _w("sdtEndPr"), _w("customXmlPr")
W_T, W_TAB, W_PTAB, W_BR, W_CR = _w("t"), _w("tab"), _w("ptab"), _w("br"), _w("cr")
W_NO_BREAK_HYPHEN, W_SOFT_HYPHEN, W_SYM = _w("noBreakHyphen"), _w("softHyphen"), _w("sym")
W_INSTR_TEXT, W_DEL_TEXT, W_DEL_INSTR_TEXT = _w("instrText"), _w("delText"), _w("delInstrText")
W_LAST_RENDERED_PAGE_BREAK, W_TXBX_CONTENT = _w("lastRenderedPageBreak"), _w("txbxContent")
W_DRAWING, W_PICT, W_OBJECT = _w("drawing"), _w("pict"), _w("object")
W_INS, W_DEL, W_MOVE_FROM, W_MOVE_TO, W_ALT_CHUNK = _w("ins"), _w("del"), _w("moveFrom"), _w("moveTo"), _w("altChunk")
W_STYLE, W_NAME, W_BASED_ON, W_FOOTNOTE, W_ENDNOTE = _w("style"), _w("name"), _w("basedOn"), _w("footnote"), _w("endnote")
W_VAL, W_TYPE, W_CHAR, W_STYLE_ID = _w("val"), _w("type"), _w("char"), _w("styleId")
MC_ALTERNATE_CONTENT, MC_CHOICE, MC_FALLBACK = (
    f"{{{MC}}}AlternateContent", f"{{{MC}}}Choice", f"{{{MC}}}Fallback",
)
A_BLIP, V_IMAGEDATA, M_T = f"{{{A}}}blip", f"{{{V}}}imagedata", f"{{{M}}}t"
R_EMBED, R_ID = f"{{{R}}}embed", f"{{{R}}}id"
PKG_RELATIONSHIP = f"{{{PKG_REL}}}Relationship"

_BLOCK_TAGS = frozenset({W_P, W_TBL})
_ROW_TAGS = frozenset({W_TR})
_CELL_TAGS = frozenset({W_TC})
# (part 코드, 주석 요소, 관계 종류) — 각주 다음 미주
_NOTE_KINDS = ((PART_FOOTNOTE, W_FOOTNOTE, "footnotes"), (PART_ENDNOTE, W_ENDNOTE, "endnotes"))
# 글자가 없는 속성 요소 — 특히 w:pPr 안의 w:tabs/w:tab(탭 위치 정의)을 탭 글자로 읽지 않으려고 건너뛴다
_PROPERTY_TAGS = frozenset({
    W_PPR, W_RPR, W_SECT_PR, W_SDT_PR, W_SDT_END_PR, W_CUSTOM_XML_PR,
    W_TBL_PR, W_TBL_GRID, W_TBL_PR_EX, W_TR_PR, W_TC_PR,
})
# 화면에 보이는 원문이 아닌 글자 — 필드 코드와 지운 글
_INLINE_SKIP_TAGS = _PROPERTY_TAGS | {W_INSTR_TEXT, W_DEL_TEXT, W_DEL_INSTR_TEXT}
_RUN_CHARS = {W_TAB: "\t", W_PTAB: "\t", W_CR: "\n", W_NO_BREAK_HYPHEN: "-", W_SOFT_HYPHEN: ""}
_FIGURE_TAGS = frozenset({W_DRAWING, W_PICT, W_OBJECT})
_TRACKED_CHANGE_TAGS = frozenset({W_INS, W_DEL, W_MOVE_FROM, W_MOVE_TO})
_SEPARATOR_NOTE_TYPES = frozenset({"separator", "continuationSeparator"})


@dataclass(frozen=True)
class _Relationship:
    rel_id: str
    kind: str  # 관계 종류 URI의 마지막 조각(header·footer·image…) — Transitional·Strict 둘 다 같다
    target: str | None  # zip 안 경로, 외부 대상이면 None


@dataclass(frozen=True)
class _Part:
    name: str  # zip 안 경로
    root: Element
    relationships: tuple[_Relationship, ...]

    @property
    def label(self) -> str:
        """xml_path 머리 — 확장자 없는 파일 이름(document, header1, footnotes…)."""
        return posixpath.splitext(posixpath.basename(self.name))[0]

    def get_rel_targets(self) -> dict[str, str]:
        return {rel.rel_id: rel.target for rel in self.relationships if rel.target is not None}


@dataclass(frozen=True)
class _Style:
    name: str
    based_on: str | None
    outline_level: int | None
    is_numbered: bool | None  # None이면 numPr가 없어 상위 스타일을 본다


@dataclass(frozen=True)
class _ParaStyle:
    heading_level: int | None
    is_numbered: bool
    is_caption: bool


@dataclass(frozen=True)
class _PartContext:
    """지금 읽는 부분 — part 코드, 본문 흐름(쪽·구역 이름 대상)인지, 그림 관계 id → zip 경로."""

    part: str
    in_body: bool
    rel_targets: dict[str, str]


@dataclass
class _PageMarks:
    """본문 흐름에서 지금까지 만난 쪽 나눔 수 — Word가 저장한 것과 수동 쪽 나눔을 따로 센다."""

    rendered: int = 0
    manual: int = 0

    def snapshot(self) -> tuple[int, int]:
        return (self.rendered, self.manual)


@dataclass
class _InlineRead:
    """문단 하나의 run을 걸은 결과. marks가 None이면 쪽 나눔을 세지 않는다(본문 밖·텍스트 상자 안)."""

    marks: _PageMarks | None
    pieces: list[str] = field(default_factory=list)
    first_marks: tuple[int, int] | None = None  # 첫 글자를 만났을 때의 쪽 나눔 수 — 블록의 시작 쪽
    has_figure: bool = False
    blip_rel_id: str | None = None
    vml_rel_id: str | None = None
    textboxes: list[Element] = field(default_factory=list)

    def add(self, text: str) -> None:
        if not text:
            return
        if self.first_marks is None and self.marks is not None:
            self.first_marks = self.marks.snapshot()
        self.pieces.append(text)

    def count_break(self, *, rendered: bool) -> None:
        if self.marks is None:
            return
        if rendered:
            self.marks.rendered += 1
        else:
            self.marks.manual += 1


@dataclass
class _ParaRecord:
    part: str
    in_body: bool
    xml_path: str
    marks: tuple[int, int]
    text: str
    style: _ParaStyle
    has_figure: bool
    image_part: str | None
    slot: tuple[int, int]  # (컨테이너 번호, 컨테이너 안 순번) — 캡션이 "바로 앞·뒤 문단"인지 판정한다
    caption: str | None = None
    is_consumed: bool = False  # 그림 캡션으로 묶여 따로 블록을 만들지 않는다


@dataclass
class _CellRecord:
    part: str
    in_body: bool
    xml_path: str
    marks: tuple[int, int]
    text: str
    is_numbered: bool
    table_index: int
    row_index: int
    col_index: int
    grid_span: int
    row_span: int = 1  # 아래 행의 vMerge 이어지는 칸을 만날 때마다 는다


_Record = _ParaRecord | _CellRecord


def read_docx(data: bytes, limits: ExtractLimits) -> ExtractResult:
    """DOCX 바이트 → 원문 블록·표·경고. 받지 않는 파일은 ExtractionRejected(code)를 던진다.

    부분 순서는 본문 → 머리말들 → 꼬리말들(document.xml.rels 순서) → 각주 → 미주.
    """
    with _open_zip(data, limits) as archive:
        document = _load_part(archive, DOCUMENT_PART)
        styles = _load_styles(archive, document.relationships)
        headers = [_load_part(archive, name) for name in _find_targets(document.relationships, "header")]
        footers = [_load_part(archive, name) for name in _find_targets(document.relationships, "footer")]
        notes = [
            (part_code, note_tag, _load_part(archive, name))
            for part_code, note_tag, rel_kind in _NOTE_KINDS
            for name in _find_targets(document.relationships, rel_kind)[:1]
        ]
    _check_revisions(part.root for part in (document, *headers, *footers, *(note[2] for note in notes)))

    body = document.root.find(W_BODY)
    if body is None:
        raise ExtractionRejected("invalid_format")
    collector = _Collector(styles)
    body_context = _PartContext(PART_BODY, True, document.get_rel_targets())
    collector.read_container(body, f"{document.label}/body", body_context, collector.marks, NO_PAGE_MARKS, collector.records)
    for part_code, parts in ((PART_HEADER, headers), (PART_FOOTER, footers)):
        for part in parts:
            context = _PartContext(part_code, False, part.get_rel_targets())
            collector.read_container(part.root, part.label, context, None, NO_PAGE_MARKS, collector.records)
    for part_code, note_tag, part in notes:
        context = _PartContext(part_code, False, part.get_rel_targets())
        for note, note_path in _iter_tagged(part.root, part.label, {note_tag}):
            if note.get(W_TYPE) not in _SEPARATOR_NOTE_TYPES:
                collector.read_container(note, note_path, context, None, NO_PAGE_MARKS, collector.records)

    blocks = _build_blocks(collector.records, collector.marks)
    if sum(len(block.text) for block in blocks) > limits.max_chars:
        raise ExtractionRejected("too_many_chars")
    if not any(block.kind == KIND_FIGURE or _has_visible_char(block.text) for block in blocks):
        raise ExtractionRejected("empty_document")
    return ExtractResult(
        blocks=tuple(blocks),
        tables=tuple(sorted(collector.tables, key=lambda table: table.index)),
        warnings=_build_warnings(blocks),
    )


def _open_zip(data: bytes, limits: ExtractLimits) -> zipfile.ZipFile:
    """ZIP 열기와 안전 검사 — 항목 수·풀린 크기(헤더 기준, 읽기도 그 크기에서 멈춘다)·압축 비율·경로."""
    if data[:4] == OLE_SIGNATURE:
        raise ExtractionRejected("not_a_zip_or_encrypted")
    try:
        archive = zipfile.ZipFile(BytesIO(data))
    except zipfile.BadZipFile as error:
        raise ExtractionRejected("not_a_zip_or_encrypted") from error
    entries = archive.infolist()
    if (
        len(entries) > limits.max_zip_entries
        or sum(entry.file_size for entry in entries) > limits.max_unzipped_bytes
        or any(_is_unsafe_entry(entry, limits) for entry in entries)
    ):
        archive.close()
        raise ExtractionRejected("unsafe_zip")
    return archive


def _is_unsafe_entry(entry: zipfile.ZipInfo, limits: ExtractLimits) -> bool:
    name = entry.filename
    if name.startswith(("/", "\\")) or _DRIVE_RE.match(name) or ".." in re.split(r"[/\\]", name):
        return True
    return entry.file_size >= RATIO_CHECK_MIN_BYTES and entry.file_size > limits.max_compression_ratio * entry.compress_size


def _read_entry(archive: zipfile.ZipFile, name: str) -> bytes | None:
    try:
        return archive.read(name)
    except KeyError:
        return None
    # 목차는 열렸지만 항목 안쪽이 깨진 경우 — CRC 불일치·압축 손상·암호화·지원 안 하는 압축
    except (zipfile.BadZipFile, zlib.error, RuntimeError, EOFError) as error:
        raise ExtractionRejected("invalid_format") from error


def _parse_xml(content: bytes) -> Element:
    # DTD를 금지해 엔티티 폭탄·외부 엔티티를 막는다
    try:
        return fromstring(content, forbid_dtd=True)
    except (ParseError, DefusedXmlException) as error:
        raise ExtractionRejected("invalid_format") from error


def _load_part(archive: zipfile.ZipFile, name: str) -> _Part:
    """관계로 이어진 부분 — 없거나 못 읽으면 그 글이 조용히 빠지지 않도록 invalid_format으로 거절한다."""
    content = _read_entry(archive, name)
    if content is None:
        raise ExtractionRejected("invalid_format")
    return _Part(name, _parse_xml(content), _load_relationships(archive, name))


def _load_relationships(archive: zipfile.ZipFile, part_name: str) -> tuple[_Relationship, ...]:
    rels_name = posixpath.join(posixpath.dirname(part_name), "_rels", posixpath.basename(part_name) + ".rels")
    content = _read_entry(archive, rels_name)
    if content is None:
        return ()
    relationships = []
    for element in _parse_xml(content).findall(PKG_RELATIONSHIP):
        target = element.get("Target", "")
        is_external = element.get("TargetMode") == "External"
        relationships.append(
            _Relationship(
                rel_id=element.get("Id", ""),
                kind=element.get("Type", "").rsplit("/", 1)[-1],
                target=None if is_external else _resolve_target(part_name, target),
            )
        )
    return tuple(relationships)


def _resolve_target(part_name: str, target: str) -> str:
    """관계 대상 → zip 안 경로. "/"로 시작하면 패키지 루트 기준, 아니면 원본 부분의 폴더 기준이다."""
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(posixpath.dirname(part_name), target))


def _find_targets(relationships: Iterable[_Relationship], kind: str) -> list[str]:
    """관계 순서대로 대상 경로 — 두 관계가 같은 부분을 가리켜도 한 번만 읽는다."""
    targets: list[str] = []
    for rel in relationships:
        if rel.kind == kind and rel.target is not None and rel.target not in targets:
            targets.append(rel.target)
    return targets


def _load_styles(archive: zipfile.ZipFile, relationships: Iterable[_Relationship]) -> dict[str, _Style]:
    """styleId → 스타일. 스타일 부분이 없으면 빈 사전(제목은 직접 지정한 개요 수준으로만 알아본다)."""
    styles: dict[str, _Style] = {}
    for name in _find_targets(relationships, "styles")[:1]:
        content = _read_entry(archive, name)
        if content is None:
            continue
        for element in _parse_xml(content).findall(W_STYLE):
            style_id = element.get(W_STYLE_ID)
            if style_id is None:
                continue
            name_element, based_on, p_pr = element.find(W_NAME), element.find(W_BASED_ON), element.find(W_PPR)
            styles[style_id] = _Style(
                name=name_element.get(W_VAL, "") if name_element is not None else "",
                based_on=based_on.get(W_VAL) if based_on is not None else None,
                outline_level=_read_outline_level(p_pr),
                is_numbered=_read_numbering(p_pr),
            )
    return styles


def _check_revisions(roots: Iterable[Element]) -> None:
    """변경 추적은 어느 쪽을 원문으로 볼지 정하기 전에는 받지 않는다. altChunk는 다른 문서를 끼운 것이라 받지 않는다."""
    tags = {element.tag for root in roots for element in root.iter()}
    if tags & _TRACKED_CHANGE_TAGS:
        raise ExtractionRejected("tracked_changes")
    if W_ALT_CHUNK in tags:
        raise ExtractionRejected("alt_chunk")


def _iter_tagged(parent: Element, path: str, wanted: Iterable[str]) -> Iterator[tuple[Element, str]]:
    """parent 아래 wanted 요소를 문서 순서로 — 목록에 없는 감싸는 요소(sdt·customXml…)는 모두 안으로 내려간다.

    경로 조각은 "태그[같은 태그 형제 중 1부터 순번]". mc:AlternateContent는 한 갈래만 읽는다(_pick_alternative).
    """
    counts: dict[str, int] = {}
    for child in parent:
        tag = child.tag
        if not isinstance(tag, str):
            continue
        counts[tag] = counts.get(tag, 0) + 1
        child_path = f"{path}/{_get_local_name(tag)}[{counts[tag]}]"
        if tag in wanted:
            yield child, child_path
        elif tag == MC_ALTERNATE_CONTENT:
            alternative = _pick_alternative(child)
            if alternative is not None:
                yield from _iter_tagged(alternative, f"{child_path}/{_get_local_name(alternative.tag)}[1]", wanted)
        elif tag not in _PROPERTY_TAGS:
            yield from _iter_tagged(child, child_path, wanted)


def _get_local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _pick_alternative(alternate_content: Element) -> Element | None:
    """Choice와 Fallback은 같은 내용을 두 번 담으므로 첫 Choice만 — Choice가 없을 때만 Fallback(글이 빠지지 않게)."""
    choice = alternate_content.find(MC_CHOICE)
    return choice if choice is not None else alternate_content.find(MC_FALLBACK)


def _walk_inline(parent: Element, read: _InlineRead) -> None:
    """문단 안 글자 — 모든 하위 요소로 내려가되 필드 코드·지운 글·속성·Fallback·상자 글(따로 모음)은 뺀다."""
    for child in parent:
        tag = child.tag
        if tag in _INLINE_SKIP_TAGS:
            continue
        if tag == MC_ALTERNATE_CONTENT:
            alternative = _pick_alternative(child)
            if alternative is not None:
                _walk_inline(alternative, read)
        elif tag == W_TXBX_CONTENT:
            read.textboxes.append(child)
        elif tag in (W_T, M_T):
            read.add(child.text or "")
        elif tag in _RUN_CHARS:
            read.add(_RUN_CHARS[tag])
        elif tag == W_BR:
            if child.get(W_TYPE) == "page":
                read.count_break(rendered=False)
            else:
                read.add("\n")
        elif tag == W_LAST_RENDERED_PAGE_BREAK:
            read.count_break(rendered=True)
        elif tag == W_SYM:
            read.add(_read_sym(child))
        else:
            if tag in _FIGURE_TAGS:
                read.has_figure = True
            elif tag == A_BLIP and read.blip_rel_id is None:
                read.blip_rel_id = child.get(R_EMBED)
            elif tag == V_IMAGEDATA and read.vml_rel_id is None:
                read.vml_rel_id = child.get(R_ID)
            _walk_inline(child, read)


def _read_sym(element: Element) -> str:
    try:
        return chr(int(element.get(W_CHAR, ""), 16))
    except (ValueError, OverflowError) as error:
        raise ExtractionRejected("invalid_format") from error


def _read_outline_level(p_pr: Element | None) -> int | None:
    element = p_pr.find(W_OUTLINE_LVL) if p_pr is not None else None
    value = element.get(W_VAL, "") if element is not None else ""
    return int(value) if value.isdigit() else None


def _read_numbering(p_pr: Element | None) -> bool | None:
    """numPr가 있으면 번호 여부(numId 0은 번호 끄기), 없거나 numId가 없으면 None(스타일을 따른다)."""
    num_pr = p_pr.find(W_NUM_PR) if p_pr is not None else None
    num_id = num_pr.find(W_NUM_ID) if num_pr is not None else None
    if num_id is None:
        return None
    return num_id.get(W_VAL) != "0"


def _read_int(element: Element | None, default: int) -> int:
    value = element.get(W_VAL, "") if element is not None else ""
    return int(value) if value.isdigit() else default


def _iter_style_chain(style_id: str | None, styles: dict[str, _Style]) -> Iterator[_Style]:
    """스타일과 basedOn 조상들 — 순환이 있어도 한 번씩만."""
    seen: set[str] = set()
    while style_id is not None and style_id not in seen and style_id in styles:
        seen.add(style_id)
        style = styles[style_id]
        yield style
        style_id = style.based_on


def _read_para_style(paragraph: Element, styles: dict[str, _Style]) -> _ParaStyle:
    """제목 수준·자동 번호·캡션 여부 — 문단에 직접 준 값이 먼저, 없으면 스타일과 그 조상을 본다."""
    p_pr = paragraph.find(W_PPR)
    style_element = p_pr.find(W_PSTYLE) if p_pr is not None else None
    style_id = style_element.get(W_VAL) if style_element is not None else None
    chain = list(_iter_style_chain(style_id, styles))
    # styles.xml에 없는 스타일은 styleId를 이름 삼는다(Heading1·제목1처럼 이름이 id에 남는 경우가 많다)
    name = (chain[0].name if chain and chain[0].name else style_id or "").strip().lower()
    heading_match = _HEADING_STYLE_RE.fullmatch(name)
    if heading_match is not None:
        heading_level: int | None = int(heading_match.group(1))
    else:
        outline = _read_outline_level(p_pr)
        if outline is None:
            outline = next((style.outline_level for style in chain if style.outline_level is not None), None)
        # 개요 수준 9는 "본문"이다
        heading_level = outline + 1 if outline is not None and outline < 9 else None
    is_numbered = _read_numbering(p_pr)
    if is_numbered is None:
        is_numbered = next((style.is_numbered for style in chain if style.is_numbered is not None), False)
    return _ParaStyle(heading_level=heading_level, is_numbered=is_numbered, is_caption=name == "caption")


class _Collector:
    """1단계 — 컨테이너(본문·머리말·칸·상자…)를 문서 순서로 걸어 레코드와 표를 모은다."""

    def __init__(self, styles: dict[str, _Style]) -> None:
        self.styles = styles
        self.records: list[_Record] = []
        self.tables: list[ExtractedTable] = []
        self.marks = _PageMarks()  # 본문 흐름 하나뿐이다
        self._table_count = 0
        self._container_count = 0

    def read_container(
        self,
        parent: Element,
        path: str,
        context: _PartContext,
        marks: _PageMarks | None,
        host_marks: tuple[int, int],
        out: list[_Record],
    ) -> None:
        container = self._container_count
        self._container_count += 1
        for position, (item, item_path) in enumerate(_iter_tagged(parent, path, _BLOCK_TAGS)):
            if item.tag == W_P:
                self._read_paragraph(item, item_path, context, marks, host_marks, (container, position), out)
            else:
                self._read_table(item, item_path, context, marks, host_marks, None, out)

    def _read_runs(
        self, paragraph: Element, marks: _PageMarks | None, host_marks: tuple[int, int]
    ) -> tuple[_InlineRead, tuple[int, int]]:
        """문단 글자와 블록 시작 쪽 — 글자가 없으면 문단 끝, 쪽을 세지 않는 곳이면 담은 쪽 것을 쓴다."""
        read = _InlineRead(marks)
        _walk_inline(paragraph, read)
        para_marks = read.first_marks or (marks.snapshot() if marks is not None else host_marks)
        return read, para_marks

    def _read_paragraph(
        self,
        paragraph: Element,
        path: str,
        context: _PartContext,
        marks: _PageMarks | None,
        host_marks: tuple[int, int],
        slot: tuple[int, int],
        out: list[_Record],
    ) -> None:
        read, para_marks = self._read_runs(paragraph, marks, host_marks)
        rel_id = read.blip_rel_id or read.vml_rel_id
        out.append(
            _ParaRecord(
                part=context.part,
                in_body=context.in_body,
                xml_path=path,
                marks=para_marks,
                text="".join(read.pieces),
                style=_read_para_style(paragraph, self.styles),
                has_figure=read.has_figure,
                image_part=context.rel_targets.get(rel_id) if rel_id else None,
                slot=slot,
            )
        )
        self._read_textboxes(read.textboxes, path, context, para_marks, out)

    def _read_textboxes(
        self, boxes: list[Element], path: str, context: _PartContext, host_marks: tuple[int, int], out: list[_Record]
    ) -> None:
        # 상자 안 쪽 나눔은 본문 쪽을 바꾸지 않으므로 세지 않고, 상자는 담은 문단의 쪽을 따른다
        box_context = replace(context, part=PART_TEXTBOX)
        for number, box in enumerate(boxes, start=1):
            self.read_container(box, f"{path}/txbx[{number}]", box_context, None, host_marks, out)

    def _read_table(
        self,
        table: Element,
        path: str,
        context: _PartContext,
        marks: _PageMarks | None,
        host_marks: tuple[int, int],
        parent_index: int | None,
        out: list[_Record],
    ) -> None:
        index = self._table_count
        self._table_count += 1
        grid = table.find(W_TBL_GRID)
        rows = list(_iter_tagged(table, path, _ROW_TAGS))
        open_merges: dict[int, _CellRecord] = {}  # 격자 열 → vMerge를 시작한 칸
        for row_index, (row, row_path) in enumerate(rows):
            row_pr = row.find(W_TR_PR)
            col = _read_int(row_pr.find(W_GRID_BEFORE) if row_pr is not None else None, 0)
            still_open: dict[int, _CellRecord] = {}
            for cell, cell_path in _iter_tagged(row, row_path, _CELL_TAGS):
                cell_pr = cell.find(W_TC_PR)
                span = max(1, _read_int(cell_pr.find(W_GRID_SPAN) if cell_pr is not None else None, 1))
                v_merge = cell_pr.find(W_V_MERGE) if cell_pr is not None else None
                merge = None if v_merge is None else v_merge.get(W_VAL, "continue")
                started = open_merges.get(col)
                if merge == "continue" and started is not None:
                    # 이어지는 칸은 시작 칸에 합쳐져 보이므로 블록을 만들지 않는다(같은 글이 두 번 생기지 않게)
                    started.row_span += 1
                    still_open[col] = started
                else:
                    record = self._read_cell(
                        cell, cell_path, context, marks, host_marks, (index, row_index, col, span), out
                    )
                    if merge == "restart":
                        still_open[col] = record
                col += span
            open_merges = still_open
        n_cols = len(grid.findall(W_GRID_COL)) if grid is not None else 0
        self.tables.append(
            ExtractedTable(
                index=index, parent_index=parent_index, part=context.part, xml_path=path, n_rows=len(rows), n_cols=n_cols
            )
        )

    def _read_cell(
        self,
        cell: Element,
        path: str,
        context: _PartContext,
        marks: _PageMarks | None,
        host_marks: tuple[int, int],
        position: tuple[int, int, int, int],
        out: list[_Record],
    ) -> _CellRecord:
        """칸 하나 = 블록 하나(문단은 "\\n"으로 잇는다). 칸 안의 상자 글·표는 칸 블록 바로 뒤에 문서 순서로 낸다."""
        table_index, row_index, col_index, grid_span = position
        texts: list[str] = []
        first_marks: tuple[int, int] | None = None
        is_numbered = False
        after: list[_Record] = []
        for item, item_path in _iter_tagged(cell, path, _BLOCK_TAGS):
            if item.tag == W_P:
                read, para_marks = self._read_runs(item, marks, host_marks)
                texts.append("".join(read.pieces))
                first_marks = first_marks or read.first_marks
                is_numbered = is_numbered or _read_para_style(item, self.styles).is_numbered
                self._read_textboxes(read.textboxes, item_path, context, para_marks, after)
            else:
                self._read_table(item, item_path, context, marks, host_marks, table_index, after)
        record = _CellRecord(
            part=context.part,
            in_body=context.in_body,
            xml_path=path,
            marks=first_marks or (marks.snapshot() if marks is not None else host_marks),
            text="\n".join(texts),
            is_numbered=is_numbered,
            table_index=table_index,
            row_index=row_index,
            col_index=col_index,
            grid_span=grid_span,
        )
        out.append(record)
        out.extend(after)
        return record


def _has_visible_char(text: str) -> bool:
    return any(not (char.isspace() or char in INVISIBLE_CHARS) for char in text)


def _is_caption(record: _ParaRecord) -> bool:
    return (
        not record.is_consumed
        and not record.has_figure
        and _has_visible_char(record.text)
        and (record.style.is_caption or _CAPTION_TEXT_RE.match(record.text) is not None)
    )


def _pick_flags(*candidates: tuple[str, bool]) -> tuple[str, ...]:
    return tuple(flag for flag, is_on in candidates if is_on)


def _attach_captions(records: list[_Record]) -> None:
    """그림 문단의 캡션 — 같은 컨테이너의 바로 다음 문단, 아니면 바로 앞 문단이 캡션 꼴이면 그 글자."""
    by_slot = {record.slot: record for record in records if isinstance(record, _ParaRecord)}
    for record in records:
        if not (isinstance(record, _ParaRecord) and record.has_figure):
            continue
        container, position = record.slot
        for neighbor in (by_slot.get((container, position + 1)), by_slot.get((container, position - 1))):
            if neighbor is not None and _is_caption(neighbor):
                neighbor.is_consumed = True
                record.caption = neighbor.text
                break


class _BlockWriter:
    """2단계 — 레코드를 블록으로. seq·구역 이름·추정 쪽의 앞선 본문 글자 수는 내는 순서대로 쌓인다."""

    def __init__(self, page_basis: str) -> None:
        self.page_basis = page_basis
        self.blocks: list[ExtractedBlock] = []
        self._section_label = ""
        self._body_chars = 0

    def add_paragraph(self, record: _ParaRecord) -> None:
        """글자가 있으면 문단 블록, 그림이 있으면 그 뒤에 그림 블록. 빈 문단은 블록을 만들지 않는다."""
        if record.text:
            is_clause = _CLAUSE_LINE_RE.match(record.text) is not None
            if record.part == PART_BODY and (record.style.heading_level is not None or is_clause):
                self._update_section_label(record.text)
            flags = _pick_flags((FLAG_AUTO_NUMBERING, record.style.is_numbered), (FLAG_CLAUSE_NUMBER, is_clause))
            self._append(record, KIND_PARAGRAPH, record.text, heading_level=record.style.heading_level, flags=flags)
        if record.has_figure:
            # 번호는 그 문단의 첫 블록에만 붙여 경고 개수가 번호 문단 수와 같게 한다
            flags = _pick_flags((FLAG_AUTO_NUMBERING, record.style.is_numbered and not record.text))
            self._append(record, KIND_FIGURE, record.caption or "", image_part=record.image_part, flags=flags)

    def add_cell(self, record: _CellRecord) -> None:
        is_merged = record.grid_span > 1 or record.row_span > 1
        flags = _pick_flags((FLAG_AUTO_NUMBERING, record.is_numbered), (FLAG_MERGED_CELL, is_merged))
        self._append(
            record,
            KIND_TABLE_CELL,
            record.text,
            table_index=record.table_index,
            row_index=record.row_index,
            col_index=record.col_index,
            grid_span=record.grid_span,
            row_span=record.row_span,
            flags=flags,
        )

    def _update_section_label(self, text: str) -> None:
        stripped = text.strip()
        if not stripped:
            return
        number = _LABEL_NUMBER_RE.match(stripped)
        self._section_label = number.group(1) if number is not None else stripped[:SECTION_LABEL_MAX_CHARS]

    def _get_page(self, marks: tuple[int, int]) -> int:
        rendered, manual = marks
        if self.page_basis == "rendered":
            return rendered + 1
        if self.page_basis == "manual":
            return manual + 1
        return self._body_chars // ESTIMATED_CHARS_PER_PAGE + 1

    def _append(
        self,
        record: _Record,
        kind: str,
        text: str,
        *,
        heading_level: int | None = None,
        table_index: int | None = None,
        row_index: int | None = None,
        col_index: int | None = None,
        grid_span: int = 1,
        row_span: int = 1,
        image_part: str | None = None,
        flags: tuple[str, ...] = (),
    ) -> None:
        page = None
        if record.in_body:
            page = self._get_page(record.marks)
            self._body_chars += len(text)
        self.blocks.append(
            ExtractedBlock(
                seq=len(self.blocks),
                part=record.part,
                kind=kind,
                text=text,
                xml_path=record.xml_path,
                page=page,
                page_basis=self.page_basis,
                section_label=self._section_label if record.in_body else "",
                heading_level=heading_level,
                table_index=table_index,
                row_index=row_index,
                col_index=col_index,
                grid_span=grid_span,
                row_span=row_span,
                image_part=image_part,
                flags=flags,
            )
        )


def _build_blocks(records: list[_Record], marks: _PageMarks) -> list[ExtractedBlock]:
    """쪽 근거는 문서 전체에 하나 — Word 저장 쪽 나눔이 하나라도 있으면 그것, 없으면 수동 쪽 나눔, 둘 다 없으면 추정."""
    page_basis = "rendered" if marks.rendered else "manual" if marks.manual else "estimated"
    _attach_captions(records)
    writer = _BlockWriter(page_basis)
    for record in records:
        if isinstance(record, _CellRecord):
            writer.add_cell(record)
        elif not record.is_consumed:
            writer.add_paragraph(record)
    return writer.blocks


def _build_warnings(blocks: list[ExtractedBlock]) -> tuple[ExtractedWarning, ...]:
    """병합 칸 경고는 표마다 하나(첫 병합 칸을 가리킨다), 자동 번호 경고는 문서에 하나(블록 수)."""
    warnings: list[ExtractedWarning] = []
    merged_tables: set[int | None] = set()
    for block in blocks:
        if FLAG_MERGED_CELL in block.flags and block.table_index not in merged_tables:
            merged_tables.add(block.table_index)
            warnings.append(ExtractedWarning(FLAG_MERGED_CELL, block.seq, {"table_index": str(block.table_index)}))
    numbered_count = sum(FLAG_AUTO_NUMBERING in block.flags for block in blocks)
    if numbered_count:
        warnings.append(ExtractedWarning(FLAG_AUTO_NUMBERING, None, {"count": str(numbered_count)}))
    return tuple(warnings)
