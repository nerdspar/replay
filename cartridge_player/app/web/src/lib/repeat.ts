import type { RepeatMode } from '../types'

/** Shared by a cartridge's own setting and the household default. */
export const REPEAT_OPTIONS: { value: RepeatMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Stops at the end.' },
  { value: 'all', label: 'Repeat all', hint: 'Goes back to the start when it finishes.' },
  {
    value: 'one',
    label: 'Repeat one track',
    hint: 'Plays the same track over and over — for a lullaby, say.',
  },
]
