"""Widen extraction_warnings.kind to 40 characters so the missing-text cap warning fits.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-06 10:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("extraction_warnings", schema=None) as batch_op:
        batch_op.alter_column(
            "kind", existing_type=sa.String(length=20), type_=sa.String(length=40), existing_nullable=False
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("extraction_warnings", schema=None) as batch_op:
        batch_op.alter_column(
            "kind", existing_type=sa.String(length=40), type_=sa.String(length=20), existing_nullable=False
        )
