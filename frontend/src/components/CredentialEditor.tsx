import { useState } from 'react'

import { api } from '../api/client'

/**
 * Change the username or passcode from inside the app.
 *
 * This used to be impossible: credentials lived in `.env` and the app would
 * have had to rewrite its own config file. They now live in a file the app
 * owns, so this is just a write.
 *
 * Changing the passcode rotates the session signing secret — every other
 * session is invalidated, which is the point of changing it.
 */

interface Props {
  username: string | null
  onChanged: (username: string | null) => void
  onSessionExpired: () => void
}

const MIN_PASSCODE = 8
const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/

export default function CredentialEditor({
  username,
  onChanged,
  onSessionExpired,
}: Props) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [nextUsername, setNextUsername] = useState('')
  const [nextPasscode, setNextPasscode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const wantsUsername = nextUsername.trim().length > 0
  const wantsPasscode = nextPasscode.length > 0
  const usernameOk = !wantsUsername || USERNAME_RE.test(nextUsername.trim())
  const passcodeOk = !wantsPasscode || nextPasscode.length >= MIN_PASSCODE
  const matches = !wantsPasscode || nextPasscode === confirm
  const ready =
    current.length > 0 &&
    (wantsUsername || wantsPasscode) &&
    usernameOk &&
    passcodeOk &&
    matches

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready) return

    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const result = await api.updateCredentials({
        current_passcode: current,
        ...(wantsUsername ? { username: nextUsername.trim() } : {}),
        ...(wantsPasscode ? { new_passcode: nextPasscode } : {}),
      })
      setCurrent('')
      setNextUsername('')
      setNextPasscode('')
      setConfirm('')
      setDone(
        wantsPasscode ? 'Updated. Other sessions have been signed out.' : 'Updated.',
      )
      onChanged(result.username)
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Could not update credentials.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel mt-6 px-5 py-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between text-left"
      >
        <span className="panel-label">Credentials</span>
        <span className="font-mono text-xs text-muted">{open ? '−' : '+'}</span>
      </button>

      <p className="mt-1.5 font-sans text-[11px] text-faint">
        Signed in as{' '}
        <span className="font-mono text-cat1-bright">{username ?? 'unknown'}</span>.
        {!open && ' Change the username or passcode here.'}
      </p>

      {open && (
        <form onSubmit={submit} className="mt-3 max-w-[380px] space-y-2.5">
          <div>
            <label
              htmlFor="cred-current"
              className="mb-1 block font-mono text-[11px] text-muted"
            >
              Current passcode
            </label>
            <input
              id="cred-current"
              type="password"
              value={current}
              autoComplete="current-password"
              onChange={(e) => setCurrent(e.target.value)}
              className="term-input text-[13px]"
            />
          </div>

          <div>
            <label
              htmlFor="cred-username"
              className="mb-1 block font-mono text-[11px] text-muted"
            >
              New username <span className="text-faint">(optional)</span>
            </label>
            <input
              id="cred-username"
              type="text"
              value={nextUsername}
              autoComplete="username"
              placeholder={username ?? ''}
              maxLength={32}
              onChange={(e) => setNextUsername(e.target.value)}
              className={`term-input text-[13px] ${!usernameOk ? 'term-input-error' : ''}`}
            />
          </div>

          <div>
            <label
              htmlFor="cred-passcode"
              className="mb-1 block font-mono text-[11px] text-muted"
            >
              New passcode <span className="text-faint">(optional)</span>
            </label>
            <input
              id="cred-passcode"
              type="password"
              value={nextPasscode}
              autoComplete="new-password"
              placeholder={`at least ${MIN_PASSCODE} characters`}
              onChange={(e) => setNextPasscode(e.target.value)}
              className={`term-input text-[13px] ${!passcodeOk ? 'term-input-error' : ''}`}
            />
          </div>

          {wantsPasscode && (
            <div>
              <label
                htmlFor="cred-confirm"
                className="mb-1 block font-mono text-[11px] text-muted"
              >
                Confirm new passcode
              </label>
              <input
                id="cred-confirm"
                type="password"
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)}
                className={`term-input text-[13px] ${!matches ? 'term-input-error' : ''}`}
              />
              {!matches && (
                <p className="mt-1 font-mono text-[10px] text-critical">
                  Passcodes do not match.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="font-sans text-[10px] text-faint">
              {wantsPasscode
                ? 'Changing the passcode signs out other sessions.'
                : 'Your current passcode confirms the change.'}
            </span>
            <button type="submit" disabled={busy || !ready} className="btn">
              {busy ? 'Saving…' : 'Update'}
            </button>
          </div>

          {done && <p className="font-mono text-[11px] text-healthy">{done}</p>}
          {error && <p className="font-mono text-xs text-critical">{error}</p>}
        </form>
      )}
    </section>
  )
}
