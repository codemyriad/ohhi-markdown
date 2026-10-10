/**
 * Events to words (spike S22 Q3: "store code + params, never rendered text;
 * `describe(event)` → `$LL` renders in apps/web"). Every `notice` code the
 * shell writes is listed in `NOTICE_TEXT` with the dictionary key that words
 * it, so the code is the stable thing a log keeps and the words follow the
 * locale at render time. Components pass `$LL`; modules pass `getLL()`.
 */
import type { TranslationFunctions } from '@ohhi/i18n'
import type { Actor, AppEvent, EventParam } from '@ohhi/workspace'
import { reloadText } from './resource-reload.js'
import { ShareLinkError, shareLinkErrorText, type ShareLinkErrorCode } from './share-link.js'

type Params = Record<string, EventParam> | undefined
const str = (p: Params, key: string): string => String(p?.[key] ?? '')
const num = (p: Params, key: string): number => Number(p?.[key] ?? 0)

interface NoticeDef {
  text(LL: TranslationFunctions, params: Params): string
  /**
   * False when the surface that raised it already shows it where the person
   * is looking (a dialog's inline error) — logged, but not toasted as well.
   */
  toast?: false
  /**
   * The Settings section its toast offers to open (settings-shaping ST6):
   * a file that can't be used → *Show problems*, Settings › Customise.
   */
  opens?: 'customise'
}

/**
 * Every notice code. A failure whose only words are the error's own message
 * carries it as `message` — that text came from a thrown Error, not from this
 * dictionary, so it is shown as it is.
 */
export const NOTICE_TEXT = {
  /** `MountEvents.onError`: anything a mount session reports. */
  mount_error: { text: (_LL, p) => str(p, 'message') },
  /** The adopt/absorb machine threw. */
  adopt_failed: { text: (_LL, p) => str(p, 'message') },
  /** Boot: a shared folder with no credential on this device. */
  no_token: { text: (LL, p) => LL.web.workspace.no_token({ path: str(p, 'path') }) },
  /** A device link was minted with more grants than one link carries. */
  too_many_grants: { text: (LL, p) => LL.web.device_link.too_many_grants({ count: num(p, 'count') }) },
  /** "Add link…" was refused; the dialog shows the reason itself, so no toast. */
  add_link_failed: {
    text: (_LL, p) =>
      p?.link_error
        ? shareLinkErrorText(new ShareLinkError(str(p, 'link_error') as ShareLinkErrorCode))
        : str(p, 'message'),
    toast: false,
  },
  unshare_failed: { text: (_LL, p) => str(p, 'message') },
  /** The folder was unshared, but its links on the room's relay could not be revoked. */
  revoke_failed: { text: (LL, p) => LL.web.notices.revoke_failed({ host: str(p, 'host'), message: str(p, 'message') }) },
  unmount_failed: { text: (_LL, p) => str(p, 'message') },
  move_failed: { text: (_LL, p) => str(p, 'message') },
  /** Browser storage may be evicted (once per session). */
  storage_evictable: { text: (LL) => LL.web.storage.notice() },
  /** Obsidian's daily-note format uses tokens this build prints as written. */
  daily_format: {
    text: (LL, p) => LL.web.daily.unsupported_format({ format: str(p, 'format'), tokens: str(p, 'tokens') }),
  },
  /** A layout file could not be used; the default is showing (quiet-shell F8). */
  layout_invalid: {
    text: (LL, p) => LL.web.layouts.invalid({ name: str(p, 'name'), error: str(p, 'error') }),
    opens: 'customise',
  },
  /** A keymap file could not be used; the default keys are in force (quiet-shell F10). */
  keymap_invalid: {
    text: (LL, p) => LL.web.keymaps.invalid({ name: str(p, 'name'), error: str(p, 'error') }),
    opens: 'customise',
  },
  /**
   * The layout or keymap in use was read again and changed (settings-shaping
   * ST6). Info: logged here, toasted once by `announceReload` with its Undo.
   */
  resource_reloaded: { text: (LL, p) => reloadText(LL, p) },
  /** `config.hotkeys` became `.ohhi/keymaps/device.json` (F10). */
  keymap_migrated: { text: (LL, p) => LL.web.keymaps.migrated({ path: str(p, 'path') }) },
  keymap_migrate_failed: { text: (LL, p) => LL.web.keymaps.migrate_failed({ error: str(p, 'error') }) },
  /** `template.insert` could not insert (no note, no file) — F11. */
  template_failed: { text: (_LL, p) => str(p, 'message') },
} satisfies Record<string, NoticeDef>

export type NoticeCode = keyof typeof NOTICE_TEXT

const isNoticeCode = (code: string): code is NoticeCode => Object.hasOwn(NOTICE_TEXT, code)

/**
 * Who did it, in words (sharing Fork 2-A): a peer's self-reported name, else
 * "someone via <relay>" — ordinary copy, never an error — or another app on
 * this device for a disk ingest (Obsidian, git, an agent).
 */
export function actorText(a: Actor, LL: TranslationFunctions): string {
  const who = LL.web.shared.who
  switch (a.kind) {
    case 'peer':
      return a.name ?? who.relay_bare()
    case 'relay':
      return a.name ? who.relay({ host: a.name }) : who.relay_bare()
    case 'disk':
    case 'agent':
      return a.name ?? who.disk()
    case 'me':
      return who.you()
    default:
      return a.name ?? ''
  }
}

/**
 * Several actors as one phrase (the drawer's per-note groups, P6):
 * "Cynthia", "Cynthia and Sam", "Cynthia, Sam and 2 others" — each by
 * `actorText`, so a relay or a disk ingest reads as it does everywhere.
 */
export function actorsText(actors: readonly Actor[], LL: TranslationFunctions): string {
  const names = actors.map((a) => actorText(a, LL))
  const g = LL.web.drawer.group
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return g.two({ a: names[0]!, b: names[1]! })
  return g.many({ a: names[0]!, b: names[1]!, count: names.length - 2 })
}

/** The words for one event, in the active locale. */
export function describeEvent(e: AppEvent, LL: TranslationFunctions): string {
  switch (e.kind) {
    case 'notice': {
      const { code, params } = (e as AppEvent<'notice'>).payload
      return isNoticeCode(code) ? NOTICE_TEXT[code].text(LL, params) : LL.web.notices.unknown({ code })
    }
    case 'relay.state': {
      const p = (e as AppEvent<'relay.state'>).payload
      const host = e.actor.name ?? LL.web.shared.relay.unknown_host()
      switch (p.to) {
        case 'refused':
          return LL.web.notices.relay_refused({ reason: p.reason ?? '' })
        case 'connected':
          return LL.web.notices.relay_connected({ host })
        case 'reconnecting':
          return LL.web.notices.relay_reconnecting({ host })
        case 'offline':
          return LL.web.notices.relay_offline({ host })
        default:
          return LL.web.notices.unknown({ code: `relay.${String(p.to)}` })
      }
    }
    case 'doc.changed':
      return LL.web.notices.doc_changed({ who: actorText(e.actor, LL), path: e.scope.path ?? '' })
    case 'file.created':
      return LL.web.notices.file_created({ who: actorText(e.actor, LL), path: e.scope.path ?? '' })
    case 'file.deleted':
      return LL.web.notices.file_deleted({ who: actorText(e.actor, LL), path: e.scope.path ?? '' })
    case 'file.moved':
      return LL.web.notices.file_moved({
        who: actorText(e.actor, LL),
        from: (e as AppEvent<'file.moved'>).payload.from,
        path: e.scope.path ?? '',
      })
    case 'peer.joined':
      return LL.web.notices.peer_joined({ name: e.actor.name ?? actorText(e.actor, LL) })
    case 'peer.left':
      return LL.web.notices.peer_left({ name: e.actor.name ?? actorText(e.actor, LL) })
    case 'review.opened':
      return LL.web.notices.review_opened({ path: e.scope.path ?? '' })
    case 'breaker.held':
      return LL.web.notices.breaker_held({ count: (e as AppEvent<'breaker.held'>).payload.count })
    case 'mount.changed': {
      const { what } = (e as AppEvent<'mount.changed'>).payload
      const path = e.scope.path ?? ''
      switch (what) {
        case 'needs-token':
          return LL.web.workspace.no_token({ path })
        case 'depth-limit':
          return LL.web.mounts.reason.depth_limit({ path })
        case 'mount-moved':
          return LL.web.mounts.reason.mount_moved({ path })
        case 'room-repointed':
          return LL.web.mounts.reason.room_repointed({ path })
        case 'adopted':
          return LL.web.notices.mount.adopted({ path })
        case 'absorbed':
          return LL.web.notices.mount.absorbed({ path })
        case 'adopt-cancelled':
          return LL.web.notices.mount.adopt_cancelled({ path })
        case 'ghosts-held':
          return LL.web.notices.mount.ghosts_held({ path })
        default:
          return LL.web.notices.mount.status({ path })
      }
    }
    default:
      return LL.web.notices.unknown({ code: e.kind })
  }
}

/**
 * Whether a logged event toasts (Stage 4a): errors and warnings once each,
 * info never, and never a notice whose own surface already shows it.
 */
/** The Settings section a logged notice's toast offers to open, if any (`NoticeDef.opens`). */
export function noticeOpens(e: AppEvent): 'customise' | null {
  if (e.kind !== 'notice') return null
  const { code } = (e as AppEvent<'notice'>).payload
  return isNoticeCode(code) ? ((NOTICE_TEXT[code] as NoticeDef).opens ?? null) : null
}

export function toastsWhenLogged(e: AppEvent): boolean {
  if (e.level === 'info') return false
  if (e.kind === 'notice') {
    const { code } = (e as AppEvent<'notice'>).payload
    if (isNoticeCode(code) && (NOTICE_TEXT[code] as NoticeDef).toast === false) return false
  }
  return true
}
