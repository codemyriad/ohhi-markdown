/**
 * The credential rule for a room, and the URL normaliser it rests on — pure,
 * host-neutral, and the ONE copy (device-link N3 review).
 *
 * It lived in `apps/web/src/lib/workspace.svelte.ts` while the device-link
 * harness kept a paraphrase of it in `libs/workspace/test/`, because a test in
 * this package cannot import the web app. The paraphrase drifted: it compared
 * relay URLs with raw `===`, so `wss://relay.example` and
 * `wss://relay.example/` were different relays to the harness and the same one
 * to the shim. A harness that exists to catch the shim drifting must not be a
 * second implementation of the rule it is checking, so the rule moved here and
 * both sides import it.
 */
import type { MountProvenance } from '@ohhi/vault'
import type { RelayConfig } from './types.js'

/** What kind of thing a stored token is (mirrors the relay's `ShareKind`). */
export type TokenKind = 'folder' | 'device' | ''

/**
 * Do these two URLs name the same relay? Trailing slashes and case are noise;
 * host and port are not.
 *
 * (`apps/web/src/lib/share-status.ts` keeps its own copy for the TREE tint —
 * that one is about how a mount is drawn, this one gates a credential. They
 * agree by construction because they are the same six lines; if they ever have
 * to stop agreeing, this is the one that decides who gets a token.)
 */
export function sameRelay(a: string, b: string): boolean {
  const norm = (url: string): string => {
    const trimmed = url.trim().replace(/\/+$/, '')
    try {
      const parsed = new URL(trimmed)
      return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase()
    } catch {
      return trimmed.toLowerCase()
    }
  }
  return !!a && !!b && norm(a) === norm(b)
}

/**
 * The credential for a room, in the order spike S10 Q2 fixes (R5 lives here):
 *
 *  1. an exact token for the room always wins — it is the most specific
 *     statement of what this device was given, and may be read-only for
 *     exactly that folder;
 *  2. else, for a `carved`/`adopted` room **that lives on THIS vault's own
 *     relay**, the vault's own token when it is a DEVICE token — A4-A, the
 *     reason a folder carved after linking needs no paste;
 *  3. else none ⇒ `needs-token`.
 *
 * Rule 2's relay condition is R5, not decoration. Provenance alone cannot
 * separate "carved out of my vault" from "a foreign share another of my
 * devices joined" — on a peer BOTH are `'adopted'` — and a `kind:'mount'`
 * entry is written by any peer of the root room, which chooses the entry's
 * `relay` field freely (maps are advisory, never an auth source: shaping D4).
 * Without the condition a peer of the root could write
 * `{kind:'mount', relay:'wss://elsewhere'}` into the folder map and this
 * device would open a socket there and hand over the VAULT's device token — a
 * full-access credential for every room of this vault.
 *
 * Rule 2 returns the ROOT's relay URL, not the entry's. They compare equal
 * under `sameRelay`, so returning the entry's was harmless until it wasn't:
 * a near match (`wss://relay.example/` vs `wss://relay.example`) would have
 * persisted the attacker-chosen spelling into mounts.json and into every
 * provider URL. The token is the vault's; so is the address it is sent to.
 */
export function resolveRoomRelay(m: {
  /** Where this room lives, already resolved (entry relay ▸ remembered ▸ default). */
  url: string
  provenance: MountProvenance
  /** This device's token for THIS room ('' = none). */
  exactToken: string
  /** This device's token for the VAULT's root room ('' = none). */
  rootToken: string
  rootTokenKind: TokenKind
  /** This vault's own relay — the one its rooms are minted on. */
  rootRelayUrl: string
}): RelayConfig | null {
  if (m.exactToken) return { url: m.url, token: m.exactToken }
  const ancestryEligible = m.provenance === 'carved' || m.provenance === 'adopted'
  if (
    ancestryEligible &&
    sameRelay(m.url, m.rootRelayUrl) &&
    m.rootToken &&
    m.rootTokenKind === 'device'
  ) {
    return { url: m.rootRelayUrl, token: m.rootToken }
  }
  return null
}
