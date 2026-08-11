import type { Store } from '../db/index.js'
import type { ProviderRegistry } from '../providers/registry.js'
import type { TargetRegistry } from '../targets/registry.js'
import type { Card, ScanEvent } from '../types.js'
import { AppError } from '../errors.js'
import { createLogger } from '../log.js'
import type { EventBus } from './events.js'
import type { PendingUidStore } from './pending.js'
import { type ReaderLight, type ReaderStatus } from './reader-light.js'
import type { PlaybackWatcher } from './playback.js'
import {
  removalActionFor,
  runFireSequence,
  runRemovalAction,
  type Sleep,
} from './fire-sequence.js'

const log = createLogger('scan')

export interface ScanHandlerDeps {
  store: Store
  providers: ProviderRegistry
  targets: TargetRegistry
  pending: PendingUidStore
  bus: EventBus
  /** Optional: the reader's status light, when one is wired up. */
  light?: ReaderLight
  /** Optional: follows what the linked player is actually doing. */
  playback?: PlaybackWatcher
  sleep?: Sleep
  now?: () => number
}

export interface ScanOutcome {
  card: Card | null
  scan: ScanEvent
}

/**
 * The single place a tag becomes an action. The WebSocket listener, the poll
 * fallback, and the per-card Test button all land here.
 */
export class ScanHandler {
  constructor(private readonly deps: ScanHandlerDeps) {}

  private get now(): number {
    return (this.deps.now ?? Date.now)()
  }

  async handleInserted(uid: string): Promise<ScanOutcome> {
    const { store, pending, bus } = this.deps
    const card = store.findCardByUid(uid)

    // A cartridge the user deliberately emptied behaves exactly like one that
    // was never set up: it offers to be filled, rather than firing nothing.
    if (!card || card.status === 'unassigned') {
      const entry = pending.set(uid)
      bus.emit({ type: 'pending', pending: entry })
      const scan = this.record(uid, card?.id ?? null, 'unassigned', null)
      log.info(`unassigned cartridge ${uid}`)
      this.deps.playback?.stop()
      this.light('new')
      return { card, scan }
    }

    // Before the launch, not after. The reader is holding a "working" state and
    // waiting to hear that anything at all received its event; without this it
    // would decide nobody had, seconds before the TV finished starting.
    this.light('busy')
    return this.fire(card)
  }

  async handleRemoved(uid: string): Promise<ScanOutcome | null> {
    const { store } = this.deps
    const card = store.findCardByUid(uid)
    // Nothing was playing from an empty cartridge, so nothing to stop.
    if (!card || card.status === 'unassigned') return null

    // Nothing is on the reader now, so there is nothing to follow.
    this.deps.playback?.stop()

    const settings = store.getSettings()
    if (removalActionFor(card.kind, settings) === 'none') {
      return { card, scan: this.record(uid, card.id, 'removed:none', null) }
    }

    try {
      const target = this.deps.targets.createFor(card.kind, settings, card)
      const action = await runRemovalAction(card.kind, settings, target)
      return { card, scan: this.record(uid, card.id, `removed:${action}`, null) }
    } catch (error) {
      return { card, scan: this.recordFailure(uid, card.id, 'removed', error) }
    }
  }

  /** Also the per-card Test button (§6.2). */
  async fire(card: Card): Promise<ScanOutcome> {
    const { store, providers, targets, sleep } = this.deps
    const settings = store.getSettings()

    try {
      const provider = providers.get(card.provider)
      const target = targets.createFor(card.kind, settings, card)
      const steps = await runFireSequence({
        card,
        settings,
        provider,
        target,
        ...(sleep ? { sleep } : {}),
      })
      log.info(`fired ${card.title} -> ${steps.join(',')}`)
      // Handed to the watcher rather than declared here. Finishing the launch
      // sequence says the deep link went out, which is not the same as anything
      // playing — the watcher reads the player and reports what is true.
      this.deps.playback?.start(card)
      return { card, scan: this.record(card.tag_uid, card.id, steps.join(','), null) }
    } catch (error) {
      this.deps.playback?.stop()
      this.light('error')
      return { card, scan: this.recordFailure(card.tag_uid, card.id, 'fire', error) }
    }
  }

  /**
   * Fire-and-forget on purpose. The light is an enhancement: awaiting it would
   * put a Home Assistant round trip between the tap and the launch, and letting
   * it reject would turn a cosmetic failure into a failed scan.
   */
  private light(state: ReaderStatus, color?: string | null): void {
    void this.deps.light?.setStatus(state, color).catch(() => undefined)
  }

  private recordFailure(
    uid: string,
    cardId: number | null,
    phase: string,
    error: unknown,
  ): ScanEvent {
    const message =
      error instanceof AppError
        ? `${error.code}: ${error.message}`
        : (error as Error)?.message ?? String(error)
    log.error(`${phase} failed for ${uid}: ${message}`)
    this.deps.bus.emit({ type: 'error', message })
    return this.record(uid, cardId, phase, message)
  }

  private record(
    uid: string,
    cardId: number | null,
    action: string | null,
    error: string | null,
  ): ScanEvent {
    const scan = this.deps.store.recordScan({
      tag_uid: uid,
      matched_card_id: cardId,
      action_taken: action,
      error,
      created_at: this.now,
    })
    const card = cardId === null ? null : this.deps.store.getCard(cardId)
    this.deps.bus.emit({ type: 'scan', scan, card })
    return scan
  }
}
