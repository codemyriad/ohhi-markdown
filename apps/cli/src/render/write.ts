/**
 * Text renderers for the writing vocabulary. Every one of these lines
 * describes a disk write that was journaled first and written
 * temp-fsync-rename (golden rule 1) — `journalSeq` is the handle
 * `ohhi restore` takes back.
 */
import type { OpOutput } from '@editor/agent'
import { bytes, columnWidth, kv, pad, padStart, type Sink } from './format.js'

const verb = (dryRun: boolean, done: string, would: string): string => (dryRun ? `would ${would}` : done)

export function renderWrite(o: OpOutput<'write'>, sink: Sink): void {
  sink.out(`${verb(o.dryRun, o.created ? 'created' : 'wrote', o.created ? 'create' : 'overwrite')} ${o.path}`)
  sink.err(kv({ bytes: o.bytes, hash: o.hash, journalSeq: o.journalSeq ?? 'none', dryRun: o.dryRun || undefined }))
  if (!o.dryRun && o.journalSeq !== null) sink.err(`undo with: ohhi restore ${o.path} --seq ${o.journalSeq}`)
}

export function renderPatch(o: OpOutput<'patch'>, sink: Sink): void {
  sink.out(`${verb(o.dryRun, 'patched', 'patch')} ${o.path} (${o.replaced} replacement${o.replaced === 1 ? '' : 's'})`)
  sink.err(kv({ hash: o.hash, journalSeq: o.journalSeq ?? 'none', dryRun: o.dryRun || undefined }))
  if (!o.dryRun && o.journalSeq !== null) sink.err(`undo with: ohhi restore ${o.path} --seq ${o.journalSeq}`)
}

export function renderAppend(o: OpOutput<'append'>, sink: Sink): void {
  sink.out(`${verb(o.dryRun, 'appended to', 'append to')} ${o.path} at line ${o.line}`)
  sink.err(kv({ hash: o.hash, journalSeq: o.journalSeq ?? 'none', dryRun: o.dryRun || undefined }))
  if (!o.dryRun && o.journalSeq !== null) sink.err(`undo with: ohhi restore ${o.path} --seq ${o.journalSeq}`)
}

export function renderMv(o: OpOutput<'mv'>, sink: Sink): void {
  sink.out(`${verb(o.dryRun, 'moved', 'move')} ${o.from} -> ${o.to}`)
  sink.err(kv({ files: o.files, dryRun: o.dryRun || undefined }))
}

export function renderRm(o: OpOutput<'rm'>, sink: Sink): void {
  sink.out(`${verb(o.dryRun, 'trashed', 'trash')} ${o.path} -> ${o.trashedTo}`)
  sink.err(kv({ files: o.files, dryRun: o.dryRun || undefined }))
  sink.err('note: nothing is unlinked — the file is in .trash/ until you empty it')
}

export function renderRestore(o: OpOutput<'restore'>, sink: Sink): void {
  if (o.entries) {
    const width = columnWidth(o.entries, (e) => e.at, 30)
    for (const e of o.entries) {
      sink.out(`${padStart(`seq=${e.seq}`, 9)}  ${pad(e.at, width)}  ${padStart(bytes(e.size), 6)}  source=${e.source}`)
    }
    sink.err(kv({ path: o.path, entries: o.entries.length }))
    if (o.entries.length === 0) sink.err('note: no pre-images — this tool has not written that note')
    else sink.err(`restore one with: ohhi restore ${o.path} --seq <seq>`)
    return
  }
  if (o.restored) {
    sink.out(`${verb(o.dryRun, 'restored', 'restore')} ${o.path} from seq=${o.restored.seq} (${o.restored.bytes} bytes)`)
    sink.err(kv({ hash: o.restored.hash, dryRun: o.dryRun || undefined }))
  }
}
