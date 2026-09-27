// Thin fetch wrapper. Every call sends credentials so the httpOnly session
// cookie rides along; requests go to /api and are proxied to FastAPI by Vite.

import type {
  AuthStatus,
  CategoryRecords,
  Commitment,
  CalendarCategory,
  Category,
  CheckIn,
  CheckInInsights,
  Deadline,
  DeadlineKind,
  DeadlineOverride,
  DayPlan,
  ExportStatus,
  PlanSuggestion,
  TargetSuggestion,
  YearReview,
  GitCategory,
  GitRepo,
  Habit,
  IcsEvent,
  Letter,
  Milestone,
  PlanTask,
  CategoryTarget,
  Dashboard,
  DayDetail,
  HonestyLedger,
  Insights,
  LogEntry,
  LogAdjust,
  LogUpsert,
  Pace,
  PracticeSummary,
  Problem,
  ProblemInput,
  ReviewOutcome,
  FocusStats,
  RefCommits,
  SearchHit,
  SessionChange,
  Setting,
  ExportPreview,
  Tag,
  TagRollup,
  TodaySummary,
  WeeklyReview,
  WorkSession,
} from '../types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      if (body?.detail) detail = String(body.detail)
    } catch {
      // Non-JSON error body — the status text is the best we have.
    }
    throw new ApiError(response.status, detail)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const api = {
  // --- Auth ---------------------------------------------------------------
  /** First-run setup. Open only until it succeeds. */
  setup: (username: string, passcode: string, setupToken?: string) =>
    request<AuthStatus>('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username, passcode, setup_token: setupToken || null }),
    }),
  login: (username: string, passcode: string) =>
    request<AuthStatus>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, passcode }),
    }),
  logout: () => request<AuthStatus>('/auth/logout', { method: 'POST' }),
  sessionStatus: () => request<AuthStatus>('/auth/status'),
  updateCredentials: (payload: {
    current_passcode: string
    username?: string
    new_passcode?: string
  }) =>
    request<AuthStatus>('/auth/credentials', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // --- Dashboard ----------------------------------------------------------
  dashboard: () => request<Dashboard>('/stats/dashboard'),
  dayDetail: (date: string) => request<DayDetail>(`/stats/day/${date}`),
  calendar: (start: string, end: string) =>
    request<CalendarCategory[]>(`/stats/calendar${query({ start, end })}`),
  insights: (days: number, averageWindow = 7) =>
    request<Insights>(`/stats/insights${query({ days, average_window: averageWindow })}`),

  // --- Logs ---------------------------------------------------------------
  logsForDay: (date: string) => request<LogEntry[]>(`/logs/day/${date}`),
  upsertLog: (payload: LogUpsert) =>
    request<LogEntry>('/logs', { method: 'PUT', body: JSON.stringify(payload) }),
  /** Add to a day's typed minutes/questions without overwriting them. */
  adjustLog: (payload: LogAdjust) =>
    request<LogEntry>('/logs/adjust', { method: 'POST', body: JSON.stringify(payload) }),

  // --- Categories ---------------------------------------------------------
  categories: (includeArchived = false) =>
    request<Category[]>(`/categories${query({ include_archived: includeArchived })}`),
  createCategory: (payload: {
    name: string
    daily_target_minutes: number
    active_days: string
    group_name?: string
    question_target?: number | null
  }) =>
    request<Category>('/categories', { method: 'POST', body: JSON.stringify(payload) }),
  updateCategory: (
    id: number,
    payload: {
      name?: string
      display_order?: number
      archived?: boolean
      group_name?: string
    },
  ) =>
    request<Category>(`/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  reorderCategories: (categoryIds: number[]) =>
    request<Category[]>('/categories/reorder', {
      method: 'POST',
      body: JSON.stringify({ category_ids: categoryIds }),
    }),
  targets: (id: number) => request<CategoryTarget[]>(`/categories/${id}/targets`),
  setTarget: (
    id: number,
    payload: {
      daily_target_minutes: number
      active_days: string
      effective_from?: string
      /** Omit to keep the current one; 0 removes it. */
      question_target?: number
    },
  ) =>
    request<CategoryTarget>(`/categories/${id}/targets`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteTarget: (categoryId: number, targetId: number) =>
    request<void>(`/categories/${categoryId}/targets/${targetId}`, { method: 'DELETE' }),

  // --- Sessions -----------------------------------------------------------
  runningSession: () => request<WorkSession | null>('/sessions/running'),
  startSession: (
    categoryId: number,
    note?: string,
    tags: string[] = [],
    options: { planned_minutes?: number; deadline_id?: number; git_ref?: string } = {},
  ) =>
    request<WorkSession>('/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ category_id: categoryId, note, tags, ...options }),
    }),
  stopSession: () => request<WorkSession>('/sessions/stop', { method: 'POST' }),
  discardSession: () => request<void>('/sessions/discard', { method: 'POST' }),
  /** Add a finished block by hand. With `started_at`, it must be over and must
   *  not overlap a recorded session (409 names the one it overlaps). */
  createSession: (payload: {
    category_id: number
    log_date: string
    minutes: number
    started_at?: string
    note?: string
    tags?: string[]
    git_ref?: string
    deadline_id?: number
  }) =>
    request<WorkSession>('/sessions', { method: 'POST', body: JSON.stringify(payload) }),
  updateSession: (
    id: number,
    payload: {
      minutes?: number
      note?: string
      log_date?: string
      category_id?: number
      tags?: string[]
      /** Branch or issue; '' clears it. */
      git_ref?: string
      /** Link to an exam; 0 unlinks. */
      deadline_id?: number
    },
  ) =>
    request<WorkSession>(`/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  splitSession: (id: number, atMinute: number) =>
    request<WorkSession[]>(`/sessions/${id}/split`, {
      method: 'POST',
      body: JSON.stringify({ at_minute: atMinute }),
    }),
  deleteSession: (id: number) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
  focusStats: (days: number) => request<FocusStats>(`/stats/focus${query({ days })}`),
  /** For sessions that day with a branch/issue: commits in their linked repos. */
  refCommits: (day: string) => request<RefCommits[]>(`/corroboration/day/${day}`),
  /** Recent changes to sessions, newest first; `afterTheFact` = the ledger's. */
  sessionChanges: (afterTheFact = false, limit = 50) =>
    request<SessionChange[]>(
      `/sessions/changes${query({ after_the_fact: afterTheFact, limit })}`,
    ),
  /** Put sessions back as they were before a change (409 says why if not). */
  undoSessionChange: (id: number) =>
    request<WorkSession[]>(`/sessions/changes/${id}/undo`, { method: 'POST' }),
  /** Merge sessions of one category on one day; the server says why if it can't. */
  mergeSessions: (ids: number[]) =>
    request<WorkSession>('/sessions/merge', {
      method: 'POST',
      body: JSON.stringify({ session_ids: ids }),
    }),
  tags: () => request<Tag[]>('/sessions/tags/all'),
  /** Notes and tags containing `q`, and/or sessions with exactly `tag`. */
  search: (q: string, tag?: string, limit = 200) =>
    request<SearchHit[]>(`/sessions/search${query({ q, tag, limit })}`),
  tagRollup: (start: string, end: string) =>
    request<TagRollup>(`/sessions/tags/rollup${query({ start, end })}`),

  // --- Accountability -----------------------------------------------------
  pace: () => request<Pace[]>('/accountability/pace'),
  records: () => request<CategoryRecords[]>('/accountability/records'),
  review: (weekStart?: string) =>
    request<WeeklyReview>(`/accountability/review${query({ week_start: weekStart })}`),
  saveReflection: (weekStart: string, reflection: string) =>
    request<WeeklyReview>('/accountability/review', {
      method: 'PUT',
      body: JSON.stringify({ week_start: weekStart, reflection }),
    }),
  setCommitment: (weekStart: string, categoryId: number, minutes: number) =>
    request<Commitment[]>('/accountability/commitments', {
      method: 'PUT',
      body: JSON.stringify({
        week_start: weekStart,
        category_id: categoryId,
        minutes,
      }),
    }),
  clearCommitment: (weekStart: string, categoryId: number) =>
    request<void>(`/accountability/commitments/${weekStart}/${categoryId}`, {
      method: 'DELETE',
    }),
  ledger: () => request<HonestyLedger>('/accountability/ledger'),
  bulkOverride: (payload: {
    start: string
    end: string
    category_ids: number[]
    override_target_minutes: number
    reason?: string
    active_days_only?: boolean
  }) =>
    request<LogEntry[]>('/logs/bulk-override', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // --- Practice -----------------------------------------------------------
  practiceSummary: () => request<PracticeSummary>('/practice/summary'),
  problems: (topic?: string) =>
    request<Problem[]>(`/practice/problems${query({ topic })}`),
  createProblem: (payload: ProblemInput) =>
    request<Problem>('/practice/problems', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateProblem: (id: number, payload: Partial<ProblemInput>) =>
    request<Problem>(`/practice/problems/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteProblem: (id: number) =>
    request<void>(`/practice/problems/${id}`, { method: 'DELETE' }),
  reviewProblem: (id: number, outcome: ReviewOutcome) =>
    request<Problem>(`/practice/problems/${id}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ outcome }),
    }),
  deleteReview: (problemId: number, reviewId: number) =>
    request<Problem>(`/practice/problems/${problemId}/reviews/${reviewId}`, {
      method: 'DELETE',
    }),

  // --- Check-ins ----------------------------------------------------------
  setCheckIn: (payload: CheckIn) =>
    request<CheckIn>('/checkins', { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCheckIn: (date: string) =>
    request<void>(`/checkins/${date}`, { method: 'DELETE' }),
  checkInInsights: (days: number) =>
    request<CheckInInsights>(`/checkins/insights${query({ days })}`),

  // --- Agenda -------------------------------------------------------------
  today: () => request<TodaySummary>('/agenda/today'),
  deadlines: (includeDone = false) =>
    request<Deadline[]>(`/agenda/deadlines${query({ include_done: includeDone })}`),
  createDeadline: (payload: {
    title: string
    kind: DeadlineKind
    due_date: string
    notes?: string | null
    overrides?: DeadlineOverride[]
    study_target_minutes?: number | null
  }) =>
    request<Deadline>('/agenda/deadlines', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateDeadline: (
    id: number,
    payload: Partial<{
      title: string
      kind: DeadlineKind
      due_date: string
      notes: string | null
      done: boolean
      overrides: DeadlineOverride[]
      study_target_minutes: number | null
    }>,
  ) =>
    request<Deadline>(`/agenda/deadlines/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteDeadline: (id: number) =>
    request<void>(`/agenda/deadlines/${id}`, { method: 'DELETE' }),

  importIcs: (text: string) =>
    request<IcsEvent[]>('/agenda/import-ics', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  // --- Goals --------------------------------------------------------------
  milestones: (params: { done_from?: string; done_to?: string } = {}) =>
    request<Milestone[]>(`/goals/milestones${query(params)}`),
  createMilestone: (categoryId: number, title: string) =>
    request<Milestone>('/goals/milestones', {
      method: 'POST',
      body: JSON.stringify({ category_id: categoryId, title }),
    }),
  updateMilestone: (
    id: number,
    payload: Partial<{
      title: string
      notes: string | null
      done: boolean
      done_on: string
    }>,
  ) =>
    request<Milestone>(`/goals/milestones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteMilestone: (id: number) =>
    request<void>(`/goals/milestones/${id}`, { method: 'DELETE' }),
  habits: (includeArchived = false) =>
    request<Habit[]>(`/goals/habits${query({ include_archived: includeArchived })}`),
  createHabit: (name: string, activeDays: string) =>
    request<Habit>('/goals/habits', {
      method: 'POST',
      body: JSON.stringify({ name, active_days: activeDays }),
    }),
  updateHabit: (
    id: number,
    payload: Partial<{ name: string; active_days: string; archived: boolean }>,
  ) =>
    request<Habit>(`/goals/habits/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteHabit: (id: number) => request<void>(`/goals/habits/${id}`, { method: 'DELETE' }),
  setHabitCheck: (id: number, date: string, done: boolean) =>
    request<Habit>(`/goals/habits/${id}/checks/${date}`, {
      method: 'PUT',
      body: JSON.stringify({ done }),
    }),

  // --- Daily plan ---------------------------------------------------------
  plan: (date: string) => request<DayPlan>(`/plan/${date}`),
  setPlanMinutes: (date: string, items: { category_id: number; minutes: number }[]) =>
    request<DayPlan>(`/plan/${date}/minutes`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
  addPlanTask: (date: string, text: string) =>
    request<PlanTask>(`/plan/${date}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  carryOver: (date: string) =>
    request<PlanTask[]>(`/plan/${date}/carry-over`, { method: 'POST' }),
  updatePlanTask: (id: number, payload: Partial<{ text: string; done: boolean }>) =>
    request<PlanTask>(`/plan/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deletePlanTask: (id: number) =>
    request<void>(`/plan/tasks/${id}`, { method: 'DELETE' }),

  // --- Monthly letter -----------------------------------------------------
  letterMonths: () => request<string[]>('/letter/months'),
  letter: (month: string) => request<Letter>(`/letter/${month}`),
  year: (year: number) => request<YearReview>(`/letter/year/${year}`),
  planSuggestion: (date: string) => request<PlanSuggestion>(`/plan/${date}/suggest`),
  targetSuggestions: () =>
    request<TargetSuggestion[]>('/accountability/target-suggestions'),

  // --- Git corroboration --------------------------------------------------
  gitRepos: () => request<GitRepo[]>('/corroboration/repos'),
  addGitRepo: (path: string, categoryId: number) =>
    request<GitRepo>('/corroboration/repos', {
      method: 'POST',
      body: JSON.stringify({ path, category_id: categoryId }),
    }),
  removeGitRepo: (id: number) =>
    request<void>(`/corroboration/repos/${id}`, { method: 'DELETE' }),
  corroboration: (days: number) =>
    request<GitCategory[]>(`/corroboration${query({ days })}`),

  // --- Settings -----------------------------------------------------------
  settings: () => request<Setting[]>('/settings'),
  updateSettings: (values: Record<string, string | number | boolean>) =>
    request<Setting[]>('/settings', { method: 'PUT', body: JSON.stringify({ values }) }),
  resetSettings: (group?: Setting['group']) =>
    request<Setting[]>(`/settings/reset${query({ group })}`, { method: 'POST' }),
  exportStatus: () => request<ExportStatus>('/settings/export-folder'),
  exportNow: () =>
    request<ExportStatus>('/settings/export-folder/now', { method: 'POST' }),
  exportUrl: (format: 'json' | 'csv') => `/api/settings/export.${format}`,
  backups: () =>
    request<{ name: string; bytes: number; modified: number }[]>('/settings/backups'),
  /** What an export file holds. Changes nothing. */
  previewExportRestore: (data: unknown) =>
    request<ExportPreview>('/settings/restore-export/preview', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  /** Replace all tracking data with an export file's (snapshot taken first). */
  restoreExport: (data: unknown) =>
    request<ExportPreview>('/settings/restore-export', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'RESTORE', data }),
    }),
  restoreBackup: (name: string) =>
    request<{ restored: string }>(
      `/settings/backups/${encodeURIComponent(name)}/restore`,
      {
        method: 'POST',
      },
    ),
}
