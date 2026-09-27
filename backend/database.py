"""SQLite engine, session factory, migrations, and first-run seeding."""

from __future__ import annotations

import hashlib
import logging
import shutil
from collections.abc import Generator
from datetime import date, datetime
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config as AlembicConfig
from sqlalchemy import create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from config import (
    BASE_DIR,
    DATABASE_URL,
    DEFAULT_CATEGORIES,
    TRACKING_START_DATE,
)
from models import Base, Category, CategoryTarget

logger = logging.getLogger(__name__)

engine: Engine = create_engine(
    DATABASE_URL,
    # FastAPI may serve a request on a different thread than the one that
    # created the connection; safe here because each request gets its own
    # Session and this is a single-user app.
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@event.listens_for(Engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection: Any, _connection_record: Any) -> None:
    """SQLite ignores FK constraints unless they are switched on per connection."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a request-scoped database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _same_file(a: Path, b: Path) -> bool:
    """Whether two files have identical contents."""
    if a.stat().st_size != b.stat().st_size:
        return False
    digests = []
    for path in (a, b):
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 16), b""):
                digest.update(chunk)
        digests.append(digest.digest())
    return digests[0] == digests[1]


def snapshot_database() -> None:
    """Copy the database aside before migrations run, keeping the last N.

    Cheap insurance: the file is small, and a bad migration or an accidental
    delete is otherwise unrecoverable for data that exists nowhere else.
    """
    import config

    if not config.DATABASE_PATH.exists():
        return

    backups = config.BACKUPS_DIR
    backups.mkdir(parents=True, exist_ok=True)

    # Skip a copy identical to the newest snapshot. In development the server
    # restarts on every code change; without this, a few edits would push
    # every genuinely different snapshot out of the last-N rotation.
    existing = sorted(backups.glob("dayshift-*.db"))
    if existing and _same_file(config.DATABASE_PATH, existing[-1]):
        logger.debug("Database unchanged since %s; no new snapshot", existing[-1].name)
        return

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    destination = backups / f"dayshift-{stamp}.db"

    try:
        shutil.copy2(config.DATABASE_PATH, destination)
    except OSError:
        logger.warning("Could not write a database snapshot", exc_info=True)
        return

    existing = sorted(backups.glob("dayshift-*.db"))
    for stale in existing[: -config.BACKUP_KEEP]:
        stale.unlink(missing_ok=True)


def _alembic_config(url: str | None = None) -> AlembicConfig:
    # The URL is read from config at call time rather than captured at import,
    # so tests can point the whole stack at a temporary database.
    import config

    cfg = AlembicConfig(str(BASE_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BASE_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url or config.DATABASE_URL)
    return cfg


def run_migrations(url: str | None = None) -> None:
    """Bring a database to the latest revision (the app's, unless `url` says)."""
    command.upgrade(_alembic_config(url), "head")


def head_revision() -> str:
    """Return the newest migration this code knows."""
    from alembic.script import ScriptDirectory

    head = ScriptDirectory.from_config(_alembic_config()).get_current_head()
    assert head is not None
    return head


def known_revisions() -> set[str]:
    """Return every migration revision this code knows."""
    from alembic.script import ScriptDirectory

    return {
        rev.revision
        for rev in ScriptDirectory.from_config(_alembic_config()).walk_revisions()
    }


def seed_categories() -> None:
    """Create the default categories and their initial targets, once.

    Idempotent and matched on name, so an edited target is never overwritten
    by a later restart.
    """
    with SessionLocal() as db:
        existing = {name for (name,) in db.execute(select(Category.name)).all()}
        added = False

        for order, seed in enumerate(DEFAULT_CATEGORIES):
            name = str(seed["name"])
            if name in existing:
                continue
            category = Category(
                name=name,
                display_order=order,
                group_name=str(seed.get("group", "Projects")),
            )
            db.add(category)
            db.flush()  # assign the id before the target references it
            question_target = seed.get("question_target")
            db.add(
                CategoryTarget(
                    category_id=category.id,
                    # Effective from the start of tracking, so every scored day
                    # resolves to a target.
                    effective_from=TRACKING_START_DATE.isoformat(),
                    daily_target_minutes=int(seed["daily_target_minutes"]),  # type: ignore[arg-type]
                    active_days=str(seed["active_days"]),
                    question_target=int(question_target)  # type: ignore[arg-type]
                    if question_target is not None
                    else None,
                )
            )
            added = True

        if added:
            db.commit()


def backfill_missing_targets() -> None:
    """Give any category without a target history one, from the tracking start.

    Only reachable if a category was created outside the normal path; it means
    a category can never end up unscoreable.
    """
    with SessionLocal() as db:
        categories = db.scalars(select(Category)).all()
        changed = False
        for category in categories:
            has_target = db.scalar(
                select(CategoryTarget.id).where(CategoryTarget.category_id == category.id)
            )
            if has_target is None:
                db.add(
                    CategoryTarget(
                        category_id=category.id,
                        effective_from=TRACKING_START_DATE.isoformat(),
                        daily_target_minutes=60,
                        active_days="MON,TUE,WED,THU,FRI,SAT,SUN",
                    )
                )
                changed = True
        if changed:
            db.commit()


def init_db() -> None:
    """Snapshot, migrate, then seed. Called once at startup."""
    snapshot_database()
    run_migrations()
    seed_categories()
    backfill_missing_targets()


__all__ = [
    "Base",
    "SessionLocal",
    "date",
    "engine",
    "get_db",
    "init_db",
    "run_migrations",
    "seed_categories",
    "snapshot_database",
]
