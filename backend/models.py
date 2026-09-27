"""SQLAlchemy ORM models.

Storage rules enforced here:
  * minutes are INTEGER, never float (avoids rounding drift)
  * dates are TEXT in ISO 8601 `YYYY-MM-DD`, datetimes `YYYY-MM-DDTHH:MM:SS`,
    both in the user's local timezone (single user, single timezone)

A day's total for a category is `daily_logs.minutes_logged` (typed in by hand)
PLUS the sum of that day's `sessions` (measured by the timer). The two are kept
separate on purpose so "measured" and "recalled" never blur together.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Declarative base for every ORM model in the app."""


def _now_iso() -> str:
    """Local-time ISO 8601 timestamp, second precision, for audit columns."""
    return datetime.now().replace(microsecond=0).isoformat()


class Category(Base):
    """A trackable category.

    Identity only — the target and the active weekdays live in
    `category_targets`, because they change over time and history must keep the
    values that applied when it was recorded.
    """

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Which domain the dashboard shows this category under. Domains are paged
    # one at a time so six categories never land on the screen at once.
    group_name: Mapped[str] = mapped_column(
        String(32), nullable=False, default="Projects", server_default="Projects"
    )
    # Archived categories keep their history but drop off the dashboard. Never
    # delete a category that has logs — the logs would lose their meaning.
    archived_at: Mapped[str | None] = mapped_column(String(19), nullable=True)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)
    updated_at: Mapped[str] = mapped_column(
        String(19), nullable=False, default=_now_iso, onupdate=_now_iso
    )

    targets: Mapped[list[CategoryTarget]] = relationship(
        back_populates="category",
        cascade="all, delete-orphan",
        order_by="CategoryTarget.effective_from",
    )
    logs: Mapped[list[DailyLog]] = relationship(
        back_populates="category", cascade="all, delete-orphan"
    )
    sessions: Mapped[list[Session]] = relationship(
        back_populates="category", cascade="all, delete-orphan"
    )

    @property
    def is_archived(self) -> bool:
        """Whether this category has been archived."""
        return self.archived_at is not None


class CategoryTarget(Base):
    """A target and schedule that applied to a category from a given date.

    Effective-dated so that changing today's target never rewrites the past.
    Scoring resolves the record with the latest `effective_from` that is not
    after the day being scored.
    """

    __tablename__ = "category_targets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    effective_from: Mapped[str] = mapped_column(String(10), nullable=False)
    daily_target_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    # Comma-separated day codes, e.g. "MON,TUE,WED,FRI,SAT,SUN".
    active_days: Mapped[str] = mapped_column(Text, nullable=False)
    # Optional alternative finish line, counted in questions solved (DSA:
    # 2 questions OR 120 minutes, whichever comes first). NULL for categories
    # measured in minutes alone. Effective-dated with the rest of the target,
    # so changing it never rescores the past.
    question_target: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)

    category: Mapped[Category] = relationship(back_populates="targets")

    __table_args__ = (
        UniqueConstraint("category_id", "effective_from", name="uq_target_category_date"),
        CheckConstraint("daily_target_minutes >= 0", name="ck_target_nonneg"),
    )


class DailyLog(Base):
    """Hand-entered minutes for one category on one date, plus any override.

    `minutes_logged` covers work NOT captured by the timer. The day's true
    total is this plus the day's sessions.

    A row may exist with `minutes_logged = 0` and a non-null
    `override_target_minutes` — that is how a future override is set in
    advance, before the day has happened.
    """

    __tablename__ = "daily_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    log_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    minutes_logged: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Problems solved that day, for categories with a question target. Stored
    # as a count, never converted — the conversion to credited minutes happens
    # at scoring time against the target in force on the day.
    questions_solved: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # NULL means "use the scheduled target for this date".
    override_target_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # When the override was written. Distinct from `updated_at`, which also
    # moves when minutes are edited — the honesty ledger needs to know when the
    # TARGET changed, so it can tell an override set in advance from one set
    # after the day had already been missed.
    override_set_at: Mapped[str | None] = mapped_column(String(19), nullable=True)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)
    updated_at: Mapped[str] = mapped_column(
        String(19), nullable=False, default=_now_iso, onupdate=_now_iso
    )

    category: Mapped[Category] = relationship(back_populates="logs")

    __table_args__ = (
        UniqueConstraint("log_date", "category_id", name="uq_log_date_category"),
        CheckConstraint("minutes_logged >= 0", name="ck_log_minutes_nonneg"),
        CheckConstraint("questions_solved >= 0", name="ck_log_questions_nonneg"),
        CheckConstraint(
            "override_target_minutes IS NULL OR override_target_minutes >= 0",
            name="ck_log_override_nonneg",
        ),
    )


class Session(Base):
    """One block of measured work.

    A session with `ended_at IS NULL` is still running; its `minutes` are 0
    until it stops, and the live elapsed time is computed on read rather than
    written continuously.
    """

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Denormalised from started_at so day queries stay simple and indexable.
    log_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    started_at: Mapped[str] = mapped_column(String(19), nullable=False)
    ended_at: Mapped[str | None] = mapped_column(String(19), nullable=True)
    minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # "timer" = measured by the stopwatch, "manual" = typed in afterwards.
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="timer")
    # Focus mode: when the block is due to end. A running session past this is
    # closed AT this time (see sessions_service.settle_expired), so a focus
    # block left unattended records exactly what was planned, not the night.
    planned_end: Mapped[str | None] = mapped_column(String(19), nullable=True)
    # Exam prep: the exam (a `deadlines` row) this work was for. Not a foreign
    # key at the database level; deleting the exam clears it.
    deadline_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # What the timer measured, kept when a timer session's minutes are edited
    # by hand. Editing also turns `source` to "manual", so edited time is never
    # read as measured time — but the measurement itself is not lost.
    measured_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # A git branch or issue reference the work was on ("feature/auth", "#42").
    # Plain text: nothing is looked up, so no network and no repo required.
    git_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)
    updated_at: Mapped[str] = mapped_column(
        String(19), nullable=False, default=_now_iso, onupdate=_now_iso
    )

    category: Mapped[Category] = relationship(back_populates="sessions")
    tags: Mapped[list[Tag]] = relationship(
        secondary="session_tags", back_populates="sessions"
    )

    __table_args__ = (
        Index("ix_sessions_date_category", "log_date", "category_id"),
        CheckConstraint("minutes >= 0", name="ck_session_minutes_nonneg"),
        CheckConstraint("source IN ('timer', 'manual')", name="ck_session_source"),
    )

    @property
    def is_running(self) -> bool:
        """Whether this session is still open."""
        return self.ended_at is None


class Tag(Base):
    """A free-form label applied to sessions, for sub-category rollups."""

    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(48), unique=True, nullable=False)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)

    sessions: Mapped[list[Session]] = relationship(
        secondary="session_tags", back_populates="tags"
    )


class SessionTag(Base):
    """Join table between sessions and tags."""

    __tablename__ = "session_tags"

    session_id: Mapped[int] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )


class Setting(Base):
    """A single editable application setting.

    Thresholds and window sizes live here rather than in config.py so they can
    be changed from the Settings page. config.py still supplies the defaults
    used when a key is absent.
    """

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(
        String(19), nullable=False, default=_now_iso, onupdate=_now_iso
    )


class WeeklyReview(Base):
    """A written reflection on one ISO week.

    The numbers are computed; this is the part only you can supply. Keyed by
    the week's Monday so a week has exactly one review.
    """

    __tablename__ = "weekly_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    week_start: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    reflection: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)
    updated_at: Mapped[str] = mapped_column(
        String(19), nullable=False, default=_now_iso, onupdate=_now_iso
    )


class Commitment(Base):
    """What you said you would do in a given week, per category.

    Deliberately separate from targets: a target is the standing expectation,
    a commitment is what you claimed you would actually manage that week. The
    gap between the two is the interesting number.
    """

    __tablename__ = "commitments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    week_start: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)
    updated_at: Mapped[str] = mapped_column(
        String(19), nullable=False, default=_now_iso, onupdate=_now_iso
    )

    __table_args__ = (
        UniqueConstraint("week_start", "category_id", name="uq_commitment_week_category"),
        CheckConstraint("minutes >= 0", name="ck_commitment_minutes_nonneg"),
    )


# --- Life tracking: practice, check-ins, deadlines ---------------------------


class Problem(Base):
    """One DSA problem you solved, kept so it can come back for revision.

    Logging a problem also counts one question for its category on the day it
    was solved, so the log and the `+1 Q` count stay in step. A REVISION never
    counts as a question: the question target measures new problems solved.
    """

    __tablename__ = "problems"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    topic: Mapped[str] = mapped_column(String(48), nullable=False)
    # easy / medium / hard
    difficulty: Mapped[str] = mapped_column(String(8), nullable=False)
    # Solved only with a hint or an editorial — a weaker signal of mastery.
    needed_hint: Mapped[bool] = mapped_column(nullable=False, default=False)
    solved_on: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)
    updated_at: Mapped[str] = mapped_column(
        String(19), nullable=False, default=_now_iso, onupdate=_now_iso
    )

    reviews: Mapped[list[ProblemReview]] = relationship(
        back_populates="problem",
        cascade="all, delete-orphan",
        order_by="ProblemReview.reviewed_on",
    )

    __table_args__ = (
        CheckConstraint(
            "difficulty IN ('easy', 'medium', 'hard')", name="ck_problem_difficulty"
        ),
    )


class ProblemReview(Base):
    """One revision of a problem, and how it went."""

    __tablename__ = "problem_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    problem_id: Mapped[int] = mapped_column(
        ForeignKey("problems.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reviewed_on: Mapped[str] = mapped_column(String(10), nullable=False)
    # solid = solved cleanly, shaky = solved with struggle, forgot = could not
    outcome: Mapped[str] = mapped_column(String(8), nullable=False)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)

    problem: Mapped[Problem] = relationship(back_populates="reviews")

    __table_args__ = (
        CheckConstraint(
            "outcome IN ('solid', 'shaky', 'forgot')", name="ck_review_outcome"
        ),
    )


class CheckIn(Base):
    """How a day started: last night's sleep, energy and mood.

    Context only — never feeds a score. A day with no row is shown as a gap,
    never filled in or guessed.
    """

    __tablename__ = "checkins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    check_date: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    # Sleep the night BEFORE check_date, in minutes (int, like every duration).
    sleep_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    energy: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mood: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)
    updated_at: Mapped[str] = mapped_column(
        String(19), nullable=False, default=_now_iso, onupdate=_now_iso
    )

    __table_args__ = (
        CheckConstraint(
            "sleep_minutes IS NULL OR (sleep_minutes >= 0 AND sleep_minutes <= 1440)",
            name="ck_checkin_sleep",
        ),
        CheckConstraint(
            "energy IS NULL OR energy BETWEEN 1 AND 5", name="ck_checkin_energy"
        ),
        CheckConstraint("mood IS NULL OR mood BETWEEN 1 AND 5", name="ck_checkin_mood"),
    )


class Deadline(Base):
    """An exam, an assignment, or anything else with a date.

    An EXAM sets target overrides on its day automatically — one per row in
    `deadline_overrides`. Those overrides are ordinary `daily_logs` overrides
    (so par, the weekly chart and the honesty ledger treat them like any
    other), tagged with the exam in `override_reason`.
    """

    __tablename__ = "deadlines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # exam / assignment / other
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    due_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    done_at: Mapped[str | None] = mapped_column(String(19), nullable=True)
    # How many minutes of study you mean to put in before it (optional).
    study_target_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)
    updated_at: Mapped[str] = mapped_column(
        String(19), nullable=False, default=_now_iso, onupdate=_now_iso
    )

    overrides: Mapped[list[DeadlineOverride]] = relationship(
        back_populates="deadline", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "kind IN ('exam', 'assignment', 'other')", name="ck_deadline_kind"
        ),
    )


class DeadlineOverride(Base):
    """The target an exam sets for one category on its day."""

    __tablename__ = "deadline_overrides"

    deadline_id: Mapped[int] = mapped_column(
        ForeignKey("deadlines.id", ondelete="CASCADE"), primary_key=True
    )
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), primary_key=True
    )
    target_minutes: Mapped[int] = mapped_column(Integer, nullable=False)

    deadline: Mapped[Deadline] = relationship(back_populates="overrides")

    __table_args__ = (
        CheckConstraint("target_minutes >= 0", name="ck_deadline_override_nonneg"),
    )


# --- Roadmap: milestones, daily plan, habits, git corroboration --------------


class Milestone(Base):
    """A concrete outcome within a category, e.g. "auth done", "v1 deployed".

    Minutes say how long you worked; milestones say what it produced. Never
    scored — the weekly review and the monthly letter list them.
    """

    __tablename__ = "milestones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # ISO date it was finished; NULL while open.
    done_on: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)
    updated_at: Mapped[str] = mapped_column(
        String(19), nullable=False, default=_now_iso, onupdate=_now_iso
    )


class PlanMinutes(Base):
    """Minutes planned for one category on one date, set the evening before.

    Separate from targets (the standing expectation) and commitments (the
    weekly promise): this is tomorrow's intent, compared with what happened.
    """

    __tablename__ = "plan_minutes"

    plan_date: Mapped[str] = mapped_column(String(10), primary_key=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), primary_key=True
    )
    minutes: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (CheckConstraint("minutes >= 0", name="ck_plan_minutes_nonneg"),)


class PlanTask(Base):
    """One free-text task planned for a date, ticked off when done."""

    __tablename__ = "plan_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plan_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    text: Mapped[str] = mapped_column(String(300), nullable=False)
    done: Mapped[bool] = mapped_column(nullable=False, default=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)


class Habit(Base):
    """A yes/no daily habit, e.g. "no phone the first hour".

    DECISION (chosen with the user): an unmarked day on which the habit
    applies counts as NOT DONE and breaks the streak — except today, which is
    still open. Only ticks are stored (`habit_checks`); absence is the "no".
    """

    __tablename__ = "habits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    # Comma-separated day codes, like category targets.
    active_days: Mapped[str] = mapped_column(Text, nullable=False)
    # First day it counts: days before a habit existed are never misses.
    start_date: Mapped[str] = mapped_column(String(10), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    archived_at: Mapped[str | None] = mapped_column(String(19), nullable=True)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)

    checks: Mapped[list[HabitCheck]] = relationship(
        back_populates="habit", cascade="all, delete-orphan"
    )


class HabitCheck(Base):
    """A habit done on a date. No row means not done."""

    __tablename__ = "habit_checks"

    habit_id: Mapped[int] = mapped_column(
        ForeignKey("habits.id", ondelete="CASCADE"), primary_key=True
    )
    check_date: Mapped[str] = mapped_column(String(10), primary_key=True)

    habit: Mapped[Habit] = relationship(back_populates="checks")


class GitRepo(Base):
    """A local git repository whose commits corroborate a category's time.

    Read-only: Dayshift only ever runs `git log` against it, and what it finds
    is shown beside your logs, never used to change them.
    """

    __tablename__ = "git_repos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    path: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)


class SessionChange(Base):
    """One change to recorded sessions, with what they looked like before.

    Deleting, editing, splitting or merging a session writes one of these.
    The sessions table only ever holds what currently counts, so nothing can
    count a deleted session by accident; this table is what makes a change
    undoable at any time and visible in the honesty ledger when it was made
    after the day it changed.
    """

    __tablename__ = "session_changes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # delete / edit / split / merge
    action: Mapped[str] = mapped_column(String(8), nullable=False)
    created_at: Mapped[str] = mapped_column(String(19), nullable=False, default=_now_iso)
    # The day the changed sessions belong to, and their category (before).
    log_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    category_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # JSON lists of full session snapshots (every column plus tag names).
    before_json: Mapped[str] = mapped_column(Text, nullable=False)
    after_json: Mapped[str] = mapped_column(Text, nullable=False)
    minutes_before: Mapped[int] = mapped_column(Integer, nullable=False)
    minutes_after: Mapped[int] = mapped_column(Integer, nullable=False)
    undone_at: Mapped[str | None] = mapped_column(String(19), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "action IN ('delete', 'edit', 'split', 'merge')", name="ck_change_action"
        ),
    )
