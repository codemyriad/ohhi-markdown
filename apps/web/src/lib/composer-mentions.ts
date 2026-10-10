/**
 * The composer's two completion sources (writing-harness-shaping B4), pure
 * over what the shell already knows:
 *
 *  - `@` — the selection in the note you came from (`L12-20`, first, when
 *    there is one), that note's headings, notes by the quick-open matcher
 *    (`index.quickOpen`: the one fuzzy ranking in the app, recency included),
 *    and folders. A query starting `#` narrows to headings.
 *  - `/` — skills, by name (`host.skills.list()`; builder C's source — empty
 *    until it lands).
 *
 * Each option carries the match spans `highlight.ts` draws, as the palette's
 * rows do, and what picking it inserts: a `VaultRef` (resolved lazily by the
 * agent at send) or, for the selection, a captured `lines` mention.
 */
import { getLL } from '@ohhi/i18n'
import type { SkillMeta, VaultRef } from '@ohhi/harness'
import { fuzzyScore, toSpans } from '@ohhi/index'
import type { Span } from './highlight.js'
import { fileName, mentionLabel } from './references.js'

export type MentionOption =
  | { kind: 'file' | 'folder' | 'section'; id: string; title: string; spans: Span[]; subtitle?: string; ref: VaultRef }
  | { kind: 'lines'; id: string; title: string; spans: Span[]; subtitle?: string; path: string }
  | { kind: 'skill'; id: string; title: string; spans: Span[]; subtitle?: string; skill: SkillMeta }

export interface MentionSources {
  /** The quick-open ranking over note paths (`MemoryIndex.quickOpen`). */
  quickOpen(query: string): Promise<{ path: string; spans: Span[] }[]>
  /** Every folder in the vault. */
  folders(): readonly string[]
  /** The note the person was last in (the composer's own tab has none). */
  currentNote(): string | null
  /** That note's headings (`index.headings`). */
  headings(path: string): Promise<{ text: string; level: number }[]>
  /** The live selection in that note, as lines, when there is one. */
  selection(): { path: string; lines: { from: number; to: number } } | null
  /** The trusted, enabled skills (C's `SkillSource`). */
  skills(): Promise<SkillMeta[]>
}

const LIMITS = { headings: 6, files: 8, folders: 4, skills: 10 }

function ranked<T>(items: readonly T[], query: string, key: (t: T) => string, limit: number): { item: T; spans: Span[] }[] {
  const scored: { item: T; spans: Span[]; score: number }[] = []
  for (const item of items) {
    const m = fuzzyScore(query, key(item))
    if (m) scored.push({ item, spans: toSpans(m.positions), score: m.score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

function dirOf(path: string): string | undefined {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? undefined : path.slice(0, slash)
}

/** The `@` menu for `query`, best first. */
export async function mentionOptions(query: string, src: MentionSources): Promise<MentionOption[]> {
  const out: MentionOption[] = []
  const note = src.currentNote()
  const headingsOnly = query.startsWith('#')
  const q = headingsOnly ? query.slice(1) : query

  const sel = src.selection()
  if (sel && !headingsOnly) {
    const ref: VaultRef = { kind: 'lines', path: sel.path, lines: sel.lines }
    const title = mentionLabel(ref)
    const m = q ? fuzzyScore(q, title) : { score: 0, positions: [] }
    if (m) {
      out.push({
        kind: 'lines',
        id: `lines:${sel.path}:${sel.lines.from}-${sel.lines.to}`,
        title,
        spans: toSpans(m.positions),
        subtitle: getLL().web.ai.composer.selection({ name: fileName(sel.path) }),
        path: sel.path,
      })
    }
  }

  if (note) {
    const headings = await src.headings(note)
    for (const { item, spans } of ranked(headings, q, (h) => h.text, LIMITS.headings)) {
      const ref: VaultRef = { kind: 'section', path: note, section: item.text }
      out.push({ kind: 'section', id: `section:${note}#${item.text}`, title: item.text, spans, subtitle: mentionLabel(ref), ref })
    }
  }
  if (headingsOnly) return out

  for (const hit of (await src.quickOpen(q)).slice(0, LIMITS.files)) {
    const dir = dirOf(hit.path)
    out.push({ kind: 'file', id: `file:${hit.path}`, title: hit.path, spans: hit.spans, ...(dir ? { subtitle: dir } : {}), ref: { kind: 'file', path: hit.path } })
  }
  for (const { item, spans } of ranked(src.folders(), q, (f) => f, LIMITS.folders)) {
    out.push({ kind: 'folder', id: `folder:${item}`, title: `${item}/`, spans, ref: { kind: 'folder', path: item } })
  }
  return out
}

/** The `/` menu for `query`: skills by name. */
export async function skillOptions(query: string, src: Pick<MentionSources, 'skills'>): Promise<MentionOption[]> {
  const skills = await src.skills()
  return ranked(skills, query, (s) => s.name, LIMITS.skills).map(({ item, spans }) => ({
    kind: 'skill' as const,
    id: `skill:${item.name}`,
    title: item.name,
    spans,
    subtitle: item.description,
    skill: item,
  }))
}
