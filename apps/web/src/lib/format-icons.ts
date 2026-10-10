/**
 * The icon each format-bar entry is drawn with (`bars.format`): the bar
 * (`FormatBar.svelte`) and Settings › Layout's picker (`FormatBarPicker`)
 * read the same table, so a button and its pill always look alike. A
 * command id with no icon here is not a format button.
 */
import {
  Bold,
  Brackets,
  Code,
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
  MessageSquareWarning,
  Minus,
  Pilcrow,
  SquareCode,
  Strikethrough,
  Table,
  TextQuote,
  type LucideIcon,
} from '@lucide/svelte'

export const FORMAT_ICONS: Readonly<Record<string, LucideIcon>> = {
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
}

/** The grouped paragraph-style entry (`TOOLBAR_ITEM_IDS`) draws as a heading glyph. */
export const PARAGRAPH_STYLE_ICON: LucideIcon = Heading
