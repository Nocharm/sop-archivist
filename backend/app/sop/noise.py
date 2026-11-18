"""잡음 표시 — 옮기지 않는 글(목차 줄)을 단위에 붙이는 규칙(MD 1 F6, 설계 2c). 표시는 결정 행이 아니라 코드 규칙이다.

표시가 붙은 단위(units.noise_kind)는 배정 줄·남은 수·진행 숫자·검토 조건에서 빠지고, 결과물 A에는 "삭제 · 목차" 줄로 남는다.
입구 2 새 문서에서는 새 문장을 만들지 않는다. 표시를 비우는 길은 쪼개기 편집 clear_noise 하나이고(되돌리기가 다시 붙인다),
처음 붙이는 길은 단위를 만들 때(units.create_initial_units → segment.build_unit_drafts) 하나다.
"""

import re
from collections.abc import Mapping, Sequence
from typing import Protocol

NOISE_TOC = "toc"
NOISE_KINDS = (NOISE_TOC,)  # 설계 2c의 다른 잡음 종류(앞장 표·안내 글 …)도 나중에 같은 열을 쓴다

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
