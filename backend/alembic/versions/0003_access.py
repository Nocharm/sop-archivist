"""Table-based permissions (roles, role permissions, grants, audit) and daily login records.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-04 14:04:31.300304

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "access_audit_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor", sa.String(length=100), nullable=False),
        sa.Column("action", sa.String(length=30), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_access_audit_events")),
    )
    with op.batch_alter_table("access_audit_events", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_access_audit_events_occurred_at"), ["occurred_at"], unique=False)

    op.create_table(
        "login_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("login_id", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_login_records")),
    )
    with op.batch_alter_table("login_records", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_login_records_login_id"), ["login_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_login_records_occurred_at"), ["occurred_at"], unique=False)

    op.create_table(
        "roles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_roles")),
        sa.UniqueConstraint("name", name=op.f("uq_roles_name")),
    )
    op.create_table(
        "access_grants",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("subject_type", sa.String(length=10), nullable=False),
        sa.Column("subject_id", sa.String(length=100), nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=True),
        sa.Column("permission", sa.String(length=100), nullable=True),
        sa.Column("created_by", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        # 역할·권한 중 정확히 하나 — compare_metadata가 CHECK 차이를 못 잡으므로 test_migrations가 DB에 직접 확인한다
        sa.CheckConstraint(
            "(role_id IS NOT NULL AND permission IS NULL) OR (role_id IS NULL AND permission IS NOT NULL)",
            name=op.f("ck_access_grants_role_xor_permission"),
        ),
        sa.ForeignKeyConstraint(
            ["role_id"], ["roles.id"], name=op.f("fk_access_grants_role_id_roles"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_access_grants")),
    )
    op.create_table(
        "role_permissions",
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("permission", sa.String(length=100), nullable=False),
        sa.ForeignKeyConstraint(
            ["role_id"], ["roles.id"], name=op.f("fk_role_permissions_role_id_roles"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("role_id", "permission", name=op.f("pk_role_permissions")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("role_permissions")
    op.drop_table("access_grants")
    op.drop_table("roles")
    with op.batch_alter_table("login_records", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_login_records_occurred_at"))
        batch_op.drop_index(batch_op.f("ix_login_records_login_id"))

    op.drop_table("login_records")
    with op.batch_alter_table("access_audit_events", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_access_audit_events_occurred_at"))

    op.drop_table("access_audit_events")
