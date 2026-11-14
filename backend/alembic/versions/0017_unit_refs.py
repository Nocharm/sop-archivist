"""Add unit_refs — the human mark that a unit is (or is not) a reference line, with its document number.

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-15 09:20:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0017'
down_revision: str | Sequence[str] | None = '0016'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('unit_refs',
    sa.Column('unit_id', sa.Integer(), nullable=False),
    sa.Column('state', sa.String(length=9), nullable=False),
    sa.Column('number', sa.String(length=100), nullable=False),
    sa.Column('prev_lang', sa.String(length=7), nullable=False),
    sa.Column('decided_by', sa.String(length=100), nullable=False),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['unit_id'], ['units.id'], name=op.f('fk_unit_refs_unit_id_units'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('unit_id', name=op.f('pk_unit_refs'))
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('unit_refs')
