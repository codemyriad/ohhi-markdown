/**
 * The desktop build's filesystem scope (DEL-89): the webview reaches only the
 * app's own data and the folders the user picked. A vault picked before that
 * change — or one whose grant was lost — is refused by the fs plugin with
 * "forbidden path: …" on its first call, and the manager offers to pick the
 * folder again rather than showing a broken vault.
 */

/** True for the fs plugin's refusal of a path outside the granted scope. */
export function isAccessRefused(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err)
  return /forbidden path/i.test(text)
}

/** Two picker paths name the same folder (a trailing separator aside). */
export function samePath(a: string, b: string): boolean {
  const trim = (p: string) => p.replace(/[\\/]+$/, '') || p
  return trim(a) === trim(b)
}
