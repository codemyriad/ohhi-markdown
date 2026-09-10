import { describe, expect, it } from 'vitest'
import { escapeHtml } from './html.js'

describe('escapeHtml', () => {
  it('neutralises markup and quotes so a config value cannot inject into an {@html} sentence', () => {
    expect(escapeHtml('ws://relay.example.com')).toBe('ws://relay.example.com')
    expect(escapeHtml('<img src=x onerror="x()">')).toBe('&lt;img src=x onerror=&quot;x()&quot;&gt;')
    expect(escapeHtml("a & b's")).toBe('a &amp; b&#39;s')
  })
})
