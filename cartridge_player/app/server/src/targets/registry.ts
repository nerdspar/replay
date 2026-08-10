import type { Settings, Target } from '../types.js'
import { UnknownTargetError } from '../errors.js'

/**
 * Targets are built per fire from current settings — entity ids change while the
 * add-on is running, so nothing here is cached.
 */
export type TargetFactory = (settings: Settings) => Target

export class TargetRegistry {
  private readonly factories = new Map<string, TargetFactory>()

  register(id: string, factory: TargetFactory): this {
    this.factories.set(id, factory)
    return this
  }

  /** Resolved by `settings.target_type`. Call sites never branch on a target name. */
  create(settings: Settings): Target {
    const factory = this.factories.get(settings.target_type)
    if (!factory) throw new UnknownTargetError(settings.target_type)
    return factory(settings)
  }

  has(id: string): boolean {
    return this.factories.has(id)
  }

  ids(): string[] {
    return [...this.factories.keys()]
  }
}
