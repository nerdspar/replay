import { normalizeUid } from './uid.js'

export interface PendingUid {
  uid: string
  seen_at: number
}

export const PENDING_TTL_MS = 5 * 60 * 1000

/**
 * Holds the most recent unassigned UID so a client that was backgrounded — iOS
 * Safari kills SSE connections when a tab loses focus — can recover it on
 * reconnect via `GET api/pending` (§8.2).
 */
export class PendingUidStore {
  private current: PendingUid | null = null

  constructor(
    private readonly ttlMs: number = PENDING_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  set(uid: string): PendingUid {
    this.current = { uid, seen_at: this.now() }
    return this.current
  }

  get(): PendingUid | null {
    if (this.current === null) return null
    if (this.now() - this.current.seen_at > this.ttlMs) {
      this.current = null
      return null
    }
    return this.current
  }

  /**
   * Clearing is UID-scoped so a stale clear can't drop a newer scan. Compared on
   * the normalised form, since the client echoes back whatever it was shown.
   */
  clear(uid?: string): void {
    if (uid === undefined) {
      this.current = null
      return
    }
    if (this.current && normalizeUid(this.current.uid) === normalizeUid(uid)) {
      this.current = null
    }
  }
}
