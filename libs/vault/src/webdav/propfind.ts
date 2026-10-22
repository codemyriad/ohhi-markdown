/**
 * PROPFIND for the WebDAV adapter: the request body, a small namespace-aware
 * XML reader (no dependency — a multistatus is a tiny, regular document) and
 * the mapping from a `d:multistatus` to vault-relative entries.
 *
 * Properties asked for are the ones Nextcloud 35 was verified to return
 * (spike S16 Q2/Q3): `d:getetag` (quoted), `oc:fileid`, `oc:permissions`
 * (letters), `oc:owner-id`, `nc:mount-type`, `d:resourcetype`,
 * `d:getcontentlength` — plus `d:getlastmodified`, which the walk needs
 * because a FILE's etag does not move for a second write inside the same
 * wall-clock second (measured on NC 35; see walk.ts).
 */

export const NS_DAV = 'DAV:'
export const NS_OC = 'http://owncloud.org/ns'
export const NS_NC = 'http://nextcloud.org/ns'

/** The `d:`, `oc:` and `nc:` prefixes every request body here uses, as attributes. */
export const DAV_XMLNS = `xmlns:d="${NS_DAV}" xmlns:oc="${NS_OC}" xmlns:nc="${NS_NC}"`

/** The properties asked for, inside a `<d:prop>` (a PROPFIND's, or a SEARCH's `<d:select>`). */
export const DAV_PROPS =
  '<d:getetag/><d:getlastmodified/><d:resourcetype/><d:getcontentlength/>' +
  '<oc:fileid/><oc:permissions/><oc:owner-id/><nc:mount-type/>'

export const PROPFIND_BODY = `<?xml version="1.0" encoding="UTF-8"?><d:propfind ${DAV_XMLNS}><d:prop>${DAV_PROPS}</d:prop></d:propfind>`

/** One `d:response` of a multistatus, mapped onto the vault. */
export interface DavEntry {
  /** Vault-relative path; `''` for the base collection itself. No trailing slash. */
  path: string
  isDir: boolean
  /** As the server sent it, quotes included (`"6acb84dfaeb24"`); `''` when absent. */
  etag: string
  /** `oc:fileid`; `''` when absent. Stable across MOVE (decision 10's move detection). */
  fileid: string
  permissions: string
  /** `oc:owner-id`; `''` when absent. */
  ownerId: string
  /** `nc:mount-type`; `''` for home storage. */
  mountType: string
  size: number
  /** `d:getlastmodified` in epoch ms (second resolution); `null` when absent. */
  mtime: number | null
}

/** Mount types that are the owner's own storage. */
const HOME_MOUNTS: ReadonlySet<string> = new Set(['', 'home', 'local'])

/**
 * Why an entry is not the owner's own content (decision 3): another owner's
 * `oc:owner-id`, or NONE — an entry whose owner the server did not say (a
 * nested mount whose propstat 404s) fails closed, never open (nextcloud-build R1 #14)
 * — or on a mount that is not home storage (a share, a group folder, external
 * storage). Null = the owner's. The adapter hides such entries; enrolment
 * refuses a folder that holds any.
 */
export function foreignReason(e: Pick<DavEntry, 'ownerId' | 'mountType'>, owner: string): 'owner' | 'mount' | null {
  if (e.ownerId !== owner) return 'owner'
  if (!HOME_MOUNTS.has(e.mountType)) return 'mount'
  return null
}

/** An HTTP date (`Date`, `Last-Modified`, `getlastmodified`) in epoch ms; `null` if absent/invalid. */
export function httpDate(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

// ---- a minimal XML reader ----

export interface XmlElement {
  ns: string
  name: string
  children: XmlElement[]
  /** Concatenated character data directly inside this element. */
  text: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, ent: string) => {
    if (ent.startsWith('#x')) return String.fromCodePoint(Number.parseInt(ent.slice(2), 16))
    if (ent.startsWith('#')) return String.fromCodePoint(Number.parseInt(ent.slice(1), 10))
    return ENTITIES[ent] ?? whole
  })
}

const ATTR = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/**
 * Parse an XML document into an element tree with resolved namespaces.
 * Handles declarations, comments, CDATA, DOCTYPE (skipped — custom entities
 * are never expanded), self-closing tags and the predefined/numeric entities.
 * Throws on unbalanced tags.
 */
export function parseXml(src: string): XmlElement {
  const root: XmlElement = { ns: '', name: '#document', children: [], text: '' }
  const stack: { el: XmlElement; scope: Map<string, string>; qname: string }[] = [
    { el: root, scope: new Map([['xml', 'http://www.w3.org/XML/1998/namespace']]), qname: '' },
  ]
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    const top = stack[stack.length - 1]!
    if (lt === -1) {
      top.el.text += decodeEntities(src.slice(i))
      break
    }
    if (lt > i) top.el.text += decodeEntities(src.slice(i, lt))
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4)
      if (end === -1) throw new Error('xml: unterminated comment')
      i = end + 3
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9)
      if (end === -1) throw new Error('xml: unterminated CDATA')
      top.el.text += src.slice(lt + 9, end)
      i = end + 3
    } else if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2)
      if (end === -1) throw new Error('xml: unterminated declaration')
      i = end + 2
    } else if (src.startsWith('<!', lt)) {
      // DOCTYPE (possibly with an internal subset in [...]).
      let depth = 0
      let j = lt + 2
      for (; j < src.length; j++) {
        const c = src[j]
        if (c === '[') depth++
        else if (c === ']') depth--
        else if (c === '>' && depth <= 0) break
      }
      i = j + 1
    } else if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt)
      if (end === -1) throw new Error('xml: unterminated end tag')
      const qname = src.slice(lt + 2, end).trim()
      if (stack.length < 2 || top.qname !== qname) throw new Error(`xml: unexpected </${qname}>`)
      stack.pop()
      i = end + 1
    } else {
      // Start tag: find its end, respecting quoted attribute values.
      let j = lt + 1
      let quote = ''
      for (; j < src.length; j++) {
        const c = src[j]
        if (quote) {
          if (c === quote) quote = ''
        } else if (c === '"' || c === "'") quote = c
        else if (c === '>') break
      }
      if (j >= src.length) throw new Error('xml: unterminated start tag')
      let body = src.slice(lt + 1, j)
      const selfClosing = body.endsWith('/')
      if (selfClosing) body = body.slice(0, -1)
      const m = /^([^\s/>]+)/.exec(body)
      if (!m) throw new Error('xml: empty tag')
      const qname = m[1]!
      const scope = new Map(top.scope)
      for (const a of body.slice(qname.length).matchAll(ATTR)) {
        const key = a[1]!
        const value = decodeEntities(a[2] ?? a[3] ?? '')
        if (key === 'xmlns') scope.set('', value)
        else if (key.startsWith('xmlns:')) scope.set(key.slice(6), value)
      }
      const colon = qname.indexOf(':')
      const prefix = colon === -1 ? '' : qname.slice(0, colon)
      const el: XmlElement = {
        ns: scope.get(prefix) ?? '',
        name: colon === -1 ? qname : qname.slice(colon + 1),
        children: [],
        text: '',
      }
      top.el.children.push(el)
      if (!selfClosing) stack.push({ el, scope, qname })
      i = j + 1
    }
  }
  if (stack.length !== 1) throw new Error('xml: unclosed element')
  return root
}

const child = (el: XmlElement, ns: string, name: string): XmlElement | undefined =>
  el.children.find((c) => c.ns === ns && c.name === name)

const children = (el: XmlElement, ns: string, name: string): XmlElement[] =>
  el.children.filter((c) => c.ns === ns && c.name === name)

/** `HTTP/1.1 200 OK` → 200; anything unparseable → 0. */
function statusCode(line: string): number {
  const m = /^\s*HTTP\/[\d.]+\s+(\d{3})/.exec(line)
  return m ? Number(m[1]) : 0
}

// ---- href → vault path ----

/** Decoded path segments of a URL path (`/a%20b/c/` → `['a b', 'c']`). */
function decodedSegments(pathname: string): string[] | null {
  try {
    return pathname
      .split('/')
      .filter((s) => s !== '')
      .map((s) => decodeURIComponent(s))
  } catch {
    return null
  }
}

/**
 * The vault-relative path an href names, or `null` when it is not under the
 * base collection (containment: an href the server sends that points
 * elsewhere is never mapped onto the vault).
 */
export function hrefToPath(href: string, baseUrl: string): string | null {
  let pathname: string
  try {
    pathname = new URL(href, baseUrl).pathname
  } catch {
    return null
  }
  const base = decodedSegments(new URL(baseUrl).pathname)
  const segs = decodedSegments(pathname)
  if (!base || !segs || segs.length < base.length) return null
  for (let k = 0; k < base.length; k++) if (segs[k] !== base[k]) return null
  const rest = segs.slice(base.length)
  if (rest.some((s) => s === '.' || s === '..' || s.includes('/'))) return null
  return rest.join('/')
}

/**
 * Parse a PROPFIND multistatus into entries. Only the `propstat` whose status
 * is 200 contributes properties; a `response` with its own non-2xx status
 * (or whose href is outside the base) is dropped.
 */
export function parseMultistatus(xml: string, baseUrl: string): DavEntry[] {
  const doc = parseXml(xml)
  const ms = child(doc, NS_DAV, 'multistatus')
  if (!ms) throw new Error('webdav: response is not a multistatus')
  const out: DavEntry[] = []
  for (const resp of children(ms, NS_DAV, 'response')) {
    const href = child(resp, NS_DAV, 'href')?.text.trim()
    if (!href) continue
    const own = child(resp, NS_DAV, 'status')
    if (own && statusCode(own.text) >= 300) continue
    const path = hrefToPath(href, baseUrl)
    if (path === null) continue
    const entry: DavEntry = {
      path,
      isDir: false,
      etag: '',
      fileid: '',
      permissions: '',
      ownerId: '',
      mountType: '',
      size: 0,
      mtime: null,
    }
    for (const ps of children(resp, NS_DAV, 'propstat')) {
      const st = child(ps, NS_DAV, 'status')
      if (st && statusCode(st.text) !== 200) continue
      const prop = child(ps, NS_DAV, 'prop')
      if (!prop) continue
      for (const p of prop.children) {
        const text = p.text.trim()
        if (p.ns === NS_DAV && p.name === 'getetag') entry.etag = text
        else if (p.ns === NS_DAV && p.name === 'resourcetype')
          entry.isDir = child(p, NS_DAV, 'collection') !== undefined
        else if (p.ns === NS_DAV && p.name === 'getcontentlength') entry.size = Number(text) || 0
        else if (p.ns === NS_DAV && p.name === 'getlastmodified') entry.mtime = httpDate(text)
        else if (p.ns === NS_OC && p.name === 'fileid') entry.fileid = text
        else if (p.ns === NS_OC && p.name === 'permissions') entry.permissions = text
        else if (p.ns === NS_OC && p.name === 'owner-id') entry.ownerId = text
        else if (p.ns === NS_NC && p.name === 'mount-type') entry.mountType = text
      }
    }
    // A collection's href ends in `/`; the base itself is always one.
    if (href.endsWith('/') || path === '') entry.isDir = true
    out.push(entry)
  }
  return out
}
