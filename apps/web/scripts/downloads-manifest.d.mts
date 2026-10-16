/** Types for downloads-manifest.mjs (node builtins only, so it stays plain JS). */
export declare const DOWNLOADS_SCHEMA: 1
export declare function archOf(name: string): 'universal' | 'arm64' | 'x86_64'
export declare function buildDownloads(input: {
  files: { name: string; size: number; sha256: string }[]
  version: string
  baseUrl: string
  date: string
}): {
  schema: 1
  version: string
  date: string
  files: { os: string; kind: string; arch: string; name: string; url: string; size: number; sha256: string }[]
}
