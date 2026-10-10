<script lang="ts">
  /**
   * `ai.run-skill`'s picker (writing-harness B9): the palette overlay over
   * the skills that fit the target, filtered as you type. Mounted on demand
   * by `pickSkill` (`skills.svelte.ts`); one overlay, the palette's keyboard
   * model (parent R4.1), no second list-and-filter.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { SkillMeta } from '@ohhi/harness'
  import Palette, { type PaletteRow } from './Palette.svelte'

  interface Props {
    skills: SkillMeta[]
    placeholder: string
    onPick: (meta: SkillMeta) => void
    onClose: () => void
  }

  let { skills, placeholder, onPick, onClose }: Props = $props()
  let query = $state('')

  const t = $derived($LL.web.ai.skills)
  const rows = $derived.by((): PaletteRow[] => {
    const q = query.trim().toLowerCase()
    return skills
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q))
      .map((m) => ({
        id: m.name,
        title: m.name,
        subtitle: m.description,
        ...(m.kind ? { hint: t.kind[m.kind]() } : {}),
      }))
  })
</script>

<Palette
  {placeholder}
  testid="skill-picker"
  {rows}
  {query}
  onQuery={(q) => (query = q)}
  onPick={(row) => {
    const meta = skills.find((m) => m.name === row.id)
    if (meta) onPick(meta)
  }}
  {onClose}
/>
