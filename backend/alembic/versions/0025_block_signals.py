"""Add source_blocks.signals and source_tables.signals (structure signals the extractor reads from version 5 on).

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-18 20:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0025"
down_revision: str | Sequence[str] | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 옛 추출(추출기 4까지)에는 신호가 없다 — NULL로 두고 채우지 않는다(다시 올리면 새 추출이 신호를 싣는다)
    with op.batch_alter_table("source_blocks", schema=None) as batch_op:
        batch_op.add_column(sa.Column("signals", sa.JSON(none_as_null=True), nullable=True))
    with op.batch_alter_table("source_tables", schema=None) as batch_op:
        batch_op.add_column(sa.Column("signals", sa.JSON(none_as_null=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("source_tables", schema=None) as batch_op:
        batch_op.drop_column("signals")
    with op.batch_alter_table("source_blocks", schema=None) as batch_op:
        batch_op.drop_column("signals")
