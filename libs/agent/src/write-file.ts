/**
 * The ONE write path (golden rule 1). `write`, `patch`, `append`, `rm` and
 * `restore` all come through here, so the sequence is impossible to get
 * wrong or to do differently in one op:
 *
 *   1. Read the CURRENT bytes from disk (never a cache).
 *   2. Refuse on `expectHash` mismatch — exit 3, nothing touched.
 *   3. Journal those bytes as a pre-image, durably, BEFORE anything is written.
 *   4. Write temp-fsync-rename, in the note's own EOL flavour and BOM
 *      (golden rule 2: an agent editing one line must not rewrite 1,200 line
 *      endings and turn a one-line change into a whole-file git diff), as a
 *      COMPARE-AND-SWAP against the bytes step 1 read.
 *
 * Step 4's swap matters for the same reason Editor's own reconciler needs one
 * (Spike S11 finding F1): steps 1 and 4 are not one atomic act — the durable
 * journal write sits between them — so a human saving in Editor, or git, or a
 * second `ohhi`, can land inside the window. Without the swap those bytes are
 * overwritten and survive nowhere: the journal holds the pre-image from step 1,
 * not theirs. With it, the write is refused as a `conflict` and nothing is
 * lost. `--expect-hash` guards against a change since the agent LAST READ;
 * this guards the invocation's own window, and is not optional.
 *
 * `dryRun` runs 1 and 2 and then stops: it reports exactly what would happen
 * and records nothing, which is what makes it safe to suggest to an agent
 * that is unsure.
 */
import {
  hashBytes,
  looksBinary,
  renderFile,
  WriteConflictError,
  type EolFlavor,
  type PreImageJournal,
} from '@ohhi/vault'
import type { VaultBackend } from './backend.js'
import { readNote } from './backend.js'
import { OpError } from './contract.js'
import { isMarkdown, normalizeVaultPath } from './paths.js'

export interface NoteForWrite {
  path: string
  exists: boolean
  /** `''` for a note that does not exist yet. */
  text: string
  eol: EolFlavor
  bom: boolean
  bytes: Uint8Array | null
  hash: string | null
}

/**
 * Resolve, refuse and read a note a write op is about to change.
 *
 * Non-`.md` is `refused` rather than written: this surface edits NOTES. An
 * attachment, a `.canvas`, a stylesheet — all of those have an owner that is
 * not a text patcher, and `mv`/`rm` can still move them.
 */
export async function openForWrite(
  backend: VaultBackend,
  rawPath: string,
  expectHash?: string
): Promise<NoteForWrite> {
  const path = normalizeVaultPath(rawPath)
  if (!isMarkdown(path)) {
    throw new OpError('refused', `not a markdown note: ${path}`, { path })
  }
  const current = await readNote(backend, path)
  if (expectHash !== undefined && (current?.hash ?? null) !== expectHash) {
    throw new OpError('conflict', `${path} changed since you read it — read it again and retry`, {
      path,
      expected: expectHash,
      actual: current?.hash ?? null,
    })
  }
  return current
    ? { path, exists: true, text: current.text, eol: current.eol, bom: current.bom, bytes: current.bytes, hash: current.hash }
    : { path, exists: false, text: '', eol: 'lf', bom: false, bytes: null, hash: null }
}

export interface Committed {
  created: boolean
  bytes: number
  hash: string
  /** Journal sequence of the pre-image; null when the note was new or on a dry run. */
  journalSeq: number | null
}

/** Journal-then-write. The only place this package writes a note. */
export async function commit(
  backend: VaultBackend,
  note: NoteForWrite,
  nextText: string,
  dryRun: boolean
): Promise<Committed> {
  const bytes = renderFile(nextText, note.eol, note.bom)
  if (looksBinary(note.path, bytes)) {
    throw new OpError('refused', `refusing to write binary content to ${note.path}`, { path: note.path })
  }
  const result: Committed = {
    created: !note.exists,
    bytes: bytes.length,
    hash: hashBytes(bytes),
    journalSeq: null,
  }
  if (dryRun) return result
  if (note.exists && note.bytes) {
    result.journalSeq = await recordPreImage(backend.journal, note.path, note.bytes)
  }
  // `''` is "there was no file here", the same spelling `LcaRecord.contentHash`
  // and every adapter use for absent.
  await writeSwapping(backend, note.path, bytes, note.hash ?? '')
  return result
}

/** The compare-and-swap, with the adapter's error translated to the contract's. */
export async function writeSwapping(
  backend: VaultBackend,
  path: string,
  bytes: Uint8Array,
  expectHash: string
): Promise<void> {
  try {
    await backend.adapter.writeAtomic(path, bytes, { expectHash })
  } catch (err) {
    if (err instanceof WriteConflictError) {
      throw new OpError('conflict', `${path} changed while this write was in flight — nothing was written; read it again and retry`, {
        path,
        expected: err.expected || null,
        actual: err.actual || null,
      })
    }
    throw err
  }
}

/**
 * Record a pre-image and report its sequence.
 *
 * `PreImageJournal.record` returns void — the seq is allocated inside it —
 * so the number the contract promises comes from the metadata listing
 * immediately after. `list()` reads no entry bytes, so this costs a directory
 * read, not a copy of the retention window.
 */
export async function recordPreImage(
  journal: PreImageJournal,
  path: string,
  bytes: Uint8Array
): Promise<number | null> {
  await journal.record(path, bytes)
  const entries = await journal.list(path)
  return entries.length ? entries[entries.length - 1].seq : null
}
