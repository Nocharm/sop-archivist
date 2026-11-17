"""Switch the SOP outline from the 15 legacy slots to the company template (chapters 1-9) and move existing data.

Revision ID: 0024
Revises: 0023
Create Date: 2026-11-17 23:00:00.000000

"""
from collections import defaultdict
from collections.abc import Callable, Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0024"
down_revision: str | Sequence[str] | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 이행 때의 값을 얼려 둔다 — app.sop를 가져오지 않는다(표준 골격이 바뀌어도 이 리비전의 뜻은 그대로).
# 회사 SOP 템플릿 1–9장: (키, 영문 제목, 종류, 필수, 기본 번호 표시, 하위 머리말)
_TEMPLATE = (
    ("purpose", "Purpose", "general", True, "bullet", ""),
    ("scope", "Scope", "general", True, "bullet", ""),
    ("definitions", "Definitions", "general", True, "bullet", ""),
    ("responsibilities", "Responsibilities", "general", True, "bullet", ""),
    ("general_requirements", "General Requirements", "category_table", True, "bullet", ""),
    ("procedures", "Procedures", "named_children", True, "numbered", ""),
    ("document_relationships", "Document Relationships", "group", True, "bullet", ""),
    ("document_relationships.associated_documents", "Associated Documents", "group", True, "bullet", ""),
    ("document_relationships.associated_documents.form", "Form", "general", False, "bullet", ""),
    ("document_relationships.associated_documents.visual_aid", "Visual Aid", "general", False, "bullet", ""),
    ("document_relationships.associated_documents.training_material", "Training Material", "general", False, "bullet", ""),
    (
        "document_relationships.associated_documents.quality_risk_assessment", "Quality Risk Assessment", "general",
        False, "bullet", "",
    ),
    ("document_relationships.work_instructions", "Work Instructions", "auto_list", True, "bullet", ""),
    ("document_relationships.references", "References", "general", True, "bullet", ""),
    ("attachments", "Attachments", "general", True, "bullet", ""),
    ("appendices", "Appendices", "named_children", True, "numbered", "Appendix"),
)
_SUGGESTIONS = {
    "general_requirements": [
        "Safety", "Account", "Qualification", "Equipment", "Work", "Excursion/Alarm", "Material", "Training", "Record",
        "Quality", "Caution", "Data Management",
    ],
    "procedures": ["Electronic Record Control", "Troubleshooting", "Maintenance"],
}
# 옛 칸 키 → 새 자리. 여기 없는 키는 이름이 그대로다(6장에 직접 놓인 줄도 `procedures`에 머리 글로 남는다 — 번호 없음)
LEGACY_KEY_MAP = {
    "general_requirements.operation": "general_requirements.work",
    "document_relationships.attachments": "attachments",
    "document_relationships.appendices": "appendices.a1",
    "document_relationships": "document_relationships.references",
}
# N/A는 옛 7장 칸만 줄과 다르게 옮긴다 — 옛 7장의 N/A는 Attachments·Appendices까지 덮던 장 전체의 N/A였다. 새 7장(묶음 제목 — 7.1–7.3을
# 덮는다)에 그대로 두고, 같은 사유로 따로 장이 된 8·9장에도 단다(그 문서에 이미 N/A가 있는 장은 건너뛴다)
_CHAPTER_NA_KEY = "document_relationships"
_CHAPTER_NA_EXTRA_KEYS = ("attachments", "appendices")
# 문서가 쓰던 옛 하위 칸(옮긴 뒤의 키)을 그 문서의 선언 항목으로 살린다: (키, 영문 제목). 줄·칸 제목·N/A·되돌리기 기록이 가리키는 것만.
# 옛 Appendices 칸은 제목을 그대로 지닌 첫 부록이 된다(라벨 "Appendix 1. Appendices")
_DECLARED = (
    ("general_requirements.safety", "Safety"),
    ("general_requirements.work", "Work"),
    ("procedures.procedure", "Procedure"),
    ("procedures.electronic_record_control", "Electronic Record Control"),
    ("procedures.troubleshooting", "Troubleshooting"),
    ("procedures.maintenance", "Maintenance"),
    ("appendices.a1", "Appendices"),
)
_FIRST_PROCEDURE = ("procedures.p1", "Procedure 1")  # 6장에 선언 항목이 하나도 없는 문서가 받는 첫 절차
# 옮긴 칸 제목(kind='slot_heading')의 글 — 칸 제목의 글은 그 칸의 라벨이라 자리와 함께 바꾼다
_HEADING_TEXTS = {
    "general_requirements.work": "General Requirements › Work",
    "attachments": "Attachments",
    "appendices.a1": "Appendix 1. Appendices",
    "document_relationships.references": "Document Relationships › References",
}

# --- 되돌릴 때 쓰는 옛 15칸(0023이 얼려 둔 것과 같다): (키, 영문 제목, 종류) ---
_LEGACY_SLOTS = (
    ("purpose", "Purpose", "general"),
    ("scope", "Scope", "general"),
    ("definitions", "Definitions", "general"),
    ("responsibilities", "Responsibilities", "general"),
    ("general_requirements", "General Requirements", "named_children"),
    ("general_requirements.safety", "Safety", "general"),
    ("general_requirements.operation", "Operation", "general"),
    ("procedures", "Procedures", "named_children"),
    ("procedures.procedure", "Procedure", "general"),
    ("procedures.electronic_record_control", "Electronic Record Control", "general"),
    ("procedures.troubleshooting", "Troubleshooting", "general"),
    ("procedures.maintenance", "Maintenance", "general"),
    ("document_relationships", "Document Relationships", "named_children"),
    ("document_relationships.attachments", "Attachments", "general"),
    ("document_relationships.appendices", "Appendices", "general"),
)
_LEGACY_TITLES = {key: title for key, title, _ in _LEGACY_SLOTS}
# 새 키 → 옛 칸. 여기에도 옛 15칸에도 없는 키는 가장 가까운 상위에서 찾는다(_get_legacy_key)
_DOWNGRADE_KEY_MAP = {
    "general_requirements.work": "general_requirements.operation",
    "attachments": "document_relationships.attachments",
    "appendices": "document_relationships.appendices",
    "document_relationships.references": "document_relationships",
}

_target_docs = sa.table("target_docs", sa.column("id", sa.Integer), sa.column("doc_type", sa.String))
_standard = sa.table(
    "outline_standard_items",
    sa.column("key", sa.String), sa.column("order_index", sa.Integer), sa.column("title_en", sa.String),
    sa.column("title_ko", sa.String), sa.column("kind", sa.String), sa.column("is_required", sa.Boolean),
    sa.column("default_style", sa.String), sa.column("child_prefix", sa.String), sa.column("suggestions", sa.JSON),
)
_doc_items = sa.table(
    "target_doc_outline_items",
    sa.column("target_doc_id", sa.Integer), sa.column("key", sa.String), sa.column("order_index", sa.Integer),
    sa.column("title_en", sa.String), sa.column("title_ko", sa.String), sa.column("kind", sa.String),
    sa.column("is_required", sa.Boolean), sa.column("default_style", sa.String), sa.column("child_prefix", sa.String),
    sa.column("origin", sa.String), sa.column("is_removed", sa.Boolean), sa.column("deviation_reason", sa.Text),
)
_targets = sa.table(
    "target_sentences",
    sa.column("id", sa.Integer), sa.column("target_doc_id", sa.Integer), sa.column("slot_key", sa.String),
    sa.column("kind", sa.String), sa.column("number_style", sa.String), sa.column("confirmed_text", sa.Text),
)
_na_slots = sa.table(
    "target_doc_na_slots",
    sa.column("target_doc_id", sa.Integer), sa.column("slot_key", sa.String), sa.column("reason", sa.Text),
    sa.column("set_by", sa.String), sa.column("set_at", sa.DateTime(timezone=True)),
)
# slot_key가 든 JSON 열 — 판단 단계의 앞뒤 스냅숏(target_sentences 행), 판단 이력, AI 제안 내용(분류의 자리)
_JSON_COLUMNS = (
    ("decision_steps", ("before", "after")),
    ("unit_decision_history", ("snapshot",)),
    ("ai_suggestions", ("content",)),
)

KeyMapper = Callable[[str], str]
UsedKeys = dict[int, set[str]]  # 새 문서 id → 그 문서를 가리키는 칸 키(옮긴 뒤)


def _map_slot_keys(value: object, map_key: KeyMapper, used: UsedKeys) -> bool:
    """JSON 값 안의 모든 `slot_key`를 제자리에서 바꾸고 바뀌었는지 돌려준다 — 같은 dict에 target_doc_id가 있으면 그 문서가 쓰는 키로 모은다."""
    changed = False
    if isinstance(value, dict):
        slot_key = value.get("slot_key")
        if isinstance(slot_key, str):
            mapped = map_key(slot_key)
            if mapped != slot_key:
                value["slot_key"] = mapped
                changed = True
            if isinstance(value.get("target_doc_id"), int):
                used[value["target_doc_id"]].add(mapped)
        for child in value.values():
            changed |= _map_slot_keys(child, map_key, used)
    elif isinstance(value, list):
        for child in value:
            changed |= _map_slot_keys(child, map_key, used)
    return changed


def _rewrite_json(connection: sa.Connection, map_key: KeyMapper) -> UsedKeys:
    """JSON 열 안의 칸 키를 바꾼다 — 파이썬에서 읽어 고쳐 쓴다(sqlite·postgres 공통). JSON이 가리키는 (문서, 칸 키)를 돌려준다."""
    used: UsedKeys = defaultdict(set)
    for table_name, names in _JSON_COLUMNS:
        table = sa.table(table_name, sa.column("id", sa.Integer), *(sa.column(name, sa.JSON) for name in names))
        for row in connection.execute(sa.select(table)).mappings().all():
            values = {name: row[name] for name in names}
            changed = {name: value for name, value in values.items() if _map_slot_keys(value, map_key, used)}
            if changed:
                connection.execute(sa.update(table).where(table.c.id == row["id"]).values(**changed))
    return used


def _rewrite_columns(connection: sa.Connection, map_key: KeyMapper, map_na_key: KeyMapper) -> None:
    """target_sentences.slot_key(map_key)와 target_doc_na_slots.slot_key(map_na_key)를 바꾼다 — N/A는 (문서, 칸)이 키라 같은 칸으로 모이면 하나만 남긴다."""
    keys = connection.execute(sa.select(_targets.c.slot_key).where(_targets.c.slot_key.is_not(None)).distinct()).scalars()
    for key in list(keys):
        if map_key(key) != key:
            connection.execute(sa.update(_targets).where(_targets.c.slot_key == key).values(slot_key=map_key(key)))
    rows = connection.execute(sa.select(_na_slots.c.target_doc_id, _na_slots.c.slot_key)).all()
    taken = {(doc_id, key) for doc_id, key in rows if map_na_key(key) == key}
    # 한 칸으로 모일 때는 더 깊은 항목의 것이 남는다(부록 하나의 N/A가 9장 전체의 N/A보다 먼저) — 읽는 순서에 기대지 않게 줄을 세운다
    for doc_id, key in sorted(rows, key=lambda row: (row[0], -row[1].count("."), row[1])):
        mapped = map_na_key(key)
        if mapped == key:
            continue
        row = sa.and_(_na_slots.c.target_doc_id == doc_id, _na_slots.c.slot_key == key)
        if (doc_id, mapped) in taken:
            connection.execute(sa.delete(_na_slots).where(row))
        else:
            connection.execute(sa.update(_na_slots).where(row).values(slot_key=mapped))
            taken.add((doc_id, mapped))


def _spread_chapter_na(connection: sa.Connection) -> None:
    """옛 7장 전체의 N/A를 8·9장에도 단다 — 사유·표시한 사람·시각은 그대로, 그 문서의 그 장에 이미 N/A가 있으면 건너뛴다."""
    source, taken = sa.alias(_na_slots), sa.alias(_na_slots)
    for key in _CHAPTER_NA_EXTRA_KEYS:
        is_taken = sa.exists().where(taken.c.target_doc_id == source.c.target_doc_id, taken.c.slot_key == key)
        connection.execute(
            sa.insert(_na_slots).from_select(
                ["target_doc_id", "slot_key", "reason", "set_by", "set_at"],
                sa.select(source.c.target_doc_id, sa.literal(key), source.c.reason, source.c.set_by, source.c.set_at)
                .where(source.c.slot_key == _CHAPTER_NA_KEY, sa.not_(is_taken)),
            )
        )


def _fold_chapter_na(connection: sa.Connection) -> None:
    """되돌릴 때 _spread_chapter_na가 단 줄을 걷는다 — 옛 7장의 N/A와 사유가 같은 하위 칸(Attachments·Appendices)의 N/A는 7장의 것이 덮는다."""
    child, parent = _na_slots, sa.alias(_na_slots)
    is_covered = sa.exists().where(
        parent.c.target_doc_id == child.c.target_doc_id, parent.c.slot_key == _CHAPTER_NA_KEY,
        parent.c.reason == child.c.reason,
    )
    connection.execute(
        sa.delete(child).where(
            child.c.slot_key.in_(("document_relationships.attachments", "document_relationships.appendices")), is_covered
        )
    )


def _write_heading_texts(connection: sa.Connection, texts: dict[str, str]) -> None:
    for key, text in texts.items():
        connection.execute(
            sa.update(_targets)
            .where(_targets.c.kind == "slot_heading", _targets.c.slot_key == key)
            .values(confirmed_text=text)
        )


def _list_sop_doc_ids(connection: sa.Connection) -> list[int]:
    return list(
        connection.execute(
            sa.select(_target_docs.c.id).where(_target_docs.c.doc_type == "sop").order_by(_target_docs.c.id)
        ).scalars()
    )


def _collect_used_keys(connection: sa.Connection, used: UsedKeys) -> None:
    """줄·칸 제목과 N/A가 가리키는 (문서, 칸 키)를 used에 더한다."""
    for doc_id, key in connection.execute(
        sa.select(_targets.c.target_doc_id, _targets.c.slot_key).where(_targets.c.slot_key.is_not(None)).distinct()
    ):
        used[doc_id].add(key)
    for doc_id, key in connection.execute(sa.select(_na_slots.c.target_doc_id, _na_slots.c.slot_key)):
        used[doc_id].add(key)


def _build_doc_rows(doc_id: int, used_keys: set[str]) -> list[dict[str, object]]:
    """SOP 문서 하나의 새 사본 — 템플릿 줄과, 그 문서가 쓰던 옛 하위 칸의 선언 항목(6장에 하나도 없으면 첫 절차)."""
    styles = {key: style for key, _, _, _, style, _ in _TEMPLATE}
    declared = [(key, title) for key, title in _DECLARED if key in used_keys]
    if not any(key.startswith("procedures.") for key, _ in declared):
        declared.append(_FIRST_PROCEDURE)
    rows = [
        {
            "key": key, "order_index": position, "title_en": title, "kind": kind, "is_required": is_required,
            "default_style": style, "child_prefix": prefix, "origin": "standard",
        }
        for position, (key, title, kind, is_required, style, prefix) in enumerate(_TEMPLATE)
    ]
    rows += [
        # 선언 항목은 필수이고(비어도 번호를 차지한다) 기본 표시는 부모의 것이다(절차·부록은 번호, 범주는 글머리 기호)
        {
            "key": key, "order_index": position, "title_en": title, "kind": "general", "is_required": True,
            "default_style": styles[key.rpartition(".")[0]], "child_prefix": "", "origin": "declared",
        }
        for position, (key, title) in enumerate(declared)
    ]
    return [{**row, "target_doc_id": doc_id, "title_ko": "", "is_removed": False, "deviation_reason": None} for row in rows]


def upgrade() -> None:
    """Replace the standard and every SOP document's copy with the template, then move slot keys and line marks."""
    connection = op.get_bind()
    # 1. 표준을 템플릿으로 — 개발 스택에서 관리자가 고친 표준은 사라진다(운영에는 아직 없다)
    connection.execute(sa.delete(_standard))
    op.bulk_insert(_standard, [
        {
            "key": key, "order_index": position, "title_en": title, "title_ko": "", "kind": kind,
            "is_required": is_required, "default_style": style, "child_prefix": prefix,
            "suggestions": _SUGGESTIONS.get(key, []),
        }
        for position, (key, title, kind, is_required, style, prefix) in enumerate(_TEMPLATE)
    ])

    # 3. 옛 키를 새 키로 — 열과 JSON 안(되돌리기가 옛 키 자리에 줄을 되쓰지 않게). 사본을 다시 만들기 전에 해야 쓰인 키를 새 이름으로 모은다
    def map_key(key: str) -> str:
        return LEGACY_KEY_MAP.get(key, key)

    def map_na_key(key: str) -> str:
        return key if key == _CHAPTER_NA_KEY else map_key(key)

    used = _rewrite_json(connection, map_key)
    _rewrite_columns(connection, map_key, map_na_key)
    _spread_chapter_na(connection)
    _write_heading_texts(connection, _HEADING_TEXTS)
    _collect_used_keys(connection, used)

    # 2. SOP 문서마다 사본을 템플릿으로 다시 만든다
    connection.execute(sa.delete(_doc_items))
    rows = [row for doc_id in _list_sop_doc_ids(connection) for row in _build_doc_rows(doc_id, used[doc_id])]
    if rows:
        op.bulk_insert(_doc_items, rows)

    # 4. 기본 표시가 글머리 기호인 절(6장·부록 밖)로 간 번호 줄은 글머리 기호로 — 템플릿 모양에 맞춘다. 생략·주석은 그대로
    slot_key = _targets.c.slot_key
    connection.execute(
        sa.update(_targets)
        .where(
            _targets.c.number_style == "numbered", _targets.c.kind != "slot_heading", slot_key.is_not(None),
            slot_key.not_in(("procedures", "appendices")),
            sa.not_(slot_key.like("procedures.%")), sa.not_(slot_key.like("appendices.%")),
        )
        .values(number_style="bullet")
    )


def _get_legacy_key(key: str) -> str:
    """새 키 → 옛 15칸 키. 옛 칸에 없는 선언 항목은 가까운 옛 칸으로(절차는 Procedure, 부록은 Appendices, 그 밖은 상위 칸)."""
    legacy_keys = _LEGACY_TITLES.keys()
    current = key
    while current:
        if current in _DOWNGRADE_KEY_MAP:
            return _DOWNGRADE_KEY_MAP[current]
        if current in legacy_keys:
            return "procedures.procedure" if current == "procedures" and key != current else current
        current = current.rpartition(".")[0]
    return key


def downgrade() -> None:
    """Restore the 15-slot copies and move slot keys back as far as they map."""
    connection = op.get_bind()
    # 글머리 기호로 바꾼 줄은 되돌리지 않는다 — 어느 줄이 번호였는지 남아 있지 않고, 0022의 CHECK가 bullet을 받는다
    _rewrite_json(connection, _get_legacy_key)
    _rewrite_columns(connection, _get_legacy_key, _get_legacy_key)
    _fold_chapter_na(connection)
    _write_heading_texts(
        connection,
        {
            key: " › ".join(_LEGACY_TITLES[part] for part in (key.rpartition(".")[0], key) if part)
            for key in _LEGACY_TITLES
        },
    )
    connection.execute(sa.delete(_doc_items))
    rows = [
        {
            "target_doc_id": doc_id, "key": key, "order_index": position, "title_en": title, "title_ko": "",
            "kind": kind, "is_required": True, "default_style": "numbered", "child_prefix": "", "origin": "standard",
            "is_removed": False, "deviation_reason": None,
        }
        for doc_id in _list_sop_doc_ids(connection)
        for position, (key, title, kind) in enumerate(_LEGACY_SLOTS)
    ]
    if rows:
        op.bulk_insert(_doc_items, rows)
    # 표준 표는 비운다 — 0023 상태의 앱이 기동 때 옛 15칸을 시드한다
    connection.execute(sa.delete(_standard))
