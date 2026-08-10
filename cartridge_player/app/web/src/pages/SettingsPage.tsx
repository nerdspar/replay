import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import type { EntityOption, RemovalAction, Settings } from '../types'

const REMOVAL_OPTIONS: { value: RemovalAction; label: string; hint: string }[] = [
  { value: 'none', label: 'Do nothing', hint: 'Leave whatever is playing alone.' },
  { value: 'pause', label: 'Pause', hint: 'Pause playback on the TV.' },
  { value: 'back', label: 'Back', hint: 'Send the Back key.' },
  { value: 'home', label: 'Home', hint: 'Return the TV to its home screen.' },
]

interface SettingsPageProps {
  settings: Settings
  onSaved: (settings: Settings) => void
}

export function SettingsPage({ settings, onSaved }: SettingsPageProps) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [entities, setEntities] = useState<{
    remotes: EntityOption[]
    mediaPlayers: EntityOption[]
  }>({ remotes: [], mediaPlayers: [] })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pin, setPin] = useState('')

  useEffect(() => setDraft(settings), [settings])

  useEffect(() => {
    api.entities().then(setEntities).catch(() => setEntities({ remotes: [], mediaPlayers: [] }))
  }, [])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const saved = await api.saveSettings({
        remote_entity: draft.remote_entity,
        media_player_entity: draft.media_player_entity,
        home_first_enabled: draft.home_first_enabled,
        home_delay_ms: draft.home_delay_ms,
        autoplay_enabled: draft.autoplay_enabled,
        autoplay_delay_ms: draft.autoplay_delay_ms,
        removal_action: draft.removal_action,
        public_base_url: draft.public_base_url,
        ...(pin.trim() === '' ? {} : { pin: pin.trim() }),
      })
      onSaved(saved)
      setPin('')
      setMessage('Saved.')
      setTimeout(() => setMessage(null), 3000)
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {message ? <div className="banner alert">{message}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}

      <div className="card">
        <h2>Your TV</h2>
        <label className="field" style={{ marginTop: 12 }}>
          <span>Remote</span>
          <select
            value={draft.remote_entity ?? ''}
            onChange={(e) => set('remote_entity', e.target.value || null)}
          >
            <option value="">Not set</option>
            {entities.remotes.map((entity) => (
              <option key={entity.entity_id} value={entity.entity_id}>
                {entity.name}
              </option>
            ))}
          </select>
          <p className="hint">Comes from the Android TV Remote integration.</p>
        </label>

        <label className="field">
          <span>Media player</span>
          <select
            value={draft.media_player_entity ?? ''}
            onChange={(e) => set('media_player_entity', e.target.value || null)}
          >
            <option value="">Not set</option>
            {entities.mediaPlayers.map((entity) => (
              <option key={entity.entity_id} value={entity.entity_id}>
                {entity.name}
              </option>
            ))}
          </select>
          <p className="hint">Only used for pause and stop.</p>
        </label>
      </div>

      <div className="card">
        <h2>What happens on a tap</h2>

        <div className="switch">
          <span>Wake the TV first</span>
          <input
            type="checkbox"
            checked={draft.home_first_enabled}
            onChange={(e) => set('home_first_enabled', e.target.checked)}
          />
        </div>
        <p className="hint">
          A link opened on a sleeping TV lands behind the screensaver. Pressing Home
          first dismisses it.
        </p>

        <label className="field" style={{ marginTop: 12 }}>
          <span>Wait after Home (ms)</span>
          <input
            type="number"
            min={0}
            max={60000}
            step={100}
            value={draft.home_delay_ms}
            onChange={(e) => set('home_delay_ms', Number(e.target.value))}
          />
          <p className="hint">
            How long the TV needs to reach its home screen. Raise it if tapping a
            cartridge sometimes opens nothing.
          </p>
        </label>

        <div className="switch">
          <span>Start playing automatically</span>
          <input
            type="checkbox"
            checked={draft.autoplay_enabled}
            onChange={(e) => set('autoplay_enabled', e.target.checked)}
          />
        </div>
        <p className="hint">
          Stremio opens on the detail page, because a stream still has to be picked.
          This presses Select to take the first one.
        </p>

        <label className="field" style={{ marginTop: 12 }}>
          <span>Wait before Select (ms)</span>
          <input
            type="number"
            min={0}
            max={60000}
            step={100}
            value={draft.autoplay_delay_ms}
            onChange={(e) => set('autoplay_delay_ms', Number(e.target.value))}
          />
          <p className="hint">
            How long the app needs to list streams. Too short and it presses Select on
            an empty page.
          </p>
        </label>
      </div>

      <div className="card">
        <h2>When a cartridge is lifted off</h2>
        <div className="radio-list" style={{ marginTop: 8 }}>
          {REMOVAL_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="removal"
                checked={draft.removal_action === option.value}
                onChange={() => set('removal_action', option.value)}
              />
              <span>
                {option.label}
                <span className="hint" style={{ display: 'block' }}>
                  {option.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Home screen icon</h2>
        <label className="field" style={{ marginTop: 12 }}>
          <span>Home Assistant address</span>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="off"
            placeholder="https://homeassistant.local:8123"
            value={draft.public_base_url ?? ''}
            onChange={(e) => set('public_base_url', e.target.value || null)}
          />
          <p className="hint">
            Used to build the bookmarkable link for adding this app to your phone's
            home screen. Find the link under Troubleshooting.
          </p>
        </label>
      </div>

      <div className="card">
        <h2>Direct access (advanced)</h2>
        <p className="muted">
          {draft.direct_mode.enabled
            ? draft.direct_mode.running
              ? `On, port ${draft.direct_mode.port}. A PIN is required to open it.`
              : `Requested on port ${draft.direct_mode.port}, but it will not start until a PIN is set.`
            : 'Off. The app is reached through Home Assistant, which is the recommended setup.'}
        </p>
        <label className="field" style={{ marginTop: 12 }}>
          <span>{draft.pin_set ? 'Change PIN' : 'Set a PIN'}</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            placeholder={draft.pin_set ? '••••' : 'At least 4 characters'}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <p className="hint">
            Direct access skips Home Assistant's login entirely, so it is gated by this
            PIN.
          </p>
        </label>
      </div>

      <button className="btn primary block" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </>
  )
}
