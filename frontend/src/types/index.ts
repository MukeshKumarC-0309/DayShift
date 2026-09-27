// Mirrors backend/schemas.py. Hand-written rather than generated so the shapes
// stay readable and reviewable alongside the Python.

export type Status = 'healthy' | 'warning' | 'critical' | 'none'
export type Trend = 'up' | 'down' | 'flat' | 'none'
export type SessionSource = 'timer' | 'manual'

export interface AuthStatus {
  /** False on a fresh install — the app routes to the setup screen. */
  configured: boolean
  authenticated: boolean
  username: string | null
  /** True when the server has SETUP_TOKEN set and setup must present it. */
  setup_token_required: boolean
}

export interface Category {
  id: number
  name: string
  display_order: number
  archived: boolean
  /** Resolved as of today from the category's target history. */
  daily_target_minutes: number
  active_days: string
  /** The dashboard domain this category is paged under. */
  group_name: string
  /** Alternative finish line in questions (DSA); null for minutes-only. */
  question_target: number | null
}

export interface CategoryTarget {
  id: number
  category_id: number
  effective_from: string
  daily_target_minutes: number
  active_days: string
  question_target: number | null
  created_at: string
}

export interface LogEntry {
  id: number
  log_date: string
  category_id: number
  minutes_logged: number
  questions_solved: number
  override_target_minutes: number | null
  override_reason: string | null
  created_at: string
  updated_at: string
}

export interface WorkSession {
  id: number
  category_id: number
  log_date: string
  started_at: string
  ended_at: string | null
  minutes: number
  note: string | null
  source: SessionSource
  tags: string[]
  is_running: boolean
  /** Live elapsed minutes while running; equals `minutes` once stopped. */
  elapsed_minutes: number
  /** Focus mode: when the block stops itself. Null for an open-ended timer. */
  planned_end: string | null
  /** Exam prep: the exam or deadline this work was for. */
  deadline_id: number | null
  /** Set once a timer session's minutes are edited: what the timer measured. */
  measured_minutes: number | null
  /** A git branch or issue reference ("feature/auth", "#42"), plain text. */
  git_ref: string | null
}

export interface TodayProgress {
  category_id: number
  category_name: string
  /** Manual plus timed, combined — this is what the gauge shows. */
  minutes_logged: number
  manual_minutes: number
  timed_minutes: number
  questions_solved: number
  question_target: number | null
  /** What scoring counts: minutes, or the questions' equivalent if further. */
  credited_minutes: number
  target_minutes: number
  default_target_minutes: number
  has_override: boolean
  is_active_today: boolean
  percent: number
}

export interface ParScore {
  category_id: number
  category_name: string
  par_percent: number | null
  previous_par_percent: number | null
  trend: Trend
  days_counted: number
  minutes_total: number
  target_total: number
  consecutive_days_below: number
  status: Status
  window_start: string | null
  window_end: string | null
}

export interface WeeklyDay {
  log_date: string
  weekday: string
  minutes_logged: number
  questions: number
  target_minutes: number
  has_override: boolean
  is_active: boolean
  is_tracked: boolean
  percent: number | null
}

export interface WeeklyCategory {
  category_id: number
  category_name: string
  days: WeeklyDay[]
}

export interface Dashboard {
  today: string
  tracking_start_date: string
  progress: TodayProgress[]
  par: ParScore[]
  weekly: WeeklyCategory[]
  categories: Category[]
  running: WorkSession | null
}

export interface LogUpsert {
  log_date: string
  category_id: number
  minutes_logged?: number
  questions_solved?: number
  override_target_minutes?: number
  override_reason?: string
  clear_override?: boolean
}

/** A delta for the quick-add buttons; negative only when undoing. */
export interface LogAdjust {
  log_date: string
  category_id: number
  minutes_delta?: number
  questions_delta?: number
}

// --- Settings ---------------------------------------------------------------

export interface Setting {
  key: string
  label: string
  kind: 'int' | 'float' | 'date' | 'bool' | 'time' | 'folder'
  value: string
  default: string
  minimum: number | null
  maximum: number | null
  help: string
  /** Settings page section. Only `scoring` changes how scores are calculated. */
  group: 'scoring' | 'suggestions' | 'backup'
}

// --- Day detail -------------------------------------------------------------

export interface DayCategoryDetail {
  category_id: number
  category_name: string
  manual_minutes: number
  timed_minutes: number
  questions_solved: number
  question_target: number | null
  total_minutes: number
  target_minutes: number
  is_active: boolean
  has_override: boolean
  override_reason: string | null
  percent: number | null
  sessions: WorkSession[]
}

export interface DayDetail {
  log_date: string
  weekday: string
  is_tracked: boolean
  categories: DayCategoryDetail[]
}

export interface SearchHit {
  session: WorkSession
  category_name: string
}

export interface Tag {
  id: number
  name: string
  session_count: number
  total_minutes: number
}

export interface FocusStats {
  start: string
  end: string
  blocks: number
  finished: number
  ended_early: number
  focus_minutes: number
  /** How long the early ones ran, on average; null when none did. */
  average_early_minutes: number | null
  by_length: { planned_minutes: number; blocks: number; finished: number }[]
}

/** Commits that day on a session's branch, or mentioning its issue. */
export interface RefCommits {
  session_id: number
  git_ref: string
  /** null: none of the category's linked repositories has that branch. */
  commits: number | null
}

/** One recorded change to sessions — for Undo and the honesty ledger. */
export interface SessionChange {
  id: number
  action: 'delete' | 'edit' | 'split' | 'merge'
  created_at: string
  log_date: string
  category_id: number
  category_name: string
  minutes_before: number
  minutes_after: number
  sessions_before: number
  notes: string[]
  /** Made on a later day than the sessions' own. */
  after_the_fact: boolean
  undone_at: string | null
}

/** What a JSON export holds, shown before restoring from it. */
export interface ExportPreview {
  exported_at: string | null
  first_day: string | null
  last_day: string | null
  counts: { label: string; count: number }[]
}

export interface TagRollupRow {
  name: string
  session_count: number
  total_minutes: number
  /** category_id → minutes. Keys are strings; sort by value to rank them. */
  by_category: Record<string, number>
}

/** Time per tag over a period. Rows can overlap: a session has several tags. */
export interface TagRollup {
  start: string
  end: string
  total_minutes: number
  untagged_minutes: number
  tags: TagRollupRow[]
  /** The same per branch/issue reference. */
  branches: TagRollupRow[]
}

// --- Insights ---------------------------------------------------------------

export interface CalendarDay {
  log_date: string
  minutes: number
  target_minutes: number
  percent: number | null
  is_active: boolean
  is_tracked: boolean
  has_override: boolean
}

export interface CalendarCategory {
  category_id: number
  category_name: string
  days: CalendarDay[]
}

export interface RangePoint {
  log_date: string
  minutes: number
  target_minutes: number
  percent: number | null
  moving_average: number | null
}

export interface WeekdayStat {
  weekday: string
  days_counted: number
  minutes_total: number
  target_total: number
  percent: number | null
}

export interface HourStat {
  hour: number
  minutes: number
}

export interface ConsistencyStat {
  category_id: number
  category_name: string
  days_counted: number
  mean_percent: number
  stdev_percent: number
  /** 0-100; high means steady, low means feast-and-famine. */
  consistency_score: number
  longest_streak: number
  best_day: string | null
  best_day_minutes: number
}

export interface RangeCategory {
  category_id: number
  category_name: string
  points: RangePoint[]
  par_percent: number | null
  minutes_total: number
  target_total: number
  days_counted: number
  weekday_breakdown: WeekdayStat[]
  consistency: ConsistencyStat
}

export interface PeriodSummary {
  label: string
  start: string
  end: string
  minutes_total: number
  target_total: number
  par_percent: number | null
  days_counted: number
}

export interface CategoryComparison {
  category_id: number
  category_name: string
  current: PeriodSummary
  previous: PeriodSummary
  delta_percent: number | null
}

export interface Insights {
  start: string
  end: string
  days: number
  categories: RangeCategory[]
  hours: HourStat[]
  comparison: CategoryComparison[]
}

// --- Accountability (Batch 5) -----------------------------------------------

export interface Pace {
  category_id: number
  category_name: string
  week_start: string
  week_end: string
  minutes_logged: number
  target_total: number
  /** Active days from today to Sunday, today included. */
  days_remaining: number
  minutes_remaining: number
  /** Even split across the days left; null when none remain. */
  minutes_per_remaining_day: number | null
  on_track: boolean
  percent: number
}

export interface CategoryRecords {
  category_id: number
  category_name: string
  current_streak: number
  longest_streak: number
  best_day: string | null
  best_day_minutes: number
  best_week: string | null
  best_week_minutes: number
  total_minutes: number
  days_tracked: number
}

export interface Commitment {
  category_id: number
  category_name: string
  week_start: string
  committed_minutes: number | null
  actual_minutes: number
  target_minutes: number
  delta_minutes: number | null
  kept: boolean | null
}

export interface WeekCategorySummary {
  category_id: number
  category_name: string
  minutes_logged: number
  target_total: number
  percent: number | null
  days_counted: number
  best_day: string | null
  best_day_minutes: number
}

export interface WeeklyReview {
  week_start: string
  week_end: string
  is_current_week: boolean
  reflection: string
  reviewed_at: string | null
  categories: WeekCategorySummary[]
  commitments: Commitment[]
  total_minutes: number
}

export interface LedgerEntry {
  log_date: string
  category_id: number
  category_name: string
  scheduled_target: number
  override_target: number
  minutes_logged: number
  override_reason: string | null
  override_set_at: string
  days_late: number
  /** True when the override lowered the bar for a day already past. */
  lowered: boolean
}

export interface HonestyLedger {
  entries: LedgerEntry[]
  total_retroactive: number
  total_lowered: number
}

// --- Practice: the DSA problem log ------------------------------------------

export type Difficulty = 'easy' | 'medium' | 'hard'
export type ReviewOutcome = 'solid' | 'shaky' | 'forgot'

export interface ProblemReview {
  id: number
  reviewed_on: string
  outcome: ReviewOutcome
}

export interface Problem {
  id: number
  category_id: number
  title: string
  url: string | null
  topic: string
  difficulty: Difficulty
  needed_hint: boolean
  solved_on: string
  notes: string | null
  reviews: ProblemReview[]
  /** Revisions passed cleanly: 0, 1, 2 — 3 means mastered. */
  stage: number
  due_on: string | null
  mastered: boolean
  overdue_days: number
}

export interface TopicStat {
  topic: string
  problems: number
  needed_hint: number
  revisions: number
  forgotten: number
  mastered: number
  /** Share of attempts that went badly (hints + forgotten revisions). */
  struggle: number
}

export interface PracticeSummary {
  due_today: Problem[]
  upcoming: Problem[]
  topics: TopicStat[]
  total_problems: number
  mastered: number
}

export interface ProblemInput {
  title: string
  url?: string | null
  topic: string
  difficulty: Difficulty
  needed_hint: boolean
  solved_on: string
  notes?: string | null
}

// --- Check-ins ----------------------------------------------------------------

export interface CheckIn {
  check_date: string
  /** Sleep the night before, in minutes. */
  sleep_minutes: number | null
  energy: number | null
  mood: number | null
  note: string | null
}

export interface CheckInDay {
  day: string
  /** null = no check-in that day: a gap, shown as one. */
  checkin: CheckIn | null
  /** Share of the day's targets met (0–1), null when not scored. */
  completion: number | null
}

export interface CheckInBucket {
  label: string
  days: number
  completion: number | null
}

export interface CheckInInsights {
  start: string
  end: string
  days: CheckInDay[]
  gaps: number
  by_sleep: CheckInBucket[]
  by_energy: CheckInBucket[]
}

// --- Agenda -------------------------------------------------------------------

export type DeadlineKind = 'exam' | 'assignment' | 'other'

export interface DeadlineOverride {
  category_id: number
  target_minutes: number
}

export interface Deadline {
  id: number
  title: string
  kind: DeadlineKind
  due_date: string
  notes: string | null
  done: boolean
  days_left: number
  overrides: DeadlineOverride[]
  /** Exam prep: finished session minutes linked to it. */
  studied_minutes: number
  /** Minutes of study you mean to put in before it; null = no target. */
  study_target_minutes: number | null
  /** Minutes a day from today to the day before, to reach the target
   *  (0 once reached; null without a target or on/after the day). */
  needed_per_day: number | null
}

export interface TodaySummary {
  today: string
  revisions_due: number
  deadlines: Deadline[]
  checkin: CheckIn | null
  /** Habits that apply today. */
  habits: { id: number; name: string; done: boolean }[]
  plan_open_tasks: number
  plan_minutes: number
}

// --- Goals: milestones and habits -------------------------------------------------

export interface Milestone {
  id: number
  category_id: number
  title: string
  notes: string | null
  display_order: number
  done_on: string | null
}

export type HabitState = 'done' | 'missed' | 'open' | 'off' | 'future'

export interface Habit {
  id: number
  name: string
  active_days: string
  start_date: string
  archived: boolean
  days: { day: string; state: HabitState }[]
  today: HabitState
  current_streak: number
  best_streak: number
  rate_30: number | null
}

// --- Daily plan ----------------------------------------------------------------------

export interface PlanTask {
  id: number
  plan_date: string
  text: string
  done: boolean
  position: number
}

export interface DayPlan {
  plan_date: string
  is_past: boolean
  is_today: boolean
  categories: {
    category_id: number
    category_name: string
    planned: number | null
    actual: number | null
  }[]
  tasks: PlanTask[]
  planned_total: number
  actual_total: number | null
}

// --- Monthly letter ------------------------------------------------------------------

export interface Letter {
  month: string
  start: string
  end: string
  in_progress: boolean
  total_minutes: number
  previous_total_minutes: number
  best_week_start: string | null
  best_week_minutes: number
  categories: {
    category_id: number
    category_name: string
    minutes: number
    target_total: number
    credited_total: number
    completion: number | null
    days_on_target: number
    days_owed: number
    best_day: string | null
    best_day_minutes: number
  }[]
  checkins: number
  checkin_gaps: number
  average_sleep_minutes: number | null
  average_energy: number | null
  problems_solved: number
  revisions: number
  forgotten: number
  topics: string[]
  milestones_done: Milestone[]
  habits: { name: string; done: number; applicable: number }[]
  exams: string[]
  planned_days: number
  plan_kept_percent: number | null
  exam_prep: ExamPrep[]
}

export interface ExamPrep {
  title: string
  due_date: string
  minutes: number
}

export interface YearReview {
  year: number
  months: {
    month: string
    minutes: number
    problems_solved: number
    milestones: number
  }[]
  total_minutes: number
  best_month: string | null
  categories: {
    category_id: number
    category_name: string
    minutes: number
    completion: number | null
    days_on_target: number
    days_owed: number
  }[]
  problems_solved: number
  revisions: number
  milestones_done: Milestone[]
  habits: { name: string; done: number; applicable: number }[]
  checkins: number
  average_sleep_minutes: number | null
  exam_prep: ExamPrep[]
}

export interface PlanSuggestion {
  plan_date: string
  items: { category_id: number; category_name: string; minutes: number; reason: string }[]
  upcoming_exams: string[]
}

export interface TargetSuggestion {
  category_id: number
  category_name: string
  direction: 'raise' | 'lower'
  current_target: number
  suggested_target: number
  active_days: string
  weekly_percents: number[]
  weeks: string[]
  effective_from: string
}

export interface ExportStatus {
  folder: string | null
  latest: string | null
  latest_at: string | null
  ok: boolean
}

// --- Git corroboration ----------------------------------------------------------------

export interface GitRepo {
  id: number
  path: string
  category_id: number
  category_name: string
}

export type GitFlag = 'logged_no_commits' | 'commits_not_logged'

export interface GitCategory {
  category_id: number
  category_name: string
  repos: string[]
  errors: string[]
  days: { day: string; minutes: number; commits: number; flag: GitFlag | null }[]
  total_commits: number
  flagged_days: number
}

// --- Calendar import ------------------------------------------------------------------

export interface IcsEvent {
  uid: string | null
  title: string
  day: string
  recurring: boolean
  looks_like_exam: boolean
  already_added: boolean
}
