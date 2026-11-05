"""범위 계산 — 쪼개기 편집이 단위 범위를 자르고 잇고 다듬는 순수 함수(DB를 모른다, 스펙 §6.4)."""

from collections.abc import Mapping, Sequence

from app.sop.segment import has_visible_char, trim_blank_range

Span = tuple[int, int, int]  # (블록 id, 시작, 끝) — 끝은 포함하지 않는다
NEUTRAL = "neutral"


def to_spans(raw: Sequence[Sequence[int]]) -> list[Span]:
    """units.spans(JSON 목록) → 튜플 목록."""
    return [(block_id, start, end) for block_id, start, end in raw]


def trim_span(span: Span, block_texts: Mapping[int, str]) -> Span | None:
    """앞뒤 빈 글자를 뺀 범위 — 빈 글자뿐이면 None(커버리지가 쓰는 같은 빈 글자 판정)."""
    block_id, start, end = span
    trimmed = trim_blank_range(block_texts[block_id], start, end)
    return None if trimmed is None else (block_id, *trimmed)


def locate_text_offset(spans: Sequence[Span], at: int) -> tuple[int, int] | None:
    """단위 글자 위치 at → (범위 번호, 블록 안 위치). at이 범위 사이 이음 글자(" "·"\\n")거나 글자 밖이면 None.

    단위 글자는 범위 글자를 한 글자 이음으로 이은 것이라(segment.build_unit_text) 범위마다 글자 길이 + 1씩 건너뛴다.
    """
    offset = 0
    for index, (_, start, end) in enumerate(spans):
        if offset <= at < offset + end - start:
            return index, start + at - offset
        offset += end - start + 1
    return None


def cut_spans(
    spans: Sequence[Span], index: int, position: int, block_texts: Mapping[int, str]
) -> tuple[list[Span], list[Span]]:
    """index번 범위의 블록 위치 position에서 둘로 — 잘린 두 조각만 다듬고, 빈 조각은 버린다."""
    block_id, start, end = spans[index]
    left = [*spans[:index], *_keep_trimmed([(block_id, start, position)], block_texts)]
    right = [*_keep_trimmed([(block_id, position, end)], block_texts), *spans[index + 1:]]
    return left, right


def join_close_spans(spans: Sequence[Span], block_texts: Mapping[int, str]) -> list[Span]:
    """위치 순 범위에서 같은 블록의 이웃 범위 사이가 빈 글자뿐이면 한 범위로 잇는다(합치기)."""
    joined: list[Span] = []
    for block_id, start, end in spans:
        if joined:
            last_block, last_start, last_end = joined[-1]
            if last_block == block_id and not has_visible_char(block_texts[block_id][last_end:start]):
                joined[-1] = (block_id, last_start, end)
                continue
        joined.append((block_id, start, end))
    return joined


def split_around(
    spans: Sequence[Span],
    block_id: int,
    start: int,
    end: int,
    block_texts: Mapping[int, str],
    seq_by_block: Mapping[int, int],
) -> tuple[list[Span], list[Span]]:
    """단위 범위에서 블록의 [start, end)를 도려낸 앞 조각들과 뒤 조각들(골라 만들기) — 조각은 다듬고 빈 것은 버린다."""
    target_seq = seq_by_block[block_id]
    before: list[Span] = []
    after: list[Span] = []
    for span in spans:
        span_block, span_start, span_end = span
        if span_block != block_id:
            (before if seq_by_block[span_block] < target_seq else after).append(span)
            continue
        if span_start < start:
            before.extend(_keep_trimmed([(span_block, span_start, min(span_end, start))], block_texts))
        if span_end > end:
            after.extend(_keep_trimmed([(span_block, max(span_start, end), span_end)], block_texts))
    return before, after


def overlaps(spans: Sequence[Span], block_id: int, start: int, end: int) -> bool:
    """범위 중 하나라도 블록의 [start, end)와 겹치는지."""
    return any(block == block_id and span_start < end and start < span_end for block, span_start, span_end in spans)


def fill_languages(langs: Sequence[str], default: str) -> list[str]:
    """빈 칸("")을 앞 단위의 언어로, 앞에 없으면 뒤 단위의 언어로, 둘 다 없으면 default로 채운다 — 중립은 건너뛴다.

    처음 쪼개기(segment._fill_languages)와 같은 규칙이다. langs는 정렬 키 순서다.
    """
    known = [lang for lang in langs if lang not in ("", NEUTRAL)]
    previous = known[0] if known else default
    filled = []
    for lang in langs:
        if lang == "":
            lang = previous
        elif lang != NEUTRAL:
            previous = lang
        filled.append(lang)
    return filled


def _keep_trimmed(spans: Sequence[Span], block_texts: Mapping[int, str]) -> list[Span]:
    return [trimmed for span in spans if (trimmed := trim_span(span, block_texts)) is not None]
