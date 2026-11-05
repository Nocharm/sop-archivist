"""파일 이름 파싱 — 문서 번호·버전·제목을 이름에서 읽는다. 없는 값은 지어내지 않고 빈 칸으로 둔다(사람이 채울 칸)."""

import re
import unicodedata
from dataclasses import dataclass

_CODE_RE = re.compile(r"(?<![A-Za-z0-9])([A-Z]{2,}(?:-[A-Z0-9]{1,8})*-\d{1,6})(?![A-Za-z0-9])")
_VERSION_RE = re.compile(r"(?i)(?:\bv|\brev\.?\s*|\bver\.?\s*|\bversion\s*)(\d+(?:\.\d+)*)")
# 확장자는 글자로 시작하는 끝 조각만 — "Rev.2"의 ".2" 같은 버전을 확장자로 잘라 내지 않게
_EXTENSION_RE = re.compile(r"\.[A-Za-z][A-Za-z0-9]{0,7}$")
# 번호·버전을 지운 뒤 남는 빈 괄호 — "WI-01(ver 1)"의 "()"
_EMPTY_BRACKETS_RE = re.compile(r"\(\s*\)|\[\s*\]|\{\s*\}|（\s*）")
_SPACED_DASH_RE = re.compile(r"\s+-\s+")
_SPACES_RE = re.compile(r"\s+")

# documents.doc_code·doc_version 길이 — 넘는 값을 잘라 다른 번호를 지어내지 않고 빈 칸으로 둔다
MAX_CODE_CHARS = 100
MAX_VERSION_CHARS = 50
# documents·target_docs.title 길이 — 이름은 255자까지지만 NFC가 글자 수를 늘릴 수 있어(악보 기호 하나 → 셋) 제목은 잘라 넣는다
MAX_TITLE_CHARS = 500


@dataclass(frozen=True)
class ParsedFileName:
    doc_code: str
    version: str
    title: str


def parse_file_name(file_name: str) -> ParsedFileName:
    """NFC → 확장자 제거 → `_`를 공백으로 → 첫 문서 번호 → (번호를 뺀 나머지에서) 첫 버전 → 나머지가 제목.

    `_`를 먼저 공백으로 바꾸는 이유: 파이썬 `\\b`는 `_`를 낱말 글자로 봐 "_v3.0"의 버전을 못 찾는다.
    """
    stem = _EXTENSION_RE.sub("", unicodedata.normalize("NFC", file_name)).replace("_", " ")
    doc_code, rest = _take_token(_CODE_RE, stem, MAX_CODE_CHARS)
    version, rest = _take_token(_VERSION_RE, rest, MAX_VERSION_CHARS)
    return ParsedFileName(doc_code=doc_code, version=version, title=_clean_title(rest)[:MAX_TITLE_CHARS])


def _take_token(pattern: re.Pattern[str], text: str, max_chars: int) -> tuple[str, str]:
    """첫 일치의 값(1번 그룹)과 그 일치 전체를 공백으로 바꾼 나머지. 없거나 컬럼보다 길면 ("", 원래 글)."""
    match = pattern.search(text)
    if match is None or len(match.group(1)) > max_chars:
        return "", text
    return match.group(1), f"{text[: match.start()]} {text[match.end() :]}"


def _clean_title(text: str) -> str:
    """빈 괄호를 지우고 ` - `·연속 공백을 공백 하나로, 양끝의 공백·구두점(여닫는 괄호는 남긴다)을 걷는다."""
    text = _EMPTY_BRACKETS_RE.sub(" ", text)
    text = _SPACES_RE.sub(" ", _SPACED_DASH_RE.sub(" ", text))
    start, end = 0, len(text)
    while start < end and _is_edge_char(text[start]):
        start += 1
    while end > start and _is_edge_char(text[end - 1]):
        end -= 1
    return text[start:end]


def _is_edge_char(char: str) -> bool:
    # 여닫는 괄호(Ps·Pe)는 남긴다 — "Centrifuge (Model A)"의 닫는 괄호를 지우지 않게
    category = unicodedata.category(char)
    return char.isspace() or (category.startswith("P") and category not in ("Ps", "Pe"))
