"""Initial schema, with effective-dated targets, sessions, tags and settings.

Revision ID: 0001
Revises:
Create Date: 2026-09-22

This revision is written defensively rather than as a plain set of CREATEs,
because Dayshift managed its schema with `Base.metadata.create_all()` before
Alembic existed. A database from that era already has tables but no
`alembic_version`, so every step here checks what is actually present.

The important part is the legacy `categories` table, which carried
`daily_target_minutes` and `active_days` directly. Those move into
`category_targets` as a single record effective from 2000-01-01, so that every
day already logged resolves to the target that was in force when it was
recorded. Without that backfill, historical days would have no target at all.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Early enough that any logged day resolves a target. Scoring still excludes
# anything before the configured tracking start, so this is not a real date.
LEGACY_EFFECTIVE_FROM = "2000-01-01"


def _tables(bind: sa.engine.Connection) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _columns(bind: sa.engine.Connection, table: str) -> set[str]:
    return {col["name"] for col in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    """Create the schema, migrating a pre-Alembic database if one is present."""
    bind = op.get_bind()
    existing = _tables(bind)

    # --- categories ----------------------------------------------------------
    if "categories" not in existing:
        op.create_table(
            "categories",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(64), nullable=False, unique=True),
            sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("archived_at", sa.String(19), nullable=True),
            sa.Column("created_at", sa.String(19), nullable=False),
            sa.Column("updated_at", sa.String(19), nullable=False),
        )
        legacy_categories = False
    else:
        legacy_categories = "daily_target_minutes" in _columns(bind, "categories")

    # --- category_targets ----------------------------------------------------
    if "category_targets" not in existing:
        op.create_table(
            "category_targets",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "category_id",
                sa.Integer(),
                sa.ForeignKey("categories.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("effective_from", sa.String(10), nullable=False),
            sa.Column("daily_target_minutes", sa.Integer(), nullable=False),
            sa.Column("active_days", sa.Text(), nullable=False),
            sa.Column("created_at", sa.String(19), nullable=False),
            sa.UniqueConstraint(
                "category_id", "effective_from", name="uq_target_category_date"
            ),
            sa.CheckConstraint("daily_target_minutes >= 0", name="ck_target_nonneg"),
        )
        op.create_index(
            "ix_category_targets_category_id", "category_targets", ["category_id"]
        )

    # --- migrate the legacy category columns ---------------------------------
    if legacy_categories:
        # Preserve the current target as the rule that has always applied.
        op.execute(
            sa.text(
                """
                INSERT INTO category_targets
                    (category_id, effective_from, daily_target_minutes,
                     active_days, created_at)
                SELECT c.id, :effective_from, c.daily_target_minutes,
                       c.active_days,
                       strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')
                FROM categories c
                WHERE NOT EXISTS (
                    SELECT 1 FROM category_targets t WHERE t.category_id = c.id
                )
                """
            ).bindparams(effective_from=LEGACY_EFFECTIVE_FROM)
        )

        # SQLite rebuilds the table to drop a column, and reflection would
        # carry over the legacy CHECK constraint on `daily_target_minutes` —
        # into a table that no longer has that column. Describing the old
        # table explicitly via `copy_from` keeps that constraint out of the
        # rebuild.
        legacy_categories_table = sa.Table(
            "categories",
            sa.MetaData(),
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(64), nullable=False, unique=True),
            sa.Column("daily_target_minutes", sa.Integer(), nullable=False),
            sa.Column("active_days", sa.Text(), nullable=False),
        )

        with op.batch_alter_table(
            "categories", copy_from=legacy_categories_table
        ) as batch:
            batch.add_column(
                sa.Column(
                    "display_order", sa.Integer(), nullable=False, server_default="0"
                )
            )
            batch.add_column(sa.Column("archived_at", sa.String(19), nullable=True))
            batch.add_column(
                sa.Column("created_at", sa.String(19), nullable=False, server_default="")
            )
            batch.add_column(
                sa.Column("updated_at", sa.String(19), nullable=False, server_default="")
            )
            batch.drop_column("daily_target_minutes")
            batch.drop_column("active_days")

        op.execute(
            sa.text(
                "UPDATE categories SET display_order = id "
                "WHERE display_order = 0 OR display_order IS NULL"
            )
        )
        op.execute(
            sa.text(
                "UPDATE categories "
                "SET created_at = strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime') "
                "WHERE created_at IS NULL OR created_at = ''"
            )
        )
        op.execute(
            sa.text(
                "UPDATE categories "
                "SET updated_at = strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime') "
                "WHERE updated_at IS NULL OR updated_at = ''"
            )
        )

    # --- daily_logs ----------------------------------------------------------
    if "daily_logs" not in existing:
        op.create_table(
            "daily_logs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("log_date", sa.String(10), nullable=False),
            sa.Column(
                "category_id",
                sa.Integer(),
                sa.ForeignKey("categories.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("minutes_logged", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("override_target_minutes", sa.Integer(), nullable=True),
            sa.Column("override_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.String(19), nullable=False),
            sa.Column("updated_at", sa.String(19), nullable=False),
            sa.UniqueConstraint("log_date", "category_id", name="uq_log_date_category"),
            sa.CheckConstraint("minutes_logged >= 0", name="ck_log_minutes_nonneg"),
            sa.CheckConstraint(
                "override_target_minutes IS NULL OR override_target_minutes >= 0",
                name="ck_log_override_nonneg",
            ),
        )
        op.create_index("ix_daily_logs_log_date", "daily_logs", ["log_date"])
        op.create_index("ix_daily_logs_category_id", "daily_logs", ["category_id"])
    elif "override_reason" not in _columns(bind, "daily_logs"):
        op.add_column(
            "daily_logs", sa.Column("override_reason", sa.Text(), nullable=True)
        )

    # --- sessions ------------------------------------------------------------
    if "sessions" not in existing:
        op.create_table(
            "sessions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "category_id",
                sa.Integer(),
                sa.ForeignKey("categories.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("log_date", sa.String(10), nullable=False),
            sa.Column("started_at", sa.String(19), nullable=False),
            sa.Column("ended_at", sa.String(19), nullable=True),
            sa.Column("minutes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("source", sa.String(16), nullable=False, server_default="timer"),
            sa.Column("created_at", sa.String(19), nullable=False),
            sa.Column("updated_at", sa.String(19), nullable=False),
            sa.CheckConstraint("minutes >= 0", name="ck_session_minutes_nonneg"),
            sa.CheckConstraint("source IN ('timer', 'manual')", name="ck_session_source"),
        )
        op.create_index("ix_sessions_log_date", "sessions", ["log_date"])
        op.create_index("ix_sessions_category_id", "sessions", ["category_id"])
        op.create_index(
            "ix_sessions_date_category", "sessions", ["log_date", "category_id"]
        )

    # --- tags ----------------------------------------------------------------
    if "tags" not in existing:
        op.create_table(
            "tags",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(48), nullable=False, unique=True),
            sa.Column("created_at", sa.String(19), nullable=False),
        )
    if "session_tags" not in existing:
        op.create_table(
            "session_tags",
            sa.Column(
                "session_id",
                sa.Integer(),
                sa.ForeignKey("sessions.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "tag_id",
                sa.Integer(),
                sa.ForeignKey("tags.id", ondelete="CASCADE"),
                primary_key=True,
            ),
        )

    # --- settings ------------------------------------------------------------
    if "settings" not in existing:
        op.create_table(
            "settings",
            sa.Column("key", sa.String(64), primary_key=True),
            sa.Column("value", sa.Text(), nullable=False),
            sa.Column("updated_at", sa.String(19), nullable=False),
        )


def downgrade() -> None:
    """Refuse to downgrade — see the note below."""
    # One-way: downgrading would have to choose which of a category's many
    # effective-dated targets becomes the single legacy column, and any answer
    # would silently discard history.
    raise NotImplementedError(
        "Downgrade is not supported — it would discard target history."
    )
