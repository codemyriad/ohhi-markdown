import { presenceColor, PRESENCE_SLOTS } from '@ohhi/ui/tokens'
import { parseLayoutChoice, parseLayoutParam, type LayoutChoice } from './layout.js'

/**
 * URL-param modes — the contract Playwright L2 drives:
 *   ?mode=memory&role=seed&relay=ws://localhost:PORT&room=FOLDERGUID&token=TOK&user=Alice
 *   ?mode=memory&role=join&...
 * No params → landing screen.
 */

export interface MemoryModeConfig {
  mode: 'memory'
  role: 'seed' | 'join'
  relay: string
  room: string
  token: string
  user: string
}

export type AppConfig =
  | { kind: 'landing' }
  | { kind: 'error'; message: string }
  | ({ kind: 'memory' } & MemoryModeConfig)

export function parseAppConfig(params: URLSearchParams): AppConfig {
  const mode = params.get('mode')
  if (mode === null) return { kind: 'landing' }
  if (mode !== 'memory') {
    return { kind: 'error', message: `unsupported mode "${mode}" (V1 dev shell supports mode=memory)` }
  }
  const role = params.get('role') ?? 'seed'
  if (role !== 'seed' && role !== 'join') {
    return { kind: 'error', message: `role must be "seed" or "join", got "${role}"` }
  }
  const relay = params.get('relay')
  const room = params.get('room')
  if (!relay || !room) {
    return { kind: 'error', message: 'mode=memory requires relay=ws://… and room=FOLDERGUID params' }
  }
  return {
    kind: 'memory',
    mode: 'memory',
    role,
    relay,
    room,
    token: params.get('token') ?? '',
    user: params.get('user') ?? 'Anonymous',
  }
}

/** App-wide URL params, beside the memory-mode contract above. */
export interface AppParams {
  /**
   * `?layout=default|dense|custom:<name>` — a SESSION-only layout choice (`dense` is the example file, `parseLayoutParam`)
   * that wins over the device's stored one (foundations Stage 1, spike S21:
   * the e2e fixtures force `dense`, whose navigator column every existing
   * spec waits for). Held in sessionStorage so it survives the shell's own
   * URL clean-up and a reload in the same tab; a pick in Settings clears it.
   */
  layout: { get(): LayoutChoice | null; clear(): void }
}

const K_LAYOUT_PARAM = 'ohhi:layout'

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null
  } catch {
    return null
  }
}

export function parseAppParams(params: URLSearchParams, store: Storage | null = sessionStore()): AppParams {
  const given = parseLayoutParam(params.get('layout'))
  if (given) {
    try {
      store?.setItem(K_LAYOUT_PARAM, given)
    } catch {
      /* private mode — the param still holds for this page */
    }
  }
  let held = given ?? parseLayoutChoice(store?.getItem(K_LAYOUT_PARAM) ?? null)
  return {
    layout: {
      get: () => held,
      clear: () => {
        held = null
        try {
          store?.removeItem(K_LAYOUT_PARAM)
        } catch {
          /* nothing held */
        }
      },
    },
  }
}

/**
 * Stable per-name presence slot (0..PRESENCE_SLOTS-1). The COLOUR for a slot
 * is a theme token, not a constant: a palette tuned for a white page vibrates
 * on #2e3440, and one of the old hardcoded values sat close enough to the
 * diverged red to be mistakable for a conflict marker.
 */
export function colorSlot(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % PRESENCE_SLOTS
}

/**
 * Stable per-name cursor/presence colour, read from the ACTIVE theme.
 *
 * NOTE (V2): y-codemirror.next writes this as an inline style from the
 * awareness `user.color` field, so a peer already on screen keeps the colour
 * their own client published. Making every viewer resolve peers against their
 * own theme means sending a slot index rather than a hex — an awareness
 * WIRE-FORMAT change that needs a version-tolerant reader, sequenced with the
 * y-codemirror.next vendoring already flagged as TODO(V2) in binding.ts.
 */
export function colorFor(name: string): string {
  return presenceColor(colorSlot(name))
}
