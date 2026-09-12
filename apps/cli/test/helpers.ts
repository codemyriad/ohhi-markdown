/**
 * Shared scaffolding for this package's suites: a fixture vault per test, and
 * `ohhi(argv)` as a function call rather than a spawned process.
 *
 * ONE fixture builder for the workspace — `libs/agent`'s suite and these
 * exercise the same vault, so "the core says X, the CLI prints Y" is a bug and
 * never a difference between two fixtures (build brief, wave 2 R2).
 */
import { afterEach } from 'vitest'
import { run } from '../src/run.js'
import { bufferIo } from '../src/io.js'
import { makeFixtureVault, type FixtureVault } from '../../../libs/agent/test/fixture.js'

export type { FixtureVault }

const vaults: FixtureVault[] = []
afterEach(async () => {
  while (vaults.length > 0) await vaults.pop()!.cleanup()
})

/** A fresh fixture vault, removed after the test that asked for it. */
export async function fixture(): Promise<FixtureVault> {
  const v = await makeFixtureVault('ohhi-cli-')
  vaults.push(v)
  return v
}

/**
 * `run(argv, io)` with everything buffered. The default cwd does not exist, so
 * the walk-up finds no vault and a test that names none is testing exactly that.
 */
export async function ohhi(
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined>; stdin?: string } = {}
): Promise<{ out: string; err: string; code: number }> {
  const io = bufferIo({
    cwd: opts.cwd ?? '/nonexistent-cwd',
    env: opts.env ?? {},
    stdin: opts.stdin === undefined ? undefined : async () => opts.stdin!,
  })
  const code = await run(argv, io)
  return { out: io.out(), err: io.errText(), code }
}

/** `argv` aimed at a fixture vault, with a throwaway journal. */
export const inVault = (v: FixtureVault, argv: string[]): string[] => [...argv, '--vault', v.root, '--data-dir', v.dataDir]
