"""Dayshift — FastAPI application entrypoint.

Run from the project root via ./start.sh, or directly:
    uvicorn app:app --reload --port 8000   (with cwd = backend/)
"""

from __future__ import annotations

import asyncio
import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import config
import database
import exporter
from database import init_db
from routers import (
    accountability,
    agenda,
    auth_routes,
    categories,
    checkins,
    corroboration,
    focus,
    goals,
    letter,
    logs,
    plan,
    practice,
    session_edits,
    session_search,
    sessions,
    settings_routes,
    stats,
)

logger = logging.getLogger("dayshift")


def _configure_logging() -> None:
    """One stream handler with a compact, greppable format.

    Deliberately plain text rather than JSON: the only consumer is a human
    reading backend.log in a terminal.
    """
    logging.basicConfig(
        level=getattr(logging, config.LOG_LEVEL, logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
    )


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Validate configuration, then create tables and seed categories.

    Configuration is checked before anything else so a missing secret fails
    here with an actionable message, rather than at the first login.
    """
    _configure_logging()
    try:
        config.validate()
    except config.ConfigError as exc:
        logger.error("%s", exc)
        raise

    init_db()
    weekly_export = asyncio.create_task(_weekly_export_loop())
    logger.info(
        "Dayshift ready — database %s, tracking from %s",
        config.DATABASE_PATH.name,
        config.TRACKING_START_DATE.isoformat(),
    )
    yield
    weekly_export.cancel()
    logger.info("Dayshift shutting down")


# How often the backend checks whether a weekly export is due.
EXPORT_CHECK_SECONDS = 60 * 60


def _export_if_due() -> None:
    session = database.SessionLocal()
    try:
        exporter.export_to_folder(session)
    except OSError:
        logger.warning("Weekly export failed", exc_info=True)
    finally:
        session.close()


async def _weekly_export_loop() -> None:
    """Write the weekly export when due: at startup, then hourly.

    Runs in a worker thread so a slow cloud-synced folder never blocks a
    request. With no folder set it does nothing.
    """
    while True:
        await asyncio.to_thread(_export_if_due)
        await asyncio.sleep(EXPORT_CHECK_SECONDS)


app = FastAPI(
    title="Dayshift",
    description="Single-user daily study-time tracker.",
    version="1.18.3",
    lifespan=lifespan,
)

# The Vite dev server proxies /api to this server, so requests are same-origin
# in normal use. CORS with credentials is kept for the case where the frontend
# is opened directly against port 8000 during debugging.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log the traceback, return a generic body.

    Stack traces belong in backend.log, not in an HTTP response — even on
    localhost, keeping the two separate means the UI never renders internals.
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )


app.include_router(accountability.router)
app.include_router(agenda.router)
app.include_router(auth_routes.router)
app.include_router(categories.router)
app.include_router(checkins.router)
app.include_router(corroboration.router)
app.include_router(goals.router)
app.include_router(letter.router)
app.include_router(logs.router)
app.include_router(plan.router)
app.include_router(practice.router)
app.include_router(sessions.router)
app.include_router(focus.router)
app.include_router(session_edits.router)
app.include_router(session_search.router)
app.include_router(settings_routes.router)
app.include_router(stats.router)


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, str]:
    """Liveness probe — used by start.sh to wait for the backend to come up."""
    return {"status": "ok", "version": app.version}
