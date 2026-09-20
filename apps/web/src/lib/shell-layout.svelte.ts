/**
 * The shell's chrome state (chrome U2, U5): which columns are open and how
 * wide, which rail sections are folded, and the notice bookkeeping that
 * hangs off them — what has toasted, what counts as unread.
 *
 * Layout is device-level and persisted like the theme (`config.ts`): the
 * booleans as they change, the width only when a resize gesture ENDS. The
 * pure half — clamping, folding, "show only" — is `layout.ts`.
 */
import { getLL } from '@ohhi/i18n'
import { layoutPrefs, setLayoutPrefs } from './config.js'
import { RAIL_SECTIONS, showOnly, toggleFolded } from './layout.js'
import { unreadCount, type Notice } from './notices.js'
import { toast as showToast, type ToastData } from './ui/toaster.js'

/** What the layout needs from the rest of the shell. */
export interface LayoutHost {
  /** True while the workspace (not the manager or the connecting view) is showing. */
  inWorkspace(): boolean
  /** The session notice log, newest first; null between vaults. */
  notices(): Notice[] | null
  now(): number
  /** Injected so a test can see what toasted without a DOM. */
  toast?: (data: ToastData) => void
}

export interface ShellLayout {
  treeOpen: boolean
  treeWidth: number
  railOpen: boolean
  railFolded: string[]
  /** A folder the breadcrumb (or a new-folder confirm) asked the navigator to show; new object per ask. */
  revealDir: { path: string } | null
  readonly linksVisible: boolean
  readonly activityVisible: boolean
  /** Notices that arrived since Activity was last in view. */
  readonly unread: number
  /** Open the navigator and reveal this folder in it. */
  revealInTree(dir: string): void
  /** Open the rail with this section unfolded. */
  showSection(id: string): void
  foldSection(id: string, fold: boolean): void
  showOnlySection(id: string): void
  /** The resize gesture ended: the width persists now, not per pointer move. */
  commitTreeWidth(): void
}

export function createShellLayout(host: LayoutHost): ShellLayout {
  const saved = layoutPrefs()
  let treeOpen = $state(saved.treeOpen)
  let treeWidth = $state(saved.treeWidth)
  let railOpen = $state(saved.railOpen)
  let railFolded = $state<string[]>(saved.railFolded)
  let revealDir = $state<{ path: string } | null>(null)

  const linksVisible = $derived(railOpen && !railFolded.includes('links'))
  const activityVisible = $derived(host.inWorkspace() && railOpen && !railFolded.includes('activity'))

  // The booleans persist as they change; the width persists when a resize
  // gesture ENDS (ResizeHandle's onCommit), not on every pointer move.
  $effect(() => {
    setLayoutPrefs({ treeOpen, railOpen, railFolded: $state.snapshot(railFolded) })
  })

  // ---- notices (chrome U5): every new one toasts; all of them stay in Activity ----
  /** When the Activity section was last in view; what arrived since is "unread". */
  let noticesSeenAt = $state(0)
  let toastedId: string | null = null
  const unread = $derived(unreadCount(host.notices() ?? [], noticesSeenAt))
  const toast = host.toast ?? showToast

  $effect(() => {
    const newest = host.notices()?.[0]
    if (!newest || newest.id === toastedId) return
    toastedId = newest.id
    toast({
      level: newest.level,
      title: getLL().web.notices.toast_title[newest.level](),
      description: newest.text,
    })
  })
  $effect(() => {
    // Looking at the log reads it — including anything that arrives while it is open.
    host.notices()?.length
    if (activityVisible) noticesSeenAt = host.now()
  })

  return {
    get treeOpen() {
      return treeOpen
    },
    set treeOpen(next) {
      treeOpen = next
    },
    get treeWidth() {
      return treeWidth
    },
    set treeWidth(next) {
      treeWidth = next
    },
    get railOpen() {
      return railOpen
    },
    set railOpen(next) {
      railOpen = next
    },
    get railFolded() {
      return railFolded
    },
    set railFolded(next) {
      railFolded = next
    },
    get revealDir() {
      return revealDir
    },
    set revealDir(next) {
      revealDir = next
    },
    get linksVisible() {
      return linksVisible
    },
    get activityVisible() {
      return activityVisible
    },
    get unread() {
      return unread
    },
    revealInTree(dir) {
      treeOpen = true
      revealDir = { path: dir }
    },
    showSection(id) {
      railOpen = true
      railFolded = toggleFolded(railFolded, id, false)
    },
    foldSection(id, fold) {
      railFolded = toggleFolded(railFolded, id, fold)
    },
    showOnlySection(id) {
      railFolded = showOnly(RAIL_SECTIONS, id)
    },
    commitTreeWidth() {
      setLayoutPrefs({ treeWidth })
    },
  }
}
