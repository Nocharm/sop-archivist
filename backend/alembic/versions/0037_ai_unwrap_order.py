"""Allow the unwrap_order AI job kind (suggesting the reading order of an unwrapped table).

Revision ID: 0037
Revises: 0036
Create Date: 2026-11-21 09:00:00.000000

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0037"
down_revision: str | Sequence[str] | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_KINDS = "kind IN ('classify', 'translate', 'match_plan', 'match', 'pair', 'split', 'doc_meta', 'tobe_list')"
_NEW_KINDS = (
    "kind IN ('classify', 'translate', 'match_plan', 'match', 'pair', 'split', 'doc_meta', 'tobe_list', 'unwrap_order')"
)


def upgrade() -> None:
    """Upgrade schema."""
    # compare_metadata가 CHECK 차이를 못 잡으므로 test_sop_ai_unwrap_order가 마이그레이션된 DB에 직접 부딪쳐 확인한다
    with op.batch_alter_table("ai_jobs", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_ai_jobs_kind"), type_="check")
        batch_op.create_check_constraint(op.f("ck_ai_jobs_kind"), _NEW_KINDS)


def downgrade() -> None:
    """Downgrade schema."""
    # 제안은 작업을 가리킨다(ON DELETE CASCADE) - 작업을 지우면 함께 사라진다
    op.execute("DELETE FROM ai_jobs WHERE kind = 'unwrap_order'")
    with op.batch_alter_table("ai_jobs", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_ai_jobs_kind"), type_="check")
        batch_op.create_check_constraint(op.f("ck_ai_jobs_kind"), _OLD_KINDS)
