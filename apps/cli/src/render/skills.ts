/** `skills` — one line per skill: name, kind/input/output, and what is wrong with it. */
import type { OpOutput } from '@ohhi/agent'
import { columnWidth, counters, kv, oneLine, type Sink } from './format.js'

export function renderSkills(o: OpOutput<'skills'>, sink: Sink): void {
  const width = columnWidth(o.skills, (s) => s.name, 32)
  for (const s of o.skills) {
    const shape = [s.kind, s.input, s.output].filter(Boolean).join('/')
    const flags = kv({ scripts: s.hasScripts ? true : undefined, problems: s.problems.length ? s.problems.join(',') : undefined })
    sink.out(`${s.name.padEnd(width)}  ${(shape || '-').padEnd(27)}  ${oneLine(s.description, 100)}${flags ? `  ${flags}` : ''}`)
  }
  counters(sink, o, { dir: o.dir })
  if (o.skills.some((s) => s.problems.length > 0)) sink.err('note: a skill with problems is never offered to a model — `ohhi skill <name>` shows why')
}
