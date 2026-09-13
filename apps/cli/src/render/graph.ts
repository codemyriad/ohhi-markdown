/** Text renderers for the link graph: `links`, `backlinks`, `unresolved`, `tags`, `resolve`. */
import type { OpOutput } from '@ohhi/agent'
import { columnWidth, counters, kv, oneLine, type Sink } from './format.js'

export function renderLinks(o: OpOutput<'links'>, sink: Sink): void {
  for (const l of o.links) {
    sink.out(
      kv({
        line: l.line,
        target: JSON.stringify(l.target),
        resolved: l.resolved ?? 'UNRESOLVED',
        alias: l.alias ?? undefined,
        anchor: l.anchor ?? undefined,
        embed: l.embed ? true : undefined,
      })
    )
    sink.out(`    ${oneLine(l.context)}`)
  }
  counters(sink, o, { path: o.path })
}

export function renderBacklinks(o: OpOutput<'backlinks'>, sink: Sink): void {
  for (const b of o.backlinks) {
    sink.out(kv({ path: b.path, line: b.line, alias: b.alias ?? undefined, anchor: b.anchor ?? undefined }))
    sink.out(`    ${oneLine(b.context)}`)
  }
  counters(sink, o, { target: JSON.stringify(o.target) })
}

export function renderUnresolved(o: OpOutput<'unresolved'>, sink: Sink): void {
  for (const l of o.links) {
    sink.out(kv({ target: JSON.stringify(l.target), in: `${l.path}:${l.line}`, embed: l.embed ? true : undefined }))
    sink.out(`    ${oneLine(l.context)}`)
  }
  counters(sink, o)
  if (o.links.some((l) => l.embed)) sink.err('note: an unresolved embed is a missing attachment, not a note to create')
}

export function renderTags(o: OpOutput<'tags'>, sink: Sink): void {
  const width = columnWidth(o.tags, (t) => t.tag, 32)
  for (const t of o.tags) sink.out(`${t.tag.padEnd(width)}  ${String(t.notes).padStart(5)}`)
  counters(sink, o)
}

export function renderResolve(o: OpOutput<'resolve'>, sink: Sink): void {
  if (o.path === null) {
    sink.err(`no note in this vault matches ${JSON.stringify(o.target)} — see \`ohhi unresolved\``)
    return
  }
  sink.out(o.path)
}
