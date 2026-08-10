import type { Card, ScanEvent } from '../types.js'
import type { PendingUid } from './pending.js'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export type AppEvent =
  /** An unassigned cartridge is waiting to be named (§8.5). */
  | { type: 'pending'; pending: PendingUid | null }
  | { type: 'scan'; scan: ScanEvent; card: Card | null }
  /** Home Assistant WebSocket state, surfaced in the UI (§3.2, §8.6). */
  | { type: 'connection'; state: ConnectionState; detail?: string }
  /** The library changed — clients refetch. */
  | { type: 'cards' }
  | { type: 'error'; message: string }

export type AppEventListener = (event: AppEvent) => void

export class EventBus {
  private readonly listeners = new Set<AppEventListener>()

  subscribe(listener: AppEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: AppEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch {
        // A broken SSE client must never take down a scan.
      }
    }
  }

  get size(): number {
    return this.listeners.size
  }
}
