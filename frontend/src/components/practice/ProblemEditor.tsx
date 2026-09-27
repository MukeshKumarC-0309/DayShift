import { useState } from 'react'

import { api } from '../../api/client'
import type { Difficulty, Problem, ProblemInput, ReviewOutcome } from '../../types'

/**
 * Edit a logged problem in place — title, link, topic, difficulty, hint, the
 * day it was solved, notes — and remove a revision recorded by mistake.
 *
 * Moving the solved date moves the DSA question it counted to the new day;
 * the form says so before you save. The server refuses a date after the
 * problem's first revision (it can't be revised before it was solved).
 * Removing a revision puts the schedule back as if it had never happened; it
 * asks once more first. Only changed fields are sent.
 */

interface Props {
  problem: Problem
  topics: string[]
  onChanged: () => void
  onClose: () => void
  onSessionExpired: () => void
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']
const OUTCOME_TONE: Record<ReviewOutcome, string> = {
  solid: 'text-healthy',
  shaky: 'text-warn',
  forgot: 'text-critical',
}

export default function ProblemEditor({
  problem,
  topics,
  onChanged,
  onClose,
  onSessionExpired,
}: Props) {
  const [title, setTitle] = useState(problem.title)
  const [url, setUrl] = useState(problem.url ?? '')
  const [topic, setTopic] = useState(problem.topic)
  const [difficulty, setDifficulty] = useState<Difficulty>(problem.difficulty)
  const [hint, setHint] = useState(problem.needed_hint)
  const [solvedOn, setSolvedOn] = useState(problem.solved_on)
  const [notes, setNotes] = useState(problem.notes ?? '')
  const [confirmReview, setConfirmReview] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<unknown>, close: boolean) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
      if (close) onClose()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Could not save that.')
    } finally {
      setBusy(false)
      setConfirmReview(null)
    }
  }

  function save(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || !topic.trim()) {
      setError('A title and a topic are needed.')
      return
    }
    const changes: Partial<ProblemInput> = {}
    if (title.trim() !== problem.title) changes.title = title.trim()
    if (url.trim() !== (problem.url ?? '')) changes.url = url.trim() || null
    if (topic.trim() !== problem.topic) changes.topic = topic.trim()
    if (difficulty !== problem.difficulty) changes.difficulty = difficulty
    if (hint !== problem.needed_hint) changes.needed_hint = hint
    if (solvedOn !== problem.solved_on) changes.solved_on = solvedOn
    if (notes.trim() !== (problem.notes ?? '')) changes.notes = notes.trim() || null
    if (Object.keys(changes).length === 0) {
      onClose()
      return
    }
    void run(() => api.updateProblem(problem.id, changes), true)
  }

  const listId = `topics-${problem.id}`

  return (
    <form
      onSubmit={save}
      className="mt-2 w-full space-y-2.5 rounded border border-edge bg-raised/30 px-3 py-3"
      aria-label={`Edit ${problem.title}`}
    >
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[88px_1fr]">
        <label htmlFor={`title-${problem.id}`} className="font-mono text-xs text-muted">
          Title
        </label>
        <input
          id={`title-${problem.id}`}
          type="text"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          className="term-input text-[13px]"
        />

        <label htmlFor={`url-${problem.id}`} className="font-mono text-xs text-muted">
          Link
        </label>
        <input
          id={`url-${problem.id}`}
          type="url"
          value={url}
          maxLength={2000}
          placeholder="https://… (optional)"
          onChange={(e) => setUrl(e.target.value)}
          className="term-input text-[13px]"
        />

        <label htmlFor={`topic-${problem.id}`} className="font-mono text-xs text-muted">
          Topic
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={`topic-${problem.id}`}
            type="text"
            value={topic}
            maxLength={48}
            list={listId}
            onChange={(e) => setTopic(e.target.value)}
            className="term-input max-w-[200px] text-[13px]"
          />
          <datalist id={listId}>
            {topics.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty)}
            className="term-input max-w-[120px] text-[12px]"
            aria-label="Difficulty"
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d} className="bg-panel">
                {d}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
            <input
              type="checkbox"
              checked={hint}
              onChange={(e) => setHint(e.target.checked)}
              className="h-3.5 w-3.5 accent-steel"
            />
            needed a hint
          </label>
        </div>

        <label htmlFor={`solved-${problem.id}`} className="font-mono text-xs text-muted">
          Solved on
        </label>
        <div>
          <input
            id={`solved-${problem.id}`}
            type="date"
            value={solvedOn}
            onChange={(e) => setSolvedOn(e.target.value)}
            className="term-input max-w-[180px] text-[13px]"
          />
          {solvedOn !== problem.solved_on && (
            <p role="status" className="mt-1 font-sans text-[11px] text-warn">
              Its DSA question moves from {problem.solved_on} to {solvedOn || '…'}.
            </p>
          )}
        </div>

        <label htmlFor={`notes-${problem.id}`} className="font-mono text-xs text-muted">
          Notes
        </label>
        <input
          id={`notes-${problem.id}`}
          type="text"
          value={notes}
          maxLength={2000}
          placeholder="Approach, the trick, what went wrong (optional)"
          onChange={(e) => setNotes(e.target.value)}
          className="term-input text-[13px]"
        />

        <span className="font-mono text-xs text-muted">Revisions</span>
        {problem.reviews.length === 0 ? (
          <span className="font-sans text-[12px] text-faint">None yet.</span>
        ) : (
          <ul className="space-y-1">
            {problem.reviews.map((review) => (
              <li
                key={review.id}
                className="flex flex-wrap items-center gap-2 font-mono text-[12px]"
              >
                <span className="text-muted tnum">{review.reviewed_on}</span>
                <span className={OUTCOME_TONE[review.outcome]}>{review.outcome}</span>
                {confirmReview === review.id ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() => api.deleteReview(problem.id, review.id), false)
                      }
                      className="btn-quiet font-mono text-[11px] text-critical"
                    >
                      Remove it
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmReview(null)}
                      className="btn-quiet font-mono text-[11px]"
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmReview(review.id)}
                    className="btn-quiet font-mono text-[11px]"
                    aria-label={`Remove the ${review.reviewed_on} revision`}
                    title="Recorded by mistake? The schedule goes back as if it never happened"
                  >
                    remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="btn-quiet font-mono"
        >
          Cancel
        </button>
        <button type="submit" disabled={busy} className="btn">
          {busy ? 'Saving…' : 'Save'}
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
