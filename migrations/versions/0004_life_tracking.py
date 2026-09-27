"""Life tracking: DSA problem log, daily check-ins, deadlines.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the problem, review, check-in and deadline tables."""
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if "problems" not in existing:
        op.create_table(
            "problems",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "category_id",
                sa.Integer(),
                sa.ForeignKey("categories.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("url", sa.Text(), nullable=True),
            sa.Column("topic", sa.String(48), nullable=False),
            sa.Column("difficulty", sa.String(8), nullable=False),
            sa.Column("needed_hint", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("solved_on", sa.String(10), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.String(19), nullable=False),
            sa.Column("updated_at", sa.String(19), nullable=False),
            sa.CheckConstraint(
                "difficulty IN ('easy', 'medium', 'hard')", name="ck_problem_difficulty"
            ),
        )
        op.create_index("ix_problems_category_id", "problems", ["category_id"])
        op.create_index("ix_problems_solved_on", "problems", ["solved_on"])

    if "problem_reviews" not in existing:
        op.create_table(
            "problem_reviews",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "problem_id",
                sa.Integer(),
                sa.ForeignKey("problems.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("reviewed_on", sa.String(10), nullable=False),
            sa.Column("outcome", sa.String(8), nullable=False),
            sa.Column("created_at", sa.String(19), nullable=False),
            sa.CheckConstraint(
                "outcome IN ('solid', 'shaky', 'forgot')", name="ck_review_outcome"
            ),
        )
        op.create_index(
            "ix_problem_reviews_problem_id", "problem_reviews", ["problem_id"]
        )

    if "checkins" not in existing:
        op.create_table(
            "checkins",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("check_date", sa.String(10), nullable=False, unique=True),
            sa.Column("sleep_minutes", sa.Integer(), nullable=True),
            sa.Column("energy", sa.Integer(), nullable=True),
            sa.Column("mood", sa.Integer(), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.String(19), nullable=False),
            sa.Column("updated_at", sa.String(19), nullable=False),
            sa.CheckConstraint(
                "sleep_minutes IS NULL OR (sleep_minutes >= 0 AND sleep_minutes <= 1440)",
                name="ck_checkin_sleep",
            ),
            sa.CheckConstraint(
                "energy IS NULL OR energy BETWEEN 1 AND 5", name="ck_checkin_energy"
            ),
            sa.CheckConstraint(
                "mood IS NULL OR mood BETWEEN 1 AND 5", name="ck_checkin_mood"
            ),
        )

    if "deadlines" not in existing:
        op.create_table(
            "deadlines",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("kind", sa.String(12), nullable=False),
            sa.Column("due_date", sa.String(10), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("done_at", sa.String(19), nullable=True),
            sa.Column("created_at", sa.String(19), nullable=False),
            sa.Column("updated_at", sa.String(19), nullable=False),
            sa.CheckConstraint(
                "kind IN ('exam', 'assignment', 'other')", name="ck_deadline_kind"
            ),
        )
        op.create_index("ix_deadlines_due_date", "deadlines", ["due_date"])

    if "deadline_overrides" not in existing:
        op.create_table(
            "deadline_overrides",
            sa.Column(
                "deadline_id",
                sa.Integer(),
                sa.ForeignKey("deadlines.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "category_id",
                sa.Integer(),
                sa.ForeignKey("categories.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("target_minutes", sa.Integer(), nullable=False),
            sa.CheckConstraint("target_minutes >= 0", name="ck_deadline_override_nonneg"),
        )


def downgrade() -> None:
    """Drop the life-tracking tables."""
    op.drop_table("deadline_overrides")
    op.drop_table("deadlines")
    op.drop_table("checkins")
    op.drop_table("problem_reviews")
    op.drop_table("problems")
