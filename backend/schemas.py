"""Pydantic request/response models, kept out of the route modules."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

# --- Auth --------------------------------------------------------------------


class LoginRequest(BaseModel):
    """A submitted username and passcode."""

    username: str = Field(min_length=1, max_length=64)
    passcode: str = Field(min_length=1, max_length=256)


class SetupRequest(BaseModel):
    """First-run credential setup."""

    username: str = Field(min_length=3, max_length=32)
    passcode: str = Field(min_length=8, max_length=256)
    # Required only when the server has SETUP_TOKEN set (public hosting).
    setup_token: str | None = Field(default=None, max_length=256)


class CredentialUpdate(BaseModel):
    """Change the username and/or passcode, given the current passcode."""

    current_passcode: str = Field(min_length=1, max_length=256)
    username: str | None = Field(default=None, min_length=3, max_length=32)
    new_passcode: str | None = Field(default=None, min_length=8, max_length=256)


class AuthStatus(BaseModel):
    """Whether setup has happened, and whether the caller holds a session."""

    # False on a fresh install: the SPA routes to the setup screen.
    configured: bool
    authenticated: bool
    username: str | None = None
    # True when setup must present the server's SETUP_TOKEN.
    setup_token_required: bool = False


# --- Categories --------------------------------------------------------------


class CategoryOut(BaseModel):
    """A category, with the target and schedule in force today."""

    id: int
    name: str
    display_order: int
    archived: bool
    # Resolved as of today, so existing clients keep the shape they expect.
    daily_target_minutes: int
    active_days: str
    # The dashboard domain this category is paged under.
    group_name: str = "Projects"
    # Alternative finish line in questions, as of today; None for minutes-only.
    question_target: int | None = None


class TargetOut(BaseModel):
    """One record in a category's target history."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int
    effective_from: str
    daily_target_minutes: int
    active_days: str
    question_target: int | None = None
    created_at: str


class CategoryCreate(BaseModel):
    """A new category and its opening target."""

    name: str = Field(min_length=1, max_length=64)
    daily_target_minutes: int = Field(ge=0, le=1440)
    active_days: str = Field(min_length=3)
    effective_from: date | None = None
    group_name: str | None = Field(default=None, min_length=1, max_length=32)
    question_target: int | None = Field(default=None, ge=1, le=50)


class CategoryUpdate(BaseModel):
    """Rename, reorder, or archive a category. Targets change separately."""

    name: str | None = Field(default=None, min_length=1, max_length=64)
    display_order: int | None = Field(default=None, ge=0)
    archived: bool | None = None
    group_name: str | None = Field(default=None, min_length=1, max_length=32)


class TargetCreate(BaseModel):
    """Set a category's target from a given date onward.

    `effective_from` defaults to today: changing a target is a decision about
    the future, and backdating one silently rewrites history.
    """

    daily_target_minutes: int = Field(ge=0, le=1440)
    active_days: str = Field(min_length=3)
    effective_from: date | None = None
    # Optional second finish line in questions (whichever comes first).
    # Omitted carries forward the value already in force, so editing DSA's
    # minutes never silently drops its question target; 0 removes it.
    question_target: int | None = Field(default=None, ge=0, le=50)


class CategoryReorder(BaseModel):
    """The desired dashboard order, as category ids."""

    category_ids: list[int]


# --- Settings ----------------------------------------------------------------


class SettingOut(BaseModel):
    """One editable setting, with the metadata the UI needs to render it."""

    key: str
    label: str
    kind: str
    value: str
    default: str
    minimum: float | None
    maximum: float | None
    help: str
    group: str = "scoring"


class SettingsUpdate(BaseModel):
    """A batch of setting changes, applied atomically."""

    values: dict[str, str | int | float | bool]


# --- Logs --------------------------------------------------------------------


class LogUpsert(BaseModel):
    """Create-or-update one (date, category) log row.

    `minutes_logged` here is hand-entered time only — the timer's sessions are
    added on top of it when a day is scored.
    """

    log_date: date
    category_id: int
    minutes_logged: int | None = Field(default=None, ge=0, le=1440)
    # Questions solved that day; omitted leaves the stored count unchanged.
    questions_solved: int | None = Field(default=None, ge=0, le=100)
    # Tri-state: omitted = leave unchanged, `clear_override` = remove it,
    # an integer = set it.
    override_target_minutes: int | None = Field(default=None, ge=0, le=1440)
    override_reason: str | None = Field(default=None, max_length=500)
    clear_override: bool = False


class LogAdjust(BaseModel):
    """Add to (or, for an undo, take from) one day's hand-entered numbers.

    The quick-add buttons send a delta rather than a new total, so a click can
    never overwrite a value typed in the log form a moment earlier from a
    stale copy of the row. A result below zero is refused rather than clamped:
    clamping would make an undo silently remove less than it added.
    """

    log_date: date
    category_id: int
    minutes_delta: int = Field(default=0, ge=-1440, le=1440)
    questions_delta: int = Field(default=0, ge=-100, le=100)


class LogOut(BaseModel):
    """One stored log row, exactly as persisted."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    log_date: str
    category_id: int
    minutes_logged: int
    questions_solved: int = 0
    override_target_minutes: int | None
    override_reason: str | None
    created_at: str
    updated_at: str


# --- Sessions ----------------------------------------------------------------


# A session's tags: short free-form labels, lowercased on save.
TagName = Annotated[str, Field(max_length=48)]
TagList = Annotated[list[TagName], Field(max_length=12)]
# A git branch or issue reference: one line of plain text.
GitRef = Annotated[str, Field(max_length=120, pattern=r"^[^\r\n]*$")]


class SessionOut(BaseModel):
    """One block of work, measured or entered by hand."""

    id: int
    category_id: int
    log_date: str
    started_at: str
    ended_at: str | None
    minutes: int
    note: str | None
    source: str
    tags: list[str]
    is_running: bool
    # Live elapsed minutes for a running session; equals `minutes` once stopped.
    elapsed_minutes: int
    # Focus mode: when the block ends by itself (None for an open-ended timer).
    planned_end: str | None = None
    # Exam prep: the exam this work was for.
    deadline_id: int | None = None
    # Set when a timer session's minutes were edited: what the timer measured.
    measured_minutes: int | None = None
    # A git branch or issue reference ("feature/auth", "#42"), plain text.
    git_ref: str | None = None


class SessionStart(BaseModel):
    """Start the timer for a category."""

    category_id: int
    note: str | None = Field(default=None, max_length=500)
    tags: TagList = Field(default_factory=list)
    git_ref: GitRef | None = None
    # Focus mode: stop by itself after this many minutes.
    planned_minutes: int | None = Field(default=None, ge=1, le=240)
    # Exam prep: count this session toward an exam.
    deadline_id: int | None = None


class SessionCreate(BaseModel):
    """Add a finished block of work by hand."""

    category_id: int
    log_date: date
    minutes: int = Field(ge=0, le=1440)
    # "YYYY-MM-DDTHH:MM[:SS]" on `log_date`. Omitted = no clock time (stored
    # at midnight as a sentinel, left out of time-of-day charts and overlaps).
    started_at: str | None = None
    note: str | None = Field(default=None, max_length=500)
    tags: TagList = Field(default_factory=list)
    git_ref: GitRef | None = None
    # Exam prep: count this session toward an exam.
    deadline_id: int | None = None


class SessionUpdate(BaseModel):
    """Edit a stored session."""

    minutes: int | None = Field(default=None, ge=0, le=1440)
    note: str | None = Field(default=None, max_length=500)
    log_date: date | None = None
    category_id: int | None = None
    tags: TagList | None = None
    # Branch or issue; "" clears it.
    git_ref: GitRef | None = None
    # Link to an exam, or 0 to unlink.
    deadline_id: int | None = Field(default=None, ge=0)


class SessionSplit(BaseModel):
    """Split one session into two at a given number of minutes."""

    at_minute: int = Field(ge=1)


class RestoreExportRequest(BaseModel):
    """Replace everything with an export file's data; `confirm` must be RESTORE."""

    confirm: str
    data: dict[str, Any]


class FocusLength(BaseModel):
    """Focus blocks of one planned length."""

    planned_minutes: int
    blocks: int
    finished: int


class FocusStats(BaseModel):
    """Focus blocks in a period: finished vs ended early."""

    start: str
    end: str
    blocks: int
    finished: int
    ended_early: int
    focus_minutes: int
    # How long the early ones ran, on average (None when none ended early).
    average_early_minutes: int | None
    by_length: list[FocusLength]


class RefCommits(BaseModel):
    """Commits that day on a session's branch or mentioning its issue."""

    session_id: int
    git_ref: str
    # None when no linked repository has that branch.
    commits: int | None


class SessionChangeOut(BaseModel):
    """One recorded change to sessions, for Undo and the honesty ledger."""

    id: int
    action: str  # delete / edit / split / merge
    created_at: str
    log_date: str
    category_id: int
    category_name: str
    minutes_before: int
    minutes_after: int
    sessions_before: int
    notes: list[str]
    # Made on a later day than the sessions' own.
    after_the_fact: bool
    undone_at: str | None


class SessionMerge(BaseModel):
    """Merge sessions of one category on one day into a single session."""

    session_ids: list[int] = Field(min_length=2, max_length=20)


class TagOut(BaseModel):
    """A tag with how often it has been used."""

    id: int
    name: str
    session_count: int
    total_minutes: int


# --- Stats -------------------------------------------------------------------


class TodayProgress(BaseModel):
    """One category's live progress for today, for the gauge."""

    category_id: int
    category_name: str
    minutes_logged: int  # manual + timed, combined
    manual_minutes: int
    timed_minutes: int
    questions_solved: int = 0
    question_target: int | None = None
    # What scoring counts: minutes, or the questions' equivalent if further.
    credited_minutes: int = 0
    target_minutes: int  # effective target for today
    default_target_minutes: int  # the scheduled target, ignoring any override
    has_override: bool
    is_active_today: bool
    percent: float


class ParScore(BaseModel):
    """Rolling par over the configured window, ending yesterday by default."""

    category_id: int
    category_name: str
    par_percent: float | None
    previous_par_percent: float | None
    trend: str
    days_counted: int
    minutes_total: int
    target_total: int
    consecutive_days_below: int
    status: str
    window_start: str | None
    window_end: str | None


class WeeklyDay(BaseModel):
    """One day in the weekly chart, for one category."""

    log_date: str
    weekday: str
    minutes_logged: int
    questions: int = 0
    target_minutes: int
    has_override: bool
    is_active: bool
    is_tracked: bool
    percent: float | None


class WeeklyCategory(BaseModel):
    """One category's slice of the weekly chart."""

    category_id: int
    category_name: str
    days: list[WeeklyDay]


class RunningSession(BaseModel):
    """The session currently being timed, if any."""

    session: SessionOut | None


class DashboardOut(BaseModel):
    """Everything the dashboard needs, in one round trip."""

    today: str
    tracking_start_date: str
    progress: list[TodayProgress]
    par: list[ParScore]
    weekly: list[WeeklyCategory]
    categories: list[CategoryOut]
    running: SessionOut | None


# --- Batch 3: day detail and search ------------------------------------------


class DayCategoryDetail(BaseModel):
    """One category's full record for a single date."""

    category_id: int
    category_name: str
    manual_minutes: int
    timed_minutes: int
    questions_solved: int = 0
    question_target: int | None = None
    total_minutes: int
    target_minutes: int
    is_active: bool
    has_override: bool
    override_reason: str | None
    percent: float | None
    sessions: list[SessionOut]


class DayDetail(BaseModel):
    """Everything recorded on one date."""

    log_date: str
    weekday: str
    is_tracked: bool
    categories: list[DayCategoryDetail]


class SearchHit(BaseModel):
    """A session matching a search."""

    session: SessionOut
    category_name: str


class TagRollupRow(BaseModel):
    """One tag's time over a period, and which categories it came from."""

    name: str
    session_count: int
    total_minutes: int
    # category_id -> minutes, largest first when read in order.
    by_category: dict[int, int]


class TagRollup(BaseModel):
    """Time per tag between two dates (inclusive).

    A session with two tags counts toward both, so the rows can add up to
    more than `total_minutes`; `untagged_minutes` is what carries no tag.
    """

    start: str
    end: str
    total_minutes: int
    untagged_minutes: int
    tags: list[TagRollupRow]
    # The same per branch/issue reference (sessions without one are left out).
    branches: list[TagRollupRow] = []


# --- Batch 4: longer horizons ------------------------------------------------


class CalendarDay(BaseModel):
    """One cell in the month heatmap."""

    log_date: str
    minutes: int
    target_minutes: int
    percent: float | None
    is_active: bool
    is_tracked: bool
    has_override: bool


class CalendarCategory(BaseModel):
    """One category's heatmap series."""

    category_id: int
    category_name: str
    days: list[CalendarDay]


class RangePoint(BaseModel):
    """One day in a long-range series."""

    log_date: str
    minutes: int
    target_minutes: int
    percent: float | None
    moving_average: float | None


class WeekdayStat(BaseModel):
    """Aggregate performance for one weekday."""

    weekday: str
    days_counted: int
    minutes_total: int
    target_total: int
    percent: float | None


class HourStat(BaseModel):
    """How many timed minutes land in one hour of the day."""

    hour: int
    minutes: int


class ConsistencyStat(BaseModel):
    """How evenly the work is spread, not just how much there was."""

    category_id: int
    category_name: str
    days_counted: int
    mean_percent: float
    stdev_percent: float
    # 0-100; high means steady, low means feast-and-famine.
    consistency_score: float
    longest_streak: int
    best_day: str | None
    best_day_minutes: int


class RangeCategory(BaseModel):
    """One category over a long range, with its derived statistics."""

    category_id: int
    category_name: str
    points: list[RangePoint]
    par_percent: float | None
    minutes_total: int
    target_total: int
    days_counted: int
    weekday_breakdown: list[WeekdayStat]
    consistency: ConsistencyStat


class PeriodSummary(BaseModel):
    """Totals for one period, for side-by-side comparison."""

    label: str
    start: str
    end: str
    minutes_total: int
    target_total: int
    par_percent: float | None
    days_counted: int


class CategoryComparison(BaseModel):
    """One category across two periods."""

    category_id: int
    category_name: str
    current: PeriodSummary
    previous: PeriodSummary
    delta_percent: float | None


class InsightsOut(BaseModel):
    """The whole long-horizon view, in one round trip."""

    start: str
    end: str
    days: int
    categories: list[RangeCategory]
    hours: list[HourStat]
    comparison: list[CategoryComparison]


# --- Batch 5: accountability --------------------------------------------------


class PaceOut(BaseModel):
    """What is still required to finish the current week at 100%."""

    category_id: int
    category_name: str
    week_start: str
    week_end: str
    minutes_logged: int
    target_total: int
    days_remaining: int
    minutes_remaining: int
    minutes_per_remaining_day: int | None
    on_track: bool
    percent: float


class RecordsOut(BaseModel):
    """Personal bests for one category."""

    category_id: int
    category_name: str
    current_streak: int
    longest_streak: int
    best_day: str | None
    best_day_minutes: int
    best_week: str | None
    best_week_minutes: int
    total_minutes: int
    days_tracked: int


class CommitmentOut(BaseModel):
    """What was promised for a week, next to what actually happened."""

    category_id: int
    category_name: str
    week_start: str
    committed_minutes: int | None
    actual_minutes: int
    target_minutes: int
    # actual - committed; None when nothing was committed.
    delta_minutes: int | None
    kept: bool | None


class CommitmentSet(BaseModel):
    """Declare an intention for a week."""

    week_start: date
    category_id: int
    minutes: int = Field(ge=0, le=10080)


class WeekCategorySummary(BaseModel):
    """One category's numbers for a single week."""

    category_id: int
    category_name: str
    minutes_logged: int
    target_total: int
    percent: float | None
    days_counted: int
    best_day: str | None
    best_day_minutes: int


class WeeklyReviewOut(BaseModel):
    """A week's numbers plus whatever was written about it."""

    week_start: str
    week_end: str
    is_current_week: bool
    reflection: str
    reviewed_at: str | None
    categories: list[WeekCategorySummary]
    commitments: list[CommitmentOut]
    total_minutes: int


class ReflectionSet(BaseModel):
    """Save the written part of a weekly review."""

    week_start: date
    reflection: str = Field(max_length=5000)


class LedgerEntry(BaseModel):
    """An override applied after the day it governs had already passed."""

    log_date: str
    category_id: int
    category_name: str
    scheduled_target: int
    override_target: int
    minutes_logged: int
    override_reason: str | None
    override_set_at: str
    days_late: int
    # True when the override lowered the bar for a day already in the past.
    lowered: bool


class HonestyLedger(BaseModel):
    """Retroactive overrides, surfaced rather than prevented."""

    entries: list[LedgerEntry]
    total_retroactive: int
    total_lowered: int


class BulkOverride(BaseModel):
    """Apply one override across a date range — an exam week, a trip."""

    start: date
    end: date
    category_ids: list[int]
    override_target_minutes: int = Field(ge=0, le=1440)
    reason: str | None = Field(default=None, max_length=500)
    # Only touch days the category is actually scheduled on.
    active_days_only: bool = True


# --- Practice: the DSA problem log -------------------------------------------


class ProblemCreate(BaseModel):
    """Log a solved problem. Counts one question for its category that day."""

    title: str = Field(min_length=1, max_length=200)
    url: str | None = Field(default=None, max_length=2000)
    topic: str = Field(min_length=1, max_length=48)
    difficulty: str = Field(pattern="^(easy|medium|hard)$")
    needed_hint: bool = False
    solved_on: date
    notes: str | None = Field(default=None, max_length=2000)
    # Omitted: the first category that has a question target (DSA).
    category_id: int | None = None


class ProblemUpdate(BaseModel):
    """Edit a logged problem; moving its date moves the question it counted."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    url: str | None = Field(default=None, max_length=2000)
    topic: str | None = Field(default=None, min_length=1, max_length=48)
    difficulty: str | None = Field(default=None, pattern="^(easy|medium|hard)$")
    needed_hint: bool | None = None
    solved_on: date | None = None
    notes: str | None = Field(default=None, max_length=2000)


class ReviewCreate(BaseModel):
    """Record one revision of a problem."""

    outcome: str = Field(pattern="^(solid|shaky|forgot)$")
    reviewed_on: date | None = None  # defaults to today


class ReviewOut(BaseModel):
    """One stored revision."""

    id: int
    reviewed_on: str
    outcome: str


class ProblemOut(BaseModel):
    """A problem with where it stands in its revision cycle."""

    id: int
    category_id: int
    title: str
    url: str | None
    topic: str
    difficulty: str
    needed_hint: bool
    solved_on: str
    notes: str | None
    reviews: list[ReviewOut]
    stage: int
    due_on: str | None
    mastered: bool
    overdue_days: int


class TopicStatOut(BaseModel):
    """How one topic is going."""

    topic: str
    problems: int
    needed_hint: int
    revisions: int
    forgotten: int
    mastered: int
    struggle: float


class PracticeSummary(BaseModel):
    """Everything the Practice page shows at the top."""

    due_today: list[ProblemOut]
    upcoming: list[ProblemOut]
    topics: list[TopicStatOut]
    total_problems: int
    mastered: int


# --- Check-ins ----------------------------------------------------------------


class CheckInSet(BaseModel):
    """Create or replace one day's check-in."""

    check_date: date
    sleep_minutes: int | None = Field(default=None, ge=0, le=1440)
    energy: int | None = Field(default=None, ge=1, le=5)
    mood: int | None = Field(default=None, ge=1, le=5)
    note: str | None = Field(default=None, max_length=1000)


class CheckInOut(BaseModel):
    """One stored check-in."""

    model_config = ConfigDict(from_attributes=True)

    check_date: str
    sleep_minutes: int | None
    energy: int | None
    mood: int | None
    note: str | None


class CheckInDay(BaseModel):
    """One day in the check-in strip: the check-in, or a gap (None)."""

    day: str
    checkin: CheckInOut | None
    # Share of that day's targets met (each category capped at 100%), or None
    # when nothing was scheduled or the day is not scored yet.
    completion: float | None


class CheckInBucket(BaseModel):
    """Average completion across days that share a sleep or energy band."""

    label: str
    days: int
    completion: float | None


class CheckInInsights(BaseModel):
    """Sleep and energy against how the day went."""

    start: str
    end: str
    days: list[CheckInDay]
    gaps: int
    by_sleep: list[CheckInBucket]
    by_energy: list[CheckInBucket]


# --- Agenda: deadlines and exams ---------------------------------------------


class DeadlineOverrideIn(BaseModel):
    """The target an exam sets for one category on its day."""

    category_id: int
    target_minutes: int = Field(ge=0, le=1440)


class DeadlineCreate(BaseModel):
    """Add an exam, assignment or other dated item.

    For an exam, omitted `overrides` means 0 min for every active category.
    """

    title: str = Field(min_length=1, max_length=200)
    kind: str = Field(pattern="^(exam|assignment|other)$")
    due_date: date
    notes: str | None = Field(default=None, max_length=2000)
    overrides: list[DeadlineOverrideIn] | None = None
    # Minutes of study you mean to put in before it (optional).
    study_target_minutes: int | None = Field(default=None, ge=0, le=60_000)


class DeadlineUpdate(BaseModel):
    """Edit a deadline. Exam overrides follow any change of date or targets."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    kind: str | None = Field(default=None, pattern="^(exam|assignment|other)$")
    due_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    done: bool | None = None
    overrides: list[DeadlineOverrideIn] | None = None
    # null clears the target.
    study_target_minutes: int | None = Field(default=None, ge=0, le=60_000)


class DeadlineOut(BaseModel):
    """A deadline with its countdown."""

    id: int
    title: str
    kind: str
    due_date: str
    notes: str | None
    done: bool
    days_left: int
    overrides: list[DeadlineOverrideIn]
    # Exam prep: finished session minutes linked to this item.
    studied_minutes: int = 0
    study_target_minutes: int | None = None
    # To reach the target: minutes a day from today to the day before, rounded
    # up to 5; 0 once reached; None without a target or once the day has come.
    needed_per_day: int | None = None


class TodayHabit(BaseModel):
    """A habit that applies today, and whether it is ticked."""

    id: int
    name: str
    done: bool


class TodaySummary(BaseModel):
    """The one-line agenda above the dashboard."""

    today: str
    revisions_due: int
    deadlines: list[DeadlineOut]
    checkin: CheckInOut | None
    habits: list[TodayHabit] = []
    plan_open_tasks: int = 0
    plan_minutes: int = 0


# --- Milestones -----------------------------------------------------------------


class MilestoneCreate(BaseModel):
    """A new milestone within a category."""

    category_id: int
    title: str = Field(min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)


class MilestoneUpdate(BaseModel):
    """Edit a milestone, or mark it done (`done_on`) / not done (`done: false`)."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)
    done: bool | None = None
    done_on: date | None = None
    category_id: int | None = None


class MilestoneOut(BaseModel):
    """One milestone."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int
    title: str
    notes: str | None
    display_order: int
    done_on: str | None


# --- Daily plan -------------------------------------------------------------------


class PlanMinutesIn(BaseModel):
    """Planned minutes for one category; 0 removes the plan for it."""

    category_id: int
    minutes: int = Field(ge=0, le=1440)


class PlanMinutesSet(BaseModel):
    """Replace a day's planned minutes."""

    items: list[PlanMinutesIn]


class PlanTaskCreate(BaseModel):
    """A task for a day."""

    text: str = Field(min_length=1, max_length=300)


class PlanTaskUpdate(BaseModel):
    """Edit or tick a task."""

    text: str | None = Field(default=None, min_length=1, max_length=300)
    done: bool | None = None


class PlanTaskOut(BaseModel):
    """One task."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    plan_date: str
    text: str
    done: bool
    position: int


class PlanCategoryRow(BaseModel):
    """Planned against actual for one category on one day."""

    category_id: int
    category_name: str
    planned: int | None
    # Real minutes worked (typed + timed). None for a day still in the future.
    actual: int | None


class DayPlan(BaseModel):
    """Everything planned for a day, and how it went."""

    plan_date: str
    is_past: bool
    is_today: bool
    categories: list[PlanCategoryRow]
    tasks: list[PlanTaskOut]
    planned_total: int
    actual_total: int | None


# --- Habits -----------------------------------------------------------------------


class HabitCreate(BaseModel):
    """A new yes/no habit."""

    name: str = Field(min_length=1, max_length=80)
    active_days: str = "MON,TUE,WED,THU,FRI,SAT,SUN"
    start_date: date | None = None  # defaults to today


class HabitUpdate(BaseModel):
    """Rename, reschedule or archive a habit."""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    active_days: str | None = None
    archived: bool | None = None


class HabitCheckSet(BaseModel):
    """Tick or untick a habit for a day."""

    done: bool


class HabitDay(BaseModel):
    """One day in a habit's recent history."""

    day: str
    state: str  # done / missed / open / off / future


class HabitOut(BaseModel):
    """A habit with its recent days, streaks and 30-day rate."""

    id: int
    name: str
    active_days: str
    start_date: str
    archived: bool
    days: list[HabitDay]
    today: str  # the state of today
    current_streak: int
    best_streak: int
    rate_30: float | None


# --- Monthly letter ---------------------------------------------------------------


class LetterCategory(BaseModel):
    """One category's month."""

    category_id: int
    category_name: str
    minutes: int
    target_total: int
    credited_total: int
    completion: float | None
    days_on_target: int
    days_owed: int
    best_day: str | None
    best_day_minutes: int


class LetterHabit(BaseModel):
    """One habit's month."""

    name: str
    done: int
    applicable: int


class LetterOut(BaseModel):
    """Everything the monthly letter says, computed from stored data."""

    month: str  # YYYY-MM
    start: str
    end: str
    in_progress: bool
    total_minutes: int
    previous_total_minutes: int
    best_week_start: str | None
    best_week_minutes: int
    categories: list[LetterCategory]
    checkins: int
    checkin_gaps: int
    average_sleep_minutes: int | None
    average_energy: float | None
    problems_solved: int
    revisions: int
    forgotten: int
    topics: list[str]
    milestones_done: list[MilestoneOut]
    habits: list[LetterHabit]
    exams: list[str]
    planned_days: int
    plan_kept_percent: float | None
    # Exams in the month, with all time studied for each.
    exam_prep: list[ExamPrep] = []


# --- Git corroboration --------------------------------------------------------------


class GitRepoCreate(BaseModel):
    """Point Dayshift at a local repository for a category."""

    path: str = Field(min_length=1, max_length=1000)
    category_id: int


class GitRepoOut(BaseModel):
    """A configured repository."""

    id: int
    path: str
    category_id: int
    category_name: str


class GitDay(BaseModel):
    """One day for one category: logged minutes against commits."""

    day: str
    minutes: int
    commits: int
    flag: str | None


class GitCategoryOut(BaseModel):
    """A category's repositories compared with its logs."""

    category_id: int
    category_name: str
    repos: list[str]
    errors: list[str]
    days: list[GitDay]
    total_commits: int
    flagged_days: int


# --- Calendar import ----------------------------------------------------------------


class IcsImportIn(BaseModel):
    """The text of an .ics file, read in the browser."""

    text: str = Field(min_length=1, max_length=2_000_000)


class IcsEventOut(BaseModel):
    """One upcoming event from the file, ready to become an agenda item."""

    uid: str | None
    title: str
    day: str
    recurring: bool
    looks_like_exam: bool
    already_added: bool


# --- Upgrades: plan pre-fill, target suggestions, year in review ---------------


class PlanSuggestionItem(BaseModel):
    """What one category should get on a day, and why."""

    category_id: int
    category_name: str
    minutes: int
    reason: str


class PlanSuggestion(BaseModel):
    """A pre-filled plan for a day. Nothing is saved until you press Save."""

    plan_date: str
    items: list[PlanSuggestionItem]
    upcoming_exams: list[str]


class TargetSuggestion(BaseModel):
    """A category whose target looks too easy or too hard. Never applied alone."""

    category_id: int
    category_name: str
    direction: str  # raise / lower
    current_target: int
    suggested_target: int
    active_days: str
    weekly_percents: list[float]
    weeks: list[str]  # week starts, oldest first
    effective_from: str  # next Monday


class ExamPrep(BaseModel):
    """Time linked to one exam."""

    title: str
    due_date: str
    minutes: int


class YearMonth(BaseModel):
    """One month's line in the year in review."""

    month: str
    minutes: int
    problems_solved: int
    milestones: int


class YearCategory(BaseModel):
    """One category over the year."""

    category_id: int
    category_name: str
    minutes: int
    completion: float | None
    days_on_target: int
    days_owed: int


class YearOut(BaseModel):
    """A year, summed up from its monthly letters."""

    year: int
    months: list[YearMonth]
    total_minutes: int
    best_month: str | None
    categories: list[YearCategory]
    problems_solved: int
    revisions: int
    milestones_done: list[MilestoneOut]
    habits: list[LetterHabit]
    checkins: int
    average_sleep_minutes: int | None
    exam_prep: list[ExamPrep]
