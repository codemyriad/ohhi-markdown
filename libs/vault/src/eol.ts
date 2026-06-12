/**
 * EOL/BOM policy (shape D2): uniform-CRLF files are normalized to LF inside
 * the CRDT and restored on write; anything mixed is 'raw' — CRDT text equals
 * the decoded bytes verbatim, so round-trip is identity by construction.
 * Blocking L1 invariant: render(decode(bytes)) === bytes for unedited files.
 */
import type { EolFlavor } from './types.js'

const BOM = 0xfeff

export interface DecodedText {
  text: string
  eol: EolFlavor
  bom: boolean
}

export function decodeFile(bytes: Uint8Array): DecodedText {
  // ignoreBOM keeps a leading BOM in the output (default silently strips it,
  // which would make the bom flag impossible to detect).
  let raw = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
  let bom = false
  if (raw.charCodeAt(0) === BOM) {
    bom = true
    raw = raw.slice(1)
  }
  const crlfCount = (raw.match(/\r\n/g) ?? []).length
  const lfTotal = (raw.match(/\n/g) ?? []).length
  const loneCr = /\r(?!\n)/.test(raw)

  if (!loneCr && crlfCount > 0 && crlfCount === lfTotal) {
    return { text: raw.replaceAll('\r\n', '\n'), eol: 'crlf', bom }
  }
  if (!loneCr && crlfCount === 0) {
    return { text: raw, eol: 'lf', bom }
  }
  // Mixed/odd line endings: store verbatim, never transform.
  return { text: raw, eol: 'raw', bom }
}

export function renderFile(text: string, eol: EolFlavor, bom: boolean): Uint8Array {
  let out = text
  if (eol === 'crlf') out = out.replaceAll('\n', '\r\n')
  if (bom) out = '﻿' + out
  return new TextEncoder().encode(out)
}
