/**
 * The user resource root on desktop (spike-resource-root Q4, quiet-shell F8):
 * `<config>/ohhi/<kind>/` — `~/.config/ohhi/` on Linux (XDG, the folder the
 * `ohhi` CLI can share), `~/Library/Application Support/ohhi/` on macOS.
 * Read-only from the app today: Settings saves into the vault.
 *
 * Needs the `$CONFIG/ohhi/**` fs scope (apps/desktop capabilities) —
 * UNVERIFIED on a real desktop build (spike F0). A refused read lists as
 * empty, so a missing scope costs the user root, never the boot.
 */
import { configDir, join } from '@tauri-apps/api/path'
import { exists, readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { isTempName } from '@ohhi/vault'
import type { ResourceRoot } from '../resources.svelte.js'

export async function createTauriUserRoot(): Promise<ResourceRoot> {
  const base = await join(await configDir(), 'ohhi')
  return {
    id: 'user',
    base,
    location: (kind) => `${base}/${kind}`,
    list: async (kind) => {
      const dir = await join(base, kind)
      if (!(await exists(dir))) return []
      return (await readDir(dir)).filter((e) => e.isFile && !isTempName(e.name)).map((e) => e.name)
    },
    read: async (kind, file) => {
      const path = await join(base, kind, file)
      return (await exists(path)) ? await readTextFile(path) : null
    },
  }
}
