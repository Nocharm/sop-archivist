"""Add units.pair_seq (order of the boxes inside a KO/EN pair card) and unit_edits.pair_seq_changes (its undo record).

Revision ID: 0033
Revises: 0032
Create Date: 2026-11-20 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0033"
down_revision: str | Sequence[str] | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 지금까지의 짝 카드는 모두 원문 순서였다 — NULL로 둔다
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.add_column(sa.Column("pair_seq", sa.Integer(), nullable=True))
    # 지난 편집은 카드 안 순서를 바꾸지 않았으므로 빈 객체로 채운다
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.add_column(sa.Column("pair_seq_changes", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.drop_column("pair_seq_changes")
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.drop_column("pair_seq")
