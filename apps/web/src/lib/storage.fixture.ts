/**
 * A `localStorage` stand-in for the suites that drive `config.ts`'s store —
 * `config.test.ts`, `workspace-layout.test.ts`, `workspace-mounts.test.ts`.
 *
 * `apps/web`'s vitest runs on node, so there is no storage to stub and each
 * suite carried its own copy of this. Not a `.test.ts`, so the test glob
 * leaves it alone.
 */
const g = globalThis as { localStorage?: unknown }

/** Minimal Storage over a Map — `config.ts` only needs these three. */
export class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
  /** Which keys were written — how a test asserts "one key per vault". */
  keys(): string[] {
    return [...this.m.keys()]
  }
}

/** Fresh storage for one test; the returned store is the one the app will see. */
export function useMemStorage(): MemStorage {
  const store = new MemStorage()
  g.localStorage = store
  return store
}

/** Put the ABSENCE of storage back — the private-mode path is a real one. */
export function dropStorage(): void {
  delete g.localStorage
}

/** Seed a value the way an earlier build would have left it. */
export function seedStored(key: string, value: unknown): void {
  ;(g.localStorage as MemStorage).setItem(
    key,
    typeof value === 'string' ? value : JSON.stringify(value)
  )
}
