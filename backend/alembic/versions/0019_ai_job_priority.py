"""Add ai_jobs.priority and background so the worker claims the match plan first and prepared (background) jobs last.

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-15 20:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0019"
down_revision: str | Sequence[str] | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # NOT NULL 칸을 기존 행에 더하려고 nullable로 더해 채운 뒤 NOT NULL로 바꾼다 — server_default는 두지 않는다(새 행은 앱이 늘 값을 넣는다).
    # 지난 작업은 모두 사람이 누른 요청이다(priority 1, background 아님)
    with op.batch_alter_table("ai_jobs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("priority", sa.SmallInteger(), nullable=True))
        batch_op.add_column(sa.Column("background", sa.Boolean(), nullable=True))
    op.execute("UPDATE ai_jobs SET priority = 1, background = FALSE")
    with op.batch_alter_table("ai_jobs", schema=None) as batch_op:
        batch_op.alter_column("priority", existing_type=sa.SmallInteger(), nullable=False)
        batch_op.alter_column("background", existing_type=sa.Boolean(), nullable=False)
        batch_op.drop_index("ix_ai_jobs_status_id")
        batch_op.create_index("ix_ai_jobs_status_priority_id", ["status", "priority", "id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("ai_jobs", schema=None) as batch_op:
        batch_op.drop_index("ix_ai_jobs_status_priority_id")
        batch_op.create_index("ix_ai_jobs_status_id", ["status", "id"], unique=False)
        batch_op.drop_column("background")
        batch_op.drop_column("priority")
