"""Add units.noise_reason (written reason of an automatically deleted line) and unit_edits.noise_reason_changes (its undo record).

Revision ID: 0039
Revises: 0038
Create Date: 2026-11-26 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0039"
down_revision: str | Sequence[str] | None = "0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 지금까지의 목차 줄에는 적은 사유가 없었다 — 빈 글(정한 문구)로 채운다(기존 행의 다른 값은 바꾸지 않는다)
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.add_column(sa.Column("noise_reason", sa.Text(), nullable=False, server_default=""))
    # 지난 편집은 사유를 바꾸지 않았으므로 빈 객체로 채운다
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("noise_reason_changes", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.drop_column("noise_reason_changes")
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.drop_column("noise_reason")
