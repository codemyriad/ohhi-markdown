/**
 * Templates on the shell's side (quiet-shell F11; foundations-plan Stage 6):
 * the files every resource root offers under `templates/` (the vault's
 * `.ohhi/templates/` first), each one a palette row `template:<name>` in a
 * *Templates* group, and `insert(name, args)` — render over the injected
 * clock (`template.ts`) and put the text at the focused editor's caret.
 *
 * A runes module built by a factory over an explicit host, so a test drives
 * it with fakes and a pinned clock.
 */
import { getLL } from '@ohhi/i18n'
import type { Command } from './commands.js'
import { TEMPLATE_COMMAND_PREFIX } from './command-ids.js'
import type { ResourceEntry, Resources } from './resources.svelte.js'
import { parseTemplate, render, type ParsedTemplate } from './template.js'

export interface TemplateRow extends ParsedTemplate {
  name: string
  entry: ResourceEntry
}

export interface TemplatesHost {
  resources: Pick<Resources, 'readAll' | 'readTemplate'>
  /** Epoch ms — the injected clock (golden rule 5). */
  now(): number
  /** The focused note's path, or null. `{{title}}` is its basename. */
  notePath(): string | null
  /** The vault's daily-note format, so `{{date}}` names the same day the daily note does. */
  dateFormat(): string
  /** Insert at the focused editor's caret; false when no editable note holds the focus. */
  insertText(text: string): boolean
  /** Something went wrong in words — no note to insert into, a missing file. */
  warn(text: string): void
}

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

export function createTemplates(host: TemplatesHost) {
  let rows = $state<TemplateRow[]>([])
  let generation = 0

  /** Re-list and re-read every template (a vault switch, a change under `.ohhi/templates/`, Reload). */
  async function reload(): Promise<TemplateRow[]> {
    const gen = ++generation
    // One listing per root, then one read per file — not a shadow scan per template.
    const next: TemplateRow[] = (await host.resources.readAll('templates')).map(({ text, entry }) => ({
      name: entry.name,
      entry,
      ...parseTemplate(text),
    }))
    if (gen === generation) rows = next.sort((a, b) => a.name.localeCompare(b.name))
    return rows
  }

  /** Render `name` with `args` and insert it at the caret; false when nothing was inserted. */
  async function insert(name: string, args: readonly string[] = []): Promise<boolean> {
    const t = getLL().web.templates
    let row = rows.find((r) => r.name === name)
    if (!row) {
      const found = await host.resources.readTemplate(name)
      if (!found) {
        host.warn(t.not_found({ name }))
        return false
      }
      row = { name, entry: found.entry, ...parseTemplate(found.text) }
    }
    const path = host.notePath()
    const text = render(row.body, {
      now: host.now(),
      ...(path ? { title: basename(path) } : {}),
      args,
      dateFormat: host.dateFormat(),
    })
    if (host.insertText(text)) return true
    host.warn(t.needs_note())
    return false
  }

  /** One palette row per template: `template:<name>` under *Templates* (not bindable — a provider). */
  function commands(): Command[] {
    const group = getLL().web.commands.groups.templates()
    return rows.map((row) => ({
      id: `${TEMPLATE_COMMAND_PREFIX}${row.name}`,
      title: getLL().web.templates.row({ name: row.name }),
      group,
      run: () => void insert(row.name),
    }))
  }

  return {
    get rows() {
      return rows
    },
    reload,
    insert,
    commands,
  }
}

export type Templates = ReturnType<typeof createTemplates>
