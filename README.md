# Dayshift

[![CI](https://github.com/MukeshKumarC-0309/DayShift/actions/workflows/ci.yml/badge.svg)](https://github.com/MukeshKumarC-0309/DayShift/actions/workflows/ci.yml)

A single-user, local web app for logging daily discretionary study time across
six categories, in two domains, and tracking them against configurable per-weekday targets.

Named for the shift you're on: the dashboard is a watch floor for your own
week, not a to-do list.

FastAPI + SQLite on the backend, React (Vite + TypeScript) + Tailwind on the
front. Runs entirely on your machine — no cloud, no telemetry, no external
network calls.

---

## Quick start

```bash
./start.sh
```

That one command creates the Python venv, installs both dependency sets on
first run, starts FastAPI on `:8000`, starts Vite on `:5173`, and waits for the
backend's health check before handing over. Open **http://localhost:5173**.

`Ctrl-C` stops both servers.

### From any folder: `dayshift`

```bash
make install-command
```

Links `bin/dayshift` onto your PATH (Homebrew's `bin`). Then, in any terminal:
`dayshift` opens the app if it's running, otherwise starts it (`./start.sh`, in
that terminal) and opens the browser once it's up. Also `dayshift status`,
`dayshift open`, `dayshift stop` (stops only this app's processes) and
`dayshift help`. `make uninstall-command` removes it.

### On Windows

Everything runs natively from Command Prompt — no WSL needed. Install
[Python 3.11+](https://www.python.org/downloads/) and
[Node.js 20+](https://nodejs.org), then from the project folder:

```bat
start.cmd
```

It does what `./start.sh` does (venv, dependencies, backend, frontend;
Ctrl-C stops both), via `scripts\start.ps1`. For the `dayshift` command in
any Command Prompt, run this once and open a new window:

```bat
powershell -ExecutionPolicy Bypass -File scripts\install-command.ps1
```

`dayshift`, `dayshift share`, `open`, `status` and `stop` then work as on a
Mac (`bin\dayshift.cmd` → `bin\dayshift.ps1`). The evening reminder is
macOS-only, and `make` targets have no Windows equivalent — run the tools
directly (`.venv\Scripts\python -m pytest`, `npm test` in `frontend`).

**Moving your data from a Mac:** stop Dayshift there, then copy
`dayshift.db` (your whole history) and `auth.json` (your sign-in) into the
project folder before the first `start.cmd`. Or start fresh, set a login on
the first screen, and use Settings → Data → *Restore from an export file*
with a weekly export. Neither file is in git.

### On your phone: `dayshift share`

`dayshift share` starts the app reachable from other devices (restarting it
if it's running Mac-only) and prints the phone address plus a QR code to scan.

- **Same Wi-Fi** as the Mac, while it's on and running Dayshift.
- **From anywhere** with [Tailscale](https://tailscale.com) on the Mac and the
  phone (same account): `dayshift share` then also lists the Tailscale address;
  `dayshift share tailscale` shows its QR code.

Only the Vite server listens on the network (`DAYSHIFT_SHARE=1` → host
`0.0.0.0`, and `*.ts.net` names allowed). FastAPI stays on 127.0.0.1 behind
Vite's `/api` proxy, so the phone uses the same origin and cookie as the Mac,
and nothing is readable without signing in. Vite's `fs.strict` keeps files
outside `frontend/` (the database, `.env`) unreachable. Plain `dayshift` stays
Mac-only; share on networks you trust. macOS may ask once to allow `node`
incoming connections. `scripts/share.mjs` finds the addresses; `scripts/qr.mjs`
draws the QR code (no dependency). Hosting it 24/7 instead: § Deploying.

### First run

There is nothing to configure. Start the app, open it, and the first screen
asks you to choose a **username** and a **passcode** (8+ characters). That
creates `auth.json` — argon2-hashed, written `0600`, gitignored. Every later
visit shows a sign-in screen instead.

Sessions last 14 days, so you will not be asked again for a while. "Sign out"
in the dashboard header returns you to the sign-in screen.

**Changing them:** Settings → Credentials, using your current passcode.
Changing the passcode also rotates the session signing secret, which signs out
any other session.

**Locked out:** delete `auth.json` and the app returns to first-run setup. Your
logged data is untouched — it lives in `dayshift.db`, separately.

> `auth.json` is deliberately **not** in the database. `SCHEMA.md` keeps
> credentials out of SQLite so the `.db` can be copied, backed up and
> gitignored without carrying a secret — and startup snapshots copy that file
> on every run. A `.env` is optional; see `.env.example` for the overrides.

---

## How the numbers work

Every derived number is computed on request from the `daily_logs` rows; nothing
is precomputed or cached. The rules live in `backend/scoring.py`, each marked
`DECISION` so it is clear what is a deliberate rule rather than an accident.

### Targets

| Category | Default target | Applies on |
|---|---|---|
| SDE Project | 180 min | Mon, Tue, Wed, Fri, Sat, Sun |
| AI Automation | 60 min | Mon, Tue, Wed, Fri, Sat, Sun |
| Project Maintenance | 20 min | Sat, Sun |
| DSA | 120 min **or** 2 questions | Every day |
| Exercise | 30 min | Every day |
| Coursework | 60 min | Every day |

The first three form the **Projects** domain, the last three the **Daily**
domain. The dashboard shows one domain at a time — `‹ ›` (or the arrow keys,
or a swipe) slides to the next — so six dials never compete on one screen.
A category's domain is editable in Settings; type a new name to make a new
domain.

**Question targets (DSA).** A day is credited the *further* of the two finish
lines, never both added together: minutes count as minutes, and each question
counts as `target ÷ question target` minutes (60 for DSA). So 1 question plus
30 minutes is 50%, 2 questions is 100% however long they took, and 130 minutes
with no questions is 108%. Par, pace and the gauges use this credited figure;
lifetime totals and personal records use real minutes only, so a quick
two-question day never inflates "time spent".

Targets and active days live in `category_targets`, **effective-dated**: each
record says what applied from a given date onward. Change one from the Settings
page and it takes effect from the date you choose forward — days already scored
keep the target that was in force when they were recorded.

This matters. Before it existed, lowering a target rewrote your whole history:
the same 450 logged minutes read as 83.3% par at a 180 target and 125% at a 120
target. Past par is now immutable.

### What counts as a day's minutes

A day's total is **hand-entered minutes plus timed session minutes**. The two
are recorded separately and shown separately (`60 entered + 45 timed`), so
measured and recalled time never blur together — but they count the same in the
score. A running timer contributes nothing until it is stopped, so a live
session can never inflate a score mid-flight.

### Par score

`sum(minutes) / sum(effective_target) * 100` over the **7 calendar days ending
yesterday** (configurable), counting only days that are active for that
category.

- **Today is excluded.** Today is still in progress, so including it would drag
  par down every morning and let it recover by evening. Today's live status is
  what the gauges show; par is the stable trailing picture.
- **Tracking starts 2026-10-01** (`TRACKING_START_DATE` in `.env`). Days before
  it are excluded from *both* the numerator and the denominator, so the first
  week scores honestly over however many tracked days exist rather than showing
  a fake shortfall. Par reads `—` until at least one tracked day exists.
- **A missing log row on an active day counts as 0 minutes** against the full
  target. Absence is a zero, not an exemption.
- **Inactive days are invisible.** A Tuesday with no Project Maintenance logged
  never counts against it, because Tuesday is not in its `active_days`.

### Warning states

Shown as a border colour shift on the gauge plus a small `Nd below target`
label. No popups, toasts, or alerts.

- **Warning (amber):** 2+ consecutive days below 80% of that day's target.
- **Critical (red, slow pulse):** 3+ consecutive days below 80%, or par below 50%.

The streak walks backward from yesterday and **steps over any day the category
is not active on**. Inactive days neither extend the streak nor end it — they
are invisible to it. Only an *active* day at or above 80% stops the walk.

So for SDE Project, a bad Wednesday followed by Thursday (inactive) and a bad
Friday counts as **3 consecutive days**, because Thursday was never a day you
were scheduled to work. A scheduled off-day cannot launder a warning, and
Project Maintenance (Sat/Sun only) can accumulate a streak across whole
weekdays.

The gauge arc itself is coloured by **today's** achievement, while the gauge
*border* carries the trailing warning state. Two different questions, two
different signals — a day at 111% shows a green arc even while the border is
amber from a rough week.

### Target overrides

A per-date, per-category override for one-off events. Stored as
`override_target_minutes` on that day's log row — nullable, where null means
"use the category default". It does not alter the config, and the default
resumes automatically the next day.

- **In advance:** the *schedule override* panel on the dashboard. Creates the
  row with `minutes_logged = 0`; you fill in real minutes later.
- **Retroactively:** the collapsed *set target override* section in the log
  form, when logging or editing that day.
- **An override activates the day.** A non-null override makes the date count
  for that category even if the weekday is not in `active_days` — so a 90-minute
  override opts a Thursday in, and an override of **0** opts a normally-active
  day out entirely.
- Overridden days are marked with a `*` on the weekly chart so they are never
  misread as a real shortfall or surplus.

### Background effect

The login page and dashboard render a slow terminal glyph rain behind the
content (`frontend/src/components/MatrixRain.tsx`).

DESIGN.md explicitly rules out neon green-on-black, so this is tuned against
it: the palette's muted `#3ecf8e` at low alpha, a sparse column grid, a ~24fps
cap, and a `bg-base/70` scrim between the canvas and the content so text stays
legible. Panels are opaque, so the rain only shows in the whitespace.

- **Toggle it** with `rain on` / `rain off` in the dashboard header. The choice
  is remembered per browser in `localStorage`.
- It renders a single static frame under `prefers-reduced-motion`, and stops
  entirely when the tab is hidden.
- To change the feel, pass `intensity` (default `0.42`) or `columnWidth`
  (default `18`, larger is sparser) where `<MatrixRain />` is rendered in
  `App.tsx`. To remove it outright, delete that one line.

### The timer

Start a timer per category from the dashboard. One runs at a time — starting a
second stops the first, because two concurrent timers would count the same
wall-clock minutes twice.

- Elapsed time is derived from the session's start, so a refresh, a laptop
  sleep, or a backend restart all recover the true elapsed time.
- `Discard` throws a session away without recording it — for when the timer was
  left running overnight.
- A session carries a note, tags (lowercased, up to 12, suggested from
  earlier ones) and an optional **branch or issue** (`feature/auth`, `#42`;
  one line, plain text — nothing is looked up), all set in the timer before
  starting.
- **Editing.** In the day view, *edit* changes a session's category, minutes,
  note, tags, branch or exam, or splits it in two (both halves keep note, tags and
  exam). **Changing a timer session's minutes marks it edited:** its source
  becomes `manual` and the timer's reading is kept in `measured_minutes`, shown
  as `(edited · timer 95)`. Changing anything else, or splitting, leaves it
  measured.
- **Merging.** Day view → *merge…* on a category, tick two or more sessions.
  Minutes are the sum (not the clock span); notes and branches are joined,
  tags combined; the earliest session is kept. Same category and day only.
  **A gap is fine unless another session was recorded in it**, and **sessions
  linked to different exams (or only some of them) are refused** — both the
  user's choices, so merging never double-counts or moves an exam's hours.
  The result is `timer` only if every part was; it keeps a `measured_minutes`
  total only if every part was originally timed.
- **Adding a past session.** Day view → *+ Add a session*: category, start and
  end time, note, tags, branch, exam; saved as `manual`. **A block that overlaps a
  recorded session is refused** (409, naming the session in the way) — the
  user's choice, the same rule the timer follows, so no minute counts twice.
  Touching ends are fine; a block that hasn't ended yet is refused; one past
  midnight is entered as one session per day. A session added through the API
  without a start time has no clock time and is exempt from the overlap check.
- Typed minutes (log form, quick add) are stored apart from sessions, and the
  day view shows the two separately (`45 entered · 90 timed`). *Timed* counts
  every session, edited ones included — the per-session label says which
  weren't measured.
- While a timer runs, the browser tab title shows it (`● 0:42 DSA · Dayshift`).
  After three hours the timer asks whether you stepped away.
- **Focus blocks.** Pick *25* or *50* instead of *Open* and the timer counts
  down, chimes, and closes the session **at** its planned end with exactly the
  planned minutes — even if the page was closed or the laptop asleep when it
  ran out (`planned_end` on the session; settled the next time the running
  session is read). Ending early records the real elapsed time. An optional
  break countdown follows; it records nothing.
- **For an exam.** The timer's *For* list links a session to an upcoming exam
  (`sessions.deadline_id`); the Agenda shows hours studied per exam.

### Quick add and shortcuts

Each dial has `+15` / `+30` (and `+1 Q` for DSA), which add to today's typed
minutes through `POST /api/logs/adjust` — a delta, never a new total, so a click
cannot overwrite something typed a moment earlier. Undo is offered for ten
seconds and takes back exactly what was added; a change that would go below
zero is refused, not clamped.

Press `?` in the app for every keyboard shortcut. The useful ones: `[` `]`
switch domain, `t` / `l` / `o` open Timer / Log / Override, `r` `i` `s` `d`
open Review, Insights, Settings, Dashboard, and `⌘/Ctrl+Enter` records the log
form. Single keys only, and they pause while you type in a field.

The log form steps dates with `‹ ›`, marks unsaved numbers, will not discard
them on a date change without asking, and warns (with *Reload the day*) if a
quick add or the timer changed the same day while you were editing. The
dashboard refreshes when you return to the tab and rolls over at midnight; if
the backend drops, it keeps the last numbers under a *Retry* bar.

### Settings

Everything that used to need a text editor or a SQLite client:

- **Categories** — create, rename, reorder, archive (never delete: the logs
  would lose their meaning), and set effective-dated targets and schedules.
- **Scoring** — par window length, whether today counts, warning and critical
  thresholds, consecutive-day counts, weekly chart span, tracking start date.
  A batch with one invalid value is rejected whole, so settings are never left
  half-applied.
- **Suggestions** — the thresholds behind the weekly review's target check
  (110% / 60% / 4 weeks).
- **Backups & reminders** — the weekly export folder, how many exports to
  keep, and the evening reminder with its time.
- **Export** — CSV (entered and timed minutes in separate columns) and JSON
  (full history). The database is also snapshotted into `backups/` on every
  start, keeping the last ten.

Each group has its own Save and Reset, so resetting one never touches another.

### Weekly export to a folder

Settings → Backups & reminders → *Weekly export folder*: point it at a folder
your cloud app already syncs (iCloud Drive, Google Drive). Once a week the
backend writes the full JSON export there (`dayshift-export-YYYY-MM-DD.json`,
written to a temp file and renamed, so a sync never picks up half a file) and
deletes all but the newest 12. *Export now* writes one immediately. Dayshift
makes no network calls — it writes a file; the cloud app does the rest. Only
meaningful where the backend runs on your own machine.

For Google Drive, install Google Drive for desktop and use the folder's local
path (select it in Finder, `⌥⌘C`), e.g.
`~/Library/CloudStorage/GoogleDrive-you@gmail.com/My Drive/DayShift Tracker`.
A `drive.google.com` link will not work. Step-by-step: handbook, chapter 09.

### Evening reminder

A macOS notification listing what's still open today: no check-in, habits
unticked, revisions due, planned tasks left, tomorrow not planned. Silent when
nothing is open, and at most once a day. Turn it on and set the time in
Settings, then install it once:

```bash
make reminder-install    # a per-user launchd job that checks every 15 minutes
make reminder-test       # print what it would say tonight, send nothing
make reminder-uninstall
```

`scripts/reminder.py` reads the database directly — the app does not need to be
running.

### Insights

Horizons longer than a week, at 30 / 90 / 365 days:

- **Daily heatmap** per category, contribution-grid style.
- **Trend** with a 7-day moving average. The line breaks on days the category
  is not scheduled, rather than dropping to zero.
- **Consistency score** — 100 minus the coefficient of variation. This is the
  number that separates 180 minutes every day from 1260 in one Sunday; par
  alone scores them identically, and they are not the same habit.
- **By weekday** — which days you actually deliver on.
- **Time of day** — from sessions that carry a real clock time. Minutes typed
  in as a daily total have no hour attached and are deliberately excluded
  rather than piled onto midnight.
- **Period comparison** against the preceding window of equal length.
- **Focus blocks** — how many 25/50 blocks ran to the end, how long the early
  ones lasted, per planned length.
- **Time by tag** — each tag's timed minutes over the period, split by
  category. A session with two tags counts toward both, so the bars can sum to
  more than the period; the panel says how much timed work is tagged at all.
  Click a tag to search it.

### Search

`/search` (key `/`). Every session whose note, branch or tags contain the text,
newest first (up to 200), with a total. Clicking a tag narrows to exactly that
tag; the date opens the day view for editing. The query is in the URL, so it
can be bookmarked. `%` and `_` match literally.

### Day view

`/day/YYYY-MM-DD` shows one date in full: every session with its note and tags,
the entered/timed split per category, and any override with its reason.

### Pace — what to do today

Above the gauges, per category: how much of this week's requirement is done,
and what is left per remaining scheduled day. `128 min/day for 5 days`.

It rounds up, so following the number actually reaches the target rather than
landing just short. Everything else on the dashboard is a score; this is the
one panel that is an instruction.

### Weekly review

`/review` — the week's numbers, your commitments against what actually
happened, a written reflection, your records, and the honesty ledger.

Defaults to the week just finished; navigate back through earlier weeks. The
numbers are computed, the reflection is the part only you can supply.

**Commitments** are separate from targets on purpose. A target is the standing
expectation; a commitment is what you claimed, that week, you would actually
manage. The gap between them is the interesting number.

**Target check.** If a category has been at or above 110% of target every week
for the last four complete weeks, the review suggests raising it; at or below
60%, lowering it. The suggested number is the real average per scheduled day,
rounded to 5 minutes, effective next Monday. It is never applied on its own:
*Raise*/*Lower* adds an effective-dated target (the past keeps the old one),
*Keep* hides the suggestion. Thresholds are in Settings → Suggestions.

**Records** are current streak, longest streak, best day, best week and
lifetime total. An unfinished today never breaks a streak and never flatters
one — today only counts once it already meets the target.


**Where the week went** lists the week's top tags and branches by time.

### Honesty ledger

Every target changed **after** the day it applied to, with how many days later
and whether it lowered the bar.

This does not prevent or undo anything — the limitation below is still true and
still deliberate. It only declines to let it happen invisibly. An override set
in advance (a known exam, a trip) never appears here; only one applied to a day
that had already passed.

### Bulk overrides

Set one override across a date range from the dashboard's *Schedule override*
panel — an exam fortnight in one action rather than fourteen. By default only
days the category is actually scheduled on are touched, so a weekend-only
category does not sprout weekday rows.

**Presets** — *Sick day*, *Travel*, *Festival* (every category at 0) and *Half
day* (each category at half its own target) — only fill the form, with the
reason set; nothing is saved until *Set*. They touch scheduled days only, so a
preset never turns a rest day into an obligation.

### Practice — the DSA problem log

`/practice` (key `q`). Log each problem with topic, difficulty and whether you
needed a hint. **Logging a problem counts one DSA question** on the day it was
solved — the same count `+1 Q` adds to; deleting the problem removes that count.

*edit* on any problem changes its title, link, topic, difficulty, hint, date
and notes. Changing the date moves its question to the new day (the form says
so first); a date after its first revision is refused, the same rule as
recording a revision. A revision recorded by mistake can be removed there
too, which puts the schedule back as if it never happened.

Problems come back for revision **3, 10 and 30 days** after solving. *Solid*
advances to the next gap, *Shaky* repeats the same gap, *Forgot* starts again
from 3 days; three solid revisions and it is mastered. **A revision never
counts as a question** — the question target is for new problems — but its
minutes still count as DSA time. Topics are listed weakest first (share of
attempts that needed a hint or were forgotten on revision).

*▶ Start revision session* starts a DSA timer (note "Revision session", tag
`revision`) and steps through the due problems one at a time.

### Check-ins

Tap *Check in* on the dashboard's Today line: hours slept last night, energy
and mood 1–5, an optional note. Context only — never part of a score. **A day
without a check-in is a gap** and stays one; nothing is filled in or carried
forward. Insights → *Sleep & energy* lines check-ins up against how each day
went: the share of that day's targets met, each category capped at 100% so one
long session can't hide a skipped category. Averages over fewer than five days
are dimmed.

### Agenda — exams and deadlines

`/agenda` (key `a`). Exams, assignments and anything else with a date; the
next two weeks appear on the dashboard's Today line.

**An exam sets that day's targets automatically**: 0 min for every category by
default, editable per category before saving. They are ordinary overrides
(`override_reason = "Exam: <title>"`), so the weekly chart marks the day `*`
and an exam added after its day appears in the honesty ledger. Moving,
renaming, re-kinding or deleting the exam takes back only the overrides it set
and that are still as it left them — a later hand edit wins.

An exam can have a **study target** (hours). The Agenda then shows progress
and the pace to reach it: what's left over today up to the day before,
rounded up to 5 minutes (`needed_per_day`; 0 once reached).

Each exam shows the time studied for it: the finished sessions linked to it
through the timer's *For* list. Nothing is inferred from categories. Deleting
an exam unlinks its sessions; their minutes stay.

### Daily plan

On the Agenda page: minutes per category **and** a task list, set the evening
before (the panel opens on tomorrow after 6 pm, today before). On the day,
each category shows real minutes worked beside what was planned; tasks tick
off. *Carry over* copies the previous day's unfinished tasks — copies, so the
previous day still records them as not done. A plan is intent, never a target:
it does not touch any score.

*Suggest* fills in the minutes: what's left of each category's week spread over
the days left (rounded up to 5), an override's value on an override day, 0 on
a rest day — each with its reason — and names any exam in the next three days.
It only fills the form.

### Habits

`/goals` (key `g`). Yes/no habits on chosen weekdays. **On a day a habit
applies, no tick means not done** — only today stays open until it ends. A
habit counts from the day it is added, never backwards. Past days can be
ticked or unticked by clicking their square. Streaks skip days a habit does
not apply to. Today's habits can be ticked from the dashboard's Today line.

### Milestones

Also on `/goals`: a checklist per category. Ticking one dates it. The weekly
review lists the week's finished milestones; the monthly letter lists the
month's. Never scored.

### Monthly letter

`/letter` (key `m`). A month written out from stored data each time it is
opened — nothing is saved, so it always agrees with the logs: time against the
previous month, best week, each category's share of target and days met,
milestones, problems solved and revised, check-ins, habits and how much of the
planned minutes were done, plus hours studied per exam. The current month
reads to yesterday.

`/year/2026` — the year in review, built from that year's monthly letters so
the two always agree: minutes per month, each category's time, share of target
and days met, problems, sleep, habits, exams and milestones. From the ⋯ menu,
the letter's *Year* link or the command palette.

### Git corroboration

Settings → Git repositories: point a category at local repos. Insights then
shows your own commits (the repo's `user.email`) beside logged minutes and
flags a day with 60+ minutes and no commits, or commits with nothing logged.
Read-only (`git log` only), dismissible per browser, and only meaningful when
the backend runs on the machine that has the repositories.

### Calendar import

Agenda → *Import a calendar*: an `.ics` file is parsed into a preview of the
next year's events; nothing is added until ticked. Titles that look like exams
(mid-sem, end-sem, quiz, viva…) start ticked as exams, and an imported exam
sets its day's overrides like a typed one.

### Command palette, quick entry, undo, chart editing

- `⌘/Ctrl+K` — go anywhere, start/stop the timer, or log: `+25 sde`,
  `45 ai`, `+1q dsa`. Categories match by word prefix or initials.
- `/quick` — the phone view: big `+10 +15 +30 +60` buttons, `+1 question`,
  the timer, habits and check-in, with undo. Linked from the Today line on
  phones.
- The log form offers **Undo** for 15 s after *Record*, restoring the day
  exactly as loaded.
- Click a bar in the Weekly tab to correct that day's typed minutes in place.

### Restoring a backup

Settings → Data lists the startup snapshots. Restoring asks you to type
`RESTORE`, snapshots the current database first (so it can be undone), copies
the snapshot in with SQLite's backup API, then migrates it. Credentials in
`auth.json` are untouched. Snapshots are skipped when nothing has changed, so
development restarts no longer push real ones out of the last-ten rotation.

### Restoring from an export

Settings → Data → *Restore from an export file* — for a new Mac. Exports now
carry a `tables` section (format 2): every row of every table, generated from
the schema. The file is validated and summarised first; restoring **replaces
everything** (the user's choice): it builds a fresh database from the file in
a temporary file, migrates and integrity-checks it, snapshots the current
database, then copies it in. Credentials and this machine's export folder and
reminder settings are kept. Exports from before this (no `tables`) are
refused with advice to export again; so are exports from a newer schema.

### Session history and undo

Every delete, edit, split and merge of a session stores the sessions before
and after in `session_changes`. The day view offers *Undo* for 15 s; any
change can also be undone later, unless a session it produced has changed
since or putting one back would overlap a session recorded since.

**Deleted sessions are kept** (the user's choice) — not as a flag on the
sessions table, but as a snapshot in the history, so nothing can count a
deleted session by accident. The honesty ledger lists deletions and minute
edits made after the session's day, with *restore* / *undo*. Splits and
merges don't change a day's total and aren't listed. A running session is
discarded, never deleted.

### Known limitation: self-honesty

Nothing prevents you from retroactively lowering a target to erase a warning
you actually earned. This is deliberate — it is a single-user self-reporting
tool, so there is no one to enforce against. No edit lock, no approval step, no
time window. The tracker is only as accurate as you are; the override exists
for genuine one-off events, not for tidying up a bad week.

---

## Deploying (Netlify + a backend host)

Netlify can only serve static files and short-lived JS functions. It cannot
run the FastAPI server or keep `dayshift.db` between requests. So the app is
split into two parts:

| Part | Where | Config |
|---|---|---|
| React frontend | Netlify | `netlify.toml`, `frontend/scripts/netlify-redirects.mjs` |
| FastAPI + SQLite | Any Docker host **with a persistent volume** (Fly.io, Railway, Render with a disk) | `Dockerfile` |

Netlify proxies `/api/*` to the backend, so the browser only ever talks to your
Netlify domain and the httpOnly session cookie stays first-party.

### 1. Backend

Deploy the root `Dockerfile` and mount a persistent volume at **`/data`**. This
is not optional: without a volume, every redeploy deletes your logs and your
login. Set these environment variables on the host:

| Variable | Value |
|---|---|
| `SETUP_TOKEN` | A random string (`python3 -c "import secrets; print(secrets.token_urlsafe(24))"`). You enter it on the setup screen, so a stranger cannot claim your login before you do. |
| `TRACKING_START_DATE` | Optional, same as local. |
| `TZ` | Your timezone, e.g. `Asia/Kolkata`. Dates are "today" in the server's local time, so without this the day rolls over at UTC midnight. |

`DATA_DIR=/data` and `COOKIE_SECURE=true` are already set in the Dockerfile.
Check it's running at `https://<backend>/api/health`.

Fly.io example:

```bash
fly launch --no-deploy          # accept the Dockerfile, pick a region
fly volumes create dayshift_data --size 1
# in fly.toml add:  [mounts]  source = "dayshift_data"  destination = "/data"
fly secrets set SETUP_TOKEN=... TZ=Asia/Kolkata
fly deploy
```

Run a **single** instance. SQLite is one file on one volume, so scaling out
splits your data across machines.

To move your existing local data over, copy `dayshift.db` (and optionally
`auth.json`) into the volume before first start, e.g.
`fly ssh sftp shell` → `put dayshift.db /data/dayshift.db`.

### 2. Frontend (Netlify)

1. Push the repo to GitHub and import it in Netlify. `netlify.toml` already sets
   the base directory, build command and publish folder.
2. Under Site configuration → Environment variables, set
   `BACKEND_URL=https://<your-backend-host>` (no trailing `/api`).
3. Deploy. The build fails with a clear message if `BACKEND_URL` is missing.
4. Open the Netlify URL, enter the setup token, and choose your username and
   passcode.

Local use is unchanged: `./start.sh` ignores all of this.

---

## Development

```bash
make install     # venv + Python deps + npm deps
make dev         # same as ./start.sh
make check       # lint, format check, typecheck, tests — what CI runs
make test        # Python tests only
make format      # ruff format + prettier
make reset-db    # drop the database; it re-seeds on next start
make api-types   # regenerate frontend/src/api/schema.d.ts after a backend schema change
make bench       # time the heaviest endpoints on a large synthetic history
make reminder-install | reminder-test | reminder-uninstall   # evening reminder
```

`make check` also runs `api-types-check`, which fails when the committed
`schema.d.ts` no longer matches the backend's OpenAPI schema.
`frontend/src/api/contract.ts` then checks, at type level, that each
hand-written type in `types/index.ts` still matches its generated counterpart,
so a renamed or retyped field fails `tsc` instead of failing at runtime. CI
does not run `api-types-check` yet; `make check` does.

`make` on its own lists every target.

### Tests

Three layers — `make check` runs all of them:

- **Backend** (pytest, ~440 tests), split by what they protect:

- `tests/test_scoring.py` — the rules in `backend/scoring.py` as pure
  functions: effective targets, the tracking-start boundary, override
  semantics, par arithmetic, warning streaks, status thresholds. These are the
  tests that matter most, because a silent change here would quietly alter what
  your history means.
- `tests/test_accountability.py` — pace arithmetic (including that it rounds
  up and that past days count toward the requirement but not the split),
  streaks, records, commitments, and the ledger's advance-versus-retroactive
  distinction.
- `tests/test_api.py` — the HTTP surface: first-run setup and sign-in
  (including that credentials never reach the database and the passcode is
  never stored in plain text), throttling, category and
  target management (including that changing a target does not rewrite past
  par), log upsert semantics, the timer, tags and search, settings validation,
  export, and the insights endpoints.

- `tests/test_history.py`, `test_restore.py` — undo of every session change,
  the ledger's after-the-fact rules, and restore round-trips and refusals.
- `tests/test_focus_stats.py`, `test_exam_plan.py` — focus-block counts and
  the study-target pace.
- `tests/test_session_editor.py` — what an edit does to "measured" (edited
  timer minutes become manual and keep the reading; other edits don't), tag
  limits, and splits keeping the exam link.
- `tests/test_upgrades.py` — focus blocks, exam prep, plan suggestions,
  target suggestions, the year view, settings groups, the weekly export
  (cadence and rotation) and the reminder's open items.
- `tests/test_domains.py`, `test_life.py`, `test_roadmap.py`,
  `test_quick_add.py`, `test_snapshots.py` — question credit, practice and
  revision, check-ins, exams and their overrides, habits (unticked = not
  done), plans, the letter, git corroboration against a real temporary repo,
  the .ics parser, quick add, snapshots and restore.
- **Frontend components** (Vitest + Testing Library, `make test-frontend`):
  quick-entry parsing, the gauge, tab blocks and their keys, the check-in
  form, the log form's unsaved guard, undo and first-load guard, override
  presets, settings groups, the session editor and the tag input, the timer,
  undo in the day view, restore from an export, and category reordering.
- **End to end** (Playwright, `make e2e`): first-run setup → log → quick add
  and undo → palette → practice → habits, in your installed Brave or Chrome
  (no browser download). It runs a throwaway copy of the app on ports
  8011/5181 with its own data folder, deleted afterwards; with no browser
  found it is skipped.

Each backend test gets an isolated SQLite file in a temp directory, so the
suite never touches `dayshift.db` or your `backups/`.

```bash
make test                          # all
.venv/bin/python -m pytest -k par  # one slice
.venv/bin/python -m pytest -v      # per-test names
```

### Tooling

| Concern | Tool | Config |
|---|---|---|
| Python lint + format | Ruff | `pyproject.toml` |
| TS/React lint | ESLint (flat config) | `frontend/eslint.config.js` |
| Formatting (frontend) | Prettier | `frontend/.prettierrc.json` |
| Types | `tsc --noEmit` | `frontend/tsconfig.json` |
| Tests | pytest | `pytest.ini` |
| CI | GitHub Actions | `.github/workflows/ci.yml` |

CI runs the backend suite against Python 3.11 and 3.13, lints, type-checks,
tests and builds the frontend, and checks the API types and runs the end-to-end
test in Chrome.

Architecture notes, and the reasoning behind the deliberate omissions, are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Handbook

[`docs/handbook.html`](docs/handbook.html) is a thirteen-chapter guide, with real screenshots in `docs/img/`, written for
someone opening Dayshift for the first time — what the scores mean, why today
is excluded from par, how overrides differ from targets. Open it straight from
disk:

```bash
open docs/handbook.html
```

It is a standalone page: no build step, no server, nothing to install.

## Project layout

```
backend/
  app.py              FastAPI entrypoint, logging, error handling, lifespan
  config.py           defaults and startup validation
  auth_store.py       the single user's credentials (auth.json)
  database.py         engine, migrations, snapshots, first-run seeding
  models.py           ORM: categories, category_targets, daily_logs,
                      sessions, tags, settings, weekly_reviews, commitments
  repository.py       turns ORM rows into the plain values scoring takes
  schemas.py          Pydantic request/response models
  scoring.py          pure par / streak / target-resolution logic
  sessions_service.py timer rules (one running session, minutes on stop,
                      focus blocks settled at their planned end)
  exporter.py         the JSON export, and the weekly export to a folder
  settings_store.py   runtime-editable settings, defaults from config.py
  routers/
    auth_routes.py    login, logout, session status
    categories.py     create, rename, archive, reorder, set targets
    logs.py           hand-entered daily totals and overrides
    sessions.py       timer, editing, splitting, tags, search, tag rollup
    settings_routes.py settings, export, backups
    stats.py          dashboard, par, weekly, day detail, insights
    accountability.py pace, records, review, commitments, ledger
scripts/
  reminder.py         the evening notification (reads the DB directly)
  reminder-launchd.sh installs/removes its per-user launchd job
  dump_openapi.py     OpenAPI schema for `make api-types`
  benchmark.py        `make bench`
migrations/         Alembic
tests/
  test_scoring.py   the scoring rules, as pure functions
  test_api.py       the HTTP surface end to end
frontend/
  public/           favicon.svg + PNG icons (generated, see below)
  src/
    api/client.ts   fetch wrapper (credentials: include)
    api/schema.d.ts generated from the backend's OpenAPI (make api-types)
    api/contract.ts type-level checks that types/ matches schema.d.ts
    types/index.ts  TS mirrors of the Pydantic models
    hooks/          useDashboardData (the dashboard's loading and quick add)
    pages/          Setup, Login, Dashboard, Review, Insights, Settings,
                    DayView, Practice, Agenda, Goals, Letter, Year
    components/     GaugeIndicator, ParScore, WeeklyChart, LogEntryForm,
                    OverridePanel, SessionTimer, CategoryEditor,
                    CredentialEditor, PaceStrip,
                    CalendarHeatmap, TrendChart, PatternCharts,
                    Logo, MatrixRain; dashboard/ holds the dashboard's
                    pieces (DomainWindow, DashboardBlocks, MoreMenu)
start.sh            single-command launcher
Makefile            task runner (make help)
docs/ARCHITECTURE.md  how it fits together, and what was left out
```

## API

All routes except `/api/health` and the auth endpoints require the session
cookie.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/status` | Setup state + whether a session is valid |
| POST | `/api/auth/setup` | First-run credential creation (409 once set up) |
| POST | `/api/auth/login` | Check username + passcode, set session cookie |
| POST | `/api/auth/logout` | Clear the cookie |
| PUT | `/api/auth/credentials` | Change username/passcode (needs current one) |
| GET | `/api/logs/categories` | Categories with targets + active days |
| GET | `/api/logs` | Log rows, filterable by date range/category |
| GET | `/api/logs/day/{date}` | All rows for one date |
| PUT | `/api/logs` | Create or update one (date, category) row |
| POST | `/api/logs/adjust` | Add a delta to a day's typed minutes/questions (quick add, undo) |
| DELETE | `/api/logs/{id}` | Delete a row |
| GET | `/api/stats/dashboard` | Gauges + par + weekly + running timer |
| GET | `/api/stats/par` | Par scores only |
| GET | `/api/stats/weekly` | Weekly view only |
| GET | `/api/stats/day/{date}` | One date in full |
| GET | `/api/stats/calendar` | Per-day totals over a range |
| GET | `/api/stats/insights` | Trends, patterns, consistency, comparison |
| GET | `/api/accountability/pace` | What is still required this week |
| GET | `/api/accountability/records` | Streaks and personal bests |
| GET/PUT | `/api/accountability/review` | Weekly numbers and reflection |
| PUT/DELETE | `/api/accountability/commitments` | Weekly intentions |
| GET | `/api/accountability/ledger` | Retroactive overrides |
| POST | `/api/logs/bulk-override` | One override across a date range |
| GET | `/api/practice/summary` | Due revisions, upcoming, topics weakest first |
| GET/POST | `/api/practice/problems` | List / log a problem (counts one question) |
| PATCH/DELETE | `/api/practice/problems/{id}` | Edit (date moves its question) / delete |
| POST | `/api/practice/problems/{id}/reviews` | Record a revision (solid/shaky/forgot) |
| DELETE | `/api/practice/problems/{id}/reviews/{rid}` | Remove a revision |
| GET/PUT | `/api/checkins` | Check-ins in a range / set one day's |
| DELETE | `/api/checkins/{date}` | Remove a check-in (the day becomes a gap) |
| GET | `/api/checkins/insights` | Check-ins with gaps, against day completion |
| GET/POST | `/api/agenda/deadlines` | List / add (an exam sets its day's overrides) |
| PATCH/DELETE | `/api/agenda/deadlines/{id}` | Edit (overrides follow) / delete (taken back) |
| GET | `/api/agenda/today` | The dashboard's Today line (habits and plan included) |
| POST | `/api/agenda/import-ics` | Preview upcoming events from an .ics file's text |
| GET/POST | `/api/goals/milestones` | List (filter by done date) / add |
| PATCH/DELETE | `/api/goals/milestones/{id}` | Edit or finish / delete |
| GET/POST | `/api/goals/habits` | List with 14 days, streaks, 30-day rate / add |
| PATCH/DELETE | `/api/goals/habits/{id}` | Rename, reschedule, archive / delete |
| PUT | `/api/goals/habits/{id}/checks/{date}` | Tick or untick a day |
| GET | `/api/plan/{date}` | Planned vs actual minutes, and tasks |
| PUT | `/api/plan/{date}/minutes` | Replace a day's planned minutes |
| POST | `/api/plan/{date}/tasks` | Add a task |
| POST | `/api/plan/{date}/carry-over` | Copy the previous day's unfinished tasks |
| PATCH/DELETE | `/api/plan/tasks/{id}` | Edit or tick / delete a task |
| GET | `/api/letter/months` | Months with a letter |
| GET | `/api/letter/{YYYY-MM}` | One month, summed up (with hours per exam) |
| GET | `/api/letter/year/{year}` | The year in review |
| GET | `/api/plan/{date}/suggest` | Suggested planned minutes, with reasons |
| GET | `/api/accountability/target-suggestions` | Raise/lower suggestions from recent weeks |
| GET | `/api/settings/export-folder` | Weekly export status |
| POST | `/api/settings/export-folder/now` | Write an export now |
| GET/POST | `/api/corroboration/repos` | Git repositories / add one (validated) |
| DELETE | `/api/corroboration/repos/{id}` | Stop reading a repository |
| GET | `/api/corroboration` | Per category: minutes against commits, with flags |
| POST | `/api/settings/backups/{name}/restore` | Restore a snapshot (current state snapshotted first) |
| GET/POST | `/api/categories` | List / create categories |
| PATCH | `/api/categories/{id}` | Rename, reorder, archive |
| GET/POST | `/api/categories/{id}/targets` | Target history |
| GET | `/api/sessions/running` | The session being timed, if any |
| POST | `/api/sessions/start` · `/stop` · `/discard` | Timer control (`planned_minutes` for a focus block, `deadline_id` to link an exam) |
| GET/POST/PATCH/DELETE | `/api/sessions` | Session CRUD (POST refuses overlaps and unfinished blocks) |
| POST | `/api/sessions/{id}/split` | Split a session in two |
| GET | `/api/sessions/changes?after_the_fact=` | Recent session changes (the ledger's with the flag) |
| POST | `/api/sessions/changes/{id}/undo` | Put sessions back as before a change |
| GET | `/api/corroboration/day/{date}` | Commits that day per session branch/issue |
| GET | `/api/stats/focus?days=` | Focus blocks finished vs ended early |
| POST | `/api/settings/restore-export/preview` · `/restore-export` | Check / restore from an export file |
| POST | `/api/sessions/merge` | Merge sessions of one category and day (refuses, with the reason, otherwise) |
| GET | `/api/sessions/search?q=&tag=` | Search notes and tags; `tag` is an exact tag |
| GET | `/api/sessions/tags/rollup?start=&end=` | Minutes per tag over a period, split by category |
| GET | `/api/sessions/tags/all` | Every tag with its session count and minutes |
| GET/PUT | `/api/settings` | Editable settings (each with its group) |
| POST | `/api/settings/reset?group=` | Reset one group, or all |
| GET | `/api/settings/export.csv` · `.json` | Full data export |

Interactive API docs while the backend runs: http://localhost:8000/docs

The stats endpoints accept an optional `?today=YYYY-MM-DD` to compute against a
different reference date. It is a debugging aid — the UI never sends it.

## Storage notes

- Minutes are `INTEGER` everywhere, never float, to avoid rounding drift.
- Dates are ISO 8601 `YYYY-MM-DD` text in local time — no UTC conversion, since
  this is one user in one timezone.
- `UNIQUE(log_date, category_id)` guarantees one row per category per day;
  re-submitting the same pair updates that row rather than inserting a duplicate.
- Schema changes are managed by **Alembic**; `./start.sh` runs pending
  migrations on boot, after taking a snapshot.
- `dayshift.db` is gitignored and recreated on next start if deleted.
  Deleting it wipes your history and re-seeds the six categories.

## Icons and logo

The mark is the same 270-degree gauge dial the dashboard draws, filled to ~72%
— logo and data share one visual language rather than being unrelated art.

- `frontend/src/components/Logo.tsx` — the in-app mark, themed through Tailwind
  colour classes, legible down to about 14px.
- `frontend/public/favicon.svg` — vector favicon, preferred by modern browsers.
- `favicon-16/32/48.png` and `apple-touch-icon.png` (180px, square-cornered
  since iOS applies its own mask) as fallbacks.

The PNGs were rasterised by a throwaway pure-stdlib script (supersampled
rasteriser plus a minimal PNG writer) specifically so the project never grows
an image dependency just to ship a favicon. To change the mark, edit
`favicon.svg` and `Logo.tsx`, then regenerate the PNGs however you like.

There is deliberately no `site.webmanifest` — the project rules out a PWA.

## Palette

The live palette is in `frontend/tailwind.config.js` and **intentionally
departs from `DESIGN.md`**, which specifies a deliberately muted panel. It was
asked for, and it is the only place the spec is overridden.

It is not arbitrary. The three categorical hues were validated against the
panel surface (`#22283a`) with the data-viz palette checker, all-pairs, dark
mode — lightness band, chroma floor, colour-blind separation (worst pair
ΔE 8.4), normal-vision separation (ΔE 22.5) and contrast all pass.

**Surfaces.** The page and the panel were originally only **1.12:1** apart,
which is effectively the same colour — the panels camouflaged into the
background. They are now **1.34:1**, and the real separation is done by
elevation: a cast shadow, a lit top edge, and a border you can actually see.
Contrast ratios compress hard at the dark end, so no pair of dark greys will
ever read as "separate" on value alone.

| Surface | Colour | Role |
|---|---|---|
| Page | `#0a0b12` | The plane everything sits on |
| Panel | `#22283a` | Raised surface; the validated chart background |
| Raised | `#2e3550` | Hover, buttons, inset wells |
| Border | `#3a4263` | A visible edge, not a hairline guess |

Inputs are deliberately *darker* than the panel they sit on — wells cut into
the surface, the inverse of the panel's own relationship to the page.

| Role | Colour | Used for |
|---|---|---|
| Category 1 | `#1295ab` teal (bright `#22d3ee`) | SDE Project identity |
| Category 2 | `#8b5cf6` violet (bright `#a78bfa`) | AI Automation identity |
| Category 3 | `#ec4899` pink (bright `#f472b6`) | Project Maintenance identity |
| Category 4 | `#5b86f5` blue (bright `#8aaeff`) | DSA identity |
| Category 5 | `#7c9a12` olive (bright `#a8c93a`) | Exercise identity |
| Category 6 | `#c5579a` magenta (bright `#e583bf`) | Coursework identity |
| Good | `#34d399` | At or above target |
| Warning | `#fbbf24` | 50–80% of target |
| Critical | `#ea580c` | Below 50%, or the critical streak |
| Accent | `#60a5fa` | Links, focus, selected state |

Two rules keep the colour meaningful rather than decorative:

- **Category hue answers "which"; status hue answers "how well".** They appear
  in different places — a category dot beside a name, a status colour on the
  mark. Category hues are assigned in fixed order and never cycled; a fourth
  category beyond the sixth gets neutral grey rather than reusing a hue.
  Slots 4–6 were checked within their domain and against their neighbours;
  slot 6 sits close to slot 3, which is acceptable only because the domain
  pager never shows them together.
- **Status colours are reserved** and never used as a series colour. `critical`
  is an orange-red rather than a pure red specifically so it separates from the
  pink category slot — `#ef4444` measured ΔE 11.4 against it, below the 15
  floor, so it was rejected. It was lightened from `#c2410c` to `#ea580c` when
  the panel surface got lighter, because the darker step then fell below 3:1.

Magnitude (the heatmap) uses a one-hue sequential ramp per category, dark to
bright — never a rainbow. Colour is never the only channel: every category is
named and every status carries a text label.

## Fonts

`index.html` deliberately loads **no** webfonts. DESIGN.md allows Google Fonts,
but the app makes no external network calls of any kind, and the stricter rule
wins — so the stacks in `tailwind.config.js` name JetBrains Mono and Inter first
(used if you have them installed) and fall back to the macOS system faces. To
opt into webfonts instead, add the Google Fonts `<link>` back to `index.html`.

## Troubleshooting

- **"Port 8000 is already in use"** — a previous run did not shut down.
  `pkill -f "uvicorn app:app"`, then retry.
- **Backend errors on start** — check `backend.log` in the project root.
- **Par shows `—`** — expected before `TRACKING_START_DATE`, or when the window
  holds no active days for that category yet.
