"""잡음 표시 — 옮기지 않는 글(목차 줄 · 본문 앞부분 · 개정 이력)을 단위에 붙이는 규칙(MD 1 F6, 쪼개기 먼저 설계 §7 R3). 화면에서는
저절로 삭제된 줄이다. 표시는 결정 행이 아니라 코드 규칙이다. 줄 하나에 종류 하나.

표시가 붙은 단위(units.noise_kind)는 배정 줄·남은 수·진행 숫자·검토 조건에서 빠지고, 결과물 A에는 "삭제" 줄로 남는다(사유는
units.noise_reason, 빈 글이면 종류마다 정한 문구). 입구 2 새 문서에서는 새 문장을 만들지 않는다. 처음 붙이는 길은 단위를 만들 때
(목차는 segment.build_unit_drafts, 앞부분 · 개정 이력은 units._build_unit_rows — 쪼개기 규칙 2 추출만) 하나이고, 사람이 바꾸는 길은
쪼개기 편집 clear_noise(삭제 취소) · start_body(여기부터 본문)다. 되돌리기가 전 표시로 돌린다.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

NOISE_TOC = "toc"
NOISE_FRONT = "front"  # 1장 앞(표지 · 결재 · Summary of Changes …)
NOISE_HISTORY = "history"  # 1장 뒤의 개정 이력 절
NOISE_KINDS = (NOISE_TOC, NOISE_FRONT, NOISE_HISTORY)

# 추출기 docx_reader의 목차 까닭(SIGNAL_TOC 값) — 추출기가 이 모듈을 import하지 않으므로 값을 옮겨 적는다(시험이 같음을 지킨다)
TOC_SIGNAL = "toc"
TOC_STRUCTURE_REASONS = frozenset({"style", "field", "sdt"})  # Word가 목차라고 적어 둔 까닭 — 이것 하나면 확실하다
TOC_LEADER_REASON = "leader"  # 점 끌기 — 보통 줄에도 있어(관련 서식 …… 별첨) 혼자로는 확실하지 않다
# 점 끌기 줄만으로 된 덩어리를 목차로 볼 쪽 번호 줄 수 하한 — 손으로 친 목차(스타일·필드 없음)를 알아보는 값.
# 합성 자료로 정한 값이다(실제 SOP 시험 뒤 다시 정한다). 낮추면 보통 본문의 서식 목록까지 목차로 접힌다
MIN_LEADER_PAGE_LINES = 3
_PAGE_TAIL_RE = re.compile(r"\d{1,4}\s*$")  # 줄 끝 쪽 번호
_TOC_BLOCK_KIND = "paragraph"
_TOC_PART = "body"


class TocBlock(Protocol):
    """목차 판정이 읽는 블록 칸 — segment.BlockView가 맞는다."""

    @property
    def id(self) -> int: ...

    @property
    def kind(self) -> str: ...

    @property
    def part(self) -> str: ...

    @property
    def text(self) -> str: ...

    @property
    def signals(self) -> Mapping[str, object] | None: ...


def read_toc_reasons(block: TocBlock) -> frozenset[str]:
    """블록이 목차로 보이는 까닭들 — 본문 문단만(추출기도 본문 문단에만 싣는다), 옛 추출(신호 없음)은 빈 집합."""
    if block.kind != _TOC_BLOCK_KIND or block.part != _TOC_PART or not block.signals:
        return frozenset()
    reasons = block.signals.get(TOC_SIGNAL)
    return frozenset(reasons) if isinstance(reasons, list) else frozenset()


def find_toc_block_ids(blocks: Sequence[TocBlock]) -> set[int]:
    """목차 줄로 표시할 블록 id — blocks는 seq 순(모든 종류). 앱은 확실할 때만 먼저 한다(MD 1 원칙 1).

    목차 까닭이 있는 본문 문단이 끊김 없이 이어진 덩어리마다 판정한다(다른 블록이 하나라도 끼면 덩어리가 끊긴다):
    - Word가 목차라고 적은 줄(스타일 toc N · TOC 필드 결과 · 목차 구성 요소)이 하나라도 든 덩어리는 통째로 목차다 — 그 바로
      앞뒤의 점 끌기 줄(목차 뒤 "관련 서식 …… 별첨")도 함께 잡힌다. 잘못 잡힌 줄은 사람이 "목차 아님"으로 푼다.
    - 점 끌기 줄만으로 된 덩어리는 줄 끝이 쪽 번호인 줄이 MIN_LEADER_PAGE_LINES 이상일 때만 목차다(손으로 친 목차).
    """
    found: set[int] = set()
    run: list[tuple[int, frozenset[str], str]] = []

    def close_run() -> None:
        has_structure = any(reasons & TOC_STRUCTURE_REASONS for _, reasons, _ in run)
        page_lines = sum(1 for _, _, text in run if _PAGE_TAIL_RE.search(text) is not None)
        if has_structure or page_lines >= MIN_LEADER_PAGE_LINES:
            found.update(block_id for block_id, _, _ in run)
        run.clear()

    for block in blocks:
        reasons = read_toc_reasons(block)
        if reasons:
            run.append((block.id, reasons, block.text))
        elif run:
            close_run()
    if run:
        close_run()
    return found


# --- 본문 앞부분 · 개정 이력 (쪼개기 먼저 설계 §7 R3) ---

# 개정 이력 절 제목 이름 — 번호를 뺀 제목 글(괄호 · 빗금으로 나뉜 조각 하나)이 이것과 같으면 그 절이다. 대소문자 · 빈칸은 무시
_HISTORY_NAME = re.compile(
    r"summary of changes?|revision history|document change history|개정 ?이력|변경 ?이력", re.IGNORECASE
)
# 이보다 긴 글은 절 제목으로 보지 않는다 — 절 이름은 짧고, 번호 떼기가 긴 글에서 느려지지 않게
MAX_SECTION_HEADING_CHARS = 200
# 제목 앞 절 번호("7." · "7.1" · "(7)" · "VII.")
_HEADING_NUMBER = re.compile(r"\s*(?:\(?\d+(?:\.\d+)*\.?\)?|[IVX]+\.)\s*")
FIRST_CHAPTER = "1"
# 본문 번호 꼴("5" · "5.1") — 날짜("2026.01.02")와 개정 번호("01")는 아니다
_BODY_NUMBER = re.compile(r"[1-9]\d?(?:\.[1-9]\d?)*")
_START_KINDS = ("heading", "sentence")
_PARAGRAPH_LEVEL = 99  # 제목 단계가 없는 번호 문단 — 어느 제목보다 아래다


@dataclass(frozen=True)
class NoiseLine:
    """앞부분 · 개정 이력 판정이 읽는 단위 하나(문서 순서, 묶인 칸 · 캡션도 제 줄로)."""

    kind: str
    text: str
    langs: frozenset[str]  # {"ko"} · {"en"} · 빈 집합(중립). 묶음(표 · 그림)과 든 줄은 든 칸 · 캡션 언어의 합
    number: str | None
    level: int | None  # 블록 heading_level, 띠 표 제목은 띠 표 신호 level
    is_body: bool
    is_flow: bool  # 표 밖 줄이거나 띠 표 제목
    noise: str | None  # 이미 붙은 표시 — 처음 쪼갤 때는 목차뿐


def list_heading_names(text: str) -> list[str]:
    """절 제목의 이름 조각들 — 절 번호를 떼고 괄호 · 빗금으로 나눈다("참고 문헌 (References)"은 둘). 긴 글은 제목이 아니라 빈 목록."""
    if len(text) > MAX_SECTION_HEADING_CHARS:
        return []
    body = _HEADING_NUMBER.sub("", text, count=1)
    parts = (" ".join(part.split()).strip(" :.-–") for part in re.split(r"[()/|]", body))
    return [part for part in parts if part]


def is_history_heading(text: str) -> bool:
    """제목이 개정 이력 절을 여는가 — 이름 조각 하나라도 정한 이름과 같으면(refs.is_ref_section_heading과 같은 다듬기)."""
    return any(_HISTORY_NAME.fullmatch(part) for part in list_heading_names(text))


def _is_chapter_one(line: NoiseLine) -> bool:
    return (
        line.is_body and line.is_flow and line.noise is None and line.kind in _START_KINDS
        and line.number is not None and line.number.strip(".") == FIRST_CHAPTER
    )


def _read_level(line: NoiseLine) -> int:
    if line.level is not None:
        return line.level
    return 1 if line.kind == "heading" else _PARAGRAPH_LEVEL


def _has_body_number(line: NoiseLine) -> bool:
    return (
        line.is_body and line.is_flow and line.noise is None and line.kind in _START_KINDS
        and line.number is not None and _BODY_NUMBER.fullmatch(line.number.strip(".")) is not None
    )


def _has_body_before(lines: Sequence[NoiseLine], start: int) -> bool:
    """번호 1인 줄 앞에서 이미 본문이 시작했는가 — 본문 번호("5." · "5.1")인 줄이나 더 위 단계 제목(개정 이력 제목 말고)이 있으면.

    그 1은 장 번호가 아니라 절 안의 단계다. 확실하지 않으면 앱은 먼저 지우지 않는다(사람은 "여기부터 본문"으로 한 번에 정한다).
    """
    own = _read_level(lines[start])
    for line in lines[:start]:
        if _has_body_number(line):
            return True
        is_title = line.is_body and line.is_flow and line.noise is None and line.kind == "heading"
        if is_title and _read_level(line) < own and not is_history_heading(line.text):
            return True
    return False


def find_body_starts(lines: Sequence[NoiseLine], *, separate: bool) -> list[int]:
    """본문이 시작하는 줄의 자리 — 번호가 "1"인 첫 제목이나 번호 문단(목차 줄 · 표 안 숫자는 보지 않는다). 없으면 빈 목록(G17).

    separate(한/영 따로)면 그 뒤에서 처음 나오는 다른 언어의 1장 제목이 둘째 반쪽의 시작이다.
    """
    starts = [index for index, line in enumerate(lines) if _is_chapter_one(line)]
    if not starts or _has_body_before(lines, starts[0]):
        return []
    first = starts[0]
    if not separate or not lines[first].langs:
        return [first]
    second = next(
        (
            index for index in starts[1:]
            if lines[index].kind == "heading" and lines[index].langs and not lines[index].langs & lines[first].langs
        ),
        None,
    )
    return [first] if second is None else [first, second]


def find_half_front(
    lines: Sequence[NoiseLine], at: int, langs: frozenset[str], *, crosses_numbers: bool = False
) -> int:
    """둘째 반쪽의 앞부분이 시작하는 자리 — at 바로 앞으로 끊김 없이 이어진 langs · 중립 줄의 첫 자리(없으면 at).

    맨 앞의 중립 줄은 뺀다 — 첫 반쪽 끝의 그림을 먹지 않게. crosses_numbers가 아니면 본문 번호인 줄(한글 반쪽의 영어 제목 "9. Reference")에서
    멈춘다 — 그 앞은 첫 반쪽이다.
    """
    start = at
    while (
        start > 0 and lines[start - 1].is_body and lines[start - 1].langs <= langs
        and (crosses_numbers or not _has_body_number(lines[start - 1]))
    ):
        start -= 1
    while start < at and not lines[start].langs:
        start += 1
    return start


def find_noise_lines(lines: Sequence[NoiseLine], *, separate: bool) -> dict[int, str]:
    """줄 자리 → 새로 붙일 표시(앞부분 · 개정 이력). 이미 표시가 있는 줄(목차)은 그대로 둔다."""
    starts = find_body_starts(lines, separate=separate)
    if not starts:
        return {}
    first = starts[0]
    front = [*range(first)]
    if len(starts) > 1:
        front.extend(range(find_half_front(lines, starts[1], lines[starts[1]].langs), starts[1]))
    found = {index: NOISE_FRONT for index in front if lines[index].is_body and lines[index].noise is None}
    level: int | None = None  # 열린 개정 이력 절의 단계
    for index in range(first + 1, len(lines)):
        line = lines[index]
        if not line.is_body or line.noise is not None or index in found:
            continue
        if line.kind == "heading" and line.is_flow:
            own = _read_level(line)
            if level is not None and own <= level:
                level = None
            if level is None and is_history_heading(line.text):
                level = own
        if level is not None:
            found[index] = NOISE_HISTORY
    return found
