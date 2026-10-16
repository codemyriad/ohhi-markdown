/**
 * Every outbound URL on the site, in one place.
 *
 * The apex, https://ohhi.md, is this site, so the web app lives at `app.`
 * and the desktop builds at `dist.` (plans/naming.md). `dist.ohhi.md` is the
 * bucket CI will upload release builds to, with a stable alias per file:
 * the release assets are `ohhi_<version>_universal.dmg`,
 * `ohhi_<version>_amd64.AppImage` and `ohhi_<version>_amd64.deb`
 * (.github/workflows/desktop-release.yml), and the alias drops the version.
 * Until that bucket exists these links are the plan, not a download.
 */
export const APP = 'https://app.ohhi.md'

/** The repository. Private today; Chris opens it later. */
export const GITHUB = 'https://github.com/codemyriad/ohhi-markdown'

/** Who makes it: the footer's chip, as on the Cassini site. */
export const CODEMYRIAD = 'https://codemyriad.io'

export const DIST = 'https://dist.ohhi.md/stable/latest'

export const CHECKSUMS = `${DIST}/SHA256SUMS.txt`

export interface Download {
  os: string
  file: string
  note: string
}

export const DOWNLOADS: Download[] = [
  { os: 'macOS', file: 'ohhi_universal.dmg', note: 'Apple silicon and Intel, one build' },
  { os: 'Linux', file: 'ohhi_amd64.AppImage', note: 'any distribution; needs FUSE 2' },
  { os: 'Debian and Ubuntu', file: 'ohhi_amd64.deb', note: 'installs with apt' },
]
