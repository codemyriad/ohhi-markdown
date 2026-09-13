/**
 * op → text renderer. `--json` does not come through here at all: it prints
 * the contract document verbatim, which is the point of having a contract.
 */
import type { OpName, OpOutput } from '@ohhi/agent'
import type { Sink } from '../io.js'
import { renderChanges, renderFm, renderLs, renderRead, renderStats } from './read.js'
import { renderBacklinks, renderLinks, renderResolve, renderTags, renderUnresolved } from './graph.js'
import { renderSearch } from './search.js'
import { renderAppend, renderMv, renderPatch, renderRestore, renderRm, renderWrite } from './write.js'

type Renderer<N extends OpName> = (out: OpOutput<N>, sink: Sink) => void

export const RENDERERS: { [N in OpName]: Renderer<N> } = {
  ls: renderLs,
  read: renderRead,
  search: renderSearch,
  links: renderLinks,
  backlinks: renderBacklinks,
  unresolved: renderUnresolved,
  tags: renderTags,
  resolve: renderResolve,
  stats: renderStats,
  changes: renderChanges,
  write: renderWrite,
  patch: renderPatch,
  append: renderAppend,
  fm: renderFm,
  mv: renderMv,
  rm: renderRm,
  restore: renderRestore,
}

/**
 * Notes that belong on stderr in BOTH modes — the honesty counters a `--json`
 * consumer already has in the document, but a human piping to `jq` would
 * otherwise never see.
 */
export function jsonModeNotes(out: unknown, sink: Sink): void {
  const doc = out as { coverage?: { skippedBinary: number }; truncated?: boolean; nextLine?: number; nextCursor?: string | null }
  if (doc.coverage && doc.coverage.skippedBinary > 0) sink.err(`note: ${doc.coverage.skippedBinary} binaries skipped`)
  if (doc.truncated === true) sink.err(`note: truncated at line ${doc.nextLine ?? '?'}`)
  if (doc.nextCursor) sink.err('note: more results — pass nextCursor back as --cursor')
}

export function renderText(op: OpName, out: unknown, sink: Sink): void {
  ;(RENDERERS[op] as Renderer<OpName>)(out as OpOutput<OpName>, sink)
}
