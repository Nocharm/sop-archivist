"""Allow the doc_meta AI job kind (document number and version suggestions).

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-09 20:00:00.000000

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: str | Sequence[str] | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_KINDS = "kind IN ('classify', 'translate', 'match_plan', 'match', 'pair', 'split')"
_NEW_KINDS = "kind IN ('classify', 'translate', 'match_plan', 'match', 'pair', 'split', 'doc_meta')"


def upgrade() -> None:
    """Upgrade schema."""
    # compare_metadata가 CHECK 차이를 못 잡으므로 test_sop_ai_doc_meta·test_sop_ai_schema가 마이그레이션된 DB에 직접 부딪쳐 확인한다
    with op.batch_alter_table("ai_jobs", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_ai_jobs_kind"), type_="check")
        batch_op.create_check_constraint(op.f("ck_ai_jobs_kind"), _NEW_KINDS)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM ai_jobs WHERE kind = 'doc_meta'")
    with op.batch_alter_table("ai_jobs", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_ai_jobs_kind"), type_="check")
        batch_op.create_check_constraint(op.f("ck_ai_jobs_kind"), _OLD_KINDS)
