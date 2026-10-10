/**
 * `![alt](src)` (editor-usability E5). A LOCAL path is drawn with the same
 * widget as `![[picture.png]]`, the alt as its alt text. A REMOTE http(s)
 * picture is never fetched by opening the note — a synced, agent-writable file
 * is not a trusted page, and an image request is a read receipt — so it is a
 * placeholder naming the host, with a button that loads it on a click. A host
 * that cannot load remote images at all leaves the markup a link, and its
 * tooltip says the picture was not loaded.
 */
import type { SyntaxNode } from '@lezer/common'
import { WidgetType } from '@codemirror/view'
import { FALLBACK_REMOTE_IMAGE_LABELS, type ReadHost } from '../read-host.js'

/** Embeddable pictures — the set `attachmentType` in apps/web can name. */
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i

/** What an image's `src` is to the renderer. */
export type ImageSource =
  /** A picture in the vault: drawn from the host's adapter. */
  | 'local'
  /** http(s): a placeholder until a click loads it (or a link, if the host cannot). */
  | 'remote'
  /** Anything else (`data:`, `file:`, a PDF, a reference): left as the text it is. */
  | 'none'

/** Classify a `src` as written in the note. Pure. */
export function imageSource(src: string): ImageSource {
  const url = src.trim().replace(/^<(.*)>$/, '$1')
  if (!url) return 'none'
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase()
  if (scheme === 'http' || scheme === 'https') return 'remote'
  if (scheme || url.startsWith('//')) return 'none'
  const path = url.split('?')[0]!.split('#')[0]!
  return IMAGE.test(path) ? 'local' : 'none'
}

/** The host part of a remote `src`, for the placeholder ('' if it does not parse). */
export function imageHost(src: string): string {
  try {
    return new URL(src.trim().replace(/^<(.*)>$/, '$1')).host
  } catch {
    return ''
  }
}

/** The tooltip of a remote image left as a link: it was not loaded, and from where. */
export function notLoadedTitle(host: ReadHost, src: string): string {
  const labels = host.labels.remoteImage ?? FALLBACK_REMOTE_IMAGE_LABELS
  return `${labels.notLoaded} — ${src}`
}

/** The pieces of an `Image` node the builder needs, or null for a reference image. */
export interface ImageParts {
  alt: string
  src: string
  /** End of `![`. */
  altFrom: number
  /** Start of `]`. */
  altTo: number
}

export function imageParts(node: SyntaxNode, slice: (from: number, to: number) => string): ImageParts | null {
  const url = node.getChild('URL')
  if (!url) return null
  let open: SyntaxNode | null = null
  let close: SyntaxNode | null = null
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'LinkMark') continue
    const text = slice(child.from, child.to)
    if (!open && text === '![') open = child
    else if (open && !close && text === ']') close = child
  }
  if (!open || !close) return null
  return { alt: slice(open.to, close.from), src: slice(url.from, url.to), altFrom: open.to, altTo: close.from }
}

/**
 * The placeholder for a remote picture. Nothing is requested until the button
 * is pressed; the bytes then come through the host (`loadRemoteImage`), which
 * fetches them within the app's own policy and answers null when refused — and
 * a refusal says so, in place, rather than drawing a broken image.
 */
export class RemoteImageWidget extends WidgetType {
  private url: string | null = null
  private dead = false

  constructor(
    readonly src: string,
    readonly alt: string,
    readonly block: boolean,
    private readonly host: ReadHost
  ) {
    super()
  }

  override eq(other: RemoteImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt && other.block === this.block
  }

  toDOM(): HTMLElement {
    const labels = this.host.labels.remoteImage ?? FALLBACK_REMOTE_IMAGE_LABELS
    const where = imageHost(this.src)
    const wrap = document.createElement(this.block ? 'figure' : 'span')
    wrap.className = this.block ? 'cm-embed cm-embed-block cm-embed-remote' : 'cm-embed cm-embed-remote'
    const line = document.createElement('span')
    line.className = 'cm-embed-remote-label'
    line.textContent = this.alt ? `${this.alt} — ${labels.from(where)}` : labels.from(where)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-embed-remote-load'
    button.textContent = labels.load
    button.addEventListener('click', (event) => {
      event.preventDefault()
      button.disabled = true
      const refused = (): void => {
        if (this.dead) return
        line.textContent = labels.failed(where)
        button.remove()
      }
      const load = this.host.loadRemoteImage
      if (!load) return refused()
      void load(this.src).then((blob) => {
        if (this.dead) return
        if (!blob) return refused()
        this.url = URL.createObjectURL(blob)
        const img = document.createElement('img')
        img.src = this.url
        img.alt = this.alt
        img.addEventListener('error', refused)
        wrap.replaceChildren(img)
        wrap.classList.remove('cm-embed-remote')
      }, refused)
    })
    wrap.append(line, ' ', button)
    return wrap
  }

  /** The button is the widget's own; every other event belongs to the editor (clicks.ts). */
  override ignoreEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null
    if (target?.closest?.('.cm-embed-remote-load')) return true
    return !(event.type === 'mousedown' || event.type === 'click')
  }

  override destroy(): void {
    this.dead = true
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = null
  }
}
