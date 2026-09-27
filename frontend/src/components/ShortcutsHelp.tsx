import { useEffect, useRef } from 'react'

import { SHORTCUTS } from '../hotkeys'

/**
 * The `?` panel: every keyboard shortcut in one place. Opened only on request,
 * closed with Escape, a click outside, or `?` again.
 */

interface Props {
  onClose: () => void
}

export default function ShortcutsHelp({ onClose }: Props) {
  const panel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    panel.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 px-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        tabIndex={-1}
        className="panel w-full max-w-[440px] px-6 py-5 outline-none"
      >
        <div className="mb-4 flex items-baseline justify-between">
          <h2 id="shortcuts-title" className="panel-label">
            Keyboard shortcuts
          </h2>
          <button type="button" onClick={onClose} className="btn-quiet font-mono">
            Esc
          </button>
        </div>

        <div className="space-y-4">
          {SHORTCUTS.map((section) => (
            <div key={section.group}>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-faint">
                {section.group}
              </p>
              <dl className="space-y-1">
                {section.keys.map(([keys, action]) => (
                  <div key={keys} className="flex items-center justify-between gap-4">
                    <dt className="font-sans text-[13px] text-muted">{action}</dt>
                    <dd className="shrink-0">
                      <kbd className="whitespace-nowrap rounded-sm border border-edge bg-raised px-1.5 py-0.5 font-mono text-[11px] text-ink">
                        {keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>

        <p className="mt-4 border-t border-divider pt-3 font-sans text-[11px] text-faint">
          Shortcuts are single keys and pause while you are typing in a field.
        </p>
      </div>
    </div>
  )
}
