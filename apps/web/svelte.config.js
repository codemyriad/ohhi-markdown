import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { preprocessMeltUI, sequence } from '@melt-ui/pp'

export default {
  // Melt's preprocessor enables the `use:melt={$builder}` shorthand the shell's
  // primitives (src/lib/ui/) are written in — the same setup as Edible.
  preprocess: sequence([vitePreprocess(), preprocessMeltUI()]),
}
