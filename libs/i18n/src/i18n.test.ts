import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getLL } from './index.js'
import en from './i18n/en/index.js'
import web from './i18n/en/web/index.js'
import { setLocale } from './i18n/i18n-svelte.js'
import { i18nObject, locales, namespaces } from './i18n/i18n-util.js'
import { loadLocale } from './i18n/i18n-util.sync.js'

const here = dirname(fileURLToPath(import.meta.url))

/** Every leaf `key.path` of a dictionary, with its text. */
function leaves(node: unknown, prefix = ''): [string, unknown][] {
  if (typeof node !== 'object' || node === null) return [[prefix, node]]
  return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
}

describe('the base dictionary', () => {
  it('is English-only for now, with the shell in the `web` namespace', () => {
    expect(locales).toEqual(['en'])
    expect(namespaces).toEqual(['web'])
  })

  it('has a non-empty string at every leaf', () => {
    for (const [path, text] of [...leaves(en), ...leaves({ web })]) {
      expect(typeof text, `${path} is not a string`).toBe('string')
      expect((text as string).length, `${path} is empty`).toBeGreaterThan(0)
    }
  })

  it('uses only typed arguments, so a call site cannot pass the wrong shape', () => {
    // `{name}` without a type is legal typesafe-i18n but types the arg as
    // `unknown`; the convention here (as in Edible's newer keys) is `{name:string}`.
    // Plurals (`{{s}}`, `{{one|many}}`) are not arguments.
    const untyped = /(?<!\{)\{[a-z_]+\}(?!\})/
    for (const [path, text] of [...leaves(en), ...leaves({ web })]) {
      expect(text as string, `${path} has an untyped argument`).not.toMatch(untyped)
    }
  })

  it('is what the generated types describe — regenerate with `rushx generate` when this fails', () => {
    const types = readFileSync(join(here, 'i18n', 'i18n-types.ts'), 'utf8')
    // Every group of the namespace is a nested type; a group added to the
    // dictionary without regenerating is the mistake this catches.
    for (const group of Object.keys(web)) {
      expect(types, `web.${group} is missing from i18n-types.ts`).toMatch(new RegExp(`^\\t${group}: \\{`, 'm'))
    }
    for (const group of Object.keys(en)) {
      expect(types, `${group} is missing from i18n-types.ts`).toMatch(new RegExp(`^\\t${group}: \\{`, 'm'))
    }
  })
})

describe('the runtime', () => {
  it('translates through i18nObject once the locale is loaded (the unit-test pattern)', () => {
    loadLocale('en')
    const t = i18nObject('en')
    expect(t.common.cancel()).toBe('Cancel')
    expect(t.web.status_bar.words({ count: 1 })).toBe('1 word')
    expect(t.web.status_bar.words({ count: 5 })).toBe('5 words')
    expect(t.web.tree.drop.already_there({ name: 'ideas.md' })).toBe("'ideas.md' is already there")
  })

  it('getLL() reads the Svelte store, for modules that cannot $LL', () => {
    loadLocale('en')
    setLocale('en')
    expect(getLL().web.breadcrumb.no_note()).toBe('No note open')
  })
})
