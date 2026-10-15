/** Text renderers for the reading vocabulary: `ls`, `read`, `fm`, `stats`, `changes`. */
import type { OpOutput } from '@ohhi/agent'
import { bytes, columnWidth, counters, coverageNote, kv, oneLine, type Sink } from './format.js'
import { wroteNote } from './write.js'

export function renderLs(o: OpOutput<'ls'>, sink: Sink): void {
  const width = columnWidth(o.items, (i) => i.path)
  for (const item of o.items) {
    const tail = kv({ size: item.kind === 'dir' ? undefined : bytes(item.size), mtime: item.mtime })
    sink.out(`${item.kind.padEnd(6)} ${item.path.padEnd(width)}${tail ? '  ' + tail : ''}`.trimEnd())
  }
  counters(sink, o, { dir: o.dir === '' ? '.' : o.dir })
  coverageNote(sink, o.coverage)
}

export function renderRead(o: OpOutput<'read'>, sink: Sink): void {
  if (o.mode === 'outline') {
    const entries = o.outline ?? []
    for (const h of entries) {
      sink.out(`${String(h.line).padStart(6)}  ${'  '.repeat(h.level - 1)}${'#'.repeat(h.level)} ${h.text}  (${h.chars} chars)`)
    }
    sink.err(kv({ path: o.path, headings: entries.length, size: bytes(o.size), hash: o.hash }))
    if (entries.length === 0) sink.err('note: no headings — read it with --lines or --max-chars')
    return
  }
  if (o.mode === 'frontmatter') {
    renderFrontmatterBlock(o.frontmatter, sink)
    sink.err(kv({ path: o.path, hash: o.hash }))
    return
  }
  sink.raw(o.text ?? '')
  if (o.text !== undefined && !o.text.endsWith('\n')) sink.raw('\n')
  sink.err(kv({ path: o.path, mode: o.mode, size: bytes(o.size), hash: o.hash, from: o.from, to: o.to }))
  if (o.truncated) {
    sink.err(`truncated at line ${o.nextLine ?? '?'} — continue with --lines ${o.nextLine ?? '?'}-<to>, or narrow with --outline`)
  }
}

export function renderFm(o: OpOutput<'fm'>, sink: Sink): void {
  if (o.ops > 0) {
    // A write (or a dry run of one) says what it did before showing the block.
    const keys = `${o.ops} key${o.ops === 1 ? '' : 's'}`
    sink.out(o.dryRun ? `would change ${o.path} (${keys})${o.changed ? '' : ' — nothing would change'}` : o.changed ? `changed ${o.path} (${keys})` : `${o.path} already said so (${keys}, nothing written)`)
  }
  renderFrontmatterBlock(o.frontmatter, sink)
  sink.err(kv({ path: o.path, present: o.frontmatter.present, supported: o.frontmatter.supported, hash: o.ops > 0 ? undefined : o.hash }))
  if (o.ops > 0) wroteNote(sink, o)
}

function renderFrontmatterBlock(fm: OpOutput<'fm'>['frontmatter'] | undefined, sink: Sink): void {
  if (!fm || !fm.present) {
    sink.err('note: this note has no frontmatter block')
    return
  }
  if (!fm.supported || !fm.entries) {
    sink.raw(fm.raw ?? '')
    if (fm.raw !== undefined && !fm.raw.endsWith('\n')) sink.raw('\n')
    sink.err('note: nested YAML — shown raw; the flat-subset reader did not parse it')
    return
  }
  const width = columnWidth(fm.entries, (e) => e.key, 24)
  for (const e of fm.entries) {
    const value = Array.isArray(e.value) ? `[${e.value.map((v) => String(v)).join(', ')}]` : String(e.value)
    sink.out(`${String(e.line).padStart(4)}  ${`${e.key}:`.padEnd(width + 1)} ${value}  (${e.type})`)
  }
}

export function renderStats(o: OpOutput<'stats'>, sink: Sink): void {
  sink.out(`vault=${o.vault}`)
  sink.out(kv({ docs: o.docs, terms: o.terms, links: o.links, unresolved: o.unresolved, tags: o.tags }))
  sink.out(kv({ skippedBinary: o.skippedBinary, ignored: o.ignored.join(',') || 'none' }))
  sink.err(kv({ buildMs: Math.round(o.buildMs), indexSchemaVersion: o.indexSchemaVersion }))
}

export function renderChanges(o: OpOutput<'changes'>, sink: Sink): void {
  const width = columnWidth(o.changes, (c) => c.at, 30)
  for (const c of o.changes) {
    sink.out(`${c.at.padEnd(width)}  ${c.kind.padEnd(9)}  ${c.path}${c.seq === undefined ? '' : `  seq=${c.seq}`}`)
  }
  counters(sink, o, { since: o.since })
  sink.err(`cursorSince=${o.cursorSince} — pass it back as --since to continue from here`)
  if (o.changes.length === 0) sink.err(oneLine('note: nothing changed since then'))
}
