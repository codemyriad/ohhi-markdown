/**
 * Report a problem (first-run-shaping E3): one sentence from the person plus
 * the facts `docs/guide/recovery.md` asks for, as plain text to paste in the
 * team chat. The app copies it to the clipboard and sends it nowhere
 * (Question 4, answered: clipboard only).
 *
 * NEVER note content. Every line is built from metadata the shell already
 * shows: the build, the platform, the vault's name and kind, the relay's
 * host and state, the open note's PATH and `pillStatus` in the pill's own
 * words (golden rule 4), a count of people online, and the Log's own one-line
 * rendering of its last events (`describeEvent`: codes, paths, names, error
 * messages — the event model carries no text of a note; `doc.changed` carries
 * only counts of characters). Pure, so the test pins every line.
 */
import { getLL, type TranslationFunctions } from '@ohhi/i18n'
import type { AppEvent, RelayState } from '@ohhi/workspace'
import { describeEvent } from './event-text.js'
import { eventWhere } from './log-view.js'
import { pillTitle, type PillStatus } from './pill-status.js'

/** How many of the Log's newest events the report carries. */
export const REPORT_EVENTS = 20

export type ReportVaultKind = 'tauri' | 'opfs' | 'memory'

export interface ReportFacts {
  /** The running build's version; null when not known. */
  version: string | null
  desktop: boolean
  /** The operating system, when cheaply known (`navigator.userAgentData` / `platform`). */
  os: string | null
  vault: { name: string; kind: ReportVaultKind } | null
  /** The shared snapshot's relays (`sharedSnapshot(...).relays`). */
  relays: readonly { host: string; state: RelayState; reason?: string; inSyncSince?: number; lastInSyncAt?: number }[]
  /** The focused note; `status` null when it has no sync record (nothing shared). */
  note: { path: string; status: PillStatus | null } | null
  /** Other people online across the vault's rooms (what the sync icon counts). */
  people: number
  /** The session's events, newest first (`workspace.ui.events`). */
  events: readonly AppEvent[]
}

const iso = (at: number): string => new Date(at).toISOString()

/** One relay in words: the Shared view's state word and, when known, its green span. */
function relayLine(r: ReportFacts['relays'][number], LL: TranslationFunctions): string {
  const t = LL.web.help.report
  const s = LL.web.shared.relay
  const state = r.state === 'refused' && r.reason ? s.refused_reason({ reason: r.reason }) : s.state[r.state]()
  if (r.inSyncSince !== undefined) return t.relay_since({ host: r.host, state, since: s.in_sync({ when: iso(r.inSyncSince) }) })
  if (r.lastInSyncAt !== undefined) return t.relay_since({ host: r.host, state, since: s.last_in_sync({ when: iso(r.lastInSyncAt) }) })
  return t.relay({ host: r.host, state })
}

/** One event as the report prints it: time, level, kind, where, then the Log's own words. */
export function eventLine(e: AppEvent, LL: TranslationFunctions = getLL()): string {
  const where = eventWhere(e, LL)
  const parts = [iso(e.at), LL.web.log.level_name[e.level](), e.kind, ...(where ? [where] : []), describeEvent(e, LL)]
  if (e.count > 1) parts.push(LL.web.log.repeated({ count: e.count }))
  return parts.join('  ')
}

/** The "Attached automatically" lines, in order — what the dialog shows and the copy carries. */
export function reportFactLines(f: ReportFacts, LL: TranslationFunctions = getLL()): string[] {
  const t = LL.web.help.report
  const platform = t.platform[f.desktop ? 'desktop' : 'browser']()
  const lines: string[] = [
    t.app({
      version: f.version ?? t.version_unknown(),
      platform: f.os ? t.platform_os({ platform, os: f.os }) : platform,
    }),
    f.vault ? t.vault({ name: f.vault.name, kind: t.vault_kind[f.vault.kind]() }) : t.vault_none(),
  ]
  if (f.relays.length === 0) lines.push(t.relay_none())
  for (const r of f.relays) lines.push(relayLine(r, LL))
  lines.push(
    f.note
      ? t.note({
          path: f.note.path,
          status: f.note.status ? pillTitle(f.note.status) : t.note_unshared(),
          people: t.people({ count: f.people }),
        })
      : t.note_none()
  )
  const errors = f.events.filter((e) => e.level === 'error').length
  const warnings = f.events.filter((e) => e.level === 'warn').length
  lines.push(t.counts({ errors: t.errors({ count: errors }), warnings: t.warnings({ count: warnings }) }))
  const last = f.events.slice(0, REPORT_EVENTS)
  if (last.length === 0) lines.push(t.events_none())
  else {
    lines.push(t.events({ count: last.length }))
    for (const e of last) lines.push(`  ${eventLine(e, LL)}`)
  }
  return lines
}

/** The whole report: a header with the time, the person's sentence, then the facts. */
export function reportText(what: string, f: ReportFacts, now: number, LL: TranslationFunctions = getLL()): string {
  const t = LL.web.help.report
  const said = what.trim().replace(/\s+/g, ' ')
  return [t.header({ time: iso(now) }), said ? t.what({ text: said }) : t.what_empty(), '', ...reportFactLines(f, LL)].join(
    '\n'
  )
}

/** The OS, if the browser says so cheaply; null otherwise. */
export function detectOs(nav: Navigator | undefined = globalThis.navigator): string | null {
  if (!nav) return null
  const data = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const os = data?.platform || nav.platform || ''
  return os.trim() || null
}
