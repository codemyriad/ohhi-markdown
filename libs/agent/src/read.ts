/**
 * The browser-safe half of the backend seam: the `VaultBackend` interface
 * every op is written against, and the two read helpers the ops share. No
 * Node import here — the app's in-process backend (`apps/web`'s
 * `createAppBackend`) and the harness's tools run in a browser, and they
 * reach this module through `@ohhi/agent/core`. The files backend
 * (`backend.ts`, Node) implements the interface.
 */
import type { Clock } from '@ohhi/testkit'
import type { IndexDoc, VaultIndex } from '@ohhi/index'
import { decodeFile, hashBytes, looksBinary, type PreImageJournal, type VaultAdapter } from '@ohhi/vault'
import { OpError, type Coverage } from './contract.js'
import { normalizeVaultPath } from './paths.js'

/** One file as the walk saw it. `kind` is the contract's, minus `dir`. */
export interface VaultFile {
  path: string
  size: number
  /** Epoch ms, or null when the platform would not say. */
  mtime: number | null
  kind: 'text' | 'binary'
}

export interface VaultBackend {
  /** Absolute, realpath'd. */
  readonly root: string
  readonly adapter: VaultAdapter
  readonly clock: Clock
  /** This tool's own journal — every write it makes is journaled here first. */
  readonly journal: PreImageJournal
  /** The app's journals, when the caller pointed at them: `restore`'s union. */
  readonly appJournals: readonly PreImageJournal[]
  /** Built once per process, cached. */
  index(): Promise<VaultIndex>
  /** path -> {guid, path, text} for every TEXT file. `guid` IS the path here. */
  docs(): Promise<ReadonlyMap<string, IndexDoc>>
  /** Every file, text and binary, with size/mtime. */
  files(): Promise<ReadonlyMap<string, VaultFile>>
  /** Every directory, deep, ignored ones excluded. */
  dirs(): Promise<readonly string[]>
  coverage(): Promise<Coverage>
  /**
   * What is at a vault path RIGHT NOW, ignored directories included.
   *
   * `files()`/`dirs()` cannot answer for `.trash/` — it is in `IGNORED_DIRS`,
   * so the adapter never lists it — and `rm` has to know whether the name it
   * is about to move onto is already taken.
   */
  exists(path: string): Promise<'file' | 'dir' | null>
  /** Milliseconds the index build took in this process (0 until it is built). */
  buildMs(): Promise<number>
  /**
   * A line for the human's stderr, written BEFORE a step whose crash would
   * otherwise leave no trace — `mv` names every note it is about to rewrite
   * before it moves anything. Never part of the answer; absent in a test.
   */
  trail?(line: string): void
}

/** Read a note's current bytes, decoded. Always from disk — never a cache. */
export async function readNote(
  backend: VaultBackend,
  path: string
): Promise<{ bytes: Uint8Array; text: string; eol: 'lf' | 'crlf' | 'raw'; bom: boolean; hash: string } | null> {
  const bytes = await backend.adapter.read(path)
  if (!bytes) return null
  const decoded = decodeFile(bytes)
  return { bytes, text: decoded.text, eol: decoded.eol, bom: decoded.bom, hash: hashBytes(bytes) }
}

/**
 * Resolve, read and refuse a note a READ op is about to serve — the mirror of
 * `openForWrite`, and the one place the reading vocabulary decides what "no
 * such note" and "not a text note" are called.
 */
export async function openForRead(
  backend: VaultBackend,
  rawPath: string
): Promise<{ path: string; size: number; hash: string; text: string }> {
  const path = normalizeVaultPath(rawPath)
  const note = await readNote(backend, path)
  if (!note) throw new OpError('not_found', `no such note: ${path}`, { path })
  if (looksBinary(path, note.bytes)) throw new OpError('refused', `not a text note: ${path}`, { path })
  return { path, size: note.bytes.length, hash: note.hash, text: note.text }
}
