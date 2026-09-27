import { useCallback, useEffect, useState } from 'react'

import { api } from '../api/client'
import type { Category, GitRepo } from '../types'

/**
 * Settings → Git repositories: point a category at local repos so Insights
 * can show your commits beside your logs. Read-only — Dayshift only runs
 * `git log`. Only works where the backend can see the folders, i.e. when the
 * app runs on your own machine.
 */

interface Props {
  onSessionExpired: () => void
}

export default function GitRepoEditor({ onSessionExpired }: Props) {
  const [repos, setRepos] = useState<GitRepo[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [path, setPath] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([api.gitRepos(), api.categories()])
      setRepos(r)
      setCategories(c)
      setCategoryId((current) => current || c[0]?.id || '')
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
    }
  }, [onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!path.trim() || categoryId === '') return
    setBusy(true)
    setError(null)
    try {
      await api.addGitRepo(path.trim(), categoryId)
      setPath('')
      await load()
    } catch (err: unknown) {
      const e2 = err as { status?: number; message?: string }
      if (e2?.status === 401) onSessionExpired()
      else setError(e2?.message ?? 'Could not add that repository.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="panel-label">Git repositories</h2>
        <span className="font-mono text-[10px] text-faint">read-only · local only</span>
      </div>
      <p className="mb-3 font-sans text-[12px] text-muted">
        Insights will show your commits in these repositories beside the minutes you
        logged. Only your own commits count (the repository&apos;s <code>user.email</code>
        ).
      </p>

      {repos.length > 0 && (
        <ul className="mb-3 divide-y divide-divider">
          {repos.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
              <span
                className="min-w-0 truncate font-mono text-[12px] text-ink"
                title={r.path}
              >
                {/* Keep the end of a long path — the folder name is the useful part. */}
                {r.path.length > 60 ? `…${r.path.slice(-58)}` : r.path}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="font-sans text-[12px] text-muted">
                  {r.category_name}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await api.removeGitRepo(r.id)
                    await load()
                  }}
                  className="btn-quiet font-mono text-[11px]"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="~/code/my-project"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="term-input min-w-[220px] flex-1 text-[13px]"
          aria-label="Repository folder"
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(Number(e.target.value))}
          className="term-input max-w-[180px] text-[13px]"
          aria-label="Category it counts for"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !path.trim()} className="btn">
          Add
        </button>
      </form>
      {error && <p className="mt-2 font-mono text-xs text-critical">{error}</p>}
    </section>
  )
}
