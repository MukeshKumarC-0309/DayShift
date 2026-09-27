import { useState } from 'react'

import { api } from '../api/client'
import type { Category, CategoryTarget } from '../types'

/**
 * Category management: rename, archive, reorder, and set targets.
 *
 * Targets are never edited in place. Setting one appends an effective-dated
 * record, so days already scored keep the target that applied when they were
 * recorded. Backdating is possible but warned about, because it does rewrite
 * how past days are judged.
 */

const DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

interface Props {
  categories: Category[]
  onChanged: () => void
  onSessionExpired: () => void
}

function todayIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export default function CategoryEditor({
  categories,
  onChanged,
  onSessionExpired,
}: Props) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [history, setHistory] = useState<Record<number, CategoryTarget[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Target draft state, per category.
  const [target, setTarget] = useState('')
  const [days, setDays] = useState<Set<string>>(new Set())
  // Questions finish line (DSA). Empty means none.
  const [questions, setQuestions] = useState('')
  const [from, setFrom] = useState(todayIso())

  // New-category form.
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTarget, setNewTarget] = useState('60')
  // New categories join the last domain unless you pick another.
  const domains = [...new Set(categories.map((c) => c.group_name))]
  const [newDomain, setNewDomain] = useState('')
  const [newDays, setNewDays] = useState<Set<string>>(
    new Set(['MON', 'TUE', 'WED', 'THU', 'FRI']),
  )

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function open(category: Category) {
    if (expanded === category.id) {
      setExpanded(null)
      return
    }
    setExpanded(category.id)
    setTarget(String(category.daily_target_minutes))
    setQuestions(category.question_target ? String(category.question_target) : '')
    setDays(new Set(category.active_days.split(',').filter(Boolean)))
    setFrom(todayIso())
    try {
      setHistory({ ...history, [category.id]: await api.targets(category.id) })
    } catch {
      setError('Could not load the target history.')
    }
  }

  /** Swap a category with its neighbour; the dashboard shows this order. */
  function move(position: number, delta: -1 | 1) {
    const ids = categories.map((c) => c.id)
    const other = position + delta
    if (other < 0 || other >= ids.length) return
    ;[ids[position], ids[other]] = [ids[other], ids[position]]
    void run(() => api.reorderCategories(ids))
  }

  function toggle(set: Set<string>, code: string, apply: (next: Set<string>) => void) {
    const next = new Set(set)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    apply(next)
  }

  const backdating = from < todayIso()

  return (
    <section className="panel px-5 py-4">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="panel-label">Categories</h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="btn-quiet font-mono"
        >
          {adding ? '− Cancel' : '+ New category'}
        </button>
      </div>
      <p className="mb-3 font-sans text-[11px] text-faint">
        Changing a target applies from a date forward — past scores keep the target that
        was in force when they were recorded.
      </p>

      {adding && (
        <div className="mb-4 rounded-sm border border-edge bg-base px-3 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={newName}
              placeholder="Name"
              maxLength={64}
              onChange={(e) => setNewName(e.target.value)}
              className="term-input max-w-[220px] text-[13px]"
              aria-label="New category name"
            />
            <input
              type="number"
              min={0}
              max={1440}
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              className="term-input max-w-[100px] text-[13px]"
              aria-label="New category target"
            />
            <span className="font-mono text-[11px] text-faint">min/day</span>
            <input
              type="text"
              list="dayshift-domains"
              value={newDomain}
              maxLength={32}
              placeholder={domains[domains.length - 1] ?? 'Domain'}
              onChange={(e) => setNewDomain(e.target.value)}
              className="term-input max-w-[140px] text-[13px]"
              aria-label="Domain for the new category"
            />
          </div>
          <div className="mb-3 flex flex-wrap gap-1">
            {DAY_CODES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => toggle(newDays, code, setNewDays)}
                className={`rounded-sm border px-2 py-1 font-mono text-[11px] transition-colors ${
                  newDays.has(code)
                    ? 'border-steel text-steel'
                    : 'border-edge text-faint hover:border-muted'
                }`}
              >
                {code}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || !newName.trim() || newDays.size === 0}
            onClick={() =>
              run(async () => {
                await api.createCategory({
                  name: newName.trim(),
                  daily_target_minutes: Number(newTarget),
                  active_days: [...newDays].join(','),
                  ...(newDomain.trim() ? { group_name: newDomain.trim() } : {}),
                })
                setNewName('')
                setAdding(false)
              })
            }
            className="btn text-[13px]"
          >
            Create
          </button>
        </div>
      )}

      <div className="divide-y divide-divider">
        {categories.map((category, position) => (
          <div key={category.id} className="py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => open(category)}
                className="flex items-baseline gap-2 text-left"
                aria-expanded={expanded === category.id}
              >
                <span
                  className={`font-sans text-sm ${
                    category.archived ? 'text-faint line-through' : 'text-ink'
                  }`}
                >
                  {category.name}
                </span>
                <span className="font-mono text-[11px] text-faint">
                  {category.daily_target_minutes} min
                  {category.question_target
                    ? ` or ${category.question_target} Q`
                    : ''} · {category.active_days} ·{' '}
                  <span className="text-muted">{category.group_name}</span>
                </span>
              </button>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy || position === 0}
                  onClick={() => move(position, -1)}
                  className="btn-quiet font-mono"
                  aria-label={`Move ${category.name} up`}
                  title="Move up — the dashboard shows categories in this order"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={busy || position === categories.length - 1}
                  onClick={() => move(position, 1)}
                  className="btn-quiet font-mono"
                  aria-label={`Move ${category.name} down`}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      api.updateCategory(category.id, { archived: !category.archived }),
                    )
                  }
                  className="btn-quiet font-mono"
                >
                  {category.archived ? 'Restore' : 'Archive'}
                </button>
                <button
                  type="button"
                  onClick={() => open(category)}
                  className="btn-quiet font-mono"
                >
                  {expanded === category.id ? 'Close' : 'Edit'}
                </button>
              </div>
            </div>

            {expanded === category.id && (
              <div className="mt-3 rounded-sm border border-edge bg-base px-3 py-3">
                <label className="mb-2 flex flex-wrap items-center gap-3">
                  <span className="w-20 shrink-0 font-mono text-[11px] text-muted">
                    Rename
                  </span>
                  <input
                    type="text"
                    defaultValue={category.name}
                    maxLength={64}
                    onBlur={(e) => {
                      const name = e.target.value.trim()
                      if (name && name !== category.name) {
                        void run(() => api.updateCategory(category.id, { name }))
                      }
                    }}
                    className="term-input max-w-[220px] text-[13px]"
                  />
                </label>

                <label className="mb-2 flex flex-wrap items-center gap-3">
                  <span className="w-20 shrink-0 font-mono text-[11px] text-muted">
                    Domain
                  </span>
                  <input
                    type="text"
                    list="dayshift-domains"
                    defaultValue={category.group_name}
                    maxLength={32}
                    onBlur={(e) => {
                      const group = e.target.value.trim()
                      if (group && group !== category.group_name) {
                        void run(() =>
                          api.updateCategory(category.id, { group_name: group }),
                        )
                      }
                    }}
                    className="term-input max-w-[160px] text-[13px]"
                  />
                  <span className="font-mono text-[11px] text-faint">
                    which dashboard page it lives on
                  </span>
                </label>

                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <span className="w-20 shrink-0 font-mono text-[11px] text-muted">
                    Target
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="term-input max-w-[100px] text-[13px]"
                    aria-label="Target minutes"
                  />
                  <span className="font-mono text-[11px] text-faint">min/day or</span>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={questions}
                    placeholder="—"
                    onChange={(e) => setQuestions(e.target.value)}
                    className="term-input max-w-[70px] text-[13px]"
                    aria-label="Question target (optional)"
                  />
                  <span className="font-mono text-[11px] text-faint">
                    questions, whichever first
                  </span>
                </div>

                <div className="mb-2 flex flex-wrap items-start gap-3">
                  <span className="w-20 shrink-0 pt-1 font-mono text-[11px] text-muted">
                    Days
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {DAY_CODES.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => toggle(days, code, setDays)}
                        className={`rounded-sm border px-2 py-1 font-mono text-[11px] transition-colors ${
                          days.has(code)
                            ? 'border-steel text-steel'
                            : 'border-edge text-faint hover:border-muted'
                        }`}
                      >
                        {code}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="mb-1 flex flex-wrap items-center gap-3">
                  <span className="w-20 shrink-0 font-mono text-[11px] text-muted">
                    From
                  </span>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="term-input max-w-[160px] text-[13px]"
                  />
                  <button
                    type="button"
                    disabled={busy || days.size === 0}
                    onClick={() =>
                      run(async () => {
                        await api.setTarget(category.id, {
                          daily_target_minutes: Number(target),
                          active_days: [...days].join(','),
                          effective_from: from,
                          // Always explicit here: an empty field clears it (0).
                          question_target: questions.trim() ? Number(questions) : 0,
                        })
                        setHistory({
                          ...history,
                          [category.id]: await api.targets(category.id),
                        })
                      })
                    }
                    className="btn text-[13px]"
                  >
                    Apply
                  </button>
                </label>

                {backdating && (
                  <p className="mb-2 font-mono text-[11px] text-warn">
                    Backdating rewrites how days from {from} onward are scored.
                  </p>
                )}

                {(history[category.id]?.length ?? 0) > 0 && (
                  <div className="mt-3 border-t border-divider pt-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                      Target history
                    </span>
                    <ul className="mt-1 space-y-0.5">
                      {history[category.id].map((record) => (
                        <li
                          key={record.id}
                          className="flex items-baseline justify-between font-mono text-[11px] text-muted"
                        >
                          <span>
                            from {record.effective_from} · {record.daily_target_minutes}{' '}
                            min · {record.active_days}
                          </span>
                          {history[category.id].length > 1 && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await api.deleteTarget(category.id, record.id)
                                  setHistory({
                                    ...history,
                                    [category.id]: await api.targets(category.id),
                                  })
                                })
                              }
                              className="btn-quiet"
                            >
                              remove
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <p className="mt-2 font-mono text-xs text-critical">{error}</p>}
      <datalist id="dayshift-domains">
        {domains.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </section>
  )
}
