"""한/영 따로 문서의 대응 표(F8a) — 다른 언어 절반의 같은 꼴 표를 찾고, 둘 다 벗긴 대응 표의 칸 줄을 같은 행 · 같은 순서로 짝짓는다.

DB를 읽지 않는 순수 함수다. 표 사실(TableFacts)은 부르는 쪽(문서 보기 · units.refresh_code_pairs)이 원문 표와 단위 언어 수로 만든다.
같은 꼴은 열 수 · 열 폭(±WIDTH_TOLERANCE_TWIPS) · 첫 행 꼴(첫 행 칸 안의 표 신호)이 같은 것이다(명세 F2 · 설계 2b).
"""

from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from app.sop.constants import MAX_PAIR_SIDE
from app.sop.segment import is_band_table

# 열 폭 허용 차(twip) — 0.1 cm(1 cm = 567 twip, 명세 F2). 넓히면 폭이 조금 다른 표도 대응 표로 뜬다
WIDTH_TOLERANCE_TWIPS = 57
PAIR_LANGS = ("ko", "en")
BODY_PART = "body"


class TableRow(Protocol):
    """원문 표 행(source_tables)에서 읽는 칸 — ORM 행과 select 결과가 같은 이름으로 준다."""

    id: int
    table_index: int
    parent_table_id: int | None
    part: str
    n_rows: int
    n_cols: int
    is_layout: bool
    signals: Mapping[str, object] | None


@dataclass(frozen=True)
class TableFacts:
    """대응 표 판정이 보는 표 하나 — lang은 칸 줄 언어 수가 많은 쪽(같으면 None, 대응 표 후보가 아니다)."""

    id: int
    index: int
    parent_id: int | None
    part: str
    n_rows: int
    n_cols: int
    is_layout: bool
    widths: tuple[int, ...] | None
    first_row: tuple[tuple[object, ...], ...]
    is_band: bool
    lang: str | None


def count_table_langs(units: Iterable[tuple[int | None, str]]) -> dict[int, Counter[str]]:
    """(단위의 표, 언어) → 표마다 한글 · 영어 줄 수 — 표 밖 단위와 중립 · 참조 단위는 세지 않는다."""
    counts: dict[int, Counter[str]] = {}
    for table_id, lang in units:
        if table_id is not None and lang in PAIR_LANGS:
            counts.setdefault(table_id, Counter())[lang] += 1
    return counts


def read_table_lang(counts: Mapping[str, int]) -> str | None:
    """칸 줄의 언어 수 → 표의 언어. 한글 표에도 영어 낱말 칸이 섞이므로 많은 쪽을 따르고, 같으면(두 언어 표 · 빈 표) None."""
    korean, english = counts.get("ko", 0), counts.get("en", 0)
    if korean == english:
        return None
    return "ko" if korean > english else "en"


def build_table_facts(tables: Iterable[TableRow], lang_counts: Mapping[int, Mapping[str, int]]) -> list[TableFacts]:
    """원문 표 행과 표마다 칸 줄 언어 수 → 표 사실(표 순번 순). 신호가 없는 옛 추출(추출기 5 전)은 열 폭을 모른다."""
    facts = []
    for table in sorted(tables, key=lambda item: item.table_index):
        signals = table.signals or {}
        widths = signals.get("widths")
        first_row = signals.get("first_row") or []
        facts.append(
            TableFacts(
                id=table.id, index=table.table_index, parent_id=table.parent_table_id, part=table.part,
                n_rows=table.n_rows, n_cols=table.n_cols, is_layout=table.is_layout,
                widths=tuple(int(width) for width in widths) if isinstance(widths, list) else None,
                first_row=tuple(tuple(item) for item in first_row if isinstance(item, list)),
                is_band=is_band_table(signals), lang=read_table_lang(lang_counts.get(table.id, {})),
            )
        )
    return facts


def is_same_form(first: TableFacts, second: TableFacts) -> bool:
    """같은 꼴 표인가 — 열 수, 열 폭(둘 다 알 때만, 열마다 ±WIDTH_TOLERANCE_TWIPS), 첫 행 꼴이 같다."""
    if first.n_cols != second.n_cols or first.first_row != second.first_row:
        return False
    if first.widths is None or second.widths is None:
        return True
    return len(first.widths) == len(second.widths) and all(
        abs(left - right) <= WIDTH_TOLERANCE_TWIPS for left, right in zip(first.widths, second.widths, strict=True)
    )


def _is_candidate_kind(table: TableFacts) -> bool:
    """대응 표가 될 수 있는 표 — 본문의 언어가 하나인 표. 띠 표는 절 제목 줄이 되므로 뺀다."""
    return table.part == BODY_PART and table.lang in PAIR_LANGS and not table.is_band


def _list_half_orders(tables: Sequence[TableFacts]) -> dict[int, int]:
    """표 → 그 언어 절반 안의 순번(0부터) — 바깥 표와 칸 안의 표는 따로 센다."""
    orders: dict[int, int] = {}
    seen: dict[tuple[str | None, bool], int] = {}
    for table in tables:
        if not _is_candidate_kind(table):
            continue
        key = (table.lang, table.parent_id is None)
        orders[table.id] = seen.get(key, 0)
        seen[key] = orders[table.id] + 1
    return orders


def _rank(table: TableFacts, candidates: Iterable[TableFacts], orders: Mapping[int, int]) -> list[TableFacts]:
    """비슷한 차례 — 같은 꼴 먼저, 행 수 차이가 작은 것, 절반 안 순번 차이가 작은 것, 문서 앞의 것."""
    return sorted(
        candidates,
        key=lambda other: (
            not is_same_form(table, other), abs(other.n_rows - table.n_rows),
            abs(orders[other.id] - orders[table.id]), other.index,
        ),
    )


def _list_candidates(table: TableFacts, tables: Sequence[TableFacts], *, is_layout: bool) -> list[TableFacts]:
    """다른 언어 절반의 같은 겹(바깥 표끼리 · 칸 안의 표끼리) 표 가운데 벗김 상태가 is_layout인 것."""
    return [
        other for other in tables
        if other.id != table.id and _is_candidate_kind(other) and other.lang != table.lang
        and (other.parent_id is None) == (table.parent_id is None) and other.is_layout == is_layout
    ]


def list_counterpart_options(tables: Sequence[TableFacts]) -> dict[int, list[int]]:
    """아직 벗기지 않은 표 → 함께 벗길 대응 표 후보(비슷한 차례). 가장 비슷한 후보가 같은 꼴일 때만 싣는다 — 빈 목록이면 묻지 않는다.

    후보는 다른 언어 절반의 아직 벗기지 않은 표 전부다(사람이 가장 비슷한 것 대신 다른 표를 고를 수 있다). 이미 벗긴 표는 싣지 않는다.
    """
    orders = _list_half_orders(tables)
    options: dict[int, list[int]] = {}
    for table in tables:
        if table.is_layout or not _is_candidate_kind(table):
            continue
        ranked = _rank(table, _list_candidates(table, tables, is_layout=False), orders)
        if ranked and is_same_form(table, ranked[0]):
            options[table.id] = [other.id for other in ranked]
    return options


def match_unwrapped_tables(tables: Sequence[TableFacts], links: Sequence[tuple[int, int]]) -> list[tuple[int, int]]:
    """둘 다 벗긴 대응 표 (한글 표, 영어 표) — 사람이 함께 벗긴 짝(links, 앞의 것이 먼저)이 먼저다.

    나머지 벗긴 한글 표는 문서 순서대로, 아직 대응 표가 없는 벗긴 영어 표 가운데 같은 꼴인 가장 비슷한 표와 맺는다(따로 벗긴 두 표도
    둘 다 벗기면 맺어진다). 표 하나는 대응 표 하나만 갖는다.
    """
    by_id = {table.id: table for table in tables if table.is_layout and _is_candidate_kind(table)}
    used: set[int] = set()
    matches: list[tuple[int, int]] = []
    for first, second in links:
        pair = [by_id.get(first), by_id.get(second)]
        if None in pair or {first, second} & used or {table.lang for table in pair} != set(PAIR_LANGS):
            continue
        korean, english = sorted(pair, key=lambda table: table.lang != "ko")
        matches.append((korean.id, english.id))
        used.update((first, second))
    orders = _list_half_orders(tables)
    for table in sorted(by_id.values(), key=lambda item: item.index):
        if table.lang != "ko" or table.id in used:
            continue
        free = [other for other in _list_candidates(table, list(by_id.values()), is_layout=True) if other.id not in used]
        ranked = _rank(table, free, orders)
        if ranked and is_same_form(table, ranked[0]):
            matches.append((table.id, ranked[0].id))
            used.update((table.id, ranked[0].id))
    return matches


def build_row_pairs(
    korean_rows: Mapping[int, Sequence[int]], english_rows: Mapping[int, Sequence[int]]
) -> list[tuple[list[int], list[int]]]:
    """같은 행의 한글 줄 · 영어 줄(원문 순) → 짝 [(한글 단위들, 영어 단위들)]. 줄 수가 같으면 순서대로 1:1, 다르면 그 행을 한 덩어리
    짝으로(코드 짝의 조항 덩어리와 같다) — 어느 쪽이든 MAX_PAIR_SIDE를 넘는 덩어리와 한쪽이 빈 행은 짝 없이 둔다."""
    pairs: list[tuple[list[int], list[int]]] = []
    for row in sorted(korean_rows.keys() & english_rows.keys()):
        korean, english = list(korean_rows[row]), list(english_rows[row])
        if not korean or not english:
            continue
        if len(korean) == len(english):
            pairs.extend(([left], [right]) for left, right in zip(korean, english, strict=True))
        elif len(korean) <= MAX_PAIR_SIDE and len(english) <= MAX_PAIR_SIDE:
            pairs.append((korean, english))
    return pairs
