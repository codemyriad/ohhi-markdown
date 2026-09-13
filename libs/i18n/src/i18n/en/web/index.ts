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
  select_a_file: 'select a file to start editing',
  unnamed_vault: 'Vault',
}

const notices = {
  toast_title: {
    error: 'Something went wrong',
    warn: 'Heads up',
    info: 'Note',
  },
}

const rail = {
  label: 'Sidebar',
  collapse: 'Collapse sidebar',
  expand: 'Expand sidebar',
  sections: {
    links: 'Links',
    note: 'This note',
    activity: 'Activity',
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
  label: 'Current note',
  show_in_navigator: 'Show {path:string} in the file navigator',
  no_note: 'No note open',
}

const status_bar = {
  words: '{count:number} word{{s}}',
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
  /** The strip-end toggle, named for what it will do (Obsidian's pair). */
  to_reading: 'Reading view',
  to_editing: 'Back to editing',
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
  online_title: '{whose:string} · {count:number} online',
  online_sr: '{whose:string}, {count:number} online',
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
    manage_tokens: 'Manage tokens…',
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
  recent: 'recent',
  filename_match: 'filename match',
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
  },
  quick_open: 'Open note…',
  command_palette: 'Command palette',
  search: 'Search in vault',
  new_note: 'New note',
  new_folder: 'New folder',
  delete_note: 'Delete current note…',
  move_note: 'Move current note…',
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
}

/**
 * The History rail section (W3): the pre-image journal, in words. The journal
 * records bytes and a time and nothing else, so the copy claims nothing else
 * — no author, no reason, no "you edited this".
 */
const history = {
  no_note: 'Open a note to see its history.',
  empty: 'No earlier versions yet — Editor saves one every time it writes this file.',
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
    'Obsidian’s daily-note format “{format:string}” uses {tokens:string}, which Editor does not understand yet and prints as written. Today’s note may not be the one Obsidian would open.',
}

const activity = {
  empty: 'Nothing to report this session.',
  open_path: 'Open {path:string}',
  clear: 'Clear',
  devtools: 'Developer tools',
  devtools_hint: '— the sync inspector',
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

const note = {
  no_note: 'No note open.',
  vault: 'Vault',
  sharing: 'Sharing',
  folder: 'Folder',
  online: 'Online',
  online_here: 'Online here',
  access: 'Access',
  vault_root: '(vault root)',
  shared_whole: 'Shared as a whole',
  /**
   * The linked-vault pair (device-link N2). The vault-level line says what
   * the vault IS ("Synced to your devices"); the per-note line says where
   * THIS note lives ("On your devices"). Neither says "shared" — sharing is
   * what you do with other people, folder by folder.
   */
  synced_to_devices: 'Synced to your devices',
  on_your_devices: 'On your devices',
  shared_folders: '{count:number} shared folder{{s}}',
  local_nothing_shared: 'Local vault — nothing shared',
  only_you: 'Only you',
  local_device: 'Local — only on this device',
  shared_by_you: 'Shared by you',
  shared_with_you: 'Shared with you',
  with_host: '{state:string} · {host:string}',
  access_joined: 'Managed by whoever shared it with you.',
  access_root: "The whole vault's links — see Settings.",
  access_needs_secret: 'Set the relay operator secret in Settings to list the links.',
  access_loading: 'Loading links…',
  access_none: 'No links — nobody else can open this yet.',
  read_only: 'read-only',
  access_count:
    '{count:number} link{{s}} — anyone holding one can open this folder. Links, not people: there are no accounts yet.',
  manage_sharing: 'Manage sharing…',
  details: 'Details…',
  share_folder: 'Share this folder…',
  add_share_here: 'Add a shared folder here…',
}

const manager = {
  back: '← Back',
  settings: 'Settings',
  tagline: 'Collaborative markdown over a plain-text vault. Files on disk stay the source of truth.',
  your_name: 'Your name',
  name_placeholder: 'Anonymous',
  name_hint: 'Shown to people you share with.',
  your_vaults: 'Your vaults',
  no_vaults: 'No vaults yet. Add a folder, link a device, or join a share to get started.',
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
    "This browser vault's notes live only in this browser — removing it deletes the notes AND all sync state, shares, and tokens.",
  remove_note_disk:
    'Files on disk are never touched. Sync state, shares, and tokens for this vault are deleted — reopening the folder starts fresh with new share links.',
  vault_error: '{message:string} — fix the folder, or remove this entry (files are untouched).',
  add_vault: 'Add a vault',
  pick_folder: "Pick a folder on disk (use the dialog's New Folder to create a fresh vault).",
  open_folder: 'Open folder as vault…',
  no_opfs:
    "This browser doesn't support the private file storage (OPFS) Editor needs — try a recent Chrome, Edge, or Firefox.",
  browser_vault_hint: 'A new vault stored privately in this browser.',
  vault_name_placeholder: 'Vault name',
  create_vault: 'Create vault',
  join_share: 'Join a share',
  join_hint: 'Paste a share link someone sent you — it opens as a new vault.',
  link_placeholder: 'editor1:…',
  join: 'Join',
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
  },
  general: {
    name: 'Display name',
    name_placeholder: 'Anonymous',
    name_hint: 'Shown to collaborators; applies the next time a vault is opened.',
    name_required: 'A name your collaborators will see.',
    default_mode: 'Default view for new tabs',
    default_mode_hint:
      'Applies to any tab you have not given a view of its own. {key:string} switches one tab between editing and reading.',
  },
  appearance: {
    theme: 'Theme',
    system: 'System',
    theme_help:
      'Applies immediately, to the chrome and the editor alike. {system:string} follows your OS setting. Nord reproduces the Obsidian theme it is named after; the two Editor themes are our own defaults.',
    custom_theme: 'Custom theme',
    custom_placeholder: 'my-theme',
    use_custom: 'Use custom',
    custom_help:
      'Reads {path:string} from the open vault. Start from {template:string}; {import_rule:string} and remote {url:string} are stripped, and the sync-status colours cannot be overridden.',
    needs_vault: 'Open a vault first — custom themes live inside it.',
  },
  /**
   * Settings > Hotkeys (tab-groups R1.3): every registered command, the key
   * in force, and a field to change it. "Mod" is spelled out wherever the
   * user has to type it — it is the one piece of syntax the field requires.
   */
  hotkeys: {
    intro:
      'Every command and the key that runs it. Changes apply immediately and stay on this device.',
    syntax: 'Type a shortcut like {example:string}, or press Record and hit the keys. {mod:string} is Cmd on a Mac and Ctrl everywhere else; leave the field empty to remove the shortcut.',
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
    reserved: 'Your desktop takes this shortcut before Editor can see it.',
  },
  sync: {
    relay: 'Default relay',
    relay_hint: 'Used when creating new shares. Each share remembers its own relay in its link.',
    relay_required: 'The relay new shares are created on.',
    relay_invalid: 'A relay URL starts with ws:// or wss://.',
    secret: 'Relay operator secret',
    secret_placeholder: 'unset',
    secret_hint: 'Lets this app mint, list and revoke share links on your relay.',
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
      "The sync inspector: a per-file view of disk ↔ CRDT state. Also at the foot of the rail's Activity section, or forced for one session with {flag:string}.",
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
  unknown_kind: 'That link was made by a newer version of Editor — update this device first.',
  bad_grant:
    'That link is damaged: one of the shared folders it carries is missing its relay, folder or key. Make a new link on the device that produced it.',
  grants_on_folder_link:
    'That link claims keys for other folders, which only a device link may carry. Do not use it — ask for a new one.',
  incomplete_target: 'This folder has no relay, room or key yet, so no link can be made for it.',
}

const share = {
  link_error,
  add: {
    title: 'Add a shared folder',
    description:
      'Paste a share link and pick where it lives in this vault. The folder must be new or empty — it fills with the shared content and stays in sync alongside your local notes.',
    link: 'Share link',
    link_placeholder: 'editor1:…',
    link_invalid: 'That doesn’t look like a share link — they start with "editor1:".',
    dest: 'Destination folder',
    dest_placeholder: 'e.g. shared/team',
    dest_hint: 'A new folder, or an existing empty one.',
    dest_required: 'Pick a folder for the shared content to live in.',
    joining: 'Joining…',
    join: 'Join into this vault',
  },
  folder: {
    title: 'Share {path:string}',
    is_shared:
      'This folder is shared — everything inside it syncs to anyone holding the link. The rest of the vault stays local.',
    copied: 'Copied!',
    copy: 'Copy',
    carve_help:
      'Sharing carves this folder into its own synced space on {relay:string}: everything inside syncs to anyone holding the link; everything outside stays local to this vault. No files are moved or changed.',
    needs_secret: 'Set the relay operator secret in Settings to create shares in-app.',
    sharing: 'Sharing…',
    share: 'Share this folder',
  },
  unshare: {
    title: "Stop sharing '{path:string}'?",
    body: 'The folder and its files stay in this vault and become local notes. Other people keep the copies they already have, but nothing syncs anymore. Existing access tokens keep working until revoked.',
    confirm: 'Stop sharing',
    revoke: 'Also revoke all access tokens on the relay',
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

const tokens = {
  title: 'Tokens',
  loading: 'loading…',
  none: 'no tokens for this folder',
  read_only: 'read-only',
  revoke: 'revoke',
  label_placeholder: 'label (e.g. laptop, Sam)',
  mint: 'mint',
  revoke_hint: 'Revoking blocks new connections; already-connected peers stay until they reconnect.',
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
    'This file was deleted on disk outside Editor, but its synced content still exists. Restore it, or confirm the deletion — confirming removes it for everyone sharing this folder (a recovery copy is journaled).',
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

const devtools = {
  title: 'Sync devtools',
  no_file: 'no file selected',
  refresh: 'refresh',
  collapse: 'Collapse devtools',
  expand: 'Expand devtools',
  select_file: 'Select a text file to inspect its disk ↔ CRDT state.',
  no_preimages: 'no pre-images yet',
  no_doc_store: 'no doc store',
  never: 'never',
  just_now: 'just now',
  seconds_ago: '{count:number}s ago',
}

const ui = {
  notifications: 'Notifications',
  dismiss_notification: 'Dismiss notification',
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
  activity,
  links,
  note,
  manager,
  vault_switcher,
  settings,
  share,
  mounts,
  device_link,
  tokens,
  breaker,
  review,
  devtools,
  ui,
  workspace,
  relay,
  theme,
} satisfies BaseTranslation

export default web
