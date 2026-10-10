/**
 * Every STATIC command id the shell registers, as data (quiet-shell F10, F16).
 *
 * The command tables themselves are code — each row closes over the shell's
 * actions — so nothing outside a running shell can enumerate them. This list
 * is what can: the generated `spec/ohhi.keymap.v1.schema.json` and
 * `spec/ohhi.layout.v1.schema.json` enumerate it, and `docs/customising.md`
 * lists it. `command-ids.test.ts` builds every table and asserts the two
 * agree, so a new command that is not added here fails the build rather than
 * quietly missing from the schema an agent reads.
 *
 * Not listed, by design: the state-dependent rows a provider adds (one
 * `group.open:<id>` per saved tab group, one `template:<name>` per template
 * file) — an id nobody can predict is an id nobody can bind.
 *
 * Pure: no imports, so the schema generator can load it on plain node.
 */
export const COMMAND_IDS = [
  // navigation.svelte.ts › defaultCommands
  'nav.quick-open',
  'nav.command-palette',
  'nav.search',
  'file.new',
  'file.new-folder',
  'file.delete',
  'file.move',
  'share.folder',
  'share.add',
  'share.link-device',
  'nav.back',
  'nav.forward',
  'view.sidebar',
  'view.rail',
  'daily.today',
  'daily.prev',
  'daily.next',
  'app.settings',
  // views.ts › viewCommands (one per view kind)
  'app.inspector',
  'app.log',
  'app.shared',
  // shell-commands.ts
  'app.reload-resources',
  'view.focus',
  'template.insert',
  'layout.use-file',
  // shell-commands.ts › help (first-run E1; help.svelte.ts HELP_COMMAND_IDS)
  'help.menu',
  'help.start',
  'help.shortcuts',
  'help.recovery',
  'help.sharing',
  'help.customise',
  'help.agents',
  'help.changes',
  'help.report',
  // pane-commands.ts › paneCommands
  'workspace.split-auto',
  'workspace.split-down',
  'workspace.split-right',
  'workspace.close-pane',
  'workspace.focus-left',
  'workspace.focus-down',
  'workspace.focus-up',
  'workspace.focus-right',
  'workspace.focus-next',
  'workspace.zoom',
  'workspace.rotate',
  'workspace.move-left',
  'workspace.move-down',
  'workspace.move-up',
  'workspace.move-right',
  'workspace.resize-left',
  'workspace.resize-down',
  'workspace.resize-up',
  'workspace.resize-right',
  'workspace.equalize',
  'workspace.mode',
  'workspace.close-others',
  'tab.new',
  'tab.close',
  'tab.prev',
  'tab.next',
  'tab.goto-1',
  'tab.goto-2',
  'tab.goto-3',
  'tab.goto-4',
  'tab.goto-5',
  'tab.goto-6',
  'tab.goto-7',
  'tab.goto-8',
  'tab.goto-9',
  'tab.move-left',
  'tab.move-down',
  'tab.move-up',
  'tab.move-right',
  'tab.pin',
  'tab.reopen',
  // pane-commands.ts › groupCommands
  'group.new',
  'group.toggle',
  'group.close',
  'group.copy-links',
  'group.ungroup',
  'group.move-left',
  'group.move-down',
  'group.move-up',
  'group.move-right',
  // read.svelte.ts › readCommands
  'view.toggle-reading',
  'view.toggle-source',
  'view.mode-live',
  'view.mode-source',
  'view.mode-reading',
  'edit.toggle-checkbox',
  // pane-commands.ts › formatCommands (@ohhi/editor FORMAT_COMMANDS)
  'format.bold',
  'format.italic',
  'format.strike',
  'format.highlight',
  'format.code',
  'format.heading-1',
  'format.heading-2',
  'format.heading-3',
  'format.paragraph',
  'format.list',
  'format.ordered-list',
  'format.task',
  'format.indent',
  'format.outdent',
  'format.quote',
  'format.callout',
  'format.code-block',
  'format.link',
  'format.wikilink',
  'format.table',
  'format.image',
  'format.rule',
  // pane-commands.ts › tableCommands (@ohhi/editor-lang TABLE_COMMANDS) —
  // palette-only, offered while the caret is in a table (editor-usability E4)
  'table.insert-row-below',
  'table.insert-column-right',
  'table.delete-row',
  'table.delete-column',
  'table.align',
  'table.move-row-up',
  'table.move-row-down',
  'table.move-column-left',
  'table.move-column-right',
  // writing-harness
  'app.session',
  'ai.new-session',
  'ai.add-selection',
  'ai.run-skill',
  'ai.stop-run',
  'ai.accept-suggestion',
  'ai.reject-suggestion',
  'ai.accept-all',
  'ai.reject-all',
  'ai.undo-agent',
  'note.comment',
] as const

export type CommandId = (typeof COMMAND_IDS)[number]

/**
 * Entries a layout's `bars.format` may hold that are NOT commands:
 * the toolbar's grouped items (`FormatBar.svelte` — the paragraph-style menu
 * over `format.paragraph` / `format.heading-*` / `format.quote`).
 */
export const TOOLBAR_ITEM_IDS = ['format.paragraph-style'] as const

/** The prefix of the per-file template rows (F11); not bindable, see above. */
export const TEMPLATE_COMMAND_PREFIX = 'template:'
