import { useState } from 'react'

import { api } from '../api/client'
import Brand from '../components/Brand'

/**
 * First run only. Reached when `/api/auth/status` reports `configured: false`.
 *
 * The backend refuses this endpoint once credentials exist, so this screen can
 * never be used to reset them — changing them later goes through Settings and
 * requires the current passcode.
 */

interface Props {
  onAuthenticated: () => void
  /** Hosted deployments set SETUP_TOKEN so only the owner can claim setup. */
  tokenRequired: boolean
}

const MIN_PASSCODE = 8
const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/

export default function Setup({ onAuthenticated, tokenRequired }: Props) {
  const [username, setUsername] = useState('')
  const [passcode, setPasscode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const usernameOk = USERNAME_RE.test(username.trim())
  const passcodeOk = passcode.length >= MIN_PASSCODE
  const matches = confirm.length > 0 && passcode === confirm
  const tokenOk = !tokenRequired || setupToken.length > 0
  const ready = usernameOk && passcodeOk && matches && tokenOk

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready) return

    setSubmitting(true)
    setError(null)
    try {
      await api.setup(username.trim(), passcode, tokenRequired ? setupToken : undefined)
      onAuthenticated()
    } catch (err: unknown) {
      const e = err as { message?: string }
      setError(e?.message ?? 'Could not complete setup.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px] animate-pop">
        <div className="panel overflow-hidden px-6 py-7">
          <div
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-cat1-bright via-cat2-bright to-cat3-bright"
            aria-hidden="true"
          />

          <div className="mb-2">
            <Brand size="lg" />
          </div>
          <p className="mb-5 font-sans text-[11px] text-faint">
            First run — choose a username and passcode
            <span className="animate-caret text-cat2-bright">_</span>
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            {tokenRequired && (
              <div>
                <label
                  htmlFor="setup-token"
                  className="mb-1 block font-mono text-[11px] text-muted"
                >
                  Setup token
                </label>
                <input
                  id="setup-token"
                  type="password"
                  value={setupToken}
                  autoComplete="off"
                  placeholder="SETUP_TOKEN from the server"
                  onChange={(e) => {
                    setSetupToken(e.target.value)
                    if (error) setError(null)
                  }}
                  className="term-input"
                />
                <p className="mt-1 font-sans text-[10px] text-faint">
                  The value of SETUP_TOKEN set on the backend host.
                </p>
              </div>
            )}

            <div>
              <label
                htmlFor="setup-username"
                className="mb-1 block font-mono text-[11px] text-muted"
              >
                Username
              </label>
              <input
                id="setup-username"
                type="text"
                value={username}
                autoFocus
                autoComplete="username"
                placeholder="you"
                maxLength={32}
                onChange={(e) => {
                  setUsername(e.target.value)
                  if (error) setError(null)
                }}
                className="term-input"
              />
              <p className="mt-1 font-sans text-[10px] text-faint">
                3–32 characters: letters, digits, dot, underscore or hyphen.
                {username.length > 0 && !usernameOk && (
                  <span className="ml-1 text-warn">Not valid yet.</span>
                )}
              </p>
            </div>

            <div>
              <label
                htmlFor="setup-passcode"
                className="mb-1 block font-mono text-[11px] text-muted"
              >
                Passcode
              </label>
              <input
                id="setup-passcode"
                type="password"
                value={passcode}
                autoComplete="new-password"
                placeholder="at least 8 characters"
                onChange={(e) => {
                  setPasscode(e.target.value)
                  if (error) setError(null)
                }}
                className="term-input"
              />
              {/* Strength is length only — an honest signal, not a fake meter. */}
              <div className="mt-1 flex items-center gap-2">
                <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cat1 to-cat2 transition-all duration-300"
                    style={{
                      width: `${Math.min(100, (passcode.length / 16) * 100)}%`,
                    }}
                  />
                </div>
                <span className="font-mono text-[10px] text-faint tnum">
                  {passcode.length}/{MIN_PASSCODE}
                </span>
              </div>
            </div>

            <div>
              <label
                htmlFor="setup-confirm"
                className="mb-1 block font-mono text-[11px] text-muted"
              >
                Confirm passcode
              </label>
              <input
                id="setup-confirm"
                type="password"
                value={confirm}
                autoComplete="new-password"
                placeholder="again"
                onChange={(e) => {
                  setConfirm(e.target.value)
                  if (error) setError(null)
                }}
                className={`term-input ${confirm.length > 0 && !matches ? 'term-input-error' : ''}`}
              />
              <div className="mt-1 min-h-[14px]">
                {confirm.length > 0 && !matches && (
                  <p className="font-mono text-[10px] text-critical">
                    Passcodes do not match.
                  </p>
                )}
              </div>
            </div>

            <div className="min-h-[18px]">
              {error && <p className="font-mono text-xs text-critical">{error}</p>}
            </div>

            <button
              type="submit"
              disabled={submitting || !ready}
              className="btn-primary w-full"
            >
              {submitting ? 'Setting up…' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="mt-3 text-center font-sans text-[10px] leading-relaxed text-faint">
          Stored locally on this machine, hashed with argon2. There is no recovery — if
          you forget it, delete <code>auth.json</code> to start over. Your logged data is
          kept separately and is not affected.
        </p>
      </div>
    </main>
  )
}
