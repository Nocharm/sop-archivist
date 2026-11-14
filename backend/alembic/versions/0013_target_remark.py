"""Add target_sentences.remark so a new sentence without an old unit (an added sentence) can carry a remark too.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-13 02:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 지난 새 문장은 메모를 적은 적이 없으므로 빈 글이다
    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.add_column(sa.Column("remark", sa.Text(), nullable=False, server_default=sa.text("''")))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.drop_column("remark")
