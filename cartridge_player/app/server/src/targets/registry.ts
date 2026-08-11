import type { Card, CardKind, Settings, Target } from '../types.js'
import { UnknownTargetError } from '../errors.js'

/**
 * Targets are built per fire from current settings — entity ids change while the
 * add-on is running, so nothing here is cached.
 */
export type TargetFactory = (settings: Settings, card: Card | null) => Target

/**
 * The target for a music cartridge.
 *
 * Video is chosen by `settings.target_type`, because a household might drive a
 * Chromecast, a Fire TV, or something else. Audio has exactly one route today,
 * so it is named here rather than adding a settings column nobody would change.
 * The moment a second music target exists, this becomes `music_target_type`
 * alongside `target_type` — the call sites already ask by kind, so only this
 * line moves.
 */
const MUSIC_TARGET_ID = 'music_assistant'

export class TargetRegistry {
  private readonly factories = new Map<string, TargetFactory>()

  register(id: string, factory: TargetFactory): this {
    this.factories.set(id, factory)
    return this
  }

  /**
   * Resolved by the CARTRIDGE, not by a global setting: one reader serves both
   * a TV and a speaker, so two tags scanned a second apart reach different
   * devices. Call sites never branch on a target name.
   */
  createFor(kind: CardKind, settings: Settings, card: Card | null = null): Target {
    const id = kind === 'music' ? MUSIC_TARGET_ID : settings.target_type
    const factory = this.factories.get(id)
    if (!factory) throw new UnknownTargetError(id)
    // The card is passed because a cartridge may name its own device — an album
    // that always plays in the kitchen. Targets that have nothing per-cartridge
    // to configure simply ignore it.
    return factory(settings, card)
  }

  has(id: string): boolean {
    return this.factories.has(id)
  }

  ids(): string[] {
    return [...this.factories.keys()]
  }
}
