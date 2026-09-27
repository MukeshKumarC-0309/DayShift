"""Session change history (undo, ledger) and per-exam study targets.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-25
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add `session_changes` and `deadlines.study_target_minutes`."""
    inspector = sa.inspect(op.get_bind())
    if "session_changes" not in inspector.get_table_names():
        op.create_table(
            "session_changes",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("action", sa.String(8), nullable=False),
            sa.Column("created_at", sa.String(19), nullable=False),
            sa.Column("log_date", sa.String(10), nullable=False),
            sa.Column("category_id", sa.Integer(), nullable=False),
            sa.Column("before_json", sa.Text(), nullable=False),
            sa.Column("after_json", sa.Text(), nullable=False),
            sa.Column("minutes_before", sa.Integer(), nullable=False),
            sa.Column("minutes_after", sa.Integer(), nullable=False),
            sa.Column("undone_at", sa.String(19), nullable=True),
            sa.CheckConstraint(
                "action IN ('delete', 'edit', 'split', 'merge')", name="ck_change_action"
            ),
        )
        op.create_index("ix_session_changes_log_date", "session_changes", ["log_date"])
    columns = {c["name"] for c in inspector.get_columns("deadlines")}
    if "study_target_minutes" not in columns:
        op.add_column(
            "deadlines", sa.Column("study_target_minutes", sa.Integer(), nullable=True)
        )


def downgrade() -> None:
    """Drop both."""
    with op.batch_alter_table("deadlines") as batch:
        batch.drop_column("study_target_minutes")
    op.drop_index("ix_session_changes_log_date", table_name="session_changes")
    op.drop_table("session_changes")
