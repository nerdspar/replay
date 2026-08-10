import { useState } from 'react'
import { api, ApiError } from '../api'

/**
 * Only ever rendered on the LAN-direct listener. Through ingress, Home Assistant
 * has already authenticated the user and this never appears (§3.4).
 */
export function PinGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.login(pin)
      onUnlocked()
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="content" style={{ maxWidth: 420 }}>
      <div className="card">
        <h2>Enter your PIN</h2>
        <p className="muted">This app is being opened outside Home Assistant.</p>
        <form onSubmit={submit} style={{ marginTop: 14 }}>
          <label className="field">
            <span>PIN</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </label>
          {error ? <div className="banner error">{error}</div> : null}
          <button className="btn primary block" disabled={busy || pin === ''}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  )
}
