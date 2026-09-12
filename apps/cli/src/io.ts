/**
 * The process seam. `run(argv, io)` never touches `process` — every byte the
 * CLI emits goes through this interface, which is what makes the whole
 * command surface table-testable (Cassini's `Run(ctx, args, stdout, stderr)`).
 */
export interface Io {
  /** Write to stdout. The ANSWER goes here and nothing else. */
  stdout(chunk: string): void
  /** Write to stderr. Provenance, counters, warnings, errors. */
  stderr(chunk: string): void
  env: Record<string, string | undefined>
  cwd: string
  /** Reads all of stdin; only called when an op needs text and `--text` was absent. */
  stdin?(): Promise<string>
}

/** Line-oriented writer over an `Io`, so renderers never think about newlines. */
export class Sink {
  constructor(private readonly io: Io) {}
  out(line: string): void {
    this.io.stdout(line.endsWith('\n') ? line : line + '\n')
  }
  /** Raw stdout — for note text, which carries its own newlines. */
  raw(chunk: string): void {
    this.io.stdout(chunk)
  }
  err(line: string): void {
    this.io.stderr(line.endsWith('\n') ? line : line + '\n')
  }
}

/** Collects output in memory. Used by the tests and by `ohhi mcp`. */
export function bufferIo(base: Partial<Io> = {}): Io & { out: () => string; errText: () => string } {
  const outChunks: string[] = []
  const errChunks: string[] = []
  return {
    stdout: (c) => void outChunks.push(c),
    stderr: (c) => void errChunks.push(c),
    env: base.env ?? {},
    cwd: base.cwd ?? '/',
    stdin: base.stdin,
    out: () => outChunks.join(''),
    errText: () => errChunks.join(''),
  }
}
