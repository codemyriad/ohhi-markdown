<script lang="ts">
  /**
   * Report a problem (first-run-shaping E3): one sentence from the person,
   * the facts attached automatically (`reportFactLines`, report.ts — the
   * build, the platform, the vault, the relay, the open note's path and its
   * pill words, the Log's last events; never note content), and *Copy
   * report*. The app sends nothing anywhere (Question 4: clipboard only), so
   * nothing here says "sent": the person pastes it wherever they ask for help.
   *
   * The clipboard write runs inside the click handler (the user gesture a
   * browser requires). When the clipboard refuses, the whole report appears
   * in a read-only box, selected, to copy by hand.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { tick } from 'svelte'
  import { reportFactLines, reportText, type ReportFacts } from '../report.js'
  import Dialog from '../ui/Dialog.svelte'
  import Field from '../ui/Field.svelte'
  import TextControl from '../ui/TextControl.svelte'

  interface Props {
    facts: ReportFacts
    /** The report's timestamp (the shell's injected clock). */
    now: () => number
    /** Injected for the tests; the system clipboard otherwise. */
    write?: (text: string) => Promise<void>
    onClose: () => void
  }

  let { facts, now, write = (text) => navigator.clipboard.writeText(text), onClose }: Props = $props()

  const t = $derived($LL.web.help.report)
  const lines = $derived(reportFactLines(facts, $LL))

  let what = $state('')
  let copied = $state(false)
  /** The report, when the clipboard refused it. */
  let fallback = $state<string | null>(null)
  let fallbackEl = $state<HTMLTextAreaElement>()

  async function copy(): Promise<void> {
    const text = reportText(what, facts, now(), $LL)
    try {
      await write(text)
      fallback = null
      copied = true
    } catch {
      copied = false
      fallback = text
      await tick()
      fallbackEl?.focus()
      fallbackEl?.select()
    }
  }
</script>

<Dialog title={t.title()} description={t.description()} width="lg" testid="report-dialog" {onClose}>
  <div class="space-y-3">
    <Field name="what">
      <TextControl
        label={t.what_label()}
        multiline
        rows={3}
        bind:value={what}
        placeholder={t.what_placeholder()}
        testid="report-what"
        oninput={() => (copied = false)}
      />
    </Field>

    <section aria-labelledby="report-attached-title" class="rounded border border-base-300 bg-base-200/40">
      <h3 id="report-attached-title" class="px-3 pt-2 text-xs font-semibold text-base-content/80">{t.attached()}</h3>
      <ul data-testid="report-facts" class="max-h-56 overflow-y-auto px-3 py-2 font-ed-mono text-[11px] leading-5 break-words text-base-content/80">
        {#each lines as line, i (i)}
          <li data-testid="report-fact" class="whitespace-pre-wrap">{line}</li>
        {/each}
      </ul>
      <p data-testid="report-never" class="border-t border-base-300 px-3 py-1.5 text-[11px] text-base-content/80">
        {t.never_content()}
      </p>
    </section>

    <!-- One live region, in the DOM from mount: a screen reader announces a
         change to an existing status, not a status that arrives with its text. -->
    <p role="status" data-testid="report-status" class="text-xs text-base-content/80">
      {#if fallback !== null}{t.copy_failed()}{:else if copied}<span data-testid="report-copied">{t.copied()}</span
        >{/if}
    </p>
    {#if fallback !== null}
      <textarea
        bind:this={fallbackEl}
        readonly
        data-testid="report-fallback"
        aria-label={t.fallback_label()}
        rows="6"
        class="w-full rounded border border-base-300 bg-base-100 p-2 font-ed-mono text-[11px] text-base-content"
        >{fallback}</textarea
      >
    {/if}

    <div class="flex justify-end gap-2">
      <button
        type="button"
        data-testid="report-cancel"
        onclick={onClose}
        class="rounded border border-base-300 px-3 py-1.5 text-xs text-base-content/70 hover:bg-base-200"
      >
        {copied ? $LL.common.close() : $LL.common.cancel()}
      </button>
      <button
        type="button"
        data-testid="report-copy"
        onclick={() => void copy()}
        class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content"
      >
        {t.copy()}
      </button>
    </div>
  </div>
</Dialog>
