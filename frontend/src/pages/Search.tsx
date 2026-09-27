import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { api } from '../api/client'
import GitRef from '../components/GitRef'
import PageHeader from '../components/PageHeader'
import { formatMinutes, shortDate } from '../dates'
import { colourIndex } from '../domains'
import { categoryTheme, tagTone } from '../theme'
import type { SearchHit, Tag } from '../types'

/**
 * Search every session's note and tags. The query lives in the URL
 * (`/search?q=…&tag=…`), so a search can be bookmarked and Back works.
 * `q` matches text anywhere in a note or tag; `tag` is one exact tag, set by
 * clicking a tag chip (here, or in Insights → Time by tag).
 */

interface Props {
  onSessionExpired: () => void
}

/** The server returns at most this many, newest first. */
const LIMIT = 200
const DEBOUNCE_MS = 250

export default function Search({ onSessionExpired }: Props) {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const tag = params.get('tag') ?? ''
  const [draft, setDraft] = useState(q)
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [popular, setPopular] = useState<Tag[]>([])
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    input.current?.focus()
    api
      .tags()
      .then((list) => setPopular(list.filter((t) => t.session_count > 0).slice(0, 16)))
      .catch(() => setPopular([]))
  }, [])

  // Back/forward (or a link) changing the URL updates the box.
  useEffect(() => setDraft(q), [q])

  // Typing updates the URL after a pause; replace, so each key isn't a page.
  useEffect(() => {
    if (draft === q) return
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(params)
      if (draft.trim()) next.set('q', draft)
      else next.delete('q')
      setParams(next, { replace: true })
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draft, q, params, setParams])

  useEffect(() => {
    if (!q.trim() && !tag) {
      setHits(null)
      return
    }
    let cancelled = false
    api
      .search(q.trim(), tag || undefined, LIMIT)
      .then((result) => {
        if (!cancelled) {
          setHits(result)
          setError(null)
        }
      })
      .catch((err: { status?: number; message?: string }) => {
        if (cancelled) return
        if (err?.status === 401) onSessionExpired()
        else setError(err?.message ?? 'Search failed.')
      })
    return () => {
      cancelled = true
    }
  }, [q, tag, onSessionExpired])

  function setTag(name: string | null) {
    const next = new URLSearchParams(params)
    if (name) next.set('tag', name)
    else next.delete('tag')
    setParams(next)
  }

  const total = useMemo(
    () => (hits ?? []).reduce((sum, h) => sum + h.session.minutes, 0),
    [hits],
  )

  return (
    <main className="min-h-screen px-5 pb-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[900px]">
        <PageHeader page="search">
          <Link to="/insights" className="btn-quiet whitespace-nowrap font-mono">
            Time by tag
          </Link>
        </PageHeader>

        <div className="panel mb-5 px-5 py-4">
          <label htmlFor="search-q" className="panel-label mb-2 block">
            Search notes, branches and tags
          </label>
          <input
            id="search-q"
            ref={input}
            type="search"
            value={draft}
            maxLength={100}
            placeholder="rate limiter, dp, feature/auth…"
            onChange={(e) => setDraft(e.target.value)}
            className="term-input w-full text-[14px]"
          />
          {tag && (
            <p className="mt-2 flex items-center gap-2 font-mono text-[11px] text-muted">
              Only tagged
              <span className={`chip ${tagTone(tag)} flex items-center gap-1`}>
                {tag}
                <button
                  type="button"
                  onClick={() => setTag(null)}
                  aria-label={`Stop filtering by ${tag}`}
                  className="leading-none opacity-70 hover:opacity-100"
                >
                  ×
                </button>
              </span>
            </p>
          )}
          {!q.trim() && !tag && popular.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-faint">
                Your tags
              </p>
              <div className="flex flex-wrap gap-1">
                {popular.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTag(t.name)}
                    className={`chip ${tagTone(t.name)} hover:brightness-125`}
                    title={`${t.session_count} sessions · ${formatMinutes(t.total_minutes)}`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && <p className="mb-4 font-mono text-sm text-critical">{error}</p>}

        {hits && (
          <p className="mb-3 font-mono text-[11px] text-faint" role="status">
            {hits.length === 0
              ? 'No sessions match.'
              : `${hits.length} session${hits.length === 1 ? '' : 's'} · ${formatMinutes(total)}`}
            {hits.length === LIMIT &&
              ` — the newest ${LIMIT}; narrow it down to see older ones`}
          </p>
        )}

        {hits && hits.length > 0 && (
          <ul className="panel divide-y divide-divider px-5">
            {hits.map(({ session, category_name }) => {
              const theme = categoryTheme(colourIndex(session.category_id))
              return (
                <li key={session.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2 font-sans text-[13px] text-ink">
                      <span
                        className="dot"
                        style={{ backgroundColor: theme.bright }}
                        aria-hidden="true"
                      />
                      {category_name}
                      <span className="font-mono text-[12px] text-muted">
                        {formatMinutes(session.minutes)}
                      </span>
                      {session.source === 'manual' && (
                        <span className="font-mono text-[11px] text-faint">
                          {session.measured_minutes !== null ? '(edited)' : '(manual)'}
                        </span>
                      )}
                    </div>
                    <Link
                      to={`/day/${session.log_date}`}
                      className="font-mono text-[11px] text-muted hover:text-steel"
                      title="Open that day — edit the session there"
                    >
                      {shortDate(session.log_date)} · {session.started_at.slice(11, 16)}
                    </Link>
                  </div>
                  {session.note && (
                    <p className="mt-0.5 font-sans text-[13px] text-muted">
                      <Highlight text={session.note} term={q.trim()} />
                    </p>
                  )}
                  {session.git_ref && (
                    <div className="mt-0.5">
                      <GitRef value={session.git_ref}>
                        <Highlight text={session.git_ref} term={q.trim()} />
                      </GitRef>
                    </div>
                  )}
                  {session.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {session.tags.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setTag(name)}
                          className={`chip ${tagTone(name)} hover:brightness-125 ${
                            name === tag ? 'ring-1 ring-current' : ''
                          }`}
                          title={`Only sessions tagged ${name}`}
                        >
                          <Highlight text={name} term={q.trim()} />
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </main>
  )
}

/** `text` with every case-insensitive occurrence of `term` marked. */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>
  const lower = text.toLowerCase()
  const needle = term.toLowerCase()
  const parts: React.ReactNode[] = []
  let from = 0
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark key={at} className="rounded-sm bg-steel/25 px-0.5 text-ink">
        {text.slice(at, at + needle.length)}
      </mark>,
    )
    from = at + needle.length
  }
  if (from < text.length) parts.push(text.slice(from))
  return <>{parts}</>
}
