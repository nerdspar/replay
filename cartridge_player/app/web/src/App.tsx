import { useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './api'
import { PinGate } from './components/PinGate'
import { useAppStream } from './hooks/useAppStream'
import { Library } from './pages/Library'
import { PrintSheet } from './pages/PrintSheet'
import { SettingsPage } from './pages/SettingsPage'
import { Troubleshoot } from './pages/Troubleshoot'
import { Wizard } from './pages/Wizard'
import type { Settings } from './types'

export default function App() {
  const stream = useAppStream()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [locked, setLocked] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .authStatus()
      .then((auth) => {
        if (auth.required && !auth.authenticated) {
          setLocked(true)
          return null
        }
        setLocked(false)
        return api.getSettings()
      })
      .then((next) => {
        if (next) setSettings(next)
      })
      .catch((error: Error) => setBootError(error.message))
  }, [])

  useEffect(load, [load])

  if (locked) return <PinGate onUnlocked={load} />

  if (bootError) {
    return (
      <div className="content">
        <div className="banner error">{bootError}</div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="center-empty">
        <div className="spinner" style={{ margin: '0 auto 10px' }} />
        Loading…
      </div>
    )
  }

  const haDot =
    stream.connection === 'connected' && stream.streamAlive
      ? 'ok'
      : stream.connection === 'connecting'
        ? 'warn'
        : 'bad'

  if (!settings.setup_complete) {
    return (
      <div className="app">
        <header className="topbar">
          <h1>Set up Cartridge Player</h1>
        </header>
        <main className="content">
          <Wizard settings={settings} stream={stream} onDone={setSettings} />
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Cartridges</h1>
        {/* A dead stream must be visible, not silent (§8.2). */}
        <span className="pill" title={stream.connectionDetail ?? stream.connection}>
          <span className={`dot ${haDot}`} />
          {stream.streamAlive ? 'live' : 'offline'}
        </span>
      </header>

      <main className="content">
        <Routes>
          <Route path="/" element={<Library stream={stream} />} />
          <Route
            path="/settings"
            element={<SettingsPage settings={settings} onSaved={setSettings} />}
          />
          <Route
            path="/troubleshooting"
            element={<Troubleshoot stream={stream} settings={settings} />}
          />
          <Route path="/print" element={<PrintSheet />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="tabbar">
        <NavLink to="/" end>
          <span className="glyph" aria-hidden="true">
            🎞
          </span>
          Library
        </NavLink>
        <NavLink to="/settings">
          <span className="glyph" aria-hidden="true">
            ⚙
          </span>
          Settings
        </NavLink>
        <NavLink to="/troubleshooting">
          <span className="glyph" aria-hidden="true">
            🩺
          </span>
          Help
        </NavLink>
      </nav>
    </div>
  )
}
