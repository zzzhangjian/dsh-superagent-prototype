/** The Release Feature kind: the ordered environments a change passes through, on the branches the deployment configures. */
import { z } from 'zod'
import type { DeployerSpec, Feature } from './kind.ts'

const BranchSchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._/-]+$/, 'A branch name')
  .refine(branch => !branch.startsWith('-') && !branch.startsWith('/') && !branch.endsWith('/') && !branch.includes('..'), 'A git branch name')
const ObserveSchema = z.object({ minutes: z.number().int().min(1).max(1440).default(30), fails: z.number().int().min(0).max(10).default(3) }).strict()
const EnvironmentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  branch: BranchSchema,
  // A row of the panel's form submits text, so a stored `auto` also reads as `'true'` or `'false'`.
  auto: z.union([z.boolean(), z.enum(['true', 'false']).transform(auto => auto === 'true')]).default(false),
  observe: ObserveSchema.default({ minutes: 30, fails: 3 }),
}).strict()
/** Ordered release chain: the first environment is the development one, the last the production one, and every branch is a setting. */
export const ReleaseConfigSchema = z.object({ environments: z.array(EnvironmentSchema).min(1).default(defaultEnvironments) }).strict()
export type ReleaseConfig = z.infer<typeof ReleaseConfigSchema>

/** The chain a Feature releases through until the deployment configures its own: `develop` starts on its own, `main` waits for a person. */
function defaultEnvironments(): DeployerSpec['environments'] {
  return [
    { name: 'development', branch: 'develop', auto: true, observe: { minutes: 30, fails: 3 } },
    { name: 'production', branch: 'main', auto: false, observe: { minutes: 60, fails: 1 } },
  ]
}

export const releaseKind: Feature<ReleaseConfig> = {
  id: 'release',
  title: { zh: '发布', en: 'Release' },
  description: { zh: '每次改动按顺序经过的环境，以及每个环境所在的分支和观察窗口。', en: 'The environments each change passes through in order, with the branch and observation window of each.' },
  schema: ReleaseConfigSchema,
  fields: [
    { key: 'environments', type: 'rows', label: { zh: '发布环境', en: 'Environments' },
      hint: { zh: '按顺序经过的环境：第一行是开发分支，最后一行是生产分支，分支名由部署自己决定。“自动”表示分支上出现改动就开始，否则等人确认；观察窗口结束时没到失败上限就算通过，窗口按配置保存。', en: 'The environments passed through in order: the first row is the development branch and the last the production branch, and the deployment picks the branch names. "Automatically" starts as soon as a change is on the branch, otherwise a person confirms; an environment passes when the observation window ends under its failure limit, and the window is kept as configured.' },
      columns: [
        { key: 'name', type: 'text', label: { zh: '环境', en: 'Environment' } },
        { key: 'branch', type: 'text', label: { zh: '分支', en: 'Branch' }, pattern: '[A-Za-z0-9._/-]+' },
        { key: 'auto', type: 'select', label: { zh: '进入', en: 'Enter' }, options: [
          { value: 'true', label: { zh: '自动', en: 'Automatically' } },
          { value: 'false', label: { zh: '等人确认', en: 'On confirmation' } },
        ] },
      ] },
  ],
  health: [],
  deployer: { environments: defaultEnvironments() },
}
