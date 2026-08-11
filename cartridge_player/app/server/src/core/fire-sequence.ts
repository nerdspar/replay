import type {
  Card,
  CardKind,
  MusicRemovalAction,
  Provider,
  RemovalAction,
  Settings,
  Target,
} from '../types.js'

/** The abstract steps a fire can take. Same vocabulary for every target (§6.2). */
export type FireStep = 'home' | 'launch' | 'select'

export type Sleep = (ms: number) => Promise<void>

export const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms))

export interface FireSequenceInput {
  card: Card
  settings: Settings
  provider: Provider
  target: Target
  sleep?: Sleep
}

/**
 * §6.2 — device-agnostic. Every step is individually skippable via settings, and
 * the whole sequence is re-runnable from the UI as a per-card Test button.
 */
export async function runFireSequence({
  card,
  settings,
  provider,
  target,
  sleep = realSleep,
}: FireSequenceInput): Promise<FireStep[]> {
  const steps: FireStep[] = []

  /*
    Music is one call and no theatre.

    Both settings that shape the video sequence exist to work around a TV: Home
    dismisses a screensaver that would otherwise swallow the deep link, and
    Select picks a stream on the detail page the link lands on. A speaker has
    neither a screensaver nor a detail page — `play_media` starts the music. So
    this is not "the video sequence with steps disabled", which would leave the
    delays sitting in the path for no reason.
  */
  if (card.kind === 'music') {
    await target.launch(provider.buildLaunch(card, settings))
    return ['launch']
  }

  if (settings.home_first_enabled) {
    // A deep link fired at an idle TV opens the app *behind* the screensaver
    // without dismissing it. Someone tapping a cartridge is almost always
    // walking up to an idle TV, so this is the normal case, not an edge case.
    await target.sendKey('home')
    steps.push('home')
    await sleep(settings.home_delay_ms)
  }

  await target.launch(provider.buildLaunch(card, settings))
  steps.push('launch')

  if (settings.autoplay_enabled) {
    // Stremio's deep link lands on the detail page, not playback, because a
    // stream source still has to be selected. This press picks the first one.
    await sleep(settings.autoplay_delay_ms)
    await target.sendKey('select')
    steps.push('select')
  }

  return steps
}

/**
 * Which lift-off setting governs this cartridge.
 *
 * They are separate settings rather than one, because the vocabularies do not
 * overlap: Back and Home and power-off are television, and a speaker can only
 * keep playing, pause, or stop. One shared list would offer every user four
 * choices that do nothing on half their cartridges.
 */
export function removalActionFor(
  kind: CardKind,
  settings: Settings,
): RemovalAction | MusicRemovalAction {
  return kind === 'music' ? settings.music_removal_action : settings.removal_action
}

/** §6.4 — driven entirely by the lift-off setting for the cartridge's kind. */
export async function runRemovalAction(
  kind: CardKind,
  settings: Settings,
  target: Target,
): Promise<string> {
  if (kind === 'music') {
    switch (settings.music_removal_action) {
      case 'pause':
        await target.pause()
        return 'pause'
      case 'stop':
        await target.stop()
        return 'stop'
      case 'none':
      default:
        return 'none'
    }
  }

  switch (settings.removal_action) {
    case 'pause':
      await target.pause()
      return 'pause'
    case 'back':
      await target.sendKey('back')
      return 'back'
    case 'home':
      await target.sendKey('home')
      return 'home'
    case 'off':
      await target.turnOff()
      return 'off'
    case 'none':
    default:
      return 'none'
  }
}
