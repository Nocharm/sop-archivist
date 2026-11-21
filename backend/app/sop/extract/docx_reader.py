"""DOCX 메인 추출기 — ZIP 안전 검사 뒤 WordprocessingML을 직접 읽어 원문 블록을 읽은 순서대로 낸다(순수 함수).

두 단계다. 1단계(_Collector)는 부분들을 문서 순서로 걸으며 문단·칸 레코드를 모으고 본문 흐름의 쪽 나눔을 센다.
2단계(_BlockWriter)는 캡션 문단을 그림·표에 이은 뒤 레코드를 블록으로 바꾸며 seq·구역 이름·쪽을 매긴다.
"""

import posixpath
import re
import zipfile
import zlib
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field, replace
from io import BytesIO
from typing import Literal
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
from app.sop.renumber import FIGURE_CAPTION_RE, TABLE_CAPTION_RE  # 캡션 머리 정규식은 renumber 한 벌
# 빈 글자 판정은 쪼개기·커버리지와 하나를 쓰고, 제목다움(F8b)은 쪼개기와 같은 규칙이다
from app.sop.segment import TYPED_NUMBER_RE, detect_language, has_visible_char, is_heading_like, trim_blank_range

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
FLAG_IMAGE_PART_TOO_LONG = "image_part_too_long"
# 캡션 문단 블록이 제 그림·표를 가리키는 표시 — "caption_of:<그림 블록 seq | 표 첫 칸 블록 seq>"
FLAG_CAPTION_OF = "caption_of"
WARNING_MERGED_CELL_CONTENT = "merged_cell_content"
# 구조 신호의 열쇠와 값 — 뜻은 extract.types의 ExtractedBlock·ExtractedTable docstring
SIGNAL_NUMBERS, SIGNAL_PARAS, SIGNAL_TOC, SIGNAL_INLINE = "numbers", "paras", "toc", "inline"
SIGNAL_CAPTIONS = "captions"
SIGNAL_WIDTHS, SIGNAL_FIRST_ROW, SIGNAL_BAND, SIGNAL_PLACE = "widths", "first_row", "band", "place"
NUMBER_AUTO, NUMBER_TYPED, NUMBER_CELL = "auto", "typed", "cell"
TOC_STYLE, TOC_FIELD, TOC_SDT, TOC_LEADER = "style", "field", "sdt", "leader"
TOC_GALLERY = "table of contents"  # 목차 구성 요소(w:sdt)의 docPartGallery 값
MAX_SIGNAL_WIDTHS = 64  # 표 하나에 남기는 열 폭 수 — 조작한 격자가 신호를 끝없이 늘리지 못하게(Word 표는 63열까지다)

DOCUMENT_PART = "word/document.xml"
OLE_SIGNATURE = b"\xd0\xcf\x11\xe0"  # 암호·DRM이 걸린 Office 파일은 ZIP이 아니라 OLE 복합 문서다
# 문서 보호(DRM) 도구가 감싼 파일 — ZIP도 OLE도 아니고 앞머리에 ASCII "DRM"이 있다. 업체마다 머리 모양이 달라 이 글자만 본다
DRM_MARK = b"DRM"
DRM_HEAD_BYTES = 64  # DRM 글자를 찾는 앞머리 길이(바이트) — 본문 어딘가의 우연한 "DRM"을 집지 않게 짧게 둔다
# 압축 비율은 이 크기 이상인 항목만 본다 — 작은 XML은 비율이 높아도 풀린 크기가 작아 해가 없다
RATIO_CHECK_MIN_BYTES = 1024 * 1024
# 쪽 나눔 정보가 전혀 없을 때 한 쪽으로 치는 글자 수 — 추정 쪽(estimated)임을 함께 표시한다
ESTIMATED_CHARS_PER_PAGE = 1800
SECTION_LABEL_MAX_CHARS = 200  # source_blocks.section_label 길이
IMAGE_PART_MAX_CHARS = 200  # source_blocks.image_part 길이
XML_PATH_MAX_CHARS = 500  # source_blocks·source_tables.xml_path 길이
XML_PATH_ELLIPSIS = "/…/"
NO_PAGE_MARKS = (0, 0)  # 본문 밖 부분 — 쪽을 매기지 않으므로 값은 쓰이지 않는다

_HEADING_STYLE_RE = re.compile(r"(?:heading|제목)\s*([1-9])")
_CLAUSE_LINE_RE = re.compile(r"^\s*\d+(\.\d+)*\.?\s*$")
# 구역 이름으로 쓸 앞머리 조항 번호 — 번호만 있는 줄("5.1")도 번호가 되도록 끝($)도 받는다
_LABEL_NUMBER_RE = re.compile(r"(\d+(?:\.\d+)*)\.?(?:\s|$)")
# 캡션 머리 — 번호 바로 뒤는 끝·공백·구두점만 받아 "표 1에 따라"처럼 조사가 붙은 참조 문장을 거른다
_LEVEL_REF_RE = re.compile(r"%([1-9])")  # lvlText 안의 수준 자리("%1.%2")
MAX_NUMBER_LEVELS = 9  # Word 목록 수준 수(ilvl 0~8)
PLAIN_BULLET = "•"
MAX_NUMBER_START = 32767  # 번호 시작 값 상한(Word와 같다) — 조작한 큰 값이 글자 번호를 끝없이 늘리지 못하게
MAX_LETTER_REPEAT = 8  # "aa…" 되풀이 상한(8이면 208번째까지) — 넘으면 숫자로 쓴다
MAX_LEVEL_TEXT_CHARS = 255  # lvlText 길이 상한(Word가 받는 길이) — 문단마다 되풀이되는 글이라 넘는 것은 자른다
MAX_SECTION_REFS = 24  # 부분 하나에 남기는 구역 표시 수 — 블록마다 실리므로 구역이 아주 많은 문서에서 곱으로 불지 않게
# 구역이 머리말·꼬리말 부분을 어떻게 거는지 블록에 남기는 표시 — "section_ref:<구역 번호(1부터)>:<default|first|even>"
FLAG_SECTION_REF_PREFIX = "section_ref:"
_GANADA = "가나다라마바사아자차카타파하"
_CHOSUNG = "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ"
_ROMAN_PARTS = (
    (1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"),
    (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i"),
)
MAX_ROMAN = 3999
_DRIVE_RE = re.compile(r"^[A-Za-z]:")
# 글 전체가 번호 꼴인 칸 — 단계 라벨 "A" "A-1", 조항 번호 "7" "7.4"
_NUMBER_CELL_RE = re.compile(r"[A-Z](?:-\d+)*|\d+(?:\.\d+)*\.?")
_BAND_NUMBER_RE = re.compile(r"\d+(?:\.\d+)*\.?")  # 띠 표 번호 칸 — 수준을 점 개수로 세므로 숫자 꼴만
_TOC_STYLE_RE = re.compile(r"toc \d")  # Word 목차 스타일 이름(소문자로 견준다)
_TOC_FIELD_RE = re.compile(r"\s*TOC\b", re.IGNORECASE)  # 필드 코드 머리
_DOT_LEADER_RE = re.compile(r"[.·]{4,}|…{2,}")  # 타자로 친 점 끌기
# 언어 절반을 가르는 책갈피 이름 — 템플릿 SOP의 Eng·Kor, 템플릿 WI의 Engchap1·korchap1
_HALF_BOOKMARK_RE = re.compile(r"(eng|kor)(?:chap\d+)?", re.IGNORECASE)
# 언어 절반마다 따로 둔 문단 스타일의 이름 끝 — "… [Kor]"·"… [Eng]". "_Eng"·"_Kor" 끝은 한글 절반이 _Eng를 쓴 문서가 있어 믿지 않는다
_HALF_STYLE_RE = re.compile(r"\[(eng|kor)\]$", re.IGNORECASE)


def _w(local: str) -> str:
    return f"{{{W}}}{local}"


W_BODY, W_P, W_TBL, W_TR, W_TC = _w("body"), _w("p"), _w("tbl"), _w("tr"), _w("tc")
W_PPR, W_RPR, W_PSTYLE, W_NUM_PR, W_NUM_ID, W_OUTLINE_LVL = (
    _w("pPr"), _w("rPr"), _w("pStyle"), _w("numPr"), _w("numId"), _w("outlineLvl"),
)
W_ILVL, W_NUM, W_ABSTRACT_NUM, W_ABSTRACT_NUM_ID, W_LVL = (
    _w("ilvl"), _w("num"), _w("abstractNum"), _w("abstractNumId"), _w("lvl"),
)
W_START, W_NUM_FMT, W_LVL_TEXT, W_SUFF, W_NUM_STYLE_LINK = (
    _w("start"), _w("numFmt"), _w("lvlText"), _w("suff"), _w("numStyleLink"),
)
W_LVL_OVERRIDE, W_START_OVERRIDE = _w("lvlOverride"), _w("startOverride")
W_HEADER_REFERENCE, W_FOOTER_REFERENCE = _w("headerReference"), _w("footerReference")
W_TBL_PR, W_TBL_GRID, W_GRID_COL, W_TBL_PR_EX = _w("tblPr"), _w("tblGrid"), _w("gridCol"), _w("tblPrEx")
W_TR_PR, W_TC_PR, W_GRID_BEFORE, W_GRID_SPAN, W_V_MERGE, W_TBL_HEADER = (
    _w("trPr"), _w("tcPr"), _w("gridBefore"), _w("gridSpan"), _w("vMerge"), _w("tblHeader"),
)
_OFF_VALUES = frozenset({"0", "false", "off"})  # 켜고 끄는 속성(w:tblHeader·w:b…)의 "끔" 값 — 값이 없으면 켬이다
W_SECT_PR, W_SDT_PR, W_SDT_END_PR, W_CUSTOM_XML_PR = _w("sectPr"), _w("sdtPr"), _w("sdtEndPr"), _w("customXmlPr")
W_T, W_TAB, W_PTAB, W_BR, W_CR = _w("t"), _w("tab"), _w("ptab"), _w("br"), _w("cr")
W_NO_BREAK_HYPHEN, W_SOFT_HYPHEN, W_SYM = _w("noBreakHyphen"), _w("softHyphen"), _w("sym")
W_INSTR_TEXT, W_DEL_TEXT, W_DEL_INSTR_TEXT = _w("instrText"), _w("delText"), _w("delInstrText")
W_LAST_RENDERED_PAGE_BREAK, W_TXBX_CONTENT = _w("lastRenderedPageBreak"), _w("txbxContent")
W_DRAWING, W_PICT, W_OBJECT = _w("drawing"), _w("pict"), _w("object")
W_INS, W_DEL, W_MOVE_FROM, W_MOVE_TO, W_ALT_CHUNK = _w("ins"), _w("del"), _w("moveFrom"), _w("moveTo"), _w("altChunk")
W_STYLE, W_NAME, W_BASED_ON, W_FOOTNOTE, W_ENDNOTE = _w("style"), _w("name"), _w("basedOn"), _w("footnote"), _w("endnote")
W_VAL, W_TYPE, W_CHAR, W_STYLE_ID = _w("val"), _w("type"), _w("char"), _w("styleId")
W_BOOKMARK_START = _w("bookmarkStart")
W_SDT, W_DOC_PART_OBJ, W_DOC_PART_GALLERY = _w("sdt"), _w("docPartObj"), _w("docPartGallery")
W_FLD_CHAR, W_FLD_CHAR_TYPE, W_TABS, W_LEADER, W_W = _w("fldChar"), _w("fldCharType"), _w("tabs"), _w("leader"), _w("w")
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
class _NumRef:
    """numPr 하나 — 적지 않은 값은 None(문단이면 스타일을, 스타일이면 상위 스타일을 따른다)."""

    num_id: str | None
    level: int | None


@dataclass(frozen=True)
class _Style:
    style_id: str
    name: str
    based_on: str | None
    outline_level: int | None
    num_ref: _NumRef | None


@dataclass(frozen=True)
class _ParaNumber:
    """문단에 걸린 자동 번호 — level이 None이면 스타일로 걸린 번호라 목록 정의의 pStyle과 스타일의 ilvl로 수준을 찾는다."""

    num_id: str
    level: int | None
    style_ids: tuple[str, ...]  # 문단 스타일이 맨 앞, 이어서 basedOn 조상
    style_level: int | None = None  # 스타일 조상 가운데 가장 가까운 것이 적은 ilvl


@dataclass(frozen=True)
class _ParaStyle:
    heading_level: int | None
    number: _ParaNumber | None
    is_caption: bool
    is_toc: bool = False  # Word 목차 스타일(toc 1 …)


@dataclass(frozen=True)
class _NumLevel:
    start: int
    fmt: str  # numFmt(decimal·lowerLetter·bullet…)
    text: str  # lvlText — "%1.%2"처럼 수준 자리를 담는다
    suffix: str  # 번호와 글 사이에 넣을 글자(탭·공백은 공백 하나, nothing이면 없음)
    style_id: str | None  # 이 수준에 묶인 문단 스타일(제목 스타일 번호)


@dataclass(frozen=True)
class _NumInstance:
    """w:num 하나 — 카운터는 abstract_id마다 하나라 같은 정의를 쓰는 목록은 번호가 이어진다."""

    abstract_id: str
    levels: dict[int, _NumLevel]
    restarts: dict[int, int]  # 수준 → 이 목록이 처음 쓰일 때 다시 시작할 값(startOverride)


class _Numbering:
    """자동 번호 계산 — 문서 순서로 문단마다 take_label을 불러 Word가 보여 주는 번호 글자를 얻는다."""

    def __init__(self, instances: dict[str, _NumInstance]) -> None:
        self._instances = instances
        self._counters: dict[str, dict[int, int]] = {}
        self._restarted: set[tuple[str, int]] = set()

    def take_label(self, number: _ParaNumber) -> str | None:
        """번호 글자(뒤 공백 포함, 번호가 안 보이는 수준이면 "") — 정의를 못 찾으면 None. 부를 때마다 카운터가 나아간다."""
        instance = self._instances.get(number.num_id)
        if instance is None:
            return None
        level = number.level
        if level is None:
            level = _pick_style_level(instance, number)
        spec = instance.levels.get(level)
        if spec is None:
            return None
        counters = self._counters.setdefault(instance.abstract_id, {})
        restart = instance.restarts.get(level)
        if restart is not None and (number.num_id, level) not in self._restarted:
            self._restarted.add((number.num_id, level))
            counters[level] = restart
        else:
            counters[level] = counters[level] + 1 if level in counters else spec.start
        for deeper in [key for key in counters if key > level]:
            del counters[deeper]  # 위 수준이 나아가면 아래 수준은 처음부터 다시 센다
        if spec.fmt == "bullet":
            label = _pick_bullet(spec.text)
        else:
            label = _LEVEL_REF_RE.sub(lambda ref: _format_level(instance, counters, int(ref.group(1)) - 1), spec.text)
        return label + spec.suffix if has_visible_char(label) else ""


def _pick_style_level(instance: _NumInstance, number: _ParaNumber) -> int:
    """스타일로 걸린 번호의 수준 — 자기 스타일에 묶인 수준(pStyle) → 스타일이 적은 ilvl → 조상 스타일에 묶인 수준 → 0.

    조상에 묶인 수준을 먼저 잡으면 numId를 물려받은 아래 수준 스타일이 윗수준 번호를 받는다(6.1.1이 6.2로 읽히고 뒤가 밀린다).
    """
    linked = {spec.style_id: key for key, spec in sorted(instance.levels.items(), reverse=True)}
    own, ancestors = number.style_ids[:1], number.style_ids[1:]
    if own and own[0] in linked:
        return linked[own[0]]
    if number.style_level is not None:
        return number.style_level
    return next((linked[style_id] for style_id in ancestors if style_id in linked), 0)


def _format_level(instance: _NumInstance, counters: dict[int, int], level: int) -> str:
    spec = instance.levels.get(level)
    if spec is None:
        return ""
    # 아직 쓰이지 않은 위 수준은 Word처럼 시작 값으로 보이고, 보인 값은 센 것으로 남긴다 — 남기지 않으면 뒤에 오는
    # 위 수준 문단(장을 넘기는 숨긴 빈 문단)이 시작 값을 다시 받아 다음 장의 단계가 앞 장 번호로 나온다
    return _format_number(counters.setdefault(level, spec.start), spec.fmt)


def _format_number(value: int, fmt: str) -> str:
    """numFmt대로 쓴 번호 — 모르는 형식(koreanCounting 등)은 숫자로 쓴다."""
    if fmt in ("none", "bullet"):
        return ""
    if value >= 1:
        if fmt in ("lowerLetter", "upperLetter") and (value - 1) // 26 < MAX_LETTER_REPEAT:
            # Word는 z 다음을 aa, bb…로 쓴다
            letters = chr(ord("a") + (value - 1) % 26) * ((value - 1) // 26 + 1)
            return letters if fmt == "lowerLetter" else letters.upper()
        if fmt in ("lowerRoman", "upperRoman") and value <= MAX_ROMAN:
            roman = _format_roman(value)
            return roman if fmt == "lowerRoman" else roman.upper()
        if fmt == "ganada":
            return _GANADA[(value - 1) % len(_GANADA)]
        if fmt == "chosung":
            return _CHOSUNG[(value - 1) % len(_CHOSUNG)]
        if fmt == "decimalEnclosedCircle" and value <= 20:
            return chr(ord("①") + value - 1)
    if fmt == "decimalZero":
        return f"{value:02d}"
    return str(value)


def _format_roman(value: int) -> str:
    pieces = []
    for amount, letters in _ROMAN_PARTS:
        count, value = divmod(value, amount)
        pieces.append(letters * count)
    return "".join(pieces)


def _pick_bullet(text: str) -> str:
    """글머리표 글자 — 기호 글꼴의 사설 영역 글자(Symbol·Wingdings)나 글자 모양 표("o")는 뜻이 남지 않아 "•"로 쓴다."""
    is_plain_symbol = has_visible_char(text) and not any(ch.isalnum() or "\ue000" <= ch <= "\uf8ff" for ch in text)
    return text if is_plain_symbol else PLAIN_BULLET


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

    def restore(self, snapshot: tuple[int, int]) -> None:
        self.rendered, self.manual = snapshot


@dataclass
class _FigureRef:
    """문단 안 그림 요소 하나(w:drawing·w:pict·w:object)와 그 안의 첫 그림 관계 id."""

    blip_rel_id: str | None = None
    vml_rel_id: str | None = None  # a:blip이 없는 옛 VML 그림·OLE 미리보기
    at: int = 0  # 그림 요소를 만났을 때까지 모은 문단 글자 수 — 써 넣을 자동 번호 앞머리는 아직 없다


@dataclass
class _InlineRead:
    """문단 하나의 run을 걸은 결과. marks가 None이면 쪽 나눔을 세지 않는다(본문 밖·텍스트 상자 안)."""

    marks: _PageMarks | None
    pieces: list[str] = field(default_factory=list)
    first_marks: tuple[int, int] | None = None  # 첫 글자를 만났을 때의 쪽 나눔 수 — 블록의 시작 쪽
    figures: list[_FigureRef] = field(default_factory=list)
    textboxes: list[Element] = field(default_factory=list)
    length: int = 0  # pieces 글자 수의 합

    def pick_image_figure(self) -> _FigureRef | None:
        """문단 그림 블록이 보이는 그림 요소 — 문단 안 첫 a:blip, 없으면 첫 VML 그림, 둘 다 없으면 첫 그림 요소."""
        blips = (figure for figure in self.figures if figure.blip_rel_id)
        vmls = (figure for figure in self.figures if figure.vml_rel_id)
        return next(blips, None) or next(vmls, None) or next(iter(self.figures), None)

    def get_first_image_rel_id(self) -> str | None:
        """문단 그림 블록의 그림 — 문단 안 첫 a:blip, 없으면 첫 VML 그림."""
        figure = self.pick_image_figure()
        return (figure.blip_rel_id or figure.vml_rel_id or None) if figure is not None else None

    def add(self, text: str) -> None:
        if not text:
            return
        if self.first_marks is None and self.marks is not None:
            self.first_marks = self.marks.snapshot()
        self.pieces.append(text)
        self.length += len(text)

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
    is_number_unresolved: bool  # 자동 번호가 걸렸는데 목록 정의를 못 찾아 글에 번호가 없다
    has_figure: bool
    image_part: str | None
    slot: tuple[int, int]  # (컨테이너 번호, 컨테이너 안 순번) — 캡션이 "바로 앞·뒤 문단"인지 판정한다
    number: tuple[int, str] | None = None  # 글 앞 번호 라벨의 (끝 자리, 출처)
    toc: tuple[str, ...] = ()  # 목차로 보이는 까닭들
    # 이 문단이 캡션인 묶음 — ("figure", 그림 레코드의 목록 위치) | ("table", table_index)
    caption_for: tuple[Literal["figure", "table"], int] | None = None
    # 그림 블록의 그림이 놓인 text 안 자리 — 글이 없어 문단 블록을 내지 않는 그림만 든 문단은 None(자리 신호 없음)
    figure_at: int | None = None


@dataclass
class _CellRecord:
    part: str
    in_body: bool
    xml_path: str
    marks: tuple[int, int]
    text: str
    is_number_unresolved: bool  # 칸 안 문단 중 자동 번호를 풀지 못한 것이 있다
    table_index: int
    row_index: int
    col_index: int
    grid_span: int
    row_span: int = 1  # 아래 행의 vMerge 이어지는 칸을 만날 때마다 는다
    is_merge_continuation: bool = False  # 글이 남은 vMerge 이어지는 칸 — 제자리 블록으로 내고 경고한다
    is_header_row: bool = False  # 쪽마다 되풀이하는 표 머리 행(w:tblHeader)의 칸
    is_full_row: bool = False  # 여러 열 표에서 한 칸이 행 전체를 차지한다(장 제목·단계 제목 같은 구조 행)
    numbers: tuple[tuple[int, int, str], ...] = ()  # 칸 글 안 번호 라벨들의 (시작, 끝, 출처)
    para_starts: tuple[int, ...] = ()  # 칸 안 문단들의 시작 자리
    captions: tuple[tuple[int, int, int], ...] = ()  # 칸 안 안쪽 표의 캡션 줄 (시작, 끝, 안쪽 표 번호)


@dataclass
class _CellFigureRecord:
    """표 칸 안 그림 하나 — 칸 블록 바로 뒤에 그림 블록으로 낸다(칸 안에서는 캡션을 묶지 않는다)."""

    part: str
    in_body: bool
    xml_path: str
    marks: tuple[int, int]
    image_part: str | None
    table_index: int
    row_index: int
    col_index: int
    at: int  # 그림이 놓인 칸 글(문단을 "\n"으로 이은 것) 안 자리


_Record = _ParaRecord | _CellRecord | _CellFigureRecord


def read_docx(data: bytes, limits: ExtractLimits) -> ExtractResult:
    """DOCX 바이트 → 원문 블록·표·경고. 받지 않는 파일은 ExtractionRejected(code)를 던진다.

    부분 순서는 본문 → 머리말들 → 꼬리말들(document.xml.rels 순서) → 각주 → 미주.
    """
    with _open_zip(data, limits) as archive:
        document = _load_part(archive, DOCUMENT_PART)
        styles = _load_styles(archive, document.relationships)
        numbering = _load_numbering(archive, document.relationships, styles)
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
    collector = _Collector(styles, numbering, _find_toc_paragraphs(body))
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

    writer = _build_blocks(
        collector.records, collector.marks, _read_section_refs(document), collector.table_slots, collector.band_numbers
    )
    blocks = writer.blocks
    if sum(len(block.text) for block in blocks) > limits.max_chars:
        raise ExtractionRejected("too_many_chars")
    if not any(block.kind == KIND_FIGURE or has_visible_char(block.text) for block in blocks):
        raise ExtractionRejected("empty_document")
    return ExtractResult(
        blocks=tuple(blocks),
        tables=tuple(sorted(collector.tables, key=lambda table: table.index)),
        warnings=writer.build_warnings(),
        has_language_halves=_has_language_halves(body, styles),
    )


def _has_language_halves(body: Element, styles: dict[str, _Style]) -> bool:
    """본문에 한글 절반과 영어 절반을 가르는 강한 신호가 둘 다 있는지 — 절반 책갈피 한 쌍, 또는 절반마다 따로 쓴 문단 스타일 한 쌍."""
    bookmarks = {
        match.group(1).lower()
        for element in body.iter(W_BOOKMARK_START)
        if (match := _HALF_BOOKMARK_RE.fullmatch(element.get(W_NAME, ""))) is not None
    }
    if len(bookmarks) == 2:
        return True
    style_halves: set[str] = set()
    for element in body.iter(W_PSTYLE):
        style_id = element.get(W_VAL, "")
        style = styles.get(style_id)
        match = _HALF_STYLE_RE.search((style.name if style is not None and style.name else style_id).strip())
        if match is not None:
            style_halves.add(match.group(1).lower())
    return len(style_halves) == 2


def _open_zip(data: bytes, limits: ExtractLimits) -> zipfile.ZipFile:
    """ZIP 열기와 안전 검사 — 항목 수·풀린 크기(헤더 기준, 읽기도 그 크기에서 멈춘다)·압축 비율·경로."""
    if data[:4] == OLE_SIGNATURE:
        raise ExtractionRejected("not_a_zip_or_encrypted")
    try:
        archive = zipfile.ZipFile(BytesIO(data))
    except zipfile.BadZipFile as error:
        # 보호를 푼 사본을 올리라고 알릴 수 있게 손상·암호와 구별한다
        code = "drm_protected" if DRM_MARK in data[:DRM_HEAD_BYTES] else "not_a_zip_or_encrypted"
        raise ExtractionRejected(code) from error
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
    """선언된 풀린 크기까지만 푼다 — archive.read는 압축 흐름 전체를 한 번에 풀어, 크기를 속인 항목이 메모리를 다 쓴다."""
    try:
        info = archive.getinfo(name)
    except KeyError:
        return None
    try:
        with archive.open(info) as entry:
            # zipfile은 선언 크기에서 멈추므로 속인 크기는 그 끝의 CRC 불일치(BadZipFile)로 드러난다
            return entry.read(info.file_size)
    # 선언 크기·CRC·머리가 실제 흐름과 다르다 — 크기를 속인 압축 폭탄과 같은 모양이라 안전 검사 실패로 본다
    except zipfile.BadZipFile as error:
        raise ExtractionRejected("unsafe_zip") from error
    # 항목 안쪽이 깨졌거나(압축 손상·잘림) 읽을 수 없는 방식(암호화·지원 안 하는 압축)
    except (zlib.error, RuntimeError, EOFError) as error:
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
                style_id=style_id,
                name=name_element.get(W_VAL, "") if name_element is not None else "",
                based_on=based_on.get(W_VAL) if based_on is not None else None,
                outline_level=_read_outline_level(p_pr),
                num_ref=_read_numbering(p_pr),
            )
    return styles


def _load_numbering(
    archive: zipfile.ZipFile, relationships: Iterable[_Relationship], styles: dict[str, _Style]
) -> _Numbering:
    """numbering.xml → numId마다 목록 정의. 번호 부분이 없으면 빈 정의(번호 문단은 못 푼 번호로 표시된다)."""
    instances: dict[str, _NumInstance] = {}
    for name in _find_targets(relationships, "numbering")[:1]:
        content = _read_entry(archive, name)
        if content is None:
            continue
        root = _parse_xml(content)
        abstracts = {element.get(W_ABSTRACT_NUM_ID, ""): element for element in root.findall(W_ABSTRACT_NUM)}
        nums = root.findall(W_NUM)
        nums_by_id = {num.get(W_NUM_ID, ""): num for num in nums}
        for num in nums:
            abstract_id = _read_abstract_id(num)
            abstract = abstracts.get(abstract_id)
            link = abstract.find(W_NUM_STYLE_LINK) if abstract is not None else None
            if link is not None:
                # 목록 스타일을 따르는 정의 — 수준은 그 스타일이 가리키는 목록 정의에 있다
                style = styles.get(link.get(W_VAL, ""))
                linked_id = style.num_ref.num_id if style is not None and style.num_ref is not None else None
                linked_num = nums_by_id.get(linked_id) if linked_id is not None else None
                abstract_id = _read_abstract_id(linked_num) if linked_num is not None else abstract_id
                abstract = abstracts.get(abstract_id)
            if abstract is None:
                continue
            levels = {
                level: _read_level(element)
                for element in abstract.findall(W_LVL)
                if (level := _read_level_index(element)) is not None
            }
            restarts: dict[int, int] = {}
            for override in num.findall(W_LVL_OVERRIDE):
                level = _read_level_index(override)
                if level is None:
                    continue
                redefined = override.find(W_LVL)
                if redefined is not None:
                    levels[level] = _read_level(redefined)
                    restarts[level] = levels[level].start
                start = override.find(W_START_OVERRIDE)
                if start is not None:
                    restarts[level] = _read_number_start(start)
            instances[num.get(W_NUM_ID, "")] = _NumInstance(abstract_id, levels, restarts)
    return _Numbering(instances)


def _read_abstract_id(num: Element) -> str:
    element = num.find(W_ABSTRACT_NUM_ID)
    return element.get(W_VAL, "") if element is not None else ""


def _read_level_index(element: Element) -> int | None:
    value = element.get(W_ILVL, "")
    return int(value) if value.isdigit() and int(value) < MAX_NUMBER_LEVELS else None


def _read_level(level: Element) -> _NumLevel:
    fmt, text, suffix, style = level.find(W_NUM_FMT), level.find(W_LVL_TEXT), level.find(W_SUFF), level.find(W_PSTYLE)
    return _NumLevel(
        start=_read_number_start(level.find(W_START)),
        # numFmt가 없으면(새 형식을 mc:AlternateContent로 감싼 경우 포함) 숫자다
        fmt=fmt.get(W_VAL, "decimal") if fmt is not None else "decimal",
        text=text.get(W_VAL, "")[:MAX_LEVEL_TEXT_CHARS] if text is not None else "",
        suffix="" if suffix is not None and suffix.get(W_VAL) == "nothing" else " ",
        style_id=style.get(W_VAL) if style is not None else None,
    )


def _read_section_refs(document: _Part) -> dict[str, tuple[str, ...]]:
    """머리말·꼬리말 부분 이름(header1…) → 그 부분을 거는 구역 표시들. 구역은 문서 순서로 1부터(sectPr마다 하나)."""
    labels = {rel.rel_id: posixpath.splitext(posixpath.basename(rel.target))[0] for rel in document.relationships if rel.target}
    refs: dict[str, list[str]] = {}
    for section, sect_pr in enumerate(document.root.iter(W_SECT_PR), start=1):
        for reference in sect_pr:
            label = labels.get(reference.get(R_ID, ""))
            if reference.tag in (W_HEADER_REFERENCE, W_FOOTER_REFERENCE) and label is not None:
                flag = f"{FLAG_SECTION_REF_PREFIX}{section}:{reference.get(W_TYPE, 'default')}"
                flags = refs.setdefault(label, [])
                if len(flags) < MAX_SECTION_REFS:
                    flags.append(flag)
    return {label: tuple(flags) for label, flags in refs.items()}


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
            # 그림 요소는 서로 겹쳐 놓이지 않으므로(상자 글은 따로 모은다) 안쪽 그림 관계는 마지막 그림 요소의 것이다
            if tag in _FIGURE_TAGS:
                read.figures.append(_FigureRef(at=read.length))
            elif tag == A_BLIP and read.figures and read.figures[-1].blip_rel_id is None:
                read.figures[-1].blip_rel_id = child.get(R_EMBED)
            elif tag == V_IMAGEDATA and read.figures and read.figures[-1].vml_rel_id is None:
                read.figures[-1].vml_rel_id = child.get(R_ID)
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


def _read_numbering(p_pr: Element | None) -> _NumRef | None:
    """numPr가 있으면 그 numId·ilvl(적지 않은 쪽은 None), numPr가 없으면 None(스타일을 따른다)."""
    num_pr = p_pr.find(W_NUM_PR) if p_pr is not None else None
    if num_pr is None:
        return None
    num_id, level = num_pr.find(W_NUM_ID), num_pr.find(W_ILVL)
    level_value = level.get(W_VAL, "") if level is not None else ""
    return _NumRef(
        num_id=num_id.get(W_VAL) if num_id is not None else None,
        level=int(level_value) if level_value.isdigit() else None,
    )


def _is_on(element: Element | None) -> bool:
    """켜고 끄는 속성 요소 — 요소가 있고 값이 "끔"이 아니면 켬이다."""
    return element is not None and element.get(W_VAL, "true") not in _OFF_VALUES


def _read_int(element: Element | None, default: int, attribute: str = W_VAL) -> int:
    value = element.get(attribute, "") if element is not None else ""
    # 자릿수 상한: 아주 긴 숫자 글자는 int()가 거절한다(조작한 파일)
    return int(value) if value.isdigit() and len(value) <= 9 else default


def _read_number_start(element: Element | None) -> int:
    return min(_read_int(element, 1), MAX_NUMBER_START)


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
    number = _read_para_number(_read_numbering(p_pr), style_id, chain)
    return _ParaStyle(
        heading_level=heading_level, number=number, is_caption=name == "caption",
        is_toc=_TOC_STYLE_RE.fullmatch(name) is not None,
    )


def _read_para_number(direct: _NumRef | None, style_id: str | None, chain: list[_Style]) -> _ParaNumber | None:
    """문단의 자동 번호 — numId는 문단, 없으면 스타일 조상 순. numId 0은 번호 끄기다.

    문단이 numId를 직접 적으면 수준은 ilvl(없으면 0)이다. 스타일로 걸린 번호는 문단이 ilvl을 적지 않는 한 None으로 두고,
    목록 정의의 pStyle 연결과 스타일이 적은 ilvl로 찾는다(_pick_style_level) — numId는 상위 스타일에서 물려받고 자기 ilvl만
    적는 스타일이 있어 가장 가까운 스타일의 ilvl을 함께 싣는다.
    """
    style_refs = [style.num_ref for style in chain if style.num_ref is not None]
    if direct is not None and direct.num_id is not None:
        num_id, level = direct.num_id, direct.level or 0
    else:
        num_id = next((ref.num_id for ref in style_refs if ref.num_id is not None), None)
        level = direct.level if direct is not None else None
    if num_id is None or num_id == "0":
        return None
    # 문단 스타일 id는 styles.xml에 없어도 싣는다 — 목록 정의의 pStyle과는 id로 견준다
    style_ids = dict.fromkeys([style_id, *(style.style_id for style in chain)])
    style_level = next((ref.level for ref in style_refs if ref.level is not None), None)
    return _ParaNumber(num_id, level, tuple(item for item in style_ids if item), style_level)


class _Collector:
    """1단계 — 컨테이너(본문·머리말·칸·상자…)를 문서 순서로 걸어 레코드와 표를 모은다."""

    def __init__(self, styles: dict[str, _Style], numbering: _Numbering, toc_paragraphs: dict[int, set[str]]) -> None:
        self.styles = styles
        self.numbering = numbering
        self._toc_paragraphs = toc_paragraphs  # 본문 문단 요소 id → 목차 까닭(필드·구성 요소)
        self.band_numbers: dict[int, str] = {}  # 띠 표 → 번호(절 경로를 잡는다)
        self._table_signals: dict[int, dict[str, object]] = {}
        self._first_row_tables: dict[int, list[list[object]]] = {}  # 바깥 표 → 첫 행 칸 안의 표들
        self.records: list[_Record] = []
        self.tables: list[ExtractedTable] = []
        self.marks = _PageMarks()  # 본문 흐름 하나뿐이다
        self.table_slots: dict[int, tuple[int, int]] = {}  # 컨테이너에 바로 놓인 표 → 슬롯(칸 안 표는 없다)
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
                self._read_table(item, item_path, context, marks, host_marks, None, out, (container, position))

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
        style = _read_para_style(paragraph, self.styles)
        raw = "".join(read.pieces)
        text, is_number_unresolved, number = self._add_number(raw, style)
        figure = read.pick_image_figure()
        out.append(
            _ParaRecord(
                part=context.part,
                in_body=context.in_body,
                xml_path=path,
                marks=para_marks,
                text=text,
                style=style,
                is_number_unresolved=is_number_unresolved,
                has_figure=bool(read.figures),
                image_part=_get_image_part(context, read.get_first_image_rel_id()),
                slot=slot,
                number=number,
                toc=self._read_toc(paragraph, style, text) if context.part == PART_BODY else (),
                # 써 넣은 자동 번호는 글 앞머리라 그 길이(len(text) - len(raw))만큼 뒤로 민다
                figure_at=figure.at + len(text) - len(raw) if figure is not None and text else None,
            )
        )
        self._read_textboxes(read.textboxes, path, context, para_marks, out)

    def _add_number(self, text: str, style: _ParaStyle) -> tuple[str, bool, tuple[int, str] | None]:
        """자동 번호를 글 앞에 붙인다 — (글, 번호를 못 풀었는지, 번호 라벨의 (끝 자리, 출처)).

        번호 문단마다 한 번만 불러야 카운터가 Word와 맞는다. 글이 없는 번호 문단(빈 줄·그림만 있는 문단)은 Word에서 번호가
        보여도 붙이지 않는다 — 번호만 있는 단위가 생기지 않게 카운터만 나아간다.
        """
        if style.number is None:
            return text, False, _find_number(text, "")
        label = self.numbering.take_label(style.number)
        if label is None:
            return text, True, _find_number(text, "")
        if not text:
            return text, False, None
        return label + text, False, _find_number(text, label)

    def _read_toc(self, paragraph: Element, style: _ParaStyle, text: str) -> tuple[str, ...]:
        """본문 문단이 목차로 보이는 까닭들 — 판정(어느 까닭이면 목차로 다룰지)은 읽는 쪽이 한다."""
        reasons = set(self._toc_paragraphs.get(id(paragraph), ()))
        if style.is_toc:
            reasons.add(TOC_STYLE)
        if _DOT_LEADER_RE.search(text) is not None or ("\t" in text and _has_dot_tab(paragraph)):
            reasons.add(TOC_LEADER)
        return tuple(reason for reason in (TOC_STYLE, TOC_FIELD, TOC_SDT, TOC_LEADER) if reason in reasons)

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
        slot: tuple[int, int] | None = None,
        place: tuple[int, int, int] | None = None,
    ) -> None:
        """place는 안쪽 표가 바깥 칸에서 놓인 자리 — (행, 격자 열, 그 칸에서 표 앞에 있던 문단 수)."""
        index = self._table_count
        self._table_count += 1
        if slot is not None:
            self.table_slots[index] = slot
        grid = table.find(W_TBL_GRID)
        rows = list(_iter_tagged(table, path, _ROW_TAGS))
        n_cols = len(grid.findall(W_GRID_COL)) if grid is not None else 0
        open_merges: dict[int, _CellRecord] = {}  # 격자 열 → vMerge를 시작한 칸
        own_cells: list[_CellRecord] = []
        for row_index, (row, row_path) in enumerate(rows):
            row_pr = row.find(W_TR_PR)
            col = _read_int(row_pr.find(W_GRID_BEFORE) if row_pr is not None else None, 0)
            is_header_row = _is_on(row_pr.find(W_TBL_HEADER) if row_pr is not None else None)
            cells = list(_iter_tagged(row, row_path, _CELL_TAGS))
            # 한 행의 칸들은 나란히 놓인 흐름이다 — 칸마다 행 시작 쪽에서 출발하고, 행 뒤는 가장 멀리 간 칸을 따른다
            row_start = marks.snapshot() if marks is not None else None
            cell_ends: list[tuple[int, int]] = []
            still_open: dict[int, _CellRecord] = {}
            for cell, cell_path in cells:
                if marks is not None and row_start is not None:
                    marks.restore(row_start)
                cell_pr = cell.find(W_TC_PR)
                span = max(1, _read_int(cell_pr.find(W_GRID_SPAN) if cell_pr is not None else None, 1))
                v_merge = cell_pr.find(W_V_MERGE) if cell_pr is not None else None
                merge = None if v_merge is None else v_merge.get(W_VAL, "continue")
                record, extras = self._read_cell(cell, cell_path, context, marks, host_marks, (index, row_index, col, span))
                record.is_header_row = is_header_row
                record.is_full_row = len(cells) == 1 and col == 0 and n_cols > 1 and span >= n_cols
                own_cells.append(record)
                started = open_merges.get(col)
                if merge == "continue" and started is not None:
                    started.row_span += 1
                    still_open[col] = started
                    # 이어지는 칸은 시작 칸에 합쳐져 보인다 — 빈 칸은 블록을 만들지 않고(같은 글이 두 번 생기지 않게),
                    # 글·그림·상자·표가 남아 있으면 버리지 않고 제자리 블록으로 낸다
                    if has_visible_char(record.text) or extras:
                        record.is_merge_continuation = True
                        out.append(record)
                        out.extend(extras)
                else:
                    out.append(record)
                    out.extend(extras)
                    if merge == "restart":
                        still_open[col] = record
                if marks is not None:
                    cell_ends.append(marks.snapshot())
                col += span
            if marks is not None and cell_ends:
                marks.restore((max(end[0] for end in cell_ends), max(end[1] for end in cell_ends)))
            open_merges = still_open
        signals: dict[str, object] = {}
        widths = [_read_int(column, 0, W_W) for column in grid.findall(W_GRID_COL)] if grid is not None else []
        if widths:
            signals[SIGNAL_WIDTHS] = widths[:MAX_SIGNAL_WIDTHS]
        if index in self._first_row_tables:
            signals[SIGNAL_FIRST_ROW] = self._first_row_tables[index]
        band_number = _read_band_number(own_cells, len(rows))
        if band_number is not None:
            signals[SIGNAL_BAND] = {"number": band_number, "level": band_number.count(".") + 1}
            self.band_numbers[index] = band_number
        if place is not None and parent_index is not None:
            row_index, col_index, n_paras = place
            signals[SIGNAL_PLACE] = {"row": row_index, "col": col_index, "para": n_paras}
            if row_index == 0:
                shape = SIGNAL_BAND if band_number is not None else "table"
                self._first_row_tables.setdefault(parent_index, []).append([col_index, shape])
        self.tables.append(
            ExtractedTable(
                index=index,
                parent_index=parent_index,
                part=context.part,
                xml_path=_fit_xml_path(path),
                n_rows=len(rows),
                n_cols=n_cols,
                signals=signals,
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
    ) -> tuple[_CellRecord, list[_Record]]:
        """칸 하나 = 블록 하나(문단은 "\\n"으로 잇는다)와, 그 뒤에 낼 것들 — 칸 안 그림(그림마다, 순서대로),
        이어서 상자 글·안쪽 표(문서 순서). 낼지는 부르는 쪽이 정한다(vMerge 이어지는 빈 칸은 내지 않는다)."""
        table_index, row_index, col_index, grid_span = position
        texts: list[str] = []
        para_starts: list[int] = []
        numbers: list[tuple[int, int, str]] = []
        offset = 0
        first_marks: tuple[int, int] | None = None
        is_number_unresolved = False
        figures: list[_Record] = []
        after: list[_Record] = []
        para_shapes: list[_CellPara] = []
        inner_tables: list[tuple[int, int]] = []  # (그 칸에서 표 앞에 있던 문단 수, 안쪽 표 번호)
        for item, item_path in _iter_tagged(cell, path, _BLOCK_TAGS):
            if item.tag == W_P:
                read, para_marks = self._read_runs(item, marks, host_marks)
                raw = "".join(read.pieces)
                style = _read_para_style(item, self.styles)
                text, is_unresolved, number = self._add_number(raw, style)
                para_shapes.append(_read_cell_para(text, style, bool(read.figures)))
                if number is not None:
                    numbers.append((offset, offset + number[0], number[1]))
                para_starts.append(offset)
                # 그림 자리 = 문단 시작 + 써 넣은 자동 번호 길이 + 그림 앞 글자 수
                figure_shift = offset + len(text) - len(raw)
                offset += len(text) + 1  # 문단은 "\n" 하나로 잇는다
                texts.append(text)
                first_marks = first_marks or read.first_marks
                is_number_unresolved = is_number_unresolved or is_unresolved
                figures.extend(
                    _CellFigureRecord(
                        part=context.part,
                        in_body=context.in_body,
                        xml_path=item_path,
                        marks=para_marks,
                        image_part=_get_image_part(context, figure.blip_rel_id or figure.vml_rel_id),
                        table_index=table_index,
                        row_index=row_index,
                        col_index=col_index,
                        at=figure_shift + figure.at,
                    )
                    for figure in read.figures
                )
                self._read_textboxes(read.textboxes, item_path, context, para_marks, after)
            else:
                inner_tables.append((len(texts), self._table_count))
                self._read_table(
                    item, item_path, context, marks, host_marks, table_index, after,
                    place=(row_index, col_index, len(texts)),
                )
        cell_text = "\n".join(texts)
        whole = trim_blank_range(cell_text, 0, len(cell_text))
        if whole is not None and _NUMBER_CELL_RE.fullmatch(cell_text, *whole) is not None:
            numbers = [(*whole, NUMBER_CELL)]
        record = _CellRecord(
            part=context.part,
            in_body=context.in_body,
            xml_path=path,
            marks=first_marks or (marks.snapshot() if marks is not None else host_marks),
            text=cell_text,
            is_number_unresolved=is_number_unresolved,
            table_index=table_index,
            row_index=row_index,
            col_index=col_index,
            grid_span=grid_span,
            numbers=tuple(numbers),
            para_starts=tuple(para_starts),
            captions=_find_cell_captions(cell_text, para_starts, para_shapes, inner_tables),
        )
        return record, figures + after


def _find_number(text: str, label: str) -> tuple[int, str] | None:
    """문단 글(label + text) 앞 번호 라벨의 (끝 자리, 출처) — 번호가 없으면 None.

    자동 번호(label)는 뒤 공백을 뺀 데까지이고, 바로 뒤에 같은 번호를 타자로 또 쳤으면("6.1 " + "6.1 목적") 거기까지 한 번호다.
    자동 번호가 없으면 글 앞에 타자로 친 번호를 찾는다.
    """
    first = len(text) - len(text.lstrip())
    typed = TYPED_NUMBER_RE.match(text, first)
    if has_visible_char(label):
        if typed is not None and typed.group().rstrip(".") == label.strip().rstrip("."):
            return len(label) + typed.end(), NUMBER_AUTO
        return len(label.rstrip()), NUMBER_AUTO
    return (typed.end(), NUMBER_TYPED) if typed is not None else None


def _has_dot_tab(paragraph: Element) -> bool:
    """문단이 점 끌기 탭 위치를 직접 정했는지(w:tabs/w:tab w:leader="dot") — 스타일이 정한 것은 보지 않는다(목차 스타일은 이름으로 안다)."""
    p_pr = paragraph.find(W_PPR)
    tabs = p_pr.find(W_TABS) if p_pr is not None else None
    return tabs is not None and any(tab.get(W_LEADER) == "dot" for tab in tabs)


def _read_band_number(cells: list[_CellRecord], n_rows: int) -> str | None:
    """띠 표(표형 옛 SOP의 절 제목 표)의 번호 — 1행 3칸에 번호 칸 | 빈 칸 | 제목 칸일 때만. 끝 마침표는 뗀다."""
    if n_rows != 1 or len(cells) != 3:
        return None
    number = cells[0].text.strip()
    if _BAND_NUMBER_RE.fullmatch(number) is None or has_visible_char(cells[1].text) or not has_visible_char(cells[2].text):
        return None
    return number.rstrip(".")


def _find_toc_paragraphs(body: Element) -> dict[int, set[str]]:
    """본문에서 목차 안에 든 문단 요소 id → 까닭 — TOC 필드의 결과 글이 든 문단("field"), 목차 구성 요소 안 문단("sdt")."""
    found: dict[int, set[str]] = {}
    for sdt in body.iter(W_SDT):
        gallery = sdt.find(f"{W_SDT_PR}/{W_DOC_PART_OBJ}/{W_DOC_PART_GALLERY}")
        if gallery is not None and gallery.get(W_VAL, "").strip().lower() == TOC_GALLERY:
            for paragraph in sdt.iter(W_P):
                found.setdefault(id(paragraph), set()).add(TOC_SDT)
    # 필드는 begin … (코드) … separate … (결과) … end로 문단을 넘어 이어지고 결과 안에 다른 필드(HYPERLINK·PAGEREF)를 품는다
    open_fields: list[list[object]] = []  # [코드 글, 결과가 시작됐는지, TOC인지]
    paragraph: Element | None = None
    for element in body.iter():
        tag = element.tag
        if tag == W_P:
            paragraph = element
        elif tag == W_FLD_CHAR:
            kind = element.get(W_FLD_CHAR_TYPE)
            if kind == "begin":
                open_fields.append(["", False, False])
            elif kind == "separate" and open_fields:
                field_state = open_fields[-1]
                field_state[1], field_state[2] = True, _TOC_FIELD_RE.match(str(field_state[0])) is not None
            elif kind == "end" and open_fields:
                open_fields.pop()
        elif tag == W_INSTR_TEXT and open_fields and not open_fields[-1][1]:
            open_fields[-1][0] = f"{open_fields[-1][0]}{element.text or ''}"[:MAX_LEVEL_TEXT_CHARS]
        elif tag == W_T and paragraph is not None and any(field_state[2] for field_state in open_fields):
            found.setdefault(id(paragraph), set()).add(TOC_FIELD)
    return found


def _get_image_part(context: _PartContext, rel_id: str | None) -> str | None:
    return context.rel_targets.get(rel_id) if rel_id else None


def _fit_xml_path(path: str) -> str:
    """xml_path를 컬럼 길이에 맞춘다 — 넘치면 첫 조각(부분 이름)과 끝을 남기고 가운데를 "/…/"로 줄인다."""
    if len(path) <= XML_PATH_MAX_CHARS:
        return path
    head = path.split("/", 1)[0] + XML_PATH_ELLIPSIS
    return head + path[len(path) - (XML_PATH_MAX_CHARS - len(head)) :]


def _is_caption(record: _ParaRecord, kind: Literal["figure", "table"]) -> bool:
    return record.caption_for is None and _is_caption_shape(record.text, record.style, record.has_figure, kind)


def _is_caption_shape(text: str, style: _ParaStyle, has_figure: bool, kind: Literal["figure", "table"]) -> bool:
    """그 종류의 캡션 꼴인지 — 캡션 스타일이거나 그 종류의 머리면 캡션, 다른 종류의 머리면 아니다."""
    own, other = (FIGURE_CAPTION_RE, TABLE_CAPTION_RE) if kind == "figure" else (TABLE_CAPTION_RE, FIGURE_CAPTION_RE)
    if has_figure or not has_visible_char(text):
        return False
    if own.match(text) is not None:
        return True
    return style.is_caption and other.match(text) is None


@dataclass(frozen=True)
class _CellPara:
    """칸 안 문단 하나의 캡션 판정 재료 — 칸 글은 블록 하나라 문단 레코드가 없다."""

    is_blank: bool  # 글자도 그림도 없다(캡션을 찾을 때 건너뛴다)
    is_table_caption: bool


def _read_cell_para(text: str, style: _ParaStyle, has_figure: bool) -> _CellPara:
    return _CellPara(
        is_blank=not has_figure and not has_visible_char(text),
        is_table_caption=_is_caption_shape(text, style, has_figure, "table"),
    )


def _find_cell_captions(
    cell_text: str, para_starts: list[int], paras: list[_CellPara], inner_tables: list[tuple[int, int]]
) -> tuple[tuple[int, int, int], ...]:
    """칸 안 안쪽 표의 캡션 줄 — (칸 글 안 시작, 끝, 안쪽 표 번호). 칸 블록은 쪼개지 않고 줄 범위로만 가리킨다.

    그릇에 바로 놓인 표와 같은 규칙이다(_attach_captions): 모든 표가 바로 앞 문단(빈 문단은 건너뛰고, 다른 안쪽 표를 넘지
    않는다)을 먼저 보고, 캡션이 없는 표만 바로 뒤 문단을 본다. 문단 안 줄바꿈 뒤는 다른 단위 줄이라 첫 줄만 캡션이다.
    """
    sides: list[tuple[int | None, int | None]] = []  # 표마다 (바로 앞, 바로 뒤) 글 있는 문단
    for order, (at, _) in enumerate(inner_tables):
        lower = inner_tables[order - 1][0] if order else 0  # 앞 표 뒤 문단부터
        upper = inner_tables[order + 1][0] if order + 1 < len(inner_tables) else len(paras)  # 다음 표 앞 문단까지
        before = next((i for i in range(at - 1, lower - 1, -1) if not paras[i].is_blank), None)
        after = next((i for i in range(at, upper) if not paras[i].is_blank), None)
        sides.append((before, after))
    found: dict[int, int] = {}  # 표 순번 → 캡션 문단
    for turn in (0, 1):
        for order, side in enumerate(sides):
            index = side[turn]
            if order not in found and index is not None and index not in found.values() and paras[index].is_table_caption:
                found[order] = index
    captions: list[tuple[int, int, int]] = []
    for order, index in sorted(found.items()):
        start = para_starts[index]
        end = cell_text.find("\n", start)
        line = trim_blank_range(cell_text, start, len(cell_text) if end < 0 else end)
        if line is not None:
            captions.append((*line, inner_tables[order][1]))
    return tuple(captions)


def _find_neighbor(
    by_slot: dict[tuple[int, int], _ParaRecord], container: int, position: int, step: int
) -> _ParaRecord | None:
    """step 쪽 첫 이웃 문단 — 빈 문단은 건너뛰고, 표(문단 레코드가 없는 자리)를 만나면 없다."""
    while (neighbor := by_slot.get((container, position := position + step))) is not None:
        if neighbor.has_figure or has_visible_char(neighbor.text):
            return neighbor
    return None


def _pick_flags(*candidates: tuple[str, bool]) -> tuple[str, ...]:
    return tuple(flag for flag, is_on in candidates if is_on)


def _attach_captions(records: list[_Record], table_slots: dict[int, tuple[int, int]]) -> None:
    """캡션 문단 찾기 — 같은 컨테이너의 이웃 문단 중 그림은 바로 뒤 → 바로 앞, 표는 바로 앞 → 바로 뒤가 캡션 꼴이면 잇는다.
    빈 문단은 건너뛴다.

    템플릿 자리(표는 위, 그림은 아래)가 먼저다 — 모든 묶음이 제 자리 쪽을 먼저 보고, 그래도 캡션이 없는 묶음만 반대쪽을 본다.
    그래서 두 표 사이 "표 2"는 아래 표가 갖는다(위 표가 캡션이 없어도). 칸 안 그림에는 잇지 않고, 칸 안 표는 칸 블록의
    captions 신호로 잇는다(_find_cell_captions). 칸 블록이 하나도 없는 표는 가리킬 블록이 없어 건너뛴다.
    """
    by_slot = {record.slot: record for record in records if isinstance(record, _ParaRecord)}
    bundles: list[tuple[tuple[Literal["figure", "table"], int], tuple[int, int], tuple[int, int]]] = []
    seen_tables: set[int] = set()
    for index, record in enumerate(records):
        if isinstance(record, _ParaRecord) and record.has_figure:
            bundles.append((("figure", index), record.slot, (1, -1)))
        elif (
            isinstance(record, _CellRecord)
            and record.table_index in table_slots
            and record.table_index not in seen_tables
        ):
            seen_tables.add(record.table_index)
            bundles.append((("table", record.table_index), table_slots[record.table_index], (-1, 1)))
    captioned: set[int] = set()
    for turn in (0, 1):
        for number, (target, (container, position), offsets) in enumerate(bundles):
            if number in captioned:
                continue
            neighbor = _find_neighbor(by_slot, container, position, offsets[turn])
            if neighbor is not None and _is_caption(neighbor, target[0]):
                neighbor.caption_for = target
                captioned.add(number)


class _BlockWriter:
    """2단계 — 레코드를 블록으로. seq·구역 이름·추정 쪽의 앞선 본문 글자 수는 내는 순서대로 쌓인다."""

    def __init__(
        self, page_basis: str, section_refs: dict[str, tuple[str, ...]], band_numbers: dict[int, str]
    ) -> None:
        self.page_basis = page_basis
        self._section_refs = section_refs
        self._band_numbers = band_numbers
        self.blocks: list[ExtractedBlock] = []
        self._section_label = ""
        self._shifted_lang: str | None = None  # 바로 앞 문단이 제목답지 않은 조항이면 그 언어(F8b) — 뒤따르는 번호 없는 번역이 절을 잇는다
        self._body_chars = 0
        self._continuation_seqs: dict[int, list[int]] = {}  # 표 → 글이 남은 vMerge 이어지는 칸 블록들
        self._structural_merge_seqs: set[int] = set()  # 병합 경고에서 빼는 구조 행의 병합 칸 블록들
        self._figure_seqs: dict[int, int] = {}  # 그림 문단 레코드의 목록 위치 → 그림 블록 seq
        self._first_cell_seqs: dict[int, int] = {}  # table_index → 첫 칸 블록 seq
        self._caption_seqs: list[tuple[int, tuple[Literal["figure", "table"], int]]] = []  # (캡션 블록 seq, 묶음)
        self._cell_captions: list[tuple[int, tuple[tuple[int, int, int], ...]]] = []  # (칸 블록 seq, 칸 안 캡션 줄들)

    def add_paragraph(self, record: _ParaRecord, index: int) -> None:
        """글자가 있으면 문단 블록, 그림이 있으면 그 뒤에 그림 블록(글 없음). 빈 문단은 블록을 만들지 않는다.

        index는 레코드 목록 위치 — 캡션 문단이 가리키는 그림을 그림 블록 seq로 바꿀 때 쓴다.
        """
        if record.text:
            is_clause = _CLAUSE_LINE_RE.match(record.text) is not None
            previous_shifted, self._shifted_lang = self._shifted_lang, None
            if record.part == PART_BODY and (record.style.heading_level is not None or is_clause):
                # 제목답지 않은 조항(F8b · 설계 2d) — 번호가 있으면 그 번호가 절 이름이고, 번호 없는 조항(앞 조항의 번역)은 앞 절을 잇는다.
                # 쪼개기(segment.build_unit_drafts)가 같은 조항을 문장으로 바꾸는 규칙과 같다
                is_numbered = record.number is not None or _LABEL_NUMBER_RE.match(record.text.strip()) is not None
                lang = detect_language(record.text)
                follows_shift = previous_shifted is not None and not is_numbered and lang not in (None, previous_shifted)
                is_shifted = follows_shift or not is_heading_like(record.text)
                if is_numbered or not is_shifted:
                    self._update_section_label(record.text)
                if is_shifted:
                    self._shifted_lang = lang
            flags = _pick_flags((FLAG_AUTO_NUMBERING, record.is_number_unresolved), (FLAG_CLAUSE_NUMBER, is_clause))
            if record.caption_for is not None:
                self._caption_seqs.append((len(self.blocks), record.caption_for))
            signals: dict[str, object] = {}
            if record.number is not None:
                signals[SIGNAL_NUMBERS] = [[0, *record.number]]
            if record.toc:
                signals[SIGNAL_TOC] = list(record.toc)
            self._append(
                record, KIND_PARAGRAPH, record.text,
                heading_level=record.style.heading_level, flags=flags, signals=signals,
            )
        if record.has_figure:
            # 번호는 그 문단의 첫 블록에만 붙여 경고 개수가 번호 문단 수와 같게 한다
            flags = _pick_flags((FLAG_AUTO_NUMBERING, record.is_number_unresolved and not record.text))
            self._figure_seqs[index] = len(self.blocks)
            # 문장 속 그림 — 자리는 바로 앞에 낸 이 문단의 글 블록 안이다
            figure_signals = {SIGNAL_INLINE: {"at": record.figure_at}} if record.figure_at is not None else {}
            self._append(
                record, KIND_FIGURE, "", image_part=record.image_part, flags=flags, signals=figure_signals,
            )

    def add_cell(self, record: _CellRecord) -> None:
        is_merged = record.grid_span > 1 or record.row_span > 1 or record.is_merge_continuation
        flags = _pick_flags((FLAG_AUTO_NUMBERING, record.is_number_unresolved), (FLAG_MERGED_CELL, is_merged))
        if record.is_merge_continuation:
            self._continuation_seqs.setdefault(record.table_index, []).append(len(self.blocks))
        # 표 머리 행의 병합과, 한 칸이 행 전체를 차지하는 가로 병합은 양식의 구조다 — 표마다 하나씩 경고해 봐야 볼 것이 없다
        is_row_wide_only = record.is_full_row and record.row_span == 1 and not record.is_merge_continuation
        if is_merged and (record.is_header_row or is_row_wide_only):
            self._structural_merge_seqs.add(len(self.blocks))
        self._first_cell_seqs.setdefault(record.table_index, len(self.blocks))
        band_number = self._band_numbers.get(record.table_index)
        if band_number is not None and record.col_index == 0 and record.part == PART_BODY:
            # 띠 표가 절을 연다 — 번호 칸부터 그 절이라 제목 칸과 뒤따르는 본문이 같은 절 경로를 받는다
            self._update_section_label(band_number)
        signals: dict[str, object] = {}
        if record.numbers:
            signals[SIGNAL_NUMBERS] = [list(number) for number in record.numbers]
        if len(record.para_starts) > 1:
            signals[SIGNAL_PARAS] = list(record.para_starts)
        if record.captions:
            self._cell_captions.append((len(self.blocks), record.captions))
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
            signals=signals,
        )

    def add_cell_figure(self, record: _CellFigureRecord) -> None:
        self._append(
            record,
            KIND_FIGURE,
            "",
            table_index=record.table_index,
            row_index=record.row_index,
            col_index=record.col_index,
            image_part=record.image_part,
            signals={SIGNAL_INLINE: {"at": record.at}},  # 자리는 앞선 이 칸 블록의 글 안이다
        )

    def link_captions(self) -> None:
        """캡션 문단 블록에 제 그림·표 블록 seq 표시를 더한다 — 그림·표 블록은 캡션보다 뒤에 올 수 있어 다 낸 뒤에 한다."""
        for caption_seq, (kind, key) in self._caption_seqs:
            target_seq = self._figure_seqs[key] if kind == "figure" else self._first_cell_seqs[key]
            block = self.blocks[caption_seq]
            self.blocks[caption_seq] = replace(block, flags=(*block.flags, f"{FLAG_CAPTION_OF}:{target_seq}"))
        for cell_seq, captions in self._cell_captions:
            # 칸 블록이 하나도 없는 안쪽 표는 가리킬 블록이 없어 건너뛴다
            lines = [[start, end, self._first_cell_seqs[key]] for start, end, key in captions if key in self._first_cell_seqs]
            if lines:
                block = self.blocks[cell_seq]
                self.blocks[cell_seq] = replace(block, signals={**block.signals, SIGNAL_CAPTIONS: lines})

    def build_warnings(self) -> tuple[ExtractedWarning, ...]:
        """병합 칸 경고는 표마다 하나(구조 행이 아닌 첫 병합 칸을 가리킨다), 글이 남은 이어지는 칸 경고도 표마다 하나(개수),
        자동 번호 경고는 번호를 글에 붙이지 못한 블록이 있을 때 문서에 하나(블록 수)."""
        warnings: list[ExtractedWarning] = []
        merged_tables: set[int | None] = set()
        for block in self.blocks:
            if block.seq in self._structural_merge_seqs:
                continue
            if FLAG_MERGED_CELL in block.flags and block.table_index not in merged_tables:
                merged_tables.add(block.table_index)
                warnings.append(ExtractedWarning(FLAG_MERGED_CELL, block.seq, {"table_index": str(block.table_index)}))
        for table_index, seqs in self._continuation_seqs.items():
            detail = {"table_index": str(table_index), "count": str(len(seqs))}
            warnings.append(ExtractedWarning(WARNING_MERGED_CELL_CONTENT, seqs[0], detail))
        numbered_count = sum(FLAG_AUTO_NUMBERING in block.flags for block in self.blocks)
        if numbered_count:
            warnings.append(ExtractedWarning(FLAG_AUTO_NUMBERING, None, {"count": str(numbered_count)}))
        return tuple(warnings)

    def _update_section_label(self, text: str) -> None:
        stripped = text.strip()
        if not stripped:
            return
        number = _LABEL_NUMBER_RE.match(stripped)
        # 앞머리 숫자 묶음도 컬럼보다 길 수 있다("1.1.1…") — 넘치면 Postgres 쓰기가 실패해 업로드가 500이 된다
        self._section_label = (number.group(1) if number is not None else stripped)[:SECTION_LABEL_MAX_CHARS]

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
        signals: dict[str, object] | None = None,
    ) -> None:
        if image_part is not None and len(image_part) > IMAGE_PART_MAX_CHARS:
            # 컬럼보다 긴 관계 대상은 조작한 파일이다 — 잘라 다른 경로를 가리키지 않고, 그림 파일 없이 표시만 남긴다
            image_part, flags = None, (*flags, FLAG_IMAGE_PART_TOO_LONG)
        if record.part in (PART_HEADER, PART_FOOTER):
            # 어느 구역의 어떤 머리말·꼬리말인지 — 화면이 부분마다 이름을 붙인다(xml_path 첫 조각이 부분 이름)
            flags = (*flags, *self._section_refs.get(record.xml_path.split("/", 1)[0], ()))
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
                xml_path=_fit_xml_path(record.xml_path),
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
                signals=signals or {},
            )
        )


def _build_blocks(
    records: list[_Record],
    marks: _PageMarks,
    section_refs: dict[str, tuple[str, ...]],
    table_slots: dict[int, tuple[int, int]],
    band_numbers: dict[int, str],
) -> _BlockWriter:
    """쪽 근거는 문서 전체에 하나 — Word 저장 쪽 나눔이 하나라도 있으면 그것, 없으면 수동 쪽 나눔, 둘 다 없으면 추정."""
    page_basis = "rendered" if marks.rendered else "manual" if marks.manual else "estimated"
    _attach_captions(records, table_slots)
    writer = _BlockWriter(page_basis, section_refs, band_numbers)
    for index, record in enumerate(records):
        if isinstance(record, _CellRecord):
            writer.add_cell(record)
        elif isinstance(record, _CellFigureRecord):
            writer.add_cell_figure(record)
        else:
            writer.add_paragraph(record, index)
    writer.link_captions()
    return writer
