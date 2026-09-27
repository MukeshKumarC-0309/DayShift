import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'

import { api } from '../api/client'
import IcsImport from '../components/IcsImport'
import PageHeader from '../components/PageHeader'
import PlanPanel from '../components/PlanPanel'
import { formatMinutes } from '../dates'
import { categoryTheme } from '../theme'
import type { Category, Deadline, DeadlineKind } from '../types'
import { colourIndex } from '../domains'

/**
 * Exams, assignments and anything else with a date.
 *
 * An EXAM sets its day's targets automatically: 0 min for every category
 * unless you change them here first. Those are ordinary overrides — the
 * weekly chart marks the day with `*`, and an exam added after its day has
 * passed shows up in the honesty ledger like any other late override.
 */

interface Props {
  onSessionExpired: () => void
}

const KINDS: { value: DeadlineKind; label: string }[] = [
  { value: 'exam', label: 'Exam' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'other', label: 'Other' },
]

function localToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function countdown(daysLeft: number): string {
  if (daysLeft === 0) return 'today'
  if (daysLeft === 1) return 'tomorrow'
  if (daysLeft === -1) return 'yesterday'
  return daysLeft > 0 ? `in ${daysLeft} days` : `${-daysLeft} days ago`
}

/** "Every target 0 that day", or the exceptions: "Coursework 60, everything else 0". */
function examTargets(deadline: Deadline, nameOf: (id: number) => string): string {
  const nonZero = deadline.overrides.filter((o) => o.target_minutes > 0)
  if (nonZero.length === 0) return 'Every target 0 that day'
  const listed = nonZero
    .map((o) => `${nameOf(o.category_id)} ${o.target_minutes}`)
    .join(', ')
  return nonZero.length === deadline.overrides.length
    ? `Targets that day: ${listed}`
    : `Targets that day: ${listed}, everything else 0`
}

interface Draft {
  id: number | null
  title: string
  kind: DeadlineKind
  due_date: string
  notes: string
  /** Exam-day targets as typed, per category id. */
  targets: Record<number, string>
  /** Study target in hours, as typed ('' = none). */
  studyHours: string
}

function emptyDraft(categories: Category[]): Draft {
  return {
    id: null,
    title: '',
    kind: 'exam',
    due_date: localToday(),
    notes: '',
    targets: Object.fromEntries(categories.map((c) => [c.id, '0'])),
    studyHours: '',
  }
}

export default function Agenda({ onSessionExpired }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [showDone, setShowDone] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [cats, list] = await Promise.all([api.categories(), api.deadlines(showDone)])
      setCategories(cats)
      setDeadlines(list)
      setDraft((d) => d ?? emptyDraft(cats))
      setError(null)
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Could not load the agenda.')
    }
  }, [showDone, onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  /** Run a change and reload; false if it failed (the error is shown). */
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setError(null)
    try {
      await fn()
      await load()
      return true
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Something went wrong.')
      return false
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!draft || !draft.title.trim()) return
    setSaving(true)
    const overrides =
      draft.kind === 'exam'
        ? categories.map((c) => ({
            category_id: c.id,
            target_minutes: Math.max(0, Number(draft.targets[c.id] || 0)),
          }))
        : undefined
    const hours = Number(draft.studyHours)
    const body = {
      title: draft.title.trim(),
      kind: draft.kind,
      due_date: draft.due_date,
      notes: draft.notes.trim() || null,
      ...(overrides ? { overrides } : {}),
      study_target_minutes:
        draft.studyHours.trim() && hours > 0 ? Math.round(hours * 60) : null,
    }
    const ok = await run(() =>
      draft.id === null ? api.createDeadline(body) : api.updateDeadline(draft.id, body),
    )
    // Keep what was typed if the save failed.
    if (ok) setDraft(emptyDraft(categories))
    setSaving(false)
  }

  function edit(deadline: Deadline) {
    const targets: Record<number, string> = Object.fromEntries(
      categories.map((c) => [c.id, '0']),
    )
    for (const o of deadline.overrides) targets[o.category_id] = String(o.target_minutes)
    setDraft({
      id: deadline.id,
      title: deadline.title,
      kind: deadline.kind,
      due_date: deadline.due_date,
      notes: deadline.notes ?? '',
      targets,
      studyHours:
        deadline.study_target_minutes !== null
          ? String(Math.round((deadline.study_target_minutes / 60) * 10) / 10)
          : '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const nameOf = (id: number) => categories.find((c) => c.id === id)?.name ?? `#${id}`

  return (
    <main className="min-h-screen px-5 pb-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[1000px]">
        <PageHeader page="agenda">
          <Link to="/practice" className="btn-quiet whitespace-nowrap font-mono">
            Practice
          </Link>
        </PageHeader>

        {error && (
          <p className="mb-6 rounded border border-critical/40 bg-critical/5 px-3 py-2 font-mono text-xs text-critical">
            {error}
          </p>
        )}

        <div className="mb-6">
          <PlanPanel onSessionExpired={onSessionExpired} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
          {/* --- The list ------------------------------------------------ */}
          <section className="panel px-5 py-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="panel-label">Coming up</h2>
              <label className="flex items-center gap-2 font-mono text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={showDone}
                  onChange={(e) => setShowDone(e.target.checked)}
                  className="accent-steel"
                />
                Show done
              </label>
            </div>

            {deadlines.length === 0 ? (
              <p className="font-sans text-sm text-muted">
                Nothing on the agenda. Add an exam and its day will stop counting against
                you automatically.
              </p>
            ) : (
              <ul className="divide-y divide-divider">
                {deadlines.map((d) => {
                  const soon = d.days_left >= 0 && d.days_left <= 3 && !d.done
                  return (
                    <li key={d.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span
                            className={`rounded-sm border px-1.5 font-mono text-[10px] uppercase ${
                              d.kind === 'exam'
                                ? 'border-critical/50 text-critical'
                                : 'border-edge text-muted'
                            }`}
                          >
                            {d.kind}
                          </span>
                          <span
                            className={`truncate font-sans text-sm ${d.done ? 'text-faint line-through' : 'text-ink'}`}
                          >
                            {d.title}
                          </span>
                        </div>
                        <span
                          className={`font-mono text-[11px] ${soon ? 'text-warn' : 'text-muted'}`}
                        >
                          {longDate(d.due_date)} · {countdown(d.days_left)}
                        </span>
                      </div>
                      {d.notes && (
                        <p className="mt-1 font-sans text-[12px] text-muted">{d.notes}</p>
                      )}
                      {(d.kind === 'exam' || d.studied_minutes > 0) && (
                        <p
                          className={`mt-1 font-mono text-[11px] ${d.studied_minutes > 0 ? 'text-steel' : 'text-faint'}`}
                        >
                          {d.studied_minutes > 0
                            ? `${formatMinutes(d.studied_minutes)} studied for it`
                            : 'Nothing studied for it yet — pick it in the timer’s “For” list'}
                          {d.study_target_minutes !== null &&
                            ` · of ${formatMinutes(d.study_target_minutes)}`}
                        </p>
                      )}
                      {d.study_target_minutes !== null && !d.done && (
                        <StudyPace deadline={d} />
                      )}
                      {d.kind === 'exam' && d.overrides.length > 0 && (
                        <p className="mt-1 font-mono text-[10px] text-faint">
                          {examTargets(d, nameOf)}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            run(() => api.updateDeadline(d.id, { done: !d.done }))
                          }
                          className="btn-quiet border border-edge font-mono text-[11px]"
                        >
                          {d.done ? 'Not done' : 'Done'}
                        </button>
                        <button
                          type="button"
                          onClick={() => edit(d)}
                          className="btn-quiet font-mono text-[11px]"
                        >
                          Edit
                        </button>
                        {confirmDelete === d.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDelete(null)
                                void run(() => api.deleteDeadline(d.id))
                              }}
                              className="btn-quiet font-mono text-[11px] text-critical"
                            >
                              Delete{d.kind === 'exam' ? ' and restore targets' : ''}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(null)}
                              className="btn-quiet font-mono text-[11px]"
                            >
                              Keep
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(d.id)}
                            className="btn-quiet font-mono text-[11px]"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* --- Add / edit ---------------------------------------------- */}
          <div className="space-y-6">
            {draft && (
              <section className="panel px-5 py-4">
                <h2 className="panel-label mb-3">{draft.id === null ? 'Add' : 'Edit'}</h2>
                <form onSubmit={save} className="space-y-2.5">
                  <div className="flex gap-1" role="radiogroup" aria-label="Kind">
                    {KINDS.map((k) => (
                      <button
                        key={k.value}
                        type="button"
                        role="radio"
                        aria-checked={draft.kind === k.value}
                        onClick={() => setDraft({ ...draft, kind: k.value })}
                        className={`rounded-sm border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                          draft.kind === k.value
                            ? 'border-steel bg-steel/15 text-ink'
                            : 'border-edge text-muted hover:text-ink'
                        }`}
                      >
                        {k.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    required
                    maxLength={200}
                    placeholder={
                      draft.kind === 'exam' ? 'e.g. OS midterm' : 'e.g. DBMS lab 4'
                    }
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    className="term-input text-[13px]"
                    aria-label="Title"
                  />
                  <input
                    type="date"
                    required
                    value={draft.due_date}
                    onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                    className="term-input max-w-[180px] text-[13px]"
                    aria-label="Date"
                  />
                  <input
                    type="text"
                    maxLength={2000}
                    placeholder="Notes (optional)"
                    value={draft.notes}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    className="term-input text-[13px]"
                    aria-label="Notes"
                  />
                  {draft.kind !== 'other' && (
                    <label className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted">
                        Study target
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        step={0.5}
                        inputMode="decimal"
                        placeholder="hours"
                        value={draft.studyHours}
                        onChange={(e) =>
                          setDraft({ ...draft, studyHours: e.target.value })
                        }
                        className="term-input w-[90px] text-[13px]"
                        aria-label="Study target in hours"
                      />
                      <span className="font-mono text-[11px] text-faint">
                        h before it (optional)
                      </span>
                    </label>
                  )}

                  {draft.kind === 'exam' && (
                    <div className="rounded border border-divider px-3 py-2.5">
                      <p className="mb-2 font-sans text-[12px] text-muted">
                        Targets on exam day. These replace the usual targets for that date
                        only.
                      </p>
                      <div className="space-y-1.5">
                        {categories.map((c) => (
                          <label key={c.id} className="flex items-center gap-2">
                            <span
                              className="dot"
                              style={{
                                backgroundColor: categoryTheme(colourIndex(c.id)).bright,
                              }}
                              aria-hidden="true"
                            />
                            <span className="w-36 truncate font-sans text-[12px] text-muted">
                              {c.name}
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={1440}
                              inputMode="numeric"
                              value={draft.targets[c.id] ?? '0'}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  targets: { ...draft.targets, [c.id]: e.target.value },
                                })
                              }
                              className="term-input max-w-[80px] py-1 text-[12px]"
                              aria-label={`${c.name} target on exam day`}
                            />
                            <span className="font-mono text-[10px] text-faint">min</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-1">
                    {draft.id !== null ? (
                      <button
                        type="button"
                        onClick={() => setDraft(emptyDraft(categories))}
                        className="btn-quiet font-mono text-[11px]"
                      >
                        Cancel
                      </button>
                    ) : (
                      <span />
                    )}
                    <button type="submit" disabled={saving} className="btn">
                      {saving ? 'Saving…' : draft.id === null ? 'Add' : 'Save changes'}
                    </button>
                  </div>
                </form>
              </section>
            )}
            <IcsImport onAdded={() => void load()} onSessionExpired={onSessionExpired} />
          </div>
        </div>
      </div>
    </main>
  )
}

/** "1h 55m a day to reach 10h" — or that it's reached — with a progress bar. */
function StudyPace({ deadline }: { deadline: Deadline }) {
  const target = deadline.study_target_minutes ?? 0
  const share = target ? Math.min(1, deadline.studied_minutes / target) : 0
  const needed = deadline.needed_per_day
  return (
    <div className="mt-1.5 max-w-[360px]">
      <svg
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
        className="mb-1 h-1.5 w-full"
        role="img"
        aria-label={`${Math.round(share * 100)}% of the study target`}
      >
        <rect x={0} y={0} width={100} height={6} rx={3} className="fill-raised" />
        <rect
          x={0}
          y={0}
          width={share * 100}
          height={6}
          rx={3}
          className={share >= 1 ? 'fill-healthy' : 'fill-steel'}
        />
      </svg>
      <p className="font-mono text-[11px] text-muted">
        {needed === 0
          ? 'Target reached.'
          : needed === null
            ? deadline.days_left <= 0
              ? 'No study days left before it.'
              : ''
            : `${formatMinutes(needed)} a day until the day before to reach it.`}
      </p>
    </div>
  )
}
