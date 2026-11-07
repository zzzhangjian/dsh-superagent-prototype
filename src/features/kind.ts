/** Feature plugin contract: the declarative roles, stages, artifacts, gates, panels, and release chain that describe one Feature kind. */
import type { z } from 'zod'
import type { RoleModel } from '../policy.ts'
import type { EnvironmentInput, FieldSpec, Localized, VariableSpec } from '../sources/kind.ts'

export type { FieldSpec, Localized } from '../sources/kind.ts'
/** Ticket identity that an artifact path or environment value may depend on, kept free of the core model so the contract stays declarative. */
export interface TicketRef { id: string }
/** A role a Feature's stages hand work to; `personaPart` names the prompt part describing it and `handoff` how it returns work. */
export interface RoleSpec {
  id: string
  /** Built-in prompt part carrying this role's persona. */
  personaPart: string
  tools: string[]
  skills: string[]
  /** Model this role runs on; absent means the deployment default. */
  model?: RoleModel
  /** How the role returns work: a ready report, a pull request, or a report with no delivery. */
  handoff: 'ready' | 'pr' | 'report'
}
/** One stage of a Feature's pipeline: the role that owns it, the conditions that admit and release work, and how often it may repeat. */
export interface StageSpec {
  id: string
  role: string
  /** Conditions that admit a ticket into this stage. */
  entry: string[]
  /** Conditions that let a ticket leave this stage. */
  exit: string[]
  /** Artifact kinds this stage produces. */
  produces: string[]
  /** Most repeats before the stage is abandoned; absent means a single pass. */
  loops?: number
}
/** A ticket-scoped file a Feature produces: validated by `schema`, rendered from `template`, and stored in `home`. */
export interface ArtifactSpec<C = unknown> {
  kind: string
  /** Validates the artifact's content and fills defaults. */
  schema: z.ZodType<C>
  fields: FieldSpec[]
  /** Template name or repository path the artifact is rendered from. */
  template: string
  /** Whether the file belongs to the ticket's repository or to its state directory. */
  home: 'repo' | 'state'
  /** Path of the file under `home`, given the validated value and the ticket. */
  path?(value: C, ticket: TicketRef): string
}
/** A check a Feature requires before work advances, together with the evidence that settles it. */
export interface GateSpec {
  id: string
  /** Stages whose exit this gate guards. */
  stages: string[]
  kind: 'ci' | 'coverage' | 'lint' | 'typecheck' | 'e2e' | 'ac-map' | 'diff-scope' | 'constraints' | 'panel-converged' | 'approval-valid' | 'custom'
  /** Where the gate reads its evidence. */
  evidenceSource: 'github-checks' | 'artifact' | 'command'
  /** Instruction for the role that must remediate a failing gate. */
  remediate?: Localized
}
/** A multi-round review panel of roles whose verdict gates a stage. */
export interface PanelSpec {
  id: string
  /** Role IDs that review. */
  members: string[]
  rounds: number
  /** Artifact kind the panel's verdict is recorded in. */
  artifact: string
  converge: 'unanimous' | 'chair'
}
/** One environment a release passes through in order, on its own branch, with the observation window that ends it. */
export interface DeployerEnvironment {
  name: string
  branch: string
  /** True when reaching `branch` starts the environment without a person, false when a person confirms. */
  auto: boolean
  observe: { minutes: number; fails: number }
}
/** Ordered release chain of a configured Feature; every branch comes from its configuration, so no branch name is assumed. */
export interface DeployerSpec { environments: DeployerEnvironment[] }
/** Pluggable feature kind descriptor registered with FeatureRegistry; every part is declarative and nothing here executes work. */
export interface Feature<C extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable ID; a default instance with the same ID exists when none is stored. */
  id: string
  title: Localized
  description: Localized
  /** Validates stored and submitted configuration and fills defaults. */
  schema: z.ZodType<C>
  fields: FieldSpec[]
  /** Health entry names owned by this feature under `health[...]`; no other feature or core loop may report them. */
  health: string[]
  roles?: RoleSpec[]
  stages?: StageSpec[]
  artifacts?: ArtifactSpec[]
  gates?: GateSpec[]
  panels?: PanelSpec[]
  /** Release chain of the environments work passes through; absent for features that release nothing. */
  deployer?: DeployerSpec
  /** Variables the feature registers with the execution environment and how their values are computed. */
  environment?: { variables: readonly VariableSpec[]; values(input: EnvironmentInput<C>): Record<string, string> }
}

export interface FeatureInstance<C extends Record<string, unknown> = Record<string, unknown>> { id: string; enabled: boolean; config: C }
