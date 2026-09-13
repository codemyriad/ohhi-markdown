#!/usr/bin/env node
/**
 * The only file in this package that knows about `process`. Everything else
 * takes an `Io` — which is what makes `ohhi` testable as a function.
 */
import { run } from './run.js'

const argv = process.argv.slice(2)

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

process.exitCode = await run(argv, {
  stdout: (chunk) => void process.stdout.write(chunk),
  stderr: (chunk) => void process.stderr.write(chunk),
  env: process.env,
  cwd: process.cwd(),
  stdin: process.stdin.isTTY ? undefined : readStdin,
})
