import { useCallback, useEffect, useState } from 'react'

import { api } from '../api/client'
import type { ExportStatus } from '../types'

/** The weekly export's folder, its newest file, and an "Export now" button. */
export default function ExportFolderStatus({
  version,
  onSessionExpired,
}: {
  /** Changes when the settings were saved, so the status re-reads. */
  version: string
  onSessionExpired: () => void
}) {
  const [status, setStatus] = useState<ExportStatus | null>(null)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setStatus(await api.exportStatus())
    } catch (err: unknown) {
      if ((err as { status?: number })?.status === 401) onSessionExpired()
    }
  }, [onSessionExpired])

  useEffect(() => {
    void load()
  }, [load, version])

  if (!status?.folder) return null

  return (
    <div className="mt-4 rounded border border-divider px-3 py-2.5">
      <p className="font-mono text-[11px] text-muted">
        {status.ok ? (
          status.latest ? (
            <>
              Latest: <span className="text-ink">{status.latest}</span>{' '}
              <span className="text-faint">({status.latest_at?.replace('T', ' ')})</span>
            </>
          ) : (
            'No export written yet — the first one goes out within the hour.'
          )
        ) : (
          <span className="text-critical">That folder is not reachable right now.</span>
        )}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setMessage(null)
            try {
              setStatus(await api.exportNow())
              setMessage({ text: 'Written.', ok: true })
            } catch (err: unknown) {
              const e = err as { status?: number; message?: string }
              if (e?.status === 401) onSessionExpired()
              else setMessage({ text: e?.message ?? 'Export failed.', ok: false })
            } finally {
              setBusy(false)
            }
          }}
          className="btn-quiet border border-edge font-mono text-[11px]"
        >
          Export now
        </button>
        {message && (
          <span
            className={`font-mono text-[11px] ${message.ok ? 'text-healthy' : 'text-critical'}`}
          >
            {message.text}
          </span>
        )}
      </div>
    </div>
  )
}
