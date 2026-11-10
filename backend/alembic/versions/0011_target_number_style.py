"""Add target_sentences.number_style (numbered | omitted | note) for section-number marks in the outputs.

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-10 22:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0011"
down_revision: str | Sequence[str] | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 지난 새 문장은 표시를 정한 적이 없으므로 모두 번호 줄이다. compare_metadata가 CHECK 차이를 못 잡으므로
    # test_migrations.test_target_number_style_check_holds_in_migrated_db가 마이그레이션된 DB에 직접 부딪쳐 확인한다
    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("number_style", sa.String(length=8), nullable=False, server_default=sa.text("'numbered'"))
        )
        batch_op.create_check_constraint(
            op.f("ck_target_sentences_number_style"), "number_style IN ('numbered', 'omitted', 'note')"
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_target_sentences_number_style"), type_="check")
        batch_op.drop_column("number_style")
