"""Employee directory, department mirror, HR sync history and batch job run tables.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-04 13:44:19.288262

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "batch_job_runs",
        sa.Column("job", sa.String(length=40), nullable=False),
        sa.Column("outcome", sa.String(length=10), nullable=False),
        sa.Column("ran_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("job", "outcome", name=op.f("pk_batch_job_runs")),
    )
    op.create_table(
        "departments",
        sa.Column("dept_code", sa.String(length=100), nullable=False),
        sa.Column("parent_dept_code", sa.String(length=100), nullable=True),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("name_ko", sa.String(length=300), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("dept_code", name=op.f("pk_departments")),
    )
    op.create_table(
        "employees",
        sa.Column("login_id", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column("org_l1", sa.String(length=200), nullable=True),
        sa.Column("org_l2", sa.String(length=200), nullable=True),
        sa.Column("org_l3", sa.String(length=200), nullable=True),
        sa.Column("org_l4", sa.String(length=200), nullable=True),
        sa.Column("org_l5", sa.String(length=200), nullable=True),
        sa.Column("department", sa.String(length=200), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("dept_code", sa.String(length=100), nullable=True),
        sa.Column("korean_name", sa.String(length=200), nullable=False),
        sa.Column("korean_dept", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("login_id", name=op.f("pk_employees")),
    )
    op.create_table(
        "hr_sync_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ran_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("outcome", sa.String(length=10), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("scanned", sa.Integer(), nullable=False),
        sa.Column("created", sa.Integer(), nullable=False),
        sa.Column("deactivated", sa.Integer(), nullable=False),
        sa.Column("reactivated", sa.Integer(), nullable=False),
        sa.Column("deleted", sa.Integer(), nullable=False),
        sa.Column("skipped", sa.Integer(), nullable=False),
        sa.Column("duplicates", sa.Integer(), nullable=False),
        sa.Column("managed", sa.Integer(), nullable=False),
        sa.Column("mass_departure", sa.Boolean(), nullable=False),
        sa.Column("changes", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hr_sync_runs")),
    )
    with op.batch_alter_table("hr_sync_runs", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_hr_sync_runs_ran_at"), ["ran_at"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("hr_sync_runs", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_hr_sync_runs_ran_at"))

    op.drop_table("hr_sync_runs")
    op.drop_table("employees")
    op.drop_table("departments")
    op.drop_table("batch_job_runs")
