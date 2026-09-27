"""Keep a timer session's measured minutes when they are edited by hand.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add `measured_minutes` to sessions."""
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("sessions")}
    if "measured_minutes" not in columns:
        op.add_column(
            "sessions", sa.Column("measured_minutes", sa.Integer(), nullable=True)
        )


def downgrade() -> None:
    """Drop the column."""
    with op.batch_alter_table("sessions") as batch:
        batch.drop_column("measured_minutes")
