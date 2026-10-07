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
  connecting: 'connecting…',
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
  escape: 'Esc',
  leave: 'leave',
  done: 'done',
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
  /** The accessible name of a checkbox whose task has no text yet. */
  task: 'Task',
  /** The dim count beside the collapsed strip's chips. */
  properties: '{count:number} propert{{y|ies}}',
  /** Shown instead of chips when the YAML is outside the patchable subset. */
  frontmatter_unsupported: 'Unsupported frontmatter',
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
  vault_root: '(vault root)',
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

const palette = {
  no_matches: 'No matches',
  quick_open: { placeholder: 'Open a note…', empty: 'No note matches' },
  command: { placeholder: 'Run a command…', empty: 'No command matches' },
  search: { placeholder: 'Search the vault…   (tag:#x, path:folder/)', empty: 'Nothing found' },
  /** `template.insert` (quiet-shell F11): the first word picks, the rest are arguments. */
  templates: { placeholder: 'Insert a template…   (name, then its arguments)', empty: 'No template matches' },
  /** `layout.use-file` (round 3, Q6): the vault's `.ohhi/layouts/*.json` and the built-in. */
  layouts: { placeholder: 'Use a layout file…', empty: 'No layout file matches', builtin: 'Default', in_use: 'in use' },
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
    templates: 'Templates',
  },
  /**
   * The `format.*` rows (quiet-shell F4): one per entry of `FORMAT_COMMANDS`
   * in @ohhi/editor, keyed by the id after `format.` with `-` as `_`.
   */
  format: {
    bold: 'Bold',
    italic: 'Italic',
    strike: 'Strikethrough',
    code: 'Inline code',
    heading_1: 'Heading 1',
    heading_2: 'Heading 2',
    heading_3: 'Heading 3',
    paragraph: 'Paragraph',
    list: 'Bulleted list',
    ordered_list: 'Numbered list',
    task: 'Task list',
    quote: 'Quote',
    link: 'Insert link',
    wikilink: 'Insert wikilink',
    table: 'Insert table',
    image: 'Insert image',
  },
  quick_open: 'Open note…',
  command_palette: 'Command palette',
  search: 'Search in vault',
  new_note: 'New note',
  new_folder: 'New folder',
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
    title: 'Relay',
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
    change: 'Change relay…',
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
    needs_secret: 'Set the relay operator secret in Settings › Sync to list your linked devices.',
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
    no_relay: 'No relay configured. You will choose one the first time you share.',
    relay_is: 'Shares go through {host:string}.',
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
  back: '← Back',
  settings: 'Settings',
  tagline: 'Collaborative markdown over a plain-text vault. Files on disk stay the source of truth.',
  your_name: 'Your name',
  name_placeholder: 'Anonymous',
  name_hint: 'Shown to people you share with.',
  your_vaults: 'Your vaults',
  no_vaults: 'No vaults yet. Add a folder, link a device, or add a shared folder to get started.',
  /**
   * A vault entry with a relay: since N2 that means LINKED to your own
   * devices (the legacy whole-vault join reads the same way, and it is).
   */
  linked_badge: 'linked',
  browser_vault: 'browser vault',
  memory_vault: 'memory',
  remove: 'Remove {name:string} from this list',
  row_menu: 'More actions for {name:string}',
  remove_item: 'Remove from this list',
  remove_confirm: 'Remove?',
  remove_note_opfs:
    "This browser vault's notes live only in this browser — removing it deletes the notes AND all sync state, shares, and links.",
  remove_note_disk:
    'Files on disk are never touched. Sync state, shares, and links for this vault are deleted — reopening the folder starts fresh with new share links.',
  vault_error: '{message:string} — fix the folder, or remove this entry (files are untouched).',
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
  errors: {
    // A link that will not decode is named by `share.link_error.*` now — one
    // reason per way a link can be unusable, not one word for all of them.
    forget_partial:
      'Vault forgotten, but some of its sync state could not be deleted ({message:string}). The leftovers are inert — reopening the folder still starts fresh.',
  },
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
    "This browser may clear this site's storage, and notes outside a shared folder exist only here — for your own notes, use the desktop app. Settings › Vaults & shares can ask the browser again or turn this reminder off.",
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
  tabs: {
    general: 'General',
    appearance: 'Appearance',
    hotkeys: 'Hotkeys',
    sync: 'Sync',
    vaults: 'Vaults & shares',
    developer: 'Developer',
    layout: 'Layout',
  },
  general: {
    name: 'Display name',
    name_placeholder: 'Anonymous',
    name_hint: 'Shown to collaborators; applies the next time a vault is opened.',
    name_required: 'A name your collaborators will see.',
    default_mode: 'Default view for new tabs',
    default_mode_hint:
      'Applies to any tab you have not given a view of its own. {key:string} switches one tab between editing and reading.',
    version: 'Version {version:string}',
  },
  appearance: {
    theme: 'Theme',
    system: 'System',
    theme_help:
      'Applies immediately, to the chrome and the editor alike. {system:string} follows your OS setting. Nord reproduces the Obsidian theme it is named after; the two Oh hi markdown themes are our own defaults.',
    custom_theme: 'Custom theme',
    custom_placeholder: 'my-theme',
    use_custom: 'Use custom',
    custom_help:
      'Reads {path:string} from the open vault. Start from {template:string}; {import_rule:string} and remote {url:string} are stripped, and the sync-status colours cannot be overridden.',
    needs_vault: 'Open a vault first — custom themes live inside it.',
  },
  /**
   * Settings > Layout (round 3, Q6): ONE form over this device's layout
   * overrides, applied live under the dialog — no names, no files, no Save.
   * Each field is `<field>` and its values `<field>_<value>`.
   */
  layout: {
    intro: 'What the shell shows around the note. Changes apply at once and stay on this device.',
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
  },
  /**
   * Settings > Hotkeys (tab-groups R1.3): every registered command, the key
   * in force, and a field to change it. "Mod" is spelled out wherever the
   * user has to type it — it is the one piece of syntax the field requires.
   */
  hotkeys: {
    intro:
      'Every command and the key that runs it, from the keymap in use. Save writes the keymap file, so your keys travel with the vault.',
    syntax: 'Type a shortcut like {example:string}, or press Record and hit the keys. {mod:string} is Cmd on a Mac and Ctrl everywhere else; separate several shortcuts with a comma, and leave the field empty to remove the shortcut.',
    /** The active keymap file (quiet-shell F10) and how it is saved. */
    keymap: 'Keymap',
    from_builtin: 'Built in · read-only — change a shortcut, then Save as to write your own',
    from_vault: 'This vault · {path:string}',
    from_user: 'Your config folder · {path:string} · read-only here — Save as writes a copy into the vault',
    legacy: 'Shortcuts kept on this device — open a vault and they move into a keymap file there.',
    fallback: 'The keymap could not be used, so the default keys are in force: {error:string}',
    cannot_save_fallback:
      'Nothing can be saved over a keymap that could not be used — fix its file, or pick another keymap first.',
    builtin_name:
      'This vault file is named like the built-in “{name:string}”, so it is read here but never written — Save as under another name.',
    save: 'Save',
    save_as: 'Save as',
    name_placeholder: 'mine',
    saved: 'Wrote {path:string}',
    unsaved: 'Unsaved changes',
    discard: 'Discard',
    needs_vault: 'Open a vault to save a keymap — it is a file inside it.',
    ungrouped: 'Other',
    none: 'No commands are registered yet.',
    unbound: 'No shortcut',
    shortcut_for: 'Shortcut for {command:string}',
    placeholder: 'Mod+Shift+P',
    invalid: 'Not a shortcut — use modifiers and one key, like {example:string}.',
    default_is: 'Default: {binding:string}',
    default_none: 'No default shortcut',
    record: 'Record',
    record_for: 'Record a shortcut for {command:string}',
    recording: 'Press the keys…',
    stop_recording: 'Stop recording {command:string}',
    reset: 'Reset',
    reset_for: 'Reset {command:string} to its default shortcut',
    conflict: 'Also runs {commands:string} — only the last one registered wins.',
    reserved: 'Your desktop takes this shortcut before Oh hi markdown can see it.',
  },
  sync: {
    relay: 'Default relay',
    relay_hint: 'Used when creating new shares. Each share remembers its own relay in its link.',
    relay_required: 'The relay new shares are created on.',
    relay_invalid: 'A relay URL starts with ws:// or wss://.',
    secret: 'Relay operator secret',
    secret_placeholder: 'unset',
    secret_hint: 'Lets this app create, list and remove share links on your relay.',
  },
  vaults: {
    vaults: 'Vaults',
    none: 'No vaults remembered.',
    forget_vault: 'Forget vault {name:string}',
    forget: 'forget',
    forget_hint: 'Forgetting a vault never touches its files.',
    shares: 'Remembered shares',
    no_shares: 'No shares remembered.',
    forget_share: 'Forget share {label:string}',
  },
  developer: {
    devtools: 'Developer tools',
    devtools_help:
      "Enables the inspector — a tab showing the disk ↔ CRDT state of every mount and file — in the command palette. {flag:string} forces it on and opens it for one session.",
  },
  unsaved: 'You have unsaved changes.',
  discard: 'Discard',
  save_and_close: 'Save and close',
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
    link_placeholder: 'editor1:…',
    link_invalid: 'That doesn’t look like a share link — they start with "editor1:".',
    from_host: 'A shared folder on {host:string}. Its name and contents arrive once you add it.',
    where: 'Where it goes',
    into_vault: 'Inside {vault:string}',
    into_a_vault: 'Inside a vault',
    into_vault_hint: 'Beside your notes, and searchable with them.',
    into_vault_unavailable: 'Open a vault first to add a folder inside it.',
    own_vault: 'As its own vault',
    own_vault_hint: 'Kept apart; switch to it from the vault menu.',
    dest: 'Folder',
    dest_placeholder: 'e.g. shared/team',
    dest_hint: 'A new folder, or an existing empty one. A top-level name keeps it beside your notes.',
    dest_required: 'Pick a folder for the shared content to live in.',
    trust:
      'Whoever sent this link can see everything you put in the folder. The link does not say who they are, so check it came from the person you think.',
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
    where_title: 'Where should it sync?',
    relay: 'Relay',
    secret: 'Operator secret',
    secret_required: 'The relay’s operator secret is needed to create links on it.',
    where_hint:
      'The secret lets this app create links on your team’s relay; ask whoever runs it. Both are remembered in Settings › Sync.',
    save_where: 'Save',
    share: 'Share and copy link',
    sharing: 'Sharing…',
    shared_copied: 'Shared. The link is on your clipboard — send it to whoever should have it.',
    shared_not_copied: 'Shared. Copy a link below and send it to whoever should have it.',
    links: 'Links · {count:number}',
    links_loading: 'Loading links…',
    links_none: 'No links yet — nobody else can open this folder.',
    links_need_secret: 'Add the relay’s operator secret to see, create and remove this folder’s links.',
    this_link: 'This folder’s link',
    unnamed: 'Unnamed link',
    read_only: 'read-only',
    created: 'created {date:string}',
    copy_link: 'Copy link',
    copy_link_for: 'Copy link for {name:string}',
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
  needs_secret: 'Set the relay operator secret above to create device links.',
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
  /** The `inspector` readout: the toolbar's bug icon, shown while developer tools are on. */
  open: 'Open the inspector',
  title: 'Inspector',
  refresh: 'Refresh',
  scope: 'Scope',
  all_mounts: 'All mounts',
  root_mount: 'root',
  invariants_ok: 'invariants hold',
  invariants_failed: '{count:number} invariant violation{{s}}',
  no_desc: 'no mounts.json row',
  never_held: 'never held',
  orphans: 'LCA orphans',
  filter_prefix: 'Path prefix',
  filter_state: 'State',
  state_any: 'any state',
  states: {
    in_sync: 'in sync',
    doc_ahead: 'doc ahead',
    disk_changed: 'disk changed',
    diverged: 'diverged',
    no_lca: 'no LCA',
    no_doc: 'no doc',
    not_text: 'not text',
  },
  rows: '{shown:number} of {total:number} row{{s}}',
  no_rows: 'No rows match.',
  col: {
    path: 'path',
    kind: 'kind',
    state: 'state',
    disk: 'disk',
    lca: 'lca',
    doc: 'doc',
    relay: 'relay',
    journal: 'journal',
    open: 'open',
  },
  legend: {
    equal: 'equal',
    differs: 'differs',
    unknown: 'not known',
    synced: 'synced',
    pending: 'not yet',
    offline: 'offline',
    none: 'no relay',
  },
  peek: {
    show: 'Show',
    doc_lca: 'doc vs lca',
    disk_lca: 'disk vs lca',
    disk_doc: 'disk vs doc',
    disk: 'disk text',
    lca: 'lca text',
    doc: 'doc text',
    absent: '(absent)',
    identical: 'identical',
    too_large: 'too large to diff here',
    raw: 'raw hashes and heads',
  },
  select_row: 'Select a text row to inspect its disk ↔ CRDT state.',
  no_preimages: 'no pre-images yet',
  no_doc_store: 'no doc store',
  never: 'never',
  just_now: 'just now',
  seconds_ago: '{count:number}s ago',
}

const ui = {
  notifications: 'Notifications',
  dismiss_notification: 'Dismiss notification',
  update_ready: 'Update installed',
  update_ready_body: 'Version {version:string} is ready. Restart to start using it.',
  restart: 'Restart',
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
  needs_secret: 'set the relay operator secret in Settings to create shares in-app',
  already_joined: 'this share is already part of this vault',
  not_shared: "'{path:string}' is not a shared folder",
  cannot_read: 'cannot read {path:string}',
  cross_mount_move: 'moving across shared-folder boundaries needs the move confirmation',
}

const relay = {
  unreachable: 'relay unreachable at {url:string} — is it running?',
  bad_secret: 'relay rejected the operator secret — check Settings',
  no_admin: 'this relay has no admin API enabled (OPERATOR_SECRET unset)',
  failed: 'relay admin call failed ({status:number})',
}

/** Layout files (quiet-shell F8): what the loader says when one cannot be used. */
/** Keymaps as files (quiet-shell F10). */
const keymaps = {
  invalid: 'The keymap "{name:string}" could not be used, so the default keys are in force: {error:string}',
  not_found: 'No keymap named "{name:string}" in this vault, your config folder or the built-ins.',
  needs_vault: 'Open a vault first — a saved keymap is a file inside it.',
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
  manager,
  vault_switcher,
  storage,
  settings,
  share,
  mounts,
  device_link,
  breaker,
  review,
  devtools,
  ui,
  workspace,
  relay,
  theme,
  layouts,
  keymaps,
  templates,
  toolbar,
} satisfies BaseTranslation

export default web
