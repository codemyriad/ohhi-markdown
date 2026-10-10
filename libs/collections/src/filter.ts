/**
 * The filter statement grammar (bases-shaping S16-Q1): the strings a `.base`
 * file writes — `status == "active"`, `file.hasTag("book")`,
 * `!pillars.isEmpty()`, `verified < today() - "30d"` — compiled into the
 * index's closed `RowFilter` vocabulary.
 *
 * A COMPILER, not an evaluator: the output is data the index (or a SQL
 * backend) runs; nothing here looks at a note. Anything outside the subset
 * throws `UnsupportedFilter` with the statement's own words, and the caller
 * marks the view rather than guessing (R4.4 of the frontmatter reader,
 * applied here).
 *
 * The subset, sized against the measured views (bases-shaping Evidence):
 *   operands   file.<field> · note.<key> · <key> · this.file.<field> · literals
 *              now() · today() · date("…") · <date> ± "<duration>"
 *   compare    == != < <= > >=
 *   boolean    && || ! and parentheses; a bare operand is its truthiness
 *   methods    .contains(x) .containsAny(…) .containsAll(…) .isEmpty()
 *              .startsWith(x) .endsWith(x)
 *   file fns   file.hasTag(…) file.hasLink(x) file.inFolder(x) file.hasProperty(x)
 */
import { isDurationText, type RowExpr, type RowFilter, type RowKey, type RowLiteral } from '@ohhi/index'

export class UnsupportedFilter extends Error {
  constructor(
    readonly statement: string,
    reason: string
  ) {
    super(`${reason} in \`${statement}\``)
    this.name = 'UnsupportedFilter'
  }
}

/** What `this.file.*` means where the collection is shown (Obsidian's rule). */
export interface FilterScope {
  /** The vault path of the file `this` refers to — the `.base` itself, or the embedding note. */
  thisPath?: string
}

// ---- tokens ------------------------------------------------------------------

type Tok =
  | { t: 'str'; v: string }
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'end' }

const OPS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '!', '(', ')', ',', '+', '-', '*', '/', '%', '.']

function tokenize(src: string, statement: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let v = ''
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const e = src[j + 1]
          v += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e
          j += 2
        } else {
          v += src[j++]
        }
      }
      if (j >= src.length) throw new UnsupportedFilter(statement, 'unterminated string')
      out.push({ t: 'str', v })
      i = j + 1
      continue
    }
    const num = /^-?\d+(?:\.\d+)?/.exec(src.slice(i))
    // A `-` is a number's sign only where an operand may start.
    if (num && (c !== '-' || !out.length || out[out.length - 1].t === 'op')) {
      out.push({ t: 'num', v: Number(num[0]) })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_][\w-]*/.exec(src.slice(i))
    if (id) {
      out.push({ t: 'id', v: id[0] })
      i += id[0].length
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (!op) throw new UnsupportedFilter(statement, `unexpected \`${c}\``)
    out.push({ t: 'op', v: op })
    i += op.length
  }
  out.push({ t: 'end' })
  return out
}

// ---- parse -------------------------------------------------------------------

/** An operand before it is known whether it is a value or a condition. */
type Operand =
  | { kind: 'expr'; expr: RowExpr }
  | { kind: 'filter'; filter: RowFilter }
  /** `file` on its own, waiting for `.hasTag(...)`. */
  | { kind: 'file' }
  /** `this` / `this.file`, waiting for a field. */
  | { kind: 'this'; depth: number }

const FILE_FIELDS: Record<string, RowKey> = {
  name: { file: 'name' },
  basename: { file: 'name' },
  path: { file: 'path' },
  folder: { file: 'folder' },
  ext: { file: 'ext' },
  mtime: { file: 'mtime' },
  size: { file: 'size' },
  tags: { file: 'tags' },
  links: { file: 'links' },
}

class Parser {
  private at = 0
  constructor(
    private readonly toks: Tok[],
    private readonly statement: string,
    private readonly scope: FilterScope
  ) {}

  private peek(): Tok {
    return this.toks[this.at]
  }
  private next(): Tok {
    return this.toks[this.at++]
  }
  private isOp(v: string): boolean {
    const t = this.peek()
    return t.t === 'op' && t.v === v
  }
  private take(v: string): boolean {
    if (!this.isOp(v)) return false
    this.at++
    return true
  }
  private fail(reason: string): never {
    throw new UnsupportedFilter(this.statement, reason)
  }

  parse(): RowFilter {
    const f = this.condition(this.or())
    if (this.peek().t !== 'end') this.fail('trailing input')
    return f
  }

  private or(): Operand {
    let left = this.and()
    while (this.take('||')) {
      const right = this.and()
      left = { kind: 'filter', filter: { op: 'or', args: [this.condition(left), this.condition(right)] } }
    }
    return left
  }

  private and(): Operand {
    let left = this.comparison()
    while (this.take('&&')) {
      const right = this.comparison()
      left = { kind: 'filter', filter: { op: 'and', args: [this.condition(left), this.condition(right)] } }
    }
    return left
  }

  private comparison(): Operand {
    const left = this.not()
    for (const cmp of ['==', '!=', '<=', '>=', '<', '>'] as const) {
      if (this.take(cmp)) {
        const right = this.not()
        // `x.isEmpty() == false`: a condition against a boolean literal.
        if ((left.kind === 'filter' || right.kind === 'filter') && (cmp === '==' || cmp === '!=')) {
          const [cond, lit] = left.kind === 'filter' ? [left, right] : [right, left]
          if (lit.kind === 'expr' && 'lit' in lit.expr && typeof lit.expr.lit === 'boolean') {
            const want = lit.expr.lit === (cmp === '==')
            return want ? cond : { kind: 'filter', filter: { op: 'not', arg: this.condition(cond) } }
          }
        }
        return { kind: 'filter', filter: { op: 'cmp', cmp, left: this.value(left), right: this.value(right) } }
      }
    }
    return left
  }

  /** `!` binds tighter than a comparison, as in JavaScript: `!a == "b"` is `(!a) == "b"`, refused. */
  private not(): Operand {
    if (this.take('!')) return { kind: 'filter', filter: { op: 'not', arg: this.condition(this.not()) } }
    return this.additive()
  }

  /** Only a date plus or minus a duration string is arithmetic this subset knows. */
  private additive(): Operand {
    let left = this.postfix()
    while (this.isOp('+') || this.isOp('-')) {
      const sign: 1 | -1 = (this.next() as { v: string }).v === '+' ? 1 : -1
      const right = this.postfix()
      if (right.kind !== 'expr' || !('lit' in right.expr) || typeof right.expr.lit !== 'string') {
        this.fail('arithmetic other than date ± "duration"')
      }
      if (!isDurationText(right.expr.lit)) this.fail(`the duration \`${right.expr.lit}\``)
      left = { kind: 'expr', expr: { dateAdd: this.value(left), duration: right.expr.lit, sign } }
    }
    return left
  }

  private postfix(): Operand {
    let base = this.primary()
    while (this.take('.')) {
      const name = this.next()
      if (name.t !== 'id') this.fail('a name after `.`')
      base = this.member(base, name.v)
    }
    return base
  }

  private member(base: Operand, name: string): Operand {
    if (base.kind === 'this') {
      if (base.depth === 0 && name === 'file') return { kind: 'this', depth: 1 }
      if (base.depth === 1) return { kind: 'expr', expr: { lit: this.thisField(name) } }
      this.fail(`\`this.${name}\``)
    }
    if (base.kind === 'file') {
      if (this.isOp('(')) return { kind: 'filter', filter: this.fileFunction(name) }
      const key = FILE_FIELDS[name]
      if (!key) this.fail(`\`file.${name}\``)
      return { kind: 'expr', expr: { key } }
    }
    if (base.kind === 'expr' && this.isOp('(')) return { kind: 'filter', filter: this.method(base.expr, name) }
    if (base.kind === 'expr' && 'key' in base.expr && 'prop' in base.expr.key && base.expr.key.prop === 'note') {
      // `note.status` — the explicit spelling of a property.
      return { kind: 'expr', expr: { key: { prop: name } } }
    }
    this.fail(`\`.${name}\``)
  }

  private thisField(name: string): RowLiteral {
    const path = this.scope.thisPath
    if (path === undefined) this.fail('`this` with nothing to refer to')
    const slash = path.lastIndexOf('/')
    const file = path.slice(slash + 1)
    switch (name) {
      case 'folder':
        return slash === -1 ? '' : path.slice(0, slash)
      case 'path':
        return path
      case 'name':
      case 'basename':
        return file.replace(/\.[^.]+$/, '')
      case 'ext':
        return file.includes('.') ? file.slice(file.lastIndexOf('.') + 1) : ''
      default:
        this.fail(`\`this.file.${name}\``)
    }
  }

  private args(): Operand[] {
    if (!this.take('(')) this.fail('`(`')
    const out: Operand[] = []
    if (this.take(')')) return out
    do out.push(this.or())
    while (this.take(','))
    if (!this.take(')')) this.fail('`)`')
    return out
  }

  private fileFunction(name: string): RowFilter {
    const args = this.args()
    const strings = (): string[] =>
      args.map((a) => {
        const v = this.value(a)
        if (!('lit' in v) || typeof v.lit !== 'string') this.fail(`\`file.${name}\` takes text`)
        return v.lit
      })
    switch (name) {
      case 'hasTag':
        return { op: 'hasTag', tags: strings() }
      case 'hasLink': {
        const [target] = strings()
        if (target === undefined) this.fail('`file.hasLink` takes a target')
        return { op: 'hasLink', target }
      }
      case 'inFolder': {
        const [folder] = strings()
        if (folder === undefined) this.fail('`file.inFolder` takes a folder')
        return { op: 'inFolder', folder }
      }
      case 'hasProperty': {
        const [key] = strings()
        if (key === undefined) this.fail('`file.hasProperty` takes a key')
        return { op: 'hasProperty', key }
      }
      default:
        this.fail(`\`file.${name}()\``)
    }
  }

  private method(target: RowExpr, name: string): RowFilter {
    const args = this.args().map((a) => this.value(a))
    switch (name) {
      case 'contains':
        if (args.length !== 1) this.fail('`.contains` takes one value')
        return { op: 'contains', target, value: args[0] }
      case 'containsAny':
        return { op: 'containsAny', target, values: args }
      case 'containsAll':
        return { op: 'containsAll', target, values: args }
      case 'isEmpty':
        return { op: 'isEmpty', target }
      case 'startsWith':
        if (args.length !== 1) this.fail('`.startsWith` takes one value')
        return { op: 'startsWith', target, value: args[0] }
      case 'endsWith':
        if (args.length !== 1) this.fail('`.endsWith` takes one value')
        return { op: 'endsWith', target, value: args[0] }
      default:
        this.fail(`\`.${name}()\``)
    }
  }

  private primary(): Operand {
    const t = this.next()
    if (t.t === 'str') return { kind: 'expr', expr: { lit: t.v } }
    if (t.t === 'num') return { kind: 'expr', expr: { lit: t.v } }
    if (t.t === 'op' && t.v === '(') {
      const inner = this.or()
      if (!this.take(')')) this.fail('`)`')
      return inner
    }
    if (t.t !== 'id') this.fail('an operand')
    switch (t.v) {
      case 'true':
        return { kind: 'expr', expr: { lit: true } }
      case 'false':
        return { kind: 'expr', expr: { lit: false } }
      case 'null':
        return { kind: 'expr', expr: { lit: null } }
      case 'file':
        return { kind: 'file' }
      case 'this':
        return { kind: 'this', depth: 0 }
      case 'note':
        return { kind: 'expr', expr: { key: { prop: 'note' } } }
      case 'now':
      case 'today': {
        if (!this.take('(') || !this.take(')')) this.fail(`\`${t.v}()\``)
        return { kind: 'expr', expr: { now: t.v } }
      }
      case 'date': {
        const [arg] = this.args()
        const v = arg ? this.value(arg) : null
        if (!v || !('lit' in v) || typeof v.lit !== 'string') this.fail('`date()` takes a text literal')
        return { kind: 'expr', expr: { lit: v.lit } }
      }
      case 'formula':
        this.fail('formulas')
    }
    if (this.isOp('(')) this.fail(`\`${t.v}()\``)
    return { kind: 'expr', expr: { key: { prop: t.v } } }
  }

  /** An operand where a condition is expected: a bare value is its truthiness. */
  private condition(o: Operand): RowFilter {
    if (o.kind === 'filter') return o.filter
    if (o.kind === 'expr') return { op: 'truthy', arg: o.expr }
    this.fail(o.kind === 'file' ? '`file` on its own' : '`this` on its own')
  }

  /** An operand where a value is expected. */
  private value(o: Operand): RowExpr {
    if (o.kind === 'expr') return o.expr
    this.fail(o.kind === 'filter' ? 'a condition where a value was expected' : `\`${o.kind}\` on its own`)
  }
}

/** Compile one statement. Throws `UnsupportedFilter` outside the subset. */
export function compileStatement(statement: string, scope: FilterScope = {}): RowFilter {
  const text = statement.trim()
  if (!text) throw new UnsupportedFilter(statement, 'empty statement')
  return new Parser(tokenize(text, statement), statement, scope).parse()
}
