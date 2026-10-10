/**
 * `@ohhi/harness/skills` — the skills seam for every host (writing-harness
 * B9). The loader itself is `@ohhi/agent/skills` (the contract ops need it,
 * and this package depends on that one, not the reverse); this module
 * re-exports it and adds what only a harness host needs: a `SkillSource` over
 * any file reader, and a reader over a `VaultAdapter`.
 *
 * Browser-safe: no Node imports, and it does not pull in `@ohhi/agent`'s root
 * (the files backend) — only the loader's subpath.
 */
import { loadSkill, loadSkills, usableSkills, type SkillFs, type SkillMeta as LoadedMeta } from '@ohhi/agent/skills'
import type { SkillMeta, SkillSource } from '../types.js'

export * from '@ohhi/agent/skills'

/** The contract's `SkillMeta` and the seam's are one shape; this line fails to compile if they drift. */
export const sameMeta = (m: LoadedMeta): SkillMeta => m

/** What a `VaultAdapter` offers that the loader needs (structural, so a test can fake it). */
export interface ListReadAdapter {
  list(): Promise<{ path: string }[]>
  read(path: string): Promise<Uint8Array | null>
}

const decoder = new TextDecoder()

/** The loader's two calls over a vault adapter: its deep file list, filtered, and a decoded read. */
export function adapterSkillFs(adapter: ListReadAdapter): SkillFs {
  return {
    list: async (dir) => (await adapter.list()).map((f) => f.path).filter((p) => p.startsWith(`${dir}/`)).sort(),
    read: async (path) => {
      const bytes = await adapter.read(path)
      return bytes ? decoder.decode(bytes).replace(/^﻿/, '') : null
    },
  }
}

/**
 * A `SkillSource` for the harness: only the skills a model may use. `allow`
 * narrows further (the app: trusted and enabled); without it every VALID
 * skill is offered — the CLI's rule for a vault with no `.ohhi/skills.json`.
 */
export function createSkillSource(fs: SkillFs, allow: (meta: SkillMeta) => boolean = () => true): SkillSource {
  const offered = async (): Promise<SkillMeta[]> => usableSkills(await loadSkills(fs), null).filter(allow)
  return {
    list: offered,
    async body(name) {
      const found = await loadSkill(fs, name)
      if (!found || usableSkills([found.meta], null).length === 0 || !allow(found.meta)) return null
      return found.body
    },
  }
}

/** A source with nothing in it — a host before any skills exist. */
export const emptySkillSource: SkillSource = { list: async () => [], body: async () => null }
