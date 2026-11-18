"""Add the SOP outline tables (standard + per-document copy) and give every existing SOP document a copy of the 15 slots.

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-17 21:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0023"
down_revision: str | Sequence[str] | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 이행 때의 값을 얼려 둔다 — app.sop를 가져오지 않는다(표준 골격이 바뀌어도 이 리비전의 뜻은 그대로).
# 그때까지 코드에 고정돼 있던 15칸: (키, 영문 제목, 종류). 하위 칸이 있는 칸(5·6·7)은 직접 줄을 받되 세지 않는 named_children
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
_KIND_CHECK = "kind IN ('general', 'category_table', 'named_children', 'auto_list', 'group')"
_STYLE_CHECK = "default_style IN ('numbered', 'omitted', 'note', 'bullet')"

_target_docs = sa.table("target_docs", sa.column("id", sa.Integer), sa.column("doc_type", sa.String))
_doc_items = sa.table(
    "target_doc_outline_items",
    sa.column("target_doc_id", sa.Integer), sa.column("key", sa.String), sa.column("order_index", sa.Integer),
    sa.column("title_en", sa.String), sa.column("title_ko", sa.String), sa.column("kind", sa.String),
    sa.column("is_required", sa.Boolean), sa.column("default_style", sa.String), sa.column("child_prefix", sa.String),
    sa.column("origin", sa.String), sa.column("is_removed", sa.Boolean), sa.column("deviation_reason", sa.Text),
)


def upgrade() -> None:
    """Upgrade schema, then copy the 15 slots to each existing SOP document."""
    # compare_metadata가 CHECK 차이를 못 잡는다 — test_migrations.test_outline_checks_hold_in_migrated_db가 직접 부딪쳐 본다
    op.create_table(
        "outline_standard_items",
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("title_en", sa.String(length=200), nullable=False),
        sa.Column("title_ko", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("is_required", sa.Boolean(), nullable=False),
        sa.Column("default_style", sa.String(length=8), nullable=False),
        sa.Column("child_prefix", sa.String(length=40), nullable=False),
        sa.Column("suggestions", sa.JSON(), nullable=False),
        sa.CheckConstraint(_KIND_CHECK, name=op.f("ck_outline_standard_items_kind")),
        sa.CheckConstraint(_STYLE_CHECK, name=op.f("ck_outline_standard_items_default_style")),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_outline_standard_items")),
    )
    op.create_table(
        "target_doc_outline_items",
        sa.Column("target_doc_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("title_en", sa.String(length=200), nullable=False),
        sa.Column("title_ko", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("is_required", sa.Boolean(), nullable=False),
        sa.Column("default_style", sa.String(length=8), nullable=False),
        sa.Column("child_prefix", sa.String(length=40), nullable=False),
        sa.Column("origin", sa.String(length=8), nullable=False),
        sa.Column("is_removed", sa.Boolean(), nullable=False),
        sa.Column("deviation_reason", sa.Text(), nullable=True),
        sa.CheckConstraint(_KIND_CHECK, name=op.f("ck_target_doc_outline_items_kind")),
        sa.CheckConstraint(_STYLE_CHECK, name=op.f("ck_target_doc_outline_items_default_style")),
        sa.CheckConstraint(
            "origin IN ('standard', 'declared', 'custom')", name=op.f("ck_target_doc_outline_items_origin")
        ),
        sa.ForeignKeyConstraint(
            ["target_doc_id"], ["target_docs.id"], name=op.f("fk_target_doc_outline_items_target_doc_id_target_docs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("target_doc_id", "key", name=op.f("pk_target_doc_outline_items")),
    )

    # 표준 표는 비워 둔다 — 앱이 기동 때 시드한다(outline.seed_outline_standard). 여기서는 이미 있는 SOP 문서의 사본만 채운다
    connection = op.get_bind()
    doc_ids = connection.execute(
        sa.select(_target_docs.c.id).where(_target_docs.c.doc_type == "sop").order_by(_target_docs.c.id)
    ).scalars().all()
    rows = [
        {
            "target_doc_id": doc_id, "key": key, "order_index": position, "title_en": title, "title_ko": "",
            "kind": kind, "is_required": True, "default_style": "numbered", "child_prefix": "", "origin": "standard",
            "is_removed": False, "deviation_reason": None,
        }
        for doc_id in doc_ids
        for position, (key, title, kind) in enumerate(_LEGACY_SLOTS)
    ]
    if rows:
        op.bulk_insert(_doc_items, rows)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("target_doc_outline_items")
    op.drop_table("outline_standard_items")
