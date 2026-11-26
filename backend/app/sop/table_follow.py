"""한글 표 따라 하기(11-23 명세 D2) — 영어 표의 짝 한글 표를 꼴 + 언어 무관 토큰 + 뜻(임베딩)으로 고른다(D2-R1 · R2).

점수 · 후보는 DB를 읽지 않는 순수 함수다. 애매하면 사람이 고르고 그 답은 table_counterparts에 남는다(D2-R3). Old 문서만 쓴다.
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
from app.sop.constants import TABLE_FOLLOW_MARGIN, TABLE_FOLLOW_THRESHOLD
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
    total = 0.0
    for text in short:
        vector = vectors[text]
        total += max(
            float(np.dot(vector, vectors[other]) / (np.linalg.norm(vector) * np.linalg.norm(vectors[other])))
            for other in long
        )
    return max(total / len(short), 0.0)


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
