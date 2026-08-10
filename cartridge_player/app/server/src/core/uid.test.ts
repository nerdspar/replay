import { describe, expect, it } from 'vitest'
import { normalizeUid } from './uid.js'
import { memoryStore } from '../test/helpers.js'
import type { CardInput } from '../types.js'

const base: Omit<CardInput, 'tag_uid'> = {
  provider: 'stremio',
  content_type: 'movie',
  external_id: 'tt0083658',
  title: 'Blade Runner',
  year: '1982',
  poster_url: null,
  season: null,
  episode: null,
  label: null,
}

describe('normalizeUid', () => {
  it('strips separators and uppercases', () => {
    expect(normalizeUid('04-a3-b8-8b-32-02-89')).toBe('04A3B88B320289')
    expect(normalizeUid('04:A3:B8:8B:32:02:89')).toBe('04A3B88B320289')
    expect(normalizeUid('04 a3 b8 8b 32 02 89')).toBe('04A3B88B320289')
    expect(normalizeUid('04a3b88b320289')).toBe('04A3B88B320289')
  })
})

describe('UID matching in the store (§10)', () => {
  it('matches a card however the firmware happens to format the UID', () => {
    const store = memoryStore()
    store.createCard({ ...base, tag_uid: '04-A3-B8-8B-32-02-89' }, 1)

    for (const variant of [
      '04-A3-B8-8B-32-02-89',
      '04a3b88b320289',
      '04:a3:b8:8b:32:02:89',
      '04 A3 B8 8B 32 02 89',
      '04.a3.b8.8b.32.02.89',
    ]) {
      expect(store.findCardByUid(variant)?.title, variant).toBe('Blade Runner')
    }
    store.close()
  })

  it('stores the UID exactly as reported', () => {
    const store = memoryStore()
    store.createCard({ ...base, tag_uid: '04-A3-B8-8B-32-02-89' }, 1)
    expect(store.findCardByUid('04a3b88b320289')?.tag_uid).toBe('04-A3-B8-8B-32-02-89')
    store.close()
  })

  it('refuses to store one physical tag twice under different formatting', () => {
    const store = memoryStore()
    store.createCard({ ...base, tag_uid: '04-A3-B8-8B-32-02-89' }, 1)
    expect(() =>
      store.createCard({ ...base, tag_uid: '04a3b88b320289', title: 'Other' }, 2),
    ).toThrow()
    store.close()
  })

  it('does not match a different tag', () => {
    const store = memoryStore()
    store.createCard({ ...base, tag_uid: '04-A3-B8-8B-32-02-89' }, 1)
    expect(store.findCardByUid('04-A3-B8-8B-32-02-88')).toBeNull()
    store.close()
  })
})
