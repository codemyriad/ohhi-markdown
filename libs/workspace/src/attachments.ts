/**
 * Where a pasted or dropped attachment goes, what it is called, and how a note
 * links to it (editor-usability E5). Pure: no adapter, no clock of its own —
 * the moment a paste happened is an argument (golden rule 5), so the name a
 * test expects is the name the product writes.
 *
 * The rules are Obsidian's, because the vault is an Obsidian vault and both
 * apps must agree on where a picture lives:
 *
 * - `attachmentFolderPath` in `.obsidian/app.json`: `/` (or absent) is the
 *   vault root, `./` is the note's folder, `./sub` a folder under the note's
 *   folder, anything else a vault folder.
 * - A pasted image is `Pasted image YYYYMMDDHHmmss.<ext>`; a dropped file
 *   keeps its own name. A taken name gets ` 1`, ` 2`, … before the extension.
 *
 * One rule is ours: a note inside a SHARED folder keeps its attachments inside
 * that folder. A file outside the mount would live in another room (or in no
 * room at all), so the picture would never travel with the note it is in.
 */
import { IGNORED_DIRS } from '@ohhi/vault'

/** File types a paste or a drop may add to a note: the embeddable pictures, and PDFs as links. */
export const ATTACHMENT_EXTENSIONS: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
}

/** The extension a pasted blob of this media type is saved with ('' when not ours). */
export function extensionForType(type: string): string {
  const t = type.toLowerCase().split(';')[0]!.trim()
  if (t === 'image/jpeg' || t === 'image/jpg') return 'jpg'
  for (const [ext, mime] of Object.entries(ATTACHMENT_EXTENSIONS)) if (mime === t) return ext
  return ''
}

/** The lower-cased extension of a name, without the dot ('' when none). */
export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** Is this a file a paste or drop can add — by name first, then by media type? */
export function isAttachmentFile(name: string, type: string): boolean {
  const ext = extensionOf(name)
  if (ext) return ext in ATTACHMENT_EXTENSIONS
  return extensionForType(type) !== ''
}

/** Is it a picture (embedded with `![[…]]`) rather than a PDF (linked with `[[…]]`)? */
export function isImageExtension(ext: string): boolean {
  return ext in ATTACHMENT_EXTENSIONS && ext !== 'pdf'
}

/** Obsidian's paste stamp, in the device's local time: `20261010140307`. */
export function pasteStamp(at: number): string {
  const d = new Date(at)
  const two = (n: number): string => String(n).padStart(2, '0')
  return (
    String(d.getFullYear()) +
    two(d.getMonth() + 1) +
    two(d.getDate()) +
    two(d.getHours()) +
    two(d.getMinutes()) +
    two(d.getSeconds())
  )
}

/**
 * A dropped file's own name, made safe to be a vault file and a wikilink
 * target: no folder part, none of the characters Obsidian refuses in a name
 * (`* " \ / < > : | ?`) or that break a link (`# ^ [ ]`).
 */
export function cleanAttachmentName(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const cleaned = base
    .replace(/[*"\\/<>:|?#^[\]]/g, '-')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .replace(/^\.+/, '')
  return cleaned
}

/** `Pasted image 1.png` → `Pasted image 2.png` … until a name is free (case-insensitively). */
export function dedupeName(folder: string, name: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((p) => p.toLowerCase()))
  const join = (n: string): string => (folder ? `${folder}/${n}` : n)
  if (!lower.has(join(name).toLowerCase())) return join(name)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 1; ; n++) {
    const candidate = join(`${stem} ${n}${ext}`)
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
}

/** Collapse `a/./b/../c` to `a/c`; null when it climbs out of the vault. */
function normalize(path: string): string | null {
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.join('/')
}

const dirOf = (path: string): string => {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}

const within = (path: string, root: string): boolean =>
  root === '' || path === root || path.startsWith(`${root}/`)

const ignored = (path: string): boolean => path.split('/').some((seg) => IGNORED_DIRS.has(seg))

/**
 * The folder `attachmentFolderPath` names for a note, before the shared-folder
 * rule. `scope` is the root the setting is read against: the vault ('') for
 * Obsidian's own reading, a mount root when the note lives in a share.
 */
function folderFor(setting: string | null | undefined, noteDir: string, scope: string): string | null {
  const raw = (setting ?? '/').trim()
  if (raw === '' || raw === '/') return scope
  if (raw === '.' || raw === './') return noteDir
  if (raw.startsWith('./')) return normalize(`${noteDir}/${raw.slice(2)}`)
  return normalize(scope ? `${scope}/${raw}` : raw)
}

export interface AttachmentPlacementInput {
  /** The note the attachment is added to, workspace-relative. */
  notePath: string
  /** The root of the mount the note is in: '' for the vault's own (unshared) part. */
  mountPath: string
  /** `attachmentFolderPath` from `.obsidian/app.json`; absent means Obsidian's default, `/`. */
  attachmentFolderPath?: string | null
  /** The pasted blob's media type, or a dropped file's. */
  type: string
  /** A dropped file's own name; absent for a paste (which is named by the stamp). */
  fileName?: string | null
  /** When the paste happened, on the injected clock. */
  at: number
  /** Every path the workspace already holds (files and folders), for the de-duplication. */
  taken: ReadonlySet<string>
}

export interface AttachmentPlacement {
  /** The workspace path the file is written to. */
  path: string
  /** Its folder ('' = the vault root). */
  folder: string
  /** Its file name. */
  name: string
}

/**
 * The folder an attachment for this note goes in, with the shared-folder rule
 * applied. Exposed on its own because the drop overlay names the folder while
 * the drag is still in the air, before there is a file name to place.
 */
export function attachmentFolder(
  input: Pick<AttachmentPlacementInput, 'notePath' | 'mountPath' | 'attachmentFolderPath'>
): string {
  const noteDir = dirOf(input.notePath)
  const mount = input.mountPath
  let folder = folderFor(input.attachmentFolderPath, noteDir, '')
  // A share keeps its pictures: read the same rule against the mount's root,
  // so `/` means the share's top and `Attachments` the share's own folder.
  if (mount && (folder === null || !within(folder, mount))) {
    folder = folderFor(input.attachmentFolderPath, noteDir, mount)
    if (folder === null || !within(folder, mount)) folder = mount
  }
  // Never into an app folder (`.obsidian/`, `.ohhi/`): nothing there is a
  // vault file, so the picture would be invisible to the tree and the index.
  if (folder === null || ignored(folder)) folder = mount || noteDir
  if (ignored(folder)) folder = mount
  return folder
}

/** Where a pasted or dropped attachment is written, and under what name. */
export function placeAttachment(input: AttachmentPlacementInput): AttachmentPlacement {
  const folder = attachmentFolder(input)
  const typeExt = extensionForType(input.type)
  let name = input.fileName ? cleanAttachmentName(input.fileName) : ''
  if (name && !extensionOf(name) && typeExt) name = `${name}.${typeExt}`
  if (!name || name.startsWith('.')) name = `Pasted image ${pasteStamp(input.at)}.${typeExt || 'png'}`
  const path = dedupeName(folder, name, input.taken)
  return { path, folder, name: path.slice(path.lastIndexOf('/') + 1) }
}

/**
 * The text a note links an attachment by: the bare file name when no other
 * file in the vault has that name (Obsidian's "shortest path when possible"),
 * else the shortest trailing part of its path that only it ends with, and the
 * full path when nothing shorter is unique.
 */
export function attachmentLinkText(path: string, files: Iterable<string>): string {
  const others = [...files].filter((p) => p !== path).map((p) => p.toLowerCase())
  const segs = path.split('/')
  for (let n = 1; n <= segs.length; n++) {
    const suffix = segs.slice(-n).join('/')
    const lower = suffix.toLowerCase()
    if (!others.some((p) => p === lower || p.endsWith(`/${lower}`))) return suffix
  }
  return path
}
