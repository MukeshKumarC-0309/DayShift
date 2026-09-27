import { useCallback, useEffect, useState } from 'react'

import { api } from '../api/client'

/**
 * Settings → Data → Restore a snapshot.
 *
 * Restoring replaces every log, session and setting with the snapshot's. It
 * is undoable — the current state is snapshotted first — but it is still the
 * one destructive action in the app, so it asks you to type RESTORE.
 */

interface Backup {
  name: string
  bytes: number
  modified: number
}

function label(name: string): string {
  const m = /dayshift-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db/.exec(name)
  if (!m) return name
  const [, y, mo, d, h, mi] = m
  return new Date(+y, +mo - 1, +d, +h, +mi).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function BackupPanel({
  onSessionExpired,
}: {
  onSessionExpired: () => void
}) {
  const [backups, setBackups] = useState<Backup[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    try {
      setBackups(await api.backups())
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
    }
  }, [onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  async function restore() {
    if (!chosen) return
    setBusy(true)
    setMessage(null)
    try {
      await api.restoreBackup(chosen)
      setMessage({ text: `Restored ${label(chosen)}. Reloading…`, ok: true })
      window.setTimeout(() => window.location.reload(), 900)
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else
        setMessage({ text: e?.message ?? 'Restore failed; nothing changed.', ok: false })
      setBusy(false)
    }
  }

  if (backups.length === 0) return null

  return (
    <div className="mt-4 border-t border-divider pt-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">
        Restore a snapshot
      </p>
      <ul className="max-h-[220px] divide-y divide-divider overflow-y-auto">
        {backups.map((b) => (
          <li key={b.name} className="flex items-center justify-between gap-3 py-1.5">
            <span className="font-mono text-[12px] text-muted">
              {label(b.name)}{' '}
              <span className="text-faint">· {Math.round(b.bytes / 1024)} KB</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setChosen(b.name)
                setTyped('')
                setMessage(null)
              }}
              className="btn-quiet font-mono text-[11px]"
            >
              Restore…
            </button>
          </li>
        ))}
      </ul>
      {chosen && (
        <div className="mt-3 rounded border border-warn/40 bg-warn/5 px-3 py-3">
          <p className="mb-2 font-sans text-[12px] text-warn">
            Replace everything with the snapshot from <strong>{label(chosen)}</strong>?
            Your current data is snapshotted first, so this can be undone the same way.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type RESTORE"
              className="term-input max-w-[160px] py-1 text-[12px]"
              aria-label="Type RESTORE to confirm"
            />
            <button
              type="button"
              disabled={typed !== 'RESTORE' || busy}
              onClick={restore}
              className="btn border-warn text-warn"
            >
              {busy ? 'Restoring…' : 'Restore'}
            </button>
            <button
              type="button"
              onClick={() => setChosen(null)}
              className="btn-quiet font-mono text-[11px]"
            >
              Cancel
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
    </div>
  )
}
