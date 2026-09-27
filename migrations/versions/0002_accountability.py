"""Batch 5: weekly reviews, commitments, and precise override timing.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the accountability tables and the override timestamp."""
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())

    if "weekly_reviews" not in existing:
        op.create_table(
            "weekly_reviews",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("week_start", sa.String(10), nullable=False, unique=True),
            sa.Column("reflection", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.String(19), nullable=False),
            sa.Column("updated_at", sa.String(19), nullable=False),
        )

    if "commitments" not in existing:
        op.create_table(
            "commitments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("week_start", sa.String(10), nullable=False),
            sa.Column(
                "category_id",
                sa.Integer(),
                sa.ForeignKey("categories.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("minutes", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.String(19), nullable=False),
            sa.Column("updated_at", sa.String(19), nullable=False),
            sa.UniqueConstraint(
                "week_start", "category_id", name="uq_commitment_week_category"
            ),
            sa.CheckConstraint("minutes >= 0", name="ck_commitment_minutes_nonneg"),
        )
        op.create_index("ix_commitments_week_start", "commitments", ["week_start"])
        op.create_index("ix_commitments_category_id", "commitments", ["category_id"])

    columns = {c["name"] for c in sa.inspect(bind).get_columns("daily_logs")}
    if "override_set_at" not in columns:
        op.add_column(
            "daily_logs", sa.Column("override_set_at", sa.String(19), nullable=True)
        )
        # Backfill existing overrides with `updated_at`. It is the best signal
        # available for rows written before this column existed — approximate,
        # but never wrong in the direction of hiding a retroactive change.
        op.execute(
            sa.text(
                "UPDATE daily_logs SET override_set_at = updated_at "
                "WHERE override_target_minutes IS NOT NULL "
                "AND override_set_at IS NULL"
            )
        )


def downgrade() -> None:
    """Drop the accountability tables."""
    op.drop_table("commitments")
    op.drop_table("weekly_reviews")
    with op.batch_alter_table("daily_logs") as batch:
        batch.drop_column("override_set_at")
