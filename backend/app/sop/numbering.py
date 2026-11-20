"""문단 번호 — 단위의 번호 범위 읽기(추출 신호 → 번호 칸), 번호 칸의 값과 내용 경계, "뒤 번호 따라 고치기" 계산.

DB를 모르는 순수 함수다. 번호는 범위로 표시할 뿐 글자를 지우지 않는다(커버리지 그대로) — 단위 글(text)은 번호를 품은 채이고,
번호를 뺀 글("내용")은 여기서만 만든다. 프런트 `lib/number-model.ts`가 값·내용 경계와 따라 고치기의 사본이다(함께 고친다).
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from app.sop.segment import NUMBER_CELL, NUMBERS_SIGNAL, is_blank_char

NUMBER_AUTO, NUMBER_TYPED = "auto", "typed"  # docx_reader의 번호 출처와 같은 값(테스트가 같음을 지킨다)
# 번호 없는 바꾼 조항(F8b)이 앞 다른 언어 조항에서 물려받은 번호 — 범위가 없다(number_len 0, 글자는 그대로 내용)
NUMBER_PAIR = "pair"
MAX_NUMBER_CHARS = 40  # units.number_read·number_set 열 길이
NUMBERED_KINDS = ("sentence", "heading", "cell_sentence")  # 번호 칸이 있는 단위 — 캡션·그림·표는 없다
FIRST_SIGNAL_VERSION = 5  # extract.types.EXTRACTOR_VERSION — 블록 신호(numbers)가 생긴 추출기
SECTION_KIND = "heading"  # 절을 여는 줄 — 제목 스타일이거나 조항 번호만 있는 줄(segment.build_unit_drafts)
NO_NUMBER = ""  # number_set의 "번호 없음" — 번호 범위를 글로 되돌린다(NULL은 사람이 고치지 않음)
# 번호 마디를 가르는 글자와 끝에 붙는 글자 — "6.1.1." "A-1-2" "3)"
_PART_SEPARATOR_RE = re.compile(r"[.\-]")
_NUMBER_TAIL = ".)"
# 자동 번호 뒤에 같은 번호를 타자로 또 친 범위("6.1 6.1") — 앞쪽이 읽은 값이다
_DOUBLED_RE = re.compile(r"(.+?)\s+(\S+)")


class NumberedUnit(Protocol):
    """번호 열 넷과 단위 종류 — Unit 행과 스냅숏 값이 함께 쓴다."""

    kind: str
    number_read: str | None
    number_source: str | None
    number_len: int
    number_set: str | None
    from_heading: bool  # 제목 줄을 문장으로 바꾼 단위(F8b) — 그 타자 번호는 제목 줄처럼 처음부터 번호다


@dataclass(frozen=True)
class NumberRange:
    """단위 글 앞의 번호 범위 — read는 읽은 번호, length는 단위 글에서 번호가 차지한 앞 글자 수."""

    read: str
    source: str
    length: int


def read_number_range(
    spans: Sequence[Sequence[int]], signals: Mapping[int, Mapping[str, object] | None], texts: Mapping[int, str]
) -> NumberRange | None:
    """단위 범위의 첫 조각에 걸린 번호 신호 → 번호 범위. 번호 뒤에 내용이 남을 때만 번호다(번호뿐인 단위는 글로 둔다).

    - 같은 블록 안: 번호 신호가 첫 조각의 머리에서 시작하고 조각이 그 뒤로 이어진다.
    - 다른 블록의 번호 칸(cell): 첫 조각이 번호만 든 칸 전체이고 뒤에 다른 조각이 있다 — 그 칸 블록 전체가 번호 범위다.
    """
    if not spans:
        return None
    block_id, start, end = spans[0]
    text = texts[block_id]
    for number_start, number_end, source in (signals.get(block_id) or {}).get(NUMBERS_SIGNAL) or ():
        if not number_start <= start < number_end or any(not is_blank_char(ch) for ch in text[number_start:start]):
            continue
        if number_end < end:
            label = text[start:number_end]
        elif source == NUMBER_CELL and len(spans) > 1:
            label = text[start:end]
        else:
            return None
        read = _read_label(label)
        if not read or len(read) > MAX_NUMBER_CHARS:
            return None
        return NumberRange(read=read, source=source, length=len(label))
    return None


def build_number_columns(
    kind: str, spans: Sequence[Sequence[int]], signals: Mapping[int, Mapping[str, object] | None], texts: Mapping[int, str]
) -> dict[str, object]:
    """새 단위의 번호 열(읽은 값·출처·길이) — 처음 쪼개기와 쪼개기 편집이 같은 계산을 쓴다. 문장·제목·칸 문장만 번호를 갖는다."""
    found = read_number_range(spans, signals, texts) if kind in NUMBERED_KINDS else None
    if found is None:
        return {"number_read": None, "number_source": None, "number_len": 0}
    return {"number_read": found.read, "number_source": found.source, "number_len": found.length}


@dataclass(frozen=True)
class ClauseLine:
    """번호 물려받기(F8b)가 보는 단위 하나 — 문서 순서로 넘긴다. number는 번호 칸 값(get_number)이다."""

    pos_seq: int
    lang: str
    kind: str
    from_heading: bool
    number: str | None


def find_inherited_numbers(lines: Sequence[ClauseLine]) -> dict[int, str]:
    """목록 위치 → 물려받을 번호. 번호 없는 바꾼 조항(from_heading)의 첫 단위가, 바로 앞 블록의 첫 단위가 다른 언어(한·영)의
    번호 있는 조항(제목이거나 바꾼 조항)이면 그 번호를 받는다 — "5.2.1 Close … Confirm …" 다음의 한글 번역 첫 문장이 5.2.1이다.
    조항의 둘째 문장부터는 받지 않는다(그 영어 짝도 번호가 없다)."""
    inherited: dict[int, str] = {}
    first_of_block: dict[int, int] = {}
    for index, line in enumerate(lines):
        if line.pos_seq in first_of_block:
            continue
        first_of_block[line.pos_seq] = index
        source_index = first_of_block.get(line.pos_seq - 1)
        if source_index is None or not line.from_heading or line.number:
            continue
        source = lines[source_index]
        is_clause = source.kind == SECTION_KIND or source.from_heading
        if is_clause and source.number and {source.lang, line.lang} == {"ko", "en"}:
            inherited[index] = source.number
    return inherited


def read_draft_number(kind: str, from_heading: bool, columns: Mapping[str, object]) -> str | None:
    """막 만든 단위(사람이 고치기 전)의 번호 칸 값 — get_number와 같은 규칙을 번호 열 값으로."""
    read = columns.get("number_read")
    if not isinstance(read, str):
        return None
    is_typed_text = columns.get("number_source") == NUMBER_TYPED and kind != SECTION_KIND and not from_heading
    return None if is_typed_text else read


def _read_label(label: str) -> str:
    stripped = label.strip()
    doubled = _DOUBLED_RE.fullmatch(stripped)
    if doubled is not None and doubled.group(1).rstrip(".") == doubled.group(2).rstrip("."):
        return doubled.group(1)
    return stripped


def get_number(unit: NumberedUnit) -> str | None:
    """번호 칸의 값 — 사람이 고친 값이 먼저이고, 없으면 읽은 값(본문 줄의 타자 번호는 사람이 번호로 삼기 전에는 글이다)."""
    if unit.number_set is not None:
        return unit.number_set or None
    return None if _is_typed_text(unit) else unit.number_read


def _is_typed_text(unit: NumberedUnit) -> bool:
    """타자로 친 번호가 아직 글인가 — 절을 여는 줄(제목)의 타자 번호는 처음부터 번호 칸으로 가고(전에도 화면이 가리던 번호다),
    본문 줄의 타자 번호는 사람이 "번호로"를 누르기 전에는 글이다(사용자 결정 2026-11-18). 제목에서 바꾼 조항 문장(F8b)은 제목 줄과 같다."""
    return (
        unit.number_source == NUMBER_TYPED and unit.number_set is None and unit.kind != SECTION_KIND
        and not unit.from_heading
    )


def get_hidden_len(unit: NumberedUnit) -> int:
    """단위 글 앞에서 번호 칸으로 간 글자 수 — "번호 없음"이거나 아직 글인 타자 번호면 0."""
    if unit.number_set == NO_NUMBER or not unit.number_len:
        return 0
    if _is_typed_text(unit):
        return 0
    return unit.number_len


def get_content_start(text: str, hidden_len: int) -> int:
    """내용이 시작하는 자리 — 번호 범위와 뒤따르는 빈 글자 뒤. 내용이 남지 않으면 0(글 전체가 내용)."""
    start = hidden_len
    while start < len(text) and is_blank_char(text[start]):
        start += 1
    return start if hidden_len and start < len(text) else 0


def strip_number(text: str, unit: NumberedUnit) -> str:
    """번호 범위를 뺀 글("내용") — New 초안·결과물 A 원문 칸이 쓴다. AI 입력 글은 번호를 품은 text 그대로다."""
    return text[get_content_start(text, get_hidden_len(unit)):]


def normalize_number(number: str) -> str:
    """견줄 때의 번호 — 앞뒤 빈 글자와 끝 점을 뗀다("6.1." = "6.1"). 절 이름(section_label)도 이 꼴이다."""
    return number.strip().rstrip(".")


def get_number_note(unit: NumberedUnit) -> str | None:
    """번호 노트 — 사람이 읽은 값과 다르게 고친 번호면 원문(읽은) 번호. 번호 없음 · 점 기호로 바꾼 것도 다르게 고친 것이다.

    번호 칸 툴팁 · 노트 줄과 결과물(A 위치 칸 · 문단 Excel 번호 노트 열)이 이 함수 하나를 본다.
    """
    if unit.number_set is None or not unit.number_read:
        return None
    if normalize_number(unit.number_set) == normalize_number(unit.number_read):
        return None
    return unit.number_read


def is_number_fixed(unit: NumberedUnit) -> bool:
    """사람이 읽은 값과 다르게 고친 번호인가 — 결과물 A 위치 칸이 읽은 값을 함께 적는다."""
    return get_number_note(unit) is not None


def has_number_ranges(extractor_version: str) -> bool:
    """추출이 번호 범위 신호를 남겼는가 — 추출기 5부터다. 그 전 추출의 단위는 번호 범위가 없어 번호가 글에 남은 채 보인다."""
    return extractor_version.isdigit() and int(extractor_version) >= FIRST_SIGNAL_VERSION


def _split_parts(number: str) -> list[str] | None:
    """번호의 마디들("6.1.1." → 6·1·1, "A-1" → A·1) — 마디가 비면("..", 빈 글) None."""
    body = number.strip().rstrip(_NUMBER_TAIL)
    parts = _PART_SEPARATOR_RE.split(body)
    return parts if body and all(parts) else None


def _replace_part(number: str, index: int, value: str) -> str:
    """번호의 index번째 마디만 바꾼다 — 사이 글자("." "-")와 끝 글자는 그 줄이 쓰던 그대로다."""
    stripped = number.strip()
    body = stripped.rstrip(_NUMBER_TAIL)
    tokens = re.split(r"([.\-])", body)
    tokens[index * 2] = value
    return "".join(tokens) + stripped[len(body):]


def _read_count(part: str) -> int | None:
    """셀 수 있는 마디의 순번 — 숫자는 그 값, 대문자 한 글자는 A=1 …. 그 밖(로마 숫자·가나다)은 따라 고치지 않는다."""
    if part.isascii() and part.isdigit():
        return int(part)
    if len(part) == 1 and "A" <= part <= "Z":
        return ord(part) - ord("A") + 1
    return None


def _format_count(count: int, like: str) -> str | None:
    if like.isdigit():
        return str(count)
    return chr(ord("A") + count - 1) if 1 <= count <= 26 else None


@dataclass
class _List:
    """다시 셀 목록 하나 — 부모 마디들 아래 같은 수준의 줄들. count는 마지막으로 매긴 순번."""

    parent: list[str]
    count: int
    last_old: int | None = None  # 마지막으로 본 형제의 옛 순번 — 줄어들면 다른 목록이 시작된 것이라 닫는다
    renamed: tuple[str, str] | None = None  # 마지막 형제의 (옛 마디, 새 마디) — 그 아래 줄의 앞머리를 따라 고친다
    is_open: bool = True

    @property
    def depth(self) -> int:
        return len(self.parent) + 1


def plan_follow(numbers: Sequence[str | None], index: int, new: str) -> dict[int, str]:
    """index번째 줄의 번호를 new로 고칠 때 뒤따라 고칠 줄 → 새 번호(§11-11). numbers는 같은 목록 후보의 지금 번호(문서 순서).

    - 같은 목록 = 같은 수준 · 같은 부모 아래, 고친 줄 뒤의 줄. 고친 값 다음부터 차례로 센다.
    - 고친 줄이 수준이나 부모를 바꾸면(6.2 → 6.1.1) 옛 목록은 빠진 자리부터 당겨 세고(6.3 → 6.2), 새 부모 아래 뒤 줄도 차례로 센다.
    - 다시 센 줄 아래의 줄(6.3.1)은 앞머리만 따라간다(6.2.1).
    - 목록 밖 번호(다른 부모·윗수준)가 나오거나 순번이 줄어들면 그 목록은 거기서 끝난다.
    고친 줄 자신과 번호가 그대로인 줄은 결과에 없다. 셀 수 없는 번호 꼴이면 빈 결과다.
    """
    new_parts = _split_parts(new)
    if new_parts is None or _read_count(new_parts[-1]) is None:
        return {}
    old_parts = _split_parts(numbers[index] or "")
    old_count = _read_count(old_parts[-1]) if old_parts is not None else None
    is_same_list = old_parts is not None and old_parts[:-1] == new_parts[:-1]
    lists = [
        _List(
            parent=new_parts[:-1], count=_read_count(new_parts[-1]) or 0, last_old=old_count if is_same_list else None,
            # 같은 목록 안에서 고친 줄은 그 아래 줄(6.2.1)도 데려간다
            renamed=(old_parts[-1], new_parts[-1]) if old_parts is not None and is_same_list else None,
        )
    ]
    if old_parts is not None and old_count is not None and not is_same_list:
        # 옛 목록은 고친 줄이 빠진 자리부터 다시 센다
        lists.append(_List(parent=old_parts[:-1], count=old_count - 1, last_old=old_count))
    changes: dict[int, str] = {}
    for position in range(index + 1, len(numbers)):
        number = numbers[position]
        parts = _split_parts(number) if number else None
        if number is None or parts is None:
            continue
        for group in lists:
            if not group.is_open:
                continue
            if parts[: group.depth - 1] != group.parent or len(parts) < group.depth:
                group.is_open = False  # 이 부모 아래가 아닌 번호 — 목록이 끝났다
                continue
            if len(parts) > group.depth:
                if group.renamed is not None and parts[group.depth - 1] == group.renamed[0]:
                    number = _replace_part(number, group.depth - 1, group.renamed[1])
                continue
            seen = _read_count(parts[-1])
            if seen is None or (group.last_old is not None and seen < group.last_old):
                group.is_open = False
                continue
            value = _format_count(group.count + 1, parts[-1])
            if value is None:
                group.is_open = False
                continue
            group.count, group.last_old, group.renamed = group.count + 1, seen, (parts[-1], value)
            number = _replace_part(number, group.depth - 1, value)
        if number != numbers[position]:
            changes[position] = number
        if not any(group.is_open for group in lists):
            break
    return changes
