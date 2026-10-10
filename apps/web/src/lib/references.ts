/**
 * References (writing-harness-shaping B5): what a chip in the composer points
 * at, captured Zed's way — a `lines` mention SNAPSHOTS its text at insert, and
 * `file` / `folder` / `section` resolve lazily, by the agent, at send.
 *
 * Pure: the caller hands in the text it read (the live Y.Text through the
 * app backend, so a capture never sees a stale disk copy) and the note's
 * hash (`hashBytes` of the bytes the backend serves — the same `hash` the
 * agent's `ohhi_read` reports, so it doubles as an `expectHash` later).
 *
 * Line maths is `@ohhi/index`'s (`lineStartsOf` / `lineAt`), the one
 * implementation the index and the agent ops share. Lines are 1-based and
 * inclusive, as `ohhi read --lines` takes them.
 *
 * `anchor.yjs` is a `Y.RelativePosition` pair on an enrolled doc, so a
 * reference follows its text through peers' edits. It is encoded and decoded
 * by `@ohhi/workspace`'s `anchors.ts` (the one encoder) at the edges — the
 * caller passes the encoded pair in and the decoded range back — so this
 * module stays pure.
 */
import { getLL } from '@ohhi/i18n'
import type { Mention, VaultRef } from '@ohhi/harness'
import { lineAt, lineStartsOf } from '@ohhi/index'

/** The last segment of a path, extension kept: `notes/plan.md` → `plan.md`. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** A chip's words: `plan.md`, `plan.md (12–20)`, `plan.md › Decisions`, `notes/`. */
export function mentionLabel(ref: VaultRef): string {
  const t = getLL().web.ai.refs
  const name = fileName(ref.path)
  switch (ref.kind) {
    case 'file':
      return name
    case 'folder':
      return t.folder({ path: ref.path })
    case 'section':
      return t.section({ name, heading: ref.section.split('/').at(-1) ?? ref.section })
    case 'lines':
      return ref.lines.from === ref.lines.to
        ? t.line({ name, line: ref.lines.from })
        : t.lines({ name, from: ref.lines.from, to: ref.lines.to })
  }
}

/** A mention id: unique within a session, never shown. */
export function mentionId(): string {
  return `m-${Math.random().toString(36).slice(2, 10)}`
}

/** A mention for a ref picked from the `@` menu (resolved lazily, no snapshot). */
export function mentionOf(ref: VaultRef, hash?: string): Mention {
  return { id: mentionId(), ref, label: mentionLabel(ref), ...(hash ? { hash } : {}) }
}

/** Lines `from..to` (1-based, inclusive, clamped) of `text`, terminators kept. */
export function sliceLines(text: string, from: number, to: number): { text: string; from: number; to: number } {
  const starts = lineStartsOf(text)
  // A trailing newline does not start a final empty line (as `ohhi read`).
  const count = text.endsWith('\n') && starts.length > 1 ? starts.length - 1 : starts.length
  const a = Math.max(1, Math.min(from, count))
  const b = Math.max(a, Math.min(to, count))
  return { text: text.slice(starts[a - 1], starts[b] ?? text.length), from: a, to: b }
}

/** The 1-based lines a character range covers. A range ending at a line's start does not take that line. */
export function linesOfRange(text: string, from: number, to: number): { from: number; to: number } {
  const starts = lineStartsOf(text)
  const lo = Math.min(from, to)
  let hi = Math.max(from, to)
  if (hi > lo && text[hi - 1] === '\n') hi--
  return { from: lineAt(starts, lo), to: lineAt(starts, hi) }
}

/** What a selection capture needs: the note, its text right now, the range, its hash. */
export interface SelectionCapture {
  path: string
  /** The note's whole text at capture (the editor's doc = the live Y.Text). */
  text: string
  /** Character offsets into `text`. */
  from: number
  to: number
  /** `hashBytes` of the note's bytes as the backend serves them, when known. */
  hash?: string
  /** The range's `encodeRange` pair, when the note is enrolled. */
  anchor?: [unknown, unknown]
}

/** A selection → a `lines` mention, snapshotting the whole lines it touches. */
export function captureSelection(sel: SelectionCapture): Mention {
  const lines = linesOfRange(sel.text, sel.from, sel.to)
  const ref: VaultRef = { kind: 'lines', path: sel.path, lines }
  return {
    id: mentionId(),
    ref,
    label: mentionLabel(ref),
    snapshot: sliceLines(sel.text, lines.from, lines.to).text,
    ...(sel.hash ? { hash: sel.hash } : {}),
    ...(sel.anchor ? { anchor: { yjs: sel.anchor } } : {}),
  }
}

export interface ResolvedMention {
  /** The mention as it goes to the model — re-pinned when its anchor moved. */
  mention: Mention
  /** What the reference covers now; null when the note is gone or the kind resolves lazily. */
  text: string | null
  /** The covered text (or, for a lazy kind, the note's hash) differs from what was captured. */
  changed: boolean
}

/**
 * Re-read a mention at send. `current` is the note's text now (null = gone);
 * `currentHash` its hash; `anchorRange` the decoded `anchor.yjs`, when there
 * is one (else the lines are taken as captured). The snapshot still goes
 * either way: `changed` is a badge, not a refusal.
 */
export function resolveMention(
  m: Mention,
  current: string | null,
  opts: { currentHash?: string; anchorRange?: { from: number; to: number } | null } = {}
): ResolvedMention {
  if (m.ref.kind !== 'lines') {
    const changed = !!(m.hash && opts.currentHash && m.hash !== opts.currentHash)
    return { mention: m, text: null, changed }
  }
  if (current === null) return { mention: m, text: null, changed: m.snapshot !== undefined }
  let mention = m
  if (opts.anchorRange) {
    const lines = linesOfRange(current, opts.anchorRange.from, opts.anchorRange.to)
    const ref: VaultRef = { ...m.ref, lines }
    mention = { ...m, ref, label: mentionLabel(ref) }
  }
  const lines = (mention.ref as Extract<VaultRef, { kind: 'lines' }>).lines
  const text = sliceLines(current, lines.from, lines.to).text
  return { mention, text, changed: m.snapshot !== undefined && text !== m.snapshot }
}
