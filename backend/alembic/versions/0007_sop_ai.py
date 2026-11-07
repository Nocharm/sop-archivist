"""SOP AI layer: guideline versions, AI jobs and suggestions, embedding cache, and suggestion links on decisions.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-07 10:50:46.927580

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "embedding_cache",
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("text_hash", sa.String(length=64), nullable=False),
        sa.Column("dim", sa.Integer(), nullable=False),
        sa.Column("vector", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("model", "text_hash", name=op.f("pk_embedding_cache")),
    )
    op.create_table(
        "guideline_versions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("key", sa.String(length=40), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("activated_by", sa.String(length=100), nullable=True),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_guideline_versions")),
        sa.UniqueConstraint("key", "version", name=op.f("uq_guideline_versions_key")),
    )
    with op.batch_alter_table("guideline_versions", schema=None) as batch_op:
        # 활성 행만 키당 하나 — sqlite와 Postgres가 각자 방언 인자로 부분 인덱스를 만든다
        batch_op.create_index(
            "uq_guideline_active",
            ["key"],
            unique=True,
            sqlite_where=sa.text("is_active"),
            postgresql_where=sa.text("is_active"),
        )

    op.create_table(
        "ai_jobs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("bundle_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=12), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=True),
        sa.Column("unit_ids", sa.JSON(), nullable=False),
        sa.Column("target_ids", sa.JSON(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("input_snapshot", sa.JSON(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(length=40), nullable=False),
        sa.Column("requested_by", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        # compare_metadata가 CHECK 차이를 못 잡으므로 test_sop_ai_schema가 마이그레이션된 DB에 직접 부딪쳐 확인한다
        sa.CheckConstraint(
            "kind IN ('classify', 'translate', 'match_plan', 'match', 'pair', 'split')",
            name=op.f("ck_ai_jobs_kind"),
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed', 'stale', 'cancelled')",
            name=op.f("ck_ai_jobs_status"),
        ),
        sa.ForeignKeyConstraint(
            ["bundle_id"], ["bundles.id"], name=op.f("fk_ai_jobs_bundle_id_bundles"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["document_id"], ["documents.id"], name=op.f("fk_ai_jobs_document_id_documents"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_jobs")),
    )
    with op.batch_alter_table("ai_jobs", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_jobs_bundle_id"), ["bundle_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_ai_jobs_document_id"), ["document_id"], unique=False)
        batch_op.create_index("ix_ai_jobs_status_id", ["status", "id"], unique=False)

    # ai_suggestions를 판단·새 문장·짝의 suggestion_id FK보다 먼저 만든다
    op.create_table(
        "ai_suggestions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=False),
        sa.Column("bundle_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=12), nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=True),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("result", sa.String(length=8), nullable=False),
        sa.Column("input_refs", sa.JSON(), nullable=False),
        sa.Column("guideline_versions", sa.JSON(), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("adoption", sa.String(length=8), nullable=True),
        sa.Column("adopted_by", sa.String(length=100), nullable=True),
        sa.Column("adopted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("adoption IN ('as_is', 'edited', 'rejected')", name=op.f("ck_ai_suggestions_adoption")),
        sa.CheckConstraint("result IN ('applied', 'stale', 'invalid')", name=op.f("ck_ai_suggestions_result")),
        sa.ForeignKeyConstraint(
            ["bundle_id"], ["bundles.id"], name=op.f("fk_ai_suggestions_bundle_id_bundles"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name=op.f("fk_ai_suggestions_document_id_documents"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], ["ai_jobs.id"], name=op.f("fk_ai_suggestions_job_id_ai_jobs"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_suggestions")),
    )
    with op.batch_alter_table("ai_suggestions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_suggestions_bundle_id"), ["bundle_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_ai_suggestions_document_id"), ["document_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_ai_suggestions_job_id"), ["job_id"], unique=False)

    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.add_column(sa.Column("translation_source_unit_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("suggestion_id", sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f("ix_target_sentences_suggestion_id"), ["suggestion_id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_target_sentences_translation_source_unit_id"), ["translation_source_unit_id"], unique=False
        )
        batch_op.create_foreign_key(
            batch_op.f("fk_target_sentences_suggestion_id_ai_suggestions"),
            "ai_suggestions",
            ["suggestion_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            batch_op.f("fk_target_sentences_translation_source_unit_id_units"),
            "units",
            ["translation_source_unit_id"],
            ["id"],
            ondelete="CASCADE",
        )

    with op.batch_alter_table("unit_decisions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("suggestion_id", sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f("ix_unit_decisions_suggestion_id"), ["suggestion_id"], unique=False)
        batch_op.create_foreign_key(
            batch_op.f("fk_unit_decisions_suggestion_id_ai_suggestions"),
            "ai_suggestions",
            ["suggestion_id"],
            ["id"],
            ondelete="SET NULL",
        )

    with op.batch_alter_table("unit_pairs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("suggestion_id", sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f("ix_unit_pairs_suggestion_id"), ["suggestion_id"], unique=False)
        batch_op.create_foreign_key(
            batch_op.f("fk_unit_pairs_suggestion_id_ai_suggestions"),
            "ai_suggestions",
            ["suggestion_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("unit_pairs", schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f("fk_unit_pairs_suggestion_id_ai_suggestions"), type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_unit_pairs_suggestion_id"))
        batch_op.drop_column("suggestion_id")

    with op.batch_alter_table("unit_decisions", schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f("fk_unit_decisions_suggestion_id_ai_suggestions"), type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_unit_decisions_suggestion_id"))
        batch_op.drop_column("suggestion_id")

    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.drop_constraint(
            batch_op.f("fk_target_sentences_translation_source_unit_id_units"), type_="foreignkey"
        )
        batch_op.drop_constraint(batch_op.f("fk_target_sentences_suggestion_id_ai_suggestions"), type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_target_sentences_translation_source_unit_id"))
        batch_op.drop_index(batch_op.f("ix_target_sentences_suggestion_id"))
        batch_op.drop_column("suggestion_id")
        batch_op.drop_column("translation_source_unit_id")

    with op.batch_alter_table("ai_suggestions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_ai_suggestions_job_id"))
        batch_op.drop_index(batch_op.f("ix_ai_suggestions_document_id"))
        batch_op.drop_index(batch_op.f("ix_ai_suggestions_bundle_id"))

    op.drop_table("ai_suggestions")
    with op.batch_alter_table("ai_jobs", schema=None) as batch_op:
        batch_op.drop_index("ix_ai_jobs_status_id")
        batch_op.drop_index(batch_op.f("ix_ai_jobs_document_id"))
        batch_op.drop_index(batch_op.f("ix_ai_jobs_bundle_id"))

    op.drop_table("ai_jobs")
    with op.batch_alter_table("guideline_versions", schema=None) as batch_op:
        batch_op.drop_index("uq_guideline_active")

    op.drop_table("guideline_versions")
    op.drop_table("embedding_cache")
