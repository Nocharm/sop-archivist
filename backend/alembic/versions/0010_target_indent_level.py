"""Add target_sentences.indent_level for section numbers by indentation in the outputs.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-10 20:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: str | Sequence[str] | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 지난 새 문장은 들여쓰기를 정한 적이 없으므로 모두 맨 바깥(0)이다
    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.add_column(sa.Column("indent_level", sa.Integer(), nullable=False, server_default=sa.text("0")))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.drop_column("indent_level")
