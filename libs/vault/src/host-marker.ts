/**
 * The host marker's format (nextcloud-build decision 13): `ohhi-host.md` at a
 * vault root (`OHHI_HOST_MARKER`), written by the Nextcloud custodian as its
 * lease and read by the desktop manager to refuse a folder another host
 * already holds. One reader and one writer here, so the two hosts cannot
 * drift on the frontmatter they agree on: flat `room`, `vault`, `epoch`,
 * `instance`, `heartbeat`, then one sentence of body.
 */

export interface HostMarker {
  room: string
  vault: string
  epoch: number
  instance: string
  heartbeat: string
}

const BODY =
  'This folder is kept in sync by Oh Hi on this Nextcloud. Leave this file in place: it tells other Oh Hi hosts the folder is already held.'

export function formatHostMarker(m: HostMarker): Uint8Array {
  const text =
    `---\nroom: ${m.room}\nvault: ${m.vault}\nepoch: ${m.epoch}\ninstance: ${m.instance}\nheartbeat: ${m.heartbeat}\n---\n\n${BODY}\n`
  return new TextEncoder().encode(text)
}

/** The flat frontmatter subset `formatHostMarker` writes; null when the bytes are not a marker. */
export function parseHostMarker(bytes: Uint8Array): HostMarker | null {
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const fields: Record<string, string> = {}
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line)
    if (kv) fields[kv[1]!] = (kv[2] ?? '').replace(/^["']|["']$/g, '')
  }
  const epoch = Number(fields.epoch)
  if (!fields.room || !fields.vault || !fields.instance || !Number.isInteger(epoch)) return null
  return { room: fields.room, vault: fields.vault, epoch, instance: fields.instance, heartbeat: fields.heartbeat ?? '' }
}
