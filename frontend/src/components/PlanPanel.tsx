import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../api/client'
import { dayLabel, localToday, shiftDate } from '../dates'
import type { DayPlan } from '../types'

/**
 * The daily plan: minutes per category AND a task list (the user chose both).
 *
 * Set it the evening before; the day itself shows planned against actual. A
 * plan is intent, not a target — it never changes a score.
 */

interface Props {
  onSessionExpired: () => void
}

export default function PlanPanel({ onSessionExpired }: Props) {
  const today = localToday()
  const tomorrow = shiftDate(today, 1)
  // Planning ahead happens in the evening; during the day, today's plan is
  // the one worth seeing.
  const [day, setDay] = useState(() => (new Date().getHours() >= 18 ? tomorrow : today))
  const [plan, setPlan] = useState<DayPlan | null>(null)
  const [draft, setDraft] = useState<Record<number, string>>({})
  const [task, setTask] = useState('')
  const [saved, setSaved] = useState(false)
  // Why each pre-filled number is what it is; cleared on any manual change.
  const [reasons, setReasons] = useState<Record<number, string>>({})
  const [exams, setExams] = useState<string[]>([])
  const loadedDay = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const p = await api.plan(day)
      setPlan(p)
      // Reset the minute fields only for a new day: reloading after a task is
      // added must not throw away minutes typed (or suggested) but not saved.
      if (loadedDay.current !== day) {
        loadedDay.current = day
        setDraft(
          Object.fromEntries(
            p.categories.map((c) => [c.category_id, c.planned ? String(c.planned) : '']),
          ),
        )
        setReasons({})
        setExams([])
      }
      setError(null)
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Could not load the plan.')
    }
  }, [day, onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn()
      await load()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Something went wrong.')
    }
  }

  async function suggest() {
    try {
      const s = await api.planSuggestion(day)
      setDraft(
        Object.fromEntries(
          s.items.map((i) => [i.category_id, i.minutes ? String(i.minutes) : '']),
        ),
      )
      setReasons(Object.fromEntries(s.items.map((i) => [i.category_id, i.reason])))
      setExams(s.upcoming_exams)
      setSaved(false)
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Could not suggest a plan.')
    }
  }

  async function saveMinutes() {
    if (!plan) return
    await run(() =>
      api.setPlanMinutes(
        day,
        plan.categories.map((c) => ({
          category_id: c.category_id,
          minutes: Math.max(0, Number(draft[c.category_id] || 0)),
        })),
      ),
    )
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  const started = plan !== null && (plan.is_today || plan.is_past)
  const openTasks = plan?.tasks.filter((t) => !t.done).length ?? 0

  return (
    <section className="panel px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="panel-label">Plan</h2>
        <div className="flex items-center gap-1" role="group" aria-label="Which day">
          {[
            { value: today, label: 'Today' },
            { value: tomorrow, label: 'Tomorrow' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={day === option.value}
              onClick={() => setDay(option.value)}
              className={`rounded-sm border px-2.5 py-1 font-mono text-[11px] ${
                day === option.value
                  ? 'border-steel bg-steel/15 text-ink'
                  : 'border-edge text-muted hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
          <input
            type="date"
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="term-input ml-1 max-w-[150px] py-1 text-[12px]"
            aria-label="Plan date"
          />
        </div>
      </div>

      {error && <p className="mb-2 font-mono text-xs text-critical">{error}</p>}

      {plan && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Minutes */}
          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">
              Minutes · {dayLabel(day)}
            </p>
            <div className="space-y-1.5">
              {plan.categories.map((c) => {
                const planned = c.planned ?? 0
                const hit = started && planned > 0 && (c.actual ?? 0) >= planned
                return (
                  <label key={c.category_id} className="flex items-center gap-2">
                    <span className="w-32 truncate font-sans text-[12px] text-muted">
                      {c.category_name}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      inputMode="numeric"
                      placeholder="—"
                      value={draft[c.category_id] ?? ''}
                      onChange={(e) => {
                        setDraft({ ...draft, [c.category_id]: e.target.value })
                        setReasons({ ...reasons, [c.category_id]: '' })
                      }}
                      className="term-input max-w-[74px] py-1 text-[12px]"
                      aria-label={`${c.category_name} planned minutes`}
                    />
                    <span className="font-mono text-[10px] text-faint">min</span>
                    {started && c.actual !== null && (planned > 0 || c.actual > 0) && (
                      <span
                        className={`font-mono text-[11px] ${hit ? 'text-healthy' : 'text-muted'}`}
                      >
                        {c.actual} done
                      </span>
                    )}
                    {reasons[c.category_id] && (
                      <span className="truncate font-mono text-[10px] text-faint">
                        {reasons[c.category_id]}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
            {exams.length > 0 && (
              <p className="mt-2 font-mono text-[11px] text-warn">
                Coming up: {exams.join(' · ')}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={saveMinutes} className="btn">
                Save plan
              </button>
              <button
                type="button"
                onClick={suggest}
                className="btn-quiet border border-edge font-mono text-[11px]"
                title="Fill in what the week still needs — nothing is saved until Save plan"
              >
                Suggest
              </button>
              <span className="font-mono text-[11px] text-faint">
                {saved
                  ? 'Saved'
                  : started && plan.actual_total !== null
                    ? `${plan.actual_total} of ${plan.planned_total} planned min`
                    : `${plan.planned_total} min planned`}
              </span>
            </div>
          </div>

          {/* Tasks */}
          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">
              Tasks · {openTasks} open
            </p>
            <ul className="space-y-1">
              {plan.tasks.map((t) => (
                <li key={t.id} className="group flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={t.done}
                    onChange={() =>
                      run(() => api.updatePlanTask(t.id, { done: !t.done }))
                    }
                    className="accent-healthy"
                    aria-label={`${t.done ? 'Untick' : 'Tick'} ${t.text}`}
                  />
                  <span
                    className={`flex-1 font-sans text-[13px] ${t.done ? 'text-faint line-through' : 'text-muted'}`}
                  >
                    {t.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => run(() => api.deletePlanTask(t.id))}
                    className="font-mono text-[11px] text-faint opacity-0 hover:text-critical group-hover:opacity-100 focus:opacity-100"
                    aria-label={`Delete ${t.text}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (!task.trim()) return
                await run(() => api.addPlanTask(day, task.trim()))
                setTask('')
              }}
              className="mt-2 flex gap-2"
            >
              <input
                type="text"
                maxLength={300}
                placeholder="+ Add a task"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                className="term-input py-1 text-[12px]"
                aria-label="New task"
              />
            </form>
            <button
              type="button"
              onClick={() => run(() => api.carryOver(day))}
              className="btn-quiet mt-2 font-mono text-[11px]"
              title="Copy the previous day's unfinished tasks here (the previous day keeps them)"
            >
              ↳ Carry over unfinished from {dayLabel(shiftDate(day, -1))}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
