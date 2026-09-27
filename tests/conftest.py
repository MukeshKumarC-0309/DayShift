"""Shared fixtures: an isolated database and an authenticated API client.

Every test gets its own SQLite file in a tmp directory, so tests never touch
the developer's real dayshift.db and can run in any order.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Iterator
from pathlib import Path

# --- Environment -------------------------------------------------------------
# This block runs at import time, before pytest collects any test module. That
# ordering matters: backend.config reads os.environ at import, and test modules
# import scoring (which imports config) at *their* module level. Setting these
# inside a fixture would be too late — config would already hold the developer's
# real .env values and every login in the suite would fail.

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

TEST_USERNAME = "testuser"
TEST_PASSCODE = "correct-horse-battery-staple"

os.environ["JWT_SECRET"] = "test-secret-key-long-enough-to-pass-startup-validation"
os.environ["TRACKING_START_DATE"] = "2026-10-01"
os.environ["LOG_LEVEL"] = "WARNING"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    """Build a TestClient wired to an isolated database."""
    import app as app_module
    import database

    engine = create_engine(
        f"sqlite:///{tmp_path / 'api.db'}", connect_args={"check_same_thread": False}
    )
    maker = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    # Point the lifespan bootstrap and the request dependency at the temp file,
    # so migrations and seeding run against the throwaway database. config is
    # patched too because Alembic reads the URL from there.
    import config

    database.engine = engine
    database.SessionLocal = maker
    config.DATABASE_PATH = tmp_path / "api.db"
    config.DATABASE_URL = f"sqlite:///{tmp_path / 'api.db'}"
    database.DATABASE_URL = config.DATABASE_URL
    # Credentials live in a file; point it at the temp directory so tests
    # never read or write the developer's real auth.json.
    config.CREDENTIALS_PATH = tmp_path / "auth.json"
    # Snapshots and restores must never touch the developer's real backups/.
    config.BACKUPS_DIR = tmp_path / "backups"

    def override_get_db() -> Iterator[Session]:
        session = maker()
        try:
            yield session
        finally:
            session.close()

    app_module.app.dependency_overrides[database.get_db] = override_get_db

    with TestClient(app_module.app) as test_client:
        yield test_client

    app_module.app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture(autouse=True)
def _clear_login_throttle() -> Iterator[None]:
    """Reset the in-process login throttle around every test.

    It is module-level state shared by the whole process, so without this a
    test that exhausts the attempt budget would break unrelated tests.
    """
    from auth import reset_attempts

    reset_attempts()
    yield
    reset_attempts()


@pytest.fixture
def configured_client(client: TestClient) -> TestClient:
    """Build a TestClient where first-run setup has been completed."""
    response = client.post(
        "/api/auth/setup",
        json={"username": TEST_USERNAME, "passcode": TEST_PASSCODE},
    )
    assert response.status_code == 201, response.text
    return client


@pytest.fixture
def auth_client(configured_client: TestClient) -> TestClient:
    """Build a TestClient holding a valid session cookie."""
    # `setup` signs in, so the cookie is already set.
    status = configured_client.get("/api/auth/status").json()
    assert status["authenticated"] is True
    return configured_client
