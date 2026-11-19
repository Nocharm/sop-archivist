"""Add the paragraph number columns on units and unit_edits.number_changes (number cell, F5).

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-18 22:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0028"
down_revision: str | Sequence[str] | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 이미 있는 단위는 번호 범위가 없다(번호가 글에 남은 채 보인다) — 채우지 않고, 다시 올린 문서부터 새 규칙을 탄다
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.add_column(sa.Column("number_read", sa.String(length=40), nullable=True))
        batch_op.add_column(sa.Column("number_source", sa.String(length=5), nullable=True))
        batch_op.add_column(sa.Column("number_len", sa.Integer(), server_default="0", nullable=False))
        batch_op.add_column(sa.Column("number_set", sa.String(length=40), nullable=True))
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.add_column(sa.Column("number_changes", sa.JSON(none_as_null=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.drop_column("number_changes")
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.drop_column("number_set")
        batch_op.drop_column("number_len")
        batch_op.drop_column("number_source")
        batch_op.drop_column("number_read")
