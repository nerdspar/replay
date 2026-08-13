import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api'
import { EntityPicker } from '../components/EntityPicker'
import { LightSettings } from '../components/LightSettings'
import type {
  EntityOption,
  LedPalette,
  LedPlayingMode,
  MusicRemovalAction,
  RemovalAction,
  Settings,
} from '../types'

const REMOVAL_OPTIONS: { value: RemovalAction; label: string; hint: string }[] = [
  { value: 'none', label: 'Do nothing', hint: 'Leave whatever is playing alone.' },
  { value: 'pause', label: 'Pause', hint: 'Pause playback on the TV.' },
  { value: 'back', label: 'Back', hint: 'Send the Back key.' },
  { value: 'home', label: 'Home', hint: 'Return the TV to its home screen.' },
  { value: 'off', label: 'Turn the TV off', hint: 'Power the TV down.' },
]

/**
 * A speaker's whole vocabulary. There is no Back, no Home and no screen to
 * return to, which is why this is a separate list from the television's.
 */
const MUSIC_REMOVAL_OPTIONS: {
  value: MusicRemovalAction
  label: string
  hint: string
}[] = [
  {
    value: 'pause',
    label: 'Pause',
    hint: 'Keeps its place, so putting the cartridge back carries on where it stopped.',
  },
  {
    value: 'stop',
    label: 'Stop',
    hint: 'Clears the queue. Putting the cartridge back starts it over.',
  },
  { value: 'none', label: 'Keep playing', hint: 'The music carries on regardless.' },
]

type SettingsTab = 'players' | 'playback' | 'light' | 'access'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'players', label: 'Players' },
  { id: 'playback', label: 'Playback' },
  { id: 'light', label: 'Light' },
  { id: 'access', label: 'Access' },
]

/**
 * Which settings live under which tab.
 *
 * Kept as data because one Save button covers all four, and tabbing hides
 * pending edits behind the tabs you are not looking at. This is what lets a tab
 * say it is holding some — otherwise the only way to find an unsaved change
 * would be to go looking for it.
 */
const TAB_SETTINGS: Record<SettingsTab, (keyof Settings)[]> = {
  players: ['remote_entity', 'media_player_entity', 'music_player_entity'],
  playback: [
    'home_first_enabled',
    'home_delay_ms',
    'autoplay_enabled',
    'autoplay_delay_ms',
    'removal_action',
    'music_removal_action',
  ],
  light: [
    'led_enabled',
    'led_playing_mode',
    'led_playing_artwork',
    'led_follow_player',
    'led_match_cartridge',
    'led_scope',
    'led_palette',
  ],
  access: ['public_base_url'],
}

interface SettingsPageProps {
  settings: Settings
  onSaved: (settings: Settings) => void
}

export function SettingsPage({ settings, onSaved }: SettingsPageProps) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [entities, setEntities] = useState<{
    remotes: EntityOption[]
    mediaPlayers: EntityOption[]
    musicPlayers: EntityOption[]
  }>({ remotes: [], mediaPlayers: [], musicPlayers: [] })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [tab, setTab] = useState<SettingsTab>('players')

  /** Whether a tab is holding edits that have not been saved yet. */
  const unsaved = (which: SettingsTab) =>
    TAB_SETTINGS[which].some(
      (key) => JSON.stringify(draft[key]) !== JSON.stringify(settings[key]),
    ) ||
    // The PIN is write-only, so it is never part of the draft to compare.
    (which === 'access' && pin.trim() !== '')

  useEffect(() => setDraft(settings), [settings])

  useEffect(() => {
    api
      .entities()
      .then(setEntities)
      .catch(() => setEntities({ remotes: [], mediaPlayers: [], musicPlayers: [] }))
  }, [])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  /**
   * Music Assistant mirrors players it can send audio to, so its copy of your
   * TV exists but does not control the app playing on screen. Choosing it is an
   * easy mistake when both entries share a name, and the only symptom is that
   * pausing silently does nothing.
   */
  const mediaPlayerWarning = useMemo(() => {
    const chosen = entities.mediaPlayers.find(
      (entity) => entity.entity_id === draft.media_player_entity,
    )
    if (!chosen?.platform?.toLowerCase().includes('music assistant')) return null
    return (
      "This one comes from Music Assistant. If pausing doesn't work, choose the " +
      "player from your TV's own integration instead."
    )
  }, [entities.mediaPlayers, draft.media_player_entity])

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
        music_player_entity: draft.music_player_entity,
        music_removal_action: draft.music_removal_action,
        led_enabled: draft.led_enabled,
        led_playing_mode: draft.led_playing_mode,
        led_playing_artwork: draft.led_playing_artwork,
        led_follow_player: draft.led_follow_player,
        led_match_cartridge: draft.led_match_cartridge,
        led_scope: draft.led_scope,
        led_palette: draft.led_palette,
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

      <div className="tabs" role="tablist" aria-label="Settings">
        {TABS.map((option) => (
          <button
            key={option.id}
            role="tab"
            aria-selected={tab === option.id}
            className={tab === option.id ? 'active' : ''}
            onClick={() => setTab(option.id)}
          >
            {option.label}
            {/*
              A tab holding unsaved edits. One Save button covers all four, so
              without this a change made under Playback is invisible from
              Players and reads as never having been made.
            */}
            {unsaved(option.id) ? (
              <span className="tab-dot" aria-label="unsaved changes" />
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'players' ? (
      <>
      <div className="card">
        <h2>Your TV</h2>
        <div style={{ marginTop: 12 }}>
          <EntityPicker
            label="Remote"
            entities={entities.remotes}
            value={draft.remote_entity}
            onChange={(id) => set('remote_entity', id)}
            emptyLabel="Not set"
            hint="Comes from the Android TV Remote integration."
          />
        </div>

        <EntityPicker
          label="Media player"
          entities={entities.mediaPlayers}
          value={draft.media_player_entity}
          onChange={(id) => set('media_player_entity', id)}
          emptyLabel="Not set"
          hint={
            <>
              Only used for pause and stop. If the same name appears twice, pick
              the one from your TV's own integration — a Music Assistant copy of
              the same player controls audio, not the app on screen.
            </>
          }
        />

        {mediaPlayerWarning ? <p className="hint warn">{mediaPlayerWarning}</p> : null}
      </div>

      <div className="card">
        <h2>Your speaker</h2>
        <div style={{ marginTop: 12 }}>
          <EntityPicker
            label="Default speaker"
            entities={entities.musicPlayers}
            value={draft.music_player_entity}
            onChange={(id) => set('music_player_entity', id)}
            emptyLabel="Not set"
            hint={
              entities.musicPlayers.length === 0
                ? 'No Music Assistant players found. Music cartridges need the Music Assistant integration set up in Home Assistant first.'
                : 'Where music cartridges play. Any single cartridge can override this.'
            }
          />
        </div>
      </div>
      </>
      ) : null}

      {tab === 'playback' ? (
      <>
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
        <h2>When a video cartridge is lifted off</h2>
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
        <h2>When a music cartridge is lifted off</h2>
        <div className="radio-list" style={{ marginTop: 8 }}>
          {MUSIC_REMOVAL_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="music-removal"
                checked={draft.music_removal_action === option.value}
                onChange={() => set('music_removal_action', option.value)}
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

      </>
      ) : null}

      {tab === 'light' ? (
      <LightSettings
        enabled={draft.led_enabled}
        useArtwork={draft.led_playing_artwork}
        followPlayer={draft.led_follow_player}
        matchCartridge={draft.led_match_cartridge}
        scope={draft.led_scope}
        palette={draft.led_palette}
        playingMode={draft.led_playing_mode}
        onEnabledChange={(v) => set('led_enabled', v)}
        onUseArtworkChange={(v) => set('led_playing_artwork', v)}
        onFollowPlayerChange={(v) => set('led_follow_player', v)}
        onMatchCartridgeChange={(v) => set('led_match_cartridge', v)}
        onScopeChange={(v) => set('led_scope', v)}
        onPaletteChange={(v: LedPalette) => set('led_palette', v)}
        onPlayingModeChange={(v: LedPlayingMode) => set('led_playing_mode', v)}
      />
      ) : null}

      {tab === 'access' ? (
      <>
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
            home screen. Find the link under Status.
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
      </>
      ) : null}

      {/*
        Outside the tabs, because it saves all four. A Save button inside a tab
        would read as saving that tab alone.
      */}
      <button className="btn primary block" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save settings'}
      </button>
      {TABS.some((option) => unsaved(option.id)) ? (
        <p className="hint" style={{ textAlign: 'center', marginTop: 8 }}>
          Saves every tab, not just this one.
        </p>
      ) : null}
    </>
  )
}
