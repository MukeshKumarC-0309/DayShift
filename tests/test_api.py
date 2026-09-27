"""Integration tests for the HTTP surface."""

from __future__ import annotations

import sys
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from conftest import TEST_PASSCODE, TEST_USERNAME

SDE, AI, MAINTENANCE = 1, 2, 3


def upsert(client, day, category, minutes=None, override=None, clear=False, reason=None):
    payload: dict[str, object] = {
        "log_date": day,
        "category_id": category,
        "clear_override": clear,
    }
    if minutes is not None:
        payload["minutes_logged"] = minutes
    if override is not None:
        payload["override_target_minutes"] = override
    if reason is not None:
        payload["override_reason"] = reason
    return client.put("/api/logs", json=payload)


class TestSetup:
    """First run: nothing is configured until the setup screen is used."""

    def test_status_reports_unconfigured_on_a_fresh_install(
        self, client: TestClient
    ) -> None:
        body = client.get("/api/auth/status").json()
        assert body == {
            "configured": False,
            "authenticated": False,
            "username": None,
            "setup_token_required": False,
        }

    def test_setup_requires_token_when_configured(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import config

        monkeypatch.setattr(config, "SETUP_TOKEN", "letmein-token")
        assert client.get("/api/auth/status").json()["setup_token_required"] is True

        creds = {"username": "owner", "passcode": "correct-horse"}
        assert client.post("/api/auth/setup", json=creds).status_code == 403
        wrong = {**creds, "setup_token": "nope"}
        assert client.post("/api/auth/setup", json=wrong).status_code == 403
        right = {**creds, "setup_token": "letmein-token"}
        assert client.post("/api/auth/setup", json=right).status_code == 201

    def test_setup_creates_credentials_and_signs_in(self, client: TestClient) -> None:
        response = client.post(
            "/api/auth/setup",
            json={"username": TEST_USERNAME, "passcode": TEST_PASSCODE},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["configured"] is True
        assert body["authenticated"] is True
        assert body["username"] == TEST_USERNAME
        assert "dayshift_session" in response.cookies

    def test_setup_is_refused_once_configured(
        self, configured_client: TestClient
    ) -> None:
        # Otherwise the setup screen would be a credential reset for anyone.
        response = configured_client.post(
            "/api/auth/setup", json={"username": "someoneelse", "passcode": "another-one"}
        )
        assert response.status_code == 409

    def test_credentials_are_not_stored_in_the_database(
        self, configured_client: TestClient, tmp_path
    ) -> None:
        # SCHEMA.md keeps auth out of SQLite so snapshots never carry it.
        database_bytes = (tmp_path / "api.db").read_bytes()
        assert TEST_PASSCODE.encode() not in database_bytes
        assert TEST_USERNAME.encode() not in database_bytes
        assert (tmp_path / "auth.json").exists()

    def test_passcode_is_never_stored_in_plain_text(
        self, configured_client: TestClient, tmp_path
    ) -> None:
        stored = (tmp_path / "auth.json").read_text()
        assert TEST_PASSCODE not in stored
        assert "$argon2" in stored

    @pytest.mark.skipif(
        sys.platform == "win32",
        reason="Unix permission bits; on Windows the user profile's ACLs apply",
    )
    def test_credentials_file_is_owner_only(
        self, configured_client: TestClient, tmp_path
    ) -> None:
        import stat

        mode = (tmp_path / "auth.json").stat().st_mode
        assert stat.S_IMODE(mode) == 0o600

    @pytest.mark.parametrize(
        "username",
        ["ab", "has space", "way-too-long-" + "x" * 40, "bad!char", ""],
    )
    def test_invalid_usernames_are_rejected(
        self, client: TestClient, username: str
    ) -> None:
        response = client.post(
            "/api/auth/setup", json={"username": username, "passcode": TEST_PASSCODE}
        )
        assert response.status_code == 422

    def test_short_passcode_is_rejected(self, client: TestClient) -> None:
        response = client.post(
            "/api/auth/setup", json={"username": TEST_USERNAME, "passcode": "short"}
        )
        assert response.status_code == 422

    def test_login_before_setup_is_refused(self, client: TestClient) -> None:
        response = client.post(
            "/api/auth/login",
            json={"username": TEST_USERNAME, "passcode": TEST_PASSCODE},
        )
        assert response.status_code == 409


class TestAuth:
    def test_protected_routes_reject_anonymous_callers(self, client: TestClient) -> None:
        for path in (
            "/api/stats/dashboard",
            "/api/logs",
            "/api/categories",
            "/api/sessions/running",
            "/api/settings",
            "/api/stats/insights",
        ):
            assert client.get(path).status_code == 401, path

    def test_correct_credentials_sign_in(self, configured_client: TestClient) -> None:
        configured_client.post("/api/auth/logout")
        response = configured_client.post(
            "/api/auth/login",
            json={"username": TEST_USERNAME, "passcode": TEST_PASSCODE},
        )
        assert response.status_code == 200
        assert response.json()["username"] == TEST_USERNAME

    def test_username_is_case_insensitive(self, configured_client: TestClient) -> None:
        configured_client.post("/api/auth/logout")
        response = configured_client.post(
            "/api/auth/login",
            json={"username": TEST_USERNAME.upper(), "passcode": TEST_PASSCODE},
        )
        assert response.status_code == 200

    def test_wrong_passcode_is_rejected(self, configured_client: TestClient) -> None:
        assert (
            configured_client.post(
                "/api/auth/login",
                json={"username": TEST_USERNAME, "passcode": "wrong-passcode"},
            ).status_code
            == 401
        )

    def test_wrong_username_is_rejected(self, configured_client: TestClient) -> None:
        assert (
            configured_client.post(
                "/api/auth/login",
                json={"username": "someoneelse", "passcode": TEST_PASSCODE},
            ).status_code
            == 401
        )

    def test_failure_message_does_not_say_which_half_was_wrong(
        self, configured_client: TestClient
    ) -> None:
        wrong_user = configured_client.post(
            "/api/auth/login",
            json={"username": "someoneelse", "passcode": TEST_PASSCODE},
        ).json()["detail"]
        wrong_pass = configured_client.post(
            "/api/auth/login",
            json={"username": TEST_USERNAME, "passcode": "wrong-passcode"},
        ).json()["detail"]
        assert wrong_user == wrong_pass

    def test_session_cookie_is_http_only(self, configured_client: TestClient) -> None:
        configured_client.post("/api/auth/logout")
        response = configured_client.post(
            "/api/auth/login",
            json={"username": TEST_USERNAME, "passcode": TEST_PASSCODE},
        )
        assert "httponly" in response.headers["set-cookie"].lower()

    def test_logout_clears_the_session(self, auth_client: TestClient) -> None:
        auth_client.post("/api/auth/logout")
        body = auth_client.get("/api/auth/status").json()
        assert body["authenticated"] is False
        # Still configured — logging out is not a reset.
        assert body["configured"] is True

    def test_repeated_failures_are_throttled(self, configured_client: TestClient) -> None:
        from config import LOGIN_MAX_ATTEMPTS

        for _ in range(LOGIN_MAX_ATTEMPTS):
            configured_client.post(
                "/api/auth/login", json={"username": TEST_USERNAME, "passcode": "no"}
            )
        throttled = configured_client.post(
            "/api/auth/login", json={"username": TEST_USERNAME, "passcode": "no"}
        )
        assert throttled.status_code == 429
        assert "Retry-After" in throttled.headers


class TestCredentialChange:
    def test_change_passcode(self, auth_client: TestClient) -> None:
        response = auth_client.put(
            "/api/auth/credentials",
            json={"current_passcode": TEST_PASSCODE, "new_passcode": "a-brand-new-one"},
        )
        assert response.status_code == 200

        auth_client.post("/api/auth/logout")
        assert (
            auth_client.post(
                "/api/auth/login",
                json={"username": TEST_USERNAME, "passcode": "a-brand-new-one"},
            ).status_code
            == 200
        )

    def test_old_passcode_stops_working(self, auth_client: TestClient) -> None:
        auth_client.put(
            "/api/auth/credentials",
            json={"current_passcode": TEST_PASSCODE, "new_passcode": "a-brand-new-one"},
        )
        auth_client.post("/api/auth/logout")
        assert (
            auth_client.post(
                "/api/auth/login",
                json={"username": TEST_USERNAME, "passcode": TEST_PASSCODE},
            ).status_code
            == 401
        )

    def test_change_username(self, auth_client: TestClient) -> None:
        response = auth_client.put(
            "/api/auth/credentials",
            json={"current_passcode": TEST_PASSCODE, "username": "renamed"},
        )
        assert response.status_code == 200
        assert response.json()["username"] == "renamed"

    def test_wrong_current_passcode_is_refused(self, auth_client: TestClient) -> None:
        response = auth_client.put(
            "/api/auth/credentials",
            json={"current_passcode": "not-it", "new_passcode": "a-brand-new-one"},
        )
        assert response.status_code == 422

    def test_changing_nothing_is_refused(self, auth_client: TestClient) -> None:
        response = auth_client.put(
            "/api/auth/credentials", json={"current_passcode": TEST_PASSCODE}
        )
        assert response.status_code == 422

    def test_anonymous_cannot_change_credentials(
        self, configured_client: TestClient
    ) -> None:
        configured_client.post("/api/auth/logout")
        response = configured_client.put(
            "/api/auth/credentials",
            json={"current_passcode": TEST_PASSCODE, "new_passcode": "a-brand-new-one"},
        )
        assert response.status_code == 401


class TestCategories:
    def test_six_categories_are_seeded_in_two_domains(
        self, auth_client: TestClient
    ) -> None:
        body = auth_client.get("/api/categories").json()
        assert [(c["name"], c["group_name"]) for c in body] == [
            ("SDE Project", "Projects"),
            ("AI Automation", "Projects"),
            ("Project Maintenance", "Projects"),
            ("DSA", "Daily"),
            ("Exercise", "Daily"),
            ("Coursework", "Daily"),
        ]

    def test_daily_categories_run_every_day(self, auth_client: TestClient) -> None:
        body = {c["name"]: c for c in auth_client.get("/api/categories").json()}
        for name, minutes in (("DSA", 120), ("Exercise", 30), ("Coursework", 60)):
            assert body[name]["daily_target_minutes"] == minutes
            assert body[name]["active_days"] == "MON,TUE,WED,THU,FRI,SAT,SUN"

    def test_only_dsa_has_a_question_target(self, auth_client: TestClient) -> None:
        body = {c["name"]: c for c in auth_client.get("/api/categories").json()}
        assert body["DSA"]["question_target"] == 2
        assert all(
            c["question_target"] is None for name, c in body.items() if name != "DSA"
        )

    def test_seeded_targets_are_exposed(self, auth_client: TestClient) -> None:
        body = auth_client.get("/api/categories").json()
        maintenance = next(c for c in body if c["name"] == "Project Maintenance")
        assert maintenance["daily_target_minutes"] == 20
        assert maintenance["active_days"] == "SAT,SUN"

    def test_create_category(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/categories",
            json={
                "name": "Reading",
                "daily_target_minutes": 30,
                "active_days": "MON,WED,FRI",
            },
        )
        assert response.status_code == 201
        assert response.json()["daily_target_minutes"] == 30

    def test_duplicate_name_is_rejected(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/categories",
            json={
                "name": "SDE Project",
                "daily_target_minutes": 10,
                "active_days": "MON",
            },
        )
        assert response.status_code == 409

    def test_invalid_day_code_is_rejected(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/categories",
            json={
                "name": "Nonsense",
                "daily_target_minutes": 10,
                "active_days": "FUNDAY",
            },
        )
        assert response.status_code == 422

    def test_active_days_are_stored_in_week_order(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/categories",
            json={
                "name": "Ordered",
                "daily_target_minutes": 10,
                "active_days": "sun,mon,wed",
            },
        )
        assert response.json()["active_days"] == "MON,WED,SUN"

    def test_rename(self, auth_client: TestClient) -> None:
        response = auth_client.patch("/api/categories/1", json={"name": "SDE Work"})
        assert response.json()["name"] == "SDE Work"

    def test_archive_hides_from_the_default_list(self, auth_client: TestClient) -> None:
        auth_client.patch("/api/categories/3", json={"archived": True})
        names = [c["name"] for c in auth_client.get("/api/categories").json()]
        assert "Project Maintenance" not in names
        with_archived = auth_client.get(
            "/api/categories", params={"include_archived": True}
        ).json()
        assert any(c["archived"] for c in with_archived)

    def test_archiving_preserves_history(self, auth_client: TestClient) -> None:
        upsert(auth_client, "2026-10-03", MAINTENANCE, minutes=25)
        auth_client.patch(f"/api/categories/{MAINTENANCE}", json={"archived": True})
        usage = auth_client.get(f"/api/categories/{MAINTENANCE}/usage").json()
        assert usage["log_rows"] == 1

    def test_reorder(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/categories/reorder",
            json={
                "category_ids": [3, 2, 1, 6, 5, 4],
            },
        )
        assert [c["id"] for c in response.json()] == [3, 2, 1, 6, 5, 4]


class TestTargetHistory:
    """Batch 0 over HTTP: targets are appended, never edited in place."""

    def test_seeded_category_has_one_target(self, auth_client: TestClient) -> None:
        history = auth_client.get(f"/api/categories/{SDE}/targets").json()
        assert len(history) == 1
        assert history[0]["daily_target_minutes"] == 180

    def test_setting_a_target_appends_a_record(self, auth_client: TestClient) -> None:
        auth_client.post(
            f"/api/categories/{SDE}/targets",
            json={
                "daily_target_minutes": 120,
                "active_days": "MON,TUE,WED,FRI,SAT,SUN",
                "effective_from": "2026-10-20",
            },
        )
        history = auth_client.get(f"/api/categories/{SDE}/targets").json()
        assert len(history) == 2
        assert [t["daily_target_minutes"] for t in history] == [180, 120]

    def test_changing_a_target_does_not_rewrite_past_par(
        self, auth_client: TestClient
    ) -> None:
        for day in ("2026-10-02", "2026-10-03", "2026-10-04"):
            upsert(auth_client, day, SDE, minutes=150)

        before = auth_client.get("/api/stats/par?today=2026-10-05").json()
        before_sde = next(p for p in before if p["category_id"] == SDE)

        auth_client.post(
            f"/api/categories/{SDE}/targets",
            json={
                "daily_target_minutes": 120,
                "active_days": "MON,TUE,WED,FRI,SAT,SUN",
                "effective_from": "2026-10-20",
            },
        )

        after = auth_client.get("/api/stats/par?today=2026-10-05").json()
        after_sde = next(p for p in after if p["category_id"] == SDE)

        assert after_sde["par_percent"] == before_sde["par_percent"]
        assert after_sde["target_total"] == before_sde["target_total"]

    def test_same_effective_date_replaces_rather_than_stacks(
        self, auth_client: TestClient
    ) -> None:
        for minutes in (120, 90):
            auth_client.post(
                f"/api/categories/{SDE}/targets",
                json={
                    "daily_target_minutes": minutes,
                    "active_days": "MON,TUE",
                    "effective_from": "2026-11-01",
                },
            )
        history = auth_client.get(f"/api/categories/{SDE}/targets").json()
        november = [t for t in history if t["effective_from"] == "2026-11-01"]
        assert len(november) == 1
        assert november[0]["daily_target_minutes"] == 90

    def test_cannot_delete_the_last_target(self, auth_client: TestClient) -> None:
        history = auth_client.get(f"/api/categories/{SDE}/targets").json()
        response = auth_client.delete(f"/api/categories/{SDE}/targets/{history[0]['id']}")
        assert response.status_code == 409


class TestLogUpsert:
    def test_creates_then_updates_a_single_row(self, auth_client: TestClient) -> None:
        upsert(auth_client, "2026-10-05", SDE, minutes=120)
        upsert(auth_client, "2026-10-05", SDE, minutes=150)
        rows = auth_client.get("/api/logs?start=2026-10-05&end=2026-10-05").json()
        sde_rows = [r for r in rows if r["category_id"] == SDE]
        assert len(sde_rows) == 1
        assert sde_rows[0]["minutes_logged"] == 150

    def test_override_can_be_set_in_advance(self, auth_client: TestClient) -> None:
        row = upsert(auth_client, "2026-10-20", SDE, override=0).json()
        assert row["override_target_minutes"] == 0
        assert row["minutes_logged"] == 0

    def test_override_reason_is_stored(self, auth_client: TestClient) -> None:
        row = upsert(auth_client, "2026-10-20", SDE, override=60, reason="Exam").json()
        assert row["override_reason"] == "Exam"

    def test_clear_override_also_clears_the_reason(self, auth_client: TestClient) -> None:
        upsert(auth_client, "2026-10-07", SDE, minutes=60, override=30, reason="Travel")
        upsert(auth_client, "2026-10-07", SDE, clear=True)
        row = auth_client.get("/api/logs/day/2026-10-07").json()[0]
        assert row["override_target_minutes"] is None
        assert row["override_reason"] is None
        assert row["minutes_logged"] == 60

    def test_unknown_category_is_rejected(self, auth_client: TestClient) -> None:
        assert upsert(auth_client, "2026-10-05", 999, minutes=10).status_code == 404

    def test_negative_minutes_are_rejected(self, auth_client: TestClient) -> None:
        assert upsert(auth_client, "2026-10-05", SDE, minutes=-5).status_code == 422

    def test_float_minutes_are_rejected(self, auth_client: TestClient) -> None:
        response = auth_client.put(
            "/api/logs",
            json={
                "log_date": "2026-10-05",
                "category_id": SDE,
                "minutes_logged": 12.7,
                "clear_override": False,
            },
        )
        assert response.status_code == 422


class TestSessions:
    """Batch 2: the timer, and sessions sitting alongside manual minutes."""

    def test_no_session_running_initially(self, auth_client: TestClient) -> None:
        assert auth_client.get("/api/sessions/running").json() is None

    def test_start_and_stop(self, auth_client: TestClient) -> None:
        started = auth_client.post("/api/sessions/start", json={"category_id": SDE})
        assert started.status_code == 201
        assert started.json()["is_running"] is True

        running = auth_client.get("/api/sessions/running").json()
        assert running["category_id"] == SDE

        stopped = auth_client.post("/api/sessions/stop").json()
        assert stopped["is_running"] is False
        assert auth_client.get("/api/sessions/running").json() is None

    def test_stop_records_the_elapsed_minutes(self, auth_client: TestClient) -> None:
        # Regression: stop() used to close the session before measuring it, so
        # every timer recorded 0 minutes.
        from datetime import datetime, timedelta

        import database
        from models import Session as WorkSession

        auth_client.post("/api/sessions/start", json={"category_id": SDE})
        db = database.SessionLocal()
        running = db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).one()
        started = datetime.fromisoformat(running.started_at) - timedelta(minutes=37)
        running.started_at = started.isoformat()
        db.commit()
        db.close()
        stopped = auth_client.post("/api/sessions/stop").json()
        assert stopped["minutes"] == 37

    def test_starting_a_second_timer_stops_the_first(
        self, auth_client: TestClient
    ) -> None:
        # Two timers at once would count the same wall-clock minutes twice.
        auth_client.post("/api/sessions/start", json={"category_id": SDE})
        auth_client.post("/api/sessions/start", json={"category_id": AI})
        running = auth_client.get("/api/sessions/running").json()
        assert running["category_id"] == AI
        all_sessions = auth_client.get("/api/sessions").json()
        assert sum(1 for s in all_sessions if s["is_running"]) == 1

    def test_restarting_the_same_category_is_idempotent(
        self, auth_client: TestClient
    ) -> None:
        first = auth_client.post("/api/sessions/start", json={"category_id": SDE}).json()
        again = auth_client.post("/api/sessions/start", json={"category_id": SDE}).json()
        assert first["id"] == again["id"]

    def test_stop_without_a_running_session_is_404(self, auth_client: TestClient) -> None:
        assert auth_client.post("/api/sessions/stop").status_code == 404

    def test_discard_removes_the_session(self, auth_client: TestClient) -> None:
        auth_client.post("/api/sessions/start", json={"category_id": SDE})
        assert auth_client.post("/api/sessions/discard").status_code == 204
        assert auth_client.get("/api/sessions").json() == []

    def test_manual_session_end_follows_its_start(self, auth_client: TestClient) -> None:
        # Derived from start + duration, never from the current clock.
        day = (date.today() - timedelta(days=1)).isoformat()
        created = auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": day,
                "minutes": 90,
                "started_at": f"{day}T14:00:00",
            },
        ).json()
        assert created["ended_at"] == f"{day}T15:30:00"

    def test_manual_session_is_marked_manual(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": "2026-10-05",
                "minutes": 45,
            },
        )
        assert response.status_code == 201
        assert response.json()["source"] == "manual"

    def test_sessions_add_to_manual_minutes(self, auth_client: TestClient) -> None:
        """The decision: sessions sit ALONGSIDE the hand-entered total."""
        upsert(auth_client, "2026-10-05", SDE, minutes=60)
        auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": "2026-10-05",
                "minutes": 45,
            },
        )
        progress = auth_client.get("/api/stats/dashboard?today=2026-10-05").json()[
            "progress"
        ]
        sde = next(p for p in progress if p["category_id"] == SDE)
        assert sde["manual_minutes"] == 60
        assert sde["timed_minutes"] == 45
        assert sde["minutes_logged"] == 105

    def test_running_session_does_not_count_yet(self, auth_client: TestClient) -> None:
        # A live timer must not inflate the score mid-session.
        auth_client.post("/api/sessions/start", json={"category_id": SDE})
        progress = auth_client.get("/api/stats/dashboard").json()["progress"]
        sde = next(p for p in progress if p["category_id"] == SDE)
        assert sde["timed_minutes"] == 0

    def test_edit_session_minutes(self, auth_client: TestClient) -> None:
        created = auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": "2026-10-05",
                "minutes": 45,
            },
        ).json()
        updated = auth_client.patch(
            f"/api/sessions/{created['id']}", json={"minutes": 60, "note": "Refactor"}
        ).json()
        assert updated["minutes"] == 60
        assert updated["note"] == "Refactor"

    def test_cannot_edit_minutes_of_a_running_session(
        self, auth_client: TestClient
    ) -> None:
        started = auth_client.post(
            "/api/sessions/start", json={"category_id": SDE}
        ).json()
        response = auth_client.patch(
            f"/api/sessions/{started['id']}", json={"minutes": 999}
        )
        assert response.status_code == 409

    def test_split_session(self, auth_client: TestClient) -> None:
        created = auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": "2026-10-05",
                "minutes": 90,
            },
        ).json()
        halves = auth_client.post(
            f"/api/sessions/{created['id']}/split", json={"at_minute": 30}
        ).json()
        assert [h["minutes"] for h in halves] == [30, 60]

    def test_split_beyond_length_is_rejected(self, auth_client: TestClient) -> None:
        created = auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": "2026-10-05",
                "minutes": 30,
            },
        ).json()
        response = auth_client.post(
            f"/api/sessions/{created['id']}/split", json={"at_minute": 30}
        )
        assert response.status_code == 422

    def test_delete_session(self, auth_client: TestClient) -> None:
        created = auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": "2026-10-05",
                "minutes": 30,
            },
        ).json()
        assert auth_client.delete(f"/api/sessions/{created['id']}").status_code == 204


class TestTagsAndSearch:
    """Batch 3."""

    def test_tags_are_created_and_counted(self, auth_client: TestClient) -> None:
        auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": "2026-10-05",
                "minutes": 60,
                "tags": ["auth", "Refactor"],
            },
        )
        tags = auth_client.get("/api/sessions/tags/all").json()
        names = {t["name"] for t in tags}
        assert names == {"auth", "refactor"}  # normalised to lowercase
        assert all(t["total_minutes"] == 60 for t in tags)

    def test_search_matches_notes(self, auth_client: TestClient) -> None:
        auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": "2026-10-05",
                "minutes": 60,
                "note": "Fixed the login redirect",
            },
        )
        hits = auth_client.get("/api/sessions/search", params={"q": "redirect"}).json()
        assert len(hits) == 1
        assert hits[0]["category_name"] == "SDE Project"

    def test_search_matches_tags(self, auth_client: TestClient) -> None:
        auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": "2026-10-05",
                "minutes": 60,
                "tags": ["migrations"],
            },
        )
        hits = auth_client.get("/api/sessions/search", params={"q": "migra"}).json()
        assert len(hits) == 1

    def test_search_is_case_insensitive(self, auth_client: TestClient) -> None:
        auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": "2026-10-05",
                "minutes": 60,
                "note": "Studied Alembic",
            },
        )
        assert (
            len(auth_client.get("/api/sessions/search", params={"q": "ALEMBIC"}).json())
            == 1
        )


class TestDayDetail:
    """Batch 3."""

    def test_day_detail_lists_sessions_and_totals(self, auth_client: TestClient) -> None:
        upsert(auth_client, "2026-10-05", SDE, minutes=30)
        auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": "2026-10-05",
                "minutes": 45,
                "note": "Morning block",
            },
        )
        detail = auth_client.get("/api/stats/day/2026-10-05").json()
        sde = next(c for c in detail["categories"] if c["category_id"] == SDE)
        assert detail["weekday"] == "MON"
        assert sde["manual_minutes"] == 30
        assert sde["timed_minutes"] == 45
        assert sde["total_minutes"] == 75
        assert sde["sessions"][0]["note"] == "Morning block"


class TestSettings:
    """Batch 1."""

    def test_defaults_are_listed(self, auth_client: TestClient) -> None:
        settings = {s["key"]: s for s in auth_client.get("/api/settings").json()}
        assert settings["par_window_days"]["value"] == "7"
        assert settings["warning_threshold"]["value"] == "80"

    def test_update_changes_behaviour(self, auth_client: TestClient) -> None:
        # A 1-day warning threshold should make a single bad day a warning.
        for day in ("2026-10-05", "2026-10-06"):
            upsert(auth_client, day, SDE, minutes=180)
        upsert(auth_client, "2026-10-07", SDE, minutes=10)

        before = auth_client.get("/api/stats/par?today=2026-10-08").json()
        assert next(p for p in before if p["category_id"] == SDE)["status"] != "warning"

        auth_client.put("/api/settings", json={"values": {"warning_days": 1}})
        after = auth_client.get("/api/stats/par?today=2026-10-08").json()
        assert (
            next(p for p in after if p["category_id"] == SDE)["consecutive_days_below"]
            == 1
        )

    def test_out_of_range_value_is_rejected(self, auth_client: TestClient) -> None:
        response = auth_client.put(
            "/api/settings",
            json={
                "values": {"par_window_days": 500},
            },
        )
        assert response.status_code == 422

    def test_unknown_key_is_rejected(self, auth_client: TestClient) -> None:
        response = auth_client.put("/api/settings", json={"values": {"nope": 1}})
        assert response.status_code == 422

    def test_a_rejected_batch_changes_nothing(self, auth_client: TestClient) -> None:
        auth_client.put(
            "/api/settings",
            json={
                "values": {"par_window_days": 14, "warning_days": 999},
            },
        )
        settings = {s["key"]: s["value"] for s in auth_client.get("/api/settings").json()}
        assert settings["par_window_days"] == "7"

    def test_reset_restores_defaults(self, auth_client: TestClient) -> None:
        auth_client.put("/api/settings", json={"values": {"par_window_days": 14}})
        auth_client.post("/api/settings/reset")
        settings = {s["key"]: s["value"] for s in auth_client.get("/api/settings").json()}
        assert settings["par_window_days"] == "7"

    def test_par_window_setting_changes_the_window(self, auth_client: TestClient) -> None:
        auth_client.put("/api/settings", json={"values": {"par_window_days": 14}})
        par = auth_client.get("/api/stats/par?today=2026-10-20").json()
        sde = next(p for p in par if p["category_id"] == SDE)
        assert sde["window_start"] == "2026-10-06"


class TestExport:
    """Batch 1."""

    def test_json_export_contains_history(self, auth_client: TestClient) -> None:
        upsert(auth_client, "2026-10-05", SDE, minutes=120)
        payload = auth_client.get("/api/settings/export.json").json()
        assert len(payload["categories"]) == 6
        assert len(payload["category_targets"]) == 6
        assert payload["daily_logs"][0]["minutes_logged"] == 120

    def test_csv_export_separates_manual_and_timed(self, auth_client: TestClient) -> None:
        upsert(auth_client, "2026-10-05", SDE, minutes=60)
        auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": "2026-10-05",
                "minutes": 45,
            },
        )
        text = auth_client.get("/api/settings/export.csv").text
        header, row = text.strip().splitlines()[:2]
        assert "manual_minutes" in header and "timed_minutes" in header
        assert row.split(",")[2:5] == ["60", "45", "105"]


class TestStats:
    def test_dashboard_returns_every_section(self, auth_client: TestClient) -> None:
        body = auth_client.get("/api/stats/dashboard?today=2026-10-08").json()
        assert set(body) == {
            "today",
            "tracking_start_date",
            "progress",
            "par",
            "weekly",
            "categories",
            "running",
        }

    def test_par_excludes_today(self, auth_client: TestClient) -> None:
        upsert(auth_client, "2026-10-08", SDE, minutes=180)
        par = auth_client.get("/api/stats/par?today=2026-10-08").json()
        assert (
            next(p for p in par if p["category_id"] == SDE)["window_end"] == "2026-10-07"
        )

    def test_par_is_none_before_tracking_starts(self, auth_client: TestClient) -> None:
        par = auth_client.get("/api/stats/par?today=2026-09-15").json()
        assert all(p["par_percent"] is None for p in par)

    def test_override_changes_the_denominator(self, auth_client: TestClient) -> None:
        for day in ("2026-10-05", "2026-10-06", "2026-10-07"):
            upsert(auth_client, day, AI, minutes=60)
        before = auth_client.get("/api/stats/par?today=2026-10-08").json()
        before_target = next(p for p in before if p["category_id"] == AI)["target_total"]

        upsert(auth_client, "2026-10-07", AI, override=15)
        after = auth_client.get("/api/stats/par?today=2026-10-08").json()
        after_target = next(p for p in after if p["category_id"] == AI)["target_total"]
        assert after_target == before_target - 45

    def test_weekly_marks_overridden_days(self, auth_client: TestClient) -> None:
        upsert(auth_client, "2026-10-06", SDE, minutes=60, override=60)
        weekly = auth_client.get("/api/stats/weekly?today=2026-10-08").json()
        sde = next(w for w in weekly if w["category_id"] == SDE)
        assert [d["log_date"] for d in sde["days"] if d["has_override"]] == ["2026-10-06"]

    def test_inactive_day_reports_no_percent(self, auth_client: TestClient) -> None:
        weekly = auth_client.get("/api/stats/weekly?today=2026-10-08").json()
        sde = next(w for w in weekly if w["category_id"] == SDE)
        thursday = next(d for d in sde["days"] if d["log_date"] == "2026-10-08")
        assert thursday["is_active"] is False
        assert thursday["percent"] is None


class TestInsights:
    """Batch 4."""

    def test_calendar_covers_the_requested_range(self, auth_client: TestClient) -> None:
        body = auth_client.get(
            "/api/stats/calendar",
            params={
                "start": "2026-10-01",
                "end": "2026-10-31",
            },
        ).json()
        assert len(body[0]["days"]) == 31

    def test_calendar_rejects_a_backwards_range(self, auth_client: TestClient) -> None:
        response = auth_client.get(
            "/api/stats/calendar",
            params={
                "start": "2026-10-31",
                "end": "2026-10-01",
            },
        )
        assert response.status_code == 422

    def test_calendar_rejects_an_absurd_range(self, auth_client: TestClient) -> None:
        response = auth_client.get(
            "/api/stats/calendar",
            params={
                "start": "2020-01-01",
                "end": "2026-12-31",
            },
        )
        assert response.status_code == 422

    def test_insights_returns_series_and_patterns(self, auth_client: TestClient) -> None:
        for day in ("2026-10-05", "2026-10-06", "2026-10-07"):
            upsert(auth_client, day, SDE, minutes=180)
        body = auth_client.get(
            "/api/stats/insights",
            params={
                "days": 30,
                "today": "2026-10-08",
            },
        ).json()
        assert body["days"] == 30
        assert len(body["hours"]) == 24
        sde = next(c for c in body["categories"] if c["category_id"] == SDE)
        assert len(sde["points"]) == 30
        assert sde["consistency"]["days_counted"] > 0

    def test_weekday_breakdown_covers_seven_days(self, auth_client: TestClient) -> None:
        body = auth_client.get(
            "/api/stats/insights",
            params={
                "days": 30,
                "today": "2026-10-31",
            },
        ).json()
        weekdays = body["categories"][0]["weekday_breakdown"]
        assert [w["weekday"] for w in weekdays] == [
            "MON",
            "TUE",
            "WED",
            "THU",
            "FRI",
            "SAT",
            "SUN",
        ]

    def test_thursday_is_never_counted_for_sde(self, auth_client: TestClient) -> None:
        body = auth_client.get(
            "/api/stats/insights",
            params={
                "days": 30,
                "today": "2026-10-31",
            },
        ).json()
        sde = next(c for c in body["categories"] if c["category_id"] == SDE)
        thursday = next(w for w in sde["weekday_breakdown"] if w["weekday"] == "THU")
        assert thursday["days_counted"] == 0

    def test_steady_work_scores_higher_consistency_than_bursts(
        self, auth_client: TestClient
    ) -> None:
        """The metric that distinguishes 180/day from 1260 in one sitting."""
        steady_days = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]
        for day in steady_days:
            upsert(auth_client, day, SDE, minutes=180)
        # AI Automation: everything in one day, nothing on the others.
        upsert(auth_client, "2026-10-02", AI, minutes=240)
        for day in steady_days[1:]:
            upsert(auth_client, day, AI, minutes=0)

        body = auth_client.get(
            "/api/stats/insights",
            params={
                "days": 7,
                "today": "2026-10-05",
            },
        ).json()
        steady = next(c for c in body["categories"] if c["category_id"] == SDE)
        bursty = next(c for c in body["categories"] if c["category_id"] == AI)
        assert (
            steady["consistency"]["consistency_score"]
            > bursty["consistency"]["consistency_score"]
        )

    def test_comparison_against_the_preceding_period(
        self, auth_client: TestClient
    ) -> None:
        body = auth_client.get(
            "/api/stats/insights",
            params={
                "days": 7,
                "today": "2026-10-14",
            },
        ).json()
        comparison = body["comparison"][0]
        assert comparison["current"]["start"] == "2026-10-08"
        assert comparison["previous"]["end"] == "2026-10-07"

    def test_hand_entered_totals_have_no_time_of_day(
        self, auth_client: TestClient
    ) -> None:
        # A daily total has no hour attached and must not be invented.
        upsert(auth_client, "2026-10-05", SDE, minutes=600)
        body = auth_client.get(
            "/api/stats/insights",
            params={"days": 30, "today": "2026-10-08"},
        ).json()
        assert sum(h["minutes"] for h in body["hours"]) == 0

    def test_manual_session_without_a_start_time_is_excluded(
        self, auth_client: TestClient
    ) -> None:
        # Stored at midnight as a sentinel; counting it would invent a pattern.
        auth_client.post(
            "/api/sessions",
            json={"category_id": SDE, "log_date": "2026-10-05", "minutes": 90},
        )
        body = auth_client.get(
            "/api/stats/insights",
            params={"days": 30, "today": "2026-10-08"},
        ).json()
        assert sum(h["minutes"] for h in body["hours"]) == 0

    def test_manual_session_with_a_start_time_is_counted(
        self, auth_client: TestClient
    ) -> None:
        # A real clock time is real information, whoever typed it in.
        day = date.today() - timedelta(days=2)
        auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": day.isoformat(),
                "minutes": 90,
                "started_at": f"{day.isoformat()}T14:30:00",
            },
        )
        body = auth_client.get(
            "/api/stats/insights",
            params={"days": 30, "today": (day + timedelta(days=1)).isoformat()},
        ).json()
        hour = next(h for h in body["hours"] if h["hour"] == 14)
        assert hour["minutes"] == 90
        assert sum(h["minutes"] for h in body["hours"]) == 90


class TestHealth:
    def test_health_needs_no_session(self, client: TestClient) -> None:
        body = client.get("/api/health").json()
        assert body["status"] == "ok"
