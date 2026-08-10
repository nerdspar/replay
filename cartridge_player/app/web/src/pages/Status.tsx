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

export function Status({ stream, settings: initial }: StatusProps) {
  const [scans, setScans] = useState<ScanEvent[]>([])
  const [lastError, setLastError] = useState<{ message: string; at: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [tvTest, setTvTest] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [tvError, setTvError] = useState<string | null>(null)
  // Refetched on mount: the add-on slug — and so the panel link — can resolve
  // after the app first loaded, if Supervisor was slow to answer at boot.
  const [settings, setSettings] = useState<Settings>(initial)

  useEffect(() => setSettings(initial), [initial])

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => undefined)
  }, [])

  useEffect(() => {
    api
      .scans(50)
      .then(({ scans: rows, last_error }) => {
        setScans(rows)
        setLastError(last_error)
      })
      .catch(() => undefined)
  }, [stream.lastScan, stream.cardsVersion])

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

  const copyPanelUrl = async () => {
    if (!settings.panel_url) return
    try {
      await navigator.clipboard.writeText(settings.panel_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
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
        </div>
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

      <div className="card">
        <h2>Add to your home screen</h2>
        {settings.panel_url ? (
          <>
            <p className="mono" style={{ marginTop: 10 }}>
              {settings.panel_url}
            </p>
            <button className="btn small" style={{ marginTop: 10 }} onClick={() => void copyPanelUrl()}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <p className="hint">
              Open this in your phone's browser, then use Share → Add to Home Screen.
            </p>
          </>
        ) : (
          <p className="muted" style={{ marginTop: 8 }}>
            Set your Home Assistant address in Settings and this link appears here.
            {settings.addon_slug ? null : ' (Waiting on the add-on slug from Supervisor.)'}
          </p>
        )}
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
      </div>
    </>
  )
}
