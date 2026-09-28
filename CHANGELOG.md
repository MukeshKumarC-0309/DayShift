# Changelog

Notable changes to Dayshift. Format follows [Keep a Changelog][kac]; this is a
personal single-user tool, so versions are milestones rather than releases.

[kac]: https://keepachangelog.com/en/1.1.0/

## [1.18.4] — 2026-09-28

### Fixed

- **A half-restored folder couldn't start.** After the project folder was
  restored from the Trash, `.venv` existed but had no working Python, and
  `node_modules` was incomplete. `start.sh` only checked that those folders
  existed, so it would have failed. Both start scripts now check for the
  Python interpreter and for Vite itself, and rebuild whatever is broken
  (a broken `.venv` from scratch, so its install stamp can't skip packages).

## [1.18.3] — 2026-09-28

### Changed

- Handbook: *Starting it from anywhere* (the `dayshift` command) and *On
  Windows* in the first-run chapter — neither was covered there before.
- README: the Windows-script test in the test list; CI's Windows check noted.

## [1.18.2] — 2026-09-28

### Fixed

- **Restoring from an export failed on Windows** ("file is being used by
  another process"). sqlite3's `with` block commits but doesn't close, so
  the temporary rebuild was still open when it was deleted — fine on macOS,
  refused by Windows. Every such connection (export restore, snapshot
  restore, the benchmark) now closes explicitly. Found by the new Windows CI.

- **`start.ps1` could not run on Windows at all.** Windows PowerShell 5.1
  reads a script without a byte-order mark as Windows-1252, where the last
  byte of a UTF-8 em dash becomes a curly quote that PowerShell accepts as a
  real one — ending double-quoted strings early, so the script never parsed.
  The Windows scripts are now ASCII-only, and a test keeps them that way.
- `start.ps1` no longer stops on harmless stderr output (pip's upgrade notice,
  npm warnings), which PowerShell 5.1 treats as errors when redirected; every
  step checks its own result instead.

### Changed

- CI uses the current releases of GitHub's checkout and setup steps
  (the old ones targeted a deprecated Node version).
- The Windows CI check gives the app a real 6-minute limit to come up (its
  retry loop could previously wait about 20).

## [1.18.1] — 2026-09-27

### Added

- CI on Windows: the backend suite, plus a first-run `start.cmd` that must
  bring the app up, and `dayshift status`/`stop` that must shut it down.

### Changed

- Tests are portable to Windows: the credentials-permission test skips there
  (Windows uses the profile's access control, not Unix mode bits), and the
  git tests use the platform's null device.

## [1.18.0] — 2026-09-27

### Added

- **Windows, natively from Command Prompt**: `start.cmd` (→
  `scripts\start.ps1`) and the `dayshift` command (`bin\dayshift.cmd` →
  `bin\dayshift.ps1`), installed with `scripts\install-command.ps1`. The Mac
  scripts sit alongside, unchanged.
- `.gitattributes` keeps shell scripts LF and Windows scripts CRLF.

### Changed

- Docs and comments cite "the project constraints" rather than an internal
  notes file.

## [1.17.1] — 2026-09-27

### Changed

- `dayshift share` lines its addresses up, however long the Tailscale name.
- Handbook: "The phone can't open it" in *When something breaks* — client
  isolation on college/café Wi-Fi, the Tailscale toggle, the firewall prompt.
  Its example address is now a generic one.
- Removed dead code: two unused theme constants and two API client wrappers
  nothing called (their endpoints remain).

## [1.17.0] — 2026-09-27

### Added

- **`dayshift share`** — start Dayshift reachable from your phone on the same
  Wi-Fi (or from anywhere with Tailscale) and print the address with a QR
  code. `dayshift share tailscale` shows the Tailscale QR; `dayshift status`
  says whether it's shared. Plain `dayshift` stays Mac-only.
- Only the frontend listens on the network; the API stays on 127.0.0.1 behind
  the proxy. Checked: the database and `.env` can't be fetched, and every data
  request needs a signed-in session.

## [1.16.0] — 2026-09-25

### Added

- **Edit a practice problem** — title, link, topic, difficulty, hint, date,
  notes. Moving the date moves its DSA question (shown before saving).
- **Remove a revision** recorded by mistake; the schedule goes back.

### Changed

- A problem's date can no longer be moved past its first revision (422) —
  the same rule recording a revision already enforced.

## [1.15.2] — 2026-09-25

### Added

- **Reorder categories** in Settings (↑/↓) — the docs had promised it; the
  button was missing.

### Changed

- **Category colours follow the category's id, not its position.** Your six
  categories keep the colours they had; reordering or archiving no longer
  repaints the ones after it. A seventh category is still neutral grey.
- `start.sh` no longer says "opening" a URL it doesn't open.
- `make clean` removes end-to-end test output; `restore-*.db` is gitignored.
- README: problem editing and single-revision removal are API-only (said so).

## [1.15.1] — 2026-09-25

### Added

- **`dayshift` command** (`bin/dayshift`, `make install-command`): start or
  open the app from any folder; also `status`, `open`, `stop`, `help`.

## [1.15.0] — 2026-09-25

### Added

- **Undo** for session delete, edit, split and merge (15 s bar in the day
  view), backed by a kept history (`session_changes`, migration **0009**) so
  any change can be undone later.
- **Honesty ledger: sessions changed after the day** — deletions and minute
  edits made on a later day, with restore/undo. Deleted sessions are kept (the
  user's choice).
- **Restore from an export file** (Settings → Data): replaces everything (the
  user's choice), snapshotting first; keeps credentials and this Mac's export
  folder and reminder. Exports now include every table (`format: 2`).
- **Commits per branch/issue** in the day view, from linked repos.
- **Where the week went** in the weekly review: top tags and branches.
- **Focus blocks** panel in Insights: finished vs ended early.
- **Exam study targets** with progress and the daily pace to reach them.
- CI: a third job runs `make api-types-check` and the end-to-end test in Chrome.

### Changed

- Deleting a running session is refused (409); discard it instead.
- `sessions.py` split into `sessions`, `session_edits`, `session_search`;
  `DayView.tsx` (434 → ~260 lines) and `SessionTimer.tsx` (493 → 202) split into
  `components/day/` and `components/timer/`. No behaviour change; the timer
  gained component tests first.

### Fixed

- **Splitting a session left the first half's end time unchanged**, so the
  two halves' clock ranges overlapped (minutes and totals were right). The
  first half now ends where the second starts. Your data had no split sessions.
- Editing an exam returned `studied_minutes: 0` in the response.

## [1.14.0] — 2026-09-25

### Added

- **Merge sessions** — day view → *merge…*, tick two or more of one category's
  sessions. Minutes add up; notes and branches are joined, tags combined.
  Refused when another session was recorded between them or when they count
  toward different exams (the user's choices), and for other categories,
  other days, running sessions and sessions without a time of day.
  `POST /api/sessions/merge`.

## [1.13.0] — 2026-09-25

### Added

- **Branch or issue on a session** (`sessions.git_ref`, migration **0008**):
  one line of plain text such as `feature/auth` or `#42`, set in the timer,
  the session editor or *Add a session*; shown in the day view and search
  results, matched by search, kept when a session is split, in the JSON
  export. Nothing is looked up — no network, no repo needed.

### Changed

- The timer's note has its own row; tags, branch and exam sit below it.

## [1.12.0] — 2026-09-25

### Added

- **Add a session you didn't time** — day view → *+ Add a session*: category,
  start/end time, note, tags, exam. Saved as `manual`.
- `deadline_id` on `POST /api/sessions`.

### Changed

- **Hand-added sessions can't overlap recorded ones** (the user's choice):
  `POST /api/sessions` with a start time returns 409 naming the session in the
  way. It also refuses a block that hasn't ended, a start time on another date
  than the session's, and a start at exactly midnight (the "no time" marker).
- Two tests used fixed October dates that are still in the future; they now
  use dates relative to today.

## [1.11.0] — 2026-09-25

### Added

- **Search** (`/search`, key `/`, ⋯ menu, palette): notes and tags, newest
  first, matches highlighted, a total; click a tag to filter to exactly it.
  The query lives in the URL.
- **Time by tag** on Insights: minutes per tag over the period, each bar split
  by category, with how much timed work is tagged. Click a tag to search it.
- `GET /api/sessions/tags/rollup`; `tag=` (exact) on `/api/sessions/search`.

### Fixed

- Search treated `%` and `_` as SQL wildcards, so "100%" matched nearly
  every session. They now match literally.

## [1.10.0] — 2026-09-24

### Added

- **Session editor** in the day view: change a session's category, minutes,
  note, tags or exam, or split it in two.
- **Tags** on the timer (and in the editor): chips, lowercased, up to 12,
  earlier tags suggested.

### Changed

- **Editing a timer session's minutes marks it edited** (the user's choice):
  `source` becomes `manual` and the timer's reading is kept in the new
  `sessions.measured_minutes` (migration **0007**). The day view shows
  `(edited · timer 95)`. Other edits and splits leave a session measured.
- Tags are validated: at most 12 per session, 48 characters each.

### Fixed

- **Splitting a session dropped its exam link from the second half**, taking
  those minutes off the exam's studied total.

## [1.9.0] — 2026-09-24

Twelve upgrades, and three bugs found on the way.

### Added

- **Focus blocks.** The timer offers *Open*, *25* and *50*. A block counts
  down, chimes, and is closed at its planned end with exactly the planned
  minutes, even if the page was closed when it ran out. Optional break
  countdown (records nothing).
- **Exam prep.** The timer's *For* list links a session to an exam; the Agenda,
  the monthly letter and the year view show hours studied per exam.
- **Revision session** on Practice: starts a DSA timer tagged `revision` and
  steps through the problems due today.
- **Override presets**: Sick day, Travel, Festival, Half day. They fill the
  form only; scheduled days only.
- **Plan *Suggest***: per-category minutes from what's left of the week, with
  the reason for each, plus exams in the next three days.
- **Target check** in the weekly review: raise/lower suggestions after four
  complete weeks at ≥110% or ≤60% (thresholds in Settings → Suggestions).
  Never applied automatically.
- **Year in review** (`/year/:year`), built from the monthly letters.
- **Weekly export** of the full JSON to a folder you choose (e.g. one iCloud
  Drive syncs), keeping the newest 12; *Export now*.
- **Evening reminder**: a macOS notification of what's still open today, via
  `make reminder-install` (a per-user launchd job). Reads the DB directly.
- **Generated API types**: `make api-types` writes `schema.d.ts` from the
  backend's OpenAPI; `make check` fails when it's stale, and `contract.ts`
  checks the hand-written types against it.

### Changed

- Settings are grouped (Scoring, Suggestions, Backups & reminders), each with
  its own Save and Reset. Float settings display as `110`, not `110.0`.
- `Dashboard.tsx` split into `useDashboardData` and `components/dashboard/`
  (609 → 199 lines); pages share one `PageHeader`.
- The ⋯ menu is wider, so items no longer wrap.
- Vite 6 → 7 (with @vitejs/plugin-react 5); `httpx` replaced by `httpx2` in dev
  requirements (removes the Starlette test-client deprecation warning).
- Migration **0006**: `sessions.planned_end`, `sessions.deadline_id`.
- Version set to 1.9.0 (the backend had reported 1.0.0 since the start).
- **Docs corrected**: the README, handbook and roadmap said sessions could be
  tagged, edited, split, merged and searched in the app. Only deleting has a
  screen; tags, editing, splitting and search are API-only, and merge was
  never built. The docs now say so.
- Handbook: Google Drive export setup, step by step.

### Fixed

- **Stopping the timer recorded 0 minutes.** `stop()` set `ended_at` before
  measuring, and a finished session's elapsed time is its stored minutes (0).
  Now measured first; regression test added. Your database had no timed
  sessions, so no history was affected.
- **Schedule override dropped the date range, extra categories and reason**
  — only the first date and category were saved. The panel now sends all of
  them.
- **Log form race**: the inputs were editable before the day loaded, so a
  number typed quickly could be overwritten by the load and *Record* would
  send nothing yet say *Saved*. Inputs now wait for the load, and an empty
  save says *Nothing typed to record.*

## [1.8.1] — 2026-09-24

### Changed

- **A real logo.** The mark is now an app-icon tile — a teal-to-violet
  gradient with the gauge dial and a needle — instead of a thin grey ring
  that read like a loading spinner. Favicons and the iOS icon regenerated.
- **Wordmark and header.** "Dayshift" is set in the sans face ("Day" in ink,
  "shift" in the gradient) with the page name behind a divider, from one
  shared `Brand` component on every page. The header now centres its items;
  baseline alignment had lifted the brand above the nav links.
- The ⋯ menu's "Shortcuts: press ?" was plain text; it is now a *Keyboard
  shortcuts* item that opens the panel, next to a new *Command palette* item.
- Handbook: same logo at its top-left, every screenshot retaken.

## [1.8.0] — 2026-09-24

The rest of the roadmap.

### Added

- **Daily plan** (Agenda): minutes per category and a task list, planned vs
  actual, carry-over of unfinished tasks.
- **Habits** (`/goals`): yes/no daily habits; an unticked applicable day is
  "not done" (the user's choice), today stays open. Streaks, best streak,
  30-day rate; tick from the Today line.
- **Milestones** (`/goals`): per-category outcomes, dated when finished; shown
  in the weekly review and the monthly letter.
- **Monthly letter** (`/letter`): a month summed up from stored data.
- **Git corroboration**: commits beside logged minutes, with dismissible
  mismatch flags. Read-only, local only.
- **Calendar import**: preview an .ics file, tick events to add; exam-like
  titles pre-selected as exams.
- **Command palette** (⌘/Ctrl+K) with quick entry (`+25 sde`, `+1q dsa`).
- **Quick entry** (`/quick`), a phone-first logging view.
- **Undo** after Record in the log form; **click-to-edit** on weekly bars.
- **Backup restore** in Settings → Data.
- Frontend tests (Vitest, 28) and an end-to-end test (Playwright, driving
  the installed Brave/Chrome) in `make check`; `make bench` for performance.
- Migration `0005`: `milestones`, `plan_minutes`, `plan_tasks`, `habits`,
  `habit_checks`, `git_repos`. All included in the JSON export.
- Handbook chapter 11, *Plans, goals & your month*; screenshots refreshed.

### Changed

- Snapshots and restore read `config.BACKUPS_DIR` at call time; the test
  suite now redirects it into a temp folder so tests can never touch real
  backups.
- Vite's API/web ports are configurable (`DAYSHIFT_API_PORT`,
  `DAYSHIFT_WEB_PORT`) so the e2e copy can run beside the real app.

### Performance

- Measured with `make bench` on ~2 years of logs and ~9,000 sessions: the
  slowest endpoint (a year of insights) answers in under 90 ms, the dashboard
  in under 20 ms. No optimisation was needed.

### Not built

- ActivityWatch / screen-time import — skipped at the user's choice.

### Security

- Upgraded routing from `react-router-dom` 6.30 to `react-router` 7.18
  (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg). Imports now come from
  `react-router`; `npm audit --omit=dev` is clean.

## [1.7.0] — 2026-09-24

### Added

- **Practice** (`/practice`): a DSA problem log. Logging a problem counts one
  question that day; problems come back for revision at 3, 10 and 30 days
  (solid advances, shaky repeats, forgot restarts). Revisions never count as
  questions. Topics listed weakest first.
- **Check-ins**: sleep, energy and mood, from the dashboard's Today line.
  Missing days stay gaps. Insights gains *Sleep & energy*: check-ins against
  the share of each day's targets met.
- **Agenda** (`/agenda`): exams, assignments and other dated items. An exam
  sets its day's targets automatically (0 by default, editable per category)
  as ordinary overrides; moving or deleting it takes them back unless you have
  edited them since.
- **Today line** on the dashboard: check-in, revisions due, the next two weeks.
- Shortcuts `q` (Practice) and `a` (Agenda).
- Migration `0004`: `problems`, `problem_reviews`, `checkins`, `deadlines`,
  `deadline_overrides`. The JSON export includes them, plus weekly reviews and
  commitments, which it had been missing.
- Handbook chapter 10, *Practice, check-ins & exams*; screenshots refreshed.

### Changed

- Settings moved from the dashboard header into the `⋯` menu (key `s` still
  works) to make room for Practice and Agenda.

### Fixed

- A startup snapshot identical to the newest one is no longer written. In
  development every code change restarts the server, and those duplicate
  copies were pushing older, genuinely different snapshots out of the
  last-ten rotation.

## [1.6.0] — 2026-09-24

### Added

- **Quick add.** `+15` / `+30` on every dial, `+1 Q` on DSA, with a ten-second
  Undo. Backed by `POST /api/logs/adjust`, which applies a delta and refuses to
  go below zero rather than clamping.
- **Domain status on the switcher.** Each domain pill says how it is doing
  today — `1/3`, `done`, or `rest` — so you can tell whether the other domain
  needs you without switching.
- **Keyboard shortcuts** and a `?` panel listing them.
- **Timer in the tab title** (`● 0:42 DSA · Dayshift`), and a prompt after three
  hours that the timer may have been left running.
- **Log form:** `‹ ›` date stepper and Today, `⌘/Ctrl+Enter` to record, an
  Unsaved marker, a guard against losing typed numbers on a date change, and a
  *Reload the day* warning when the same day changed elsewhere mid-edit.
- **Handbook:** real screenshots throughout (`docs/img/`), and a new chapter,
  *Shortcuts & quick actions*.

### Changed

- The dashboard refreshes when you return to its tab and rolls over at
  midnight on its own.
- A failed refresh keeps the last-loaded numbers under a *Retry* bar instead of
  replacing the page with an error.
- On Review and Insights, the domain pills show just the domain name; they
  previously fell back to a meaningless position number (`Projects 1`).

## [1.5.0] — 2026-09-24

### Added

- **Three daily categories**, run every day of the week (Thursday included):
  DSA (120 min *or* 2 questions), Exercise (30 min), Coursework (60 min).
  Seeded into existing databases on start; nothing already logged changes.
- **Domains.** Categories belong to a domain (`Projects`, `Daily`). The
  dashboard shows one domain at a time in a sliding window — `‹ ›`, the dots,
  arrow keys, or a swipe on touch screens move between them. The chosen domain
  is remembered per browser. Insights and Review page by domain the same way.
- **Question targets.** A category can finish on a question count as well as
  minutes. A day is credited the *further* of the two routes, never their sum:
  1 question (worth 60 of DSA's 120 min) plus 30 minutes is 50%, not 75%.
  The gauge shows question pips and a `+1 Q` button; the log form has a
  questions field. Lifetime totals and records still use real minutes only.
- Migration `0003`: `categories.group_name`, `category_targets.question_target`,
  `daily_logs.questions_solved`. CSV export gains `questions_solved` as its
  last column.
- Category palette extended to six slots: blue `#5b86f5`, olive `#7c9a12`,
  magenta `#c5579a`.

### Changed

- **The dashboard is lighter at first glance.** Par score and Weekly share one
  tabbed block; Timer, Log and Override share another. A recording dot on the
  Timer tab keeps a running session visible from any tab. "Today in full",
  background rain and sign-out moved into a `⋯` menu.

## [1.4.0] — 2026-09-22

### Changed

- **Panels no longer camouflage into the page.** Page and panel were 1.12:1
  apart — effectively the same colour. They are now 1.34:1, and the real
  separation comes from elevation: a cast shadow, a lit top edge, and a
  visible border. Two dark greys cannot differ enough on luminance alone.
- Removed the three large coloured radial gradients from the page background.
  They lifted the background toward the panel colour, which was half the
  problem.
- `critical` lightened from `#c2410c` to `#ea580c` so it still clears 3:1 on
  the lighter panel; re-validated against the pink category slot (ΔE 16.2).
- Sticky, blurred app header across every page.
- Panel radius 4px → 8px, and inputs now read as wells cut into the panel
  rather than boxes floating on it.
- The whole palette was re-validated against the new surface: categorical
  passes every gate, status clears 3:1.

## [1.3.0] — 2026-09-22

Roadmap batch 5 — accountability.

### Added

- **Pace.** A strip above the gauges saying what is still required to finish
  the week: `128 min/day for 5 days`. The only part of the dashboard that says
  what to *do* rather than how you have been doing. Rounds up, so following it
  actually reaches the target.
- **Weekly review** at `/review` — the week's numbers, a written reflection
  stored per ISO week, and navigation back through previous weeks. Defaults to
  the week just finished, because reviewing a week still running is guessing.
- **Commitments.** Declare minutes per category for a week, then see promised
  against actual. Deliberately separate from targets: a target is the standing
  expectation, a commitment is what you claimed you would manage.
- **Records.** Current streak, longest streak, best day, best week, lifetime
  total. Facts, not points — an unfinished today never breaks a streak and
  never flatters one.
- **Honesty ledger.** Every target changed *after* the day it applied to, with
  how many days later and whether it lowered the bar. Nothing is prevented or
  undone; it just stops happening invisibly. Overrides set in advance are not
  listed.
- **Bulk overrides** across a date range — an exam week set in one action
  instead of fourteen. Touches only scheduled days by default.

### Changed

- `daily_logs` gained `override_set_at`, recording when the *target* changed
  as distinct from when the row was last touched. Without it the ledger could
  not tell an override set in advance from one set after the day was missed.
- Dashboard header wraps properly at phone width now that there are six links.

## [1.2.0] — 2026-09-22

### Added

- **First-run setup.** A fresh install asks for a username and passcode, then
  signs you in. Later visits show a sign-in screen. The setup endpoint is
  refused once credentials exist, so it can never be used as a reset.
- **Usernames.** Sign-in now takes a username and passcode. Comparison is
  case-insensitive, and a wrong username and a wrong passcode return the same
  message and take comparable time, so neither reveals which half was wrong.
- **Credential changes in Settings**, using the current passcode. Changing the
  passcode rotates the session signing secret, invalidating other sessions.

### Changed

- Credentials moved out of `.env` into `auth.json` — argon2-hashed, `0600`,
  gitignored, written atomically, and deliberately outside the database so
  backups and the `.db` never carry a secret.
- **A `.env` is no longer needed at all.** `JWT_SECRET` is optional; one is
  generated during setup if absent. `start.sh` no longer refuses to boot
  without a `.env`.
- `AUTH_PASSWORD_HASH` is no longer used to authenticate.

## [1.1.0] — 2026-09-22

Roadmap batches 0–4.

### Fixed

- **Changing a category's target no longer rewrites history.** Targets are now
  effective-dated in a `category_targets` table, and a day is scored against
  the target that applied on that day. Previously, lowering a target from 180
  to 120 moved the same 450 logged minutes from 83.3% par to 125%.
- Manually added sessions derive `ended_at` from start + duration instead of
  the current clock, which had produced ranges like `21:15–17:14`.
- Time-of-day now includes manual sessions that carry a real start time,
  instead of discarding them.

### Added

- **Alembic migrations**, replacing `create_all`. The initial revision
  migrates a pre-Alembic database in place, moving the legacy category columns
  into the target history.
- **Database snapshots** on every start, keeping the last ten in `backups/`.
- **Settings page** — edit targets and schedules, create/rename/reorder/archive
  categories, and change every scoring threshold, par window, and the tracking
  start date. Validation is all-or-nothing per batch.
- **Data export** as CSV and JSON.
- **Sessions and a live timer.** One timer runs at a time; elapsed time is
  derived from the start so a refresh or restart recovers it. Sessions carry
  notes and tags and can be edited, split or discarded. They sit *alongside*
  hand-entered totals: a day's minutes are the sum of both, shown separately.
- **Tags and search** across session notes and tags.
- **Day view** at `/day/YYYY-MM-DD` — every session, note, tag and override
  for one date.
- **Insights** at `/insights` — daily heatmap, trend with moving average,
  consistency score, weekday and time-of-day patterns, and a comparison against
  the preceding period, over 30/90/365 days.
- Test suite grown from 61 to 124.

### Changed

- `daily_logs.minutes_logged` now means hand-entered minutes only; timed
  session minutes are added on top when scoring.
- Archived categories are hidden from the dashboard but keep their history.

## [1.0.0] — 2026-09-22

First complete build.

### Added

- FastAPI + SQLite backend with SQLAlchemy models for `categories` and
  `daily_logs`, seeded on first run from `backend/config.py`.
- Single-user password gate: argon2 hash in `.env`, JWT in an httpOnly cookie,
  and throttling after repeated failed attempts.
- Rolling 7-day par score per category, computed over the days each category is
  active on, excluding today and anything before `TRACKING_START_DATE`.
- Per-date, per-category target overrides, settable in advance from the
  dashboard or retroactively from the log form. An override makes that date
  count regardless of the weekday; an override of `0` opts a day out.
- Warning states on the gauges: amber at 2+ consecutive days below 80%,
  critical at 3+ or below 50% par. Expressed as border colour only — no popups.
- React + Vite + TypeScript frontend on the SOC-panel theme from `DESIGN.md`,
  with hand-built SVG gauges and weekly bar charts (no charting library).
- Terminal glyph-rain background with a persisted on/off toggle.
- `start.sh` — one command to launch backend and frontend together.
- Test suite (61 tests) covering the scoring rules and the HTTP surface.
- Ruff, ESLint, Prettier, a `Makefile`, and GitHub Actions CI.

### Changed

- Warning streaks now step over days a category is not active on, rather than
  resetting at them. Previously, Thursday being inactive for SDE Project and AI
  Automation made a Friday warning structurally impossible.

### Known limitations

- Nothing prevents retroactively lowering a target to erase an earned warning.
  Deliberate: this is a self-reporting tool with one user and no adversary.
