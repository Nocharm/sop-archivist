"""Add decision_steps — per screen-session undo/redo steps for Assign (changed-row snapshots or a pointer to a Split edit).

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-13 16:53:14.547208

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0014'
down_revision: str | Sequence[str] | None = '0013'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('decision_steps',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('bundle_id', sa.Integer(), nullable=False),
    sa.Column('actor', sa.String(length=100), nullable=False),
    sa.Column('session_key', sa.String(length=64), nullable=False),
    sa.Column('seq', sa.Integer(), nullable=False),
    sa.Column('op', sa.String(length=24), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('state', sa.String(length=8), nullable=False),
    sa.Column('step_key', sa.String(length=64), nullable=True),
    sa.Column('focus', sa.JSON(), nullable=False),
    sa.Column('unit_ids', sa.JSON(), nullable=False),
    sa.Column('scope_label', sa.String(length=200), nullable=True),
    sa.Column('before', sa.JSON(), nullable=False),
    sa.Column('after', sa.JSON(), nullable=False),
    sa.Column('document_id', sa.Integer(), nullable=True),
    sa.Column('unit_edit_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['bundle_id'], ['bundles.id'], name=op.f('fk_decision_steps_bundle_id_bundles'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], name=op.f('fk_decision_steps_document_id_documents'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['unit_edit_id'], ['unit_edits.id'], name=op.f('fk_decision_steps_unit_edit_id_unit_edits'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_decision_steps'))
    )
    with op.batch_alter_table('decision_steps', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_decision_steps_document_id'), ['document_id'], unique=False)
        batch_op.create_index('ix_decision_steps_session', ['bundle_id', 'actor', 'session_key', 'seq'], unique=False)
        batch_op.create_index(batch_op.f('ix_decision_steps_unit_edit_id'), ['unit_edit_id'], unique=False)



def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('decision_steps', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_decision_steps_unit_edit_id'))
        batch_op.drop_index('ix_decision_steps_session')
        batch_op.drop_index(batch_op.f('ix_decision_steps_document_id'))

    op.drop_table('decision_steps')
