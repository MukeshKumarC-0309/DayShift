import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { api } from '../api/client'
import AddSessionForm from '../components/AddSessionForm'
import DayCategory from '../components/day/DayCategory'
import UndoBar from '../components/day/UndoBar'
import PageHeader from '../components/PageHeader'
import { toIso } from '../dates'
import { colourIndex } from '../domains'
import type { Category, DayDetail, Deadline, SessionChange } from '../types'

/**
 * One date in full — every session, note and tag, with the typed and timed
 * split shown separately so the record stays honest about which minutes were
 * measured. Sessions can be added, edited, split, merged and deleted here,
 * and each of those changes offers Undo (the history keeps them all).
 *
 * The page holds the data and state; the panels are in components/day/.
 */

interface Props {
  onSessionExpired: () => void
}

function shiftDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + delta)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export default function DayView({ onSessionExpired }: Props) {
  const { date = '' } = useParams<{ date: string }>()
  const [detail, setDetail] = useState<DayDetail | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  // Archived ones too, so a session in an archived category can still be edited.
  const [allCategories, setAllCategories] = useState<Category[]>([])
  const [exams, setExams] = useState<Deadline[]>([])
  const [tagNames, setTagNames] = useState<string[]>([])
  // Commits per session branch/issue (only with linked git repositories).
  const [refCommits, setRefCommits] = useState<Record<number, number | null>>({})
  const [editingId, setEditingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  // Merge mode: one category at a time, with the sessions ticked so far.
  const [mergeCategory, setMergeCategory] = useState<number | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The last change, offered for Undo for a few seconds.
  const [undoable, setUndoable] = useState<SessionChange | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!date) return
    try {
      const [day, cats, everyCat, deadlines, tags] = await Promise.all([
        api.dayDetail(date),
        api.categories(),
        api.categories(true),
        api.deadlines(true),
        api.tags(),
      ])
      setDetail(day)
      setCategories(cats)
      setAllCategories(everyCat)
      setExams(deadlines)
      setTagNames(tags.map((t) => t.name))
      setError(null)
      // Optional and local-only: a git failure must not hide the day.
      api
        .refCommits(date)
        .then((rows) =>
          setRefCommits(Object.fromEntries(rows.map((r) => [r.session_id, r.commits]))),
        )
        .catch(() => setRefCommits({}))
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Could not load that day.')
    }
  }, [date, onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  // A different day: close any open editor or form.
  useEffect(() => {
    setEditingId(null)
    setAdding(false)
    setMergeCategory(null)
    setUndoable(null)
  }, [date])

  /** Reload, then offer Undo for the change just made. */
  async function afterChange() {
    await load()
    try {
      const [latest] = await api.sessionChanges(false, 1)
      setUndoError(null)
      setUndoable(latest && !latest.undone_at ? latest : null)
    } catch {
      setUndoable(null) // Undo is a convenience; the ledger still has it
    }
  }

  async function undoLast() {
    if (!undoable) return
    setBusy(true)
    try {
      await api.undoSessionChange(undoable.id)
      setUndoable(null)
      await load()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setUndoError(e?.message ?? 'Could not undo that.')
    } finally {
      setBusy(false)
    }
  }

  const dismissUndo = useCallback(() => {
    setUndoable(null)
    setUndoError(null)
  }, [])

  function startMerge(categoryId: number) {
    setEditingId(null)
    setMergeCategory(categoryId)
    setPicked(new Set())
    setMergeError(null)
  }

  async function mergePicked() {
    setBusy(true)
    setMergeError(null)
    try {
      await api.mergeSessions([...picked])
      setMergeCategory(null)
      await afterChange()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setMergeError(e?.message ?? 'Could not merge those sessions.')
    } finally {
      setBusy(false)
    }
  }

  // Work can only be added once it has happened.
  const isFuture = date > toIso(new Date())

  async function removeSession(id: number) {
    setBusy(true)
    try {
      await api.deleteSession(id)
      await afterChange()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Could not delete that session.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen px-5 pb-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[900px]">
        <PageHeader page={`${date}${detail ? ` · ${detail.weekday}` : ''}`}>
          <Link
            to={`/day/${shiftDays(date, -1)}`}
            className="btn-quiet whitespace-nowrap font-mono"
          >
            ← Prev
          </Link>
          <Link
            to={`/day/${shiftDays(date, 1)}`}
            className="btn-quiet whitespace-nowrap font-mono"
          >
            Next →
          </Link>
        </PageHeader>

        {error && <p className="font-mono text-sm text-critical">{error}</p>}

        {undoable && (
          <UndoBar
            change={undoable}
            busy={busy}
            error={undoError}
            onUndo={() => void undoLast()}
            onDismiss={dismissUndo}
          />
        )}

        {detail && !isFuture && !adding && (
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setEditingId(null)
                setAdding(true)
              }}
              className="btn-quiet font-mono"
            >
              + Add a session
            </button>
          </div>
        )}
        {adding && (
          <AddSessionForm
            date={date}
            categories={categories}
            exams={exams}
            tagSuggestions={tagNames}
            onSaved={() => {
              setAdding(false)
              void load()
            }}
            onCancel={() => setAdding(false)}
            onSessionExpired={onSessionExpired}
          />
        )}

        {detail && !detail.is_tracked && (
          <p className="mb-6 font-mono text-xs text-muted">
            This date is before tracking started — nothing here counts toward par.
          </p>
        )}

        {/* This page is the drill-down, so it shows every domain at once;
            colour still comes from the category, and archived ones go grey. */}
        {detail?.categories.map((category) => (
          <DayCategory
            key={category.category_id}
            category={category}
            colour={colourIndex(category.category_id)}
            busy={busy}
            exams={exams}
            refCommits={refCommits}
            editorCategories={(current) =>
              allCategories.filter((c) => !c.archived || c.id === current)
            }
            tagSuggestions={tagNames}
            editingId={editingId}
            onToggleEdit={(id) => setEditingId(editingId === id ? null : id)}
            onEdited={() => {
              setEditingId(null)
              void afterChange()
            }}
            onDelete={(id) => void removeSession(id)}
            merging={mergeCategory === category.category_id}
            picked={picked}
            onPick={setPicked}
            onStartMerge={() => startMerge(category.category_id)}
            onCancelMerge={() => setMergeCategory(null)}
            onMerge={() => void mergePicked()}
            mergeError={mergeError}
            onSessionExpired={onSessionExpired}
          />
        ))}
      </div>
    </main>
  )
}
