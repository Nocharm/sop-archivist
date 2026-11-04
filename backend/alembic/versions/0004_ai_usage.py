"""AI usage events — one metering row per in-house AI call (no prompt or reply text).

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-04 14:41:29.888420

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "ai_usage_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("login_id", sa.String(length=100), nullable=False),
        sa.Column("feature", sa.String(length=50), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_usage_events")),
    )
    with op.batch_alter_table("ai_usage_events", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_usage_events_login_id"), ["login_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_ai_usage_events_occurred_at"), ["occurred_at"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("ai_usage_events", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_ai_usage_events_occurred_at"))
        batch_op.drop_index(batch_op.f("ix_ai_usage_events_login_id"))

    op.drop_table("ai_usage_events")
