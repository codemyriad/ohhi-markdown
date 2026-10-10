/**
 * The icon each command a bar may draw is drawn with, keyed by command id:
 * the format bar (`bars.format`, `FormatBar.svelte`), Settings › Layout's
 * picker (`FormatBarPicker`) and the tab strip's end (`bars.tabs`,
 * `StripCommands.svelte`) read this one table, so a button and its pill
 * always look alike. A command id with no icon here is not a bar button.
 */
import {
  Bold,
  Brackets,
  Code,
  Columns2,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image,
  Italic,
  Link,
  List,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  ListTodo,
  Maximize2,
  MessageSquareWarning,
  Minus,
  Pilcrow,
  Rows2,
  SquareCode,
  SquareSplitHorizontal,
  Strikethrough,
  Table,
  TextQuote,
  X,
  type LucideIcon,
} from '@lucide/svelte'

export const COMMAND_ICONS: Readonly<Record<string, LucideIcon>> = {
  'format.bold': Bold,
  'format.italic': Italic,
  'format.strike': Strikethrough,
  'format.highlight': Highlighter,
  'format.code': Code,
  'format.heading-1': Heading1,
  'format.heading-2': Heading2,
  'format.heading-3': Heading3,
  'format.paragraph': Pilcrow,
  'format.list': List,
  'format.ordered-list': ListOrdered,
  'format.task': ListTodo,
  'format.indent': ListIndentIncrease,
  'format.outdent': ListIndentDecrease,
  'format.quote': TextQuote,
  'format.callout': MessageSquareWarning,
  'format.code-block': SquareCode,
  'format.link': Link,
  'format.wikilink': Brackets,
  'format.table': Table,
  'format.image': Image,
  'format.rule': Minus,
  'workspace.split-right': Columns2,
  'workspace.split-down': Rows2,
  'workspace.split-auto': SquareSplitHorizontal,
  'workspace.zoom': Maximize2,
  'workspace.close-pane': X,
}

/** The grouped paragraph-style entry (`TOOLBAR_ITEM_IDS`) draws as a heading glyph. */
export const PARAGRAPH_STYLE_ICON: LucideIcon = Heading
