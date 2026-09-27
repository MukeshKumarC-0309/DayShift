import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import ProblemEditor from '../components/practice/ProblemEditor'
import RevisionSession from '../components/RevisionSession'
import type {
  Difficulty,
  PracticeSummary,
  Problem,
  ReviewOutcome,
  TopicStat,
} from '../types'

/**
 * The DSA problem log.
 *
 * Every problem you solve goes here, and comes back for revision 3, 10 and 30
 * days later. Logging a problem counts one question for DSA on the day it was
 * solved — the same count the dashboard's `+1 Q` adds to. A revision never
 * counts as a question; its minutes still count as DSA time.
 */

interface Props {
  onSessionExpired: () => void
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']
const DIFFICULTY_TONE: Record<Difficulty, string> = {
  easy: 'text-healthy',
  medium: 'text-warn',
  hard: 'text-critical',
}
const OUTCOMES: { value: ReviewOutcome; label: string; hint: string }[] = [
  {
    value: 'solid',
    label: 'Solid',
    hint: 'Solved it cleanly — next revision further out',
  },
  { value: 'shaky', label: 'Shaky', hint: 'Got there with a struggle — same gap again' },
  {
    value: 'forgot',
    label: 'Forgot',
    hint: 'Could not solve it — start the cycle again',
  },
]
const STAGES = 3

function localToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

function StageDots({ problem }: { problem: Problem }) {
  const passed = problem.mastered ? STAGES : problem.stage
  return (
    <span
      className="inline-flex items-center gap-1"
      aria-label={
        problem.mastered ? 'Mastered' : `${passed} of ${STAGES} revisions passed`
      }
      title={problem.mastered ? 'Mastered' : `${passed} of ${STAGES} revisions passed`}
    >
      {Array.from({ length: STAGES }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-3 rounded-full ${i < passed ? 'bg-healthy' : 'bg-edge'}`}
        />
      ))}
    </span>
  )
}

function ProblemTitle({ problem }: { problem: Problem }) {
  return problem.url ? (
    <a
      href={problem.url}
      target="_blank"
      rel="noreferrer noopener"
      className="font-sans text-sm text-ink underline decoration-edge underline-offset-4 hover:decoration-steel"
    >
      {problem.title}
    </a>
  ) : (
    <span className="font-sans text-sm text-ink">{problem.title}</span>
  )
}

export default function Practice({ onSessionExpired }: Props) {
  const [summary, setSummary] = useState<PracticeSummary | null>(null)
  const [problems, setProblems] = useState<Problem[]>([])
  const [filter, setFilter] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  // A revision session: the due list frozen at the start, and whether this
  // page started the timer (so it may offer to stop it).
  const [revising, setRevising] = useState<{
    queue: Problem[]
    startedTimer: boolean
  } | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, all] = await Promise.all([api.practiceSummary(), api.problems()])
      setSummary(s)
      setProblems(all)
      setError(null)
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Could not load the problem log.')
    }
  }, [onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  const topics = useMemo(
    () => [...new Set(problems.map((p) => p.topic))].sort((a, b) => a.localeCompare(b)),
    [problems],
  )
  const shown = filter ? problems.filter((p) => p.topic === filter) : problems

  async function act(problemId: number, fn: () => Promise<unknown>) {
    setBusy(problemId)
    try {
      await fn()
      await load()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Something went wrong.')
    } finally {
      setBusy(null)
      setConfirmDelete(null)
    }
  }

  async function startRevision() {
    if (!summary || summary.due_today.length === 0) return
    const queue = summary.due_today
    try {
      const running = await api.runningSession()
      if (!running) {
        await api.startSession(queue[0].category_id, 'Revision session', ['revision'])
      }
      setRevising({ queue, startedTimer: !running })
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Could not start the session.')
    }
  }

  async function reviewInSession(problemId: number, outcome: ReviewOutcome) {
    try {
      await api.reviewProblem(problemId, outcome)
      return true
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Could not record that revision.')
      return false
    }
  }

  async function finishRevision(stopTimer: boolean) {
    setRevising(null)
    if (stopTimer) await api.stopSession().catch(() => undefined)
    await load()
  }

  if (!summary) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="font-mono text-sm text-faint">
          {error ?? (
            <>
              Loading<span className="animate-caret">…</span>
            </>
          )}
        </span>
      </main>
    )
  }

  return (
    <main className="min-h-screen px-5 pb-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[1000px]">
        <PageHeader page="practice">
          <Link to="/agenda" className="btn-quiet whitespace-nowrap font-mono">
            Agenda
          </Link>
        </PageHeader>

        {error && (
          <p className="mb-6 rounded border border-critical/40 bg-critical/5 px-3 py-2 font-mono text-xs text-critical">
            {error}
          </p>
        )}

        <div className="mb-6 flex flex-wrap items-baseline gap-x-6 gap-y-1 font-mono text-xs text-muted">
          <span>
            <span className="text-lg text-ink tnum">{summary.total_problems}</span> solved
          </span>
          <span>
            <span className="text-lg text-healthy tnum">{summary.mastered}</span> mastered
          </span>
          <span>
            <span className="text-lg text-steel tnum">{summary.due_today.length}</span> to
            revise today
          </span>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          {/* --- Revise today ------------------------------------------- */}
          <section className="panel px-5 py-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="panel-label">Revise today</h2>
              {!revising && summary.due_today.length > 0 ? (
                <button
                  type="button"
                  onClick={startRevision}
                  className="btn-quiet border border-steel/50 font-mono text-[11px] text-steel"
                  title="Starts the DSA timer and goes through the due problems one by one"
                >
                  ▶ Start revision session
                </button>
              ) : (
                <span className="font-mono text-[10px] text-faint">3 · 10 · 30 days</span>
              )}
            </div>

            {revising ? (
              <RevisionSession
                queue={revising.queue}
                startedTimer={revising.startedTimer}
                onReview={reviewInSession}
                onFinish={finishRevision}
              />
            ) : summary.due_today.length === 0 ? (
              <p className="font-sans text-sm text-muted">
                Nothing due.
                {summary.upcoming[0] && (
                  <>
                    {' '}
                    Next: <span className="text-ink">
                      {summary.upcoming[0].title}
                    </span> on {shortDate(summary.upcoming[0].due_on!)}.
                  </>
                )}
              </p>
            ) : (
              <ul className="divide-y divide-divider">
                {summary.due_today.map((problem) => (
                  <li key={problem.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <ProblemTitle problem={problem} />
                      <StageDots problem={problem} />
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-faint">
                      {problem.topic} ·{' '}
                      <span className={DIFFICULTY_TONE[problem.difficulty]}>
                        {problem.difficulty}
                      </span>{' '}
                      · solved {shortDate(problem.solved_on)}
                      {problem.overdue_days > 0 && (
                        <span className="text-warn">
                          {' '}
                          · {problem.overdue_days}d overdue
                        </span>
                      )}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {OUTCOMES.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          disabled={busy === problem.id}
                          title={o.hint}
                          onClick={() =>
                            act(problem.id, () => api.reviewProblem(problem.id, o.value))
                          }
                          className="btn-quiet border border-edge font-mono text-[11px]"
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* --- Log a problem ------------------------------------------ */}
          <section className="panel px-5 py-4">
            <h2 className="panel-label mb-3">Log a problem</h2>
            <ProblemForm
              topics={topics}
              onSaved={load}
              onSessionExpired={onSessionExpired}
            />
          </section>
        </div>

        {/* --- Topics ---------------------------------------------------- */}
        {summary.topics.length > 0 && (
          <section className="panel mt-6 px-5 py-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="panel-label">Topics</h2>
              <span className="font-mono text-[10px] text-faint">weakest first</span>
            </div>
            <div className="space-y-2">
              {summary.topics.map((t) => (
                <TopicRow key={t.topic} topic={t} onPick={() => setFilter(t.topic)} />
              ))}
            </div>
            <p className="mt-3 border-t border-divider pt-2 font-sans text-[11px] text-faint">
              The bar is the share of attempts that needed a hint or were forgotten on
              revision. It orders the list — it is not a score.
            </p>
          </section>
        )}

        {/* --- Every problem ---------------------------------------------- */}
        <section className="panel mt-6 px-5 py-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="panel-label">All problems</h2>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="term-input max-w-[200px] py-1 text-[12px]"
              aria-label="Filter by topic"
            >
              <option value="">Every topic</option>
              {topics.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {shown.length === 0 ? (
            <p className="font-sans text-sm text-muted">
              No problems logged yet. Each one you log here counts as a DSA question for
              its day.
            </p>
          ) : (
            <ul className="divide-y divide-divider">
              {shown.map((problem) => (
                <li
                  key={problem.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2"
                >
                  <div className="min-w-0">
                    <ProblemTitle problem={problem} />
                    <p className="font-mono text-[11px] text-faint">
                      {problem.topic} ·{' '}
                      <span className={DIFFICULTY_TONE[problem.difficulty]}>
                        {problem.difficulty}
                      </span>
                      {problem.needed_hint && ' · hint'} · {shortDate(problem.solved_on)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StageDots problem={problem} />
                    <span className="w-24 text-right font-mono text-[11px] text-muted">
                      {problem.mastered
                        ? 'mastered'
                        : problem.due_on && `next ${shortDate(problem.due_on)}`}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingId(editingId === problem.id ? null : problem.id)
                      }
                      aria-expanded={editingId === problem.id}
                      className="btn-quiet font-mono text-[11px]"
                      aria-label={`Edit ${problem.title}`}
                    >
                      {editingId === problem.id ? 'close' : 'edit'}
                    </button>
                    {confirmDelete === problem.id ? (
                      <>
                        <button
                          type="button"
                          disabled={busy === problem.id}
                          onClick={() =>
                            act(problem.id, () => api.deleteProblem(problem.id))
                          }
                          className="btn-quiet font-mono text-[11px] text-critical"
                          title="Also takes back the question it counted"
                        >
                          Delete
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
                        onClick={() => setConfirmDelete(problem.id)}
                        className="btn-quiet font-mono text-[11px]"
                        aria-label={`Delete ${problem.title}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {editingId === problem.id && (
                    <ProblemEditor
                      problem={problem}
                      topics={topics}
                      onChanged={() => void load()}
                      onClose={() => setEditingId(null)}
                      onSessionExpired={onSessionExpired}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}

function TopicRow({ topic, onPick }: { topic: TopicStat; onPick: () => void }) {
  const pct = Math.round(topic.struggle * 100)
  const tone = pct >= 50 ? 'bg-critical' : pct >= 25 ? 'bg-warn' : 'bg-healthy'
  return (
    <button
      type="button"
      onClick={onPick}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-sm px-1 py-1 text-left hover:bg-raised sm:grid-cols-[180px_minmax(0,1fr)_auto]"
      title={`Show ${topic.topic} problems`}
    >
      <span className="truncate font-sans text-sm text-ink">{topic.topic}</span>
      <span className="order-3 col-span-2 h-1.5 rounded-full bg-edge sm:order-none sm:col-span-1">
        <span
          className={`block h-full rounded-full ${tone}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </span>
      <span className="whitespace-nowrap font-mono text-[11px] text-muted tnum">
        {topic.problems} solved · {topic.needed_hint} hint · {topic.forgotten} forgot
      </span>
    </button>
  )
}

function ProblemForm({
  topics,
  onSaved,
  onSessionExpired,
}: {
  topics: string[]
  onSaved: () => Promise<void> | void
  onSessionExpired: () => void
}) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [hint, setHint] = useState(false)
  const [solvedOn, setSolvedOn] = useState(localToday)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !topic.trim()) return
    setSaving(true)
    setMessage(null)
    try {
      await api.createProblem({
        title: title.trim(),
        url: url.trim() || null,
        topic: topic.trim(),
        difficulty,
        needed_hint: hint,
        solved_on: solvedOn,
        notes: notes.trim() || null,
      })
      setMessage({ text: `Logged — counted as a DSA question on ${solvedOn}.`, ok: true })
      setTitle('')
      setUrl('')
      setHint(false)
      setNotes('')
      await onSaved()
    } catch (err: unknown) {
      const e2 = err as { status?: number; message?: string }
      if (e2?.status === 401) onSessionExpired()
      else setMessage({ text: e2?.message ?? 'Could not log the problem.', ok: false })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <input
        type="text"
        required
        maxLength={200}
        placeholder="Problem, e.g. Longest Substring Without Repeating"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="term-input text-[13px]"
        aria-label="Problem title"
      />
      <input
        type="url"
        maxLength={2000}
        placeholder="Link (optional)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="term-input text-[13px]"
        aria-label="Problem link"
      />
      <div className="flex gap-2">
        <input
          type="text"
          required
          maxLength={48}
          list="practice-topics"
          placeholder="Topic, e.g. Sliding window"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="term-input text-[13px]"
          aria-label="Topic"
        />
        <datalist id="practice-topics">
          {topics.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <input
          type="date"
          value={solvedOn}
          onChange={(e) => setSolvedOn(e.target.value)}
          className="term-input max-w-[150px] text-[13px]"
          aria-label="Solved on"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="radiogroup" aria-label="Difficulty">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={difficulty === d}
              onClick={() => setDifficulty(d)}
              className={`rounded-sm border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                difficulty === d
                  ? `border-current bg-raised ${DIFFICULTY_TONE[d]}`
                  : 'border-edge text-muted hover:text-ink'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 font-sans text-[12px] text-muted">
          <input
            type="checkbox"
            checked={hint}
            onChange={(e) => setHint(e.target.checked)}
            className="accent-steel"
          />
          Needed a hint
        </label>
      </div>
      <input
        type="text"
        maxLength={2000}
        placeholder="Key idea, to jog your memory later (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="term-input text-[13px]"
        aria-label="Notes"
      />
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="font-sans text-[11px] text-faint">Counts as 1 DSA question</span>
        <button type="submit" disabled={saving} className="btn">
          {saving ? 'Saving…' : 'Log problem'}
        </button>
      </div>
      {message && (
        <p
          className={`font-mono text-[11px] ${message.ok ? 'text-healthy' : 'text-critical'}`}
        >
          {message.text}
        </p>
      )}
    </form>
  )
}
