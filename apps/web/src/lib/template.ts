/**
 * Templates as files (quiet-shell F11; foundations-plan Stage 6):
 * `.ohhi/templates/<name>.md` — Obsidian-shaped (its core Templates plugin is
 * a folder of markdown), with Claude-Code-shaped arguments.
 *
 * Frontmatter keys this module reads, and strips from what is inserted:
 *   description:    the palette row's subtitle
 *   argument-hint:  what the arguments are, shown beside it (`[topic] [who…]`)
 * Any OTHER frontmatter key stays in the inserted text, line for line.
 *
 * Body substitution (`render`):
 *   {{date}}          today, in the vault's daily-note format (YYYY-MM-DD if none)
 *   {{date:FORMAT}}   today in a moment-style FORMAT (`daily-notes.ts` tokens)
 *   {{time}}          now, HH:mm (24-hour)
 *   {{title}}         the note it is inserted into, without `.md`
 *   $1 … $9           the n-th argument ('' when not given)
 *   ${1:-default}     the n-th argument, or `default` when not given
 *   $@                every argument, space-separated
 *   $$                a literal `$`
 *
 * Pure: "now" arrives from the caller's injected clock (golden rule 5) — a
 * date the module reads off `Date.now()` itself is a date no test can pin.
 */
import { parseFrontmatter } from '@ohhi/frontmatter'
import { DAILY_DEFAULTS, formatDate } from './daily-notes.js'
import dailyTemplate from './templates/daily.md?raw'
import meetingTemplate from './templates/meeting.md?raw'

/** The example templates shipped with the app (the built-in root's `templates/`). */
export const BUILTIN_TEMPLATES: Readonly<Record<string, string>> = {
  daily: dailyTemplate,
  meeting: meetingTemplate,
}

/** The frontmatter keys that describe the template rather than belong to its output. */
const META_KEYS = ['description', 'argument-hint'] as const

export interface ParsedTemplate {
  description: string
  argumentHint: string
  /** The text to render: the template minus its own META_KEYS. */
  body: string
}

const scalar = (v: string | string[] | undefined): string => (Array.isArray(v) ? v.join(' ') : (v ?? ''))

/**
 * Split a template file into its description, argument hint and body. The
 * `description` / `argument-hint` lines are removed from the block; when they
 * were all it held, the whole block goes.
 */
export function parseTemplate(text: string): ParsedTemplate {
  const fm = parseFrontmatter(text)
  if (!fm.present) return { description: '', argumentHint: '', body: text }
  const meta = fm.entries.filter((e) => (META_KEYS as readonly string[]).includes(e.key))
  const description = scalar(meta.find((e) => e.key === 'description')?.value)
  const argumentHint = scalar(meta.find((e) => e.key === 'argument-hint')?.value)
  const rest = fm.entries.filter((e) => !(META_KEYS as readonly string[]).includes(e.key))
  const block = text.slice(0, fm.end)
  const after = text.slice(fm.end)
  if (rest.length === 0) return { description, argumentHint, body: after }
  const drop = new Set<number>()
  for (const e of meta) for (let l = e.lines[0]; l <= e.lines[1]; l++) drop.add(l)
  const lines = block.split(/(?<=\n)/)
  return { description, argumentHint, body: lines.filter((_, i) => !drop.has(i)).join('') + after }
}

const pad = (n: number): string => String(n).padStart(2, '0')

export interface RenderContext {
  /** Epoch ms from the injected clock. */
  now: number
  /** The note the template lands in, without `.md`. */
  title?: string
  /** Positional arguments (`$1`, `$@`). */
  args?: readonly string[]
  /** The `{{date}}` format — the vault's daily-note format, so the two agree. */
  dateFormat?: string
}

/**
 * Substitute a template body (see the module comment for the grammar). One
 * pass, left to right, so an argument that itself contains `$1` or `{{date}}`
 * is inserted as written, never expanded again.
 */
export function render(template: string, ctx: RenderContext): string {
  const date = new Date(ctx.now)
  const args = ctx.args ?? []
  const format = ctx.dateFormat || DAILY_DEFAULTS.format
  const pattern = /\{\{\s*(date|time|title)(?::([^}]*))?\s*\}\}|\$\{([1-9]):-([^}]*)\}|\$([1-9@$])/g
  return template.replace(
    pattern,
    (match, name?: string, fmt?: string, defIdx?: string, def?: string, pos?: string) => {
      if (name === 'date') return formatDate(fmt?.trim() || format, date)
      if (name === 'time') return `${pad(date.getHours())}:${pad(date.getMinutes())}`
      if (name === 'title') return ctx.title ?? ''
      if (defIdx !== undefined) {
        const value = args[Number(defIdx) - 1]
        return value !== undefined && value !== '' ? value : (def ?? '')
      }
      if (pos === '@') return args.join(' ')
      if (pos === '$') return '$'
      if (pos !== undefined) return args[Number(pos) - 1] ?? ''
      return match
    }
  )
}

/**
 * The palette's argument syntax: the first word picks the template, the rest
 * are its arguments. A `"quoted phrase"` is one argument.
 */
export function splitArgs(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/"([^"]*)"|(\S+)/g)) out.push(m[1] ?? m[2] ?? '')
  return out
}
