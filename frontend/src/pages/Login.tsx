import { useState } from 'react'

import { api } from '../api/client'
import Brand from '../components/Brand'

/**
 * Single password field on the dark background.
 *
 * A wrong password shifts the input border to the critical colour with a small
 * message below — no reload, no flash. The three category hues appear as a
 * gradient rule under the wordmark, so the palette introduces itself before
 * you are inside.
 */

interface Props {
  onAuthenticated: () => void
}

export default function Login({ onAuthenticated }: Props) {
  const [username, setUsername] = useState('')
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!username || !passcode) return

    setSubmitting(true)
    setError(null)
    try {
      await api.login(username.trim(), passcode)
      onAuthenticated()
    } catch (err: unknown) {
      const e = err as { status?: number }
      setError(
        e?.status === 401
          ? 'Incorrect username or passcode'
          : e?.status === 429
            ? 'Too many attempts — wait a moment'
            : 'Server unreachable',
      )
      // Only the passcode is cleared: retyping the username every time is
      // friction with no security benefit.
      setPasscode('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[340px] animate-pop">
        <div className="panel overflow-hidden px-6 py-7">
          {/* Gradient rule across the top of the card, in category order. */}
          <div
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-cat1-bright via-cat2-bright to-cat3-bright"
            aria-hidden="true"
          />

          <div className="mb-2">
            <Brand size="lg" />
          </div>
          <p className="mb-5 font-sans text-[11px] text-faint">
            Daily study-time tracker
            <span className="animate-caret text-cat2-bright">_</span>
          </p>

          <form onSubmit={handleSubmit} className="space-y-2.5">
            <input
              type="text"
              value={username}
              autoFocus
              autoComplete="username"
              placeholder="Username"
              maxLength={32}
              onChange={(e) => {
                setUsername(e.target.value)
                if (error) setError(null)
              }}
              className={`term-input ${error ? 'term-input-error' : ''}`}
              aria-label="Username"
              aria-invalid={error !== null}
            />

            <input
              type="password"
              value={passcode}
              autoComplete="current-password"
              placeholder="Passcode"
              onChange={(e) => {
                setPasscode(e.target.value)
                if (error) setError(null)
              }}
              className={`term-input ${error ? 'term-input-error' : ''}`}
              aria-label="Passcode"
              aria-invalid={error !== null}
            />

            {/* Reserved height so the layout does not jump when the error appears. */}
            <div className="min-h-[18px]">
              {error && <p className="font-mono text-xs text-critical">{error}</p>}
            </div>

            <button
              type="submit"
              disabled={submitting || !username || !passcode}
              className="btn-primary w-full"
            >
              {submitting ? 'Verifying…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-3 text-center font-mono text-[10px] text-faint">
          Sessions last 14 days — sign out from the dashboard to return here.
        </p>
      </div>
    </main>
  )
}
