"""커버리지 검사 — 커버 단위 범위가 겹치지 않고, 앞뒤가 빈 글자가 아니며, 모든 블록의 빈 글자 아닌 글자를 덮는지 본다(순수 함수)."""

from collections.abc import Mapping, Sequence

from app.sop.segment import has_visible_char, is_blank_char


def find_coverage_problems(
    block_texts: Mapping[int, str], cover_spans: Sequence[Sequence[tuple[int, int, int]]]
) -> list[str]:
    """문제를 사람이 읽는 한 줄씩 — 범위 문제(단위 순서)를 먼저, 블록 문제(블록 id 순서)를 뒤에 둔다. 없으면 [].

    단위는 cover_spans 안의 번호(#n)로, 위치는 글자 번호로만 가리킨다 — 원문 글자를 싣지 않아 로그·예외에 그대로 써도 된다.
    """
    problems: list[str] = []
    spans_by_block: dict[int, list[tuple[int, int]]] = {block_id: [] for block_id in block_texts}
    for unit_index, spans in enumerate(cover_spans):
        for block_id, start, end in spans:
            text = block_texts.get(block_id)
            if text is None:
                problems.append(f"unit #{unit_index}: span on unknown block {block_id}")
            elif not 0 <= start < end <= len(text):
                problems.append(f"unit #{unit_index}: invalid span {block_id}:{start}-{end}")
            else:
                if is_blank_char(text[start]) or is_blank_char(text[end - 1]):
                    problems.append(f"unit #{unit_index}: span {block_id}:{start}-{end} has a blank char at an edge")
                spans_by_block[block_id].append((start, end))
    for block_id in sorted(block_texts):
        problems.extend(_find_block_problems(block_id, block_texts[block_id], spans_by_block[block_id]))
    return problems


def _find_block_problems(block_id: int, text: str, spans: list[tuple[int, int]]) -> list[str]:
    """한 블록 안의 겹침과 덮이지 않은 빈 글자 아닌 글자 — 덮이지 않은 구간마다 첫 글자 자리를 알린다."""
    problems: list[str] = []
    covered_to = 0
    for start, end in sorted(spans):
        if start < covered_to:
            problems.append(f"block {block_id}: spans overlap at {start}")
        elif has_visible_char(text[covered_to:start]):
            problems.append(f"block {block_id}: uncovered text at {_find_visible(text, covered_to)}")
        covered_to = max(covered_to, end)
    if has_visible_char(text[covered_to:]):
        problems.append(f"block {block_id}: uncovered text at {_find_visible(text, covered_to)}")
    return problems


def _find_visible(text: str, start: int) -> int:
    return next(index for index in range(start, len(text)) if not is_blank_char(text[index]))
