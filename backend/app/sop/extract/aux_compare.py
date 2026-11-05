"""MarkItDown 보조 대조 — 같은 파일을 MarkItDown으로도 읽어 메인 추출에 없는 글자를 찾는다(메인 결과는 고치지 않는다)."""

import re
import unicodedata
from bisect import bisect_right
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from io import BytesIO
from itertools import accumulate
from typing import Literal

from app.sop.extract.docx_reader import INVISIBLE_CHARS

# 정규화한 조각이 이보다 짧으면 비교하지 않는다 — 번호·약어 같은 짧은 조각은 어디에나 들어 있어 판별력이 없다
MIN_PIECE_CHARS = 4
SNIPPET_MAX_CHARS = 200  # 누락 경고에 보여 줄 원래 조각의 길이
# 링크 정규식의 글·주소 길이 상한과 "안에 [ ( 를 두지 않는" 제한 — 닫는 괄호가 없는 "[[[[…"를 길게 넣어도
# 시작 지점마다 끝까지 훑지 않아 선형 시간에 끝난다(공격자가 만든 200만 자 문서가 부모 프로세스를 오래 붙잡지 못하게)
_LINK_TEXT = r"[^\[\]]{0,500}"
_LINK_TARGET = r"[^()]{0,2000}"

_IMAGE_RE = re.compile(rf"!\[{_LINK_TEXT}\]\({_LINK_TARGET}\)")
# MarkItDown이 각주·미주에 붙이는 표식 — 본문 뒤 "[[1]](#footnote-1)"와 주석 끝 "[↑](#footnote-ref-1)"는 원문 글이 아니다
_NOTE_MARK_RE = re.compile(r"\[(?:\[\d{1,6}\]|↑)\]\(#(?:foot|end)note(?:-ref)?-\d{1,6}\)")
_LINK_RE = re.compile(rf"\[({_LINK_TEXT})\]\({_LINK_TARGET}\)")
# \w에는 _가 들어 있어 따로 받는다 — 마크다운은 "\_"로 이스케이프한다
_ESCAPE_RE = re.compile(r"\\([^\w\s]|_)")
# 줄 머리 표시 — 제목 #, 인용 >, 글머리표(- * +, 중첩은 들여쓰기), 번호 목록 "1."
_LINE_HEAD_RE = re.compile(r"^(?:[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+\.[ \t]+))+", re.MULTILINE)
_EMPHASIS_RE = re.compile(r"[*_`]")
_BLANK_REMOVAL = str.maketrans("", "", INVISIBLE_CHARS)
_CELL_SPLIT_RE = re.compile(r"(?<!\\)\|")  # 칸 안의 \| 는 칸 경계가 아니다
_TABLE_SEPARATOR_RE = re.compile(r"^\|(?:\s*:?-+:?\s*\|)+$")


@dataclass(frozen=True)
class MissingText:
    """메인 추출에 없는 MarkItDown 조각 — after_block_index는 그 앞에서 마지막으로 찾은 조각이 든 메인 블록 번호."""

    snippet: str
    after_block_index: int | None


def convert_with_markitdown(data: bytes, file_format: Literal["docx", "pdf"]) -> str:
    """DOCX·PDF 바이트 → 마크다운. 외부로 나가는 기능(LLM·클라우드 문서 인식·URL·플러그인)은 켜지 않는다."""
    # 지연 import — 누락 대조(find_missing_text)만 쓰는 부모 프로세스가 onnxruntime·numpy 같은 무거운 의존성을 올리지 않게,
    # 변환은 자식 프로세스에서만 이 모듈을 불러 쓴다.
    from markitdown import MarkItDown, StreamInfo
    from markitdown.converters import DocxConverter, PdfConverter

    # 기본 변환기를 끄고 두 변환기만 등록한다 — ZIP·HTML·일반 글 변환기가 깨진 파일을 대신 받아 성공처럼 보이는 것을 막는다
    converter = MarkItDown(enable_builtins=False, enable_plugins=False)
    converter.register_converter(DocxConverter())
    converter.register_converter(PdfConverter())
    result = converter.convert_stream(BytesIO(data), stream_info=StreamInfo(extension=f".{file_format}"))
    return result.text_content


def _drop_blank_chars(text: str) -> str:
    """빈 글자(공백류 + INVISIBLE_CHARS)를 모두 지운다 — docx_reader의 판정(isspace 또는 INVISIBLE_CHARS)과 같다.

    str.split()은 isspace() 글자 기준으로 자르므로 글자마다 파이썬 함수를 부르지 않고도 200만 자를 빨리 거른다.
    """
    return "".join(text.split()).translate(_BLANK_REMOVAL)


def normalize_for_compare(text: str) -> str:
    """대조용 정규화 — NFKC → 마크다운 표시 걷기 → 빈 글자 삭제. 메인 글과 마크다운에 같은 규칙을 쓴다."""
    text = unicodedata.normalize("NFKC", text)
    text = _IMAGE_RE.sub("", text)
    text = _NOTE_MARK_RE.sub("", text)
    text = _LINK_RE.sub(r"\1", text)
    text = _ESCAPE_RE.sub(r"\1", text)
    text = _LINE_HEAD_RE.sub("", text)
    text = _EMPHASIS_RE.sub("", text)
    return _drop_blank_chars(text)


def _iter_pieces(markdown: str) -> Iterator[str]:
    """마크다운 → 비교 조각. 표 줄(| 로 시작)은 칸마다, 나머지는 줄마다 한 조각이다."""
    for line in markdown.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if not stripped.startswith("|"):
            yield stripped
        elif _TABLE_SEPARATOR_RE.match(stripped) is None:
            for cell in _CELL_SPLIT_RE.split(stripped):
                if cell.strip():
                    yield cell.strip()


def find_missing_text(
    block_texts: Sequence[str], markdown: str, *, min_chars: int = MIN_PIECE_CHARS
) -> list[MissingText]:
    """마크다운 조각 중 메인 블록 글 전체에 들어 있지 않은 것. 포함 검사라 병합 셀을 펼친 표도 문제없다.

    조각은 문서 순서대로 오므로 앞 조각이 찾힌 자리 뒤부터 먼저 찾는다(200만 자 문서에서 조각마다 처음부터 훑지 않게).
    머리말·꼬리말처럼 순서가 어긋난 글은 처음부터 다시 찾아 잡는다.
    """
    normalized_blocks = [normalize_for_compare(text) for text in block_texts]
    block_ends = list(accumulate(len(text) for text in normalized_blocks))
    haystack = "".join(normalized_blocks)
    missing: list[MissingText] = []
    last_block: int | None = None
    cursor = 0
    for piece in _iter_pieces(markdown):
        needle = normalize_for_compare(piece)
        if len(needle) < min_chars:
            continue
        found = haystack.find(needle, cursor)
        if found < 0:
            found = haystack.find(needle)
        if found < 0:
            missing.append(MissingText(piece[:SNIPPET_MAX_CHARS], last_block))
            continue
        cursor = found + len(needle)
        # 글자 수가 0인 블록은 끝 위치가 앞 블록과 같아 건너뛰어지므로, 찾은 글이 실제로 든 블록 번호가 나온다
        last_block = bisect_right(block_ends, found)
    return missing
