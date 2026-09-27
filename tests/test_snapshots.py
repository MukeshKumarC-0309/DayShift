"""Startup snapshots: one per distinct database state, last N kept."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

import config
import database


@pytest.fixture
def db_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "dayshift.db"
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE t (x INTEGER)")
    monkeypatch.setattr(config, "DATABASE_PATH", path)
    monkeypatch.setattr(config, "BACKUPS_DIR", tmp_path / "backups")
    return path


def snapshots(db_file: Path) -> list[Path]:
    return sorted((db_file.parent / "backups").glob("dayshift-*.db"))


def test_unchanged_database_is_not_snapshotted_twice(db_file: Path) -> None:
    database.snapshot_database()
    database.snapshot_database()
    database.snapshot_database()
    assert len(snapshots(db_file)) == 1


def test_a_changed_database_gets_a_new_snapshot(
    db_file: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database.snapshot_database()
    first = snapshots(db_file)[0]
    # Same-second restarts would share a timestamped name; rename the first.
    first.rename(first.with_name("dayshift-00000000-000000.db"))
    with sqlite3.connect(db_file) as conn:
        conn.execute("INSERT INTO t VALUES (1)")
    database.snapshot_database()
    assert len(snapshots(db_file)) == 2


def test_rotation_keeps_the_last_n(
    db_file: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(config, "BACKUP_KEEP", 3)
    backups = db_file.parent / "backups"
    backups.mkdir()
    for i in range(5):
        (backups / f"dayshift-2026010{i}-000000.db").write_bytes(b"old %d" % i)
    database.snapshot_database()
    names = [p.name for p in snapshots(db_file)]
    assert len(names) == 3
    assert "dayshift-20260100-000000.db" not in names


def test_restore_round_trip(auth_client, tmp_path: Path) -> None:
    """Restore brings back the snapshot's data and keeps the replaced state."""
    import time

    auth_client.put(
        "/api/logs",
        json={"log_date": "2026-10-05", "category_id": 1, "minutes_logged": 100},
    )
    database.snapshot_database()
    backups = config.BACKUPS_DIR
    first = sorted(backups.glob("dayshift-*.db"))[-1]

    time.sleep(1.1)  # snapshot names are per-second
    auth_client.put(
        "/api/logs",
        json={"log_date": "2026-10-05", "category_id": 1, "minutes_logged": 250},
    )
    response = auth_client.post(f"/api/settings/backups/{first.name}/restore")
    assert response.status_code == 200, response.text

    rows = auth_client.get("/api/logs/day/2026-10-05").json()
    assert rows[0]["minutes_logged"] == 100
    # The 250-minute state was snapshotted before being replaced.
    assert len(list(backups.glob("dayshift-*.db"))) == 2


def test_restore_rejects_odd_names(auth_client) -> None:
    for name in ["../auth.json", "dayshift-latest.db", "x.db"]:
        response = auth_client.post(f"/api/settings/backups/{name}/restore")
        assert response.status_code == 404


def test_restore_rejects_a_non_database(auth_client) -> None:
    config.BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    bogus = config.BACKUPS_DIR / "dayshift-20260101-000000.db"
    bogus.write_bytes(b"not sqlite")
    response = auth_client.post(f"/api/settings/backups/{bogus.name}/restore")
    assert response.status_code == 422
