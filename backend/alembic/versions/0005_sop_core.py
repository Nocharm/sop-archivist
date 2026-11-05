"""SOP restructuring core: bundles, documents, extractions, units, decisions and target documents.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-05 22:09:44.904225

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 삭제 기록은 묶음이 지워져도 남아야 하므로 bundle_id에 FK가 없다
    op.create_table(
        "bundle_deletion_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("bundle_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("actor", sa.String(length=100), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bundle_deletion_records")),
    )
    op.create_table(
        "bundles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("is_synthetic", sa.Boolean(), nullable=False),
        sa.Column("semantic_checks", sa.JSON(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        # compare_metadata가 CHECK 차이를 못 잡으므로 test_sop_schema가 마이그레이션된 DB에 직접 부딪쳐 확인한다
        sa.CheckConstraint("status IN ('in_progress', 'in_review', 'done')", name=op.f("ck_bundles_status")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bundles")),
    )
    op.create_table(
        "bundle_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("bundle_id", sa.Integer(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor", sa.String(length=100), nullable=False),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("target_type", sa.String(length=30), nullable=False),
        sa.Column("target_ids", sa.JSON(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["bundle_id"], ["bundles.id"], name=op.f("fk_bundle_events_bundle_id_bundles"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bundle_events")),
    )
    with op.batch_alter_table("bundle_events", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_bundle_events_bundle_id"), ["bundle_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_bundle_events_occurred_at"), ["occurred_at"], unique=False)

    op.create_table(
        "bundle_members",
        sa.Column("bundle_id", sa.Integer(), nullable=False),
        sa.Column("login_id", sa.String(length=100), nullable=False),
        sa.Column("role", sa.String(length=10), nullable=False),
        sa.Column("added_by", sa.String(length=100), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('author', 'reviewer')", name=op.f("ck_bundle_members_role")),
        sa.ForeignKeyConstraint(
            ["bundle_id"],
            ["bundles.id"],
            name=op.f("fk_bundle_members_bundle_id_bundles"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("bundle_id", "login_id", name=op.f("pk_bundle_members")),
    )
    op.create_table(
        "target_docs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("bundle_id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=100), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("doc_type", sa.String(length=3), nullable=False),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column("entrance", sa.String(length=6), nullable=False),
        sa.Column("is_equipment_sop", sa.Boolean(), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("manual_order", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(
            ["bundle_id"], ["bundles.id"], name=op.f("fk_target_docs_bundle_id_bundles"), ondelete="CASCADE"
        ),
        # ondelete 없음(NO ACTION): RESTRICT는 즉시 검사라 묶음 CASCADE가 부모를 자식보다 먼저 지우면 실패한다
        sa.ForeignKeyConstraint(
            ["parent_id"], ["target_docs.id"], name=op.f("fk_target_docs_parent_id_target_docs")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_target_docs")),
        sa.UniqueConstraint("bundle_id", "code", name=op.f("uq_target_docs_bundle_id")),
    )
    with op.batch_alter_table("target_docs", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_target_docs_bundle_id"), ["bundle_id"], unique=False)

    op.create_table(
        "documents",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("bundle_id", sa.Integer(), nullable=False),
        sa.Column("side", sa.String(length=3), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_format", sa.String(length=4), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("doc_code", sa.String(length=100), nullable=False),
        sa.Column("doc_version", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("language_layout", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("status_reason", sa.String(length=40), nullable=False),
        sa.Column("target_doc_id", sa.Integer(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("uploaded_by", sa.String(length=100), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["bundle_id"], ["bundles.id"], name=op.f("fk_documents_bundle_id_bundles"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["target_doc_id"],
            ["target_docs.id"],
            name=op.f("fk_documents_target_doc_id_target_docs"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_documents")),
        sa.UniqueConstraint("bundle_id", "sha256", name=op.f("uq_documents_bundle_id")),
        sa.UniqueConstraint("target_doc_id", name=op.f("uq_documents_target_doc_id")),
    )
    with op.batch_alter_table("documents", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_documents_bundle_id"), ["bundle_id"], unique=False)

    op.create_table(
        "target_doc_na_slots",
        sa.Column("target_doc_id", sa.Integer(), nullable=False),
        sa.Column("slot_key", sa.String(length=100), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("set_by", sa.String(length=100), nullable=False),
        sa.Column("set_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["target_doc_id"],
            ["target_docs.id"],
            name=op.f("fk_target_doc_na_slots_target_doc_id_target_docs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("target_doc_id", "slot_key", name=op.f("pk_target_doc_na_slots")),
    )
    op.create_table(
        "wi_steps",
        sa.Column("target_doc_id", sa.Integer(), nullable=False),
        sa.Column("step_no", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.ForeignKeyConstraint(
            ["target_doc_id"],
            ["target_docs.id"],
            name=op.f("fk_wi_steps_target_doc_id_target_docs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("target_doc_id", "step_no", name=op.f("pk_wi_steps")),
    )
    op.create_table(
        "document_files",
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name=op.f("fk_document_files_document_id_documents"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("document_id", name=op.f("pk_document_files")),
    )
    op.create_table(
        "extractions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("extractor_version", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("aux_status", sa.String(length=10), nullable=False),
        sa.Column("aux_detail", sa.String(length=100), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name=op.f("fk_extractions_document_id_documents"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_extractions")),
    )
    with op.batch_alter_table("extractions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_extractions_document_id"), ["document_id"], unique=False)

    op.create_table(
        "unit_edits",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("op", sa.String(length=24), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_unit_ids", sa.JSON(), nullable=False),
        sa.Column("retired_unit_ids", sa.JSON(), nullable=False),
        sa.Column("regrouped", sa.JSON(), nullable=False),
        sa.Column("lang_changes", sa.JSON(), nullable=False),
        sa.Column("layout_changes", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(length=8), nullable=False),
        sa.Column("actor", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name=op.f("fk_unit_edits_document_id_documents"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_unit_edits")),
    )
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_unit_edits_document_id"), ["document_id"], unique=False)

    op.create_table(
        "unit_pairs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("source", sa.String(length=5), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name=op.f("fk_unit_pairs_document_id_documents"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_unit_pairs")),
    )
    with op.batch_alter_table("unit_pairs", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_unit_pairs_document_id"), ["document_id"], unique=False)

    op.create_table(
        "source_tables",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("extraction_id", sa.Integer(), nullable=False),
        sa.Column("table_index", sa.Integer(), nullable=False),
        sa.Column("parent_table_id", sa.Integer(), nullable=True),
        sa.Column("part", sa.String(length=10), nullable=False),
        sa.Column("xml_path", sa.String(length=500), nullable=False),
        sa.Column("n_rows", sa.Integer(), nullable=False),
        sa.Column("n_cols", sa.Integer(), nullable=False),
        sa.Column("is_layout", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(
            ["extraction_id"],
            ["extractions.id"],
            name=op.f("fk_source_tables_extraction_id_extractions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["parent_table_id"],
            ["source_tables.id"],
            name=op.f("fk_source_tables_parent_table_id_source_tables"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_source_tables")),
    )
    with op.batch_alter_table("source_tables", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_source_tables_extraction_id"), ["extraction_id"], unique=False)

    op.create_table(
        "source_blocks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("extraction_id", sa.Integer(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("part", sa.String(length=10), nullable=False),
        sa.Column("kind", sa.String(length=12), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("xml_path", sa.String(length=500), nullable=False),
        sa.Column("page", sa.Integer(), nullable=True),
        sa.Column("page_basis", sa.String(length=10), nullable=False),
        sa.Column("section_label", sa.String(length=200), nullable=False),
        sa.Column("heading_level", sa.Integer(), nullable=True),
        sa.Column("table_id", sa.Integer(), nullable=True),
        sa.Column("row_index", sa.Integer(), nullable=True),
        sa.Column("col_index", sa.Integer(), nullable=True),
        sa.Column("grid_span", sa.Integer(), nullable=False),
        sa.Column("row_span", sa.Integer(), nullable=False),
        sa.Column("image_part", sa.String(length=200), nullable=True),
        sa.Column("flags", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["extraction_id"],
            ["extractions.id"],
            name=op.f("fk_source_blocks_extraction_id_extractions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["table_id"],
            ["source_tables.id"],
            name=op.f("fk_source_blocks_table_id_source_tables"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_source_blocks")),
    )
    with op.batch_alter_table("source_blocks", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_source_blocks_extraction_id"), ["extraction_id"], unique=False)

    op.create_table(
        "units",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("extraction_id", sa.Integer(), nullable=False),
        sa.Column("local_no", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=14), nullable=False),
        sa.Column("spans", sa.JSON(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("lang", sa.String(length=7), nullable=False),
        sa.Column("table_id", sa.Integer(), nullable=True),
        sa.Column("row_index", sa.Integer(), nullable=True),
        sa.Column("group_unit_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=8), nullable=False),
        sa.Column("boundary_confirmed", sa.Boolean(), nullable=False),
        sa.Column("pos_seq", sa.Integer(), nullable=False),
        sa.Column("pos_start", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["extraction_id"],
            ["extractions.id"],
            name=op.f("fk_units_extraction_id_extractions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["group_unit_id"], ["units.id"], name=op.f("fk_units_group_unit_id_units"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["table_id"],
            ["source_tables.id"],
            name=op.f("fk_units_table_id_source_tables"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_units")),
    )
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_units_extraction_id"), ["extraction_id"], unique=False)

    op.create_table(
        "extraction_warnings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("extraction_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("block_id", sa.Integer(), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=False),
        sa.Column("needs_ack", sa.Boolean(), nullable=False),
        sa.Column("acked_by", sa.String(length=100), nullable=True),
        sa.Column("acked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ack_note", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["block_id"],
            ["source_blocks.id"],
            name=op.f("fk_extraction_warnings_block_id_source_blocks"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["extraction_id"],
            ["extractions.id"],
            name=op.f("fk_extraction_warnings_extraction_id_extractions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_extraction_warnings")),
    )
    with op.batch_alter_table("extraction_warnings", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_extraction_warnings_extraction_id"), ["extraction_id"], unique=False
        )

    op.create_table(
        "target_sentences",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("bundle_id", sa.Integer(), nullable=False),
        sa.Column("target_doc_id", sa.Integer(), nullable=False),
        sa.Column("slot_key", sa.String(length=100), nullable=True),
        sa.Column("wi_step", sa.Integer(), nullable=True),
        sa.Column("wi_part", sa.String(length=11), nullable=True),
        sa.Column("section_path", sa.Text(), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("lang", sa.String(length=7), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("confirmed_text", sa.Text(), nullable=False),
        sa.Column("ai_text", sa.Text(), nullable=False),
        sa.Column("change_type", sa.String(length=20), nullable=True),
        sa.Column("origin", sa.String(length=11), nullable=False),
        sa.Column("new_unit_id", sa.Integer(), nullable=True),
        sa.Column("parent_target_id", sa.Integer(), nullable=True),
        sa.Column("cell_row", sa.Integer(), nullable=True),
        sa.Column("cell_col", sa.Integer(), nullable=True),
        sa.Column("grid", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("hold_reason", sa.Text(), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("confirmed_by", sa.String(length=100), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('unassigned', 'ai_suggested', 'confirmed', 'on_hold')",
            name=op.f("ck_target_sentences_status"),
        ),
        sa.ForeignKeyConstraint(
            ["bundle_id"],
            ["bundles.id"],
            name=op.f("fk_target_sentences_bundle_id_bundles"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["new_unit_id"],
            ["units.id"],
            name=op.f("fk_target_sentences_new_unit_id_units"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["parent_target_id"],
            ["target_sentences.id"],
            name=op.f("fk_target_sentences_parent_target_id_target_sentences"),
            ondelete="CASCADE",
        ),
        # ondelete 없음(NO ACTION): RESTRICT는 즉시 검사라 묶음 CASCADE가 부모를 자식보다 먼저 지우면 실패한다
        sa.ForeignKeyConstraint(
            ["target_doc_id"], ["target_docs.id"], name=op.f("fk_target_sentences_target_doc_id_target_docs")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_target_sentences")),
    )
    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_target_sentences_bundle_id"), ["bundle_id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_target_sentences_target_doc_id"), ["target_doc_id"], unique=False
        )

    op.create_table(
        "unit_decision_history",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("unit_id", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("cause", sa.String(length=10), nullable=False),
        sa.Column("actor", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["unit_id"], ["units.id"], name=op.f("fk_unit_decision_history_unit_id_units"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_unit_decision_history")),
    )
    with op.batch_alter_table("unit_decision_history", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_unit_decision_history_unit_id"), ["unit_id"], unique=False)

    op.create_table(
        "unit_decisions",
        sa.Column("unit_id", sa.Integer(), nullable=False),
        sa.Column("bundle_id", sa.Integer(), nullable=False),
        sa.Column("disposition", sa.String(length=14), nullable=False),
        sa.Column("move_target_code", sa.String(length=100), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("hold_reason", sa.Text(), nullable=False),
        sa.Column("confirmed_by", sa.String(length=100), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('unassigned', 'ai_suggested', 'confirmed', 'on_hold')",
            name=op.f("ck_unit_decisions_status"),
        ),
        sa.ForeignKeyConstraint(
            ["bundle_id"],
            ["bundles.id"],
            name=op.f("fk_unit_decisions_bundle_id_bundles"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["unit_id"], ["units.id"], name=op.f("fk_unit_decisions_unit_id_units"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("unit_id", name=op.f("pk_unit_decisions")),
    )
    with op.batch_alter_table("unit_decisions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_unit_decisions_bundle_id"), ["bundle_id"], unique=False)

    op.create_table(
        "unit_pair_members",
        sa.Column("pair_id", sa.Integer(), nullable=False),
        sa.Column("unit_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["pair_id"],
            ["unit_pairs.id"],
            name=op.f("fk_unit_pair_members_pair_id_unit_pairs"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["unit_id"], ["units.id"], name=op.f("fk_unit_pair_members_unit_id_units"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("pair_id", "unit_id", name=op.f("pk_unit_pair_members")),
        sa.UniqueConstraint("unit_id", name=op.f("uq_unit_pair_members_unit_id")),
    )
    op.create_table(
        "target_sources",
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("unit_id", sa.Integer(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["target_id"],
            ["target_sentences.id"],
            name=op.f("fk_target_sources_target_id_target_sentences"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["unit_id"], ["units.id"], name=op.f("fk_target_sources_unit_id_units"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("target_id", "unit_id", name=op.f("pk_target_sources")),
    )
    op.create_table(
        "target_text_history",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("previous_text", sa.Text(), nullable=False),
        sa.Column("changed_by", sa.String(length=100), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["target_id"],
            ["target_sentences.id"],
            name=op.f("fk_target_text_history_target_id_target_sentences"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_target_text_history")),
    )
    with op.batch_alter_table("target_text_history", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_target_text_history_target_id"), ["target_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("target_text_history", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_target_text_history_target_id"))

    op.drop_table("target_text_history")
    op.drop_table("target_sources")
    op.drop_table("unit_pair_members")
    with op.batch_alter_table("unit_decisions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_unit_decisions_bundle_id"))

    op.drop_table("unit_decisions")
    with op.batch_alter_table("unit_decision_history", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_unit_decision_history_unit_id"))

    op.drop_table("unit_decision_history")
    with op.batch_alter_table("target_sentences", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_target_sentences_target_doc_id"))
        batch_op.drop_index(batch_op.f("ix_target_sentences_bundle_id"))

    op.drop_table("target_sentences")
    with op.batch_alter_table("extraction_warnings", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_extraction_warnings_extraction_id"))

    op.drop_table("extraction_warnings")
    with op.batch_alter_table("units", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_units_extraction_id"))

    op.drop_table("units")
    with op.batch_alter_table("source_blocks", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_source_blocks_extraction_id"))

    op.drop_table("source_blocks")
    with op.batch_alter_table("source_tables", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_source_tables_extraction_id"))

    op.drop_table("source_tables")
    with op.batch_alter_table("unit_pairs", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_unit_pairs_document_id"))

    op.drop_table("unit_pairs")
    with op.batch_alter_table("unit_edits", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_unit_edits_document_id"))

    op.drop_table("unit_edits")
    with op.batch_alter_table("extractions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_extractions_document_id"))

    op.drop_table("extractions")
    op.drop_table("document_files")
    op.drop_table("wi_steps")
    op.drop_table("target_doc_na_slots")
    with op.batch_alter_table("documents", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_documents_bundle_id"))

    op.drop_table("documents")
    with op.batch_alter_table("target_docs", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_target_docs_bundle_id"))

    op.drop_table("target_docs")
    op.drop_table("bundle_members")
    with op.batch_alter_table("bundle_events", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_bundle_events_occurred_at"))
        batch_op.drop_index(batch_op.f("ix_bundle_events_bundle_id"))

    op.drop_table("bundle_events")
    op.drop_table("bundles")
    op.drop_table("bundle_deletion_records")
