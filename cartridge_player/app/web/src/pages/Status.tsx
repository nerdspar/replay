import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import type { AppStream } from '../hooks/useAppStream'
import type { ScanEvent, Settings } from '../types'

interface StatusProps {
  stream: AppStream
  settings: Settings
}

function when(ms: number): string {
  const seconds = Math.round((Date.now() - ms) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return new Date(ms).toLocaleString()
}

/** Enough to see what just happened without a wall of text on a phone. */
const SCAN_PAGE = 20

export function Status({ stream, settings: initial }: StatusProps) {
  const [scans, setScans] = useState<ScanEvent[]>([])
  const [reader, setReader] = useState<{
    connected: boolean
    device: string | null
    supportsColor: boolean
    last_seen: number | null
    light_reason: string | null
  } | null>(null)
  const [limit, setLimit] = useState(SCAN_PAGE)
  const [total, setTotal] = useState(0)
  const [lastError, setLastError] = useState<{ message: string; at: number } | null>(null)
  const [pin, setPin] = useState('')
  const [savingPin, setSavingPin] = useState(false)
  const [pinMessage, setPinMessage] = useState<string | null>(null)
  const [tvTest, setTvTest] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [tvError, setTvError] = useState<string | null>(null)
  // Refetched on mount: the add-on slug — and so the panel link — can resolve
  // after the app first loaded, if Supervisor was slow to answer at boot.
  const [settings, setSettings] = useState<Settings>(initial)

  useEffect(() => setSettings(initial), [initial])

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => undefined)
  }, [])

  // Re-asked on every scan: a reader that has just spoken is plainly awake, and
  // that is exactly when the answer is most likely to have changed.
  useEffect(() => {
    api.reader().then(setReader).catch(() => setReader(null))
  }, [stream.lastScan, stream.cardsVersion])

  useEffect(() => {
    api
      .scans(limit + 1)
      .then(({ scans: rows, last_error }) => {
        // One more than asked for, purely to know whether to offer Load more.
        // Cheaper than a second count query for a list this small.
        setTotal(rows.length)
        setScans(rows.slice(0, limit))
        setLastError(last_error)
      })
      .catch(() => undefined)
  }, [limit, stream.lastScan, stream.cardsVersion])

  const testTv = async () => {
    setTvTest('sending')
    setTvError(null)
    try {
      await api.sendKey('home')
      setTvTest('sent')
      setTimeout(() => setTvTest('idle'), 6000)
    } catch (e) {
      setTvTest('idle')
      setTvError((e as ApiError).message)
    }
  }

  const savePin = async () => {
    setSavingPin(true)
    setPinMessage(null)
    try {
      await api.saveSettings({ pin: pin.trim() })
      setPin('')
      setPinMessage('Saved.')
      setTimeout(() => setPinMessage(null), 3000)
    } catch (e) {
      setPinMessage((e as Error).message)
    } finally {
      setSavingPin(false)
    }
  }

  const haDot =
    stream.connection === 'connected' ? 'ok' : stream.connection === 'connecting' ? 'warn' : 'bad'

  return (
    <>
      <div className="card">
        <h2>Connections</h2>
        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
          <span className="pill">
            <span className={`dot ${haDot}`} />
            Home Assistant: {stream.connection}
          </span>
          <span className="pill">
            <span className={`dot ${stream.streamAlive ? 'ok' : 'bad'}`} />
            Live updates: {stream.streamAlive ? 'on' : 'off'}
          </span>
          {/*
            The reader is its own question. It and Home Assistant fail
            independently, and which one is down is the difference between
            looking at the add-on and walking over to the reader.
          */}
          <span className="pill">
            <span className={`dot ${reader === null ? 'warn' : reader.connected ? 'ok' : 'bad'}`} />
            Reader: {reader === null ? 'checking…' : reader.connected ? 'connected' : 'not found'}
          </span>
        </div>

        {reader?.connected ? (
          <p className="hint">
            {reader.device}
            {reader.last_seen ? ` · last scan ${when(reader.last_seen)}` : ' · nothing scanned yet'}
            {reader.supportsColor ? '' : ' · firmware predates artwork colours'}
          </p>
        ) : null}

        {/*
          The add-on knows exactly why the light is doing what it is doing, and
          leaving that to be inferred from an LED is what made a misconfigured
          media player take three rounds to find. So it says so, in the place
          you look when something seems wrong.
        */}
        {reader?.light_reason ? (
          <p className="hint warn" style={{ marginTop: 8 }}>
            {reader.light_reason}
          </p>
        ) : null}

        {reader !== null && !reader.connected ? (
          <p className="hint warn">
            Home Assistant is not offering the reader's actions, which it only
            does while the device is connected. Check the reader has power and is
            on wifi — its own light says which, even with this add-on stopped.
          </p>
        ) : null}
        {stream.connectionDetail ? <p className="hint">{stream.connectionDetail}</p> : null}
        {!stream.streamAlive ? (
          <button className="btn small" style={{ marginTop: 12 }} onClick={stream.reconnect}>
            Reconnect
          </button>
        ) : null}

        {/*
          Checks the TV without needing a cartridge. Setup proves this once in
          the wizard, but "it stopped working" happens later, and until now the
          only way to retest was to go and tap a card.
        */}
        <div className="row" style={{ marginTop: 14, gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn small"
            disabled={tvTest === 'sending'}
            onClick={() => void testTv()}
          >
            {tvTest === 'sending' ? 'Sending…' : 'Send Home to the TV'}
          </button>
          {tvTest === 'sent' ? (
            <span className="pill">
              <span className="dot ok" />
              Sent — did the TV react?
            </span>
          ) : null}
        </div>
        {tvError ? (
          <p className="hint" style={{ color: 'var(--danger)' }}>
            {tvError}
          </p>
        ) : null}
        {settings.remote_entity ? null : (
          <p className="hint">No TV is selected yet — pick one in Settings.</p>
        )}
      </div>

      {/*
        Direct access lives here rather than in Settings because it describes
        this add-on rather than any one reader — and Settings is now entirely
        per-reader. Status is already where the machine-level truth is: the
        connections, the reader, the scan log.
      */}
      <div className="card">
        <h2>Direct access (advanced)</h2>
        <p className="muted">
          {settings.direct_mode.enabled
            ? settings.direct_mode.running
              ? `On, port ${settings.direct_mode.port}. A PIN is required to open it.`
              : `Requested on port ${settings.direct_mode.port}, but it will not start until a PIN is set.`
            : 'Off. The app is reached through Home Assistant, which is the recommended setup.'}
        </p>
        <label className="field" style={{ marginTop: 12 }}>
          <span>{settings.pin_set ? 'Change PIN' : 'Set a PIN'}</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            placeholder={settings.pin_set ? '••••' : 'At least 4 characters'}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <p className="hint">
            Direct access skips Home Assistant's login entirely, so it is gated
            by this PIN.
          </p>
        </label>
        <button
          className="btn block"
          disabled={pin.trim() === '' || savingPin}
          onClick={() => void savePin()}
        >
          {savingPin ? 'Saving…' : 'Save PIN'}
        </button>
        {pinMessage ? <p className="hint">{pinMessage}</p> : null}
      </div>

      {lastError ?? stream.lastError ? (
        <div className="card">
          <h2>Last error</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            {stream.lastError ?? lastError?.message}
          </p>
          {lastError ? <p className="hint">{when(lastError.at)}</p> : null}
        </div>
      ) : null}

      <div className="card">
        <h2>Recent scans</h2>
        {scans.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>
            Nothing yet. Tap a cartridge on the reader.
          </p>
        ) : (
          <div className="list" style={{ marginTop: 10 }}>
            {scans.map((scan) => (
              <div key={scan.id} className="list-row" style={{ cursor: 'default' }}>
                <span className={`dot ${scan.error ? 'bad' : 'ok'}`} />
                <span className="grow">
                  <span className="mono">{scan.tag_uid}</span>
                  <span className="hint" style={{ display: 'block' }}>
                    {scan.error ?? scan.action_taken ?? '—'}
                  </span>
                </span>
                <span className="hint">{when(scan.created_at)}</span>
              </div>
            ))}
          </div>
        )}
        {total > limit ? (
          <button
            className="btn block"
            style={{ marginTop: 12 }}
            onClick={() => setLimit((n) => n + SCAN_PAGE)}
          >
            Load more
          </button>
        ) : null}
      </div>
    </>
  )
}
