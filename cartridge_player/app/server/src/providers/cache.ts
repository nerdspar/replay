/** In-memory only, ~10 min TTL. Never persisted (§5.1). */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>()

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key)
    if (!hit) return undefined
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return hit.value
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs })
  }

  clear(): void {
    this.entries.clear()
  }
}
