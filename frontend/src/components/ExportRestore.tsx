import { useState } from 'react'

import { api } from '../api/client'
import { shortDate } from '../dates'
import type { ExportPreview } from '../types'

/**
 * Settings → Data → Restore from an export file — for a new Mac, or when the
 * snapshots on this one are gone. The weekly exports in your synced folder
 * are the source.
 *
 * It replaces everything (the user's choice). The file is checked and
 * summarised first; the restore itself needs RESTORE typed, and the current
 * database is snapshotted before anything changes, so it can be undone from
 * the snapshot list. Credentials, this Mac's export folder and its reminder
 * settings are kept.
 */

/** A file's text. FileReader rather than `File.text()`, which some
 *  environments (older Safari, jsdom) lack. */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file)
  })
}

export default function ExportRestore({
  onSessionExpired,
}: {
  onSessionExpired: () => void
}) {
  const [data, setData] = useState<unknown>(null)
  const [fileName, setFileName] = useState('')
  const [summary, setSummary] = useState<ExportPreview | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  function fail(err: unknown, fallback: string) {
    const e = err as { status?: number; message?: string }
    if (e?.status === 401) onSessionExpired()
    else setMessage({ text: e?.message ?? fallback, ok: false })
  }

  async function choose(file: File | undefined) {
    setSummary(null)
    setData(null)
    setTyped('')
    setMessage(null)
    if (!file) return
    setFileName(file.name)
    setBusy(true)
    try {
      let text: string
      try {
        text = await readText(file)
      } catch {
        setMessage({ text: "Couldn't read that file.", ok: false })
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        setMessage({
          text: "That file isn't JSON — pick a dayshift-export file.",
          ok: false,
        })
        return
      }
      setSummary(await api.previewExportRestore(parsed))
      setData(parsed)
    } catch (err: unknown) {
      fail(err, 'Could not read that export.')
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    setBusy(true)
    setMessage(null)
    try {
      await api.restoreExport(data)
      setMessage({ text: 'Restored. Reloading…', ok: true })
      window.setTimeout(() => window.location.reload(), 900)
    } catch (err: unknown) {
      fail(err, 'Restore failed; nothing changed.')
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 border-t border-divider pt-3">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-faint">
        Restore from an export file
      </p>
      <p className="mb-2 font-sans text-[11px] text-faint">
        For a new Mac, or when the snapshots here are gone: pick one of your weekly
        exports (e.g. from the Google Drive folder).
      </p>
      <input
        type="file"
        accept=".json,application/json"
        disabled={busy}
        onChange={(e) => void choose(e.target.files?.[0])}
        className="font-mono text-[11px] text-muted file:mr-3 file:rounded-sm file:border file:border-edge file:bg-raised file:px-2 file:py-1 file:font-mono file:text-[11px] file:text-ink"
        aria-label="Export file to restore from"
      />

      {summary && (
        <div className="mt-3 rounded border border-warn/40 bg-warn/5 px-3 py-3">
          <p className="mb-1 font-sans text-[12px] text-warn">
            Replace everything with <strong>{fileName}</strong>
            {summary.exported_at ? ` (exported ${shortDate(summary.exported_at)})` : ''}?
          </p>
          <p className="mb-2 font-mono text-[11px] text-muted">
            {summary.first_day && summary.last_day
              ? `${shortDate(summary.first_day)} – ${shortDate(summary.last_day)} · `
              : ''}
            {summary.counts.map((c) => `${c.count} ${c.label}`).join(' · ')}
          </p>
          <p className="mb-2 font-sans text-[11px] text-muted">
            Your current data is snapshotted first, so this can be undone from the list
            above. Your sign-in, export folder and reminder stay as they are.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type RESTORE"
              className="term-input max-w-[160px] py-1 text-[12px]"
              aria-label="Type RESTORE to confirm the export restore"
            />
            <button
              type="button"
              disabled={typed !== 'RESTORE' || busy}
              onClick={() => void restore()}
              className="btn border-warn text-warn"
            >
              {busy ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={`mt-2 font-mono text-[11px] ${message.ok ? 'text-healthy' : 'text-critical'}`}
        >
          {message.text}
        </p>
      )}
    </div>
  )
}
