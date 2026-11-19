"""SOP 재구성의 코드 값 — DB CHECK, 검증, 화면 표시가 모두 이 튜플을 단일 소스로 쓴다."""

from typing import Literal, get_args

BUNDLE_STATUSES = ("in_progress", "in_review", "done")
MEMBER_ROLES = ("author", "reviewer")
DOC_SIDES = ("old", "new")
DOC_STATUSES = ("ready", "rejected", "failed")
LANGUAGE_LAYOUTS = ("ko_en_interleaved", "ko_en_separate", "en_only", "ko_only")
BLOCK_PARTS = ("body", "header", "footer", "footnote", "endnote", "textbox")
BLOCK_KINDS = ("paragraph", "table_cell", "figure")
UNIT_KINDS = ("sentence", "heading", "figure", "table", "cell_sentence", "caption")
COVER_KINDS = ("sentence", "heading", "figure", "cell_sentence", "caption")
LANGS = ("ko", "en", "neutral")
DISPOSITIONS = ("unassigned", "assigned", "delete", "move_external")
STATUSES = ("unassigned", "ai_suggested", "confirmed", "on_hold")
TARGET_KINDS = ("sentence", "table", "figure", "slot_heading")
# 새 SOP 칸 제목에 이은 옛 제목(제품 명세 §7.13 칸 제목) — 칸·언어마다 하나, 글은 칸 이름, 번호를 세지 않고 다른 문서의 같은 제목은 출처만 더한다
SLOT_HEADING = "slot_heading"
ORIGINS = ("units", "translation", "new_doc")
# 글자 비교 종류는 그대로·고침 둘이고 서버가 글·표 모양으로 정한다(설계 2026-11-20-change-type-two D1·D2). 나머지는 구조에서 나온다
CHANGE_TYPES = ("as_is", "rewritten", "split", "merged", "translated", "deleted", "new", "heading")
TARGET_DOC_TYPES = ("sop", "wi")
ENTRANCES = ("assign", "match")
WI_PARTS = ("instruction", "why")
# SOP 골격 항목의 종류 — 직접 줄을 받는지·세는지·하위를 두는지를 가른다(outline.DocOutline이 읽는다)
OutlineKind = Literal["general", "category_table", "named_children", "auto_list", "group"]
OUTLINE_KINDS: tuple[OutlineKind, ...] = get_args(OutlineKind)
OutlineOrigin = Literal["standard", "declared", "custom"]  # 문서 사본 항목이 온 곳: 표준에서 복사 | 문서가 선언 | 사용자 항목
OUTLINE_ORIGINS: tuple[OutlineOrigin, ...] = get_args(OutlineOrigin)
SEMANTIC_CHECK_KEYS = ("numbers", "conditions", "tables", "figures")
SYSTEM_HOLD_RELATED_CHANGED = "system:related_unit_changed"  # 화면은 "관련 단위가 바뀜"으로 보인다
MAX_PAIR_SIDE = 3  # 한/영 짝 한쪽 최대 단위 수(작은 다대다)
# 새 문장 들여쓰기 최대 깊이 — 9면 칸 번호 아래로 열 단계(6.1.1 … 6.1.1.1.1.1.1.1.1.1)까지. 순서 바꾸기 입력의 상한이다
MAX_INDENT_LEVEL = 9
# 글머리 기호 줄의 깊이는 0~2 세 단계(• ○ ▪)다. 저장 상한(MAX_INDENT_LEVEL)과 따로 읽을 때 눌러 읽는다 — 번호 줄과 따로 세어
# 앞 글머리 기호 줄 깊이 + 1을 넘지 못한다(outputs.get_bullet_depths). 프런트 section-number.ts MAX_BULLET_LEVEL·BULLET_SYMBOLS와 같은 값
MAX_BULLET_LEVEL = 2
BULLET_SYMBOLS = ("•", "○", "▪")
# 새 문장 번호 표시 — 번호(기본) | 번호 생략 | 주석(번호 없이 기울임) | 글머리 기호. 번호가 아닌 줄은 번호를 받지 않고 다음 번호 줄이 이어 센다.
# 글머리 기호 줄은 결과물 A·Excel의 No.에 그 절(번호 없는 범주면 가장 가까운 번호 있는 상위 절)의 번호를 적는다(outputs.number_bullets).
# 값은 8자까지다(target_sentences.number_style). SOP 줄의 기본값은 놓인 골격 항목의 default_style이다(target_placement)
NumberStyle = Literal["numbered", "omitted", "note", "bullet"]
NUMBER_STYLES: tuple[NumberStyle, ...] = get_args(NumberStyle)
NUMBERED, NUMBER_OMITTED, NUMBER_NOTE, NUMBER_BULLET = NUMBER_STYLES

# --- AI 층(계획 2) ---
AI_JOB_KINDS = ("classify", "translate", "match_plan", "match", "pair", "split", "doc_meta", "tobe_list")
AI_JOB_STATUSES = ("queued", "running", "done", "failed", "stale", "cancelled")
AI_SUGGESTION_RESULTS = ("applied", "stale", "invalid")  # 적용됨 | 낡아서 안 씀 | 응답이 규칙 위반
# 작업 순위 — 작은 수가 먼저 나간다. 같은 순위 안에서는 id 순
AI_PRIORITY_PLAN = 0  # 짝 맞추기 계획(입구 2) — 뒤 작업을 쌓는 앞잡이라 맨 앞
AI_PRIORITY_USER = 1  # 사람이 누른 요청
AI_PRIORITY_PRE_CLASSIFY = 2  # 미리 돌리기: 분류
AI_PRIORITY_PRE_REFINE = 3  # 미리 돌리기: 고쳐 쓰기
AI_ADOPTIONS = ("as_is", "edited", "rejected")  # 사람의 결과: 그대로 채택 | 고쳐서 채택 | 버림
GUIDELINE_KEYS = (
    "rules", "prompt.classify", "prompt.translate", "prompt.match", "prompt.split", "prompt.doc_meta", "prompt.tobe_list",
)
SYSTEM_HOLD_AI_INVALID = "system:ai_invalid_response"  # AI 응답이 규칙을 어겨 보류된 행 — 화면은 "AI 응답 무효"로 보인다
