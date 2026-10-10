<script lang="ts">
  /**
   * The Import door (first-run F1, slice F6): how notes from another app come
   * in, one row per route. Every sentence is a promise the app keeps today —
   * an Obsidian vault opens in place (`.obsidian/` ignored, daily notes
   * honoured), everything else arrives as markdown in a folder. When the
   * Notion importer ships (bases A10) its row gains a verb; the dialog does
   * not change shape.
   */
  import { FileText, FolderOpen, Notebook } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { guideHref } from '../guide.js'
  import Dialog from '../ui/Dialog.svelte'
  import { OUTLINE_BUTTON } from '../ui/styles.js'

  interface Props {
    isTauri: boolean
    busy?: boolean
    /** The desktop's open-folder path — the same one the welcome's first door runs. */
    onOpenFolder: () => void
    onClose: () => void
  }

  let { isTauri, busy = false, onOpenFolder, onClose }: Props = $props()

  const t = $derived($LL.web.import_app)
  const link =
    'text-xs font-medium text-base-content underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary'
</script>

<Dialog title={t.title()} width="md" showClose closeTestid="import-close" testid="import-dialog" {onClose}>
  <ul class="flex flex-col gap-2">
    <li class="flex gap-3 rounded-lg border border-base-300 p-3" data-testid="import-obsidian">
      <FolderOpen size={18} strokeWidth={1.75} aria-hidden="true" class="mt-0.5 shrink-0 text-base-content/70" />
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold">{t.obsidian()}</h3>
        <p class="mt-0.5 text-xs text-base-content/80">{t.obsidian_body()}</p>
        {#if isTauri}
          <button
            type="button"
            data-testid="import-open-folder"
            disabled={busy}
            onclick={() => {
              onClose()
              onOpenFolder()
            }}
            class="mt-2 {OUTLINE_BUTTON} px-3 py-1 text-xs font-medium text-base-content/80 disabled:opacity-50"
          >
            {t.open_folder()}
          </button>
        {:else}
          <p data-testid="import-obsidian-browser" class="mt-2 text-xs text-base-content/70">{t.obsidian_browser()}</p>
        {/if}
      </div>
    </li>
    <li class="flex gap-3 rounded-lg border border-base-300 p-3" data-testid="import-notion">
      <Notebook size={18} strokeWidth={1.75} aria-hidden="true" class="mt-0.5 shrink-0 text-base-content/70" />
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold">{t.notion()}</h3>
        <p class="mt-0.5 text-xs text-base-content/80">{t.notion_body()}</p>
        <a href={guideHref('import')} target="_blank" rel="noreferrer" class="mt-2 inline-block {link}">{t.guide()}</a>
      </div>
    </li>
    <li class="flex gap-3 rounded-lg border border-base-300 p-3" data-testid="import-other">
      <FileText size={18} strokeWidth={1.75} aria-hidden="true" class="mt-0.5 shrink-0 text-base-content/70" />
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold">{t.other()}</h3>
        <p class="mt-0.5 text-xs text-base-content/80">{t.other_body()}</p>
        <a href={guideHref('import')} target="_blank" rel="noreferrer" class="mt-2 inline-block {link}">{t.guide()}</a>
      </div>
    </li>
  </ul>
  <p class="mt-3 text-xs text-base-content/70" data-testid="import-foot">{t.foot()}</p>
</Dialog>
