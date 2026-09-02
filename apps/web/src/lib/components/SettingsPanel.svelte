<script lang="ts">
  import {
    defaultRelay,
    devtoolsEnabled,
    listVaults,
    loadShares,
    loadUser,
    operatorSecret,
    removeShare,
    removeVault,
    saveUser,
    setDefaultRelay,
    setDevtools,
    setOperatorSecret,
  } from '../config.js'

  interface Props {
    onClose: () => void
  }

  let { onClose }: Props = $props()

  // Editable copies; persisted on save/blur. The panel re-reads config on
  // every open (it is mounted fresh each time).
  let name = $state(loadUser() ?? '')
  let relay = $state(defaultRelay())
  let secret = $state(operatorSecret())
  let shares = $state(loadShares())
  let vaults = $state(listVaults())
  let devtools = $state(devtoolsEnabled())

  function persist(): void {
    if (name.trim()) saveUser(name)
    setDefaultRelay(relay)
    setOperatorSecret(secret)
    setDevtools(devtools)
  }

  function close(): void {
    persist()
    onClose()
  }

  function forgetShare(room: string): void {
    removeShare(room)
    shares = loadShares()
  }

  function forgetVault(room: string): void {
    removeVault(room)
    vaults = listVaults()
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-20 flex items-start justify-center bg-black/30 pt-16"
  onclick={(e) => {
    if (e.target === e.currentTarget) close()
  }}
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
    data-testid="settings-panel"
    class="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 shadow-xl"
  >
    <div class="flex items-center justify-between">
      <h2 id="settings-title" class="text-lg font-semibold text-gray-900">Settings</h2>
      <button
        data-testid="settings-close"
        onclick={close}
        aria-label="Close settings"
        class="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
      >
        ✕
      </button>
    </div>

    <label class="mt-4 block">
      <span class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Display name</span>
      <input
        data-testid="settings-name"
        bind:value={name}
        placeholder="Anonymous"
        class="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      <span class="mt-1 block text-xs text-gray-500">
        Shown to collaborators; applies the next time a vault is opened.
      </span>
    </label>

    <label class="mt-4 block">
      <span class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Default relay</span>
      <input
        data-testid="settings-relay"
        bind:value={relay}
        placeholder="ws://localhost:8787"
        class="mt-1 w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none"
      />
      <span class="mt-1 block text-xs text-gray-500">Used when creating new shares.</span>
    </label>

    <label class="mt-4 block">
      <span class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
        Relay operator secret
      </span>
      <input
        data-testid="settings-secret"
        type="password"
        bind:value={secret}
        placeholder="unset"
        autocomplete="off"
        class="mt-1 w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none"
      />
      <span class="mt-1 block text-xs text-gray-500">
        Lets this app mint share tokens on your relay (coming with in-app sharing).
      </span>
    </label>

    <label class="mt-4 flex items-center gap-2">
      <input data-testid="settings-devtools" type="checkbox" bind:checked={devtools} />
      <span class="text-sm text-gray-700">Developer tools</span>
      <span class="text-xs text-gray-500">— sync inspector panel (or force with ?debug=1)</span>
    </label>

    {#if vaults.length > 0}
      <section class="mt-5">
        <h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Vaults</h3>
        <ul class="mt-1 space-y-1">
          {#each vaults as v (v.room)}
            <li class="flex items-center gap-2 text-sm text-gray-700">
              <span class="min-w-0 flex-1 truncate">{v.name}</span>
              <button
                onclick={() => forgetVault(v.room)}
                aria-label="Forget vault {v.name}"
                class="shrink-0 rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                forget
              </button>
            </li>
          {/each}
        </ul>
        <p class="mt-1 text-xs text-gray-400">Forgetting a vault never touches its files.</p>
      </section>
    {/if}

    {#if shares.length > 0}
      <section class="mt-5">
        <h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Remembered shares</h3>
        <ul class="mt-1 space-y-1">
          {#each shares as s (s.room)}
            <li class="flex items-center gap-2 text-sm text-gray-700">
              <span class="min-w-0 flex-1 truncate">{s.label || s.room}</span>
              <button
                onclick={() => forgetShare(s.room)}
                aria-label="Forget share {s.label || s.room}"
                class="shrink-0 rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                forget
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</div>
