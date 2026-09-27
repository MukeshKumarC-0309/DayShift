import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { OPEN_PALETTE_EVENT, OPEN_SHORTCUTS_EVENT } from '../../hotkeys'

/** Secondary actions, kept out of the header so it stays short. */
export default function MoreMenu({
  today,
  rain,
  onToggleRain,
  onLogout,
}: {
  today: string
  rain: boolean
  onToggleRain: () => void
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false)
        return
      }
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More"
        className="btn-quiet font-mono"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 w-max min-w-[210px] rounded border border-edge bg-panel p-1 shadow-panel-hover"
        >
          <Link
            role="menuitem"
            to={`/day/${today}`}
            className="block rounded-sm px-3 py-1.5 font-mono text-xs text-muted hover:bg-raised hover:text-ink"
          >
            Today in full
          </Link>
          <Link
            role="menuitem"
            to="/settings"
            className="block rounded-sm px-3 py-1.5 font-mono text-xs text-muted hover:bg-raised hover:text-ink"
          >
            Settings
          </Link>
          <Link
            role="menuitem"
            to="/letter"
            className="block rounded-sm px-3 py-1.5 font-mono text-xs text-muted hover:bg-raised hover:text-ink"
          >
            Monthly letter
          </Link>
          <Link
            role="menuitem"
            to="/year"
            className="block rounded-sm px-3 py-1.5 font-mono text-xs text-muted hover:bg-raised hover:text-ink"
          >
            Year in review
          </Link>
          <Link
            role="menuitem"
            to="/search"
            className="flex items-center justify-between gap-4 rounded-sm px-3 py-1.5 font-mono text-xs text-muted hover:bg-raised hover:text-ink"
          >
            Search sessions
            <kbd className="text-faint">/</kbd>
          </Link>
          <Link
            role="menuitem"
            to="/quick"
            className="block rounded-sm px-3 py-1.5 font-mono text-xs text-muted hover:bg-raised hover:text-ink"
          >
            Quick entry (phone)
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false)
              window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))
            }}
            className="flex w-full items-center justify-between gap-4 rounded-sm px-3 py-1.5 text-left font-mono text-xs text-muted hover:bg-raised hover:text-ink"
          >
            Keyboard shortcuts
            <kbd className="text-faint">?</kbd>
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false)
              window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))
            }}
            className="flex w-full items-center justify-between gap-4 rounded-sm px-3 py-1.5 text-left font-mono text-xs text-muted hover:bg-raised hover:text-ink"
          >
            Command palette
            <kbd className="text-faint">⌘K</kbd>
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              onToggleRain()
              setOpen(false)
            }}
            className="block w-full rounded-sm px-3 py-1.5 text-left font-mono text-xs text-muted hover:bg-raised hover:text-ink"
          >
            Background rain: {rain ? 'on' : 'off'}
          </button>
          <div className="my-1 border-t border-divider" />
          <button
            role="menuitem"
            type="button"
            onClick={onLogout}
            className="block w-full rounded-sm px-3 py-1.5 text-left font-mono text-xs text-muted hover:bg-raised hover:text-critical"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
