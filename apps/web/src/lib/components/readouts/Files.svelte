<script lang="ts">
  /**
   * `files` (nextcloud-build decision 8): whether the notes' files in
   * Nextcloud Files match, as the vault's headless custodian announces it —
   * *In Files*, *N waiting* while writes are pending or retrying, *Blocked
   * (423)* when Nextcloud refused one. Nothing at all while no custodian is
   * present (`ui.custodian` null): no claim about files nobody is keeping.
   * Semantic chrome colours only — the sync tokens belong to the `sync`
   * readout (golden rule 4).
   *
   * The `files` entry of the readout catalogue (`readouts.ts`); the counting
   * is the pure `nextcloud/files-status.ts`.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { filesReadout } from '../../nextcloud/files-status.js'
  import type { ReadoutContext } from '../../readouts.js'

  let { ctx }: { ctx: Pick<ReadoutContext, 'workspace'> } = $props()

  const t = $derived($LL.web.nextcloud.files)
  const state = $derived(
    filesReadout(ctx.workspace?.ui.custodian ?? null, ctx.workspace?.ui.files ?? [], ctx.workspace?.ui.records ?? {})
  )
  const text = $derived(
    state.kind === 'in-files'
      ? t.in_sync()
      : state.kind === 'waiting'
        ? t.waiting({ count: state.count })
        : state.kind === 'blocked'
          ? state.status === null
            ? t.blocked_unknown()
            : t.blocked({ status: state.status })
          : ''
  )
  const hint = $derived(
    state.kind === 'in-files'
      ? t.in_sync_hint()
      : state.kind === 'waiting'
        ? t.waiting_hint({ count: state.count })
        : state.kind === 'blocked'
          ? t.blocked_hint({ count: state.count })
          : ''
  )
</script>

{#if state.kind !== 'hidden'}
  <span
    data-testid="files-readout"
    data-state={state.kind}
    title={hint}
    aria-label={`${text}. ${hint}`}
    role="status"
    class="whitespace-nowrap px-1 text-xs tabular-nums {state.kind === 'blocked'
      ? 'text-error'
      : state.kind === 'waiting'
        ? 'text-warning'
        : 'text-base-content/80'}"
  >
    {text}
  </span>
{/if}
