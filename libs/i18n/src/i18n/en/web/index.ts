import type { BaseTranslation } from '../../i18n-types.js'

/**
 * The `web` namespace: every user-facing string in `apps/web`. Grouped by
 * the surface that renders it (the shell, the tree, settings, …), keys in
 * snake_case, arguments typed (`{path:string}`, `{count:number}`), plurals
 * with `{{s}}` — the Edible dictionary conventions.
 *
 * The English text here is what the Playwright specs assert on. Change a
 * string here and the spec is the thing that catches it.
 */

const shell = {
  /**
   * While a vault opens (`BootSplash.svelte`, QA round 1): it waits for the
   * vault's own files, never the relay — so "opening", not "connecting".
   */
  boot: {
    label: 'Opening your vault',
    opening: 'Opening your notes…',
    /** Offered only once an open has taken several seconds: back to the vault list. */
    back_to_vaults: 'Back to your vaults',
  },
  show_navigator: 'Show file navigator',
  hide_navigator: 'Hide file navigator',
  show_sidebar: 'Show sidebar',
  hide_sidebar: 'Hide sidebar',
  navigator_label: 'File navigator',
  resize_navigator: 'Resize file navigator',
  nothing_shared: 'Local vault · nothing shared',
  settings_with_binding: 'Settings ({binding:string})',
  unnamed_vault: 'Vault',
  /** The navigator as a drawer over the page (quiet-shell F3): its pin icon (Round 2, P7 — a device pin). */
  pin_navigator: 'Pin as a column',
  /** A column this device pinned: back to the layout's own drawer. */
  unpin_navigator: 'Unpin — back to a drawer',
  /**
   * The pin control on a small screen (QA round 1), disabled: a pin is kept
   * there but not honoured — the side floats as it would unpinned.
   */
  pin_wide_only: 'Pins apply on wider screens',
  /** The same, for a side this device has pinned. */
  pinned_wide_only: 'Pinned on wider screens — it floats here',
}

const notices = {
  toast_title: {
    error: 'Something went wrong',
    warn: 'Heads up',
    info: 'Note',
  },
  /**
   * The words for logged events (spike S22): an event stores a code and its
   * params, never text, and `describeEvent` (apps/web/src/lib/event-text.ts)
   * picks the words at render time. A code whose words already live with
   * their surface (the no-link warning, the mounts reasons) points there
   * rather than repeating them here.
   */
  /** Words for a person: the developer detail (room, token, seeding) stays in the console (`MountSession.authFailure`). */
  relay_refused: 'The relay refused the link for this folder ({reason:string}).',
  /** *Stop sharing*'s opt-in revoke failed AFTER the folder was unshared. */
  revoke_failed: 'The folder is no longer shared, but its links on {host:string} could not be revoked: {message:string}',
  /** Adopt outcomes that were silently dropped before S22; logged at info, never toasted. */
  mount: {
    adopted: "'{path:string}' is now a shared folder on this device.",
    absorbed: "'{path:string}' is no longer shared — its files are local notes again.",
    adopt_cancelled: "'{path:string}' stopped being shared before it finished attaching — its files stay here.",
    ghosts_held: "Files in '{path:string}' were deleted on another device — the deletion waits for you to confirm it.",
    status: "'{path:string}' changed state.",
  },
  /** A code this build does not know how to word (a newer peer, a stale log). */
  unknown: 'Something happened ({code:string}).',
  /**
   * The room logs' own kinds (sharing E3). `{who}` is `shared.who.*` or a
   * self-reported name; never "has joined", never "verified".
   */
  doc_changed: '{who:string} changed {path:string}',
  file_created: '{who:string} created {path:string}',
  file_deleted: '{who:string} deleted {path:string}',
  file_moved: '{who:string} moved {from:string} to {path:string}',
  peer_joined: '{name:string} came online',
  peer_left: '{name:string} went offline',
  review_opened: '{path:string} changed in two places at once and needs your review.',
  breaker_held: '{count:number} change{{s}} arrived at once and wait{{s|}} for you to confirm.',
  relay_connected: 'Connected to {host:string}.',
  relay_reconnecting: 'Lost {host:string} — reconnecting. Your edits are safe on this device.',
  relay_offline: 'Offline from {host:string}. Your edits are safe on this device.',
}

/**
 * The dock (Round 2 P4): a small floating strip over the editor's right edge
 * that opens a panel with its own tabs; pinned, the same panel is the right
 * column.
 */
const rail = {
  label: 'Sidebar',
  /** The floating strip's toolbar name. */
  strip: 'Sidebar shortcuts',
  /** The panel's tab list name. */
  tabs: 'Sidebar sections',
  collapse: 'Collapse sidebar',
  expand: 'Expand sidebar',
  pin: 'Pin as a sidebar',
  unpin: 'Unpin the sidebar',
  sections: {
    links: 'Links',
    history: 'History',
    comments: 'Comments',
  },
}

const actions = {
  label: 'Navigate',
  open_note: 'Open note',
  search: 'Search',
  commands: 'Commands',
}

const breadcrumb = {
  /** The folder popover (sharing E6): what a folder segment is, as far as sharing goes. */
  folder_title: 'About {path:string}',
  local: 'Local — only on this device',
  reveal: 'Show in navigator',
  open_shared: 'Open Shared',
  label: 'Current note',
  show_in_navigator: 'Show {path:string} in the file navigator',
  no_note: 'No note open',
}

const status_bar = {
  /** `words` and `chars` (round 3, Q4): grouped digits, as Obsidian's corner reads — "2,301 characters". */
  words: '{count:number|int} word{{s}}',
  chars: '{count:number|int} character{{s}}',
  /** The corner's readouts (`bars.status`): one item and the next, "412 words · 2,301 characters". */
  corner: 'Note status',
  join: ' · ',
  /** A count on its own (QA round 1): the small screen's corner chip, "1,204". */
  count: '{count:number|int}',
}

/**
 * The pane tree (tab-groups W1): the split tree, its handles, the per-pane
 * status line and the pane half of the command table. `commands.focus`,
 * `commands.move` and `commands.resize` are the FAMILY labels the mode's hint
 * bar collapses `h j k l` onto — they are not commands themselves.
 */
const panes = {
  area: 'Editor',
  label: 'Pane {n:number}',
  lead: '{pane:string} · {tabs:string}',
  /** The menu/dialog section that sends a tab or a whole group to another pane. */
  move_to: 'Move to pane',
  resize: 'Resize panes',
  resize_between: 'Resize: {a:string} / {b:string}',
  resize_value: '{pct:number}%',
  tab_count: '{count:number} tab{{s}}',
  zoomed: 'Zoomed',
  /** An unfocused pane's own sync dot when the status bars are merged (S21, golden rule 4). */
  sync_dot: '{pane:string}: {state:string}',
  drop_here: 'Move {name:string} here',
  split_here: 'Split with {name:string}',
  commands: {
    split_auto: 'New pane',
    split_down: 'Split down',
    split_right: 'Split right',
    close_pane: 'Close pane',
    focus: 'Focus pane',
    focus_left: 'Focus pane left',
    focus_down: 'Focus pane below',
    focus_up: 'Focus pane above',
    focus_right: 'Focus pane right',
    focus_next: 'Focus next pane',
    zoom: 'Zoom pane',
    rotate: 'Swap split direction',
    move: 'Move pane',
    move_left: 'Move pane left',
    move_down: 'Move pane down',
    move_up: 'Move pane up',
    move_right: 'Move pane right',
    resize: 'Resize pane',
    resize_left: 'Resize pane left',
    resize_down: 'Resize pane down',
    resize_up: 'Resize pane up',
    resize_right: 'Resize pane right',
    equalize: 'Equalize panes',
    close_others: 'Close other tabs',
    mode: 'Pane mode',
  },
}

/** A pane's tab strip, its menus, and the tab half of the command table. */
const tabs = {
  list: 'Open notes',
  list_n: 'Open notes {index:number} of {total:number}',
  untitled: 'New tab',
  new_tab: 'New tab',
  more: 'Tab groups',
  no_groups: 'No tab groups in this pane yet',
  live: 'Live editor',
  pinned: 'Pinned',
  close: 'Close {name:string}',
  menu: 'Actions for {name:string}',
  pin: 'Pin',
  unpin: 'Unpin',
  picker: {
    lead: 'Open a note',
    placeholder: 'Type to filter…',
    empty: 'No note matches',
    new_note: 'New note',
    open_note: 'Open note…',
    recent: 'Recent',
    recent_empty: 'No notes opened here yet',
    results: 'Results',
    /** settings-shaping ST6: the launcher's doors to Settings › Customise and › Agents. */
    /** The list of the launcher's doors to Settings (its accessible name). */
    more: 'More',
    customise: 'Customise the app',
    customise_hint: 'Layouts, keys and themes are files',
    agents: 'Connect an agent',
    agents_hint: 'Let an agent search and edit this vault',
  },
  commands: {
    new: 'New tab',
    close: 'Close tab',
    prev: 'Previous tab',
    next: 'Next tab',
    goto: 'Go to tab',
    goto_n: 'Go to tab {n:number}',
    move: 'Move tab to another pane',
    move_left: 'Move tab to the pane left',
    move_down: 'Move tab to the pane below',
    move_up: 'Move tab to the pane above',
    move_right: 'Move tab to the pane right',
    pin: 'Pin / unpin tab',
    reopen: 'Reopen closed tab',
  },
}

/**
 * Tab groups (tab-groups W2, B4/B8/B9): the chip in the strip, its manage
 * dialog, the group rows in a tab's context menu, and the strip-end list —
 * Firefox's model, so "close" is the save and only "delete" loses anything.
 */
const groups = {
  untitled: 'Untitled group',
  chip: {
    hint: 'Fold or unfold — right-click to manage',
    tabs: '{count:number} tab{{s}}',
  },
  manage: {
    /** The popover's accessible name only — P1.3 dropped the title line. */
    title: 'Manage group',
    name: 'Group name',
    colour: 'Colour',
    colour_n: 'Colour {n:number}',
    new_tab: 'New tab in group',
    copy_links: 'Copy {count:number} link{{s}} in group',
    fold: 'Fold',
    unfold: 'Unfold',
    close: 'Close group',
    close_hint: 'Stays in the list',
    ungroup: 'Ungroup tabs',
    delete: 'Delete group',
  },
  delete_confirm: {
    title: 'Delete this group?',
    body: '{name:string} and its {count:number} tab{{s}} go for good. Close it instead and it waits in the list.',
    confirm: 'Delete group',
  },
  menu: {
    open: 'Open',
    saved: 'In the list',
    show_all: 'Show all…',
    open_links: 'Open links of this note as a group',
    new_from_active: 'New group from active tab',
    no_links: 'This note has no links to open.',
    needs_note: 'Open a note in this pane first',
  },
  all: {
    title: 'Tab groups',
    description: 'Groups open in a pane are ticked; the rest are waiting in the list.',
    empty: 'No tab groups yet — group a few tabs and they show up here.',
    meta: '{count:number} tab{{s}} · {when:string}',
    open_state: 'Open',
  },
  tab_menu: {
    add_to: 'Add to group',
    new_group: 'New group…',
    remove: 'Remove from group',
    fold: 'Fold group',
    unfold: 'Unfold group',
    close: 'Close group',
  },
  copied: 'Copied {count:number} link{{s}} from {name:string}',
  copy_failed: 'Could not reach the clipboard — nothing was copied.',
  commands: {
    new: 'New group from this tab',
    toggle: 'Fold / unfold group',
    close: 'Close group',
    copy_links: 'Copy group as links',
    ungroup: 'Ungroup tabs',
    open: 'Open group: {name:string}',
    move: 'Move group to another pane',
    move_left: 'Move group to the pane left',
    move_down: 'Move group to the pane below',
    move_up: 'Move group to the pane above',
    move_right: 'Move group to the pane right',
  },
}

/**
 * The pane mode's hint bar (B12). `names` is the badge; `enter` labels the
 * rows that open a sub-mode; `leave`/`done` is what Escape does, which
 * differs because move and resize are sticky and the rest are one-shot.
 */
const mode = {
  bar: 'Pane mode keys',
  names: {
    pane: 'PANE',
    move: 'MOVE',
    resize: 'RESIZE',
    tab: 'TAB',
    group: 'GROUP',
  },
  enter: {
    move: 'move…',
    resize: 'resize…',
    tab: 'tab…',
    group: 'group…',
  },
  leave: 'leave',
  done: 'done',
  /**
   * E6: the corner cue (Settings › Layout › Pane keys: Subtle / Off) — the
   * badge and two verbs above the word count; `?` (`common.keys.help`) opens
   * every key. Its region is named `bar`, as the full bar is.
   */
  cue: {
    more: 'keys',
    less: 'fewer',
    all: 'Every key in this mode',
  },
}

/**
 * The Read slice (read-shaping.md X2/X4): the three view modes, the controls
 * that choose between them, and the one string CM6 needs handed to it —
 * decoration code has no `$LL`, so the missing-attachment placeholder's label
 * travels through the `ReadHost` facet.
 */
const read = {
  modes: {
    live: 'Live',
    source: 'Source',
    reading: 'Reading',
  },
  mode_menu: 'View mode',
  /** The tab strip's mode menu (round 3, Q5): its trigger names the mode it is in. */
  mode_menu_current: 'View mode: {mode:string}',
  /** The icon a Source/Reading tab carries; Live tabs carry nothing. */
  tab_mode: '{mode:string} view',
  missing_attachment: 'Missing attachment',
  /** `![[X.base]]` naming a collection the vault has not got (bases-shaping A6). */
  missing_collection: 'Missing collection',
  /** The accessible name of a checkbox whose task has no text yet. */
  task: 'Task',
  /** The dim count beside the collapsed strip's chips. */
  properties: '{count:number} propert{{y|ies}}',
  /** Shown instead of chips when the YAML is outside the patchable subset. */
  frontmatter_unsupported: 'Unsupported frontmatter',
  /** The hint bar over a table the caret is in (editor-usability E4). */
  table_hint: {
    toolbar: 'Table',
    next_cell: 'Tab next cell',
    next_row: '↵ next row',
    /** Enter on an empty last row takes it out and leaves the table (Advanced Tables' way out). */
    leave: '↵ on an empty row: done',
    add_row: '+ row',
    add_column: '+ column',
    align: 'Align',
  },
  /** The code card's header (editor-usability E3): the language chip and the copy button. */
  code_block: {
    copy: 'Copy code',
    copied: 'Copied',
    /** The chip's accessible name; a click opens the language list. */
    language: 'Language: {lang:string}. Change language',
    /** The chip's text when the fence names no language. */
    plain: 'plain text',
  },
  /** A foldable callout's chevron; `aria-expanded` says which way it is. */
  callout: {
    toggle: 'Fold {title:string}',
  },
  /**
   * The link card (QA round 1): a finger's tap on a wikilink shows it, with
   * the one action that opens the note — instead of opening it at once.
   */
  link_card: {
    label: 'Link',
    open: 'Open “{name:string}”',
    create: 'Create “{name:string}”',
  },
  /**
   * The `[[` link popover (editor-usability E1). CM6 draws it, so these travel
   * to the editor through the wikilink host, as the widget copy does.
   */
  link_popover: {
    /** The first group in a note inside a shared folder: that share's notes. */
    scope: 'In {mount:string}',
    /** The group below the divider — ONE line in the popover. */
    others: 'Only you · not in this share',
    /** That header's tooltip. */
    others_title: "Collaborators can't open these",
    create: 'Create “{query:string}”',
    /** The footer's words, after their keys (`common.keys`). */
    hint_link: 'link',
    hint_heading: 'heading',
    hint_alias: 'alias',
  },
  commands: {
    toggle_reading: 'Toggle reading view',
    toggle_source: 'Toggle Live Preview / Source',
    mode: 'View: {mode:string}',
    toggle_checkbox: 'Toggle checkbox',
  },
}

const pill = {
  label: {
    green: 'synced',
    yellow: 'syncing',
    red: 'diverged',
    offline: 'offline',
  },
  title: {
    green: 'synced (relay)',
    yellow: 'working — ops or disk flush in flight',
    red: 'diverged — review required',
    offline: 'offline — edits safe locally, nothing reaching the relay',
  },
  /**
   * The vault rollup beside the vault name (P3). Title case and a word, not a
   * status key: it sits in a row of names, and "green" told nobody anything.
   */
  vault: {
    green: 'Synced',
    yellow: 'Syncing',
    red: 'Diverged',
    offline: 'Offline',
  },
  vault_title: {
    green: 'This vault: synced (relay)',
    yellow: 'This vault: working — ops or disk flush in flight',
    red: 'This vault: diverged — review required',
    offline: 'This vault: offline — edits safe locally, nothing reaching the relay',
  },
}

const tree = {
  files: 'Files',
  root_label: 'Vault files',
  new_note: 'New note',
  new_note_in: 'New note in {dir:string}',
  new_folder: 'New folder',
  new_folder_in: 'New folder in {dir:string}',
  collapse_all: 'Collapse all folders',
  filter_label: 'Filter:',
  filter: {
    all: 'All',
    local: 'Local',
    shared: 'Shared',
  },
  filter_option: {
    all: 'All notes',
    local: 'Local only',
    shared: 'Shared only',
  },
  shared_by_you: 'Shared by you',
  shared_with_you: 'Shared with you',
  not_synced: 'not synced',
  root_actions: 'Vault root actions',
  actions_for: 'Actions for {path:string}',
  not_moved: 'Not moved: {reason:string}',
  menu: {
    new_file: 'New file',
    new_folder: 'New folder',
    new_collection: 'New collection',
    rename: 'Rename…',
    move: 'Move…',
    delete: 'Delete…',
    share: 'Share…',
    manage_tokens: 'Manage links…',
    unshare: 'Unshare…',
    unmount: 'Unmount…',
    add_share: 'Add a shared folder here…',
    history: 'History…',
  },
  reason: {
    // No `share_root_shared`: a shared vault no longer blocks folder shares —
    // a mount may live inside the root mount (device-link-shaping A5, depth 1).
    share_inside: "Already inside the shared folder '{path:string}' — shared folders cannot nest.",
    share_contains: "Contains the shared folder '{path:string}' — shared folders cannot nest.",
    add_share_inside: "Inside the shared folder '{path:string}' — shared folders cannot nest.",
  },
  drop: {
    nothing: 'nothing is being dragged',
    onto_itself: "'{name:string}' cannot be dropped onto itself",
    inside_itself: "'{name:string}' cannot move inside itself",
    already_there: "'{name:string}' is already there",
    exists: "'{path:string}' already exists",
  },
}

const tree_op = {
  new_folder: 'New folder',
  new_folder_in: 'New folder in {path:string}',
  rename: 'Rename {name:string}',
  move: 'Move {name:string}',
  delete_folder: 'Delete folder {name:string}?',
  delete_file: 'Delete file {name:string}?',
  new_name: 'New name',
  folder_name: 'Folder name',
  destination: 'Destination',
  delete_folder_body:
    'Everything inside is removed for you and for everyone sharing it. Pre-images are journaled and files can be restored.',
  delete_file_body: 'Removed for you and for everyone sharing it. The pre-image is journaled.',
  /** Refusals a rename shows (the dialog and the inline title share them, P3). */
  invalid_name: '“{name:string}” can’t be used as a name: leave out \\ / : * ? " < > | and don’t start with a dot',
  name_taken: '“{name:string}” already exists in this folder',
  confirm: {
    delete: 'Delete',
    move: 'Move',
    rename: 'Rename',
    create: 'Create',
  },
}

/**
 * Renames follow (collections DB6, bases-shaping A5.1): a rename or move
 * rewrites the `[[links]]` other notes hold to the moved one, each note on
 * its own live doc. The flash says how many notes changed; over a threshold
 * the confirm names the count first; a note whose link text is not where
 * the index saw it is reported, never guessed at.
 */
const link_follow = {
  updated: 'Updated links in {count:number} note{{s}}',
  /** The note's text is not what the plan was made from: nothing in it was touched. */
  changed: 'Links in {count:number} note{{s}} were not updated — the text had changed under the rename. Fix {{count:it|them}} by hand.',
  /** No live document to edit (not a note the vault holds open). */
  unreachable: 'Links in {count:number} note{{s}} could not be updated. Fix {{count:it|them}} by hand.',
  /** A second rename or move while the links confirm is up. */
  busy: 'Answer the open “Update links” question first.',
  confirm: {
    title: 'Update links in {count:number} notes?',
    rename_body: 'Renaming “{name:string}” changes what {count:number} notes link to. Each of them is edited, with its own sync state and history.',
    move_body: 'Moving “{name:string}” changes the path {count:number} notes link to. Each of them is edited, with its own sync state and history.',
    rename: 'Rename and update links',
    move: 'Move and update links',
  },
}

const palette = {
  no_matches: 'No matches',
  quick_open: { placeholder: 'Open a note…', empty: 'No note matches' },
  command: { placeholder: 'Run a command…', empty: 'No command matches' },
  search: { placeholder: 'Search the vault…   (tag:#x, path:folder/)', empty: 'Nothing found' },
  /** `template.insert` (quiet-shell F11): the first word picks, the rest are arguments. */
  templates: { placeholder: 'Insert a template…   (name, then its arguments)', empty: 'No template matches' },
  /** `layout.use-file` (round 3, Q6): the vault's `.ohhi/layouts/*.json` and the built-in. */
  layouts: {
    placeholder: 'Use a layout file…',
    empty: 'No layout file matches',
    builtin: 'Default',
    in_use: 'in use',
    /** settings-shaping ST6: beside the root pill, for a file in Settings › Customise's Problems. */
    cant_use: 'can’t be used',
    shadows: 'shadows {roots:string}',
  },
  recent: 'recent',
  filename_match: 'filename match',
  /**
   * Why a search result is where it is (plans/agent-surface-shaping.md A10).
   * Results are ordered by TIER before score, and the tier is the one thing a
   * reader cannot infer from the snippet — a note called `Docs` that never
   * says "docs" shows no snippet at all. Body-tier rows keep their existing
   * subtitle (`filename_match`, or none).
   */
  tier: { title: 'note title', path: 'path match' },
}

const commands = {
  groups: {
    navigate: 'Navigate',
    file: 'File',
    share: 'Share',
    view: 'View',
    daily: 'Daily',
    app: 'App',
    pane: 'Pane',
    tab: 'Tab',
    group: 'Group',
    developer: 'Developer',
    format: 'Format',
    /** The `table.*` rows (editor-usability E4), offered while the caret is in a table. */
    table: 'Table',
    templates: 'Templates',
    help: 'Help',
    ai: 'AI',
  },
  /**
   * The `format.*` rows (quiet-shell F4): one per entry of `FORMAT_COMMANDS`
   * in @ohhi/editor, keyed by the id after `format.` with `-` as `_`.
   */
  format: {
    bold: 'Bold',
    italic: 'Italic',
    strike: 'Strikethrough',
    highlight: 'Highlight',
    code: 'Inline code',
    heading_1: 'Heading 1',
    heading_2: 'Heading 2',
    heading_3: 'Heading 3',
    paragraph: 'Paragraph',
    list: 'Bulleted list',
    ordered_list: 'Numbered list',
    task: 'Task list',
    indent: 'Indent',
    outdent: 'Outdent',
    quote: 'Quote',
    callout: 'Callout',
    code_block: 'Code block',
    link: 'Insert link',
    wikilink: 'Insert wikilink',
    table: 'Insert table',
    image: 'Insert image',
    rule: 'Horizontal rule',
  },
  /**
   * The `table.*` rows (editor-usability E4): one per entry of `TABLE_COMMANDS`
   * in @ohhi/editor-lang, keyed by the id after `table.` with `-` as `_`.
   */
  table: {
    insert_row_below: 'Table: insert row below',
    insert_column_right: 'Table: insert column right',
    delete_row: 'Table: delete row',
    delete_column: 'Table: delete column',
    align: 'Table: align columns',
    move_row_up: 'Table: move row up',
    move_row_down: 'Table: move row down',
    move_column_left: 'Table: move column left',
    move_column_right: 'Table: move column right',
  },
  quick_open: 'Open note…',
  command_palette: 'Command palette',
  search: 'Search in vault',
  new_note: 'New note',
  new_folder: 'New folder',
  new_collection: 'New collection',
  delete_note: 'Delete current note…',
  move_note: 'Move current note…',
  share_folder: 'Share this folder…',
  add_share: 'Add a shared folder…',
  link_device: 'Link a device…',
  back: 'Back',
  forward: 'Forward',
  toggle_navigator: 'Toggle file navigator',
  toggle_rail: 'Toggle right sidebar',
  daily_today: "Today's daily note",
  daily_prev: 'Previous daily note',
  daily_next: 'Next daily note',
  settings: 'Settings',
  inspector: 'Open inspector',
  /** The Log view (quiet-shell F12): every session event, filtered. */
  log: 'Open log',
  /** The Shared view (sharing E2): the shared world as a place. */
  shared: 'Open Shared',
  /** quiet-shell F9: re-read `.ohhi/` (and the user root) and re-apply the layout. */
  reload_resources: 'Reload layouts and resources',
  /** quiet-shell F11: pick a template from `.ohhi/templates/` and insert it at the caret. */
  template_insert: 'Insert template…',
  layout_use_file: 'Use layout file…',
  /** quiet-shell F7: hide every region the layout does not keep; Escape leaves. */
  focus_mode: 'Toggle Focus mode',
}

/**
 * The History rail section (W3): the pre-image journal, in words. The journal
 * records bytes and a time and nothing else, so the copy claims nothing else
 * — no author, no reason, no "you edited this".
 */
const history = {
  no_note: 'Open a note to see its history.',
  empty: 'No earlier versions yet — Oh hi markdown saves one every time it writes this file.',
  loading: 'Reading the journal…',
  list_label: 'Earlier versions of {name:string}',
  restore: 'Restore',
  restore_this: 'Restore the version from {time:string}',
  bytes: '{count:number} byte{{s}}',
  kilobytes: '{size:string} kB',
  confirm: {
    title: 'Restore {name:string} to its {time:string} version?',
    body: 'The note goes back to that version everywhere it is open, and for anyone you share it with. What is in it now is journaled first, so you can come back here and undo this.',
    confirm: 'Restore',
  },
}

/**
 * Daily notes (W3). One string: Obsidian's `daily-notes.json` can carry moment
 * tokens Editor does not implement, and a vault on one of them would quietly
 * disagree with Obsidian about which file today is (Minor 17). Said once per
 * session, through the ordinary notice log.
 */
const daily = {
  unsupported_format:
    'Obsidian’s daily-note format “{format:string}” uses {tokens:string}, which Oh hi markdown does not understand yet and prints as written. Today’s note may not be the one Obsidian would open.',
}

/**
 * The Log view (quiet-shell F12, spike S22 Stage 4a): the session's events,
 * newest first, filtered by level, scope and time. The rows' words come from
 * the event's code (`notices`); these are the view's own.
 */
const log = {
  title: 'Log',
  /** The Log opened from the Changes card's *Show all*: change kinds only. */
  title_changes: 'Changes',
  changes_only: 'Changes only',
  /** settings-shaping ST6: only the layout, keymap and template files' events (reloads, problems). */
  customise: 'Customise',
  customise_hint: 'Only the layout, keymap and template files: reloads and files that can’t be used',
  show_everything: 'Show every kind',
  level_label: 'Level',
  levels: {
    error: 'Errors',
    warn: 'Warnings',
    info: 'Info',
  },
  scope_label: 'Scope',
  scope: {
    all: 'All',
    vault: 'This vault',
    mount: 'Shared folder: {path:string}',
    note: 'This note',
  },
  time_label: 'Time',
  time: {
    today: 'Today',
    week: 'This week',
    all: 'All time',
  },
  empty: 'Nothing to report this session.',
  empty_filtered: 'Nothing matches these filters.',
  list_label: 'Events',
  open_path: 'Open {path:string}',
  room: 'room {room:string}',
  repeated: '×{count:number}',
  repeated_label: 'repeated {count:number} times',
  copy: 'Copy as text',
  copied: 'Log copied to the clipboard.',
  copy_failed: 'The clipboard is blocked — select the text below and copy it.',
  copy_fallback_label: 'The log as text',
  clear: 'Clear',
  clear_confirm: {
    title: 'Clear the log?',
    body: 'Every event of this session is forgotten. Your notes are not touched.',
    confirm: 'Clear',
  },
  /** The plain-text bug report "Copy as text" produces. */
  report: {
    header: 'Oh hi markdown — log ({count:number} event{{s}}, copied {time:string})',
    hint: 'hint: {hint:string}',
  },
  level_name: {
    error: 'error',
    warn: 'warning',
    info: 'info',
  },
  /** What to do next, shown under an error row that has one. */
  hints: {
    relay_refused: 'Ask whoever shared the folder for a new link, then add it from the folder’s menu.',
    no_token: 'Add a link for this folder from its menu, or forget it on this device.',
  },
}

/** Relative times in the Log view and the drawer (`relative-time.ts`). */
const relative_time = {
  now: 'just now',
  seconds: '{count:number}s ago',
  minutes: '{count:number} min ago',
  hours: '{count:number} h ago',
  days: '{count:number} day{{s}} ago',
}

/**
 * The notification drawer (quiet-shell F13): a bell readout with the unread
 * errors and warnings, opening the last 20 of them.
 */
const drawer = {
  label: 'Notifications',
  label_unread: 'Notifications, {count:number} unread',
  title: 'Notifications',
  empty: 'No errors, warnings or changes from others this session.',
  /**
   * The one footer link (foundations-plan P6, Round 3 Q1): the Log, filtered to
   * what the drawer shows. No count — the bell's badge already counts.
   */
  open_log: 'Open the Log',
  /** The header line: what is in the drawer, in counts. */
  summary: {
    errors: '{count:number} error{{s}}',
    warnings: '{count:number} warning{{s}}',
    changes: '{count:number} change{{s}} by others',
  },
  problems: 'Errors and warnings',
  changes: 'Changes by others',
  /** One note's changes: "Cynthia · Raft · 3 changes · 2 min ago". */
  group: {
    count: '{count:number} change{{s}}',
    open: 'Open {note:string}',
    two: '{a:string} and {b:string}',
    many: '{a:string}, {b:string} and {count:number} other{{s}}',
  },
}

/**
 * Presence in place (sharing E1): initials on tree rows, mount roots and
 * tabs, "with …" beside the pane lead, and the people stack's popover. Names
 * are self-reported — the copy never says "verified" or "joined" (R5).
 */
const presence = {
  more: '{count:number} more',
  with_one: 'with {a:string}',
  with_two: 'with {a:string} and {b:string}',
  with_many: 'with {a:string} and {count:number} other{{s}}',
  people: {
    label: '{count:number} {{person|people}} here',
    title: 'Here now',
    vault: 'This vault',
    in_note: 'in {note:string}',
    jump: 'Go to {name:string} in {note:string}',
    /** Online in the room, in no note (the sync icon's list, P5). */
    online: 'online',
  },
  /** The sync icon (foundations-plan P5): its state in words, and who is online. */
  sync: {
    with_people: '{status:string} · {count:number} {{person|people}} online',
    title: 'Who is where',
    /** The card's name when nobody else is here: only the inspector's door is in it (devtools-shaping DT5). */
    title_alone: 'This note',
    /** The card's footer while developer tools are on: the focused note in its own inspector tab. */
    inspect: 'Inspect this note',
    inspect_path: 'Open the inspector on {path:string}',
  },
}

const links = {
  no_note: 'Open a note to see its links.',
  backlinks: 'Backlinks',
  no_backlinks: 'No note links here yet.',
  outgoing: 'Outgoing',
  no_outgoing: 'This note links nowhere yet.',
  not_created: 'Not created yet',
  create: 'Create {target:string}.md',
  missing_attachments: 'Missing attachments',
  missing_attachment_title: 'No file at this path — attachments are not created from a link',
}

/**
 * The Shared view (sharing-shaping E2/E3/E5): the relay as a thing with a
 * state, the shared folders, the people and the one note each is in, your
 * devices, and what changed. Honesty per the shaping's Ground-truth table:
 * names are self-reported, links are not people, nobody "has joined".
 */
const shared = {
  title: 'Shared',
  actions: {
    share: 'Share a folder…',
    add: 'Add a shared folder…',
    link: 'Link a device…',
  },
  /** The pill as the door (Fork 3-A): its accessible name and its counts. */
  door: {
    aria: '{status:string} — open Shared',
    rooms: '{count:number} room{{s}}',
    people: '{count:number} online',
  },
  relay: {
    unknown_host: 'this vault’s relay',
    state: {
      connected: 'Connected',
      reconnecting: 'Reconnecting…',
      offline: 'Offline',
      refused: 'Refused by the relay',
    },
    refused_reason: 'Refused by the relay: {reason:string}',
    rooms: '{count:number} room{{s}}',
    people: '{count:number} {{person|people}} online',
    only_you: 'only you',
    /** Green = the relay RECEIVED every edit (golden rule 4) — receipt, never "durable". */
    in_sync: 'in sync with the relay since {when:string}',
    last_in_sync: 'last in sync with the relay {when:string}',
    safe: 'your edits are safe on this device',
  },
  folders: {
    title: 'Shared folders',
    by_you: 'Shared by you',
    with_you: 'Shared with you',
    notes: '{count:number} note{{s}}',
    links: '{count:number} link{{s}}',
    changed: 'changed {when:string}',
    online: '{count:number} online here',
    manage: 'Manage links…',
    details: 'Details…',
    open: 'Open',
    open_folder: 'Open {path:string} in the navigator',
  },
  people: {
    title: 'People',
    online: '{count:number} online',
    only_you: 'only you',
    in_note: 'in {note:string}',
    in_folder: 'in {folder:string}',
    jump: 'Go to {note:string}, where {name:string} is',
    alone: 'Nobody else is online.',
    last_here: '{name:string} was last here {when:string}.',
    honesty: 'Names are self-reported. There are no accounts yet.',
  },
  devices: {
    title: 'Your devices',
    this_device: 'This device',
    this_device_tag: 'this device',
    unnamed: 'unnamed device',
    linked: 'This whole vault syncs to your devices.',
    online_at: 'online {when:string}',
    needs_secret: 'Add the team’s secret in Settings › Sync & devices to list your linked devices.',
  },
  changes: {
    title: 'Changes',
    today: '{count:number} today',
    none: 'No changes by anyone else yet.',
    none_filtered: 'Nothing matches these filters.',
    filters: 'Filter changes',
    room_label: 'Folder',
    room_all: 'All folders',
    person_label: 'Person',
    person_all: 'Everyone',
    time_label: 'When',
    time: {
      all: 'Any time',
      today: 'Today',
      week: 'This week',
    },
    show_all: 'Show all',
    day_today: 'Today',
    day_yesterday: 'Yesterday',
    created: 'created',
    deleted: 'deleted',
    moved: 'moved from {from:string}',
  },
  /** Who did it, when the log can only say so much (sharing Fork 2-A). */
  who: {
    relay: 'someone via {host:string}',
    relay_bare: 'someone via the relay',
    disk: 'another app on this device',
    you: 'you',
  },
  empty: {
    title: 'Nothing is shared yet',
    body: 'Your notes are plain files on this device. Sharing a folder syncs it through a relay you choose; the rest of the vault stays here.',
    share_title: 'Share a folder with your team',
    share_body: 'Pick a folder. Everything inside it syncs live to anyone holding its link.',
    add_title: 'Add a folder someone shared with you',
    add_body: 'Paste the link they sent. It lands inside this vault, beside your notes.',
    link_title: 'Use this vault on another device',
    link_body: 'Syncs the whole vault to a laptop or a second desk. Only yours: never share this link.',
    /** Above the relay card (first-run D1/D3): where shares go, read from the RELAY, not the secret. */
    relay_label: 'Shares go through',
    /** Under the card when a relay is known and no operator secret is saved yet (first-run D3). */
    secret_once: 'To create links you will need the team’s secret once.',
  },
  /** The tree's change tick (sharing E3). */
  tick: 'Changed by someone else in the last hour',
  /** *Share a folder…* with no folder in hand: pick one first. */
  pick: {
    title: 'Share a folder',
    label: 'Folder',
    help: 'Everything inside it will sync to anyone holding its link.',
    none: 'No folder can be shared yet: make a folder first, outside any shared folder.',
    next: 'Continue',
  },
}

/**
 * The relay as one thing with a state (first-run-shaping D1, R3, R10): the
 * card the share sheet's first run, Settings › Sync and the Shared view draw.
 * A relay this vault is CONNECTED to reads `shared.relay.*` (the snapshot's
 * words: "in sync with the relay", never "durable"); one it is not connected
 * to yet is PROBED — "reachable" means a health check answered, never that a
 * token or secret is good (R5). The secret field (D2) lives here too: it is
 * the same relay's other question.
 */
const relay_card = {
  label: 'Relay',
  none_host: 'No relay yet',
  none_body:
    'Shares need one relay per group. Run your own, or ask the person who shared with you which one they use.',
  guide: 'How to run a relay',
  checking: 'checking…',
  reachable: 'reachable · checked {when:string}',
  unreachable: 'can’t reach it from here',
  unhealthy: 'it answers, but says it is not healthy',
  team: 'The team’s relay',
  pinned: 'This build syncs through {host:string} only.',
  test: 'Test',
  change: 'Change…',
  use_another: 'Use another…',
  secret: {
    title: 'Team secret',
    description: 'Lets this device create links. Asked once; kept on this device.',
    checking: 'checking…',
    /** "works" = a listing call answered 200, just now — nothing more. */
    ok: 'works',
    bad_secret: 'doesn’t match this relay',
    no_admin: 'this relay has no admin API',
    unreachable: 'can’t reach the relay',
    where: 'Where do I get this?',
    /** `hint` is the build's `VITE_TEAM_SECRET_HINT`, e.g. "the team password manager, under ohhi relay". */
    where_team:
      'The team’s secret is one for the whole team (the relay’s docs call it the operator secret): {hint:string}. Whoever holds it can create and remove any link on this relay, so keep it there. It is remembered on this device after this.',
    where_generic:
      'The team’s secret is one for the whole team (the relay’s docs call it the operator secret). Whoever runs the relay for your group has it. Whoever holds it can create and remove any link on this relay, so keep it somewhere safe. It is remembered on this device after this.',
  },
}

const note = {
  /**
   * The breadcrumb folder popover's share line (sharing E6). Where THIS folder
   * lives: on your own devices (a linked vault — never "shared"), or shared by
   * you / with you, then the relay's host.
   */
  on_your_devices: 'On your devices',
  shared_by_you: 'Shared by you',
  shared_with_you: 'Shared with you',
  with_host: '{state:string} · {host:string}',
  /** The editable heading at the top of a note's body (P3); editing it renames the file. */
  inline_title: 'Note title',
}

const manager = {
  back: '← Back to notes',
  settings: 'Settings',
  help: 'Help and guides',
  version: 'Version {version:string}',
  tagline: 'Collaborative markdown over a plain-text vault. Files on disk stay the source of truth.',
  your_name: 'Your name',
  name_placeholder: 'Anonymous',
  name_hint: 'Shown to people you share with.',
  /** The list's foot when no name is saved: who people see you as. */
  anonymous: 'Anonymous',
  your_vaults: 'Your vaults',
  no_vaults: 'No vaults yet. Add a folder, link a device, or add a shared folder to get started.',
  // ---- the welcome: the manager with no vault registered (first-run A1) ----
  welcome: {
    title: 'Oh hi.',
    lede: 'Your notes stay plain markdown files, and the app never holds the only copy. Pick how you want to start.',
    doors: 'Ways to start',
    folder: 'Open a folder of notes',
    folder_hint:
      'Your own notes, on this computer. An Obsidian vault opens as it is; nothing inside it is changed.',
    browser: 'Start a vault in this browser',
    browser_hint:
      "Kept in this browser's private storage, which it may clear. Good for trying things out and for team folders; keep your own notes in the desktop app.",
    shared: 'Add a folder someone shared with you',
    shared_hint: 'Paste the link they sent. The folder stays in step with theirs, live, and the rest of your notes stay yours.',
    device: 'Bring your vault from another device',
    device_hint:
      'Paste the device link you made on your other computer. The whole vault arrives here and the two stay in step.',
    import_lead: 'Coming from another app?',
    import_link: 'How to bring notes in',
    guide: 'Two-minute guide',
    /** settings-shaping ST6: the welcome's door to Settings › Agents (desktop). */
    agents: 'Connect an agent',
  },
  // ---- the list: the manager with vaults in it (first-run B1) ----
  list: {
    title: 'Vaults',
    add: 'Add',
    add_folder: 'Open a folder of notes…',
    add_browser: 'New vault in this browser…',
    add_shared: 'Add a folder someone shared…',
    add_device: 'Bring a vault from another device…',
    add_import: 'Import from another app…',
    new_browser_title: 'New vault in this browser',
    open_now: 'open now',
    opened_today: 'opened today',
    opened_yesterday: 'opened yesterday',
    opened_on: 'opened {date:string}',
    in_browser: 'in this browser',
    site_usage: 'this site uses {used:string}',
    storage_kept: 'the browser has promised to keep it',
    storage_may_clear: 'the browser may clear it',
    /** Counts are what the vault's mount table says — never people, never "online". */
    shared_by_you: '{count:number} folder{{s}} shared by you',
    shared_with_you: '{count:number} shared with you',
    nothing_shared: 'nothing shared',
    /** The "—" chip's name: the mount table could not be read. */
    facts_unknown: 'Sharing facts unknown for this vault',
    open: 'Open',
    rename: 'Rename…',
    rename_title: 'Rename {name:string}',
    rename_label: 'Name in this list',
    rename_hint: 'Changes the name shown here only. The folder on disk keeps its name.',
    rename_save: 'Rename',
    try_again: 'Try again',
    identity: 'People you share with see you as {name:string}',
    identity_change: 'Change',
    remembered: 'Links you were sent: {count:number} remembered',
    remembered_title: 'Links you were sent',
    remembered_hint: 'Open one again as a vault of its own.',
    forget_share: 'Forget {label:string} on this device',
  },
  /**
   * A vault entry with a relay: since N2 that means LINKED to your own
   * devices (the legacy whole-vault join reads the same way, and it is).
   */
  linked_badge: 'linked',
  browser_vault: 'browser vault',
  memory_vault: 'memory',
  remove: 'Remove {name:string} from this list',
  row_menu: 'More actions for {name:string}',
  remove_item: 'Remove from this list…',
  remove_confirm: 'Remove?',
  remove_note_opfs:
    "This browser vault's notes live only in this browser — removing it deletes the notes AND all sync state, shares, and links.",
  remove_note_disk:
    'Files on disk are never touched. Sync state, shares, and links for this vault are deleted — reopening the folder starts fresh with new share links.',
  vault_error: '{message:string} — fix the folder, or remove this entry (files are untouched).',
  /**
   * Desktop: the app may open only folders picked in this dialog (DEL-89).
   * A vault picked before that rule, or whose grant was lost, is refused once.
   */
  access_lost: 'Oh hi markdown needs your permission to open this folder again. Your files are untouched.',
  allow_access: 'Allow access to this folder again',
  access_wrong_folder:
    "You picked {picked:string}, which isn't this vault's folder ({path:string}). Nothing changed — pick the vault's own folder to allow access.",
  /** The native folder dialog's title. */
  pick_title: 'Choose a vault folder',
  add_vault: 'Add a vault',
  pick_folder: "Pick a folder on disk (use the dialog's New Folder to create a fresh vault).",
  open_folder: 'Open folder as vault…',
  no_opfs:
    "This browser doesn't support the private file storage (OPFS) Oh hi markdown needs — try a recent Chrome, Edge, or Firefox.",
  browser_vault_hint: 'A new vault stored privately in this browser.',
  vault_name_placeholder: 'Vault name',
  create_vault: 'Create vault',
  join_share: 'Add a shared folder',
  join_hint: 'Someone sent you a link? Add their folder inside a vault, or open it as a vault of its own.',
  join: 'Add a shared folder…',
  recent_shares: 'Recent shares',
  link_device: 'Link a device',
  link_device_hint:
    'Already have this vault on another device? Paste its device link and the whole vault arrives here.',
  link_device_open: 'Link this device…',
  /** A folder share opened as its own vault in the browser, when the link names no folder. */
  joined_vault_name: 'Shared folder on {host:string}',
  errors: {
    // A link that will not decode is named by `share.link_error.*` now — one
    // reason per way a link can be unusable, not one word for all of them.
    forget_partial:
      'Vault forgotten, but some of its sync state could not be deleted ({message:string}). The leftovers are inert — reopening the folder still starts fresh.',
  },
}

/**
 * The Import door (first-run F1): how notes from another app come in. Each
 * route's sentence must stay true — the Notion row gains a verb when the
 * importer (bases A10) ships, and nothing else changes shape.
 */
const import_app = {
  title: 'Bring notes from another app',
  obsidian: 'Obsidian',
  obsidian_body:
    'Open your vault folder. It opens as it is: your .obsidian settings, daily notes and themes are left alone and nothing is rewritten.',
  open_folder: 'Open a folder…',
  obsidian_browser:
    "A browser can't open a folder on your computer. To work on an Obsidian vault, use the desktop app.",
  notion: 'Notion',
  notion_body:
    'Export your workspace as Markdown & CSV, unzip it into a folder, open that folder. Databases arrive as folders of notes; a proper importer with typed properties is on the way.',
  other: 'Apple Notes, Bear, Logseq, anything else',
  other_body:
    'Export to Markdown, put the files in a folder, open the folder. Images come along as files; they are not synced to shared folders yet.',
  guide: 'Read the import guide',
  foot: 'Everything you open stays where it is on disk. Oh hi markdown adds a .ohhi/ folder beside your notes for its own settings and nothing else.',
}

const vault_switcher = {
  manage: 'Manage vaults…',
}

/**
 * Browser storage the browser may clear unless it promised to keep it. Chrome
 * and Edge refuse silently and often — never the user's fault — so the copy
 * stays calm.
 */
const storage = {
  title: "This browser may clear this site's storage",
  body: "Browsers can delete a site's storage to free up space, and this browser hasn't promised not to. Notes that aren't in a shared folder exist only here.",
  advice: 'For your own notes, use the desktop app. The browser is best for joining team folders.',
  ask: 'Ask the browser to keep it',
  refused:
    "The browser said no. That's its own call, often based on how much you use the site — bookmarking or installing it can help. You can ask again any time.",
  granted: "Done — this browser has promised to keep this site's storage.",
  dismiss: 'Dismiss',
  /** The one reminder a workspace shows, when the app reopens straight into a browser vault. */
  notice:
    "This browser may clear this site's storage, and notes outside a shared folder exist only here — for your own notes, use the desktop app. Settings › Sync & devices can ask the browser again or turn this reminder off.",
  settings: {
    heading: 'Storage in this browser',
    checking: 'Checking…',
    kept: "Kept — this browser has promised not to clear this site's storage.",
    best_effort: "Not guaranteed — this browser may clear this site's storage to free up space.",
    unsupported: "Not guaranteed — this browser can't be asked to keep this site's storage.",
    usage: 'Using {used:string} of the {quota:string} this browser allows.',
    remind: 'Remind me about this',
  },
}

const settings = {
  title: 'Settings',
  sections: 'Settings sections',
  /**
   * The nav (settings-shaping Fork 7, QA round 1): Customise › Editor ·
   * Layout · Appearance · Keys | Sync & devices · AI | Developer · About.
   */
  nav: {
    customise: 'Customise',
    editor: 'Editor',
    layout: 'Layout',
    appearance: 'Appearance',
    keys: 'Keys',
    sync: 'Sync & devices',
    ai: 'AI',
    developer: 'Developer',
    about: 'About',
  },
  /** The manager's page host (no vault open): its way back. */
  page: {
    back: '← Vaults',
  },
  /** A section whose settings are files inside a vault, drawn with none open (R2). */
  needs_vault: {
    body: 'Open a vault to change this.',
    keys: 'Keymaps are files inside a vault, in .ohhi/keymaps/.',
    customise: 'Layouts, keymaps, templates and themes are files inside a vault, in .ohhi/.',
    open: 'Open a vault',
  },
  /** A text field that commits on Enter or when you leave it (R3). */
  saved: 'Saved',
  /** Settings › Editor: how notes open and read — the default view plus the layout's editor fields. */
  editor: {
    intro: 'How notes open and read. Changes apply at once and stay on this device.',
    default_mode: 'Default view for new tabs',
    default_mode_hint:
      'Applies to any tab you have not given a view of its own. {key:string} switches one tab between editing and reading.',
  },
  appearance: {
    lede: 'How the app looks on this device. A theme of your own lives in this vault.',
    system: 'System',
    theme_help:
      'Applies immediately, to the chrome and the editor alike. {system:string} follows your OS setting and uses Oh hi Light or Oh hi Dark, our defaults. Graphite, Fjord and Iris are our own too.',
    /**
     * The built-in themes' names, keyed by `THEME_LABEL_KEYS` in
     * `libs/ui/src/tokens.ts` (the theme id with `_` for `-`).
     */
    theme_names: {
      editor_light: 'Oh hi Light',
      editor_dark: 'Oh hi Dark',
      graphite_light: 'Graphite Light',
      graphite_dark: 'Graphite Dark',
      fjord_light: 'Fjord Light',
      fjord_dark: 'Fjord Dark',
      iris_light: 'Iris Light',
      iris_dark: 'Iris Dark',
    },
    /** The picker's two groups: the themes that ship with the app, and the vault's own theme folders. */
    builtin: 'Built in',
    in_vault: 'In this vault',
    /** The vault group with no vault open (the manager's page). */
    vault_none: 'Open a vault to use the themes in it.',
    /** The vault group when the open vault has no theme folder. */
    vault_empty: 'This vault has no themes yet. A theme is a folder holding one stylesheet, {path:string}.',
    /** The example themes the app ships (Nord, built in until Fork 4-A), under the vault group. */
    examples_intro: 'Examples that ship with the app. Add one and it is listed above.',
    add_example: 'Add to this vault',
    add_example_label: 'Add {label:string} to this vault, as {path:string}',
    example_added: 'Added {path:string}',
    /** The fallback field under the vault group; the path and the rules are its hint line (QA round 1). */
    custom_label: 'A theme folder the list does not show',
    custom_placeholder: 'my-theme',
    use_custom: 'Use',
    custom_help:
      'Reads {path:string} from the open vault. Start from {template:string}; {import_rule:string} and remote {url:string} are stripped, and the sync-status colours cannot be overridden.',
    needs_vault: 'Open a vault first — custom themes live inside it.',
  },
  /**
   * Settings › Layout and › Editor (round 3, Q6): forms over this device's
   * layout overrides, applied live — no names, no files, no Save.
   * Each field is `<field>` and its values `<field>_<value>`.
   */
  layout: {
    intro: 'What the shell shows around the note. Changes apply at once and stay on this device.',
    /** With no vault open (the manager's page). */
    no_vault: 'The layout file comes from the vault you open; until then this shows the built-in default.',
    files: 'Files',
    files_drawer: 'As a drawer',
    files_column: 'As a column',
    files_off: 'Hidden',
    sidebar: 'Sidebar',
    sidebar_dock: 'Floating',
    sidebar_column: 'As a column',
    sidebar_position: 'Sidebar position',
    sidebar_position_top_right: 'Top right',
    sidebar_position_bottom_right: 'Bottom right',
    tabs: 'Tabs',
    tabs_auto: 'When there are two',
    tabs_always: 'Always',
    toolbar: 'Toolbar',
    toolbar_top: 'Top',
    toolbar_bottom: 'Bottom',
    format: 'Formatting bar',
    format_bottom: 'Bottom',
    format_top: 'Top',
    format_off: 'Hidden',
    status: 'Word count',
    status_corner: 'Bottom right',
    status_off: 'Hidden',
    open: 'Opening a note',
    open_replace: 'Replaces the current tab',
    open_tab: 'Opens a new tab',
    measure: 'Line width',
    measure_narrow: 'Narrow',
    measure_comfortable: 'Comfortable',
    measure_wide: 'Wide',
    typewriter: 'Typewriter scrolling',
    inline_title: 'Title in the note',
    /** A side this device pins as a column (Round 2, P7): the pin wins over the field. */
    pinned: '{value:string} (pinned)',
    unpin: 'Unpin',
    unpin_label: 'Unpin {what:string}',
    reset: 'Reset to default',
    reset_editor: 'Reset editor options',
    /** E6: how the pane mode (Mod+P) shows its keys — device config. */
    hints: 'Pane keys',
    hints_subtle: 'Subtle — in the corner',
    hints_full: 'Full — a bar along the bottom',
    hints_off: 'Off — the mode’s name only',
    /** E6: the formatting bar's buttons, a plain list kept on this device. */
    bar: {
      title: 'Formatting bar buttons',
      intro:
        'Drag to reorder, or drag a button to the other row to show or hide it. Each button’s menu does the same from the keyboard. Your changes stay on this device.',
      shown: 'On the bar',
      hidden: 'Not on the bar',
      empty_shown: 'Nothing on the bar: it is hidden.',
      empty_hidden: 'Every button is on the bar.',
      separator: 'Separator',
      /** A pill's menu trigger: what it is and where. */
      pill_shown: '{name:string}, {n:number} of {total:number} on the bar',
      pill_hidden: '{name:string}, not on the bar',
      move_left: 'Move left',
      move_right: 'Move right',
      hide: 'Hide',
      remove: 'Remove',
      show: 'Add to the bar',
      reset: 'Reset to layout file',
      /** Announced after a change made from a pill's menu. */
      moved: '{name:string} is now {n:number} of {total:number}',
      shown_now: '{name:string} is on the bar',
      hidden_now: '{name:string} is off the bar',
    },
  },
  /** Settings › Keys (settings-shaping ST3, K1): the chips are the control, changes write through. */
  keys: {
    intro: 'Every command and the keys that run it. Click a key to record a new one; each change is saved as you make it.',
    /** The source line: the keymap in use, where it lives, what it extends. */
    keymap: 'Keymap',
    pick: 'Use keymap',
    /** A picker option: the keymap and where it is read from (`customise.from`). */
    pick_option: '{name:string} · {source:string}',
    /** The picker's entry while the legacy per-device keys are in force. */
    on_device: 'Keys on this device',
    extends: 'Extends {name:string}.',
    read_only_hint: 'Read-only here: your first change creates a keymap file in this vault that extends it.',
    shadows_builtin: 'Named like a built-in, so it is read here but never written.',
    legacy:
      'Your keys are still kept on this device: moving them into a keymap file in this vault failed. The Log has the reason.',
    show_log: 'Open the Log',
    cannot_write: 'Nothing can be changed over a keymap that could not be used. Fix its file, or pick another keymap.',
    /** The toolbar. */
    search: 'Search commands',
    search_placeholder: 'Search {count:number} commands by name or key',
    /** Live, under the filters, while a search, pressed keys or a chip narrows the list. */
    result_count: '{count:number} command{{s}}',
    press_keys: 'Press keys',
    press_keys_label: 'Find a command by pressing its keys',
    press_keys_placeholder: 'Press the keys to see what they run…',
    clear: 'Clear',
    filters: 'Show',
    filter: {
      all: 'All',
      changed: 'Changed',
      clashes: 'Clashes',
      unbound: 'No key',
    },
    group_changed: '{count:number} changed',
    /** A group toggle's accessible name. */
    group_label: '{group:string}, {count:number} command{{s}}',
    group_label_changed: '{group:string}, {count:number} command{{s}}, {changed:number} changed',
    ungrouped: 'Other',
    none: 'No commands are registered yet.',
    no_match: 'No command matches.',
    /** A row. */
    unbound: 'No key',
    change_chip: 'Change {binding:string} for {command:string}',
    remove_chip: 'Remove {binding:string} from {command:string}',
    add_for: 'Add a key for {command:string}',
    recording: 'Press the keys… Esc cancels',
    recording_for: 'Recording a key for {command:string}: press the keys, Escape cancels',
    default_is: 'Default: {binding:string}',
    default_none: 'Default: no key',
    reset: 'Reset',
    reset_for: 'Reset {command:string} to its default keys',
    conflict: 'Also runs {commands:string}, so only one of them works. Change one of the two keys.',
    reserved: 'Your desktop takes this key before Oh hi markdown can see it.',
    /** After a change. */
    created: '{command:string}: {keys:string}. Your keys are now saved in {path:string}.',
    saved: '{command:string}: {keys:string}. Saved to {path:string}.',
    undo: 'Undo',
    undone: 'Undone. {command:string}: {keys:string}, in {path:string}.',
    error: 'Could not save the change: {error:string}',
    undo_error: 'Could not undo: {error:string}',
    /** Undo refused: the file was written by someone else since the change it would undo. */
    undo_stale:
      '{path:string} has changed since, so Undo would write over that change. Nothing was undone.',
    /** Recording refused a key that types on its own; still recording. */
    needs_modifier: 'Add Ctrl, Alt or Cmd — on its own, that key would stop you typing it.',
  },
  sync: {
    /** The section's lede (QA round 1: one lede per section, under its title). */
    lede: 'Your name as collaborators see it, the relay your shares go through, and your devices.',
    /** The display name (Settings › You until QA round 1): Sync & devices' first row, where it is used. */
    name: 'Your name, as collaborators see it',
    name_placeholder: 'Anonymous',
    name_hint: 'Shown to people you share with; applies the next time a vault is opened. Saved when you press Enter or leave the field.',
    name_required: 'Enter a name — it’s what your collaborators see.',
    relay: 'Default relay',
    relay_hint: 'Used when creating new shares. Each share remembers its own relay in its link.',
    relay_required: 'The relay new shares are created on.',
    relay_invalid: 'A relay URL starts with ws:// or wss://.',
    secret_placeholder: 'unset',
    /** Pinned build (first-run R10): the field is read-only and says why. */
    relay_pinned_hint: 'Set by this build: its security policy allows no other relay.',
    /** Pinned build, with a relay saved before the pin: said once under the read-only field. */
    relay_pinned_saved_ignored:
      'A relay saved earlier ({saved:string}) is ignored: this build syncs through {host:string} only.',
    devices: 'Your devices',
    running_title: 'Running your own relay',
    running_body:
      'One relay per group: every link names the relay it was made on. The relay is one Docker container; the guide has the two commands and the secret to set. Tell the app about it with Change… above.',
    running_pinned:
      'This build syncs through {host:string} only: its security policy allows no other relay. A group that runs its own relay uses a build without that pin.',
    running_guide: 'The relay guide',
    /** Fields that save as you leave them (R3). */
    relay_commit_hint: 'Saved when you press Enter or leave the field.',
    vaults: 'Vaults and shares',
    vaults_body: 'The vaults and shared folders this device remembers are listed in the vault manager.',
    vaults_open: 'Manage vaults…',
  },
  /** Settings › Customise (settings-shaping ST4 fills it). */
  customise: {
    intro:
      'Layouts, keymaps, templates and themes are files: you, an agent or a teammate can change them, and the app picks the change up (in a browser, press Reload files).',
    roots: 'Where files are read from',
    roots_rule: 'Each name is read from the first of these that has it: this vault wins over your config folder, which wins over built in.',
    root: {
      vault: 'This vault',
      user: 'Your config folder',
      builtin: 'Built in',
    },
    detail: {
      disk: 'A folder on this computer',
      browser: '{name:string} · .ohhi, in this browser',
      no_vault: 'No vault open: this comes with one',
      read_only: 'Read-only here: the app reads it, you or an agent write it',
      unreadable: 'Could not be read on this computer',
      desktop_only: 'Desktop app only',
      ships: 'Ships with the app',
    },
    copy_path: 'Copy path',
    copy_path_label: 'Copy the path of {what:string}',
    /** The desktop app has no opener: *Show file* copies the path. */
    no_reveal: 'The app cannot open a folder for you yet: copy the path and open it in your file manager.',
    kinds: 'What is in use',
    col_kind: 'Kind',
    col_in_use: 'In use',
    col_also: 'Also here',
    kind: {
      layouts: 'Layout',
      keymaps: 'Keymap',
      templates: 'Templates',
      themes: 'Theme',
    },
    /** The source pill: which root a name came from. */
    from: {
      vault: 'this vault',
      user: 'config folder',
      builtin: 'built in',
    },
    shadows: 'shadows {roots:string}',
    device_changes: 'plus this device’s changes',
    /** The hub's layout row when this device changes nothing on top of the file. */
    no_device_changes: 'no changes on this device',
    /** The hub's theme row for the System choice. */
    follows_system: 'follows the system',
    /** A door from the hub to the part of Settings that chooses a kind. */
    door_label: 'Open Settings › {section:string}',
    /** The files table (QA round 1): its title, the actions column's name, the prose at its foot. */
    files: 'Files',
    col_actions: 'Actions',
    files_foot:
      'Templates are inserted with Insert template… in the palette. A theme is a folder in this vault, .ohhi/themes/<name>/theme.css; every one is listed here and in Appearance.',
    fell_back: '{name:string} can’t be used, so the built-in default stands in',
    cant_use: 'can’t be used',
    nothing_else: 'nothing else',
    templates_count: '{count:number} template{{s}}',
    templates_how: 'Insert one with Insert template… in the palette.',
    themes_how:
      'A theme is a folder in this vault, .ohhi/themes/<name>/theme.css; pick one in Appearance.',
    copy_json: 'Copy as JSON',
    copy_json_label: 'Copy the {kind:string} in use as JSON',
    copied: 'Copied',
    copy_failed: 'Could not copy',
    problems: 'Problems',
    problems_none: 'Every file can be used.',
    problems_count: '{count:number} file{{s}} can’t be used. Each stays listed until it is fixed.',
    problem_in_use: 'In use, so the built-in default stands in.',
    problem_unused: 'Nothing uses it, so nothing fell back.',
    copy_error: 'Copy error',
    reload: 'Reload files',
    reload_hint:
      'The desktop app reloads a file when it changes on disk. Reload reads every root again, here and in the shell.',
    agent: 'Ask an agent to make one',
    agent_prompt:
      'In the Oh hi vault at "{vault:string}", write .ohhi/layouts/<name>.json extending "default". The format, every readout, bar and command id, and two worked examples are in docs/customising.md in the Oh hi markdown repository, and the schema is its spec/ohhi.layout.v1.schema.json (with the ohhi-vault skill installed, it can find both there). The app picks the file up when it lands, or on Reload files in Settings › Customise.',
    agent_browser:
      'Agents reach folders on disk. This vault lives in this browser, so its .ohhi is reachable only from here.',
    copy_prompt: 'Copy prompt',
    /** settings-shaping ST6: the guide page (`docs/guide/customise.md`). */
    read_guide: 'Read the guide',
    read_guide_label: 'Read the guide: Customising the app',
    /** The layout in use was reloaded and its Undo taken (session only). */
    held: 'Showing the version before its last change, for this session only. Reload files applies the file.',
    show_in_log: 'Show in Log',
    /** The one-line source on a file-backed section (Fork 4): which file, from where. */
    source: {
      layout: 'Layout file',
      theme: 'Theme in use',
      layout_overrides:
        'The settings below are this device’s changes on top of it. Choose another file with Use layout file… in the palette.',
      overview: 'Customise',
      overview_label: 'Open Settings › Customise',
    },
  },
  /**
   * Settings › AI › Outside agents (settings-shaping ST5; Settings › Agents
   * until QA round 1 folded it into AI): the group's strings.
   */
  agents: {
    title: 'Outside agents',
    intro: 'Claude Code, another MCP client or a terminal works on this vault with the ohhi command. Pick a route, then copy its lines.',
    /** The eyebrow row's popover: what the ops let an agent do. */
    can_do: 'What an agent can do',
    /** One line per group of `ohhi` ops (`agent-setup.ts` AGENT_CAPABILITIES); the op names are drawn beside it. */
    cap: {
      find: 'Find notes: ranked search that returns references, never whole notes',
      read: 'Read a note’s outline and its properties, then just one section or a few lines',
      collections: 'List the vault’s collections and query a collection’s rows, the way its saved views see them',
      links: 'Follow links and backlinks, and list links whose note does not exist yet',
      changes: 'See what changed since a time',
      write: 'Write, patch and append, each write journaled first and made atomically',
      move: 'Move and rename, send to the trash instead of deleting, and restore an earlier version',
      skills: 'List the vault’s skills in .agents/skills/ and read one',
    },
    mcp_tools: 'Through MCP each one is a tool of the same name, prefixed ohhi_ (ohhi_search).',
    routes: 'How to connect',
    route_claude: 'Claude Code',
    route_mcp: 'Other MCP client',
    route_terminal: 'Terminal',
    placeholder:
      'No vault is open, so the lines below show a placeholder path. Put your vault’s folder in its place.',
    placeholder_browser: 'Vaults kept in this browser can’t be reached by an agent: it needs a vault in a folder on disk, in the desktop app.',
    /** Step 1 on every route: the checkout and its dependencies (`agent-setup.ts` GET_REPO). */
    step_repo: 'Get the repository and install its dependencies',
    repo_note:
      'Needs access to the private codemyriad/ohhi-markdown repository and Node 22. Run the next steps from the ohhi-markdown folder.',
    step_install: 'Install the command',
    step_install_both: 'Install the command and the skill',
    install_note: 'Each script makes a link (ohhi in ~/.local/bin, the skill in ~/.claude/skills), so neither goes stale.',
    claude_start: 'Start Claude Code with this vault named',
    /** The copy button's name for the MCP line (`copy_what`). */
    claude_mcp: 'Give Claude Code the commands as MCP tools',
    /** Claude Code's alternative to step 3, drawn unnumbered under the steps. */
    claude_mcp_instead: 'Instead: give Claude Code the commands as MCP tools',
    claude_note: 'The skill is the recommended route: no tools stay loaded, and it carries the habits that keep an agent’s reads small.',
    mcp_config: 'Add this server to the client’s MCP settings',
    mcp_note: 'If the client can’t find ohhi, put its full path in "command" (the install script links it in ~/.local/bin).',
    terminal_try: 'Check it sees this vault, search it, and list every command',
    browser_title: 'Agents work on folders on disk',
    browser_body: 'This vault is stored in the app’s own browser storage, where no agent can reach it. To work on it with an agent, give it a folder on disk:',
    browser_desktop: 'In the desktop app, open or create a vault in a folder.',
    browser_link: 'Or link the desktop app to this vault from Sync & devices. It keeps a copy of the vault as files in a folder you choose.',
    open_sync: 'Open Sync & devices',
    /** settings-shaping ST6: the guide page (`docs/guide/agents.md`). */
    read_guide: 'Read the guide',
    read_guide_label: 'Read the guide: Working with an agent',
    copy: 'Copy',
    /** The copy button's accessible name: what it copies. */
    copy_what: 'Copy: {what:string}',
    copied: 'Copied',
    copy_failed: 'Couldn’t copy. Select the text and copy it.',
  },
  /** Settings › About: the running build, the updater's last outcome, the guides. */
  about: {
    lede: 'The version you are running, how it updates, and the guides.',
    updates: 'Updates',
    web_updates: 'This web app updates when the page is reloaded.',
    guides: 'Guides',
    guide_import: 'Bringing notes in from another app',
    guide_relay: 'Running your own relay',
  },
  developer: {
    lede: 'Tools for looking under the hood. Off unless you turn them on.',
    devtools: 'Developer tools',
    devtools_help:
      "Enables the inspector — a tab showing the disk ↔ CRDT state of every mount and file — in the command palette. {flag:string} forces it on and opens it for one session.",
  },
}

/**
 * A share link that could not be used, said in words.
 *
 * The codec (`share-link.ts`) throws a `ShareLinkError` carrying a CODE, not
 * a sentence: the same failure is rendered in a dialog's error line, in a
 * field refusal and in the Activity log, and the copy for it belongs here
 * rather than in three places in the source.
 */
const link_error = {
  malformed: 'That link is damaged — copy it again from the device that made it.',
  missing_fields:
    'That link is incomplete: it does not say which relay, folder or key it is for. Copy it again from the device that made it.',
  unknown_kind: 'That link was made by a newer version of Oh hi markdown — update this device first.',
  bad_grant:
    'That link is damaged: one of the shared folders it carries is missing its relay, folder or key. Make a new link on the device that produced it.',
  grants_on_folder_link:
    'That link claims keys for other folders, which only a device link may carry. Do not use it — ask for a new one.',
  incomplete_target: 'This folder has no relay, room or key yet, so no link can be made for it.',
}

const share = {
  link_error,
  /**
   * One *Add a shared folder* dialog (sharing E4): the paste, then a CHOICE of
   * where it goes — the outcome used to be decided by which screen you were
   * on (the tree joined into the vault, the manager opened a new vault).
   */
  add: {
    title: 'Add a shared folder',
    description: 'Paste the link someone sent you, then choose where the folder goes.',
    link: 'Link',
    link_placeholder: 'editor1:… or https://…/join#editor1:…',
    link_invalid: 'That doesn’t look like a share link — they start with editor1: or are a …/join link.',
    from_host: 'A shared folder on {host:string}. Its name and contents arrive once you add it.',
    /**
     * Under a valid paste (first-run C3): what the link says about itself.
     * `from` is self-reported — "the name they typed", never a verified
     * account (R5). The probe's answer follows after " · ".
     */
    from_label_sender: '{label:string}, shared by “{from:string}” (the name they typed) · syncs through {host:string}',
    from_label: '{label:string} · syncs through {host:string}',
    from_sender: 'A shared folder, shared by “{from:string}” (the name they typed) · syncs through {host:string}',
    from_device: 'A device link: a full-access key to a whole vault, for your own devices only · syncs through {host:string}',
    /** The relay probe's answer: "reachable" means the health check answered — never that the link is valid. */
    probe_checking: 'checking the relay…',
    probe_ok: 'relay reachable',
    probe_down: 'can’t reach the relay from here',
    /** The team's relay, with the build's network sentence (`VITE_TEAM_NETWORK_NOTE`). */
    probe_down_note: 'can’t reach the relay from here. {note:string}',
    /** The relay answered its health check, but not `ok`: reached, so no network advice. */
    probe_unhealthy: 'the relay answered but is not healthy. Tell whoever runs it.',
    /** Fork 5-A: asked at the first join, prefilled from the saved name. */
    name: 'Your name, shown to the people in this folder',
    name_placeholder: 'e.g. Sam',
    where: 'Where it goes',
    into_vault: 'Inside {vault:string}',
    into_a_vault: 'Inside a vault',
    into_vault_hint: 'Beside your notes, and searchable with them.',
    into_vault_unavailable: 'Open a vault first to add a folder inside it.',
    own_vault: 'As its own vault',
    own_vault_hint: 'Kept apart; switch to it from the vault menu.',
    /** Under "As its own vault", per platform (first-run F1): what happens next. */
    own_vault_desktop: 'You will pick an empty folder for it to live in.',
    own_vault_browser: 'Kept in this browser; switch to it from the vault menu.',
    /** The progress panel for a folder share opened as its own vault (first-run F1). */
    panel_title: 'Adding {name:string}',
    panel_folder: 'Folder',
    panel_failed: 'Adding the folder failed.',
    dest: 'Folder',
    dest_placeholder: 'e.g. shared/team',
    dest_hint: 'A new folder, or an existing empty one. A top-level name keeps it beside your notes.',
    dest_required: 'Pick a folder for the shared content to live in.',
    trust: 'Whoever holds a link can see everything you put in the folder.',
    joining: 'Adding…',
    join: 'Add folder',
  },
  /**
   * The share sheet (sharing E4): the folder's links as named rows, worded as
   * invitations. "Links, not people" sits in the body, in full — it is the
   * sentence that keeps the sharing model from being misread.
   */
  sheet: {
    title: 'Share {path:string}',
    intro_new:
      'Sharing a folder syncs everything inside it, live, to the people you give a link to. Nothing is moved or changed on disk; the rest of your vault stays here.',
    intro_shared:
      'Everything in {path:string} syncs through {host:string} to anyone holding one of these links. The rest of your vault stays on your devices.',
    intro_joined:
      'Everything in {path:string} syncs through {host:string} with whoever shared it with you. Its links are theirs to manage.',
    /** The first run (first-run D1/D2): the relay as a card, the secret verified, the first link named. */
    syncs_through: 'Syncs through',
    relay: 'Relay address',
    save_where: 'Save',
    first_link: 'First link: who is it for?',
    first_link_hint: 'One link per person, named for them, so you can remove one later.',
    /** The first link's name when none was typed (the owner's own credential is never handed over). */
    first_link_default: 'First link',
    your_name: 'Your name, shown to them',
    your_name_hint: 'Remembered on this device. They see it as the name you typed, not a verified account.',
    /** Why *Share* is disabled while the secret has not answered "works". */
    share_waits: 'Share unlocks once the team’s secret above says “works”.',
    share: 'Share and copy link',
    sharing: 'Sharing…',
    shared_copied: 'Shared. The link is on your clipboard — send it to whoever should have it.',
    shared_not_copied: 'Shared. Copy a link below and send it to whoever should have it.',
    links: 'Links · {count:number}',
    links_loading: 'Loading links…',
    links_none: 'No links yet — nobody else can open this folder.',
    links_need_secret: 'Add the team’s secret to see, create and remove this folder’s links.',
    this_link: 'This folder’s link',
    unnamed: 'Unnamed link',
    read_only: 'read-only',
    created: 'created {date:string}',
    copy_link: 'Copy link',
    copy_link_for: 'Copy link for {name:string}',
    /** C4: the link wrapped in a sentence, ready to paste into a chat. */
    copy_message: 'Copy message',
    copy_message_for: 'Copy message for {name:string}',
    message: 'I shared {folder:string} with you in Oh hi markdown. Open this link: {link:string}',
    /** C4 with no join page to point at (the desktop, off the team host): the bare link, pasted in the app. */
    message_bare:
      'I shared {folder:string} with you in Oh hi markdown. Open the app, choose Add a folder someone shared with you, and paste this link: {link:string}',
    message_guide: 'New to the app? {url:string}',
    just_made: 'Link for {name:string}',
    copied: 'Copied',
    remove: 'Remove',
    remove_for: 'Remove link for {name:string}',
    new_link: 'New link: who is it for?',
    new_link_placeholder: 'e.g. Sam, Team',
    name_required: 'Name the link after who it is for, so you can tell the links apart later.',
    read_only_label: 'Read-only',
    create: 'Create link',
    creating: 'Creating…',
    honesty:
      'Links, not people: there are no accounts yet. Anyone holding a link can open this folder, and removing a link does not disconnect anyone already connected — it stops new connections only, and someone connected stays until they reconnect.',
    stop: 'Stop sharing…',
    done: 'Done',
  },
  unshare: {
    title: "Stop sharing '{path:string}'?",
    body: 'The folder and its files stay in this vault and become local notes. Other people keep the copies they already have, but nothing syncs anymore. Existing links keep working until removed.',
    confirm: 'Stop sharing',
    revoke: 'Also remove every link to it on the relay',
  },
  unmount: {
    title: "Remove shared folder '{path:string}'?",
    body: "This vault stops syncing the folder. Its files stay on disk and become plain local notes (delete the folder afterwards if you don't want them). Other people are unaffected.",
    confirm: 'Remove from vault',
  },
  cross_move: {
    title: 'Move across a sharing boundary?',
    leaving:
      "Moving '{path:string}' out of the shared folder removes it for everyone else, and it stops syncing. Its sync history starts over as a local file.",
    entering:
      "Moving '{path:string}' into the shared folder makes it visible to everyone sharing it. Its sync history starts over in the shared space.",
    confirm: 'Move',
  },
}

/**
 * Nested shares (device-link N1): what a mount root says when it did NOT come
 * from this device — adopted from a peer's carve, mid-machine, or holding no
 * link yet. A `needs-token` mount is a fully functional LOCAL folder that
 * happens to know where its room lives, so the copy never says "offline"
 * (spike S10 Q2): not connected because this device has no key is a different
 * fact from not connected, and the pill would be lying either way.
 */
/**
 * The join page (first-run C2): `/join#editor1:…` in a browser. Honesty
 * (R5): the sender is "the name they typed", never a verified account;
 * "reachable" means the relay's health check answered, never that the link
 * is valid.
 */
const join_page = {
  brand: 'Oh hi markdown · a folder shared with you',
  heading_from: '{from:string} shared {label:string} with you',
  heading_anon: 'Someone shared {label:string} with you',
  a_folder: 'a folder',
  from_note: '“{from:string}” is the name they typed, not a verified account. Check this came from the person you think.',
  anon_note: 'The link does not say who sent it. Check it came from someone you expect.',
  facts: 'About this folder',
  what_you_get: 'What you get',
  what_you_get_body: 'Everything inside the folder, live. Anything you put in it is visible to everyone holding a link.',
  syncs_through: 'Syncs through',
  syncs_team: '{host:string}, the team’s relay.',
  syncs_other: '{host:string}, a relay run by whoever shared this.',
  offline: 'Editing offline always works.',
  relay_checking: 'Checking the relay…',
  relay_ok: 'The relay answered.',
  /** The relay answered its health check, but not `ok`: reached, so no network advice. */
  relay_unhealthy: 'The relay answered but is not healthy. Tell whoever runs it.',
  /** The down line: relay_down, then the network note (team) or relay_down_other, then reload. Each reads alone. */
  relay_down: 'Can’t reach the relay from here.',
  relay_down_other: 'Ask whoever shared this how to reach their relay.',
  reload: 'Reload this page once you can reach it.',
  where: 'Where do you want it?',
  desktop: 'In the desktop app',
  desktop_hint: 'Beside your own notes, as real files on disk. Best for anything you will keep.',
  copy: 'Copy link',
  copied: 'Copied. Open Oh hi markdown on this computer and choose Add a folder someone shared.',
  copy_failed:
    'This browser would not copy it. Select the link below and copy it, then open Oh hi markdown on this computer and choose Add a folder someone shared.',
  link_label: 'The link',
  browser: 'In this browser',
  browser_hint: 'Fine for a team folder: its notes also live with your teammates and on the relay.',
  add_here: 'Add here',
  no_app: 'Don’t have the app?',
  download: 'Download for macOS · Linux',
  new_to_app: 'New to the app?',
  guide: 'The two-minute guide',
  /** A link this page cannot read: the codec's reason, then the fallback. */
  error_heading: 'This link can’t be opened here',
  error_fallback: 'Ask for the link again, or paste it in the app: open Oh hi markdown and choose Add a folder someone shared.',
  /** A device link is never a folder share (device-link R5). */
  device_heading: 'This is a device link, not a shared folder',
  device_body:
    'It is a full-access key to a whole vault ({label:string}), meant only for its owner’s own devices. If it is yours, open it on the device you want the vault on with Link this device. If someone else sent it to you, do not use it.',
  device_vault: 'unnamed',
  device_desktop_hint: 'Copy it, then in Oh hi markdown on that computer choose Link this device.',
  device_copied: 'Copied. Open Oh hi markdown on this computer and choose Link this device.',
  device_copy_failed:
    'This browser would not copy it. Select the link below and copy it, then open Oh hi markdown on this computer and choose Link this device.',
  device_browser_hint: 'Pulls the whole vault into this browser and keeps it in sync.',
  link_here: 'Link this device',
}

const mounts = {
  link_needed: 'Link needed',
  link_needed_title:
    'Shared folder — this device holds no link for it, so nothing here syncs. The files stay on disk; add the link to start syncing.',
  link_needed_sr: 'Shared folder, link needed',
  attaching: 'Attaching…',
  attaching_title: 'Attaching this shared folder — its files are moving into their own synced space.',
  folding_back: 'Folding back…',
  folding_back_title: 'Folding this shared folder back into the vault — its files become local notes.',
  add_link: 'Add link…',
  rail_link_needed: 'Shared folder — link needed',
  reason: {
    link_needed: 'This device holds no link for this shared folder yet — add the link first.',
    attaching: 'This shared folder is still being attached.',
    folding_back: 'This shared folder is being folded back into the vault.',
    mount_root_rename:
      "'{path:string}' is the root of a shared folder — rename it where it was shared, not here.",
    mount_root_move:
      "'{path:string}' is the root of a shared folder — moving it would move it out of the share.",
    mount_root_delete:
      "'{path:string}' is the root of a shared folder — stop sharing it first, then delete the folder.",
    depth_limit:
      "'{path:string}' is inside a shared folder — shared folders cannot nest, so it was folded into the outer one.",
    mount_moved: "'{path:string}' was moved on another device.",
    room_repointed:
      "'{path:string}' was shared from two devices at once — this device followed the one everyone else sees.",
  },
  dialog: {
    title: 'Add the link for {path:string}',
    description:
      'This folder is shared, but this device holds no link for it. Paste the link and it starts syncing where it stands — nothing is re-downloaded and no file on disk changes.',
    link: 'Share link',
    link_placeholder: 'editor1:…',
    link_invalid: 'That doesn’t look like a share link — they start with "editor1:".',
    wrong_room: 'That link is for a different shared folder — paste the link for {path:string}.',
    /**
     * R5 at the field, in both directions: a device link is a key to a whole
     * vault, so it must never be pasted where a folder link is expected —
     * neither here nor in "Add a shared folder here…", which shares this key.
     */
    device_link_refused:
      'This is a device link — use "Link this device" in the vault manager to put a whole vault on this device.',
    adding: 'Adding…',
    add: 'Add link',
  },
}

/**
 * Device linking (device-link-shaping A1/R5, slice N2): the vault's own link
 * is a full-access credential for ONE person's devices, and the product says
 * so at the point of copying — folder links never grant the vault.
 *
 * The word is LINKED, never "shared": sharing is what you do with other
 * people, folder by folder (decision #8 stands). A linked vault is
 * "Synced to your devices"; a note in one reads "On your devices".
 */
const device_link = {
  full_access_warning:
    'A device link is a full-access key to this vault. Never give it to anyone else.',
  // ---- Settings › Sync ----
  section: 'Link a device',
  section_help:
    'Sync this whole vault to another device of your own. The other device pulls a copy and the two stay in step — including the folders you share with other people.',
  open: 'Link a device…',
  needs_vault: 'Open a vault first — a device link is a key to one vault.',
  /** Settings › Sync, under the secret field (first-run D2). */
  needs_secret: 'Creating a device link needs the team’s secret. Enter it in the Team secret field above.',
  /** The owner's dialog, opened without a secret saved. */
  needs_secret_dialog:
    'Creating a device link needs the team’s secret. Add it in Settings › Sync & devices, then come back here.',
  // ---- the owner's dialog ----
  title: 'Link a device',
  description:
    'Create a link here, then paste it on your other device. That device pulls the whole vault into an empty folder and stays in sync from then on.',
  label: 'Which device is this for?',
  label_placeholder: 'e.g. laptop',
  create: 'Create device link',
  creating: 'Creating…',
  link: 'Device link',
  copy: 'Copy',
  copied: 'Copied!',
  next_step: 'On the other device, choose "Link this device…" in the vault manager and paste it.',
  links_title: 'Device links',
  links_loading: 'Loading…',
  links_none: 'No device links yet.',
  unnamed: 'unnamed device',
  revoke: 'revoke',
  revoke_device: 'Revoke the device link {label:string}',
  revoke_hint:
    'Revoking blocks new connections; a device that is connected right now stays until it reconnects.',
  // ---- the new device's dialog ----
  join_title: 'Link this device',
  join_description:
    'Paste the device link from the vault you want here. This device pulls the whole vault — notes and folders, including the folders shared with you.',
  join_link: 'Device link',
  join_link_placeholder: 'editor1:…',
  join_link_invalid: 'That doesn’t look like a link — they start with "editor1:".',
  join_not_device:
    'That is a folder link, not a device link. Open a vault and use "Add a shared folder here…" for it.',
  join_hint_desktop: 'You will be asked for a folder to put the vault in. It must be empty.',
  join_hint_browser: 'The vault is stored privately in this browser.',
  join_submit: 'Link this device',
  join_working: 'Linking…',
  not_empty: '‘{path:string}’ is not empty — pick an empty folder for the vault to arrive in.',
  already_linked: 'That vault is already on this device, as ‘{name:string}’ — open it instead.',
  // ---- the joiner's progress panel ----
  panel_title: 'Linking this device',
  panel_vault: 'Vault',
  panel_destination: 'Destination',
  progress_label: 'Link progress',
  starting: 'Starting…',
  phase_pull: 'Pulling {total:number} note{{s}} from the relay…',
  phase_write: 'Writing files into {dest:string}…',
  counts: '{done:number} of {total:number}',
  attachments:
    'Images and PDFs will not arrive on this device yet — only notes and folders sync. They stay on the device that has them.',
  failed: 'Linking failed.',
  retry: 'Try again',
  /** Spike S10 Q7 §Size: say it, never truncate the bundle in silence. */
  too_many_grants:
    'This device holds {count:number} shared-folder links — too many to bundle into one device link. The other device will ask for each of them once.',
}

const breaker = {
  title: '{count:number} files changed at once',
  description:
    'This looks like a bulk change (a git branch switch, a folder drop). Nothing has been synced yet — apply it, or dismiss to leave those files untouched for now.',
  more: '… and {count:number} more',
  dismiss: 'Not now',
  apply: 'Apply changes',
}

const review = {
  title: 'Divergence review — {path:string}',
  description: 'reason: {reason:string}. Nothing is written to disk until you resolve.',
  vanished:
    'This file was deleted on disk outside Oh hi markdown, but its synced content still exists. Restore it, or confirm the deletion — confirming removes it for everyone sharing this folder (a recovery copy is journaled).',
  confirm_removal: 'Confirm removal',
  restore: 'Restore file',
  mine: 'mine (editor)',
  theirs: 'theirs (disk)',
  pick_mine: 'pick mine',
  pick_theirs: 'pick theirs',
  keep_mine: 'keep mine',
  keep_theirs: 'keep theirs',
  accept_merge: 'accept merge',
}

/** The inspector tab (devtools-shaping D). Field-name echoes are not copy. */
const devtools = {
  tab: 'Inspector',
  /** A view tab holding one file's detail alone (devtools-shaping E3). */
  tab_file: 'Inspector · {path:string}',
  /** The `inspector` readout: the toolbar's bug icon, shown while developer tools are on. */
  open: 'Open the inspector',
  title: 'Inspector',
  refresh: 'Refresh',
  scope: 'Scope',
  all_mounts: 'All mounts',
  root_mount: 'root',
  invariants_ok: 'invariants hold',
  invariants_failed: '{count:number} invariant violation{{s}}',
  snapshot: 'snapshot {age:string}',
  /** The dot on a scope chip or a mount line, said for a screen reader. */
  health: {
    ok: 'in sync',
    pending: 'something pending',
    diverged: 'something diverged',
    offline: 'not syncing',
  },
  copy: {
    label: 'Copy report',
    file: 'The selected file',
    file_none: 'Select a file first',
    scope: 'Every row in scope',
    copied: 'Inspector report copied',
    failed: 'The clipboard refused the report. Select it below and copy it by hand.',
    fallback_label: 'Inspector report',
    report_title: 'Oh hi inspector report',
  },
  /** The mount strip (All mounts) and the mount card (one mount). */
  mount: {
    rows: '{count:number} row{{s}}',
    all_in_sync: 'all in sync',
    not_syncing: 'not syncing',
    /** A mount line's right end when rows' relay is offline (the pill is grey). */
    relay_unreachable: 'relay unreachable',
    at_relay: '{count:number} at the relay',
    counted: {
      diverged: '{count:number} diverged',
      disk_changed: '{count:number} flush pending',
      doc_ahead: '{count:number} base pending',
    },
    no_relay: 'no relay',
    /** A mount's status (`MountStatus`, `:` and `-` as `_`), in the identity line, the strip and the report. */
    statuses: {
      active: 'active',
      needs_token: 'needs a link',
      joining: 'joining',
      carving_seeding: 'carving (seeding)',
      carving_detaching: 'carving (detaching)',
      unsharing_absorbing: 'unsharing (absorbing)',
      unsharing_disconnecting: 'unsharing (disconnecting)',
      adopting_seeding: 'adopting (seeding)',
      adopting_detaching: 'adopting (detaching)',
      absorbing: 'absorbing',
    },
    room: 'room {room:string}',
    stores: '{entries:number} entries · {docs:number} docs · {base:number} base · {journal:number} journal',
    agrees: 'mounts.json agrees',
    root: 'the vault root; mounts.json lists only shared folders',
    no_desc: 'no mounts.json row',
    needs_token: 'needs a link',
    needs_token_never_held: 'needs a link, never held',
    status: 'mounts.json says {status:string}',
    relay_differs: 'mounts.json names {desc:string}, the session uses {session:string}',
    orphans: '{count:number} base {{record names|records name}} no file',
    orphans_show: 'show',
    no_orphans: 'no orphan base records',
    open_here: '{count:number} open here',
  },
  filter_prefix: 'Path',
  /** The list's scroll region (focus lands on it when the drawer closes with no row selected). */
  list_label: 'Files',
  tally: 'States',
  sort_label: 'Order',
  sort: {
    worst: 'Worst first',
    path: 'By path',
  },
  /** States renamed by what is pending (second pass); the ids in `inspector.ts` are unchanged. */
  states: {
    diverged: 'Diverged',
    disk_changed: 'Flush pending',
    doc_ahead: 'Base pending',
    no_lca: 'Never reconciled',
    no_doc: 'No live doc',
    in_sync: 'In sync',
    not_text: 'Not text',
  },
  /** The one sentence the detail says for a state. */
  say: {
    diverged:
      'Disk and the document both moved since they last agreed. The review decides; nothing is written to disk until it is resolved.',
    disk_changed:
      'The document moved and the file on disk has not been written yet. It is written on the next flush; if this stays, that is a finding.',
    doc_ahead:
      'The file on disk already matches the document, but the base record is behind both. The next reconcile records the new base.',
    no_lca: 'No record yet of what disk and the document last agreed on. The first reconcile writes one.',
    no_doc:
      'Nothing is in memory for this file right now; it lives on disk and in the base store. Opening it loads one.',
    in_sync: 'Disk, the base and the document are the same text.',
    /** An in-sync row whose relay has not received every edit (its badge is pending amber). */
    in_sync_relay_pending: 'Disk, the base and the document are the same text. Edits are still on their way to the relay.',
    /** An in-sync row whose relay is unreachable (its badge is offline grey). */
    in_sync_offline:
      'Disk, the base and the document are the same text. The relay is unreachable, so edits stay here until it is back.',
    not_text: 'A binary file or a folder. It is never synced through a document, and no pill ever claims it.',
  },
  rows: '{shown:number} of {total:number} row{{s}}',
  no_rows: 'No rows match.',
  open_tag: 'open',
  col: {
    path: 'Path',
    chain: 'Chain',
    state: 'State',
    journal: 'Journal',
    actions: 'Actions',
    disk: 'disk',
    base: 'base',
    doc: 'doc',
    relay: 'relay',
    /** The chain column header's title: what "base" means. */
    base_title: 'the text disk and doc last agreed on (LCA)',
  },
  /** A link of the chain, said (glyph titles and screen readers). */
  link: {
    equal: 'equal',
    differs: 'differs',
    unknown: 'not known',
  },
  /** The chain read aloud: one sentence for the glyphs a screen reader would spell out. */
  chain_said: 'disk to base {diskLca:string}, base to doc {lcaDoc:string}, relay: {relay:string}',
  relay_link: {
    synced: 'the relay has every edit',
    pending: 'not yet at the relay',
    offline: 'offline',
    none: 'no relay',
    unknown: 'not known',
  },
  /** The relay in words, in the detail. Green is relay receipt, never durability (golden rule 4). */
  relay_say: {
    synced: 'In sync with the relay: it has received every edit.',
    pending: 'Edits are on their way to the relay.',
    offline: 'Not connected to the relay.',
    none: 'This file has no relay.',
    unknown: 'The relay state is not known yet.',
  },
  versions: '{count:number} saved version{{s}}',
  verbs: {
    open_note: 'Open note',
    open_note_path: 'Open {path:string}',
    reveal: 'Reveal in navigator',
    own_tab: 'Open in its own tab',
    own_tab_path: 'Open {path:string} in its own tab',
    open_inspector: 'Open the inspector',
    close: 'Close',
  },
  detail: 'File detail',
  peek: {
    diffs: 'Differences',
    texts: 'Texts',
    doc_lca: 'doc vs base',
    disk_lca: 'disk vs base',
    disk_doc: 'disk vs doc',
    disk: 'disk',
    lca: 'base',
    doc: 'doc',
    absent: '(absent)',
    identical: 'identical',
    too_large: 'too large to diff here',
    raw: 'Raw facts',
  },
  select_row: 'Select a text row to inspect its disk ↔ CRDT state.',
  /** The detail before the first snapshot, or while the selected file is being read. */
  loading: 'Reading…',
  /** A tab's path the current snapshot does not name (rename-following is deferred). */
  not_found: 'This file is not in the current snapshot: it was renamed or deleted.',
  no_preimages: 'no pre-images yet',
  no_doc_store: 'no doc store',
  never: 'never',
  just_now: 'just now',
  seconds_ago: '{count:number}s ago',
  minutes_ago: '{count:number} min ago',
}

const ui = {
  notifications: 'Notifications',
  dismiss_notification: 'Dismiss notification',
  update_ready: 'Update installed',
  update_ready_body: 'Version {version:string} is ready. Restart to start using it.',
  restart: 'Restart',
  /** first-run E2: beside Restart on the update toast; opens the "What's new" guide page. */
  what_changed: 'What changed',
}

/**
 * Help (first-run E1–E3): the toolbar's Help menu, its `help.*` commands, the
 * version line at its foot and the Report a problem dialog. Honesty (R5):
 * "up to date" only when the last check found nothing newer, and the report
 * is copied — the app never sends it, so nothing here says "sent".
 */
const help = {
  label: 'Help',
  menu: {
    start: 'Getting started',
    /** Right-aligned beside "Getting started": how long the page takes to read. */
    start_time: '2 min',
    shortcuts: 'Keyboard shortcuts',
    recovery: 'When something goes wrong',
    sharing: 'Sharing and the relay',
    customise: 'Customising the app',
    agents: 'Working with an agent',
    changes: 'What’s new in {version:string}',
    changes_plain: 'What’s new',
    report: 'Report a problem…',
  },
  /** The menu's foot: the running build and the updater's last outcome. */
  version: {
    plain: 'Version {version:string}',
    unknown: 'Version not known',
    current: 'Version {version:string} · up to date · checked {when:string}',
    failed: 'Version {version:string} · could not check · last checked {when:string}',
    failed_never: 'Version {version:string} · could not check',
    found: 'Version {version:string} · downloading {next:string}',
    ready: 'Version {version:string} · update ready, restart to use it',
  },
  /** The palette rows, one per menu item. */
  commands: {
    menu: 'Help menu',
    start: 'Help: Getting started',
    shortcuts: 'Help: Keyboard shortcuts',
    recovery: 'Help: When something goes wrong',
    sharing: 'Help: Sharing and the relay',
    customise: 'Help: Customising the app',
    agents: 'Help: Working with an agent',
    changes: 'Help: What’s new',
    report: 'Report a problem…',
  },
  /** The desktop's guide window title. */
  window_title: 'Oh hi markdown guide',
  report: {
    title: 'Report a problem',
    description: 'Say what happened in a sentence. The facts below are copied with it; paste the whole thing wherever you ask for help.',
    what_label: 'What happened',
    what_placeholder: 'I clicked … and then …',
    attached: 'Attached automatically',
    never_content: 'Note contents are never included.',
    copy: 'Copy report',
    copied: 'Report copied. Paste it wherever you ask for help.',
    copy_failed: 'The clipboard is blocked. The report is selected below: copy it by hand.',
    fallback_label: 'The report as text',
    /** The copied text, line by line. */
    header: 'Oh hi markdown — problem report ({time:string})',
    what: 'What happened: {text:string}',
    what_empty: 'What happened: (not filled in)',
    app: 'App: Oh hi markdown {version:string} · {platform:string}',
    version_unknown: 'version not known',
    platform: {
      desktop: 'desktop app',
      browser: 'browser',
    },
    platform_os: '{platform:string} on {os:string}',
    vault: 'Vault: {name:string} ({kind:string})',
    vault_none: 'Vault: none open',
    vault_kind: {
      tauri: 'a folder on disk',
      opfs: 'in this browser',
      memory: 'in memory, for tests',
    },
    relay: 'Relay: {host:string} · {state:string}',
    relay_since: 'Relay: {host:string} · {state:string} · {since:string}',
    relay_none: 'Relay: none (nothing in this vault is shared or linked)',
    note: 'Open note: {path:string} · {status:string} · {people:string}',
    note_unshared: 'not shared, so no sync state',
    note_none: 'Open note: none',
    people: '{count:number} {{person|people}} online',
    counts: 'This session: {errors:string}, {warnings:string}',
    errors: '{count:number} error{{s}}',
    warnings: '{count:number} warning{{s}}',
    events: 'The last {count:number} event{{s}} from the Log:',
    events_none: 'The Log is empty this session.',
  },
}

/** Errors the workspace shim raises; they land in a toast, a dialog, or the Activity log. */
const workspace = {
  /**
   * Decision 4 (keep + mark), said where the user reads it: nothing is
   * missing and nothing gets re-downloaded — the folder and its files are on
   * disk and editable, and adding the link starts them syncing where they
   * stand. Never "rejoin", which promises a download that does not happen.
   */
  no_token:
    "this device holds no link for the shared folder '{path:string}', so nothing in it syncs yet — its files stay on disk. Open the folder's menu and choose “Add link…” to start it syncing; nothing is re-downloaded",
  only_folders: 'only folders can be shared',
  inside_shared: 'this folder is already inside a shared folder',
  overlaps: 'this folder overlaps an existing shared folder',
  needs_secret: 'add the team’s secret in Settings to create shares in-app',
  already_joined: 'this share is already part of this vault',
  not_shared: "'{path:string}' is not a shared folder",
  cannot_read: 'cannot read {path:string}',
  cross_mount_move: 'moving across shared-folder boundaries needs the move confirmation',
}

const relay = {
  unreachable: 'relay unreachable at {url:string} — is it running?',
  bad_secret: 'the relay rejected the team’s secret — check Settings',
  no_admin: 'this relay has no admin API enabled (OPERATOR_SECRET unset)',
  failed: 'relay admin call failed ({status:number})',
}

/** Layout files (quiet-shell F8): what the loader says when one cannot be used. */
/** Keymaps as files (quiet-shell F10). */
const keymaps = {
  invalid: 'The keymap "{name:string}" could not be used, so the default keys are in force: {error:string}',
  not_found: 'No keymap named "{name:string}" in this vault, your config folder or the built-ins.',
  needs_vault: 'Open a vault first — a saved keymap is a file inside it.',
  cannot_restore: 'This window cannot put a keymap file back.',
  cannot_remove: '{path:string}: this vault cannot remove a file.',
  bad_name: 'Use letters, numbers, spaces, - and _ ("default" is the built-in).',
  migrated: 'Your shortcuts are now a keymap file: {path:string}',
  migrate_failed: 'Your shortcuts could not be written to a keymap file, so they stay on this device: {error:string}',
}

/** Templates as files (quiet-shell F11). */
const templates = {
  row: 'Insert template: {name:string}',
  needs_note: 'Open a note you can edit to insert a template into.',
  not_found: 'No template named "{name:string}" in this vault, your config folder or the built-ins.',
}

/**
 * A resource file in use changed on disk or on *Reload files*
 * (settings-shaping ST6): the notice, its Undo, and its words in the Log.
 */
const resources = {
  reloaded: '{kind:string} {file:string} reloaded from {root:string}',
  reloaded_builtin: '{kind:string} {name:string} reloaded: the built-in one is in use',
  kind: {
    layouts: 'Layout',
    keymaps: 'Keymap',
  },
  root: {
    vault: 'this vault',
    user: 'your config folder',
  },
  undo: 'Undo',
  show: 'Show',
  /** On a file that can't be used: opens Settings › Customise, where Problems lists it. */
  show_problems: 'Show problems',
  undo_layout_hint: 'Undo goes back to the layout you had, for this session. The file is not changed.',
  undo_keymap_hint: 'Undo puts the file back as it was.',
  undone_layout: 'Back to the layout you had, for this session. {file:string} is unchanged; Reload files applies it.',
  undone_keymap: '{file:string} is back as it was.',
  undo_failed: 'Could not undo: {error:string}',
  undo_stale: 'it has changed again since, so nothing was undone',
}

const layouts = {
  invalid: 'The layout "{name:string}" could not be used, so the default layout is showing: {error:string}',
  not_found: 'No layout named "{name:string}" in this vault, your config folder or the built-ins.',
  needs_vault: 'Open a vault first — a saved layout is a file inside it.',
  bad_name: 'Use letters, numbers, spaces, - and _ ("default" is the built-in).',
}

/**
 * The toolbar (quiet-shell F5) and its readouts (F6). Format buttons take
 * their names from `commands.format`, so a button, a palette row and a key
 * are one string.
 */
const toolbar = {
  label: 'Note toolbar',
  format_group: 'Formatting',
  format_menu: 'Format',
  /** The `nav` readout's group: back and forward through the focused tab's trail. */
  nav_label: 'Back and forward',
  paragraph_style: 'Paragraph style',
  with_binding: '{title:string} ({binding:string})',
  files: 'Files',
  reading_time: '{minutes:number} min read',
  reading_time_none: 'Nothing to read',
  zoomed_more: 'Zoomed · {count:number} more',
  group: 'Tab group: {name:string}',
  focus: {
    leave: 'Leave Focus mode (Esc)',
  },
  daily: {
    label: 'Daily notes',
  },
}

const theme = {
  bad_name: 'Theme names may contain letters, numbers, spaces, - and _ only.',
  missing: 'No theme at {path:string}',
  /**
   * Nord Light and Dark left the built-ins (v2-shaping Fork 2, Fork 4-A): the
   * one-time notice when the preference names one and the open vault has no
   * folder for it, and the toast's button.
   */
  retired:
    '{label:string} is no longer built in: it is a theme a vault holds, and this vault has no {path:string}, so {stand_in:string} stands in. Add it from Settings › Appearance, or copy {example:string} there.',
  show_themes: 'Show themes',
  /** The shipped example themes, by folder name. */
  examples: {
    nord_light: 'Nord Light',
    nord_dark: 'Nord Dark',
  },
  example_exists: 'This vault already has {path:string}; it was left as it is.',
}

/**
 * Pasting and dropping pictures, and pictures a note links to (editor-usability
 * E5). Sync honesty (golden rule 4): an attachment is written to THIS device's
 * disk and is not synced (D2f), and no string here may say otherwise.
 */
const attachments = {
  /** The drop overlay's first line, while image files are dragged over a note. */
  drop_title: 'Drop to add to this note',
  /** Its second line: where the file goes (names are private until the drop). */
  saved_in: 'Saved in {folder:string}',
  /** The same, for several files at once. */
  saved_in_many: '{count:number} files, saved in {folder:string}',
  /**
   * The folder name for the top of the vault, inside the sentence above —
   * `common.vault_root` is the label form.
   */
  vault_root: 'the vault root',
  /** Toasted after a picture goes into a note inside a shared folder. */
  shared_notice:
    "This note is in {share:string}. Images don't sync, so collaborators will see a placeholder instead of this picture.",
  /** `![alt](https://…)`'s placeholder: nothing is fetched until the button is pressed. */
  remote_from: 'Image from {host:string}',
  remote_load: 'Load image',
  /** After a load the host refused (CORS, the app's content policy, offline). */
  remote_failed: "{host:string} didn't let this image load here",
  /** Tooltip of a remote image left as a link where remote images cannot load at all. */
  remote_not_loaded: 'Remote image, not loaded',
}

/**
 * The writing harness, one sub-object per surface: `settings` and
 * `providers` (Settings › AI), `session` / `composer` / `refs` (the Session
 * view and its turns), `skills` (Settings › AI › Skills and `ai.run-skill`),
 * `suggest` (the agent's suggestions in a note), `comments` (threads, and a
 * comment sent to the agent), `presence` (the agent as a peer), `commands`.
 */
const ai = {
  settings: {
    /** Settings › AI's lede (one page since QA round 1: no Providers · Skills tabs). */
    egress:
      'Nothing leaves this device until you add a provider. With one, the text you reference is sent to that endpoint, and nowhere else.',
  },
  providers: {
    title: 'Providers',
    intro: 'A provider is the model endpoint the assistant talks to. AI is on while at least one is listed.',
    empty: 'No provider yet. Add one to turn on the assistant.',
    add: 'Add provider',
    add_title: 'New provider',
    /** The provider form's commit (`common.save` went with settings-shaping ST2's one save model; this form still commits a record). */
    save: 'Save',
    edit_title: 'Edit {name:string}',
    edit: 'Edit',
    edit_label: 'Edit {name:string}',
    delete: 'Delete',
    delete_label: 'Delete {name:string}',
    delete_confirm: 'Delete {name:string}? Its key is removed from this device.',
    delete_yes: 'Delete provider',
    default: 'Default',
    default_label: 'Use {name:string} by default',
    key_configured: 'Key configured',
    egress: 'Text you reference is sent to {name:string} at {host:string}',
    kinds: {
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      openrouter: 'OpenRouter',
      openai_compatible: 'OpenAI-compatible (local or self-hosted)',
    },
    field: {
      name: 'Name',
      name_placeholder: 'e.g. Claude, or Ollama on this machine',
      kind: 'Kind',
      base_url: 'Base URL',
      base_url_hint: 'Leave as is unless you route through a gateway.',
      base_url_hint_compatible: 'e.g. http://localhost:11434/v1 (Ollama)',
      model: 'Model',
      model_placeholder: 'e.g. claude-sonnet-4-5, gpt-4.1, llama3.1',
      api_key: 'API key',
      api_key_keep: 'A key is stored. Leave this empty to keep it.',
      api_key_where: 'Kept on this device, in the app’s storage — never shown again, never synced.',
      api_key_optional: 'Optional for a local server.',
      timeout: 'Timeout (seconds)',
      timeout_hint: 'Stop a run that takes longer. Empty: no limit.',
      max_tokens: 'Max output tokens',
      max_tokens_hint: 'Cap each answer’s length. Empty: the provider’s default.',
    },
    error: {
      name_required: 'Give the provider a name.',
      model_required: 'Name the model to use.',
      base_url_required: 'An OpenAI-compatible provider needs its base URL.',
      base_url_invalid: 'Use an http:// or https:// URL.',
      number_invalid: 'Use a whole number above zero, or leave it empty.',
    },
    test: 'Test connection',
    testing: 'Testing…',
    test_ok: 'Connected. {count:number} model{{s}} available{list:string}',
    test_failed: 'Could not connect: {error:string}',
    local_help_title: 'Local servers',
    local_help:
      'Ollama, LM Studio and llama.cpp speak the OpenAI-compatible API. If the browser refuses the connection, the server has to allow this app’s origin ({origin:string}): start Ollama with OLLAMA_ORIGINS set to it, or turn on CORS in LM Studio’s server settings. This is documented by those servers, not yet verified in every build of this app.',
  },
  session: {
    title: 'Session',
    title_named: 'Session: {name:string}',
    empty: 'No session yet. Start one from a selection, or ask about your notes.',
    untitled: 'Untitled session',
    menu: 'Sessions',
    recent: 'Recent sessions',
    none_recent: 'No earlier sessions in this vault.',
    new: 'New session',
    rename: 'Rename…',
    rename_label: 'Session title',
    archive: 'Archive',
    provider_label: 'Provider',
    provider_option: '{name:string} · {model:string}',
    no_provider: 'Add a provider in Settings › AI to talk to an agent.',
    open_settings: 'Open Settings',
    transcript: 'Transcript',
    you: 'You',
    agent: 'Agent',
    reasoning: 'Thinking',
    stop: 'Stop',
    retry: 'Retry',
    nothing_running: 'No AI run is in progress.',
    provider_gone: 'The provider this session was using is gone. Pick another in the session’s header.',
    failed: 'The run failed: {message:string}',
    run: '{status:string} · {elapsed:string}',
    elapsed_seconds: '{n:number}s',
    elapsed_minutes: '{m:number}m {s:number}s',
    status: {
      scheduled: 'Waiting',
      running: 'Working',
      successful: 'Done',
      failed: 'Failed',
      cancelled: 'Stopped',
    },
    tool: {
      running: 'Working…',
      search: 'Searched for “{query:string}”',
      results: '{count:number} result{{s}}',
      open: 'Open',
      read: 'Read {what:string} ({size:string})',
      read_section: '§{section:string} of {path:string}',
      read_lines: 'lines {from:number}–{to:number} of {path:string}',
      proposed: 'Proposed an edit in {path:string}',
      proposal_none: 'Nothing to propose in {path:string}: it already says that',
      proposal_applied: 'Edited {path:string} directly',
      used: 'Used {name:string}',
      failed: '{name:string} failed: {message:string}',
      details: 'Details',
    },
  },
  composer: {
    label: 'Message the agent',
    placeholder: 'Ask about your notes — @ to reference, / for a skill',
    send: 'Send',
    hint: 'Enter to send · Shift+Enter for a new line',
    menu: 'Suggestions',
    no_matches: 'No matches',
    kind: {
      file: 'Note',
      folder: 'Folder',
      section: 'Heading',
      lines: 'Selection',
      skill: 'Skill',
    },
    selection: 'The selection in {name:string}',
  },
  refs: {
    lines: '{name:string} ({from:number}–{to:number})',
    line: '{name:string} ({line:number})',
    section: '{name:string} › {heading:string}',
    folder: '{path:string}/',
    chip: 'Reference: {label:string}',
    chip_changed: 'Reference: {label:string} (changed since you referenced it)',
    skill_chip: 'Skill: {label:string}',
  },
  skills: {
    title: 'Skills',
    intro:
      'Skills are folders of instructions in .agents/skills/. They sync with the vault, and Codex, Cursor, Gemini CLI and others read them as they are.',
    no_vault: 'Open a vault to manage its skills.',
    empty: 'No skills in this vault yet. Create one, or import one from GitHub.',
    list: 'Skills in this vault',
    new: 'New skill…',
    import: 'Import…',
    open: 'Open {name:string}',
    /** A row's verb, beside the name it opens (its accessible name is `open`). */
    open_short: 'Open',
    review: 'Review…',
    enabled: 'Use {name:string}',
    trusted: 'Trusted',
    untrusted: 'Needs review',
    untrusted_hint:
      'It arrived by sync or was written outside Oh hi, or changed there since you trusted it. The agent is not offered it until you review it.',
    invalid: 'Not valid',
    scripts: 'Has scripts',
    scripts_hint: 'It ships a scripts/ folder. Oh hi never runs scripts; an agent on your computer, like Claude Code, might.',
    shape: '{kind:string} · {input:string} → {output:string}',
    any: 'any',
    kind: { check: 'Check', transform: 'Transform', generate: 'Generate', research: 'Research' },
    input: { selection: 'selection', section: 'section', note: 'note', folder: 'folder' },
    output: { replace: 'replaces', insert: 'inserts', annotate: 'comments', new_note: 'new note' },
    problem: {
      frontmatter_missing: 'SKILL.md has no frontmatter block (--- … ---) at the top.',
      frontmatter_invalid: 'A frontmatter line could not be read.',
      name_missing: 'The frontmatter has no name.',
      name_format: 'The name may use lowercase letters, numbers and single hyphens only.',
      name_length: 'The name is longer than 64 characters.',
      name_mismatch: 'The name must be the same as the folder’s.',
      name_reserved: 'The name uses a reserved word (anthropic, claude or synced).',
      description_missing: 'The frontmatter has no description.',
      description_length: 'The description is longer than 1,024 characters.',
      compatibility_length: 'compatibility is longer than 500 characters.',
      metadata_nested: 'metadata may hold only key: value pairs, one level deep.',
      metadata_kind: 'ohhi-kind must be check, transform, generate or research.',
      metadata_input: 'ohhi-input must be selection, section, note or folder.',
      metadata_output: 'ohhi-output must be replace, insert, annotate or new-note.',
      body_length: 'The instructions are longer than 500 lines.',
      lint_command: 'The instructions run a shell command (!`…`), which a vault skill must not.',
      lint_context: 'context: is a Claude Code feature a vault skill must not use.',
      lint_hooks: 'hooks: is a Claude Code feature a vault skill must not use.',
      unknown: 'Problem: {code:string}',
    },
    create: {
      title: 'New skill',
      name: 'Name',
      name_hint: 'Lowercase letters, numbers and hyphens. It is also the folder’s name.',
      name_invalid: 'Use lowercase letters, numbers and single hyphens, up to 64 characters.',
      name_taken: 'This vault already has a skill with that name.',
      submit: 'Create',
      cancel: 'Cancel',
      failed: 'Could not create the skill.',
    },
    farm: {
      title: 'Claude Code',
      label: 'Export for Claude Code',
      hint: 'Copies trusted, enabled skills into .claude/skills/, where Claude Code looks. A folder there that Oh hi did not make is never touched.',
      browser: 'This vault lives in the browser, where no other app can read it, so there is nothing to export for Claude Code.',
      unavailable: 'Exporting for Claude Code is not available for this vault yet.',
      result: '{written:number} exported · {blocked:number} left alone',
      failed: 'Could not update .claude/skills/: {message:string}',
    },
    import_dialog: {
      title: 'Import a skill',
      review_title: 'Review {name:string}',
      description: 'Nothing is written until you trust it. Read the instructions and every file first: a skill tells the agent what to do.',
      source: 'GitHub',
      source_hint: 'owner/repo/path/to/skill, or a github.com/…/tree/… link',
      source_placeholder: 'owner/repo/skills/name',
      fetch: 'Fetch',
      fetching: 'Fetching…',
      folder: 'Choose a folder…',
      instructions: 'SKILL.md',
      files: 'Files',
      urls: 'Links in the skill',
      urls_none: 'No links.',
      allowed_tools: 'Pre-approved tools: {tools:string}',
      pinned: 'Pinned to commit {sha:string}',
      binary_listed: '{count:number} binary file{{s}}, listed above: imported as {{it is|they are}}, not shown here.',
      scripts: 'It ships scripts. Oh hi never runs them, but read them before you trust it: an agent on your computer might.',
      problems: 'Problems',
      exists: 'A skill named {name:string} is already in this vault.',
      trust: 'Trust and enable',
      cancel: 'Cancel',
      bad_source: 'Use owner/repo/path or a github.com/…/tree/… link.',
      no_skill_md: 'No SKILL.md at {path:string}. Name the skill’s own folder.',
      too_many: 'More than {max:number} files: that is not one skill.',
      fetch_failed: 'GitHub answered {status:number} for {path:string}.',
      network: 'Could not reach GitHub: {message:string}',
      folder_failed: 'Could not read that folder: {message:string}',
      write_failed: 'Could not write the skill: {message:string}',
      bad_path: 'The skill has a file outside its own folder ({path:string}), so it is not imported.',
      changed: '{name:string} changed since you reviewed it. Review it again.',
      imported: '{name:string} is trusted and enabled.',
    },
    run: {
      placeholder: 'Run a skill on {target:string}',
      target_selection: 'the selection',
      target_note: 'this note',
      none: 'No trusted, enabled skill takes {target:string}. Manage skills in Settings › AI › Skills.',
      no_note: 'Open a note first.',
      no_vault: 'Open a vault first.',
      started: 'Running {name:string}…',
      not_started: 'Could not start {name:string}: a run is already going, or no provider is set up.',
      failed: '{name:string} did not finish: {error:string}',
      findings: '{name:string} left {count:number} comment{{s}}.',
      findings_skipped: '{name:string} left {count:number} comment{{s}}; {skipped:number} quote{{s}} could not be found in the note.',
      no_findings: '{name:string} found nothing to comment on.',
      created: '{name:string} wrote {path:string}.',
      answered_no_note: '{name:string} answered without a note to write; see the session.',
      untitled: 'Untitled',
    },
  },
  suggest: {
    /** The `last-agent-write` readout: "Tighten edited Plan 3 min ago". */
    last_write: '{name:string} edited {note:string} {ago:string}',
    last_write_title: 'The agent’s last edit — open {note:string}',
    none_at_caret: 'No suggestion at the caret.',
    none_in_note: 'No suggestions in this note.',
    stale: 'The text changed under that suggestion, so it was not applied.',
    accepted_all: 'Accepted {count:number} suggestion{{s}}.',
    accepted_some: 'Accepted {count:number} suggestion{{s}}; {stale:number} had gone stale.',
    rejected_all: 'Rejected {count:number} suggestion{{s}}.',
    undone: 'Undid the agent’s edit.',
    nothing_to_undo: 'The agent has no edit to undo.',
    /** The pair drawn after a proposal in the note (QA round 1). */
    accept: 'Accept',
    reject: 'Reject',
    /** The pair's group name: who proposed it. */
    pair: 'Suggestion by {name:string}',
    /** A proposal's gutter mark: which one, of how many, by whom. Pressing it moves the caret there. */
    marker: 'Suggestion {n:number} of {total:number}, by {name:string}',
  },
  comments: {
    bubble_new: 'New comment',
    bubble_thread: 'Comment thread',
    field: 'Comment',
    comment: 'Comment',
    send_agent: 'Send to agent',
    reply_field: 'Reply',
    reply: 'Reply',
    resolve: 'Resolve',
    reopen: 'Reopen',
    sent_to_agent: 'Sent to the agent',
    answered: 'Answered',
    resolved: 'Resolved',
    marker: 'Comment thread on “{quote:string}”',
    marker_point: 'Comment thread',
    list: 'Comment threads',
    filter: 'Show threads',
    filter_open: 'Open',
    filter_resolved: 'Resolved',
    filter_all: 'All',
    /** A filter's label with its count: “Open 2”. */
    filter_count: '{label:string} {count:number}',
    empty_open: 'No open comments on this note.',
    /** Under the empty state: where the door is. `key` is the binding in force, as this platform prints it. */
    how_with_key: 'Select some text and press {key:string}, or use the comment button on the formatting bar.',
    how: 'Select some text, then use the comment button on the formatting bar.',
    /** The panel's door: runs `note.comment`. */
    door: 'Comment on selection',
    empty_resolved: 'No resolved comments on this note.',
    empty_all: 'No comments on this note yet.',
    no_note: 'Open a note to see its comments.',
    replies: '{count:number} repl{{y|ies}}',
    export: 'Export as CriticMarkup',
    exported: 'Review copy written to {path:string}.',
    export_none: 'No open comments to export.',
    export_skipped: '{count:number} comment{{ was|s were}} left out: the text {{it was|they were}} on is gone, or overlaps another.',
    export_failed: 'Could not write the review copy.',
    select_first: 'Select the text to comment on first.',
    gone: 'The text this thread was on is gone.',
    unavailable: 'Comments need the note open in an editor.',
    thread_not_started: 'Could not send the comment to the agent: a run is already going, or no provider is set up.',
    thread_failed: 'The agent did not answer the comment: {error:string}',
    thread_suggestion: 'Proposed edit',
    thread_suggestion_stale: 'The text changed under this edit.',
    accept: 'Accept',
    reject: 'Reject',
  },
  presence: {
    /** The agent's name on a peer's caret and in the presence stack. */
    label: '{name:string} (agent)',
  },
  commands: {
    new_session: 'New AI session',
    add_selection: 'Add selection to AI session',
    run_skill: 'Run a skill…',
    stop_run: 'Stop the AI run',
    accept_suggestion: 'Accept suggestion',
    reject_suggestion: 'Reject suggestion',
    accept_all: 'Accept all suggestions',
    reject_all: 'Reject all suggestions',
    next_suggestion: 'Next suggestion',
    previous_suggestion: 'Previous suggestion',
    undo_agent: 'Undo the agent’s last edit',
    comment: 'Comment on selection',
    session: 'Open AI session',
  },
}

/**
 * Collections (bases-shaping A3/A4, DB2): a `.base` file opened as a tab —
 * its saved views, the table, the cell editors and the toolbar's verbs.
 */
const collections = {
  /** The tab body's accessible name: "Competitors (collection)". */
  label: '{name:string} (collection)',
  views: 'Views of {name:string}',
  table_caption: '{view:string} — {count:number} row{{s}}',
  count: '{count:number} row{{s}}',
  count_of: '{shown:number} of {total:number} rows',
  new_row: 'New',
  new_row_in: 'New note in {dir:string}',
  columns: 'Columns',
  columns_title: 'Columns of {view:string}',
  column_label: 'Show {name:string}',
  /** The columns popover's first group: the properties the notes on screen hold. */
  columns_in_notes: 'In these notes',
  columns_other: 'Other properties',
  /** A view that writes no `order`: its columns follow the notes until one is changed here. */
  columns_dynamic: 'Showing every property these notes have. Changing one pins the list.',
  group_by: 'Group by',
  group_none: 'No grouping',
  /** The grouping menu's button: "Group by: Threat". */
  group_menu: 'Group by: {name:string}',
  group_empty: 'No value',
  sort_by: 'Sort by {name:string}',
  /** The first column, when the file gives `file.name` no display name. */
  name_column: 'Name',
  open_note: 'Open {name:string}',
  edit_cell: 'Edit {column:string} of {name:string}',
  edit_cell_bool: '{column:string} of {name:string}',
  empty_cell: 'empty',
  /** A part of the view this app does not compute (formulas, map views). */
  partly: 'Partly shown',
  partly_detail: 'Not computed here: {reasons:string}',
  /** A column the view names that this app cannot compute (`formula.x`). */
  column_not_computed: '{name:string} is not computed here',
  no_views: 'This collection has no views yet.',
  add_table: 'Add a table view',
  add_view: 'Add a view',
  /** A view's own menu (the button after the tabs, or a right-click on a tab). */
  view_menu: 'Options for the view {name:string}',
  view_rename: 'Rename…',
  view_delete: 'Delete…',
  rename_title: 'Rename {name:string}',
  rename_label: 'View name',
  /** A rename changes what `![[X.base#View]]` embeds resolve. */
  rename_hint: 'Notes that embed this view by name will need the new name.',
  rename_empty: 'A view needs a name.',
  rename_taken: 'Another view is already called {name:string}.',
  rename_confirm: 'Rename',
  delete_title: 'Delete the view {name:string}?',
  delete_body: 'Only the view goes — its filters, columns and sort. The notes it shows are not touched.',
  delete_confirm: 'Delete view',
  add_view_table: 'Table',
  add_view_board: 'Board',
  add_view_list: 'List',
  /** Default names for views this app adds. */
  view_name_table: 'Table',
  view_name_board: 'Board',
  view_name_list: 'List',
  /** A board with nothing to group by: an empty state whose buttons are the fix. */
  board_needs_group: 'Choose what this board groups by',
  board_group_choices: 'Properties to group by',
  board_group_hint: 'Each value becomes a column; moving a card writes that value into its note.',
  board_group_none: 'These notes have no properties to group by yet. Add one to a note, then come back.',
  /** Embedded (read-mostly): the choice is made in the collection's own tab. */
  board_group_embedded: 'Open the collection to choose one.',
  board_column: '{group:string} — {count:number} note{{s}}',
  board_label: 'Board of {view:string}',
  /** The keyboard's drag: a select on every card. */
  move_card: 'Move {name:string} to…',
  /** A board grouped by a file field (folder, tags): cards cannot be moved by writing a property. */
  not_movable: 'Grouped by {group:string}: move a note by changing it, not from here.',
  list_label: 'List of {view:string}',
  cards_label: 'Cards of {view:string}',
  unreadable: 'This file could not be read as a collection: {error:string}',
  unreadable_hint: 'Fix it in Source (Mod+E).',
  no_rows: 'No notes match this view.',
  not_a_note: "'{path:string}' is not a note.",
  /** The frontmatter patcher refused the note (nested YAML, a multi-line value). */
  not_patched: "'{name:string}' was not changed: its properties are {reason:string} and are edited in the note itself.",
  reason: {
    nested: 'nested',
    multiline: 'multi-line',
    anchor: 'using anchors',
    invalid: 'invalid YAML',
    'duplicate-key': 'using a duplicate key',
    unsupported: 'outside the flat subset',
  },
  mtime_unknown: '—',
  /** The properties form at the top of a row-note (bases-shaping A7). */
  properties_label: 'Properties of {name:string}',
  /** A key in the form: a door into the YAML at that line. */
  property_key: 'Edit {key:string} as YAML',
  /** The form's last control, the keyboard's way into the block. */
  open_yaml: 'Edit as YAML',
  /** An embedded collection view (A6): "Competitors (collection) — Threat Watch". */
  embed_label: '{name:string} (collection) — {view:string}',
  /** The embed's caption, a button opening the collection's own tab. */
  embed_open: 'Open {name:string}',
  /** `![[X.base#View]]` naming a view the file has not got. */
  embed_view_missing: 'No view called {view:string}; showing {shown:string}.',
}

const web = {
  shell,
  notices,
  rail,
  actions,
  breadcrumb,
  status_bar,
  panes,
  tabs,
  groups,
  mode,
  read,
  pill,
  tree,
  tree_op,
  link_follow,
  palette,
  commands,
  daily,
  history,
  log,
  relative_time,
  drawer,
  presence,
  links,
  note,
  shared,
  relay_card,
  manager,
  import_app,
  vault_switcher,
  storage,
  settings,
  share,
  join_page,
  mounts,
  device_link,
  breaker,
  review,
  devtools,
  ui,
  help,
  workspace,
  relay,
  theme,
  layouts,
  keymaps,
  templates,
  resources,
  toolbar,
  attachments,
  ai,
  collections,
} satisfies BaseTranslation

export default web
