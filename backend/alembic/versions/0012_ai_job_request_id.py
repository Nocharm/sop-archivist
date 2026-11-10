"""Add ai_jobs.request_id so the UI can group the jobs of one request and show "n / N" progress, with the indexes the recent-jobs list polls.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-10 23:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: str | Sequence[str] | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default는 NOT NULL 칸을 기존 행에 더하려는 자리값일 뿐이라 채운 뒤 걷는다(새 행은 앱이 늘 값을 넣는다).
    # 지난 작업은 어느 요청에서 왔는지 모르니 저마다 한 요청('job-<id>')이다
    with op.batch_alter_table("ai_jobs", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("request_id", sa.String(length=32), nullable=False, server_default=sa.text("''"))
        )
    op.execute("UPDATE ai_jobs SET request_id = 'job-' || CAST(id AS VARCHAR(12)) WHERE request_id = ''")
    with op.batch_alter_table("ai_jobs", schema=None) as batch_op:
        batch_op.alter_column("request_id", existing_type=sa.String(length=32), server_default=None)
        batch_op.create_index(batch_op.f("ix_ai_jobs_request_id"), ["request_id"], unique=False)
        batch_op.create_index("ix_ai_jobs_bundle_id_finished_at", ["bundle_id", "finished_at"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("ai_jobs", schema=None) as batch_op:
        batch_op.drop_index("ix_ai_jobs_bundle_id_finished_at")
        batch_op.drop_index(batch_op.f("ix_ai_jobs_request_id"))
        batch_op.drop_column("request_id")
