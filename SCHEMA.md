# Data Schema Reference

> **Superseded — read the Current schema section at the bottom.**
> This document describes the original three-table design. The data model has
> since grown: targets became effective-dated (so changing one does not rewrite
> history), sessions were added alongside the daily totals, and credentials
> moved out of `.env`. The *reasoning* here still holds and is still followed —
> minutes as integers, ISO dates in local time, one row per category per day,
> credentials outside the database. Only the table shapes changed.
> `backend/models.py` is the source of truth; `migrations/` records how it got
> there.

## Tables

### `categories`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT UNIQUE | "SDE Project", "AI Automation", "Project Maintenance" |
| daily_target_minutes | INTEGER | editable default target |
| active_days | TEXT | comma-separated day codes, e.g. "MON,TUE,WED,FRI,SAT,SUN" (Thursday excluded per current schedule) |

### `daily_logs`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| log_date | TEXT (ISO 8601, YYYY-MM-DD) | |
| category_id | INTEGER FK → categories.id | |
| minutes_logged | INTEGER | never float — avoid rounding drift |
| override_target_minutes | INTEGER, nullable | one-off target override for this specific date/category (e.g. unique event). NULL = use category default. |
| created_at | TEXT (ISO 8601 datetime) | for audit/debug only |
| updated_at | TEXT (ISO 8601 datetime) | bump on edit |

Unique constraint on (`log_date`, `category_id`) — one entry per category per day; edits update the existing row rather than inserting a duplicate.

### `auth`
Not a table — store as a single hashed value in `.env` (`AUTH_PASSWORD_HASH`), not in the database. Keeps credentials out of the SQLite file entirely, which simplifies backup/version-control hygiene (the .db file can be gitignored without worrying about leaking the password).

## Derived values (computed, not stored)
- **Par score** (per category, rolling 7-day window): `SUM(minutes_logged over last 7 applicable days) / SUM(effective_target over those same days) * 100`, where `effective_target` = `override_target_minutes` if set for that day, else the category's `daily_target_minutes`.
- **Consecutive warning days**: count backward from today per category while daily par (`minutes_logged / effective_target * 100`) stays below 80%; reset the count on any day at or above 80%.

## Notes
- "Applicable days" must respect each category's `active_days` — Project Maintenance only counts Sat/Sun in its target denominator, so a Tuesday with 0 minutes logged for it should NOT count against its par score.
- Thursday is excluded from SDE Project and AI Automation targets entirely per the user's fixed schedule (large external commitment that day) — the `active_days` field handles this per category rather than hardcoding day exclusions in route logic.

---

## Current schema

As of migration `0009`. Source of truth: `backend/models.py`.

### `categories` — identity only
| Column | Notes |
|---|---|
| id, name | name is unique |
| display_order | dashboard order |
| group_name | domain the dashboard pages by (`Projects`, `Daily`); default `Projects` |
| archived_at | nullable; archived keeps history, delete would destroy it |
| created_at, updated_at | |

The target and active days **moved out of this table**. Keeping them here meant
changing a target silently re-scored every past day — 450 logged minutes read
as 83.3% par at a 180 target and 125% at 120, with no log entry touched.

### `category_targets` — effective-dated targets
| Column | Notes |
|---|---|
| id, category_id | |
| effective_from | ISO date; the rule applies from here onward |
| daily_target_minutes | |
| active_days | comma-separated day codes |
| question_target | nullable; questions that also complete the day (DSA: 2) |
| created_at | |

Scoring resolves the record with the latest `effective_from` not after the day
being scored. Past par is therefore immutable.

### `daily_logs` — hand-entered minutes and overrides
Unchanged from the original, plus:

| Column | Notes |
|---|---|
| override_reason | nullable; why the target was changed |
| override_set_at | nullable; when the **target** changed, distinct from `updated_at` which also moves when minutes are edited |
| questions_solved | int ≥ 0, default 0; only scored for categories with a `question_target` |

`minutes_logged` now means **hand-entered time only**. A day's scored minutes
are this plus that day's finished sessions.

`override_set_at` exists so the honesty ledger can tell an override set in
advance (an exam booked weeks out) from one applied after the day was already
missed. `updated_at` could not answer that.

### `sessions` — measured work
| Column | Notes |
|---|---|
| id, category_id, log_date | log_date denormalised from started_at for indexable day queries |
| started_at, ended_at | `ended_at IS NULL` means still running |
| minutes | fixed only on stop; a running timer contributes 0 |
| note | |
| source | `timer` or `manual` — measured vs recalled stays visible |
| planned_end | set for a focus block (25/50); a block still running past it is closed **at** `planned_end` with the planned minutes (migration 0006) |
| deadline_id | the exam this session was for, or NULL; indexed, no FK — deleting the exam sets it back to NULL (migration 0006) |
| git_ref | a git branch or issue reference, one line of plain text, or NULL (migration 0008) |
| measured_minutes | NULL unless a timer session's minutes were edited: then the timer's reading, set once; `source` becomes `manual` at the same time (migration 0007) |
| created_at, updated_at | |

### `tags` / `session_tags`
Free-form labels on sessions, for sub-category rollups. Names normalised to
lowercase.

### `settings` — runtime-editable configuration
Key/value. Thresholds, par window, tracking start date. `backend/config.py`
supplies defaults; a row here overrides one. Deleting a row resets it.

### `weekly_reviews` / `commitments`
| Table | Notes |
|---|---|
| weekly_reviews | one written reflection per ISO week, keyed by that week's Monday |
| commitments | minutes promised per (week, category); compared against actual |

### Auth — still not a table
Originally `.env`, now `auth.json` at the project root: argon2 hash, username,
and a session signing secret. Gitignored, `0600`, written atomically.

The *reason* is the one this document gave originally and it has only got
stronger: keeping credentials out of SQLite means the `.db` can be copied,
backed up and gitignored without carrying a secret — and `snapshot_database()`
now copies that file on every start, so a credential in there would be
duplicated ten times over.

`.env` was wrong for a different reason: first-run setup has to *write* the
credential, and a file that is simultaneously hand-edited, read at import, and
machine-written is a footgun.

### `problems` / `problem_reviews` — the DSA problem log
| Column | Notes |
|---|---|
| problems: category_id, title, url, topic, difficulty, needed_hint, solved_on, notes | difficulty is `easy` / `medium` / `hard` |
| problem_reviews: problem_id, reviewed_on, outcome | outcome is `solid` / `shaky` / `forgot` |

The revision schedule (3 → 10 → 30 days) is **derived** by replaying the
reviews, never stored. Logging a problem adds 1 to `daily_logs.questions_solved`
for its `solved_on`; a review never does.

### `checkins` — one per date
| Column | Notes |
|---|---|
| check_date | unique ISO date |
| sleep_minutes | int, the night before; nullable |
| energy, mood | 1–5, nullable |
| note | |

No row = a gap. Never inferred or back-filled; never read by scoring.

### `deadlines` / `deadline_overrides`
| Column | Notes |
|---|---|
| deadlines: title, kind, due_date, notes, done_at | kind is `exam` / `assignment` / `other` |
| deadlines: study_target_minutes | optional study target (migration 0009) |
| deadline_overrides: deadline_id, category_id, target_minutes | the targets an exam sets on its day |

An exam's overrides are written into `daily_logs` as ordinary overrides with
`override_reason = "Exam: <title>"`; `deadline_overrides` remembers what was
set so it can be taken back exactly.

Hours studied for an exam are not stored: they are the sum of finished
sessions whose `deadline_id` points at it.

### `milestones`
| Column | Notes |
|---|---|
| category_id, title, notes, display_order | |
| done_on | ISO date finished; NULL while open |

### `plan_minutes` / `plan_tasks` — the daily plan
| Column | Notes |
|---|---|
| plan_minutes: plan_date, category_id, minutes | primary key (date, category); 0 is stored as no row |
| plan_tasks: plan_date, text, done, position | |

Intent only. Never read by scoring; "actual" is computed from logs + sessions.

### `habits` / `habit_checks`
| Column | Notes |
|---|---|
| habits: name, active_days, start_date, display_order, archived_at | counts from start_date, never before |
| habit_checks: habit_id, check_date | a row means done; **no row on an applicable past day means not done** |

### `git_repos`
| Column | Notes |
|---|---|
| path | absolute, validated as a git work tree when added |
| category_id | whose logs its commits are compared with |

### `session_changes` — history for undo and the ledger
| Column | Notes |
|---|---|
| action | `delete` / `edit` / `split` / `merge` |
| created_at, log_date, category_id | when the change was made; the sessions' day and category |
| before_json, after_json | full snapshots (every column + tag names) of the sessions before and after |
| minutes_before, minutes_after | totals, for the ledger |
| undone_at | set once undone |

Deleted sessions live only here: the `sessions` table holds exactly what
counts (migration 0009).

### Derived values — still computed, never stored
Par, streaks, pace, records, consistency and the ledger are all computed per
request from the rows above. Nothing is cached, so editing a day three weeks
back is correct automatically with no aggregate to invalidate.
