import type { Card, Provider, Settings, Target } from '../types.js'

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

/** §6.4 — driven entirely by `settings.removal_action`. */
export async function runRemovalAction(
  settings: Settings,
  target: Target,
): Promise<string> {
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
    case 'none':
    default:
      return 'none'
  }
}
