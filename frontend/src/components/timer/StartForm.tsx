import { useEffect, useState } from 'react'

import { api } from '../../api/client'
import { colourIndex } from '../../domains'
import { GIT_REF_MAX } from '../GitRef'
import TagInput from '../TagInput'
import { categoryTheme } from '../../theme'
import type { Category, Deadline } from '../../types'
import {
  type Mode,
  MODE_KEY,
  MODES,
  readStorage,
  type StartDetails,
  writeStorage,
} from './timerState'

/**
 * Ready to start: pick open-ended or a focus block, optionally a note, tags,
 * a branch and an exam, then a category. The fields clear after a start.
 */

interface Props {
  categories: Category[]
  /** Only these categories get a start button (the active domain). */
  startable?: number[]
  exams: Deadline[]
  busy: boolean
  /** Resolves true when the session started (the form then clears). */
  onStart: (categoryId: number, mode: Mode, details: StartDetails) => Promise<boolean>
}

export default function StartForm({
  categories,
  startable,
  exams,
  busy,
  onStart,
}: Props) {
  const [mode, setMode] = useState<Mode>(() => readStorage<Mode>(MODE_KEY, 'open'))
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [gitRef, setGitRef] = useState('')
  const [examId, setExamId] = useState<number | ''>('')
  const [tagNames, setTagNames] = useState<string[]>([])

  // Tags used before, suggested in the tag field.
  useEffect(() => {
    api
      .tags()
      .then((list) => setTagNames(list.map((t) => t.name)))
      .catch(() => setTagNames([]))
  }, [])

  function chooseMode(value: Mode) {
    setMode(value)
    writeStorage(MODE_KEY, value)
  }

  async function start(categoryId: number) {
    const started = await onStart(categoryId, mode, {
      note,
      tags,
      gitRef,
      deadlineId: examId === '' ? null : examId,
    })
    if (started) {
      setNote('')
      setTags([])
      setGitRef('')
    }
  }

  return (
    <div>
      <div
        className="mb-3 flex flex-wrap gap-1"
        role="radiogroup"
        aria-label="Timer mode"
      >
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={mode === m.value}
            onClick={() => chooseMode(m.value)}
            className={`rounded-sm border px-2.5 py-1 font-mono text-[11px] transition-colors ${
              mode === m.value
                ? 'border-steel bg-steel/15 text-ink'
                : 'border-edge text-muted hover:text-ink'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={note}
        maxLength={200}
        placeholder="What are you working on? (optional)"
        onChange={(e) => setNote(e.target.value)}
        className="term-input mb-2 w-full text-[13px]"
        aria-label="Session note"
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <TagInput
          tags={tags}
          onChange={setTags}
          suggestions={tagNames}
          placeholder="Tags (optional)"
          className="min-w-[160px] flex-1"
        />
        <input
          type="text"
          value={gitRef}
          maxLength={GIT_REF_MAX}
          placeholder="branch or #issue"
          onChange={(e) => setGitRef(e.target.value)}
          className="term-input w-full font-mono text-[12px] sm:w-[170px]"
          aria-label="Branch or issue"
        />
        {exams.length > 0 && (
          <select
            value={examId}
            onChange={(e) => setExamId(e.target.value ? Number(e.target.value) : '')}
            className="term-input max-w-[200px] text-[12px]"
            aria-label="Count toward an exam"
          >
            <option value="">For: nothing specific</option>
            {exams.map((d) => (
              <option key={d.id} value={d.id}>
                For: {d.title} ({d.days_left}d)
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => {
          if (startable && !startable.includes(category.id)) return null
          const theme = categoryTheme(colourIndex(category.id))
          return (
            <button
              key={category.id}
              type="button"
              disabled={busy}
              onClick={() => void start(category.id)}
              className="flex items-center gap-2 rounded-sm border px-3 py-2 font-sans text-[13px] text-ink transition-all hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                borderColor: `${theme.base}66`,
                backgroundColor: `${theme.base}1a`,
              }}
            >
              <span
                className="dot"
                style={{ backgroundColor: theme.bright }}
                aria-hidden="true"
              />
              {category.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
