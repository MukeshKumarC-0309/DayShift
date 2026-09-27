import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'

import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { dayLabel, shortDate } from '../dates'
import { categoryTheme } from '../theme'
import type { Category, Habit, HabitState, Milestone } from '../types'
import { colourIndex } from '../domains'

/**
 * Goals: yes/no habits and project milestones.
 *
 * Habits — on a day a habit applies to, NO TICK MEANS NOT DONE (the user's
 * choice); only today stays open until it is over. Click any past square to
 * fix a tick you forgot.
 *
 * Milestones — what the time actually produced. Neither affects par.
 */

interface Props {
  onSessionExpired: () => void
}

const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

const CELL: Record<HabitState, string> = {
  done: 'bg-healthy border-healthy',
  missed: 'bg-critical/25 border-critical/60',
  open: 'bg-transparent border-steel border-dashed',
  off: 'bg-transparent border-divider',
  future: 'bg-transparent border-transparent',
}

const STATE_LABEL: Record<HabitState, string> = {
  done: 'done',
  missed: 'not done',
  open: 'not ticked yet',
  off: 'not scheduled',
  future: '',
}

export default function Goals({ onSessionExpired }: Props) {
  const [habits, setHabits] = useState<Habit[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const [h, m, c] = await Promise.all([
        api.habits(),
        api.milestones(),
        api.categories(),
      ])
      setHabits(h)
      setMilestones(m)
      setCategories(c)
      setError(null)
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Could not load goals.')
    } finally {
      setLoaded(true)
    }
  }, [onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  async function run(fn: () => Promise<unknown>): Promise<boolean> {
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

  if (!loaded) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="font-mono text-sm text-faint">
          Loading<span className="animate-caret">…</span>
        </span>
      </main>
    )
  }

  return (
    <main className="min-h-screen px-5 pb-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[1000px]">
        <PageHeader page="goals">
          <Link to="/agenda" className="btn-quiet whitespace-nowrap font-mono">
            Agenda
          </Link>
        </PageHeader>

        {error && (
          <p className="mb-6 rounded border border-critical/40 bg-critical/5 px-3 py-2 font-mono text-xs text-critical">
            {error}
          </p>
        )}

        {/* --- Habits ---------------------------------------------------- */}
        <section className="panel mb-6 px-5 py-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="panel-label">Habits</h2>
            <span className="font-mono text-[10px] text-faint">
              last 14 days · unticked counts as not done
            </span>
          </div>

          {habits.length === 0 ? (
            <p className="mb-3 font-sans text-sm text-muted">
              No habits yet. Add a yes/no habit below — it counts from today, never
              backwards.
            </p>
          ) : (
            <ul className="mb-4 divide-y divide-divider">
              {habits.map((habit) => (
                <HabitRow key={habit.id} habit={habit} run={run} />
              ))}
            </ul>
          )}
          <HabitForm run={run} />
        </section>

        {/* --- Milestones -------------------------------------------------- */}
        <section className="panel px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="panel-label">Milestones</h2>
            <span className="font-mono text-[10px] text-faint">
              what the time produced
            </span>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {categories.map((category) => (
              <MilestoneList
                key={category.id}
                category={category}
                index={colourIndex(category.id)}
                milestones={milestones.filter((m) => m.category_id === category.id)}
                run={run}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

function HabitRow({
  habit,
  run,
}: {
  habit: Habit
  run: (fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const [confirm, setConfirm] = useState(false)
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="font-sans text-sm text-ink">{habit.name}</p>
          <p className="font-mono text-[10px] text-faint">
            {habit.active_days.split(',').length === 7
              ? 'every day'
              : habit.active_days.toLowerCase().replaceAll(',', ' ')}
            {' · '}streak {habit.current_streak} · best {habit.best_streak}
            {habit.rate_30 !== null && ` · ${Math.round(habit.rate_30)}% of 30 days`}
          </p>
        </div>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={`${habit.name}, last 14 days`}
        >
          {habit.days.map((d) => {
            const clickable = d.state !== 'future'
            const done = d.state === 'done'
            return (
              <button
                key={d.day}
                type="button"
                disabled={!clickable}
                onClick={() => run(() => api.setHabitCheck(habit.id, d.day, !done))}
                title={`${dayLabel(d.day)} — ${STATE_LABEL[d.state]}`}
                aria-label={`${dayLabel(d.day)}: ${STATE_LABEL[d.state]}. ${done ? 'Untick' : 'Tick'}`}
                aria-pressed={done}
                className={`h-5 w-4 rounded-sm border transition-transform hover:scale-110 disabled:cursor-default ${CELL[d.state]}`}
              />
            )
          })}
        </div>
      </div>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={() =>
            run(() =>
              api.setHabitCheck(habit.id, habit.days.at(-1)!.day, habit.today !== 'done'),
            )
          }
          className={`btn-quiet border font-mono text-[11px] ${
            habit.today === 'done' ? 'border-healthy text-healthy' : 'border-edge'
          }`}
        >
          {habit.today === 'done' ? '✓ Done today' : 'Tick today'}
        </button>
        <button
          type="button"
          onClick={() => run(() => api.updateHabit(habit.id, { archived: true }))}
          className="btn-quiet font-mono text-[11px]"
          title="Hide it; its history is kept"
        >
          Archive
        </button>
        {confirm ? (
          <>
            <button
              type="button"
              onClick={() => run(() => api.deleteHabit(habit.id))}
              className="btn-quiet font-mono text-[11px] text-critical"
            >
              Delete with history
            </button>
            <button
              type="button"
              onClick={() => setConfirm(false)}
              className="btn-quiet font-mono text-[11px]"
            >
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="btn-quiet font-mono text-[11px]"
          >
            Delete
          </button>
        )}
      </div>
    </li>
  )
}

function HabitForm({ run }: { run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [name, setName] = useState('')
  const [days, setDays] = useState<string[]>([...WEEK])

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim() || days.length === 0) return
        const ok = await run(() => api.createHabit(name.trim(), days.join(',')))
        if (ok) {
          setName('')
          setDays([...WEEK])
        }
      }}
      className="flex flex-wrap items-center gap-2 border-t border-divider pt-3"
    >
      <input
        type="text"
        maxLength={80}
        placeholder="New habit, e.g. No phone the first hour"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="term-input min-w-[220px] flex-1 text-[13px]"
        aria-label="Habit name"
      />
      <div className="flex gap-0.5" role="group" aria-label="Days it applies">
        {WEEK.map((code) => {
          const on = days.includes(code)
          return (
            <button
              key={code}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setDays(
                  on
                    ? days.filter((d) => d !== code)
                    : WEEK.filter((d) => d === code || days.includes(d)),
                )
              }
              className={`w-8 rounded-sm border py-1 font-mono text-[10px] ${
                on ? 'border-steel bg-steel/15 text-ink' : 'border-edge text-faint'
              }`}
            >
              {code.slice(0, 2)}
            </button>
          )
        })}
      </div>
      <button type="submit" className="btn" disabled={!name.trim() || days.length === 0}>
        Add habit
      </button>
    </form>
  )
}

function MilestoneList({
  category,
  index,
  milestones,
  run,
}: {
  category: Category
  index: number
  milestones: Milestone[]
  run: (fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const [title, setTitle] = useState('')
  const [showDone, setShowDone] = useState(false)
  const open = milestones.filter((m) => m.done_on === null)
  const done = milestones.filter((m) => m.done_on !== null)
  const theme = categoryTheme(index)

  return (
    <div>
      <p className="mb-1.5 flex items-center gap-2 font-sans text-sm text-ink">
        <span
          className="dot"
          style={{ backgroundColor: theme.bright }}
          aria-hidden="true"
        />
        {category.name}
        <span className="font-mono text-[10px] text-faint">
          {open.length} open · {done.length} done
        </span>
      </p>
      <ul className="space-y-1">
        {open.map((m) => (
          <li key={m.id} className="group flex items-center gap-2">
            <input
              type="checkbox"
              checked={false}
              onChange={() => run(() => api.updateMilestone(m.id, { done: true }))}
              className="accent-healthy"
              aria-label={`Mark ${m.title} done`}
            />
            <span className="flex-1 font-sans text-[13px] text-muted">{m.title}</span>
            <button
              type="button"
              onClick={() => run(() => api.deleteMilestone(m.id))}
              className="font-mono text-[11px] text-faint opacity-0 hover:text-critical group-hover:opacity-100 focus:opacity-100"
              aria-label={`Delete ${m.title}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!title.trim()) return
          if (await run(() => api.createMilestone(category.id, title.trim())))
            setTitle('')
        }}
        className="mt-1.5"
      >
        <input
          type="text"
          maxLength={200}
          placeholder="+ Add a milestone"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="term-input py-1 text-[12px]"
          aria-label={`New milestone for ${category.name}`}
        />
      </form>
      {done.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="font-mono text-[10px] text-faint hover:text-muted"
          >
            {showDone ? '− Hide done' : `+ ${done.length} done`}
          </button>
          {showDone && (
            <ul className="mt-1 space-y-1">
              {done.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked
                    onChange={() => run(() => api.updateMilestone(m.id, { done: false }))}
                    className="accent-healthy"
                    aria-label={`Reopen ${m.title}`}
                  />
                  <span className="flex-1 font-sans text-[12px] text-faint line-through">
                    {m.title}
                  </span>
                  <span className="font-mono text-[10px] text-faint">
                    {shortDate(m.done_on!)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
