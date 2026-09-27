# Architecture

How Dayshift is put together, and why. For what the numbers *mean*, see the
README; this document is about structure.

## Shape

A local two-process app: a FastAPI server owning SQLite, and a Vite-served
React SPA talking to it over `/api`. Nothing leaves the machine — no external
services, no telemetry, no deployment target.

```
browser ──► Vite dev server (:5173) ──proxy /api──► FastAPI (:8000) ──► SQLite
```

The Vite proxy exists so the SPA and the API share an origin. That is what lets
the session cookie ride along on XHR as `httpOnly` without CORS credential
juggling, and it is why `credentials: 'include'` in `api/client.ts` is enough.

## Backend layering

| Layer | Module | Responsibility |
|---|---|---|
| Config | `config.py`, `settings_store.py` | Defaults + runtime-editable settings |
| Persistence | `models.py`, `database.py`, `migrations/` | Schema, engine, Alembic |
| Loading | `repository.py` | ORM rows → the plain values scoring takes |
| Rules | `scoring.py` | Par, target resolution, streaks — pure functions |
| Services | `sessions_service.py` | Timer rules |
| Contracts | `schemas.py` | Pydantic request/response models |
| Transport | `routers/*.py` | HTTP surface only |

`repository.py` exists so `scoring.py` never sees a database session. It also
owns the one rule that spans both storage shapes: a day's minutes are the
hand-entered total plus that day's finished sessions.

The important boundary is **`scoring.py`**. Every rule that decides what a par
score means lives there as a pure function over a category, a date, and a dict
of log rows — no database session, no request object. That is what makes the
rules testable in isolation (`tests/test_scoring.py` never starts a server) and
what keeps interpretation decisions in one readable file instead of scattered
through endpoint bodies.

Each decision in `scoring.py` is marked `DECISION` in the module docstring,
because the difference between "this is the rule" and "this is an accident of
implementation" is otherwise invisible to a future reader.

## Why nothing is precomputed

Par scores, streaks and the weekly view are computed per request from
`daily_logs` plus category config. Nothing is cached or stored.

For a single user with a few thousand rows this is far below the point where
caching would pay for itself, and it removes a whole class of bug: there is no
stale aggregate to invalidate when a past entry is edited or an override is
applied retroactively. Editing a day from three weeks ago is correct
automatically.

`/api/stats/dashboard` bundles all three sections into one response for the
same reason — three separate endpoints would triple the queries and let the
panels disagree with each other across a midnight rollover.

## Frontend structure

`App.tsx` owns exactly two things: the session state and the rain preference.
Everything else is a leaf.

The session is an `httpOnly` cookie, so the SPA cannot read it — it asks
`/api/auth/status` on mount and routes on the answer. Any API call that comes
back `401` calls `onSessionExpired`, so an expired cookie surfaces as a return
to the login screen rather than a silently broken dashboard.

`Dashboard.tsx` is layout only: `hooks/useDashboardData` fetches once and
the pieces in `components/dashboard/` get slices of the result. The visual components
(`GaugeIndicator`, `ParScore`, `WeeklyChart`) are pure renderers — they take
data and draw SVG, with no fetching of their own. Reloading after a write is
one `load()` call at the top, which is why saving a log entry updates the
gauges, the par panel and the chart together.

Colours are Tailwind tokens defined in `tailwind.config.js` from `DESIGN.md`.
No component contains a raw hex value, so the palette is changed in one place.

## Domains and tabbed blocks

`src/domains.ts` groups categories by `group_name`; `useDomains` holds which
one is shown. The dashboard renders every domain side by side in a
`DomainSlider` track and translates it, making off-screen slides `inert` so
focus never lands on something invisible. Colour comes from `colourIndex` —
the category's position in the full list — never its position in a filtered
domain, so DSA is the same blue on every page.

`TabBlock` is the other half of keeping the page light: a panel with several
views, one mounted at a time, the chosen tab remembered per browser.
`SessionTimer`, `LogEntryForm` and `OverridePanel` take `embedded` and render
through `Frame` — a panel on their own, a plain `div` inside a tab.

## Quick add is a delta, not a total

The dial buttons call `POST /api/logs/adjust` with `minutes_delta` /
`questions_delta`, never a computed total. The page's copy of the day can be
stale (the log form open, a stopped timer), and a total built from stale state
would silently overwrite newer numbers. The server refuses a result below zero
instead of clamping, so an undo always removes exactly what was added or
nothing at all.

The log form listens for the dashboard's reload counter (`version`). With no
unsaved typing it simply re-reads the day; with unsaved typing it compares the
stored day with what it loaded and, only if they differ, offers *Reload the
day* — so a routine refresh never raises a false alarm.

## Question credit

`scoring.credited_minutes` is the one place the DSA rule lives:
`max(minutes, questions × target ÷ question_target)`. `repository.day_records`
applies it per day with the rule in force *that* day, so changing the question
target later does not re-score the past. `DayRecord` keeps the real minutes
alongside, and `compute_records` uses those — credit is for "did you finish",
not "how long did you work".

## Effective-dated targets

A category's target is not a column — it is a history of records, each valid
from a date onward. Scoring resolves the record with the latest `effective_from`
that is not after the day being scored.

This exists because the alternative is silently wrong. With the target stored
on the category, lowering it re-scored every past day against the new value:
450 minutes across three days read as 83.3% par at a 180 target and 125% at
120, with no log entry touched. For a tool whose only value is telling you the
truth about what you did, that is a correctness bug, not a limitation.

The cost is that "what is this category's target?" is a function of a date
rather than a field, which is why `CategoryOut` resolves it as of today so the
frontend keeps a simple shape.

## Sessions alongside daily totals

`daily_logs.minutes_logged` holds hand-entered minutes; `sessions` holds
measured blocks. A day's scored minutes are the sum.

Sessions could have replaced the daily total outright, which would be a cleaner
data model. They sit alongside it instead because the failure mode matters more
than the elegance: on a day you forget to start the timer, a session-only model
leaves you either with no record or with a fake session invented after the
fact. Keeping both means the record always says which minutes were measured and
which were recalled.

The risk of the additive model is double-counting — typing 180 for a day the
timer already captured 90 of. That is handled in the UI rather than the schema:
the log form shows `+90 timed` next to the field, and the gauge shows
`90 entered + 90 timed`.

Editing is where "measured" could quietly stop being true, so it is guarded
on the server, not in the form: `PATCH /api/sessions/{id}` that changes a
timer session's minutes turns its `source` to `manual` and keeps the timer's
reading in `measured_minutes` (first edit only). Note, tags, category, exam
and splitting leave the source alone — none of them changes the duration.

Adding a past session is guarded the same way: `POST /api/sessions` with a
start time refuses a block that overlaps any recorded session with a clock
time (a running one counts to now), or that hasn't ended. The timer already
allows one running session at a time; this keeps hand-added time to the same
rule, so no minute is counted twice. The check lives in
`sessions_service.overlapping`.

Merging (`POST /api/sessions/merge`) keeps the earliest part and deletes the
rest in one transaction. Its refusals are the same two guarantees again: the
merged clock range must not overlap any other session (`overlapping` with the
parts excluded), and all parts must share one exam link, so studied hours
per exam can only change by an explicit edit.

Session history (`session_history.py`) stores before/after snapshots of every
delete, edit, split and merge. Keeping deleted sessions there rather than as a
"deleted" flag means no query anywhere has to remember to filter them. Undo
compares the current sessions with the stored "after" snapshots, so it never
silently discards a later change, and re-checks overlaps.

Restore from an export (`importer.py`) never writes into the live database
while building: it migrates a temporary SQLite file, inserts the export's
`tables`, runs `foreign_key_check` and `integrity_check`, and only then uses
the same snapshot-and-copy path as a snapshot restore. The export's `tables`
section is generated from `Base.metadata`, so new columns are included
without anyone remembering to add them.

A focus block stores its `planned_end`. Nothing wakes up at that moment;
instead, whenever the running session is read (`settle_expired`), an expired
block is closed at `planned_end` with exactly the planned minutes. So a block
that ran out while the laptop slept records 25 minutes, not the hours until
the page was next opened.

## Credentials

The single user's username and passcode live in `auth.json` at the project
root, not in the database and not in `.env`.

Not the database, because `SCHEMA.md` keeps auth out of SQLite so the `.db` is
safe to copy, back up and gitignore — and `snapshot_database()` copies it on
every start, so a credential in there would be duplicated ten times over.

Not `.env`, because setup has to *write* the credential. A process that
rewrites its own environment file at runtime is a file that is simultaneously
hand-edited, read at import, and machine-written; a dedicated file the app owns
end to end avoids that whole class of problem.

The file is argon2-hashed, `0600`, and written to a temp file then renamed, so
a crash mid-write cannot leave a half-written credential. `/api/auth/setup` is
open only while the file does not exist; after that it returns 409 and changes
go through `/api/auth/credentials`, which requires the current passcode.

This is still single-user. There is no accounts table and no concept of a
second person — the username exists so signing in feels like signing in, and so
the credential can be changed without touching a config file.

## Life tracking beside the minutes

Practice, check-ins and the agenda each touch scoring at most at one
well-defined point, so the rest of the scoring code does not know they exist:

- **Problems** write into `daily_logs.questions_solved` (via
  `repository.bump_questions`) — the same field `+1 Q` uses. The revision
  schedule lives in `practice.py` as pure functions and is replayed from the
  reviews on read.
- **Check-ins** are never read by scoring. `/api/checkins/insights` reads
  scoring (per-day completion) — the dependency points one way only.
- **Exams** write ordinary overrides into `daily_logs`. `agenda._take_back`
  clears only an override that still matches what the exam wrote (value and
  reason), which is what lets a hand edit survive the exam being moved or
  deleted.

## Pure rules, thin routers (roadmap)

Each roadmap feature keeps its rules in a pure module with no database, the
same pattern as `scoring.py`: `habit_rules.py` (applies / state / streaks /
rate — where "unticked means not done" lives), `practice.py` (revision
schedule), `ics.py` (the calendar parser), `git_corroboration.py` (the only
module that shells out, always `git` with list arguments and a timeout).
Routers load rows, call these, and shape responses.

The monthly letter is deliberately not stored: `routers/letter.py` recomputes
it from logs, check-ins, problems, milestones, habits, deadlines and plans,
so it can never disagree with them.

Backup restore uses SQLite's online backup API into the live file (safe with
pooled connections), disposes the engine, then runs migrations — a snapshot
may predate the current schema.

Suggestions never write. The plan's *Suggest* and the weekly review's target
check return numbers with their reasons; only the user's Apply/Save writes,
and a target change is effective-dated like any other.

Two things run outside request handling. The weekly export is an asyncio task
in the app's lifespan that checks hourly (in a thread) and writes the JSON
export to a user-chosen folder through a temp file and rename. The evening
reminder is not part of the app at all: `scripts/reminder.py`, run by a
per-user launchd job every 15 minutes, reads the SQLite file read-only and
calls `osascript` with its text as an argument (never interpolated into the
script). Neither makes a network call.

The frontend's `types/index.ts` is hand-written for readability, but
`api/schema.d.ts` is generated from the OpenAPI schema and `api/contract.ts`
asserts, at type level, that the two agree — drift fails `tsc`.

## Deliberate omissions

- **One deployment shape only.** Netlify for the frontend and a single Docker
  host for the backend (SQLite is one file on one volume); local use needs
  neither.
- **No multi-user support, OAuth, or refresh-token rotation.** The threat model
  is one person on their own machine.
- **No charting library.** The gauges and bars are hand-built SVG so the visual
  logic stays transparent and fully themable.
