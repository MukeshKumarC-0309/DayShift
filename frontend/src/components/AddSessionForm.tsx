import { useState } from 'react'

import { api } from '../api/client'
import { formatMinutes } from '../dates'
import { GIT_REF_MAX } from './GitRef'
import TagInput from './TagInput'
import type { Category, Deadline } from '../types'

/**
 * Add a block of work you did but didn't time, from the day view: category,
 * start and end time, note, tags, exam. Saved as a `manual` session, so it is
 * never read as measured time.
 *
 * The server refuses a block that overlaps one already recorded (the user's
 * choice: the same minutes can't count twice) or that hasn't ended yet, and
 * says which session is in the way; this form shows that message as is.
 */

interface Props {
  date: string
  categories: Category[]
  exams: Deadline[]
  tagSuggestions: string[]
  onSaved: () => void
  onCancel: () => void
  onSessionExpired: () => void
}

function toMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export default function AddSessionForm({
  date,
  categories,
  exams,
  tagSuggestions,
  onSaved,
  onCancel,
  onSessionExpired,
}: Props) {
  const [categoryId, setCategoryId] = useState<number>(categories[0]?.id ?? 0)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [gitRef, setGitRef] = useState('')
  const [examId, setExamId] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startMinutes = toMinutes(start)
  const endMinutes = toMinutes(end)
  const minutes =
    startMinutes !== null && endMinutes !== null ? endMinutes - startMinutes : null
  const upcoming = exams.filter((d) => d.days_left >= 0)

  function problem(): string | null {
    if (startMinutes === null || endMinutes === null)
      return 'Enter a start and an end time.'
    if (startMinutes === 0)
      return "Start at 00:01 (12:01 AM) or later: midnight means 'no time'."
    if (minutes !== null && minutes <= 0)
      return 'It ends before it starts. For a block past midnight, add one session per day.'
    return null
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const why = problem()
    if (why) {
      setError(why)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createSession({
        category_id: categoryId,
        log_date: date,
        minutes: minutes!,
        started_at: `${date}T${start}:00`,
        note: note.trim() || undefined,
        tags,
        ...(gitRef.trim() ? { git_ref: gitRef.trim() } : {}),
        ...(examId ? { deadline_id: examId } : {}),
      })
      onSaved()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Could not add that session.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="panel mb-4 space-y-2.5 px-5 py-4"
      aria-label="Add a session"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="panel-label">Add a session you didn&apos;t time</h2>
        <span className="font-mono text-[11px] text-faint">saved as manual</span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[88px_1fr]">
        <label htmlFor="add-category" className="font-mono text-xs text-muted">
          Category
        </label>
        <select
          id="add-category"
          value={categoryId}
          onChange={(e) => setCategoryId(Number(e.target.value))}
          className="term-input max-w-[240px] text-[13px]"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id} className="bg-panel">
              {c.name}
            </option>
          ))}
        </select>

        <span className="font-mono text-xs text-muted">Time</span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="term-input w-[130px] text-[13px]"
            aria-label="Start time"
          />
          <span className="font-mono text-xs text-faint">to</span>
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="term-input w-[130px] text-[13px]"
            aria-label="End time"
          />
          {minutes !== null && minutes > 0 && (
            <span className="font-mono text-[12px] text-muted" aria-live="polite">
              = {formatMinutes(minutes)}
            </span>
          )}
        </div>

        <label htmlFor="add-note" className="font-mono text-xs text-muted">
          Note
        </label>
        <input
          id="add-note"
          type="text"
          value={note}
          maxLength={500}
          placeholder="What was it? (optional)"
          onChange={(e) => setNote(e.target.value)}
          className="term-input text-[13px]"
        />

        <span className="font-mono text-xs text-muted">Tags</span>
        <TagInput tags={tags} onChange={setTags} suggestions={tagSuggestions} />

        <label htmlFor="add-ref" className="font-mono text-xs text-muted">
          Branch
        </label>
        <input
          id="add-ref"
          type="text"
          value={gitRef}
          maxLength={GIT_REF_MAX}
          placeholder="feature/auth or #42 (optional)"
          onChange={(e) => setGitRef(e.target.value)}
          className="term-input max-w-[320px] font-mono text-[12px]"
        />

        {upcoming.length > 0 && (
          <>
            <label htmlFor="add-exam" className="font-mono text-xs text-muted">
              For
            </label>
            <select
              id="add-exam"
              value={examId}
              onChange={(e) => setExamId(Number(e.target.value))}
              className="term-input max-w-[260px] text-[12px]"
            >
              <option value={0} className="bg-panel">
                Nothing specific
              </option>
              {upcoming.map((d) => (
                <option key={d.id} value={d.id} className="bg-panel">
                  {d.title} ({d.due_date})
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="btn-quiet font-mono"
        >
          Cancel
        </button>
        <button type="submit" disabled={busy} className="btn">
          {busy ? 'Adding…' : 'Add session'}
        </button>
      </div>

      {error && (
        <p role="alert" className="font-mono text-xs text-critical">
          {error}
        </p>
      )}
    </form>
  )
}
