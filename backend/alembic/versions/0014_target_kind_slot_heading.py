"""Widen target_sentences.kind to 12 characters so it can hold slot_heading (an old heading linked to a new SOP section heading).

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-13 11:20:57.702114

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # kind에는 CHECK가 없다 — 길이만 넓힌다(8자면 Postgres가 slot_heading을 거절한다)
    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.alter_column(
            "kind", existing_type=sa.VARCHAR(length=8), type_=sa.String(length=12), existing_nullable=False
        )


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres에서는 slot_heading 행이 남아 있으면 줄일 수 없다 — 0013 코드는 칸 제목을 모르므로 먼저 지운 뒤 내린다
    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.alter_column(
            "kind", existing_type=sa.String(length=12), type_=sa.VARCHAR(length=8), existing_nullable=False
        )
