# Roadmap

Scaling Dayshift up as a **tracking** tool. Batches are ordered so each one
stands on the last; every batch is independently shippable and reviewable.

Legend: `[ ]` planned · `[~]` in progress · `[x]` done

**Status:** Batches 0–5 are built and shipped. Batches 6–7 are still planned.

---

## Batch 0 — The correctness gap that blocks everything else ✅

Not a feature. A bug in how history is interpreted, and the reason Batch 1
looks the way it does.

Changing a category's `daily_target_minutes` **retroactively rewrites every
past par score**, because `effective_target()` reads the category's *current*
target for any day without an override. Measured: 450 minutes across 3 days
reads as 83.3% par at a 180 target and 125% at a 120 target — the same logged
minutes, a different history.

That matters more here than in most apps, because the tool exists to tell you
the truth about what you actually did. Any feature that makes targets easier to
change (Batch 1) makes this worse, so it goes first.

- [x] **Effective-dated targets** — a `category_targets` table of
      `(category_id, effective_from, daily_target_minutes, active_days)`.
      Scoring resolves the target that applied *on that date*. Past par becomes
      immutable; changing today's target affects today forward.
- [x] **Alembic migrations** — deliberately skipped until now
      (`docs/ARCHITECTURE.md`). The moment schema changes land on real data, it
      is needed.
- [x] Backfill the existing rows into the new table as a single
      `effective_from = TRACKING_START_DATE` record.

---

## Batch 1 — Control the tracker without touching the database ✅

Everything you currently need to edit `config.py` or open SQLite to do. Without
this, the tracker calcifies the moment your schedule changes.

- [x] **Settings page** — a real page, in the SOC panel style.
- [x] Edit a category's target and active days (writes a new effective-dated
      record, never mutates history).
- [x] Add, rename, and **archive** categories. Archive rather than delete, so
      historical logs keep their meaning.
- [x] Reorder categories (dashboard order should match how you think).
- [x] Editable thresholds: warning %, critical %, consecutive-day counts, par
      window length, tracking start date. All currently constants in
      `config.py`.
- [x] **Data export** — CSV and JSON, full history. Portability and backup.
- [x] **Automatic DB snapshot** on startup, keeping the last N. One
      `rm dayshift.db` currently destroys everything.
- [x] Password rotation from the UI — Settings → Credentials, once
      credentials moved out of `.env` into `auth.json`.

---

## Batch 2 — Sessions: log as you work, not from memory ✅

The biggest change to what the tracker *is*. Today you type one aggregate
number per category per day, recalled at night. Sessions turn it into a record
of what actually happened.

- [x] **Live timer** — start / pause / stop per category, persisted so a
      refresh or restart does not lose a running session.
- [x] **`sessions` table** — `(category_id, started_at, ended_at, minutes,
      note)`. Many per day, per category.
- [x] Daily total derives from sessions plus typed minutes, stored apart and
      shown apart, so "measured" and "estimated" stay distinguishable.
- [x] Migration path: existing `daily_logs` rows become single manual entries.
- [x] Edit / split / delete a session after the fact (day view). Editing a
      timer session's minutes marks it edited and keeps the measured reading.
- [x] Merge sessions — day view; refused across other sessions or different exams.
- [x] **Time-of-day view** — when in the day the work actually lands.
- [ ] Idle detection prompt — **not built, deliberately**. A browser can only
      see activity inside Dayshift's own tab, not the editor you are working
      in, so it would flag real work as idle; true idle detection needs
      OS-level input monitoring. `Discard` plus the timer's 3-hour prompt cover
      the "left it running" case.

**Decision taken:** sessions sit **alongside** the hand-entered daily total.
A day's scored minutes are `daily_logs.minutes_logged` + that day's finished
sessions. The log form shows what the timer already captured (`+45 timed`) so
the two are never accidentally added twice, and the gauge shows the split.

---

## Batch 3 — Memory: what you did, not just how long ✅

Minutes alone stop being useful after about a month. This is what makes old
data worth reading.

- [x] **Notes per session** — free text, terminal-styled.
- [x] **Tags** on sessions — set in the timer or the day view's editor,
      shown in the day view.
- [x] Tag rollups — Insights → *Time by tag*, per period, split by category.
- [x] Search across notes and tags — `/search`, key `/`.
- [x] Per-day detail view: every session, note and tag for one date.
- [x] "Last week in review" digest — the weekly review (Batch 5), and now
      the monthly letter.
- [x] Link a session to a git branch or issue reference (plain text, no
      network) — `sessions.git_ref`, set in the timer, editor or add form.

---

## Batch 4 — Perspective: horizons longer than 7 days ✅

The current dashboard cannot answer "am I better than I was in October?"

- [x] **Month calendar heatmap** — contribution-grid style, per category and
      combined.
- [x] 30 / 90 / 365-day views with a period selector.
- [x] Moving averages (7-day, 28-day) drawn over the daily bars.
- [x] **Day-of-week analysis** — which days you actually deliver on.
- [x] **Consistency metrics** — variance and longest streak, not just totals.
      180 every day and 1260 in one Sunday currently score identically; they
      are not the same habit.
- [x] Period comparison: this month vs last, this term vs last.
- [x] Cross-category view: does AI Automation time come out of SDE time?
- [ ] Year in review — the 365-day insights range and the monthly letters
      cover this for now; a dedicated view is worth building once there is a
      full year of data (tracking starts 2026-10-01).

---

## Batch 5 — Accountability, without gamification ✅

Pressure that comes from seeing the truth clearly, not from points.

- [x] **Weekly review ritual** — a Sunday prompt with the week's numbers and a
      box to write what happened. Stored, and readable later.
- [x] **Streaks and personal records** — consecutive days at or above target,
      best week, best month.
- [x] **Pace / forecast** — "3 days left in the window; 240 min to reach 100%."
- [x] **Commitments** — declare next week's intent, then see intent vs actual.
- [x] **Override reasons** — an optional short note on every override.
- [x] **Honesty ledger** — a visible list of targets lowered *after* the day
      they applied to. Not enforcement (README rules that out, correctly) —
      just making the thing you already chose to allow visible to you.
- [ ] Configurable escalation at 5+ consecutive days — **not built**. The
      warning/critical thresholds are already editable in Settings, so a
      third tier would be another band with nothing new to say.

---

## Domains — Daily categories ✅

- [x] DSA, Exercise and Coursework, every day of the week.
- [x] Question targets (DSA: 2 questions or 120 min, further route wins).
- [x] One domain at a time on the dashboard; tabbed blocks for the rest.

---

## Life tracking ✅

- [x] DSA problem log with 3 / 10 / 30-day revision (revisions are not questions).
- [x] Daily check-ins (sleep, energy, mood); missing days stay gaps.
- [x] Agenda: exams set their day's overrides automatically.
- [x] Project milestones, next-day plan (minutes + tasks), monthly letter,
      yes/no habits (unticked = not done).

---

## Batch 6 — Corroboration from local signals ✅

Cross-checks your self-report against evidence already on the machine. All of
this is local filesystem reading — no network calls, so it stays inside
the project's constraints.

- [x] **Local git activity** — point Dayshift at repo paths; read commit
      timestamps to corroborate SDE Project time.
- [x] Divergence flags: "logged 180 min, no commits that day" — informational,
      never automatic adjustment.
- [x] Optional local `.ics` calendar import; an imported exam sets its day's
      overrides like a typed one.
- [ ] Optional ActivityWatch / screen-time import — **skipped** (not used).

**Worth being honest about:** this is the feature most likely to make the tool
feel like surveillance of yourself. Recommend building it read-only and
dismissible, and dropping it if it makes you avoid the app.

---

## Batch 7 — Craft and durability ✅

Not user-visible, but this is what keeps the tool alive in year two.

- [x] **Frontend tests** — Vitest + Testing Library (35).
- [x] **E2E** — Playwright over the real login → log → dashboard path.
- [x] **Command palette** — keyboard-first navigation, fits the terminal feel.
- [x] Quick-entry hotkeys ("+25 to SDE" without touching the mouse).
- [x] **Undo** for the last write.
- [x] Inline editing directly on the weekly chart bars.
- [x] Dedicated mobile entry view (logging on a phone, reading on a laptop).
- [x] Backup restore flow, not just snapshot.
- [x] Performance pass once history exceeds ~5k sessions.

---

## Upgrades ✅

- [x] Focus blocks (25/50) that stop themselves at the planned length.
- [x] Exam prep: sessions linked to exams, hours studied per exam.
- [x] Revision session on Practice.
- [x] Override presets (Sick day, Travel, Festival, Half day).
- [x] Plan *Suggest*; weekly-review target check (never auto-applied).
- [x] Year in review.
- [x] Weekly export to a synced folder; evening macOS reminder (launchd).
- [x] Generated API types with a drift check; dashboard split up.

---

## Safety and polish ✅

- [x] Undo for delete, edit, split and merge — any time, from a kept history.
- [x] Deleted/edited sessions after the day in the honesty ledger, restorable.
- [x] Restore from a weekly JSON export (replace, snapshot first).
- [x] Commits per session branch/issue; top tags and branches in the review.
- [x] Focus-block stats; exam study targets with a daily pace.
- [x] CI runs the API-types check and the end-to-end test.
- [x] Windows, natively from Command Prompt (`start.cmd`, `dayshift`), checked in CI.

---

## Requires relaxing the project constraints

Genuinely useful, currently ruled out by the project constraints. Listed so the
tradeoff is explicit rather than silently skipped.

| Idea | Constraint it breaks |
|---|---|
| Push/email reminders and nudges (a local macOS notification now exists) | no external network calls |
| Cloud sync across devices | no cloud sync, no external database |
| PWA / installable mobile app | no PWA manifest, no mobile app |
| Native desktop wrapper (Tauri) | arguably "no deployment config" |
| Sharing a weekly summary with a friend for accountability | single-user, no network |

The local macOS notification via `launchd` (`make reminder-install`) is the
closest thing to reminders that stays inside the rules, and is now built.

---

## Deliberately not planned

- **Points, badges, levels, XP.** They reward logging, and this tool's only
  value is that the logs are true. Anything that makes a number feel good to
  inflate is working against the point.
- **Streak freezes / forgiveness tokens.** Same reason.
- **Social feeds or leaderboards.** Single-user by design.
- **Automatic time inference** that writes entries without confirmation. The
  tracker should never assert you did work you did not confirm.
