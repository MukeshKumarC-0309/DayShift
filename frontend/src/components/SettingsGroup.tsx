import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { api } from '../api/client'
import type { Setting } from '../types'

/**
 * One section of the Settings page: its settings, its own Save and its own
 * Reset — so resetting scoring never forgets the export folder.
 *
 * Inputs follow each setting's kind: number, date, checkbox, time, folder.
 * The backend validates everything (a folder must exist and be writable) and
 * rejects the whole batch on one bad value, so nothing is half-saved.
 */

interface Props {
  title: string
  description: ReactNode
  group: Setting['group']
  settings: Setting[]
  onUpdated: (all: Setting[]) => void
  onSessionExpired: () => void
  children?: ReactNode
}

export default function SettingsGroup({
  title,
  description,
  group,
  settings,
  onUpdated,
  onSessionExpired,
  children,
}: Props) {
  const mine = settings.filter((s) => s.group === group)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  // Follow the stored values whenever they change (after a save or reset).
  const signature = mine.map((s) => `${s.key}=${s.value}`).join('|')
  useEffect(() => {
    setDraft(Object.fromEntries(mine.map((s) => [s.key, s.value])))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on values
  }, [signature])

  const dirty = mine.some((s) => (draft[s.key] ?? s.value) !== s.value)

  async function run(fn: () => Promise<Setting[]>) {
    setSaving(true)
    setError(null)
    setSaved(null)
    try {
      onUpdated(await fn())
      setSaved(new Date().toLocaleTimeString())
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  function save() {
    const changed: Record<string, string> = {}
    for (const s of mine) if (draft[s.key] !== s.value) changed[s.key] = draft[s.key]
    return run(() => api.updateSettings(changed))
  }

  return (
    <section className="panel mt-6 px-5 py-4">
      <h2 className="panel-label mb-1">{title}</h2>
      <p className="mb-4 font-sans text-[11px] text-faint">{description}</p>

      <div className="space-y-3">
        {mine.map((setting) => {
          const id = `setting-${setting.key}`
          const value = draft[setting.key] ?? setting.value
          const set = (v: string) => setDraft({ ...draft, [setting.key]: v })
          return (
            <div key={setting.key} className="flex flex-wrap items-center gap-3">
              <label className="w-48 shrink-0 font-sans text-xs text-muted" htmlFor={id}>
                {setting.label}
              </label>
              {setting.kind === 'bool' ? (
                <input
                  id={id}
                  type="checkbox"
                  checked={value === 'true'}
                  onChange={(e) => set(String(e.target.checked))}
                  className="h-4 w-4 accent-steel"
                />
              ) : setting.kind === 'folder' ? (
                <input
                  id={id}
                  type="text"
                  value={value}
                  placeholder="~/Library/Mobile Documents/com~apple~CloudDocs/Dayshift"
                  onChange={(e) => set(e.target.value)}
                  className="term-input min-w-[260px] flex-1 text-[12px]"
                />
              ) : (
                <input
                  id={id}
                  type={
                    setting.kind === 'date'
                      ? 'date'
                      : setting.kind === 'time'
                        ? 'time'
                        : 'number'
                  }
                  step={
                    setting.kind === 'float'
                      ? '0.1'
                      : setting.kind === 'int'
                        ? '1'
                        : undefined
                  }
                  min={setting.minimum ?? undefined}
                  max={setting.maximum ?? undefined}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  className="term-input max-w-[150px] text-[13px]"
                />
              )}
              <span className="min-w-[180px] flex-1 font-sans text-[11px] text-faint">
                {setting.help}
              </span>
            </div>
          )
        })}
      </div>

      {children}

      <div className="mt-4 flex items-center justify-between border-t border-divider pt-3">
        <button
          type="button"
          onClick={() => run(() => api.resetSettings(group))}
          disabled={saving}
          className="btn-quiet whitespace-nowrap font-mono"
        >
          Reset {title.toLowerCase()}
        </button>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="font-mono text-[11px] text-healthy">Saved {saved}</span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="btn"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 font-mono text-xs text-critical">{error}</p>}
    </section>
  )
}
