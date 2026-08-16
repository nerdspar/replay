import { describe, expect, it } from 'vitest'
import { readDevice } from './reader-identity.js'

/**
 * The one field the whole multi-reader design rests on.
 *
 * Every reader fires the same event type, so this string is the only thing that
 * can tell a tap in one room from a tap in another. It has to survive a reader
 * that predates it, because a household will not reflash both on the same day.
 */
describe('which reader a scan came from', () => {
  it('reads the name the firmware sends', () => {
    expect(readDevice({ uid: '04-01', device: 'replay-cartridge-reader' })).toBe(
      'replay-cartridge-reader',
    )
  })

  it('trims it, since it arrives as a YAML scalar', () => {
    expect(readDevice({ device: '  lounge-reader  ' })).toBe('lounge-reader')
  })

  it('says null for firmware that predates the field', () => {
    // Not an error. That reader still works and is the only one there is.
    expect(readDevice({ uid: '04-01' })).toBeNull()
  })

  it('says null rather than passing junk on', () => {
    expect(readDevice({ device: '' })).toBeNull()
    expect(readDevice({ device: '   ' })).toBeNull()
    expect(readDevice({ device: 42 })).toBeNull()
    expect(readDevice({ device: null })).toBeNull()
  })
})
