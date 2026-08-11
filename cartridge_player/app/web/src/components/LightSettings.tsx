import { Icon } from './Icon'
import type { LedPalette, LedPlayingMode, LedStateName, LedStateStyle } from '../types'

/**
 * Colours for the reader's status light.
 *
 * The nine states are split into the ones the reader works out for itself and
 * the ones this add-on tells it, because that division is the whole reason the
 * light is useful: the first group still works when this add-on is stopped, and
 * is therefore what tells you whether a dead cartridge tap is the reader's
 * fault or everything else's.
 */

/** Must match DEFAULT_PALETTE on the server, which matches the firmware. */
export const DEFAULT_PALETTE: LedPalette = {
  no_wifi: { color: '#ff0000', brightness: 45 },
  no_ha: { color: '#ff8c00', brightness: 45 },
  ready: { color: '#ffffff', brightness: 10 },
  read: { color: '#ffffff', brightness: 100 },
  working: { color: '#ffffff', brightness: 40 },
  no_answer: { color: '#ff8c00', brightness: 80 },
  playing: { color: '#00ff26', brightness: 70 },
  new: { color: '#1a59ff', brightness: 60 },
  error: { color: '#ff0000', brightness: 80 },
}

interface StateInfo {
  key: LedStateName
  label: string
  hint: string
  /** How it moves. Fixed, because motion is what separates two states that share a colour. */
  motion: string
}

const READER_STATES: StateInfo[] = [
  { key: 'no_wifi', label: 'No wifi', hint: 'The reader cannot reach your network.', motion: 'Slow' },
  {
    key: 'no_ha',
    label: 'No Home Assistant',
    hint: 'On wifi, but Home Assistant has not connected back.',
    motion: 'Slow',
  },
  { key: 'ready', label: 'Ready', hint: 'Waiting for a cartridge. Lit for hours, so keep it dim.', motion: 'Steady' },
  { key: 'read', label: 'Cartridge read', hint: 'A brief flash the moment a tag is picked up.', motion: 'Flash' },
  {
    key: 'working',
    label: 'Working',
    hint: 'Read the tag, waiting to hear what happens next.',
    motion: 'Slow',
  },
  {
    key: 'no_answer',
    label: 'No answer',
    hint: 'Nothing responded to the cartridge. Usually means this add-on is stopped.',
    motion: 'Fast',
  },
]

const ADDON_STATES: StateInfo[] = [
  { key: 'playing', label: 'Playing', hint: 'The cartridge started something.', motion: 'Steady' },
  {
    key: 'new',
    label: 'Not set up',
    hint: 'A cartridge with nothing on it yet. Holds until you assign it.',
    motion: 'Slow',
  },
  { key: 'error', label: 'Something failed', hint: 'Clears itself after 30 seconds.', motion: 'Fast' },
]

const PLAYING_MODES: { value: LedPlayingMode; label: string; hint: string }[] = [
  {
    value: 'hold',
    label: 'Stay lit',
    hint: 'Stays on for as long as the cartridge is on the reader.',
  },
  { value: 'confirm', label: 'Confirm briefly', hint: 'Two seconds, then back to Ready.' },
  { value: 'off', label: 'Nothing', hint: 'Goes straight back to Ready.' },
]

interface LightSettingsProps {
  enabled: boolean
  palette: LedPalette
  playingMode: LedPlayingMode
  onEnabledChange: (enabled: boolean) => void
  onPaletteChange: (palette: LedPalette) => void
  onPlayingModeChange: (mode: LedPlayingMode) => void
}

export function LightSettings({
  enabled,
  palette,
  playingMode,
  onEnabledChange,
  onPaletteChange,
  onPlayingModeChange,
}: LightSettingsProps) {
  const set = (key: LedStateName, patch: Partial<LedStateStyle>) =>
    onPaletteChange({ ...palette, [key]: { ...palette[key], ...patch } })

  const isDefault = (key: LedStateName) =>
    palette[key]?.color?.toLowerCase() === DEFAULT_PALETTE[key].color &&
    palette[key]?.brightness === DEFAULT_PALETTE[key].brightness

  const row = (state: StateInfo) => (
    <div className="led-row" key={state.key}>
      <input
        type="color"
        aria-label={`${state.label} colour`}
        value={palette[state.key]?.color ?? DEFAULT_PALETTE[state.key].color}
        onChange={(e) => set(state.key, { color: e.target.value })}
      />
      <div className="grow">
        <div className="row between" style={{ gap: 8 }}>
          <strong>{state.label}</strong>
          <span className="pill">{state.motion}</span>
        </div>
        <p className="hint" style={{ margin: '2px 0 6px' }}>
          {state.hint}
        </p>
        <div className="row" style={{ gap: 10 }}>
          <input
            type="range"
            min={0}
            max={100}
            aria-label={`${state.label} brightness`}
            value={palette[state.key]?.brightness ?? 0}
            onChange={(e) => set(state.key, { brightness: Number(e.target.value) })}
            style={{ flex: 1 }}
          />
          <span className="hint mono" style={{ width: 42, textAlign: 'right' }}>
            {palette[state.key]?.brightness ?? 0}%
          </span>
          <button
            className="btn small"
            disabled={isDefault(state.key)}
            title={`Reset ${state.label} to its default`}
            aria-label={`Reset ${state.label} to its default`}
            onClick={() => set(state.key, { ...DEFAULT_PALETTE[state.key] })}
          >
            <Icon name="undo" size={15} />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="card">
      <h2>Reader light</h2>

      <div className="switch" style={{ marginTop: 12 }}>
        <span>Use the status light</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
      </div>
      <p className="hint">
        Turning this off stops the add-on colouring the light. The reader keeps
        showing its own connection states, which is deliberate — those are what
        tell you whether a problem is the reader or everything else.
      </p>

      {enabled ? (
        <>
          <h3 style={{ fontSize: 15, margin: '24px 0 4px' }}>While something is playing</h3>
          <div className="radio-list">
            {PLAYING_MODES.map((mode) => (
              <label key={mode.value}>
                <input
                  type="radio"
                  name="led-playing"
                  checked={playingMode === mode.value}
                  onChange={() => onPlayingModeChange(mode.value)}
                />
                <span>
                  {mode.label}
                  <span className="hint" style={{ display: 'block' }}>
                    {mode.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <h3 style={{ fontSize: 15, margin: '24px 0 4px' }}>The reader works these out</h3>
          <p className="hint" style={{ marginBottom: 10 }}>
            Shown even with this add-on stopped, so they are what tell you where
            a problem actually is.
          </p>
          {READER_STATES.map(row)}

          <h3 style={{ fontSize: 15, margin: '24px 0 4px' }}>These come from here</h3>
          <p className="hint" style={{ marginBottom: 10 }}>
            The reader cannot know any of these — only whether a tag was read.
          </p>
          {ADDON_STATES.map(row)}

          <p className="hint" style={{ marginTop: 14 }}>
            Slow, fast and steady are fixed. They are what keeps two states
            apart when they share a colour — a slow red is no wifi, a fast red is
            something that failed.
          </p>
        </>
      ) : null}
    </div>
  )
}
