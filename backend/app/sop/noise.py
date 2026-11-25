"""잡음 표시 — 옮기지 않는 글(목차 줄 · 본문 앞부분 · 개정 이력)을 단위에 붙이는 규칙(MD 1 F6, 쪼개기 먼저 설계 §7 R3). 화면에서는
저절로 삭제된 줄이다. 표시는 결정 행이 아니라 코드 규칙이다. 줄 하나에 종류 하나.

표시가 붙은 단위(units.noise_kind)는 배정 줄·남은 수·진행 숫자·검토 조건에서 빠지고, 결과물 A에는 "삭제" 줄로 남는다(사유는
units.noise_reason, 빈 글이면 종류마다 정한 문구). 입구 2 새 문서에서는 새 문장을 만들지 않는다. 처음 붙이는 길은 단위를 만들 때
(목차는 segment.build_unit_drafts, 앞부분 · 개정 이력은 units._build_unit_rows — 쪼개기 규칙 2 추출만) 하나이고, 사람이 바꾸는 길은
쪼개기 편집 clear_noise(삭제 취소) · start_body(여기부터 본문)다. 되돌리기가 전 표시로 돌린다.
"""

import re
from collections import Counter
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

# 개정 이력 절 제목 이름 — 번호를 뺀 제목의 조각(괄호 · 빗금으로 나눈다)이 모두 이것이어야 그 절이다. 대소문자 · 빈칸은 무시
_HISTORY_NAME = re.compile(
    r"summary of changes?|revision history|document change history|개정 ?이력|변경 ?이력", re.IGNORECASE
)
# 1장 앞에 있어도 되는 제목 — 다른 이름의 제목이 앞에 있으면 본문이 이미 시작한 것으로 본다
_FRONT_HEADING_NAME = re.compile(
    r"목 ?차|차 ?례|(?:table of )?contents|승인|결재|approvals?|approval page|signatures?|표지|cover(?: page)?", re.IGNORECASE
)
# 번호 없이 이름만 적은 장("목적" 문단 · 표의 첫 칸) — 1장 앞에 있으면 본문이 이미 시작한 것으로 본다
_CHAPTER_NAME = re.compile(
    r"목 ?적|(?:적용 ?)?범 ?위|책임(?:과 ?권한)?|(?:용어의? ?)?정의|(?:작업 ?)?절차|purpose|objectives?|scope|responsibilit(?:y|ies)"
    r"|definitions?|procedures?",
    re.IGNORECASE,
)
# 개정 이력 표의 머리 칸 글 — 이력 제목 아래의 다른 표(본문 표)를 지우지 않게
_HISTORY_CELL = re.compile(r"rev|ver|change|date|author|개정|차수|판|변경|일자|날짜|내용|사유", re.IGNORECASE)
# 이보다 긴 글은 절 제목으로 보지 않는다 — 절 이름은 짧고, 번호 떼기가 긴 글에서 느려지지 않게
MAX_SECTION_HEADING_CHARS = 200
# 제목 앞 절 번호("7." · "7.1" · "(7)" · "VII.")
_HEADING_NUMBER = re.compile(r"\s*(?:\(?\d+(?:\.\d+)*\.?\)?|[IVX]+\.)\s*")
FIRST_CHAPTER = "1"
# 본문 번호 꼴("5" · "5.1" · "1.0") — 날짜("2026.01.02")와 개정 번호("01")는 아니다
_BODY_NUMBER = re.compile(r"(?:0|[1-9]\d?)(?:\.\d{1,2})*")
# 읽은 번호가 없어도 본문의 장 · 조 · 단계인 줄머리 — "제1장" "제1조" "Chapter 1" "I." "Ⅰ" "A." "가." "1)" "(1)" "1-1" "①" "5 절차"
_BODY_LABEL = re.compile(
    r"\s*(?:제 ?\d+ ?[장조절항편부]|(?:chapter|section|article|part) (?:\d+|[ivx]+)\b|[ivx]+[.)]\s|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ①-⑳]"
    r"|[a-z가-하][.)]\s|\(?\d{1,2}\)|\d{1,2}(?:-\d{1,2})+\s|(?:0|[1-9]\d?)(?:\.\d{1,2})*\s+\S)",
    re.IGNORECASE,
)
# 절 뒤에 붙는 문서 — 개정 이력은 여기서 끝난다
_ATTACHMENT_LABEL = re.compile(
    r"\s*(?:첨부|부록|별첨|별표|별지|붙임|서식|양식|attachments?|appendi(?:x|ces)|annex(?:es)?|exhibits?|forms?|enclosures?)(?![a-z])",
    re.IGNORECASE,
)
_START_KINDS = ("heading", "sentence")
_PARAGRAPH_LEVEL = 99  # 제목 단계가 없는 번호 문단 — 어느 제목보다 아래다
# 아래 셋은 합성 자료로 잡은 값이다(실제 SOP 뒤 다시 정한다) — 넘으면 확실하지 않아 표시하지 않는다
MAX_TITLE_CHARS = 60  # 번호 문단을 장 제목으로 볼 글자 수
MAX_FRONT_PROSE = 2  # 제목 스타일 1장 앞에 있어도 되는 문장(마침표로 끝난 글) 수
MAX_HISTORY_INTRO = 2  # 개정 이력 제목과 그 표 사이의 글 줄 수
_TERMINATORS = (".", "。", "!", "?")
_CLOSERS = " \t\"'”’)]}」』"
_KOREAN_ENDING = re.compile(r"(?:다|시오|세요|것|함|됨)$")  # 마침표 없이 끝난 한글 문장
MAX_LINE_CHARS = 120  # 이보다 긴 글은 표지 글이 아니라 문장으로 본다


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
    group: int | None = None  # 묶인 표 · 그림 줄의 자리(묶이지 않았으면 None)


def list_heading_names(text: str) -> list[str]:
    """절 제목의 이름 조각들 — 절 번호를 떼고 괄호 · 빗금으로 나눈다("참고 문헌 (References)"은 둘). 긴 글은 제목이 아니라 빈 목록."""
    if len(text) > MAX_SECTION_HEADING_CHARS:
        return []
    body = _HEADING_NUMBER.sub("", text, count=1)
    parts = (" ".join(part.split()).strip(" :.-–") for part in re.split(r"[()/|]", body))
    return [part for part in parts if part]


def _is_named(text: str, *names: re.Pattern[str]) -> bool:
    parts = list_heading_names(text)
    return bool(parts) and all(any(name.fullmatch(part) for name in names) for part in parts)


def is_history_heading(text: str) -> bool:
    """제목이 개정 이력 절을 여는가 — 이름 조각이 모두 정한 이름일 때만("개정 이력 (Revision History)"). "변경 관리 (변경 이력)"은 다른 절이다."""
    return _is_named(text, _HISTORY_NAME)


def _is_flow_text(line: NoiseLine) -> bool:
    """판정이 보는 표 밖 글 줄 — 본문의 제목 · 문장이고 목차 · 이미 표시된 줄이 아니다."""
    return line.is_body and line.is_flow and line.noise is None and line.kind in _START_KINDS


def _read_number(line: NoiseLine) -> str:
    return (line.number or "").strip(".")


def _is_chapter_one(line: NoiseLine) -> bool:
    return _is_flow_text(line) and _read_number(line) == FIRST_CHAPTER


def _is_styled(line: NoiseLine) -> bool:
    """제목 스타일의 줄 — 제목이거나 제목에서 문장으로 바꾼 줄(F8b)."""
    return line.kind == "heading" or line.level is not None


def _read_level(line: NoiseLine) -> int:
    if line.level is not None:
        return line.level
    return 1 if line.kind == "heading" else _PARAGRAPH_LEVEL


def _has_body_number(line: NoiseLine) -> bool:
    return _is_flow_text(line) and _BODY_NUMBER.fullmatch(_read_number(line)) is not None


def _is_prose(line: NoiseLine) -> bool:
    """문장인가 — 마침표나 한글 문장 끝으로 끝나거나 긴 글. 표지 글은 이름 · 날짜라 문장이 아니다."""
    text = line.text.rstrip(_CLOSERS)
    return text[-1:] in _TERMINATORS or _KOREAN_ENDING.search(text) is not None or len(text) > MAX_LINE_CHARS


def _is_title(line: NoiseLine) -> bool:
    return len(line.text) <= MAX_TITLE_CHARS and not _is_prose(line)


def _is_body_evidence(line: NoiseLine, own_level: int) -> bool:
    """본문이 이미 시작했다는 증거인가 — 본문 번호 · 장 줄머리로 시작하는 줄, 알 수 없는 이름의 제목, 번호 없이 이름만 적은 장(표의 칸도)."""
    if not line.is_body or line.noise is not None:
        return False
    if _is_named(line.text, _CHAPTER_NAME):
        return True
    if not _is_flow_text(line):
        return False
    if _has_body_number(line) or (line.number is None and _BODY_LABEL.match(line.text) is not None):
        return True
    return line.kind == "heading" and not _is_named(line.text, _HISTORY_NAME, _FRONT_HEADING_NAME)


def _is_other_language(line: NoiseLine, langs: frozenset[str]) -> bool:
    return bool(line.langs) and bool(langs) and not line.langs & langs


def _has_body_before(lines: Sequence[NoiseLine], start: int) -> bool:
    """번호 1인 줄 앞에서 이미 본문이 시작했는가 — 확실하지 않으면 참이다(앱은 먼저 지우지 않고, 사람은 "여기부터 본문"으로 한 번에 정한다).

    본문의 증거가 하나라도 있거나, 그 줄과 다른 언어의 글이 더 많거나 문장이 있거나(한/영 따로 문서의 한글 반쪽), 문장(마침표로 끝난 글)이
    많으면 — 제목 스타일 1장 앞은 개정 요약 아래를 빼고 MAX_FRONT_PROSE까지, 번호 문단 앞은 하나도 없어야 한다.
    """
    own = lines[start]
    level = _read_level(own)
    prose = same = other = 0
    in_summary = False
    for line in lines[:start]:
        if _is_body_evidence(line, level):
            return True
        if not _is_flow_text(line):
            continue
        is_known = line.kind == "heading"  # 증거가 아닌 제목은 아는 이름뿐이다
        if is_known:
            in_summary = is_history_heading(line.text)
            continue
        is_other = _is_other_language(line, own.langs)
        if is_other and _is_prose(line):
            return True
        same, other = same + (not is_other), other + is_other
        prose += _is_prose(line) and not (in_summary and _is_styled(own))
    return other > same or prose > (MAX_FRONT_PROSE if _is_styled(own) else 0)


def _opens_chapters(lines: Sequence[NoiseLine], start: int) -> bool:
    """번호 1인 줄이 장의 시작인가 — 뒤에 같은 꼴의 다음 장이 있다.

    제목 스타일이면 같은 단계의 2 이상인 장 제목이 있으면 되고(장 번호를 건너뛴 문서도 있다), 번호 문단이면 둘 다 짧은 제목 글이고 바로 다음
    번호가 "2"이며 그 사이에 글이 있어야 한다 — 절차 안 단계 목록("1. 전원을 켠다.")은 장이 아니다.
    """
    own = lines[start]
    later = [(index, line) for index, line in enumerate(lines[start + 1 :], start=start + 1) if _is_flow_text(line)]
    if _is_styled(own):
        return any(
            _is_styled(line) and _read_level(line) == _read_level(own)
            and _read_number(line).isdigit() and int(_read_number(line)) > 1
            for _, line in later
        )
    following = next(
        ((index, line) for index, line in later if not _is_styled(line) and _read_number(line).isdigit()), None
    )
    if following is None or not _is_title(own):
        return False
    index, line = following
    return _read_number(line) == "2" and _is_title(line) and index > start + 1


def find_body_starts(lines: Sequence[NoiseLine], *, separate: bool) -> list[int]:
    """본문이 시작하는 줄의 자리 — 번호가 "1"인 첫 제목이나 번호 문단(목차 줄 · 표 안 숫자는 보지 않는다). 확실하지 않으면 빈 목록(G17 · G22–G28).

    separate(한/영 따로)면 그 뒤에서 처음 나오는 다른 언어의 1장 제목이 둘째 반쪽의 시작이다.
    """
    starts = [index for index, line in enumerate(lines) if _is_chapter_one(line)]
    if not starts or _has_body_before(lines, starts[0]) or not _opens_chapters(lines, starts[0]):
        return []
    first = starts[0]
    if not separate:
        return [first]
    second = next(
        (
            index for index in starts[1:]
            if lines[index].kind == "heading" and _is_other_language(lines[index], lines[first].langs)
        ),
        None,
    )
    return [first] if second is None or not _opens_chapters(lines, second) else [first, second]


def find_half_front(
    lines: Sequence[NoiseLine], at: int, langs: frozenset[str], *, crosses_numbers: bool = False
) -> int:
    """둘째 반쪽이 시작하는 자리 — at 바로 앞으로 끊김 없이 이어진 langs · 중립 줄의 첫 글 줄(없으면 at).

    맨 앞의 중립 줄과 표 · 그림은 뺀다 — 첫 반쪽 끝의 그림 · 영어만 든 기록지 표를 먹지 않게. crosses_numbers가 아니면 본문 번호인
    줄(한글 반쪽의 영어 제목 "9. Reference")에서 멈춘다 — 그 앞은 첫 반쪽이다.
    """
    start = at
    while (
        start > 0 and lines[start - 1].is_body and lines[start - 1].langs <= langs
        and (crosses_numbers or not _has_body_number(lines[start - 1]))
    ):
        start -= 1
    while start < at and (not lines[start].langs or not lines[start].is_flow):
        start += 1
    return start


def find_second_half(lines: Sequence[NoiseLine], starts: Sequence[int]) -> int | None:
    """한/영 따로 문서에서 둘째 반쪽이 시작하는 자리 — 여기부터 본문이 첫 반쪽과 둘째 반쪽을 가를 때 쓴다. 모르면 None.

    둘째 1장을 알면 그 앞의 이어진 줄부터, 모르면 뒤쪽의 다른 언어 글이 앞쪽 언어의 글보다 가장 많이 남는 첫 줄부터다.
    """
    if len(starts) > 1:
        return find_half_front(lines, starts[1], lines[starts[1]].langs)
    texts = [(index, line) for index, line in enumerate(lines) if _is_flow_text(line) and line.langs]
    if not texts:
        return None
    head = Counter(lang for _, line in texts[: max(1, len(texts) // 3)] for lang in line.langs)
    first_langs = lines[starts[0]].langs if starts else frozenset({head.most_common(1)[0][0]})
    found: int | None = None
    score = best = 0
    for index, line in reversed(texts):
        score += 1 if _is_other_language(line, first_langs) else -1
        if score > best:
            found, best = index, score
    return found


def _list_shape(lines: Sequence[NoiseLine], begin: int, end: int) -> list[tuple[int, str]]:
    """앞부분의 꼴 — (자리, 글 · 표 · 그림 · 목차) 차례. 묶인 칸 · 캡션은 빼고 이어진 목차 줄은 하나로."""
    shape: list[tuple[int, str]] = []
    for index in range(begin, end):
        line = lines[index]
        if not line.is_body or line.group is not None or line.kind in ("cell_sentence", "caption"):
            continue
        kind = "toc" if line.noise is not None else "text" if line.kind in _START_KINDS else line.kind
        if kind == "toc" and shape and shape[-1][1] == "toc":
            continue
        shape.append((index, kind))
    return shape


def _find_second_front(lines: Sequence[NoiseLine], first: int, second: int) -> list[int]:
    """둘째 반쪽의 앞부분 — 첫 반쪽의 앞부분과 꼴이 같은 만큼만(번역이라 같은 차례로 놓인다). 꼴이 다르거나 글뿐이면 확실하지 않아 빈 목록.

    첫 반쪽 끝의 영어 약어 목록 · 참조 줄 · 기록지 표가 이어져 있어도 꼴에 들지 않아 남는다.
    """
    pattern = _list_shape(lines, 0, first)
    run = _list_shape(lines, find_half_front(lines, second, lines[second].langs), second)
    if all(kind == "text" for _, kind in pattern) or len(run) < len(pattern):
        return []
    tail = run[len(run) - len(pattern) :]
    if [kind for _, kind in tail] != [kind for _, kind in pattern]:
        return []
    begin = tail[0][0]
    if any(
        _is_flow_text(line) and line.kind == "heading" and not _is_named(line.text, _HISTORY_NAME, _FRONT_HEADING_NAME)
        for line in lines[begin:second]
    ):
        return []
    return list(range(begin, second))


def find_second_front_begin(lines: Sequence[NoiseLine], starts: Sequence[int]) -> int:
    """둘째 1장을 아는 문서에서 그 반쪽의 앞부분이 시작하는 자리 — 첫 반쪽과 같은 꼴이면 그 처음, 앞 줄이 첫 반쪽의 제목이면 그 장의 글과
    가를 수 없어 1장 자리, 아니면 이어진 줄의 처음."""
    front = _find_second_front(lines, starts[0], starts[1])
    if front:
        return front[0]
    begin = find_half_front(lines, starts[1], lines[starts[1]].langs)
    is_under_heading = begin > 0 and _is_flow_text(lines[begin - 1]) and lines[begin - 1].kind == "heading"
    return starts[1] if is_under_heading else begin


def _find_table_end(lines: Sequence[NoiseLine], at: int) -> int:
    """표 줄의 끝 자리(그 다음) — 묶인 칸의 마지막, 묶음을 모르면 이어진 칸 줄까지."""
    members = [index for index, line in enumerate(lines) if line.group == at]
    if members:
        return max(members) + 1
    end = at + 1
    while end < len(lines) and lines[end].kind == "cell_sentence" and not lines[end].is_flow:
        end += 1
    return end


def _find_history(lines: Sequence[NoiseLine], at: int, langs: frozenset[str]) -> range | None:
    """개정 이력 절 — 제목 · 짧은 글(MAX_HISTORY_INTRO) · 머리 칸이 이력인 표 하나까지. 그 꼴이 아니면 확실하지 않아 None.

    제목 · 본문 번호(이력 절의 하위 번호는 그대로) · 장 줄머리 · 첨부, 그리고 다른 언어의 글(langs — 한/영 따로 문서의 그 반쪽 언어)에서 끝난다.
    """
    number = _read_number(lines[at])
    intro = 0
    for index in range(at + 1, len(lines)):
        line = lines[index]
        if not line.is_body or line.noise is not None:
            return None
        if line.kind == "table":
            end = _find_table_end(lines, index)
            cells = [cell for cell in lines[index + 1 : end] if cell.kind == "cell_sentence"]
            return range(at, end) if any(_HISTORY_CELL.search(cell.text) for cell in cells[:3]) else None
        if line.kind == "caption":
            continue
        if not _is_flow_text(line):
            return None
        own = _read_number(line)
        is_sub = bool(number) and own.startswith(f"{number}.")
        is_end = (
            (line.kind == "heading" and not is_sub)
            or (_has_body_number(line) and not is_sub)
            or (line.number is None and _BODY_LABEL.match(line.text) is not None)
            or _ATTACHMENT_LABEL.match(line.text) is not None
            or _is_other_language(line, langs)
        )
        intro += 1
        if is_end or intro > MAX_HISTORY_INTRO:
            return None
    return None


def find_noise_lines(lines: Sequence[NoiseLine], *, separate: bool) -> dict[int, str]:
    """줄 자리 → 새로 붙일 표시(앞부분 · 개정 이력). 이미 표시가 있는 줄(목차)은 그대로 둔다. 조금이라도 확실하지 않으면 표시하지 않는다."""
    starts = find_body_starts(lines, separate=separate)
    if not starts:
        return {}
    first = starts[0]
    second = starts[1] if len(starts) > 1 else None
    front = {*range(first), *(_find_second_front(lines, first, second) if second is not None else ())}
    texts = [index for index, line in enumerate(lines) if _is_flow_text(line)]
    # 안전판 — 앞부분의 글 줄이 남는 본문보다 많으면 1장을 잘못 본 것이다
    if 2 * sum(index in front for index in texts) > len(texts):
        front = set()
    found = {index: NOISE_FRONT for index in front if lines[index].is_body and lines[index].noise is None}
    history: set[int] = set()
    for index in range(first + 1, len(lines)):
        line = lines[index]
        if index in found or index in history or not _is_flow_text(line) or line.kind != "heading" or not is_history_heading(line.text):
            continue
        langs = frozenset() if not separate else lines[second if second is not None and index >= second else first].langs
        history.update(_find_history(lines, index, langs) or ())
    if 2 * sum(index in history for index in texts) <= len(texts):
        found.update({index: NOISE_HISTORY for index in history if lines[index].noise is None})
    return found
