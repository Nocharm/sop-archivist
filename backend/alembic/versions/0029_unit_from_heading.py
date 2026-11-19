"""Add units.from_heading — a sentence unit that was a heading-styled clause line (heading to sentence, F8b).

Revision ID: 0029
Revises: 0028
Create Date: 2026-11-19 10:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0029"
down_revision: str | Sequence[str] | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 이미 있는 단위는 바꾼 적이 없다 — 거짓으로 채운다. 기본값을 두어 앱 밖 INSERT(시험의 옛 리비전 자료)도 그대로 들어간다
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.add_column(sa.Column("from_heading", sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.drop_column("from_heading")
