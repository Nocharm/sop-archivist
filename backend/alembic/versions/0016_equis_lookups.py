"""Add equis_lookups — EQUIS document facts cached per normalized document number (shared across bundles).

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-14 16:10:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0016'
down_revision: str | Sequence[str] | None = '0015'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('equis_lookups',
    sa.Column('doc_number', sa.String(length=100), nullable=False),
    sa.Column('state', sa.String(length=11), nullable=False),
    sa.Column('facts', sa.JSON(none_as_null=True), nullable=True),
    sa.Column('requested_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('doc_number', name=op.f('pk_equis_lookups'))
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('equis_lookups')
