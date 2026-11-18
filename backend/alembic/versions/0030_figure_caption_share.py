"""Add units.caption_figure_id (figures sharing one caption, F7 ⑥) and unit_edits.figure_changes (its undo record).

Revision ID: 0030
Revises: 0029
Create Date: 2026-11-19 14:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0030"
down_revision: str | Sequence[str] | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 이미 있는 그림은 묶인 적이 없다 — NULL로 둔다. 첫 그림이 지워지면 묶음만 풀린다(SET NULL)
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.add_column(sa.Column("caption_figure_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            batch_op.f("fk_units_caption_figure_id_units"), "units", ["caption_figure_id"], ["id"], ondelete="SET NULL"
        )
    # 지난 편집은 그림 묶음을 바꾸지 않았으므로 빈 객체로 채운다
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.add_column(sa.Column("figure_changes", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.drop_column("figure_changes")
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f("fk_units_caption_figure_id_units"), type_="foreignkey")
        batch_op.drop_column("caption_figure_id")
