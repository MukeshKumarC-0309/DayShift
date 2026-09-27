import { useState } from 'react'

import { api } from '../api/client'
import { GIT_REF_MAX } from './GitRef'
import TagInput from './TagInput'
import type { Category, Deadline, WorkSession } from '../types'

/**
 * Edit one session in place, from the day view: category, minutes, note,
 * tags, the exam it counts toward — or split it in two.
 *
 * Changing a timer session's minutes makes it "manual" on the server (the
 * user's choice: an edited number is no longer a measurement), and the
 * timer's own reading is kept. The form says so before you save, not after.
 * Only fields that actually changed are sent.
 */

interface Props {
  session: WorkSession
  categories: Category[]
  /** Exams and deadlines to link to (the current link is always offered). */
  exams: Deadline[]
  tagSuggestions: string[]
  onSaved: () => void
  onCancel: () => void
  onSessionExpired: () => void
}

export default function SessionEditor({
  session,
  categories,
  exams,
  tagSuggestions,
  onSaved,
  onCancel,
  onSessionExpired,
}: Props) {
  const [categoryId, setCategoryId] = useState(session.category_id)
  const [minutes, setMinutes] = useState(String(session.minutes))
  const [note, setNote] = useState(session.note ?? '')
  const [tags, setTags] = useState<string[]>(session.tags)
  const [gitRef, setGitRef] = useState(session.git_ref ?? '')
  const [examId, setExamId] = useState<number>(session.deadline_id ?? 0)
  const [splitAt, setSplitAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const minutesNumber = Number(minutes)
  const minutesValid =
    minutes.trim() !== '' &&
    Number.isInteger(minutesNumber) &&
    minutesNumber >= 0 &&
    minutesNumber <= 1440
  const minutesChanged = minutesValid && minutesNumber !== session.minutes
  const becomesEdited = minutesChanged && session.source === 'timer'
  const tagsChanged = tags.join('\u0000') !== [...session.tags].sort().join('\u0000')

  const splitNumber = Number(splitAt)
  const canSplit = !session.is_running && session.minutes >= 2
  const splitValid =
    Number.isInteger(splitNumber) && splitNumber >= 1 && splitNumber < session.minutes

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onSaved()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Could not save that change.')
    } finally {
      setBusy(false)
    }
  }

  function save(event: React.FormEvent) {
    event.preventDefault()
    if (!minutesValid) {
      setError('Minutes must be a whole number from 0 to 1440.')
      return
    }
    const payload: Parameters<typeof api.updateSession>[1] = {}
    if (categoryId !== session.category_id) payload.category_id = categoryId
    if (minutesChanged) payload.minutes = minutesNumber
    if (note.trim() !== (session.note ?? '')) payload.note = note.trim()
    if (tagsChanged) payload.tags = tags
    if (gitRef.trim() !== (session.git_ref ?? '')) payload.git_ref = gitRef.trim()
    if (examId !== (session.deadline_id ?? 0)) payload.deadline_id = examId
    if (Object.keys(payload).length === 0) {
      onCancel()
      return
    }
    void run(() => api.updateSession(session.id, payload))
  }

  // Upcoming exams plus whatever this session is already linked to.
  const examOptions = exams.filter(
    (d) => d.days_left >= 0 || d.id === session.deadline_id,
  )

  return (
    <form
      onSubmit={save}
      className="mt-2 space-y-2.5 rounded border border-edge bg-raised/30 px-3 py-3"
      aria-label="Edit session"
    >
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[88px_1fr]">
        <label htmlFor={`cat-${session.id}`} className="font-mono text-xs text-muted">
          Category
        </label>
        <select
          id={`cat-${session.id}`}
          value={categoryId}
          onChange={(e) => setCategoryId(Number(e.target.value))}
          className="term-input max-w-[240px] text-[13px]"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id} className="bg-panel">
              {c.name}
              {c.archived ? ' (archived)' : ''}
            </option>
          ))}
        </select>

        <label htmlFor={`min-${session.id}`} className="font-mono text-xs text-muted">
          Minutes
        </label>
        <div>
          <input
            id={`min-${session.id}`}
            type="number"
            min={0}
            max={1440}
            step={1}
            inputMode="numeric"
            value={minutes}
            disabled={session.is_running}
            onChange={(e) => setMinutes(e.target.value)}
            className="term-input max-w-[110px]"
          />
          {session.is_running && (
            <p className="mt-1 font-sans text-[11px] text-faint">
              Stop the timer before changing its minutes.
            </p>
          )}
          {becomesEdited && (
            <p role="status" className="mt-1 font-sans text-[11px] text-warn">
              This will mark the session as edited — it stops counting as measured time.
              The timer&apos;s {session.minutes} min stays on record.
            </p>
          )}
        </div>

        <label htmlFor={`note-${session.id}`} className="font-mono text-xs text-muted">
          Note
        </label>
        <input
          id={`note-${session.id}`}
          type="text"
          value={note}
          maxLength={500}
          placeholder="What was it? (optional)"
          onChange={(e) => setNote(e.target.value)}
          className="term-input text-[13px]"
        />

        <span className="font-mono text-xs text-muted">Tags</span>
        <TagInput tags={tags} onChange={setTags} suggestions={tagSuggestions} />

        <label htmlFor={`ref-${session.id}`} className="font-mono text-xs text-muted">
          Branch
        </label>
        <input
          id={`ref-${session.id}`}
          type="text"
          value={gitRef}
          maxLength={GIT_REF_MAX}
          placeholder="feature/auth or #42 (optional)"
          onChange={(e) => setGitRef(e.target.value)}
          className="term-input max-w-[320px] font-mono text-[12px]"
        />

        {examOptions.length > 0 && (
          <>
            <label
              htmlFor={`exam-${session.id}`}
              className="font-mono text-xs text-muted"
            >
              For
            </label>
            <select
              id={`exam-${session.id}`}
              value={examId}
              onChange={(e) => setExamId(Number(e.target.value))}
              className="term-input max-w-[260px] text-[12px]"
            >
              <option value={0} className="bg-panel">
                Nothing specific
              </option>
              {examOptions.map((d) => (
                <option key={d.id} value={d.id} className="bg-panel">
                  {d.title} ({d.due_date})
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        {canSplit ? (
          <div className="flex items-center gap-2">
            <label
              htmlFor={`split-${session.id}`}
              className="font-mono text-[11px] text-faint"
            >
              Split after
            </label>
            <input
              id={`split-${session.id}`}
              type="number"
              min={1}
              max={session.minutes - 1}
              step={1}
              inputMode="numeric"
              placeholder="min"
              value={splitAt}
              onChange={(e) => setSplitAt(e.target.value)}
              className="term-input w-[76px] text-[12px]"
            />
            <button
              type="button"
              disabled={busy || !splitValid}
              onClick={() => void run(() => api.splitSession(session.id, splitNumber))}
              className="btn-quiet font-mono"
              title={`Two sessions: ${splitValid ? splitNumber : '…'} + ${
                splitValid ? session.minutes - splitNumber : '…'
              } min, same note and tags`}
            >
              Split
            </button>
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn-quiet font-mono"
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="font-mono text-xs text-critical">
          {error}
        </p>
      )}
    </form>
  )
}
