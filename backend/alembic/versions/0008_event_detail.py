"""Add bundle_events.detail for before/after values of a change.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-09 19:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 지난 사건은 바뀐 값을 모르므로 빈 객체로 채운다
    with op.batch_alter_table("bundle_events", schema=None) as batch_op:
        batch_op.add_column(sa.Column("detail", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("bundle_events", schema=None) as batch_op:
        batch_op.drop_column("detail")
