"""한글 표 따라 하기(11-23 명세 D2) — 영어 표의 짝 한글 표를 꼴 + 언어 무관 토큰 + 뜻(임베딩)으로 고르고(D2-R1 · R2), 짝 표 안은 행마다
내용으로 짝을 맞춰 한글 표에서 한 일(순서 · 삭제 · 합치기 · 들여쓰기 · 번호)을 영어 표에 계획한다(D2-R4 · R5).

점수 · 후보 · 행 짝 · 계획은 DB를 읽지 않는 순수 함수다. 애매하면 사람이 고르고 그 답은 table_counterparts에 남는다(D2-R3).
계획(규칙 제안)은 저장하지 않는다 — 읽을 때마다 센다(D2-R7). Old 문서만 쓴다.
AI를 부르지 않는다 — 임베딩은 켜져 있을 때만 쓰고, 꺼졌거나 실패하면 꼴과 토큰만 본다.
"""

import re
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Literal

import numpy as np
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.sop.ai.embeddings import EmbeddingUnavailable, embed_texts
from app.sop.constants import ROW_MATCH_THRESHOLD, TABLE_FOLLOW_MARGIN, TABLE_FOLLOW_THRESHOLD
from app.sop.counterparts import TableFacts, is_candidate_kind, is_same_form, list_candidates
from app.sop.errors import raise_rule
from app.sop.models import Document, SourceBlock, TableCounterpart
from app.sop.segment import DOCUMENT_NUMBER_BODY
from app.sop.units import get_latest_extraction_id, load_table_facts

CounterpartStatus = Literal["matched", "ambiguous", "none"]

# 토큰이 하나도 겹치지 않은 두 표는 뜻(행 코사인 평균)이 이 값 이상일 때만 임계값을 넘을 수 있다 — 꼴만으로 잇지 않는다(D2-R1, AC1)
TOKENLESS_MEANING_FLOOR = 0.5
# 점수 가중치(합 1) — 임베딩이 있을 때 · 없을 때. 합성 자료 기준, 실제 문서로 재설정
_WEIGHTS_WITH_MEANING = (0.2, 0.3, 0.5)  # 꼴 · 토큰 · 뜻 — 토큰이 없어도 뜻 0.8 이상이면 임계값에 닿는다
_WEIGHTS_WITHOUT_MEANING = (0.3, 0.7)  # 꼴 · 토큰

# 언어 무관 토큰(D2-R1) — 앞의 것부터 찾아 지운 뒤 다음을 찾는다(문서 번호 속 약어 · 날짜 속 숫자를 두 번 세지 않게)
_DOCUMENT_NUMBER = re.compile(rf"(?<![A-Za-z0-9-]){DOCUMENT_NUMBER_BODY}(?![A-Za-z0-9])")
_DATE = re.compile(r"(?<![\d.])(\d{4})\s?[.\-/]\s?(\d{1,2})\s?[.\-/]\s?(\d{1,2})(?![\d])")
_PH = re.compile(r"(?<![A-Za-z])pH\s?(\d+(?:\.\d+)?)(?![\d])")
# 단위는 긴 것부터 — 뒤에 영문자 · 숫자가 오면 낱말의 머리라 단위가 아니다("1 Leave"). 한글 토씨는 붙어도 된다("10 mL를")
_UNITS = (
    r"°\s?C|℃|°\s?F|mmHg|MPa|kPa|Pa|bar|psi|rpm|ppm|%|"
    r"[µμu]L|mL|L|[µμu]g|mg|kg|ng|g|[µμu]M|mM|M|mol|"
    r"min|sec|hrs?|h|s|[µμu]m|nm|mm|cm|m|kW|W|V|Hz|lux"
)
_QUANTITY = re.compile(rf"(?<![\d.])(\d+(?:\.\d+)?)\s?({_UNITS})(?![A-Za-z0-9])", re.IGNORECASE)
_ABBREVIATION = re.compile(r"(?<![A-Za-z])[A-Z]{2,}(?![A-Za-z])")


INTERLEAVED_LAYOUT = "ko_en_interleaved"


@dataclass(frozen=True)
class FollowTable:
    """짝 표 점수가 보는 표 하나 — 행 수 · 열 수와 행마다 글(글자가 있는 칸 글을 이은 것, 원문 차례)."""

    n_rows: int
    n_cols: int
    rows: tuple[str, ...]


@dataclass(frozen=True)
class Counterpart:
    """영어 표 하나의 짝 답 — matched면 source_table_id가 그 한글 표, ambiguous · none이면 None."""

    status: CounterpartStatus
    source_table_id: int | None


def _normalize_unit(unit: str) -> str:
    unit = re.sub(r"\s+", "", unit).lower().replace("μ", "µ")
    return "°c" if unit == "℃" else unit


def read_tokens(texts: Iterable[str]) -> Counter[str]:
    """글들 → 언어 무관 토큰 수: 숫자+단위("10 ml", "4 °c"), "ph 7.0", 문서 번호, 영문 약어(대문자 2자 이상), 날짜(yyyy-mm-dd).

    소문자 · 사이 빈칸 하나로 맞춘다. 단위 없는 숫자(번호 칸 값)는 토큰이 아니다.
    """
    tokens: Counter[str] = Counter()
    for text in texts:
        rest = text
        for found in _DOCUMENT_NUMBER.finditer(rest):
            tokens[found.group(0).lower()] += 1
        rest = _DOCUMENT_NUMBER.sub(" ", rest)
        for year, month, day in _DATE.findall(rest):
            tokens[f"{year}-{int(month):02d}-{int(day):02d}"] += 1
        rest = _DATE.sub(" ", rest)
        for value in _PH.findall(rest):
            tokens[f"ph {value}"] += 1
        rest = _PH.sub(" ", rest)
        for value, unit in _QUANTITY.findall(rest):
            tokens[f"{value} {_normalize_unit(unit)}"] += 1
        rest = _QUANTITY.sub(" ", rest)
        for found in _ABBREVIATION.finditer(rest):
            tokens[found.group(0).lower()] += 1
    return tokens


def _has_letter(text: str) -> bool:
    return any(char.isalpha() for char in text)


def _read_meaning(source: Sequence[str], table: Sequence[str], vectors: Mapping[str, np.ndarray] | None) -> float | None:
    """짧은 쪽 행마다 가장 가까운 상대 행의 코사인 평균 — 임베딩이 없거나 한 행이라도 벡터가 없으면 None(쓰지 않는다)."""
    if vectors is None:
        return None
    left = [text for text in source if _has_letter(text)]
    right = [text for text in table if _has_letter(text)]
    if not left or not right or any(text not in vectors for text in (*left, *right)):
        return None
    short, long = (left, right) if len(left) <= len(right) else (right, left)
    total = sum(max(_cosine(vectors[text], vectors[other]) for other in long) for text in short)
    return max(total / len(short), 0.0)


def _cosine(left: np.ndarray, right: np.ndarray) -> float:
    return float(np.dot(left, right) / (np.linalg.norm(left) * np.linalg.norm(right)))


def score_tables(source: FollowTable, table: FollowTable, vectors: Mapping[str, np.ndarray] | None) -> float:
    """한글 표 source와 영어 표 table의 짝 점수(0~1) — 열 수가 다르면 0. 토큰이 겹치지 않으면 뜻이 가깝지 않은 한 임계값 아래."""
    if source.n_cols != table.n_cols:
        return 0.0
    shape = 1.0 if source.n_rows == table.n_rows else 0.5
    korean, english = read_tokens(source.rows), read_tokens(table.rows)
    smaller = min(sum(korean.values()), sum(english.values()))
    token = sum((korean & english).values()) / smaller if smaller else 0.0
    meaning = _read_meaning(source.rows, table.rows, vectors)
    if meaning is None:
        shape_weight, token_weight = _WEIGHTS_WITHOUT_MEANING
        score = shape_weight * shape + token_weight * token
    else:
        shape_weight, token_weight, meaning_weight = _WEIGHTS_WITH_MEANING
        score = shape_weight * shape + token_weight * token + meaning_weight * meaning
    if token == 0 and (meaning is None or meaning < TOKENLESS_MEANING_FLOOR):
        score = min(score, TABLE_FOLLOW_THRESHOLD - 0.01)
    return score


def pick_counterpart(scores: Mapping[int, float], chosen: int | None, *, has_choice: bool) -> Counterpart:
    """영어 표 하나의 한글 후보 점수 → 답. 사람이 정했으면 그대로(chosen None = 짝 없음). 아니면 가장 높은 후보가 임계값 아래면
    none, 둘째 후보와 TABLE_FOLLOW_MARGIN보다 가까우면 ambiguous(사람이 고른다), 그 밖에는 matched."""
    if has_choice:
        return Counterpart("matched" if chosen is not None else "none", chosen)
    ranked = sorted(scores.items(), key=lambda item: -item[1])
    if not ranked or ranked[0][1] < TABLE_FOLLOW_THRESHOLD:
        return Counterpart("none", None)
    if len(ranked) > 1 and ranked[0][1] - ranked[1][1] < TABLE_FOLLOW_MARGIN:
        return Counterpart("ambiguous", None)
    return Counterpart("matched", ranked[0][0])


def list_counterpart_candidates(table: TableFacts, tables: Sequence[TableFacts], *, interleaved: bool) -> list[TableFacts]:
    """영어 표의 한글 후보(문서 차례) — 번갈아 문서는 그 표 위의 같은 꼴 한글 표 가운데 가장 가까운 하나,
    한/영 따로 문서는 다른 언어 절반의 같은 겹 표 전부(벗김 상태는 보지 않는다, D2-R2)."""
    candidates = sorted(list_candidates(table, tables), key=lambda other: other.index)
    if not interleaved:
        return candidates
    above = [other for other in candidates if other.index < table.index and is_same_form(table, other)]
    return above[-1:]


# 빈 칸 표시 — 벗긴 표의 빈 칸 줄끼리는 글이 달라도 같은 줄이다(행 짝 점수 1)
_BLANK_MARKS = frozenset({"", "(빈 칸)", "(blank)"})


@dataclass(frozen=True)
class FollowLine:
    """벗긴 표 덩이의 줄 하나(덩이 차례로 받는다) — text는 번호 칸을 뺀 내용, pieces는 합친 줄이면 합치기 전 조각들의 내용(원문 순).

    deleted는 확정 삭제된 줄, indent_shift는 들여쓰기 차이(units.indent_shift).
    """

    unit_id: int
    number: str | None
    text: str
    pieces: tuple[str, ...] = ()
    indent_shift: int = 0
    deleted: bool = False


@dataclass(frozen=True)
class FollowItem:
    """영어 표에 제안할 일 하나 — unit_ids가 둘 이상이면 합친다(원문 순이 아니라 덩이 차례).

    order는 맞춘 뒤 이 줄(합친 줄)의 자리(1부터, 바뀌지 않으면 None), number는 고칠 번호(같으면 None), indent는 들여쓰기가 달라
    보이는지(칩), indent_shift는 고칠 들여쓰기 차이(같으면 None), delete는 지울 줄. delete인 일은 다른 것을 함께 하지 않는다.
    """

    unit_ids: tuple[int, ...]
    order: int | None = None
    number: str | None = None
    indent: bool = False
    indent_shift: int | None = None
    delete: bool = False

    def has_change(self) -> bool:
        return len(self.unit_ids) > 1 or self.order is not None or self.number is not None or self.indent or self.delete


def _is_blank(text: str) -> bool:
    return text.strip() in _BLANK_MARKS


def _score_row(korean: str, english: str, vectors: Mapping[str, np.ndarray] | None) -> float:
    """한글 줄(조각) 하나와 영어 줄 하나의 행 짝 점수 — 빈 칸끼리 1, 토큰이 겹치면 0.6 + 0.4·겹친 비율, 아니면 뜻(코사인, 임베딩이 있을 때)."""
    if _is_blank(korean) or _is_blank(english):
        return 1.0 if _is_blank(korean) and _is_blank(english) else 0.0
    left, right = read_tokens([korean]), read_tokens([english])
    shared = sum((left & right).values())
    if shared:
        return 0.6 + 0.4 * shared / min(sum(left.values()), sum(right.values()))
    if vectors is not None and korean in vectors and english in vectors:
        return _cosine(vectors[korean], vectors[english])
    return 0.0


def _list_slots(source: Sequence[FollowLine]) -> list[tuple[int, str]]:
    """한글 줄의 짝 자리 — 합친 줄은 조각마다 하나(조각마다 영어 줄 하나를 받아 그 줄들을 합치라고 제안한다)."""
    return [(index, text) for index, line in enumerate(source) for text in (line.pieces or (line.text,))]


def match_rows(
    source: Sequence[FollowLine], lines: Sequence[FollowLine], vectors: Mapping[str, np.ndarray] | None
) -> list[tuple[int, int]]:
    """한글 줄(조각)과 영어 줄의 짝 (한글 줄 자리, 영어 줄 자리) — 한글 줄 차례로. 자리는 보지 않고 내용만 본다(D2-R4, AC2):
    점수 큰 쌍부터, 둘 다 아직 짝이 없고 ROW_MATCH_THRESHOLD 이상이면 맺는다. 합친 한글 줄은 조각마다 영어 줄 하나까지."""
    slots = _list_slots(source)
    scored = sorted(
        (
            (-_score_row(text, line.text, vectors), slot, english)
            for slot, (_, text) in enumerate(slots)
            for english, line in enumerate(lines)
        ),
    )
    used_slots: set[int] = set()
    used_lines: set[int] = set()
    matches: list[tuple[int, int]] = []
    for negative, slot, english in scored:
        if -negative < ROW_MATCH_THRESHOLD:
            break
        if slot in used_slots or english in used_lines:
            continue
        used_slots.add(slot)
        used_lines.add(english)
        matches.append((slots[slot][0], english))
    return sorted(matches)


def _read_depth(number: str | None) -> int | None:
    """번호의 마디 수("5.2.1" → 3) — 번호가 없거나 숫자 마디가 아니면 None(상대 깊이를 견주지 않는다)."""
    if number is None:
        return None
    parts = number.strip().rstrip(".").split(".")
    return len(parts) if all(part.isdigit() for part in parts) else None


def _read_relative_depths(lines: Sequence[FollowLine]) -> list[int | None]:
    """줄마다 표 안 상대 깊이 — 줄 깊이 − 그 표의 가장 얕은 깊이."""
    depths = [_read_depth(line.number) for line in lines]
    known = [depth for depth in depths if depth is not None]
    return [None if depth is None else depth - min(known) for depth in depths]


def _is_same_number(left: str | None, right: str | None) -> bool:
    return (left or "").strip().rstrip(".") == (right or "").strip().rstrip(".")


def build_follow_plan(
    source: Sequence[FollowLine], lines: Sequence[FollowLine], matches: Sequence[tuple[int, int]]
) -> list[FollowItem] | None:
    """행 짝 → 영어 표의 일(덩이 차례, 합칠 줄은 한 일) — 모든 한글 조각과 모든 영어 줄이 짝을 얻지 못하면 맞춘 꼴이 달라 None(AI 길, D2-R5).

    순서 = 한글 줄의 지금 차례, 번호 = 한글 줄의 번호(다르면), 들여쓰기 = 한글 줄의 들여쓰기 차이나 표 안 상대 깊이가 다르면,
    삭제 = 한글 줄이 확정 삭제(그 줄은 다른 일 없이 지우기만, 이미 지운 영어 줄은 그대로), 합치기 = 한 한글 줄의 조각들에 짝지은 영어 줄들.
    """
    if len(matches) != len(_list_slots(source)) or len(matches) != len(lines):
        return None
    korean_of = {english: korean for korean, english in matches}
    groups: list[tuple[int, list[int]]] = []  # (한글 줄, 영어 줄들) — 첫 영어 줄의 차례로
    merged: dict[int, list[int]] = {}
    for english in range(len(lines)):
        korean = korean_of[english]
        if source[korean].pieces and not source[korean].deleted:
            if korean not in merged:
                merged[korean] = []
                groups.append((korean, merged[korean]))
            merged[korean].append(english)
        else:
            groups.append((korean, [english]))
    target = sorted(range(len(groups)), key=lambda index: (groups[index][0], groups[index][1][0]))
    place = {group: position for position, group in enumerate(target)}
    source_depths, line_depths = _read_relative_depths(source), _read_relative_depths(lines)
    items: list[FollowItem] = []
    for index, (korean, englishes) in enumerate(groups):
        unit_ids = tuple(lines[english].unit_id for english in englishes)
        order = place[index] + 1 if place[index] != index else None
        ko_line, first = source[korean], lines[englishes[0]]
        if ko_line.deleted:
            items.append(FollowItem(unit_ids=unit_ids, order=order, delete=not first.deleted))
            continue
        number = ko_line.number if ko_line.number is not None and not _is_same_number(ko_line.number, first.number) else None
        shift = ko_line.indent_shift if ko_line.indent_shift != first.indent_shift else None
        depths = (source_depths[korean], line_depths[englishes[0]])
        indent = shift is not None or (None not in depths and depths[0] != depths[1])
        items.append(FollowItem(unit_ids=unit_ids, order=order, number=number, indent=indent, indent_shift=shift))
    return items


def count_follow_items(items: Sequence[FollowItem]) -> int:
    """칩이 있는 일의 수 — 머리 "한글 표처럼 하기 · n건"."""
    return sum(1 for item in items if item.has_change())


class CounterpartCandidateOut(BaseModel):
    table_id: int
    table_no: int  # 문서 안 표 순번(1부터) — 화면의 "표 {n}"
    score: float


class CounterpartOut(BaseModel):
    """영어 표의 짝 답 — 후보는 점수 큰 차례. decided는 사람이 정한 답인가(정했으면 바꿀 수 있게 고르기를 보인다)."""

    table_no: int
    status: CounterpartStatus
    source_table_id: int | None
    decided: bool
    candidates: list[CounterpartCandidateOut]


@dataclass(frozen=True)
class CounterpartInputs:
    """짝 답을 셀 재료 — DB에서 읽은 뒤 세션 없이 센다(임베딩 호출 동안 연결을 잡지 않는다)."""

    extraction_id: int
    table_no: int
    table: FollowTable | None  # 영어 표가 아니면 None — 후보도 없다
    candidates: dict[int, tuple[int, FollowTable]]  # 한글 표 → (표 순번, 표)
    has_choice: bool
    chosen: int | None


def _build_follow_table(facts: TableFacts, cells: Sequence[tuple[int, str]]) -> FollowTable:
    """표 사실과 칸 글(행, 글 — 원문 차례) → 점수 표. 글자가 없는 칸(번호 칸 값 · 기호)은 뺀다."""
    rows: dict[int, list[str]] = {}
    for row_index, text in cells:
        if _has_letter(text):
            rows.setdefault(row_index, []).append(text.strip())
    return FollowTable(n_rows=facts.n_rows, n_cols=facts.n_cols, rows=tuple(" ".join(rows[row]) for row in sorted(rows)))


async def load_counterpart_inputs(session: AsyncSession, document: Document, table_id: int) -> CounterpartInputs:
    """문서의 최신 추출에서 영어 표 하나의 짝 재료 — Old가 아니면 422 invalid_side, 그 추출의 표가 아니면 404 table_not_found."""
    if document.side != "old":
        raise_rule(422, "invalid_side", side=document.side)
    extraction_id = await get_latest_extraction_id(session, document.id)
    facts = await load_table_facts(session, extraction_id) if extraction_id is not None else []
    target = next((table for table in facts if table.id == table_id), None)
    if extraction_id is None or target is None:
        raise_rule(404, "table_not_found", table_id=table_id)
    is_english = is_candidate_kind(target) and target.lang == "en"
    candidates = (
        list_counterpart_candidates(target, facts, interleaved=document.language_layout == INTERLEAVED_LAYOUT)
        if is_english else []
    )
    wanted = [target, *candidates]
    cells: dict[int, list[tuple[int, str]]] = {table.id: [] for table in wanted}
    rows = await session.execute(
        select(SourceBlock.table_id, SourceBlock.row_index, SourceBlock.text)
        .where(
            SourceBlock.extraction_id == extraction_id, SourceBlock.kind == "table_cell",
            SourceBlock.table_id.in_(cells),
        )
        .order_by(SourceBlock.seq)
    )
    for cell_table, row_index, text in rows:
        cells[cell_table].append((row_index or 0, text))
    choice = await session.scalar(select(TableCounterpart).where(TableCounterpart.table_id == table_id))
    return CounterpartInputs(
        extraction_id=extraction_id, table_no=target.index + 1,
        table=_build_follow_table(target, cells[target.id]) if is_english else None,
        candidates={table.id: (table.index + 1, _build_follow_table(table, cells[table.id])) for table in candidates},
        has_choice=choice is not None, chosen=choice.source_table_id if choice is not None else None,
    )


async def compute_counterpart(inputs: CounterpartInputs, *, login_id: str) -> CounterpartOut:
    """재료 → 짝 답. 세션을 받지 않는다 — 임베딩이 꺼졌거나 실패하면 꼴과 토큰만 본다."""
    vectors: dict[str, np.ndarray] | None = None
    if inputs.table is not None and inputs.candidates:
        texts = sorted({text for item in (inputs.table, *(table for _, table in inputs.candidates.values())) for text in item.rows})
        try:
            vectors = await embed_texts(texts, login_id=login_id)
        except EmbeddingUnavailable:
            vectors = None
    scores = (
        {table_id: score_tables(table, inputs.table, vectors) for table_id, (_, table) in inputs.candidates.items()}
        if inputs.table is not None else {}
    )
    answer = pick_counterpart(scores, inputs.chosen, has_choice=inputs.has_choice)
    candidates = sorted(
        (
            CounterpartCandidateOut(table_id=table_id, table_no=table_no, score=round(scores[table_id], 3))
            for table_id, (table_no, _) in inputs.candidates.items()
        ),
        key=lambda item: (-item.score, item.table_no),
    )
    return CounterpartOut(
        table_no=inputs.table_no, status=answer.status, source_table_id=answer.source_table_id,
        decided=inputs.has_choice, candidates=candidates,
    )


async def save_counterpart(
    session: AsyncSession, inputs: CounterpartInputs, table_id: int, source_table_id: int | None, *, actor: str
) -> CounterpartInputs:
    """사람이 고른 짝(None = 짝 없음)을 표마다 한 행으로 남긴다 — 영어 표가 아니거나 후보가 아닌 표는 404 table_not_found.
    커밋은 부르는 쪽이 한다. 돌려주는 재료는 고른 것을 담는다."""
    if inputs.table is None:
        raise_rule(404, "table_not_found", table_id=table_id)
    if source_table_id is not None and source_table_id not in inputs.candidates:
        raise_rule(404, "table_not_found", table_id=source_table_id)
    row = await session.scalar(select(TableCounterpart).where(TableCounterpart.table_id == table_id))
    if row is None:
        row = TableCounterpart(extraction_id=inputs.extraction_id, table_id=table_id, decided_by=actor)
        session.add(row)
    row.source_table_id, row.decided_by, row.decided_at = source_table_id, actor, now()
    return replace(inputs, has_choice=True, chosen=source_table_id)
