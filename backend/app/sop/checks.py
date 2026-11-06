"""문장 검사 — 출처 문장과 새 문장의 숫자·단위·부정 차이를 코드로 찾는다(DB를 모르는 순수 함수)."""

import re
import unicodedata
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from app.sop.segment import INVISIBLE_CHARS

KIND_NUMBER = "number_mismatch"
KIND_UNIT = "unit_mismatch"
KIND_NEGATION = "negation_mismatch"
MAX_WARNING_VALUE_LEN = 300  # 경고 값 칸 최대 글자 수 — 긴 입력이 저장 JSON을 부풀리지 않게 자르고 …로 끝낸다

# 같은 뜻 단위 묶음 — 키는 경고에 보이는 표준 표기, 값은 같은 뜻 철자. 키 순서가 경고 목록의 정렬 순서다.
# 철자는 NFKC로 접힌 글자와 맞춘다(℃→°C, µ→μ, ㎖→ml, 서수 기호 º→o). 영어 낱말(minutes·hours·seconds)은 같은 묶음으로 센다.
# 마이크로 기호(U+00B5)와 그리스 뮤(U+03BC)는 눈으로 구별이 안 돼 이스케이프로 적는다.
_UNIT_GROUPS: dict[str, tuple[str, ...]] = {
    "℃": ("℃", "°C", "ºC", "degrees c", "degree c", "degrees celsius", "degree celsius"),
    "mL": ("mL", "ml", "milliliter", "milliliters", "millilitre", "millilitres"),
    "µL": (
        "µL", "uL", "μL", "ul", "μl", "microliter", "microliters", "microlitre", "microlitres",
    ),
    "L": ("L", "liter", "liters", "litre", "litres"),
    "rpm": ("rpm",),
    "×g": ("×g", "× g", "xg", "x g"),
    "g": ("g", "gram", "grams"),
    "mg": ("mg", "milligram", "milligrams"),
    "µg": ("µg", "ug", "μg", "microgram", "micrograms"),
    "ng": ("ng", "nanogram", "nanograms"),
    "kg": ("kg", "kilogram", "kilograms"),
    "min": ("min", "mins", "minute", "minutes", "분"),
    "h": ("h", "hr", "hrs", "hour", "hours", "시간"),
    "sec": ("sec", "secs", "second", "seconds", "s", "초"),
    "day": ("day", "days", "일"),
    "week": ("week", "weeks", "주"),
    "%": ("%", "percent"),
    "bar": ("bar", "bars"),
    "psi": ("psi", "psig"),
    "kPa": ("kPa", "kilopascal", "kilopascals"),
    "MPa": ("MPa", "megapascal", "megapascals"),
    "mM": ("mM",),
    "µM": ("µM", "uM", "μM"),
    "nM": ("nM",),
}
_UNIT_ORDER = {label: index for index, label in enumerate(_UNIT_GROUPS)}
# 한글 단위(분·시간·초·일·주) 뒤에는 끝, 한글 아닌 글자, 아래 이음말만 온다 — 그 밖의 한글이 이어지면 다른 낱말이다
# ("5.2 일반 사항"의 일, "6.1 분석"의 분, "10 mL 초과"의 초). 의는 넣지 않는다 — "7.1 주의 사항"의 주를 단위로 읽지 않게.
# 과는 앞이 초가 아닐 때만 — "5분과 10분"은 단위지만 "10초과"는 넘는다는 낱말이다.
_HANGUL_CHARS = "\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3"  # 자모·호환 자모·완성형 음절
_HANGUL_RE = re.compile(f"[{_HANGUL_CHARS}]")
_HANGUL_UNIT_CONTINUATIONS = (
    "간", "동안", "이내", "이상", "이하", "미만", "후", "전", "마다", "씩", "에", "에서",
    "을", "를", "이", "가", "은", "는", "로", "으로", "까지", "부터", "정도", "째",
    "내", "당", "경", "와", "(?<!초)과", "보다", "만", "쯤", "도",
)
_HANGUL_UNIT_END = f"(?=$|[^{_HANGUL_CHARS}]|{'|'.join(_HANGUL_UNIT_CONTINUATIONS)})"

# 부호·앞점 소수가 붙는 자리 — 앞이 이 글자(또는 문장 처음)일 때만 "-20"의 -가 부호다. 숫자 사이 하이픈("2-8")은 범위,
# 글자 뒤 하이픈("Step-2")은 이름이다. ^는 거듭제곱 지수("10^-6")를 위해 둔다.
_SIGN_CONTEXT = r"\s(\[{~∼〜≈≤≥<>=:;,/^"
# 세 자리 묶음 쉼표만 지운다 — "1,5"처럼 묶음이 아닌 쉼표는 그대로 둔다
_THOUSANDS_RE = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", re.ASCII)
_INVISIBLE_TABLE = {ord(ch): None for ch in INVISIBLE_CHARS}
# 하이픈·en dash·마이너스 기호를 하나로 — 부호와 범위 판정이 같은 글자를 보게
_DASH_TABLE = {ord(ch): "-" for ch in "‐‑‒–−"}
_SUPERSCRIPT_RUN_RE = re.compile("[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+")
_SUPERSCRIPT_TABLE = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺", "0123456789-+")
# 문장 맨 앞의 조항 번호("5.1 ", "5. ") — 점이 없는 "5 시료"는 수량일 수 있어 건드리지 않는다
_CLAUSE_NUMBER_RE = re.compile(r"\s*\d+(?:(?:\.\d+)+\.?|\.)\s+", re.ASCII)
# 범위 "2-8 ℃"·"4 to 8 °C", 택일 "5 or 10 mL", 허용 오차 "37 ± 2 °C"의 앞 숫자는 뒤 숫자의 단위를 함께 쓴다
_RANGE_GAP_RE = re.compile(r"\s*(?:[-~∼〜±]|(?i:to|and|or)|내지|또는|혹은|및)\s*", re.ASCII)

# 부정 사전. 한글은 어절 경계가 없어 부분 문자열로 찾고, 영어는 낱말 경계(ASCII)로 찾는다.
# 불가피(피할 수 없다)·말라리아·마라톤은 부정이 아니고, "No. 5"·"no.5"의 No는 번호 약어라 부정이 아니다(점 없는 "no 5"는 부정).
_NEGATION_RE = re.compile(
    r"않|없|금지|금함|금한다|말\s*것|불가(?!피)|아니"
    r"|마십시오|마시오|마세요|마라(?!톤)|말라(?!리)|말아|말고"
    r"|안\s*(?:된|됨|돼|됩|되)|못\s*(?:한|하|함)"
    r"|\bnot\b|\bno\b(?!\.\s*\d)|\bnever\b|\bwithout\b|\bprohibited\b|\bcannot\b|n['’]t\b|\bnone\b",
    re.IGNORECASE | re.ASCII,
)


def _is_caseless(spelling: str) -> bool:
    """RPM·PSI·Min처럼 대문자로도 쓰는 영어 낱말 철자. L·g·h·mL·kPa·MPa는 대소문자가 뜻을 가른다(G 게이지, mPa)."""
    core = spelling.replace(" ", "")
    return core.isascii() and core.isalpha() and core.islower() and (len(core) >= 3 or core == "hr")


def _build_unit_lookup() -> dict[str, str]:
    """NFKC로 접은 철자 → 표준 표기. 대소문자를 가리지 않는 철자는 소문자 키로 둔다."""
    lookup: dict[str, str] = {}
    for label, spellings in _UNIT_GROUPS.items():
        for spelling in spellings:
            key = unicodedata.normalize("NFKC", spelling)
            lookup[key.lower() if _is_caseless(spelling) else key] = label
    return lookup


def _build_unit_alternation() -> str:
    """단위 철자 정규식 — 긴 철자가 먼저, 라틴 철자 뒤에 라틴 글자가 이어지면 다른 낱말이고 한글 철자는 뒤 글자를 가린다.

    단위 찾기와 조항 번호 판정(_strip_clause_number)이 이 정규식 하나를 쓴다.
    """
    entries = {
        unicodedata.normalize("NFKC", spelling): _is_caseless(spelling)
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
        elif _HANGUL_RE.match(key[-1]):
            body += _HANGUL_UNIT_END
        alternatives.append(body)
    return "|".join(alternatives)


_UNIT_LOOKUP = _build_unit_lookup()
_UNIT_ALTERNATION = _build_unit_alternation()
_UNIT_START_RE = re.compile(_UNIT_ALTERNATION, re.ASCII)
# 숫자 한 토큰과, 그 바로 뒤(공백 또는 하이픈 하나: "15-mL tube", "5-minute")의 단위. 부호는 앞이 _SIGN_CONTEXT일 때만.
_VALUE_RE = re.compile(
    "(?P<num>(?:(?<![^" + _SIGN_CONTEXT + "])-)?"
    r"(?:\d+(?:[.,]\d+)*|(?<![^" + _SIGN_CONTEXT + r"\-])\.\d+))"
    "(?:(?:-|\\s*)(?P<unit>" + _UNIT_ALTERNATION + "))?",
    re.ASCII,
)


@dataclass
class _Profile:
    """한 문장(또는 합친 출처)에서 읽은 숫자·단위·부정."""

    numbers: Counter[str] = field(default_factory=Counter)
    units: set[str] = field(default_factory=set)
    pairs: Counter[tuple[str, str]] = field(default_factory=Counter)  # (숫자, 그 숫자에 붙은 단위 묶음)
    negated: bool = False


def _fold_text(text: str) -> str:
    """호환 글자(전각 숫자·㎖·℃)와 보이지 않는 글자, 대시 종류를 접는다. 위 첨자 지수는 NFKC가 숫자로 뭉개기 전에 ^로 바꾼다."""
    marked = _SUPERSCRIPT_RUN_RE.sub(lambda m: "^" + m.group().translate(_SUPERSCRIPT_TABLE), text)
    return unicodedata.normalize("NFKC", marked).translate(_INVISIBLE_TABLE).translate(_DASH_TABLE)


def _strip_clause_number(text: str) -> str:
    """문장 앞 조항 번호는 수치가 아니다. "0.5 mL"처럼 번호 뒤에 단위가 바로 오면 수량이라 남긴다."""
    match = _CLAUSE_NUMBER_RE.match(text)
    if match is None or _UNIT_START_RE.match(text, match.end()):
        return text
    return text[match.end():]


def _normalize_number(token: str) -> str:
    sign, body = ("-", token[1:]) if token.startswith("-") else ("", token)
    if body.startswith("."):
        body = "0" + body
    elif _THOUSANDS_RE.fullmatch(body):
        body = body.replace(",", "")
    return sign + body


def _get_unit_label(raw: str) -> str:
    return _UNIT_LOOKUP.get(raw) or _UNIT_LOOKUP[raw.lower()]


def _scan_values(text: str) -> list[tuple[str, str | None]]:
    """글 순서대로 (숫자, 바로 붙은 단위 묶음 또는 None)."""
    matches = list(_VALUE_RE.finditer(text))
    numbers = [_normalize_number(match.group("num")) for match in matches]
    labels = [_get_unit_label(match.group("unit")) if match.group("unit") else None for match in matches]
    # 뒤에서부터 — "2 - 5 - 8 ℃"처럼 이어진 범위도 단위가 앞으로 퍼진다
    for index in range(len(matches) - 2, -1, -1):
        if labels[index] is None and labels[index + 1] is not None:
            if _RANGE_GAP_RE.fullmatch(text, matches[index].end(), matches[index + 1].start()):
                labels[index] = labels[index + 1]
    return list(zip(numbers, labels, strict=True))


def _build_profile(text: str) -> _Profile:
    prepared = _strip_clause_number(_fold_text(text))
    values = _scan_values(prepared)
    return _Profile(
        numbers=Counter(number for number, _ in values),
        units={label for _, label in values if label is not None},
        pairs=Counter((number, label) for number, label in values if label is not None),
        negated=_NEGATION_RE.search(prepared) is not None,
    )


def _merge_profiles(profiles: Sequence[_Profile]) -> _Profile:
    """출처 합집합 — 같은 숫자는 문장마다 따로 세지 않고 가장 많이 쓴 횟수 하나로(한/영 짝 출처의 중복 방지)."""
    merged = _Profile()
    for profile in profiles:
        merged.numbers |= profile.numbers
        merged.units |= profile.units
        merged.pairs |= profile.pairs
        merged.negated = merged.negated or profile.negated
    return merged


def _get_number_sort_key(token: str) -> tuple[int, Decimal, str]:
    """숫자 크기순, 숫자로 읽히지 않는 토큰("1,5,7")은 뒤로."""
    try:
        return (0, Decimal(token), token)
    except InvalidOperation:
        return (1, Decimal(0), token)


def _clip_value(value: str) -> str:
    if len(value) <= MAX_WARNING_VALUE_LEN:
        return value
    return value[: MAX_WARNING_VALUE_LEN - 1] + "…"


def _format_numbers(numbers: Counter[str]) -> str:
    return _clip_value(", ".join(sorted(numbers.elements(), key=_get_number_sort_key)))


def _format_units(units: set[str]) -> str:
    return _clip_value(", ".join(sorted(units, key=_UNIT_ORDER.__getitem__)))


def _format_pairs(pairs: Counter[tuple[str, str]]) -> str:
    ordered = sorted(pairs.elements(), key=lambda pair: (_get_number_sort_key(pair[0]), _UNIT_ORDER[pair[1]]))
    return _clip_value(", ".join(f"{number} {label}" for number, label in ordered))


def check_sentence(source_texts: Sequence[str], target_text: str) -> list[dict[str, str]]:
    """출처 문장 전체와 새 문장의 숫자·단위·부정이 다르면 경고를 돌려준다(숫자 → 단위 → 부정 순).

    값 칸에는 숫자·단위 토큰과 yes/no 표시만 싣고(300자에서 자른다) 문장 글자는 싣지 않는다.
    숫자와 단위 묶음이 같은데 짝만 바뀐 경우("5 mL, 10 min" ↔ "10 mL, 5 min")는 unit_mismatch 하나로 알리고
    값 칸에 "숫자 단위" 짝을 싣는다 — 종류 이름을 늘리지 않으려는 선택이다.
    """
    source = _merge_profiles([_build_profile(text) for text in source_texts])
    target = _build_profile(target_text)
    warnings: list[dict[str, str]] = []

    if source.numbers != target.numbers:
        warnings.append(
            {"kind": KIND_NUMBER, "source": _format_numbers(source.numbers), "target": _format_numbers(target.numbers)}
        )
    if source.units != target.units:
        warnings.append(
            {"kind": KIND_UNIT, "source": _format_units(source.units), "target": _format_units(target.units)}
        )
    elif source.numbers == target.numbers and source.pairs != target.pairs:
        warnings.append(
            {"kind": KIND_UNIT, "source": _format_pairs(source.pairs), "target": _format_pairs(target.pairs)}
        )
    if source.negated != target.negated:
        warnings.append(
            {
                "kind": KIND_NEGATION,
                "source": "yes" if source.negated else "no",
                "target": "yes" if target.negated else "no",
            }
        )
    return warnings
