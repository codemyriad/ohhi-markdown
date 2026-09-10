/**
 * The shell's component primitives (chrome-shaping U1). Everything here is
 * built on Melt UI builders and renders through the design tokens; nothing in
 * `components/` should re-implement an overlay, a menu, a tooltip or a form
 * field. See `.claude/skills/ui-development`.
 */
export { default as Dialog } from './Dialog.svelte'
export { default as Tooltip } from './Tooltip.svelte'
export { default as IconButton } from './IconButton.svelte'
export { default as DropdownMenu } from './DropdownMenu.svelte'
export { default as MenuItem } from './MenuItem.svelte'
export { default as MenuSeparator } from './MenuSeparator.svelte'
export { default as Tabs, type Tab } from './Tabs.svelte'
export { default as Toaster } from './Toaster.svelte'
export { toast, toaster, type ToastData, type ToastLevel } from './toaster.js'
export { default as Field } from './Field.svelte'
export { default as TextControl } from './TextControl.svelte'
export { default as CheckControl } from './CheckControl.svelte'
export { default as FieldErrors } from './FieldErrors.svelte'
export { default as Description } from './Description.svelte'
export { createForm, type Form } from './form.svelte.js'
export { controlAttrs, getAriaDescribedBy, getAriaInvalid } from './form-attrs.js'
export type { Placement, MenuPlacement } from './placement.js'
