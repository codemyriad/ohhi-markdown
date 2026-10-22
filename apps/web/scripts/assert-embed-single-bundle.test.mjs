// The embed bundle gate (nextcloud-build decision 1): what counts as "not one classic script".
import { describe, expect, it } from 'vitest'
import { problemsOf } from './assert-embed-single-bundle.mjs'

describe('assert-embed-single-bundle', () => {
  it('passes a classic IIFE', () => {
    expect(problemsOf('(function(){"use strict";const a="import(";document.body})();')).toEqual(['a dynamic import()'])
    expect(problemsOf('(function(){"use strict";var x=1})();')).toEqual([])
  })

  it('flags a dynamic import, an import statement and an export', () => {
    expect(problemsOf('(function(){import("./x.js")})()')).toContain('a dynamic import()')
    expect(problemsOf('import { a } from "./a.js";\na()')).toContain('a top-level import statement')
    expect(problemsOf('const a=1;export { a }')).toContain('an export statement')
  })
})
