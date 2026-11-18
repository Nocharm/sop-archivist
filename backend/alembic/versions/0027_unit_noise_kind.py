"""Add units.noise_kind (TOC mark) and unit_edits.noise_changes (its undo record).

Revision ID: 0027
Revises: 0025
Create Date: 2026-11-18 22:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0027"
# 같은 때 따로 만든 0026(다른 브랜치)이 먼저 합쳐지면 이 한 줄만 "0026"으로 바꾼다 — 두 리비전은 서로 다른 열을 건드린다
down_revision: str | Sequence[str] | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 이미 만든 단위는 표시 없이 둔다 — 목차 신호는 추출기 5부터 있고, 다시 올리면 새 단위가 표시를 받는다
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.add_column(sa.Column("noise_kind", sa.String(length=8), nullable=True))
    # 지난 편집은 잡음 표시를 바꾸지 않았으므로 빈 객체로 채운다
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.add_column(sa.Column("noise_changes", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.drop_column("noise_changes")
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.drop_column("noise_kind")
