import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { api } from '../api/client'
import type { Category, WorkSession } from '../types'

/**
 * ⌘K / Ctrl+K: go anywhere, and log without touching the mouse.
 *
 * Typing a quick entry such as `+25 sde`, `45 ai`, `+1q dsa` or `30 exercise`
 * turns the top result into "Add 25 min to SDE Project today" — the same
 * delta-based quick add as the dashboard's `+15` buttons, so it can never
 * overwrite a number typed elsewhere. Categories match by name prefix or by
 * initials (`pm` → Project Maintenance).
 *
 * After any change the palette fires a `dayshift:changed` window event so the
 * dashboard refreshes.
 */

interface Command {
  id: string
  label: string
  hint?: string
  run: () => Promise<string | void> | string | void
}

export const CHANGED_EVENT = 'dayshift:changed'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toLowerCase()
}

/** Find a category from what was typed: prefix of name or of a word, or initials. */
export function matchCategory(
  categories: Category[],
  text: string,
): Category | undefined {
  const q = text.trim().toLowerCase()
  if (!q) return undefined
  return (
    categories.find((c) => c.name.toLowerCase() === q) ??
    categories.find((c) => initials(c.name) === q) ??
    categories.find((c) => c.name.toLowerCase().startsWith(q)) ??
    categories.find((c) =>
      c.name
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.startsWith(q)),
    )
  )
}

export interface QuickEntry {
  amount: number
  questions: boolean
  category: Category
}

/** `+25 sde`, `25m ai`, `+1q dsa`, `sde +25`, `dsa 2q` → a quick entry, or null. */
export function parseQuickEntry(categories: Category[], text: string): QuickEntry | null {
  const t = text.trim()
  const amountFirst = /^\+?(\d{1,4})\s*(m|min|q)?\s+(.+)$/i.exec(t)
  const nameFirst = /^(.+?)\s+\+?(\d{1,4})\s*(m|min|q)?$/i.exec(t)
  let amount: number, unit: string | undefined, name: string
  if (amountFirst) {
    ;[, , unit, name] = amountFirst
    amount = Number(amountFirst[1])
  } else if (nameFirst) {
    name = nameFirst[1]
    amount = Number(nameFirst[2])
    unit = nameFirst[3]
  } else {
    return null
  }
  const category = matchCategory(categories, name)
  if (!category || amount <= 0) return null
  const questions = unit?.toLowerCase() === 'q'
  if (questions && !category.question_target) return null
  if (!questions && amount > 1440) return null
  return { amount, questions, category }
}

/** Subsequence fuzzy score: higher is better, -1 when the query does not fit. */
function score(label: string, query: string): number {
  const l = label.toLowerCase()
  const q = query.toLowerCase().trim()
  if (!q) return 0
  if (l.startsWith(q)) return 100
  if (l.includes(q)) return 50
  let at = 0
  for (const ch of q) {
    at = l.indexOf(ch, at)
    if (at < 0) return -1
    at += 1
  }
  return 10
}

export default function CommandPalette({
  onClose,
  onSessionExpired,
}: {
  onClose: () => void
  onSessionExpired: () => void
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [today, setToday] = useState<string | null>(null)
  const [running, setRunning] = useState<WorkSession | null>(null)
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null)
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    input.current?.focus()
    Promise.all([api.categories(), api.today(), api.dashboard()])
      .then(([cats, t, dash]) => {
        setCategories(cats)
        setToday(t.today)
        setRunning(dash.running)
      })
      .catch((err: { status?: number }) => {
        if (err?.status === 401) onSessionExpired()
      })
  }, [onSessionExpired])

  const commands = useMemo<Command[]>(() => {
    const go = (path: string, label: string, hint?: string): Command => ({
      id: `go:${path}`,
      label,
      hint,
      run: () => navigate(path),
    })
    const list: Command[] = [
      go('/', 'Dashboard', 'd'),
      go('/agenda', 'Agenda — plan, exams, deadlines', 'a'),
      go('/practice', 'Practice — DSA problem log', 'q'),
      go('/goals', 'Goals — habits and milestones', 'g'),
      go('/review', 'Weekly review', 'r'),
      go('/insights', 'Insights', 'i'),
      go('/letter', 'Monthly letter', 'm'),
      go('/year', 'Year in review'),
      go('/search', 'Search notes and tags', '/'),
      go('/quick', 'Quick entry (phone view)'),
      go('/settings', 'Settings', 's'),
    ]
    if (today) list.push(go(`/day/${today}`, 'Today in full'))
    if (running) {
      list.unshift({
        id: 'timer:stop',
        label: 'Stop timer and record',
        run: async () => {
          await api.stopSession()
          return 'Timer stopped and recorded'
        },
      })
    } else {
      for (const c of categories) {
        list.push({
          id: `timer:${c.id}`,
          label: `Start timer: ${c.name}`,
          run: async () => {
            await api.startSession(c.id)
            return `Timer started for ${c.name}`
          },
        })
      }
    }
    return list
  }, [categories, running, today, navigate])

  const quick = today ? parseQuickEntry(categories, query) : null

  const results = useMemo<Command[]>(() => {
    const ranked = commands
      .map((c) => ({ c, s: score(c.label, query) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c)
    if (quick && today) {
      const what = quick.questions
        ? `${quick.amount} question${quick.amount === 1 ? '' : 's'}`
        : `${quick.amount} min`
      ranked.unshift({
        id: 'quick',
        label: `Add ${what} to ${quick.category.name} today`,
        hint: '↵',
        run: async () => {
          await api.adjustLog({
            log_date: today,
            category_id: quick.category.id,
            ...(quick.questions
              ? { questions_delta: quick.amount }
              : { minutes_delta: quick.amount }),
          })
          return `Added ${what} to ${quick.category.name}`
        },
      })
    }
    return ranked.slice(0, 9)
  }, [commands, query, quick, today])

  useEffect(() => setActive(0), [query])

  async function execute(command: Command | undefined) {
    if (!command) return
    try {
      const message = await command.run()
      if (message) {
        window.dispatchEvent(new Event(CHANGED_EVENT))
        setStatus({ text: message, ok: true })
        setQuery('')
        window.setTimeout(onClose, 700)
      } else {
        onClose()
      }
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setStatus({ text: e?.message ?? 'That did not work.', ok: false })
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-base/75 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="panel w-full max-w-[520px] overflow-hidden"
      >
        <input
          ref={input}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((i) => Math.min(i + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              void execute(results[active])
            }
          }}
          placeholder="Go to…, start a timer, or log: +25 sde"
          className="w-full border-b border-divider bg-transparent px-4 py-3.5 font-mono text-[14px] text-ink outline-none placeholder:text-faint"
          aria-label="Command"
          aria-controls="palette-results"
          aria-activedescendant={
            results[active] ? `cmd-${results[active].id}` : undefined
          }
          role="combobox"
          aria-expanded="true"
        />
        <ul
          id="palette-results"
          role="listbox"
          className="max-h-[360px] overflow-y-auto py-1"
        >
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`cmd-${c.id}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                void execute(c)
              }}
              className={`flex cursor-pointer items-center justify-between px-4 py-2 font-sans text-[13px] ${
                i === active ? 'bg-raised text-ink' : 'text-muted'
              } ${c.id === 'quick' ? 'text-steel' : ''}`}
            >
              {c.label}
              {c.hint && <kbd className="font-mono text-[10px] text-faint">{c.hint}</kbd>}
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-4 py-3 font-sans text-[13px] text-faint">
              Nothing matches.
            </li>
          )}
        </ul>
        <div className="flex items-center justify-between border-t border-divider px-4 py-2 font-mono text-[10px] text-faint">
          {status ? (
            <span className={status.ok ? 'text-healthy' : 'text-critical'}>
              {status.text}
            </span>
          ) : (
            <span>↑↓ choose · ↵ run · esc close</span>
          )}
          <span>+25 sde · +1q dsa · 30 ex</span>
        </div>
      </div>
    </div>
  )
}
