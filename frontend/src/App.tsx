import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'

import { api } from './api/client'
import CommandPalette from './components/CommandPalette'
import MatrixRain from './components/MatrixRain'
import ShortcutsHelp from './components/ShortcutsHelp'
import { OPEN_PALETTE_EVENT, OPEN_SHORTCUTS_EVENT, useHotkey } from './hotkeys'
import Agenda from './pages/Agenda'
import Dashboard from './pages/Dashboard'
import DayView from './pages/DayView'
import Goals from './pages/Goals'
import Insights from './pages/Insights'
import Letter from './pages/Letter'
import Login from './pages/Login'
import Practice from './pages/Practice'
import Quick from './pages/Quick'
import Review from './pages/Review'
import Search from './pages/Search'
import Settings from './pages/Settings'
import Setup from './pages/Setup'
import Year from './pages/Year'

// 'setup' means the app has never had credentials created.
type SessionState = 'checking' | 'setup' | 'in' | 'out'

const RAIN_KEY = 'dayshift.rain'

/** Read the saved rain preference. Defaults to on. */
function loadRainPreference(): boolean {
  try {
    return window.localStorage.getItem(RAIN_KEY) !== 'off'
  } catch {
    // Private windows and blocked site data both throw here.
    return true
  }
}

/**
 * Owns the session check and the two routes. The session is an httpOnly
 * cookie, so the SPA cannot read it directly — it asks the server on mount.
 */
export default function App() {
  const [session, setSession] = useState<SessionState>('checking')
  const [setupTokenRequired, setSetupTokenRequired] = useState(false)
  const [rain, setRain] = useState<boolean>(loadRainPreference)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // Page shortcuts work only once signed in; the sign-in form owns the keys
  // before that.
  const signedIn = session === 'in'
  useHotkey('d', () => navigate('/'), signedIn)
  useHotkey('r', () => navigate('/review'), signedIn)
  useHotkey('i', () => navigate('/insights'), signedIn)
  useHotkey('s', () => navigate('/settings'), signedIn)
  useHotkey('q', () => navigate('/practice'), signedIn)
  useHotkey('a', () => navigate('/agenda'), signedIn)
  useHotkey('g', () => navigate('/goals'), signedIn)
  useHotkey('m', () => navigate('/letter'), signedIn)
  useHotkey('/', () => navigate('/search'), signedIn)
  useHotkey('?', () => setShowShortcuts((v) => !v), signedIn)
  const closeShortcuts = useCallback(() => setShowShortcuts(false), [])

  // ⌘K / Ctrl+K opens the command palette from anywhere, even inside a field
  // — it is a modifier chord, so it cannot collide with typing.
  const [showPalette, setShowPalette] = useState(false)
  useEffect(() => {
    if (!signedIn) return
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowPalette((v) => !v)
      }
    }
    // The ⋯ menu opens both panels with a click, for when the keys are not known.
    const openShortcuts = () => setShowShortcuts(true)
    const openPalette = () => setShowPalette(true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener(OPEN_SHORTCUTS_EVENT, openShortcuts)
    window.addEventListener(OPEN_PALETTE_EVENT, openPalette)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, openShortcuts)
      window.removeEventListener(OPEN_PALETTE_EVENT, openPalette)
    }
  }, [signedIn])
  const closePalette = useCallback(() => setShowPalette(false), [])

  const toggleRain = useCallback(() => {
    setRain((on) => {
      const next = !on
      try {
        window.localStorage.setItem(RAIN_KEY, next ? 'on' : 'off')
      } catch {
        // Preference simply will not persist; the toggle still works.
      }
      return next
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .sessionStatus()
      .then((status) => {
        if (cancelled) return
        setSetupTokenRequired(status.setup_token_required)
        if (!status.configured) setSession('setup')
        else setSession(status.authenticated ? 'in' : 'out')
      })
      .catch(() => {
        if (!cancelled) setSession('out')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleAuthenticated = useCallback(() => {
    setSession('in')
    navigate('/', { replace: true })
  }, [navigate])

  /** Called when any API call comes back 401 — the cookie expired mid-session. */
  const handleSessionExpired = useCallback(() => {
    setSession('out')
  }, [])

  const handleLogout = useCallback(async () => {
    await api.logout().catch(() => undefined)
    setSession('out')
    navigate('/login', { replace: true })
  }, [navigate])

  if (session === 'checking') {
    return (
      <>
        {rain && <MatrixRain />}
        <div className="flex min-h-screen items-center justify-center">
          <span className="font-mono text-sm text-faint">
            Establishing session<span className="animate-caret">…</span>
          </span>
        </div>
      </>
    )
  }

  // Setup takes precedence over everything: until credentials exist there is
  // nothing to sign in to.
  if (session === 'setup' && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />
  }

  if (session === 'out' && location.pathname !== '/login') {
    return <Navigate to="/login" replace />
  }

  return (
    <>
      {rain && <MatrixRain />}
      {signedIn && showShortcuts && <ShortcutsHelp onClose={closeShortcuts} />}
      {signedIn && showPalette && (
        <CommandPalette onClose={closePalette} onSessionExpired={handleSessionExpired} />
      )}
      <Routes>
        <Route
          path="/setup"
          element={
            session === 'setup' ? (
              <Setup
                onAuthenticated={handleAuthenticated}
                tokenRequired={setupTokenRequired}
              />
            ) : (
              <Navigate to={session === 'in' ? '/' : '/login'} replace />
            )
          }
        />
        <Route
          path="/login"
          element={
            session === 'in' ? (
              <Navigate to="/" replace />
            ) : session === 'setup' ? (
              <Navigate to="/setup" replace />
            ) : (
              <Login onAuthenticated={handleAuthenticated} />
            )
          }
        />
        <Route
          path="/"
          element={
            <Dashboard
              onSessionExpired={handleSessionExpired}
              onLogout={handleLogout}
              rain={rain}
              onToggleRain={toggleRain}
            />
          }
        />
        <Route
          path="/insights"
          element={<Insights onSessionExpired={handleSessionExpired} />}
        />
        <Route
          path="/review"
          element={<Review onSessionExpired={handleSessionExpired} />}
        />
        <Route
          path="/practice"
          element={<Practice onSessionExpired={handleSessionExpired} />}
        />
        <Route
          path="/quick"
          element={<Quick onSessionExpired={handleSessionExpired} />}
        />
        <Route
          path="/goals"
          element={<Goals onSessionExpired={handleSessionExpired} />}
        />
        <Route
          path="/year/:year?"
          element={<Year onSessionExpired={handleSessionExpired} />}
        />
        <Route
          path="/letter/:month?"
          element={<Letter onSessionExpired={handleSessionExpired} />}
        />
        <Route
          path="/agenda"
          element={<Agenda onSessionExpired={handleSessionExpired} />}
        />
        <Route
          path="/settings"
          element={<Settings onSessionExpired={handleSessionExpired} />}
        />
        <Route
          path="/search"
          element={<Search onSessionExpired={handleSessionExpired} />}
        />
        <Route
          path="/day/:date"
          element={<DayView onSessionExpired={handleSessionExpired} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
