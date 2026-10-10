/** Text renderers for collections: `collections`, `rows`. */
import type { OpOutput } from '@ohhi/agent'
import { columnWidth, counters, coverageNote, oneLine, type Sink } from './format.js'

export function renderCollections(o: OpOutput<'collections'>, sink: Sink): void {
  for (const c of o.collections) {
    sink.out(c.path)
    if (c.error) sink.out(`    unreadable: ${oneLine(c.error)}`)
    for (const v of c.views) {
      const flags = v.supported ? '' : `  (partly: ${v.reasons.map((r) => oneLine(r)).join('; ')})`
      sink.out(`    ${v.name.padEnd(24)} ${v.type.padEnd(7)} ${String(v.rows).padStart(5)} rows${flags}`)
    }
    for (const issue of c.issues) sink.out(`    note: ${oneLine(issue)}`)
  }
  counters(sink, o)
  coverageNote(sink, o.coverage)
}

type Cell = OpOutput<'rows'>['rows'][number]['values'][string]

function cellText(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map((i) => (i === null ? '' : String(i))).join(', ')
  return String(v)
}

/**
 * One row per line: the PATH first — it is the reference `read` takes, and
 * names collide across folders — then the columns, clipped so one long
 * value cannot shove the rest.
 */
export function renderRows(o: OpOutput<'rows'>, sink: Sink): void {
  const cols = o.columns.filter((c) => c !== 'file.name' && c !== 'file.basename' && c !== 'file.path')
  const widths = new Map<string, number>()
  for (const c of cols) widths.set(c, Math.max(c.length, columnWidth(o.rows, (r) => cellText(r.values[c]), 32)))
  const pathWidth = Math.max(4, columnWidth(o.rows, (r) => r.path, 60))
  const line = (path: string, cells: string[]): string =>
    [path.padEnd(pathWidth), ...cells.map((text, i) => clip(text, widths.get(cols[i]) ?? 0).padEnd(widths.get(cols[i]) ?? 0))]
      .join('  ')
      .trimEnd()
  sink.out(line('path', cols))
  for (const r of o.rows) sink.out(line(r.path, cols.map((c) => cellText(r.values[c]))))
  counters(sink, o, { collection: o.collection ?? undefined, view: o.view ?? undefined })
  for (const reason of o.reasons) sink.err(`note: ${oneLine(reason)}`)
  coverageNote(sink, o.coverage)
}

function clip(text: string, width: number): string {
  return text.length > width ? text.slice(0, Math.max(0, width - 1)) + '…' : text
}
