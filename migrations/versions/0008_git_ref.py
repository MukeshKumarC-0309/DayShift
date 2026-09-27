"""A git branch or issue reference on sessions.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-25
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add `git_ref` to sessions."""
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("sessions")}
    if "git_ref" not in columns:
        op.add_column("sessions", sa.Column("git_ref", sa.String(120), nullable=True))


def downgrade() -> None:
    """Drop the column."""
    with op.batch_alter_table("sessions") as batch:
        batch.drop_column("git_ref")
