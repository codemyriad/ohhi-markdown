/** `skill <name>` — the facts on stderr, the instructions (SKILL.md's body) on stdout. */
import type { OpOutput } from '@ohhi/agent'
import { kv, type Sink } from './format.js'

export function renderSkill(o: OpOutput<'skill'>, sink: Sink): void {
  const m = o.meta
  sink.raw(o.body.endsWith('\n') || o.body === '' ? o.body : `${o.body}\n`)
  sink.err(
    kv({
      name: m.name,
      dir: m.dir,
      kind: m.kind,
      input: m.input,
      output: m.output,
      license: m.license,
      scripts: m.hasScripts ? true : undefined,
    })
  )
  sink.err(`description: ${m.description}`)
  if (m.problems.length > 0) sink.err(`problems: ${m.problems.join(', ')} — never offered to a model until fixed`)
  if (m.hasScripts) sink.err('note: this skill ships scripts/ — the app never runs them; a Node host may')
}
