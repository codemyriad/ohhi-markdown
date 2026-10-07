import { describe, expect, it } from 'vitest'
import { isAccessRefused, samePath } from './fs-access.js'

describe('isAccessRefused', () => {
  it("reads the fs plugin's refusal, release and debug wording, string or Error", () => {
    expect(isAccessRefused('forbidden path: /home/chris/vault')).toBe(true)
    expect(
      isAccessRefused(
        new Error('forbidden path: /x, maybe it is not allowed on the scope for `allow-read-dir` permission'),
      ),
    ).toBe(true)
    expect(isAccessRefused(new Error('No such file or directory (os error 2)'))).toBe(false)
  })
})

describe('samePath', () => {
  it('ignores a trailing separator and nothing else', () => {
    expect(samePath('/home/chris/vault/', '/home/chris/vault')).toBe(true)
    expect(samePath('/home/chris/vault', '/home/chris/Vault')).toBe(false)
    expect(samePath('/', '/')).toBe(true)
  })
})
