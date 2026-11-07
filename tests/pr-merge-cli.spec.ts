/**
 * Tests for `scripts/gh-agent-pr-merge`: a fake `gh` in a temporary directory records its argv and
 * reports a chosen exit status, so the contract, the refusals before any call, and the delegation
 * are checked without a network.
 */
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'gh-agent-pr-merge')
const SHA = '0123456789abcdef0123456789abcdef01234567'

let root: string
let fakeDir: string
let fakeGh: string

/** The argv lines the fake gh recorded, or undefined when it never ran. */
function recorded(): string[] | undefined {
  const path = join(root, 'gh.args')
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : undefined
}

const invoked = (): boolean => existsSync(join(root, 'gh.args'))

/** Run the CLI with the fake gh selected through the override; `status` is the fake's exit code. */
function run(args: string[], options: { status?: number; env?: NodeJS.ProcessEnv; path?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GH_AGENT_PR_MERGE_GH: fakeGh,
    FAKE_GH_LOG: join(root, 'gh'),
    FAKE_GH_STATUS: String(options.status ?? 0),
    ...options.env,
  }
  if (options.path) env.PATH = options.path
  return new Promise(resolve => execFile(SCRIPT, args, { env, timeout: 20_000 },
    (error, stdout, stderr) => resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr })))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pr merge cli '))
  fakeDir = join(root, 'bin')
  fakeGh = join(fakeDir, 'gh')
  mkdirSync(fakeDir, { recursive: true })
  // The fake records every word as its own line, its inherited GH_CONFIG_DIR, and then answers like gh.
  writeFileSync(fakeGh, `#!/bin/sh
: > "$FAKE_GH_LOG.args"
for word in "$@"; do printf '%s\\n' "$word" >> "$FAKE_GH_LOG.args"; done
printf '%s\\n' "\${GH_CONFIG_DIR-<unset>}" > "$FAKE_GH_LOG.env"
printf 'fake gh stdout\\n'
printf 'fake gh stderr\\n' >&2
exit "\${FAKE_GH_STATUS:-0}"
`, { mode: 0o755 })
  chmodSync(fakeGh, 0o755)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('enable form forwards exactly the gh pr merge argv, head commit unchanged', async () => {
  const result = await run(['pr', 'merge', '42', '--auto', '--merge', '--match-head-commit', SHA, '--repo', 'acme/widgets'])
  expect(result).toMatchObject({ code: 0, stdout: 'fake gh stdout\n', stderr: 'fake gh stderr\n' })
  expect(recorded()).toEqual(['pr', 'merge', '42', '--auto', '--merge', '--match-head-commit', SHA, '--repo', 'acme/widgets'])
})

it('enable form forwards a head commit spelled in uppercase hex unchanged', async () => {
  const upper = SHA.toUpperCase()
  expect(await run(['pr', 'merge', '7', '--auto', '--merge', '--match-head-commit', upper, '--repo', 'acme/widgets']))
    .toMatchObject({ code: 0 })
  expect(recorded()).toEqual(['pr', 'merge', '7', '--auto', '--merge', '--match-head-commit', upper, '--repo', 'acme/widgets'])
})

it('disable form forwards exactly pr merge <n> --disable-auto --repo <r>', async () => {
  const result = await run(['pr', 'merge', '42', '--disable-auto', '--repo', 'acme/widgets'])
  expect(result).toMatchObject({ code: 0, stdout: 'fake gh stdout\n' })
  expect(recorded()).toEqual(['pr', 'merge', '42', '--disable-auto', '--repo', 'acme/widgets'])
})

it('accepts the --option=value spelling and still forwards the canonical argv', async () => {
  expect(await run(['pr', 'merge', '9', '--auto', '--merge', `--match-head-commit=${SHA}`, '--repo=acme/widgets']))
    .toMatchObject({ code: 0 })
  expect(recorded()).toEqual(['pr', 'merge', '9', '--auto', '--merge', '--match-head-commit', SHA, '--repo', 'acme/widgets'])
})

it('propagates the exit status and both streams of gh', async () => {
  expect(await run(['pr', 'merge', '42', '--disable-auto', '--repo', 'acme/widgets'], { status: 7 }))
    .toMatchObject({ code: 7, stdout: 'fake gh stdout\n', stderr: 'fake gh stderr\n' })
})

it('honours the inherited GH_CONFIG_DIR and resolves gh from PATH without the override', async () => {
  const result = await run(['pr', 'merge', '42', '--disable-auto', '--repo', 'acme/widgets'],
    { env: { GH_AGENT_PR_MERGE_GH: '', GH_CONFIG_DIR: join(root, 'gh config') },
      path: `${fakeDir}:${process.env.PATH ?? ''}` })
  expect(result).toMatchObject({ code: 0 })
  expect(readFileSync(join(root, 'gh.env'), 'utf8')).toBe(`${join(root, 'gh config')}\n`)
  const fromPath = await new Promise<{ code: number; stdout: string }>(resolve => execFile(SCRIPT,
    ['pr', 'merge', '43', '--disable-auto', '--repo', 'acme/widgets'],
    { env: { ...process.env, GH_AGENT_PR_MERGE_GH: '', GH_CONFIG_DIR: '', FAKE_GH_LOG: join(root, 'path'),
      FAKE_GH_STATUS: '0', PATH: `${fakeDir}:${process.env.PATH ?? ''}` }, timeout: 20_000 },
    (error, stdout) => resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout })))
  expect(fromPath).toMatchObject({ code: 0, stdout: 'fake gh stdout\n' })
  expect(readFileSync(join(root, 'path.args'), 'utf8').trim().split('\n')).toEqual(['pr', 'merge', '43', '--disable-auto', '--repo', 'acme/widgets'])
})

it('refuses a missing gh with a clear message rather than guessing', async () => {
  const result = await run(['pr', 'merge', '42', '--disable-auto', '--repo', 'acme/widgets'],
    { env: { GH_AGENT_PR_MERGE_GH: join(root, 'missing', 'gh') } })
  expect(result.code).toBe(1)
  expect(result.stderr).toContain('not executable')
  expect(invoked()).toBe(false)
})

it.each([
  ['a subcommand other than pr merge', ['pr', 'review', '42', '--disable-auto', '--repo', 'acme/widgets'], '`pr merge`'],
  ['only pr', ['pr', 'merge'], '<number> must be a positive integer'],
  ['a zero number', ['pr', 'merge', '0', '--disable-auto', '--repo', 'acme/widgets'], '<number> must be a positive integer'],
  ['a fractional number', ['pr', 'merge', '4.2', '--disable-auto', '--repo', 'acme/widgets'], '<number> must be a positive integer'],
  ['a number with a suffix', ['pr', 'merge', '42x', '--disable-auto', '--repo', 'acme/widgets'], '<number> must be a positive integer'],
  ['a missing repo', ['pr', 'merge', '42', '--disable-auto'], '--repo <owner/name> is required'],
  ['a repo without an owner', ['pr', 'merge', '42', '--disable-auto', '--repo', 'widgets'], '--repo must be owner/name'],
  ['a repo with two slashes', ['pr', 'merge', '42', '--disable-auto', '--repo', 'acme/widgets/x'], '--repo must be owner/name'],
  ['an enable form without --merge', ['pr', 'merge', '42', '--auto', '--match-head-commit', SHA, '--repo', 'acme/widgets'], '--auto requires --merge and --match-head-commit'],
  ['an enable form without a head commit', ['pr', 'merge', '42', '--auto', '--merge', '--repo', 'acme/widgets'], '--auto requires --merge and --match-head-commit'],
  ['a short head commit', ['pr', 'merge', '42', '--auto', '--merge', '--match-head-commit', 'abc1234', '--repo', 'acme/widgets'], 'a 40-hex commit SHA'],
  ['a non-hex head commit', ['pr', 'merge', '42', '--auto', '--merge', '--match-head-commit', 'z'.repeat(40), '--repo', 'acme/widgets'], 'a 40-hex commit SHA'],
  ['a form that is neither enable nor disable', ['pr', 'merge', '42', '--repo', 'acme/widgets'], 'choose either --auto (enable) or --disable-auto (disable)'],
  ['--merge with --disable-auto', ['pr', 'merge', '42', '--disable-auto', '--merge', '--repo', 'acme/widgets'], '--disable-auto takes only --repo'],
  ['a head commit with --disable-auto', ['pr', 'merge', '42', '--disable-auto', '--match-head-commit', SHA, '--repo', 'acme/widgets'], '--disable-auto takes only --repo'],
  ['--admin as a bare flag', ['pr', 'merge', '42', '--disable-auto', '--admin', '--repo', 'acme/widgets'], 'never bypasses branch protection'],
  ['--admin with a value', ['pr', 'merge', '42', '--disable-auto', '--admin=true', '--repo', 'acme/widgets'], 'never bypasses branch protection'],
  ['an unknown option', ['pr', 'merge', '42', '--disable-auto', '--force', '--repo', 'acme/widgets'], 'unknown option --force'],
  ['an unexpected positional argument', ['pr', 'merge', '42', '99', '--disable-auto', '--repo', 'acme/widgets'], 'unexpected argument 99'],
] as const)('refuses %s before any call to gh', async (_name, args, message) => {
  const result = await run([...args])
  expect(result.code).not.toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain(message)
  expect(invoked()).toBe(false)
})

it('prints the contract on --help and -h and exits 0 without calling gh', async () => {
  for (const flag of ['--help', '-h']) {
    const result = await run([flag])
    expect(result).toMatchObject({ code: 0 })
    expect(result.stdout).toContain('gh-agent-pr-merge pr merge <number> --auto --merge --match-head-commit <40-hex sha> --repo <owner/name>')
    expect(result.stdout).toContain('gh-agent-pr-merge pr merge <number> --disable-auto --repo <owner/name>')
    expect(result.stdout).toContain('never approves a pull request')
    expect(result.stderr).toBe('')
  }
  expect(invoked()).toBe(false)
})
