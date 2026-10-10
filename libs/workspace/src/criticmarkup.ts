/**
 * CriticMarkup as a codec for comment threads (writing-harness-shaping B8,
 * Fork 5): never the store — three incompatible encodings, the bytes change,
 * not CommonMark — but the way a review travels to and from an Obsidian
 * reader.
 *
 * **Import** reads a highlight followed by one or more comments, and a bare
 * comment, in the three encodings the Obsidian plugins write
 * (`plans/research/harness-in-doc-editing.md` §1):
 *
 * - Review Comments: `{==text==}{>>id|author|date|TYPE: comment<<}`
 * - Relay Comments: `{==text==}{{authorId="…" author="Name">>comment<<}}`
 * - Track Changes: `{==text==}{>>author="Name" date="…" comment<<}`
 *
 * plus this module's own export form and a plain `{>>comment<<}`. Every
 * comment after one highlight is one thread (the first opens it, the rest
 * reply). The result is the text with that markup removed and the threads
 * anchored to it by quote. Other CriticMarkup (`{++ ++}`, `{-- --}`,
 * `{~~ ~> ~~}`) is a suggestion, not a comment, and stays in the text.
 *
 * **Export** writes `{==text==}{>>author|date: body<<}` per comment, the
 * date an ISO instant — readable, and lossless back through import.
 */
import { findQuote, quoteAt, type CommentRecord, type ThreadRecord } from './threads.js'

export interface ImportOptions {
  path: string
  /** Fresh ids for threads and comments that carry none. */
  newId: () => string
  /** Stamp for a comment whose date is missing or unreadable. */
  now: number
  /** Author for a comment that names none. */
  defaultAuthor?: string
}

export interface ImportResult {
  /** The text with the imported highlights and comments removed. */
  text: string
  threads: ThreadRecord[]
}

const HIGHLIGHT = /^\{==([\s\S]*?)==\}/
const COMMENT = /^\{>>([\s\S]*?)<<\}/
const RELAY_COMMENT = /^\{\{([^{}]*?)>>([\s\S]*?)<<\}\}/
/** `key="value"` pairs leading a comment (Track Changes) or a Relay header. */
const ATTR = /^\s*([A-Za-z][\w-]*)="([^"]*)"/
/** An ISO date or instant — V8's `Date.parse` alone accepts far too much. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/
/** Review Comments' type tag: `COMMENT: `, `QUESTION: `, … */
const TYPE_TAG = /^[A-Z][A-Z_-]*:\s*/

interface Parsed {
  author: string
  date: string | null
  body: string
  id?: string
}

function attrs(src: string): { attrs: Record<string, string>; rest: string } {
  const out: Record<string, string> = {}
  let rest = src
  for (let m = ATTR.exec(rest); m; m = ATTR.exec(rest)) {
    out[m[1]] = m[2]
    rest = rest.slice(m[0].length)
  }
  return { attrs: out, rest: rest.replace(/^\s+/, '') }
}

/** One `{>>…<<}` body, in whichever encoding it is. */
function parseComment(raw: string): Parsed {
  if (ATTR.test(raw)) {
    const { attrs: a, rest } = attrs(raw)
    if ('author' in a || 'date' in a) return { author: a.author ?? '', date: a.date ?? null, body: rest }
  }
  const parts = raw.split('|')
  if (parts.length >= 2) {
    // This module's export: author|date: body — first, because a body may
    // hold pipes of its own; the date is what tells it apart.
    const tail = parts.slice(1).join('|')
    const cut = tail.indexOf(': ')
    const date = cut === -1 ? '' : tail.slice(0, cut).trim()
    if (ISO_DATE.test(date) && !Number.isNaN(Date.parse(date))) return { author: parts[0].trim(), date, body: tail.slice(cut + 2) }
  }
  if (parts.length >= 4) {
    // Review Comments: id|author|date|TYPE: comment
    const [id, author, date, ...rest] = parts
    return { id: id.trim() || undefined, author: author.trim(), date: date.trim(), body: rest.join('|').replace(TYPE_TAG, '') }
  }
  return { author: '', date: null, body: raw }
}

function parseRelay(header: string, body: string): Parsed {
  const { attrs: a } = attrs(header)
  return { author: a.author ?? a.authorId ?? '', date: a.date ?? null, body }
}

function stamp(date: string | null, fallback: number): number {
  if (!date) return fallback
  const at = Date.parse(date)
  return Number.isNaN(at) ? fallback : at
}

/** Read the comments at the head of `src`: each `[parsed, length]`. */
function commentsAt(src: string): { list: Parsed[]; length: number } {
  const list: Parsed[] = []
  let length = 0
  for (;;) {
    const rest = src.slice(length)
    const c = COMMENT.exec(rest)
    if (c) {
      list.push(parseComment(c[1]))
      length += c[0].length
      continue
    }
    const r = RELAY_COMMENT.exec(rest)
    if (r) {
      list.push(parseRelay(r[1], r[2]))
      length += r[0].length
      continue
    }
    return { list, length }
  }
}

/** Import CriticMarkup comments into threads over the de-marked text. */
export function importCriticMarkup(markdown: string, opts: ImportOptions): ImportResult {
  let out = ''
  const spans: { from: number; to: number; comments: Parsed[] }[] = []
  let i = 0
  while (i < markdown.length) {
    const open = markdown.indexOf('{', i)
    if (open === -1) {
      out += markdown.slice(i)
      break
    }
    out += markdown.slice(i, open)
    const rest = markdown.slice(open)
    const h = HIGHLIGHT.exec(rest)
    if (h) {
      const after = commentsAt(rest.slice(h[0].length))
      if (after.list.length > 0) {
        const from = out.length
        out += h[1]
        spans.push({ from, to: out.length, comments: after.list })
        i = open + h[0].length + after.length
        continue
      }
    } else {
      const bare = commentsAt(rest)
      if (bare.list.length > 0) {
        spans.push({ from: out.length, to: out.length, comments: bare.list })
        i = open + bare.length
        continue
      }
    }
    out += '{'
    i = open + 1
  }

  const threads = spans.map((span): ThreadRecord => {
    const comments: CommentRecord[] = span.comments.map((c) => ({
      id: opts.newId(),
      author: c.author || (opts.defaultAuthor ?? ''),
      at: stamp(c.date, opts.now),
      body: c.body,
    }))
    const first = comments[0]
    return {
      id: span.comments[0].id ?? opts.newId(),
      path: opts.path,
      author: first.author,
      created: first.at,
      resolved: false,
      anchor: { quote: quoteAt(out, span.from, span.to) },
      comments,
    }
  })
  return { text: out, threads }
}

export interface ExportOptions {
  /** Resolved threads too (default: open threads only — a review is what is still open). */
  includeResolved?: boolean
  /** A thread's passage now; default: by its quote in `text`. */
  locate?: (thread: ThreadRecord) => { from: number; to: number } | null
}

export interface ExportResult {
  text: string
  /** Threads that were not written: their passage is gone, or overlaps one already written. */
  skipped: string[]
}

/** One comment in the export form. `<<}` inside a body would end it early. */
function encodeComment(c: CommentRecord): string {
  const body = c.body.replaceAll('<<}', '<< }')
  return `{>>${c.author}|${new Date(c.at).toISOString()}: ${body}<<}`
}

/** Write threads into `text` as `{==passage==}{>>author|date: body<<}…`. */
export function exportCriticMarkup(text: string, threads: readonly ThreadRecord[], opts: ExportOptions = {}): ExportResult {
  const locate = opts.locate ?? ((t: ThreadRecord) => findQuote(text, t.anchor.quote))
  const skipped: string[] = []
  const placed: { from: number; to: number; thread: ThreadRecord }[] = []
  for (const thread of threads) {
    if (thread.resolved && !opts.includeResolved) continue
    if (thread.comments.length === 0) continue
    const range = locate(thread)
    if (!range) {
      skipped.push(thread.id)
      continue
    }
    placed.push({ ...range, thread })
  }
  placed.sort((a, b) => a.from - b.from || a.to - b.to)
  // Highlights cannot nest: a thread overlapping an earlier one is skipped.
  const kept: typeof placed = []
  for (const p of placed) {
    const prev = kept[kept.length - 1]
    if (prev && p.from < prev.to) skipped.push(p.thread.id)
    else kept.push(p)
  }
  let out = text
  for (const { from, to, thread } of kept.reverse()) {
    const comments = thread.comments.map(encodeComment).join('')
    const mark = from === to ? comments : `{==${text.slice(from, to)}==}${comments}`
    out = out.slice(0, from) + mark + out.slice(to)
  }
  return { text: out, skipped }
}

/** The review copy's name: `notes/plan.md` → `plan (review).md`. */
export function reviewCopyName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.toLowerCase().endsWith('.md') ? base.length - 3 : base.length
  return `${base.slice(0, dot)} (review).md`
}
