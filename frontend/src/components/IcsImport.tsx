import { useState } from 'react'

import { api } from '../api/client'
import { dayLabel } from '../dates'
import type { DeadlineKind, IcsEvent } from '../types'

/**
 * Import exams and deadlines from a calendar export (.ics).
 *
 * The file is read in the browser and parsed by the backend into a preview;
 * nothing is added until you tick events and press Add. Titles that look like
 * exams (midterm, quiz, end-sem…) start ticked as exams — a guess you can
 * change. An imported exam sets its day's overrides like a typed one.
 */

interface Props {
  onAdded: () => void
  onSessionExpired: () => void
}

interface Choice {
  pick: boolean
  kind: DeadlineKind
}

const MAX_BYTES = 2_000_000

export default function IcsImport({ onAdded, onSessionExpired }: Props) {
  const [events, setEvents] = useState<IcsEvent[] | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  const key = (e: IcsEvent) => `${e.day}|${e.title}`

  async function read(file: File) {
    setMessage(null)
    if (file.size > MAX_BYTES) {
      setMessage({ text: 'That file is over 2 MB — export a shorter range.', ok: false })
      return
    }
    setBusy(true)
    try {
      const found = await api.importIcs(await file.text())
      setEvents(found)
      setChoices(
        Object.fromEntries(
          found.map((e) => [
            key(e),
            {
              pick: e.looks_like_exam && !e.already_added,
              kind: e.looks_like_exam ? 'exam' : 'other',
            } satisfies Choice,
          ]),
        ),
      )
      if (found.length === 0)
        setMessage({ text: 'No upcoming events in that file.', ok: false })
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setMessage({ text: e?.message ?? 'Could not read that file.', ok: false })
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    if (!events) return
    const picked = events.filter((e) => choices[key(e)]?.pick)
    setBusy(true)
    let added = 0
    try {
      for (const e of picked) {
        await api.createDeadline({
          title: e.title,
          kind: choices[key(e)].kind,
          due_date: e.day,
        })
        added += 1
      }
      setMessage({ text: `Added ${added}.`, ok: true })
      setEvents(null)
      onAdded()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else
        setMessage({ text: `Added ${added}, then: ${e?.message ?? 'failed'}`, ok: false })
    } finally {
      setBusy(false)
    }
  }

  const pickedCount = events ? events.filter((e) => choices[key(e)]?.pick).length : 0

  return (
    <section className="panel px-5 py-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="panel-label">Import a calendar</h2>
        <span className="font-mono text-[10px] text-faint">
          .ics · nothing added until you choose
        </span>
      </div>
      <input
        type="file"
        accept=".ics,text/calendar"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void read(file)
          e.target.value = ''
        }}
        className="block w-full font-mono text-[11px] text-muted file:mr-3 file:rounded-sm file:border file:border-edge file:bg-raised file:px-3 file:py-1.5 file:font-mono file:text-[11px] file:text-ink"
        aria-label="Calendar file"
      />
      <p className="mt-1.5 font-sans text-[11px] text-faint">
        Export from Google Calendar, Outlook or your college portal. Only events in the
        next year are listed.
      </p>

      {events && events.length > 0 && (
        <div className="mt-3">
          <ul className="max-h-[320px] divide-y divide-divider overflow-y-auto">
            {events.map((e) => {
              const c = choices[key(e)]
              return (
                <li
                  key={key(e)}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
                >
                  <input
                    type="checkbox"
                    checked={c.pick}
                    disabled={e.already_added}
                    onChange={() =>
                      setChoices({ ...choices, [key(e)]: { ...c, pick: !c.pick } })
                    }
                    className="accent-steel"
                    aria-label={`Import ${e.title}`}
                  />
                  <span className="w-24 font-mono text-[11px] text-muted">
                    {dayLabel(e.day)}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate font-sans text-[13px] ${e.already_added ? 'text-faint' : 'text-ink'}`}
                    title={e.title}
                  >
                    {e.title}
                    {e.recurring && (
                      <span className="ml-1 font-mono text-[10px] text-faint">
                        repeats
                      </span>
                    )}
                    {e.already_added && (
                      <span className="ml-1 font-mono text-[10px] text-faint">
                        already added
                      </span>
                    )}
                  </span>
                  <select
                    value={c.kind}
                    disabled={e.already_added}
                    onChange={(ev) =>
                      setChoices({
                        ...choices,
                        [key(e)]: { ...c, kind: ev.target.value as DeadlineKind },
                      })
                    }
                    className="term-input max-w-[120px] py-0.5 text-[11px]"
                    aria-label={`Kind for ${e.title}`}
                  >
                    <option value="exam">Exam</option>
                    <option value="assignment">Assignment</option>
                    <option value="other">Other</option>
                  </select>
                </li>
              )
            })}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="font-sans text-[11px] text-faint">
              Exams set that day&apos;s targets to 0 — edit them afterwards on the list.
            </span>
            <button
              type="button"
              onClick={add}
              disabled={busy || pickedCount === 0}
              className="btn shrink-0 whitespace-nowrap"
            >
              Add {pickedCount}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p
          className={`mt-2 font-mono text-[11px] ${message.ok ? 'text-healthy' : 'text-critical'}`}
        >
          {message.text}
        </p>
      )}
    </section>
  )
}
