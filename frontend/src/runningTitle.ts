// While a timer runs, the browser tab says so: `● 0:42 DSA · Dayshift`.
// A timer is only useful if you remember it is running, and the tab strip is
// the one part of the page you can still see while working in another tab.

import { useEffect } from 'react'

import type { WorkSession } from './types'

const BASE_TITLE = 'Dayshift'

function shortClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}:${String(minutes).padStart(2, '0')}`
}

export function useRunningTitle(running: WorkSession | null, name?: string): void {
  useEffect(() => {
    if (!running) {
      document.title = BASE_TITLE
      return
    }
    const started = new Date(running.started_at).getTime()
    function update() {
      const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000))
      document.title = `● ${shortClock(seconds)} ${name ?? 'Timer'} · ${BASE_TITLE}`
    }
    update()
    // Minute resolution is all a tab title needs; checking every 15s keeps
    // it within a quarter-minute of the true value.
    const timer = window.setInterval(update, 15_000)
    return () => {
      window.clearInterval(timer)
      document.title = BASE_TITLE
    }
  }, [running, name])
}
