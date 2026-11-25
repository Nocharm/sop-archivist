"""Add extractions.split_rule (which split rule built the units; existing extractions keep rule 1).

Revision ID: 0038
Revises: 0037
Create Date: 2026-11-26 09:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0038"
down_revision: str | Sequence[str] | None = "0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 지금까지의 추출은 모두 규칙 1(문장마다)로 쪼갰다 — 1로 채운다(기존 행의 다른 값은 바꾸지 않는다)
    with op.batch_alter_table("extractions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("split_rule", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("extractions", schema=None) as batch_op:
        batch_op.drop_column("split_rule")
