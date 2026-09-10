/**
 * Escape a value for interpolation into an `{@html}` dictionary string. A
 * sentence with inline `<code>` / `<em>` is rendered `{@html t.key({ … })}`
 * with the markup passed as arguments (the Edible pattern); anything in
 * those arguments that came from the user or a config field goes through
 * here first.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
