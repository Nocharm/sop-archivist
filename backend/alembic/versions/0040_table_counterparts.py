"""Add table_counterparts (the Korean counterpart a person chose for an English table, NULL = none).

Revision ID: 0040
Revises: 0039
Create Date: 2026-11-26 15:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0040"
down_revision: str | Sequence[str] | None = "0039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 새 표 하나만 더한다 — 기존 행은 읽지도 바꾸지도 않는다(정한 짝이 없으면 점수로 고른다)
    op.create_table(
        "table_counterparts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("extraction_id", sa.Integer(), nullable=False),
        sa.Column("table_id", sa.Integer(), nullable=False),
        sa.Column("source_table_id", sa.Integer(), nullable=True),
        sa.Column("decided_by", sa.String(length=100), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["extraction_id"], ["extractions.id"], name=op.f("fk_table_counterparts_extraction_id_extractions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["source_table_id"], ["source_tables.id"], name=op.f("fk_table_counterparts_source_table_id_source_tables"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["table_id"], ["source_tables.id"], name=op.f("fk_table_counterparts_table_id_source_tables"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_table_counterparts")),
        sa.UniqueConstraint("table_id", name=op.f("uq_table_counterparts_table_id")),
    )
    with op.batch_alter_table("table_counterparts", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_table_counterparts_extraction_id"), ["extraction_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_table_counterparts_source_table_id"), ["source_table_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("table_counterparts", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_table_counterparts_source_table_id"))
        batch_op.drop_index(batch_op.f("ix_table_counterparts_extraction_id"))
    op.drop_table("table_counterparts")
