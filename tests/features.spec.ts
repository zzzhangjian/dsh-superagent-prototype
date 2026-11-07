/** Feature registry lifecycle, health claiming, release-chain validation, and settings-block integration tests. */
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SettingsSchema } from '../src/policy.ts'
import { UserError } from '../src/core/index.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { FeatureRegistry } from '../src/features/registry.ts'
import { ReleaseConfigSchema, releaseKind } from '../src/features/release.ts'
import type { Feature } from '../src/features/kind.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })

const probe: Feature<{ interval: number }> = {
  id: 'probe', title: { zh: '探针', en: 'Probe' }, description: { zh: '', en: '' }, health: [],
  schema: z.object({ interval: z.number().int().min(1).default(5) }).strict(),
  fields: [{ key: 'interval', type: 'number', min: 1, max: 60, label: { zh: '间隔', en: 'Interval' } }],
}

describe('Feature registry', () => {
  it('lists every installed kind with defaults, in id order, followed by stored instances whose kind is not installed', () => {
    const settings = SettingsSchema.parse({ features: { probe: { enabled: false, config: { interval: 9 } }, retired: { enabled: true, config: { x: 1 } } } })
    const features = new FeatureRegistry(() => settings)
    features.register(probe); features.register(releaseKind)
    expect(features.instances()).toEqual([
      { id: 'probe', enabled: false, config: { interval: 9 }, installed: true },
      { id: 'release', enabled: true, config: ReleaseConfigSchema.parse({}), installed: true },
      { id: 'retired', enabled: true, config: { x: 1 }, installed: false },
    ])
    expect(features.instance('probe')).toEqual({ id: 'probe', enabled: false, config: { interval: 9 } })
    expect(features.instance('release')).toEqual({ id: 'release', enabled: true, config: ReleaseConfigSchema.parse({}) })
    expect(features.instance('retired')).toBeUndefined()
  })
  it('disables an instance whose stored config does not validate and falls back to the schema defaults', () => {
    const settings = SettingsSchema.parse({ features: { probe: { enabled: true, config: { interval: 0 } } } })
    const features = new FeatureRegistry(() => settings)
    features.register(probe)
    expect(features.instances()[0]).toEqual({ id: 'probe', enabled: false, config: { interval: 5 }, installed: true })
  })
  it('validates submitted instances with the kind schema and refuses kinds that are not installed', () => {
    const features = new FeatureRegistry(() => SettingsSchema.parse({}))
    features.register(probe)
    expect(features.validate('probe', { enabled: true, config: {} })).toEqual({ enabled: true, config: { interval: 5 } })
    expect(() => features.validate('probe', { enabled: true, config: { interval: 0 } })).toThrow()
    expect(() => features.validate('missing', { enabled: true, config: {} })).toThrow('not installed')
  })
  it('refuses a second registration of one kind and forgets a kind after its disposer runs', () => {
    const features = new FeatureRegistry(() => SettingsSchema.parse({}))
    const dispose = features.register(probe)
    expect(() => features.register(probe)).toThrow('already registered')
    expect(features.kind('probe')?.id).toBe('probe')
    dispose()
    expect(features.instance('probe')).toBeUndefined()
    expect(features.instances()).toEqual([])
  })
  it('claims each kind\'s health entries, refuses entries another part reports or the sync prefix, and releases them at unregister', () => {
    const board = new HealthBoard()
    // Pre-claim built-in health entries; sync:* entries are reserved for settings sync.
    for (const name of ['runtime', 'reply']) board.claim(name)
    const features = new FeatureRegistry(() => SettingsSchema.parse({}), board)
    const unregister = features.register({ ...probe, health: ['probe'] })
    for (const name of ['runtime', 'reply', 'probe', 'sync:github']) {
      expect(() => features.register({ ...probe, id: 'other', health: ['other', name] })).toThrow(name)
    }
    // A kind that was refused stays out of the registry and holds none of its own entries.
    expect(features.kind('other')).toBeUndefined()
    expect(board.all.probe).toEqual({ state: 'starting', detail: '' })
    expect([...features.healthEntries(['probe', 'missing']).keys()]).toEqual(['probe'])
    unregister()
    expect(board.all.probe).toBeUndefined()
    features.register({ ...probe, id: 'later', health: ['probe'] })
    expect(board.all.probe).toEqual({ state: 'starting', detail: '' })
  })
})

describe('Release Feature', () => {
  it('accepts the configured chain in order and keeps the branch names the deployment chose', () => {
    expect(ReleaseConfigSchema.parse({})).toEqual({ environments: [
      { name: 'development', branch: 'develop', auto: true, observe: { minutes: 30, fails: 3 } },
      { name: 'production', branch: 'main', auto: false, observe: { minutes: 60, fails: 1 } },
    ] })
    expect(ReleaseConfigSchema.parse({ environments: [{ name: 'staging', branch: 'release/x' }, { name: 'production', branch: 'trunk' }] }))
      .toEqual({ environments: [
        { name: 'staging', branch: 'release/x', auto: false, observe: { minutes: 30, fails: 3 } },
        { name: 'production', branch: 'trunk', auto: false, observe: { minutes: 30, fails: 3 } },
      ] })
    // The chain's order is the deployment's, not a branch name the code assumes.
    expect(releaseKind.deployer?.environments.map(environment => environment.branch)).toEqual(['develop', 'main'])
    expect(releaseKind.schema.parse({ environments: [{ name: 'production', branch: 'main' }, { name: 'development', branch: 'develop' }] })
      .environments.map(environment => environment.name)).toEqual(['production', 'development'])
  })
  it('refuses an empty chain or a branch that is not a git ref name', () => {
    expect(() => ReleaseConfigSchema.parse({ environments: [] })).toThrow()
    for (const branch of ['', ' ', 'a..b', '-main', '/main', 'main/', 'main branch']) {
      expect(() => ReleaseConfigSchema.parse({ environments: [{ name: 'development', branch }] }), branch).toThrow()
    }
    // A branch with characters git refuses says so; the rest read as a branch name.
    expect(() => ReleaseConfigSchema.parse({ environments: [{ name: 'development', branch: 'a..b' }] })).toThrow('A git branch name')
    expect(() => ReleaseConfigSchema.parse({ environments: [{ name: 'development', branch: '' }] })).toThrow('A branch name')
    expect(() => ReleaseConfigSchema.parse({ environments: [{ name: '', branch: 'develop' }] })).toThrow()
    expect(() => ReleaseConfigSchema.parse({ environments: [{ name: 'development', branch: 'develop', observe: { minutes: 0, fails: 3 } }] })).toThrow()
    expect(() => ReleaseConfigSchema.parse({ environments: [{ name: 'development', branch: 'develop', extra: 1 }] })).toThrow()
  })
})

describe('Feature settings block', () => {
  it('reads and saves a Feature block, merging it into settings without changing the Policy version', async () => {
    h = await startRuntime()
    const { settings, store, features } = h.runtime
    features.register(releaseKind)
    expect(settings.block('feature:release')).toEqual({ block: 'feature:release', revision: 0,
      value: { enabled: true, config: ReleaseConfigSchema.parse({}) } })
    expect(() => settings.block('feature:ghost')).toThrow(new UserError('unknownBlock', { block: 'feature:ghost' }))
    const config = { environments: [
      { name: 'development', branch: 'dev', auto: true, observe: { minutes: 10, fails: 2 } },
      { name: 'production', branch: 'main', auto: false, observe: { minutes: 60, fails: 1 } },
    ] }
    const saved = await settings.save('feature:release', { enabled: false, config }, 0, 'panel')
    expect(saved).toMatchObject({ saved: true, revision: 1, policy_changed: false, restarting: false })
    expect(store.settings().features.release).toEqual({ enabled: false, config })
    expect(settings.block('feature:release').value).toEqual({ enabled: false, config })
    // Settings keep a Feature's block across a save that does not mention it, and reload it unchanged.
    expect(SettingsSchema.parse(JSON.parse(JSON.stringify(store.settings()))).features.release).toEqual({ enabled: false, config })
  })
  it('refuses a Feature block of a kind that is not installed, a config its schema rejects, and a tool changing it', async () => {
    h = await startRuntime()
    const { settings, store, features } = h.runtime
    features.register(releaseKind)
    await expect(settings.save('feature:ghost', { enabled: true, config: {} }, 0, 'panel'))
      .rejects.toThrow(new UserError('sourceNotInstalled', { source: 'ghost' }))
    await expect(settings.save('feature:release', { enabled: true, config: { environments: [] } }, 0, 'panel')).rejects.toThrow()
    const config = { environments: [{ name: 'development', branch: 'develop', auto: true, observe: { minutes: 10, fails: 2 } }] }
    await expect(settings.save('feature:release', { enabled: true, config }, 0, 'tool'))
      .rejects.toThrow(new UserError('panelOnlyAccounts'))
    // A refused save writes nothing.
    expect(store.settings().features).toEqual({})
    expect(store.blockRevision('feature:release')).toBe(0)
  })
})
