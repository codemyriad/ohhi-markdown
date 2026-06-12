import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

export function hashBytes(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes))
}

export function hashText(text: string): string {
  return hashBytes(new TextEncoder().encode(text))
}
