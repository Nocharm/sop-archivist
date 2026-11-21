"""Add units.indent_shift (indent offset added to the computed level) and unit_edits.indent_changes (its undo record).

Revision ID: 0036
Revises: 0035
Create Date: 2026-11-21 09:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0036"
down_revision: str | Sequence[str] | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 지금까지 들여쓰기는 셈한 단계 그대로였다 — 0으로 채운다(기존 행의 값은 바꾸지 않는다)
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.add_column(sa.Column("indent_shift", sa.Integer(), nullable=False, server_default="0"))
    # 지난 편집은 들여쓰기를 바꾸지 않았으므로 빈 객체로 채운다
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.add_column(sa.Column("indent_changes", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.drop_column("indent_changes")
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.drop_column("indent_shift")
