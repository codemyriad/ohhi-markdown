/**
 * Spike S10-Q4 — run the real relay as a child process.
 *
 * `libs/workspace` has no dependency on `@editor/relay` (and must not grow
 * one), so the bench spawns `apps/relay` exactly the way `apps/web`'s
 * `e2e/start-relay.mjs` does: `node --experimental-strip-types src/main.ts`
 * with a throwaway DATA_DIR, `PORT=0` (ephemeral — the bound port is read
 * back off stdout) and a pre-seeded share. The repo's own `apps/relay/data`
 * is never touched.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const RELAY_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '../../../apps/relay')

export interface RelayHandle {
  url: string
  port: number
  stop(): Promise<void>
}

export function startRelay(opts: {
  dataDir: string
  /** `"<folderGuid>:<token>"` pairs, comma-separated (main.ts SEED_SHARE). */
  seedShare: string
}): Promise<RelayHandle> {
  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(
    'node',
    ['--experimental-strip-types', 'src/main.ts'],
    {
      cwd: RELAY_DIR,
      env: { ...process.env, PORT: '0', DATA_DIR: opts.dataDir, SEED_SHARE: opts.seedShare },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  return new Promise((resolve, reject) => {
    let out = ''
    const onData = (chunk: Buffer): void => {
      out += chunk.toString()
      const m = out.match(/listening on ws:\/\/0\.0\.0\.0:(\d+)/)
      if (!m) return
      child.stdout.off('data', onData)
      const port = Number(m[1])
      resolve({
        url: `ws://127.0.0.1:${port}`,
        port,
        stop: () =>
          new Promise<void>((done) => {
            if (child.exitCode !== null) return done()
            const kill = setTimeout(() => child.kill('SIGKILL'), 10_000)
            child.once('exit', () => {
              clearTimeout(kill)
              done()
            })
            // SIGINT: main.ts flushes pending doc stores into SQLite first.
            child.kill('SIGINT')
          }),
      })
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      if (!text.includes('ExperimentalWarning')) process.stderr.write(`[relay] ${text}`)
    })
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`relay exited early (${code})\n${out}`)))
  })
}
