<script lang="ts">
  /**
   * The product's wordmark, as the landing site draws it (`apps/site`
   * `Base.astro`, `site.css` `.wordmark`): "Oh Hi" as ink on the theme's own
   * ==highlight== pair (`--ed-mark-bg` / `--ed-mark-fg`, so it holds in every
   * theme), the voice dropping on "markdown" with "mark" in the real 400
   * italic (Public Sans ships a 400 italic and no 600 one, so the lean always
   * sits in the regular-weight half). Drawn in the chrome since 2026-10-16
   * (the splash, the vault manager and Settings headers, the welcome
   * heading, the join page's brand line, Settings › About).
   *
   * It reads as one name: `common.app_name`. A heading (`as="h1"`…) is named
   * by `aria-label`; anything else is a `role="img"` with that label, the
   * logo pattern, so a screen reader never walks "Oh Hi", "mark", "down" as
   * three pieces. The text content stays the name too, so copying it does.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'

  type Size = 'sm' | 'lg' | 'title'

  interface Props {
    /**
     * `sm` — a header's brand (`text-sm font-semibold`); `lg` — the splash
     * (`text-xl`); `title` — a page title (`text-3xl`, the welcome heading).
     */
    size?: Size
    /** The element to draw: `span` (default) inline, `p` as a line, `h1`–`h3` as a heading. */
    as?: 'span' | 'p' | 'h1' | 'h2' | 'h3'
    /** Extra layout classes from the host (margins); never colour. */
    class?: string
    testid?: string
  }

  let { size = 'sm', as = 'span', class: extra = '', testid }: Props = $props()

  const SIZES: Record<Size, string> = {
    sm: 'text-sm font-semibold',
    lg: 'text-xl font-semibold',
    title: 'text-3xl font-semibold',
  }

  const heading = $derived(as.startsWith('h'))
  const name = $derived($LL.common.app_name())
</script>

<svelte:element
  this={as}
  class="ed-wordmark m-0 {SIZES[size]} {extra}"
  role={heading ? undefined : 'img'}
  aria-label={name}
  data-testid={testid}
>
  <span class="ed-wordmark-hi">{$LL.common.wordmark.hi()}</span>
  <span class="ed-wordmark-rest"><em class="ed-wordmark-mark">{$LL.common.wordmark.mark()}</em>{$LL.common.wordmark.down()}</span>
</svelte:element>

<style>
  /* The site's `.wordmark` rules, in the app's own tokens (docs/theming.md). */
  .ed-wordmark {
    color: var(--ed-ink);
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .ed-wordmark-hi {
    color: var(--ed-mark-fg);
    background: var(--ed-mark-bg);
    padding: 0 0.2em;
    border-radius: 0.15rem;
  }
  .ed-wordmark-rest {
    font-weight: 400;
    color: var(--ed-ink-muted);
  }
  .ed-wordmark-mark {
    font-style: italic;
    font-weight: 400;
  }
</style>
