"""Add units.unwrap_seq (order of the lines inside an unwrapped table block) and unit_edits.unwrap_seq_changes (its undo record).

Revision ID: 0034
Revises: 0033
Create Date: 2026-11-20 21:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0034"
down_revision: str | Sequence[str] | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 지금까지 벗긴 표의 줄은 모두 원문 순서였다 — NULL로 둔다
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.add_column(sa.Column("unwrap_seq", sa.Integer(), nullable=True))
    # 지난 편집은 벗긴 표 줄 순서를 바꾸지 않았으므로 빈 객체로 채운다
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.add_column(sa.Column("unwrap_seq_changes", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.drop_column("unwrap_seq_changes")
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.drop_column("unwrap_seq")
