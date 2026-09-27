import { useCallback, useEffect, useState } from 'react'

import { api } from '../api/client'
import { CHANGED_EVENT } from '../components/CommandPalette'
import type { GaugeNote } from '../components/GaugeIndicator'
import type { Dashboard, Pace, TodaySummary } from '../types'

/**
 * Everything the dashboard fetches and keeps fresh, plus the dials' quick
 * add and its undo. Split out of the page so the page is only layout.
 *
 * Freshness: reloads when the tab becomes visible again, at local midnight,
 * and whenever the command palette logs something (`dayshift:changed`).
 */

/** How long a quick add stays undoable. */
const UNDO_MS = 10_000

/** The browser's local date as ISO, to notice midnight while the tab is open. */
function localToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface QuickNote extends GaugeNote {
  categoryId: number
}

export function useDashboardData(onSessionExpired: () => void) {
  const [data, setData] = useState<Dashboard | null>(null)
  const [pace, setPace] = useState<Pace[]>([])
  const [today, setToday] = useState<TodaySummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped after every successful load, so the log form knows its copy of
  // the day may be out of date (a quick add, a stopped timer).
  const [version, setVersion] = useState(0)
  const [quickNote, setQuickNote] = useState<QuickNote | null>(null)
  const [quickBusy, setQuickBusy] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [dashboard, paceRows, todayLine] = await Promise.all([
        api.dashboard(),
        api.pace(),
        api.today(),
      ])
      setData(dashboard)
      setPace(paceRows)
      setToday(todayLine)
      setError(null)
      setVersion((v) => v + 1)
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Could not reach the Dayshift backend.')
    }
  }, [onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  // A tab left open overnight must not keep showing yesterday as "today",
  // and a tab you come back to should not show numbers from hours ago.
  useEffect(() => {
    let seenDay = localToday()
    function refreshIfStale() {
      if (document.visibilityState !== 'visible') return
      void load()
    }
    const midnight = window.setInterval(() => {
      const now = localToday()
      if (now !== seenDay) {
        seenDay = now
        void load()
      }
    }, 60_000)
    document.addEventListener('visibilitychange', refreshIfStale)
    // The command palette logs from anywhere; reload when it does.
    const reload = () => void load()
    window.addEventListener(CHANGED_EVENT, reload)
    return () => {
      window.clearInterval(midnight)
      document.removeEventListener('visibilitychange', refreshIfStale)
      window.removeEventListener(CHANGED_EVENT, reload)
    }
  }, [load])

  // Undo is offered for a short while only; after that the log form is the
  // place to correct a number.
  useEffect(() => {
    if (!quickNote) return
    const timer = window.setTimeout(() => setQuickNote(null), UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [quickNote])

  const quickAdd = useCallback(
    async (categoryId: number, minutes: number, questions: number, isUndo = false) => {
      if (!data) return
      setQuickBusy(categoryId)
      try {
        await api.adjustLog({
          log_date: data.today,
          category_id: categoryId,
          minutes_delta: minutes,
          questions_delta: questions,
        })
        await load()
        if (isUndo) {
          setQuickNote({ categoryId, text: 'Undone', tone: 'ok' })
        } else {
          const what = questions ? `+${questions} Q` : `+${minutes} min`
          setQuickNote({
            categoryId,
            text: `${what} added`,
            tone: 'ok',
            onUndo: () => void quickAdd(categoryId, -minutes, -questions, true),
          })
        }
      } catch (err: unknown) {
        const e = err as { status?: number; message?: string }
        if (e?.status === 401) onSessionExpired()
        else
          setQuickNote({
            categoryId,
            text: e?.message ?? 'Could not save',
            tone: 'error',
          })
      } finally {
        setQuickBusy(null)
      }
    },
    [data, load, onSessionExpired],
  )

  return { data, pace, today, error, version, load, quickAdd, quickNote, quickBusy }
}
