"""Domains and question-based targets.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-24

Adds three columns:

* ``categories.group_name`` — the domain a category is shown under. Existing
  categories are the original project work, so they are backfilled to
  "Projects". The new daily categories are seeded as "Daily" by the app.
* ``category_targets.question_target`` — an optional second finish line in
  questions solved (DSA: 2 questions or 120 minutes, whichever comes first).
* ``daily_logs.questions_solved`` — the count, stored raw.

The three new categories themselves are created by the normal seeding step,
which runs after migrations and matches on name, so an existing database picks
them up on its next start without this migration writing any rows.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Add the domain, question target and questions solved columns."""
    if "group_name" not in _columns("categories"):
        op.add_column(
            "categories",
            sa.Column(
                "group_name", sa.String(32), nullable=False, server_default="Projects"
            ),
        )

    if "question_target" not in _columns("category_targets"):
        op.add_column(
            "category_targets",
            sa.Column("question_target", sa.Integer(), nullable=True),
        )

    if "questions_solved" not in _columns("daily_logs"):
        op.add_column(
            "daily_logs",
            sa.Column(
                "questions_solved", sa.Integer(), nullable=False, server_default="0"
            ),
        )


def downgrade() -> None:
    """Drop the three columns."""
    with op.batch_alter_table("daily_logs") as batch:
        batch.drop_column("questions_solved")
    with op.batch_alter_table("category_targets") as batch:
        batch.drop_column("question_target")
    with op.batch_alter_table("categories") as batch:
        batch.drop_column("group_name")
