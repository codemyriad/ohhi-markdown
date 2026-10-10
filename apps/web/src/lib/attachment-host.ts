/**
 * The shell's side of pasting and dropping pictures (editor-usability E5):
 * the `AttachmentHost` a pane hands its editor. Where a file goes and what it
 * is called are libs/workspace's pure rules (`placeAttachment`, Obsidian's);
 * the write is the workspace's journaled, atomic `writeAttachment`; the link
 * text is the shortest that names the file uniquely.
 *
 * Obsidian's `attachmentFolderPath` is read from `.obsidian/app.json` through
 * `readAppFile` — the same door `daily-notes.json` comes through — once when
 * the host is made (so the drop overlay can name the folder mid-drag) and
 * again before every save (so a change in Obsidian is honoured at once).
 *
 * Sync honesty (golden rule 4): an attachment is not synced (D2f). A picture
 * added to a note inside a shared folder says so, once, in a toast — it never
 * implies the collaborators have it.
 */
import type { AttachmentGesture, AttachmentHost, SavedAttachment } from '@ohhi/editor'
import { mountOf, shareName } from '@ohhi/editor-lang'
import { getLL } from '@ohhi/i18n'
import {
  attachmentFolder,
  attachmentLinkText,
  extensionForType,
  extensionOf,
  isAttachmentFile,
  isImageExtension,
  placeAttachment,
} from '@ohhi/workspace'
import type { Workspace } from './workspace.svelte.js'

/** Obsidian's own settings file; absent in a vault that never changed a default. */
export const OBSIDIAN_APP_CONFIG = '.obsidian/app.json'

/**
 * `attachmentFolderPath` from `.obsidian/app.json`, or null for Obsidian's
 * default (the vault root) when the file or the key is absent or malformed.
 */
export async function loadAttachmentFolderSetting(
  readAppFile: (path: string) => Promise<string | null>
): Promise<string | null> {
  try {
    const raw = await readAppFile(OBSIDIAN_APP_CONFIG)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const value = (parsed as { attachmentFolderPath?: unknown }).attachmentFolderPath
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

export interface AttachmentHostDeps {
  workspace(): Workspace | null
  /** The pane's note right now (the tab can change under a live view). */
  notePath(): string | null
  /** The injected clock: what a pasted picture is named by. */
  now(): number
}

export function createAttachmentHost(deps: AttachmentHostDeps): AttachmentHost {
  let setting: string | null = null
  const refresh = async (): Promise<void> => {
    const ws = deps.workspace()
    if (ws) setting = await loadAttachmentFolderSetting((p) => ws.readAppFile(p))
  }
  void refresh()

  const scope = (ws: Workspace, note: string) => ({
    notePath: note,
    mountPath: mountOf(note, ws.ui.mounts)?.path ?? '',
  })

  return {
    // libs/workspace's rule, the one `writeAttachment` holds the bytes to.
    accepts: (file) => isAttachmentFile(file.name, file.type),
    acceptsType: (type) => extensionForType(type) !== '',

    dropLabels(count) {
      const t = getLL().web.attachments
      const ws = deps.workspace()
      const note = deps.notePath()
      const folder = ws && note ? attachmentFolder({ ...scope(ws, note), attachmentFolderPath: setting }) : ''
      const where = folder || t.vault_root()
      return {
        title: t.drop_title(),
        detail: count > 1 ? t.saved_in_many({ count, folder: where }) : t.saved_in({ folder: where }),
      }
    },

    async save(files, gesture: AttachmentGesture) {
      const ws = deps.workspace()
      const note = deps.notePath()
      if (!ws || !note) return files.map(() => null)
      await refresh()
      const taken = new Set(ws.ui.files.map((f) => f.path))
      const out: (SavedAttachment | null)[] = []
      for (const file of files) {
        // A pasted picture is named by the clock, as Obsidian names it; a
        // dropped file — or a pasted PDF — keeps its own name.
        const stamped = gesture === 'paste' && isImageExtension(extensionOf(file.name) || 'png')
        const placed = placeAttachment({
          ...scope(ws, note),
          attachmentFolderPath: setting,
          type: file.type,
          fileName: stamped ? null : file.name,
          at: deps.now(),
          taken,
        })
        const bytes = new Uint8Array(await file.arrayBuffer())
        const written = await ws.writeAttachment(placed.path, bytes)
        if (!written) {
          out.push(null)
          continue
        }
        taken.add(written)
        out.push({ link: attachmentLinkText(written, [...taken, ...ws.ui.files.map((f) => f.path)]) })
      }
      return out
    },

    inserted(saved) {
      const ws = deps.workspace()
      const note = deps.notePath()
      if (!ws || !note || saved.length === 0) return
      const mount = mountOf(note, ws.ui.mounts)
      if (!mount) return
      ws.flash({ level: 'info', text: getLL().web.attachments.shared_notice({ share: shareName(mount.path) }), path: note })
    },
  }
}
