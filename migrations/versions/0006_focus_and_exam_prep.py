"""Focus blocks and exam prep on sessions.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add `planned_end` and `deadline_id` to sessions."""
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("sessions")}
    if "planned_end" not in columns:
        op.add_column("sessions", sa.Column("planned_end", sa.String(19), nullable=True))
    if "deadline_id" not in columns:
        op.add_column("sessions", sa.Column("deadline_id", sa.Integer(), nullable=True))
        op.create_index("ix_sessions_deadline_id", "sessions", ["deadline_id"])


def downgrade() -> None:
    """Drop the two columns."""
    with op.batch_alter_table("sessions") as batch:
        batch.drop_index("ix_sessions_deadline_id")
        batch.drop_column("deadline_id")
        batch.drop_column("planned_end")
