"""Restore from a JSON export: replaces everything (the user's choice).

The export's `tables` section is rebuilt into a fresh database, checked, and
swapped in after snapshotting the current one. Credentials and this
machine's export folder and reminder settings stay as they are.
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import config
from test_session_editor import YESTERDAY, add

SDE = 1


def export(client: TestClient) -> dict:
    return client.get("/api/settings/export.json").json()


def restore(client: TestClient, data: dict, confirm: str = "RESTORE"):
    return client.post(
        "/api/settings/restore-export", json={"confirm": confirm, "data": data}
    )


def seed(client: TestClient) -> None:
    client.put(
        "/api/logs",
        json={
            "log_date": YESTERDAY,
            "category_id": SDE,
            "minutes_logged": 45,
            "override_target_minutes": 60,
            "override_reason": "Travel",
        },
    )
    session = add(client, f"{YESTERDAY}T09:00", 50, tags=["auth"], git_ref="#1").json()
    add(client, f"{YESTERDAY}T11:00", 20)
    client.delete(f"/api/sessions/{session['id']}")  # history entry
    client.put("/api/settings", json={"values": {"warning_threshold": 70}})


def comparable(data: dict) -> dict:
    tables = dict(data["tables"])
    tables["settings"] = sorted(
        (r["key"], r["value"]) for r in tables["settings"] if r["key"] != "export_dir"
    )
    return tables


class TestRestore:
    def test_round_trip_is_exact(self, auth_client: TestClient) -> None:
        seed(auth_client)
        saved = export(auth_client)
        # Change and add things after the export...
        add(auth_client, f"{YESTERDAY}T14:00", 30)
        auth_client.put("/api/settings", json={"values": {"warning_threshold": 90}})
        # ...then restore: everything is back exactly as exported.
        response = restore(auth_client, saved)
        assert response.status_code == 200
        assert comparable(export(auth_client)) == comparable(saved)

    def test_preview_changes_nothing(self, auth_client: TestClient) -> None:
        seed(auth_client)
        saved = export(auth_client)
        before = export(auth_client)
        body = auth_client.post("/api/settings/restore-export/preview", json=saved).json()
        counts = {c["label"]: c["count"] for c in body["counts"]}
        assert counts["sessions"] == 1
        assert counts["daily entries"] == 1
        assert body["first_day"] == YESTERDAY
        assert comparable(export(auth_client)) == comparable(before)

    def test_current_state_is_snapshotted_first(self, auth_client: TestClient) -> None:
        seed(auth_client)
        saved = export(auth_client)
        backups = Path(config.BACKUPS_DIR)
        count = len(list(backups.glob("dayshift-*.db"))) if backups.exists() else 0
        add(auth_client, f"{YESTERDAY}T14:00", 30)  # so the snapshot isn't a duplicate
        restore(auth_client, saved)
        assert len(list(backups.glob("dayshift-*.db"))) == count + 1

    def test_this_machines_folder_and_reminder_stay(
        self, auth_client: TestClient, tmp_path: Path
    ) -> None:
        first, second = tmp_path / "a", tmp_path / "b"
        first.mkdir()
        second.mkdir()
        auth_client.put("/api/settings", json={"values": {"export_dir": str(first)}})
        saved = export(auth_client)
        auth_client.put(
            "/api/settings",
            json={"values": {"export_dir": str(second), "reminder_time": "22:15"}},
        )
        restore(auth_client, saved)
        values = {s["key"]: s["value"] for s in auth_client.get("/api/settings").json()}
        assert values["export_dir"] == str(second.resolve())
        assert values["reminder_time"] == "22:15"

    def test_still_signed_in_afterwards(self, auth_client: TestClient) -> None:
        seed(auth_client)
        restore(auth_client, export(auth_client))
        assert auth_client.get("/api/auth/status").json()["authenticated"] is True


class TestRefusals:
    def test_needs_restore_typed(self, auth_client: TestClient) -> None:
        response = restore(auth_client, export(auth_client), confirm="restore")
        assert response.status_code == 422

    def test_an_old_export_is_refused_with_advice(self, auth_client: TestClient) -> None:
        old = export(auth_client)
        del old["tables"], old["format"]
        response = restore(auth_client, old)
        assert response.status_code == 422
        assert "Export again" in response.json()["detail"]

    def test_an_export_from_a_newer_version_is_refused(
        self, auth_client: TestClient
    ) -> None:
        newer = export(auth_client)
        newer["schema"] = "9999"
        assert "newer" in restore(auth_client, newer).json()["detail"]

    def test_unknown_columns_are_refused(self, auth_client: TestClient) -> None:
        seed(auth_client)
        odd = export(auth_client)
        odd["tables"]["sessions"][0]["mood_ring"] = 3
        assert restore(auth_client, odd).status_code == 422

    def test_a_broken_file_changes_nothing(self, auth_client: TestClient) -> None:
        seed(auth_client)
        before = export(auth_client)
        broken = export(auth_client)
        broken["tables"]["sessions"][0]["category_id"] = 999
        response = restore(auth_client, broken)
        assert response.status_code == 422
        assert "Nothing was changed" in response.json()["detail"]
        assert comparable(export(auth_client)) == comparable(before)
        # And no temporary file is left behind.
        leftovers = list(Path(config.DATABASE_PATH).parent.glob("restore-*.db"))
        assert leftovers == []
