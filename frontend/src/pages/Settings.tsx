import { useCallback, useEffect, useState } from 'react'

import { api } from '../api/client'
import BackupPanel from '../components/BackupPanel'
import ExportRestore from '../components/ExportRestore'
import CategoryEditor from '../components/CategoryEditor'
import CredentialEditor from '../components/CredentialEditor'
import GitRepoEditor from '../components/GitRepoEditor'
import ExportFolderStatus from '../components/ExportFolderStatus'
import PageHeader from '../components/PageHeader'
import SettingsGroup from '../components/SettingsGroup'
import type { Category, Setting } from '../types'

/**
 * Everything that previously required editing config.py or opening SQLite:
 * category targets and schedules, scoring thresholds, and data export.
 */

interface Props {
  onSessionExpired: () => void
}

export default function Settings({ onSessionExpired }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [username, setUsername] = useState<string | null>(null)
  const [settings, setSettings] = useState<Setting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [cats, values, auth] = await Promise.all([
        api.categories(true),
        api.settings(),
        api.sessionStatus(),
      ])
      setCategories(cats)
      setSettings(values)
      setUsername(auth.username)
      setError(null)
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Could not load settings.')
    } finally {
      setLoading(false)
    }
  }, [onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="font-mono text-sm text-faint">
          Loading<span className="animate-caret">…</span>
        </span>
      </main>
    )
  }

  return (
    <main className="min-h-screen px-5 pb-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[1000px]">
        <PageHeader page="settings" />

        <CategoryEditor
          categories={categories}
          onChanged={load}
          onSessionExpired={onSessionExpired}
        />

        <SettingsGroup
          title="Scoring"
          group="scoring"
          description="These change how every score is calculated, including past ones."
          settings={settings}
          onUpdated={setSettings}
          onSessionExpired={onSessionExpired}
        />

        <SettingsGroup
          title="Suggestions"
          group="suggestions"
          description="When the weekly review suggests changing a target. Suggestions are never applied on their own."
          settings={settings}
          onUpdated={setSettings}
          onSessionExpired={onSessionExpired}
        />

        <SettingsGroup
          title="Backups & reminders"
          group="backup"
          description="Neither changes any number. The export folder and the reminder only work where the backend runs — your own machine."
          settings={settings}
          onUpdated={setSettings}
          onSessionExpired={onSessionExpired}
        >
          <ExportFolderStatus
            version={settings.map((x) => x.value).join('|')}
            onSessionExpired={onSessionExpired}
          />
          <p className="mt-3 font-sans text-[11px] text-faint">
            The reminder needs a one-time install on this Mac:{' '}
            <code className="text-muted">make reminder-install</code> in the project
            folder (<code className="text-muted">make reminder-test</code> shows what it
            would say tonight).
          </p>
        </SettingsGroup>

        {error && <p className="mt-2 font-mono text-xs text-critical">{error}</p>}

        <CredentialEditor
          username={username}
          onChanged={setUsername}
          onSessionExpired={onSessionExpired}
        />

        <div className="mt-6">
          <GitRepoEditor onSessionExpired={onSessionExpired} />
        </div>

        {/* --- Data ----------------------------------------------------- */}
        <section className="panel mt-6 px-5 py-4">
          <h2 className="panel-label mb-1">Data</h2>
          <p className="mb-3 font-sans text-[11px] text-faint">
            The database is snapshotted into <code>backups/</code> every time the app
            starts (skipped when nothing changed), keeping the last ten.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={api.exportUrl('csv')} className="btn text-[13px]" download>
              Export CSV
            </a>
            <a href={api.exportUrl('json')} className="btn text-[13px]" download>
              Export JSON
            </a>
          </div>
          <p className="mt-2 font-mono text-[11px] text-faint">
            CSV keeps entered and timed minutes in separate columns.
          </p>
          <BackupPanel onSessionExpired={onSessionExpired} />
          <ExportRestore onSessionExpired={onSessionExpired} />
        </section>
      </div>
    </main>
  )
}
