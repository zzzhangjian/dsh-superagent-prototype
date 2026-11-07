/** Registry of installed Feature kinds, their configured instances, and the configuration each one validates. */
import { HealthBoard, type HealthEntry } from '../infra/health.ts'
import type { Settings } from '../policy.ts'
import type { Feature, FeatureInstance } from './kind.ts'


/**
 * Manages registered Feature plugins, validates their instance configuration, and lists the instances the panel edits.
 * Claims each registered Feature's health entries on HealthBoard and mediates access to a Feature's kind and configuration for Settings and Runtime.
 */
export class FeatureRegistry {
  private readonly kinds = new Map<string, Feature>()
  private readonly health = new Map<string, HealthEntry>()
  constructor(private readonly settings: () => Settings, private readonly board: Pick<HealthBoard, 'claim'> = new HealthBoard(),
    private readonly registered: (feature: Feature) => () => void = () => () => {}) {}

  /** Registers a Feature, claims its health entries on HealthBoard (rejecting `sync:` prefixes owned by Settings), and returns an unregister disposer. */
  register<C extends Record<string, unknown>>(feature: Feature<C>): () => void {
    if (this.kinds.has(feature.id)) throw new Error(`Feature kind already registered: ${feature.id}`)
    const refused = (name: string) => new Error(`Feature kind ${feature.id} declares the health entry ${name}, which another part reports`)
    const synced = feature.health.find(name => name.startsWith('sync:'))
    if (synced) throw refused(synced)
    const entries = new Map<string, HealthEntry>()
    const release = () => { for (const [name, entry] of entries) { entry.release(); this.health.delete(name) } }
    for (const name of feature.health) {
      try { entries.set(name, this.board.claim(name, { state: 'starting', detail: '' })) }
      catch { release(); throw refused(name) }
    }
    for (const [name, entry] of entries) this.health.set(name, entry)
    this.kinds.set(feature.id, feature as unknown as Feature)
    const unregistered = this.registered(feature as unknown as Feature)
    return () => { this.kinds.delete(feature.id); release(); unregistered() }
  }
  /**
   * Returns the active health entries for `names`. A Feature writes through the entries it received when built,
   * so reports sent after that registration ended do nothing even if the feature registers again.
   */
  healthEntries(names: readonly string[]): Map<string, HealthEntry> {
    return new Map(names.flatMap(name => { const entry = this.health.get(name); return entry ? [[name, entry] as const] : [] }))
  }
  kind(id: string): Feature | undefined { return this.kinds.get(id) }
  /** Every registered feature's instance ordered by ID, followed by stored instances whose kind is not installed (with their config kept as stored). */
  instances(settings = this.settings()): (FeatureInstance & { installed: boolean })[] {
    const installed = [...this.kinds.values()].sort((a, b) => a.id.localeCompare(b.id)).map(feature => ({ ...this.resolve(feature, settings.features[feature.id]), installed: true }))
    const orphaned = Object.entries(settings.features).filter(([id]) => !this.kinds.has(id)).map(([id, stored]) => ({ id, enabled: stored.enabled, config: stored.config, installed: false }))
    return [...installed, ...orphaned]
  }
  instance<C extends Record<string, unknown>>(id: string, settings = this.settings()): FeatureInstance<C> | undefined {
    const feature = this.kinds.get(id)
    return feature ? this.resolve(feature, settings.features[id]) as FeatureInstance<C> : undefined
  }
  validate(id: string, value: { enabled: boolean; config: unknown }): { enabled: boolean; config: Record<string, unknown> } {
    const feature = this.kinds.get(id)
    if (!feature) throw new Error(`Feature kind not installed: ${id}`)
    return { enabled: value.enabled, config: feature.schema.parse(value.config) }
  }
  /** Falls back to schema defaults and disables the instance when stored configuration fails validation. */
  private resolve(feature: Feature, stored: { enabled: boolean; config: Record<string, unknown> } | undefined): FeatureInstance {
    const parsed = feature.schema.safeParse(stored?.config ?? {})
    return { id: feature.id, enabled: parsed.success && (stored?.enabled ?? true), config: parsed.success ? parsed.data : feature.schema.parse({}) }
  }
}
