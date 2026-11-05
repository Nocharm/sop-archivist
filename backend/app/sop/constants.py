"""SOP 재구성의 코드 값 — DB CHECK, 검증, 화면 표시가 모두 이 튜플을 단일 소스로 쓴다."""

BUNDLE_STATUSES = ("in_progress", "in_review", "done")
MEMBER_ROLES = ("author", "reviewer")
DOC_SIDES = ("old", "new")
DOC_STATUSES = ("ready", "rejected", "failed")
LANGUAGE_LAYOUTS = ("ko_en_interleaved", "ko_en_separate", "en_only", "ko_only")
BLOCK_PARTS = ("body", "header", "footer", "footnote", "endnote", "textbox")
BLOCK_KINDS = ("paragraph", "table_cell", "figure")
UNIT_KINDS = ("sentence", "heading", "figure", "table", "table_row", "cell_sentence")
COVER_KINDS = ("sentence", "heading", "figure", "cell_sentence")
LANGS = ("ko", "en", "neutral")
DISPOSITIONS = ("unassigned", "assigned", "delete", "move_external")
STATUSES = ("unassigned", "ai_suggested", "confirmed", "on_hold")
TARGET_KINDS = ("sentence", "table", "figure")
ORIGINS = ("units", "translation", "new_doc")
CHANGE_TYPES = ("as_is", "tone", "rewritten", "split", "merged", "translated", "deleted", "new", "table_restructured")
TARGET_DOC_TYPES = ("sop", "wi")
ENTRANCES = ("assign", "match")
WI_PARTS = ("instruction", "why")
SLOT_KEYS = (
    "purpose", "scope", "definitions", "responsibilities",
    "general_requirements", "general_requirements.safety", "general_requirements.operation",
    "procedures", "procedures.procedure", "procedures.electronic_record_control",
    "procedures.troubleshooting", "procedures.maintenance",
    "document_relationships", "document_relationships.attachments", "document_relationships.appendices",
)
EQUIPMENT_SLOT_KEYS = ("procedures.electronic_record_control", "procedures.troubleshooting", "procedures.maintenance")
SEMANTIC_CHECK_KEYS = ("numbers", "conditions", "tables", "figures")
SYSTEM_HOLD_RELATED_CHANGED = "system:related_unit_changed"  # 화면은 "관련 단위가 바뀜"으로 보인다
MAX_PAIR_SIDE = 3  # 한/영 짝 한쪽 최대 단위 수(작은 다대다)
