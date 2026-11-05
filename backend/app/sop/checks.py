"""문장 검사 — 출처 문장과 새 문장의 숫자·단위·부정 차이를 코드로 찾는다(DB를 모르는 순수 함수)."""

import re
import unicodedata
from collections import Counter
from collections.abc import Sequence
from decimal import Decimal, InvalidOperation

from app.sop.segment import INVISIBLE_CHARS

KIND_NUMBER = "number_mismatch"
KIND_UNIT = "unit_mismatch"
KIND_NEGATION = "negation_mismatch"

# 같은 뜻 단위 묶음 — 키는 경고에 보이는 표준 표기, 값은 같은 뜻 철자. 키 순서가 경고 목록의 정렬 순서다.
# 철자는 NFKC로 접힌 글자와 맞춘다(℃→°C, µ→μ, ㎖→ml, 서수 기호 º→o). 영어 낱말(minutes·hours·seconds)은 같은 묶음으로 센다.
_UNIT_GROUPS: dict[str, tuple[str, ...]] = {
    "℃": ("℃", "°C", "ºC"),
    "mL": ("mL", "ml"),
    "µL": ("µL", "uL", "μL", "ul", "μl"),
    "L": ("L",),
    "rpm": ("rpm",),
    "×g": ("×g", "× g", "xg", "x g"),
    "g": ("g",),
    "mg": ("mg",),
    "kg": ("kg",),
    "min": ("min", "mins", "minute", "minutes", "분"),
    "h": ("h", "hr", "hrs", "hour", "hours", "시간"),
    "sec": ("sec", "secs", "second", "seconds", "초"),
    "%": ("%",),
    "bar": ("bar",),
    "psi": ("psi",),
    "kPa": ("kPa",),
    "MPa": ("MPa",),
}
# 장비 문서는 RPM·PSI·Min처럼 대문자로도 쓰므로 대소문자를 가리지 않는다. 나머지는 g·G, mPa·MPa처럼 대소문자가 뜻을 가른다
_CASELESS_SPELLINGS = frozenset(
    {
        "rpm", "min", "mins", "minute", "minutes", "hr", "hrs", "hour", "hours",
        "sec", "secs", "second", "seconds", "bar", "psi",
    }
)
# 단위 바로 뒤에 이 글자가 오면 단위가 아니다 — "10 mL 초과"의 초과는 초(sec)가 아니다
_BLOCKED_NEXT = {"초": "과"}
_UNIT_ORDER = {label: index for index, label in enumerate(_UNIT_GROUPS)}

# 세 자리 묶음 쉼표만 지운다 — "1,5"처럼 묶음이 아닌 쉼표는 그대로 둔다
_NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)*", re.ASCII)
_THOUSANDS_RE = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", re.ASCII)
_INVISIBLE_TABLE = {ord(ch): None for ch in INVISIBLE_CHARS}

# 부정 사전. 한글은 어절 경계가 없어 부분 문자열로 찾고, 영어는 낱말 경계(ASCII)로 찾는다.
# 불가피(피할 수 없다)는 부정이 아니고, "No. 5"·"no.5"의 No는 번호 약어라 부정이 아니다.
_NEGATION_RE = re.compile(
    r"않|없|금지|말\s*것|불가(?!피)|아니"
    r"|\bnot\b|\bno\b(?!\.?\s*\d)|\bnever\b|\bwithout\b|\bprohibited\b|\bcannot\b|n['’]t\b|\bnone\b",
    re.IGNORECASE | re.ASCII,
)


def _build_unit_lookup() -> dict[str, str]:
    """NFKC로 접은 철자 → 표준 표기. 대소문자를 가리지 않는 철자는 소문자 키로 둔다."""
    lookup: dict[str, str] = {}
    for label, spellings in _UNIT_GROUPS.items():
        for spelling in spellings:
            key = unicodedata.normalize("NFKC", spelling)
            lookup[key.lower() if spelling in _CASELESS_SPELLINGS else key] = label
    return lookup


def _build_unit_pattern() -> re.Pattern[str]:
    """숫자 바로 뒤의 단위만 잡는 정규식 — 긴 철자가 먼저, 라틴 철자 뒤에 라틴 글자가 이어지면 다른 낱말이다."""
    entries = {
        unicodedata.normalize("NFKC", spelling): spelling in _CASELESS_SPELLINGS
        for spellings in _UNIT_GROUPS.values()
        for spelling in spellings
    }
    alternatives = []
    for key in sorted(entries, key=lambda k: (-len(k), k)):
        body = re.escape(key)
        if entries[key]:
            body = f"(?i:{body})"
        if key[-1].isascii() and key[-1].isalpha():
            body += "(?![A-Za-z])"
        elif key in _BLOCKED_NEXT:
            body += f"(?!{_BLOCKED_NEXT[key]})"
        alternatives.append(body)
    # 숫자와 단위 사이는 공백 또는 하이픈 하나("15-mL tube", "5-minute")
    return re.compile(r"\d(?:-|\s*)(" + "|".join(alternatives) + ")", re.ASCII)


_UNIT_LOOKUP = _build_unit_lookup()
_UNIT_RE = _build_unit_pattern()


def _fold_text(text: str) -> str:
    """전각 숫자·㎖·℃ 같은 호환 글자와 보이지 않는 글자를 접어 같은 글자로 비교한다."""
    return unicodedata.normalize("NFKC", text).translate(_INVISIBLE_TABLE)


def _normalize_number(token: str) -> str:
    return token.replace(",", "") if _THOUSANDS_RE.fullmatch(token) else token


def _get_number_sort_key(token: str) -> tuple[int, Decimal, str]:
    """숫자 크기순, 숫자로 읽히지 않는 토큰("1,5,7")은 뒤로."""
    try:
        return (0, Decimal(token), token)
    except InvalidOperation:
        return (1, Decimal(0), token)


def _count_numbers(text: str) -> Counter[str]:
    return Counter(_normalize_number(token) for token in _NUMBER_RE.findall(text))


def _find_units(text: str) -> set[str]:
    return {_UNIT_LOOKUP.get(raw) or _UNIT_LOOKUP[raw.lower()] for raw in _UNIT_RE.findall(text)}


def _has_negation(text: str) -> bool:
    return _NEGATION_RE.search(text) is not None


def check_sentence(source_texts: Sequence[str], target_text: str) -> list[dict[str, str]]:
    """출처 문장 전체와 새 문장의 숫자·단위·부정이 다르면 경고를 돌려준다(숫자 → 단위 → 부정 순).

    값 칸에는 숫자·단위 토큰과 yes/no 표시만 싣고 문장 글자는 싣지 않는다.
    출처가 여럿이면 합집합으로 비교한다 — 한/영 짝 출처의 같은 숫자를 두 번 세지 않는다.
    """
    sources = [_fold_text(text) for text in source_texts]
    target = _fold_text(target_text)
    warnings: list[dict[str, str]] = []

    source_numbers: Counter[str] = Counter()
    for text in sources:
        source_numbers |= _count_numbers(text)
    target_numbers = _count_numbers(target)
    if source_numbers != target_numbers:
        warnings.append(
            {
                "kind": KIND_NUMBER,
                "source": ", ".join(sorted(source_numbers.elements(), key=_get_number_sort_key)),
                "target": ", ".join(sorted(target_numbers.elements(), key=_get_number_sort_key)),
            }
        )

    source_units = set().union(*(_find_units(text) for text in sources))
    target_units = _find_units(target)
    if source_units != target_units:
        warnings.append(
            {
                "kind": KIND_UNIT,
                "source": ", ".join(sorted(source_units, key=_UNIT_ORDER.__getitem__)),
                "target": ", ".join(sorted(target_units, key=_UNIT_ORDER.__getitem__)),
            }
        )

    source_negated = any(_has_negation(text) for text in sources)
    if source_negated != _has_negation(target):
        warnings.append(
            {
                "kind": KIND_NEGATION,
                "source": "yes" if source_negated else "no",
                "target": "no" if source_negated else "yes",
            }
        )
    return warnings
