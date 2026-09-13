/**
 * Line and section arithmetic — the machinery behind "read the PART of the
 * note you need" (shaping R4).
 *
 * Headings and line offsets come from `@ohhi/index`, never from a second
 * scanner (R3): it already knows that a `#` inside a fenced code block is not
 * a heading, and two answers to that question is exactly the drift the
 * one-implementation rule exists to prevent. What is left here is the slicing
 * the contract needs on top of those primitives.
 */
import { lineAt, lineStartsOf, parseMarkdown } from '@ohhi/index'
import type { z } from 'zod'
import type { OutlineEntry } from './contract.js'

export type Outline = z.infer<typeof OutlineEntry>

/** A heading and the span of lines it owns (itself through the line before the next heading of <= level). */
export interface Section extends Outline {
  /** 1-based inclusive line range, heading line included. */
  from: number
  to: number
}

/** Lines of `text`, WITHOUT their terminators. A trailing newline is not a final empty line. */
export function linesOf(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Re-join lines produced by `linesOf`, restoring the trailing newline. */
export const joinLines = (lines: string[]): string => (lines.length ? `${lines.join('\n')}\n` : '')

/** 1-based inclusive slice of `text`, clamped to what exists. */
export function sliceLines(text: string, from: number, to: number): { text: string; from: number; to: number } {
  const lines = linesOf(text)
  const start = Math.max(1, Math.min(from, lines.length))
  const end = Math.max(start, Math.min(to, lines.length))
  return { text: joinLines(lines.slice(start - 1, end)), from: start, to: end }
}

/**
 * Every heading with the section it owns. `chars` is the whole section
 * INCLUDING its heading line, which is what a caller budgeting a `--section`
 * read needs to know before asking for it.
 */
function sectionsOf(text: string): Section[] {
  const starts = lineStartsOf(text)
  const lines = linesOf(text)
  const heads = parseMarkdown(text).headings.map((h) => ({
    level: h.level,
    text: h.text.trim(),
    line: lineAt(starts, h.offset),
  }))
  return heads.map((h, i): Section => {
    const next = heads.slice(i + 1).find((other) => other.level <= h.level)
    const to = next ? next.line - 1 : lines.length
    const body = joinLines(lines.slice(h.line - 1, to))
    return { level: h.level, text: h.text, line: h.line, chars: body.length, from: h.line, to }
  })
}

/** The contract's outline shape: the sections without their line ranges. */
export const outlineOf = (text: string): Outline[] =>
  sectionsOf(text).map(({ level, text: heading, line, chars }) => ({ level, text: heading, line, chars }))

const foldHeading = (s: string): string => s.trim().toLowerCase()

/**
 * Find a section by heading path: `Decisions` matches the first heading with
 * that text; `Notes/Open questions` matches `Open questions` NESTED under
 * `Notes` (a deeper heading inside `Notes`' own span). Case-insensitive on
 * trimmed text, because an agent is quoting a heading it read, not retyping it.
 */
export function findSection(text: string, headingPath: string): Section | null {
  const wanted = headingPath
    .split('/')
    .map(foldHeading)
    .filter((part) => part !== '')
  if (wanted.length === 0) return null
  const sections = sectionsOf(text)
  let scope: Section[] = sections
  let found: Section | null = null
  for (const part of wanted) {
    const hit = scope.find((s) => foldHeading(s.text) === part)
    if (!hit) return null
    found = hit
    // Children only: anything inside this heading's span, minus itself.
    scope = sections.filter((s) => s.line > hit.line && s.line <= hit.to)
  }
  return found
}

export interface Budgeted {
  text: string
  truncated: boolean
  /** First line NOT included, when truncated. */
  nextLine?: number
}

/**
 * Cut `text` to `maxChars` at a LINE boundary, so what comes back is always
 * whole lines an agent can quote and continue from.
 *
 * The one exception is a single line longer than the budget: it comes back
 * whole. A budget that returned nothing would leave the caller with no way to
 * make progress, and an agent looping on `nextLine` forever is worse than one
 * over-long line.
 */
export function budget(text: string, startLine: number, maxChars: number): Budgeted {
  if (text.length <= maxChars) return { text, truncated: false }
  let cut = text.lastIndexOf('\n', maxChars)
  if (cut <= 0) {
    const nl = text.indexOf('\n')
    cut = nl === -1 ? text.length - 1 : nl
  }
  const out = text.slice(0, cut + 1)
  if (out.length >= text.length) return { text, truncated: false }
  const consumed = (out.match(/\n/g) ?? []).length
  return { text: out, truncated: true, nextLine: startLine + consumed }
}
