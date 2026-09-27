"""Milestones, daily plan, habits and git corroboration.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _category_fk() -> sa.Column:
    return sa.Column(
        "category_id",
        sa.Integer(),
        sa.ForeignKey("categories.id", ondelete="CASCADE"),
        nullable=False,
    )


def upgrade() -> None:
    """Create the milestone, plan, habit and git-repo tables."""
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if "milestones" not in existing:
        op.create_table(
            "milestones",
            sa.Column("id", sa.Integer(), primary_key=True),
            _category_fk(),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("done_on", sa.String(10), nullable=True),
            sa.Column("created_at", sa.String(19), nullable=False),
            sa.Column("updated_at", sa.String(19), nullable=False),
        )
        op.create_index("ix_milestones_category_id", "milestones", ["category_id"])
        op.create_index("ix_milestones_done_on", "milestones", ["done_on"])

    if "plan_minutes" not in existing:
        op.create_table(
            "plan_minutes",
            sa.Column("plan_date", sa.String(10), primary_key=True),
            sa.Column(
                "category_id",
                sa.Integer(),
                sa.ForeignKey("categories.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("minutes", sa.Integer(), nullable=False),
            sa.CheckConstraint("minutes >= 0", name="ck_plan_minutes_nonneg"),
        )

    if "plan_tasks" not in existing:
        op.create_table(
            "plan_tasks",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("plan_date", sa.String(10), nullable=False),
            sa.Column("text", sa.String(300), nullable=False),
            sa.Column("done", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.String(19), nullable=False),
        )
        op.create_index("ix_plan_tasks_plan_date", "plan_tasks", ["plan_date"])

    if "habits" not in existing:
        op.create_table(
            "habits",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("active_days", sa.Text(), nullable=False),
            sa.Column("start_date", sa.String(10), nullable=False),
            sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("archived_at", sa.String(19), nullable=True),
            sa.Column("created_at", sa.String(19), nullable=False),
        )

    if "habit_checks" not in existing:
        op.create_table(
            "habit_checks",
            sa.Column(
                "habit_id",
                sa.Integer(),
                sa.ForeignKey("habits.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("check_date", sa.String(10), primary_key=True),
        )

    if "git_repos" not in existing:
        op.create_table(
            "git_repos",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("path", sa.Text(), nullable=False, unique=True),
            _category_fk(),
            sa.Column("created_at", sa.String(19), nullable=False),
        )
        op.create_index("ix_git_repos_category_id", "git_repos", ["category_id"])


def downgrade() -> None:
    """Drop the roadmap tables."""
    for table in (
        "git_repos",
        "habit_checks",
        "habits",
        "plan_tasks",
        "plan_minutes",
        "milestones",
    ):
        op.drop_table(table)
