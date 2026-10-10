<script lang="ts" module>
  import { defaultSanitizeUrl, type SanitizeUrlFn } from '@humanspeak/svelte-markdown'

  /**
   * Links only to the web and mail; nothing relative (a relative href would
   * navigate the APP away) and no images at all — a remote image in a
   * transcript is a request to a host the person never chose (R1's egress
   * rule), and a local one has no meaning here.
   */
  export const sessionSanitizeUrl: SanitizeUrlFn = (url, context) => {
    if (context.type === 'image') return ''
    const clean = defaultSanitizeUrl(url, context)
    return /^(https?:|mailto:)/i.test(clean) ? clean : ''
  }
</script>

<script lang="ts">
  /**
   * The ONE markdown renderer in the shell (writing-harness-build §Ground
   * rules › Duplication): an agent's text in the Session transcript, through
   * `@humanspeak/svelte-markdown` — marked + htmlparser2, re-lexing only the
   * open block while it streams, sanitising by default (event handlers and
   * `srcdoc` stripped, a protocol allowlist).
   *
   * Tightened past the defaults: raw HTML is never rendered (every tag is
   * `buildUnsupportedHTML`'s placeholder — the editor's own rule: HTML is
   * never rendered, in any mode), and URLs go through `sessionSanitizeUrl`.
   *
   * Styled from the token bands only: chrome type and ink from DaisyUI, code
   * from the editor's band (`--ed-code-*`, `--ed-font-mono`) so a fence here
   * looks like a fence in a note. No syntax colouring: `editorHighlightStyle`
   * styles a lezer tree, and the transcript has none.
   */
  import SvelteMarkdown, { buildUnsupportedHTML } from '@humanspeak/svelte-markdown'

  interface Props {
    source: string
    /** True while the text is still arriving: the renderer re-lexes only the open block. */
    streaming?: boolean
  }

  let { source, streaming = false }: Props = $props()

  const renderers = { html: buildUnsupportedHTML() }
</script>

<div class="session-md text-sm leading-relaxed text-base-content" data-testid="session-markdown">
  <SvelteMarkdown {source} {streaming} {renderers} sanitizeUrl={sessionSanitizeUrl} />
</div>

<style>
  .session-md :global(p),
  .session-md :global(ul),
  .session-md :global(ol),
  .session-md :global(pre),
  .session-md :global(blockquote),
  .session-md :global(table) {
    margin: 0 0 0.6em;
  }
  .session-md :global(:last-child) {
    margin-bottom: 0;
  }
  .session-md :global(ul) {
    list-style: disc;
    padding-left: 1.25em;
  }
  .session-md :global(ol) {
    list-style: decimal;
    padding-left: 1.25em;
  }
  .session-md :global(h1),
  .session-md :global(h2),
  .session-md :global(h3),
  .session-md :global(h4) {
    margin: 0.8em 0 0.4em;
    font-weight: 600;
  }
  .session-md :global(h1) {
    font-size: 1.15em;
  }
  .session-md :global(h2) {
    font-size: 1.08em;
  }
  .session-md :global(a) {
    color: var(--ed-link);
    text-decoration: underline;
  }
  .session-md :global(code) {
    font-family: var(--ed-font-mono);
    font-size: 0.92em;
    color: var(--ed-code-fg);
    background: var(--ed-code-bg);
    border-radius: 0.25em;
    padding: 0.05em 0.3em;
  }
  .session-md :global(pre) {
    font-family: var(--ed-font-mono);
    background: var(--ed-code-block-bg);
    color: var(--ed-code-block-fg);
    border: 1px solid var(--ed-code-border);
    border-radius: 0.375rem;
    padding: 0.6em 0.75em;
    overflow-x: auto;
  }
  .session-md :global(pre code) {
    background: none;
    color: inherit;
    padding: 0;
    font-size: 0.9em;
  }
  .session-md :global(blockquote) {
    border-left: 3px solid var(--ed-quote-border);
    color: var(--ed-quote-fg);
    padding-left: 0.75em;
  }
  .session-md :global(th),
  .session-md :global(td) {
    border: 1px solid var(--ed-table-border);
    padding: 0.2em 0.5em;
  }
  .session-md :global(th) {
    background: var(--ed-table-header-bg);
  }
</style>
