"""Allow target_sentences.number_style = 'bullet' (lines shown with a bullet instead of a section number).

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-17 18:00:00.000000

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0022"
down_revision: str | Sequence[str] | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CHECK = "ck_target_sentences_number_style"


def upgrade() -> None:
    """Upgrade schema."""
    # compare_metadata가 CHECK 차이를 못 잡는다 — test_migrations.test_target_number_style_check_holds_in_migrated_db가 직접 부딪쳐 본다
    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.drop_constraint(op.f(_CHECK), type_="check")
        batch_op.create_check_constraint(op.f(_CHECK), "number_style IN ('numbered', 'omitted', 'note', 'bullet')")


def downgrade() -> None:
    """Downgrade schema."""
    # 글머리 기호 줄은 번호를 받지 않던 줄이라 번호 생략으로 돌린다(좁힌 CHECK가 옛 행을 거절하지 않게)
    op.execute("UPDATE target_sentences SET number_style = 'omitted' WHERE number_style = 'bullet'")
    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.drop_constraint(op.f(_CHECK), type_="check")
        batch_op.create_check_constraint(op.f(_CHECK), "number_style IN ('numbered', 'omitted', 'note')")
