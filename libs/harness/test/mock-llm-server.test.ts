/**
 * The mock LLM behind `node:http` (`@ohhi/testkit/src/node`) — the e2e's
 * route: the real global `fetch`, a real socket, the same script format.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startMockLlm, type MockLlmServer } from '@ohhi/testkit/src/node'
import { createHarnessAgent } from '../src/agent.js'
import { testConnection } from '../src/model.js'
import { ask, drain, harness, hostOf, ORIGIN, providerOf, type Harness } from './helpers.js'

let h: Harness
let server: MockLlmServer | undefined
beforeEach(async () => {
  h = await harness()
})
afterEach(async () => {
  await server?.close()
  server = undefined
  await h.cleanup()
})

describe('startMockLlm', () => {
  it('serves a scripted tool loop over HTTP to the real fetch', async () => {
    server = await startMockLlm({
      script: [{ toolCall: { name: 'ohhi_read', args: { path: 'Areas/CS/JSON.md' } } }, { text: 'JSON is a data format.' }],
    })
    const provider = providerOf('openai-compatible', { baseUrl: `${server.url}/v1`, apiKey: undefined })
    const agent = createHarnessAgent(hostOf(h, fetch), { provider, refs: [], mutates: false, origin: ORIGIN })
    const out = await drain(await agent.stream(ask('What is JSON?'), {}))
    expect(out.text).toBe('JSON is a data format.')
    expect(server.requests[1].toolResults[0].output).toContain('A tiny note.')
    expect(server.remaining()).toBe(0)
  })

  it('answers GET /models and a CORS preflight, as a browser would ask', async () => {
    server = await startMockLlm({ script: [], models: ['llama3'] })
    expect(await testConnection(providerOf('openai-compatible', { baseUrl: `${server.url}/v1` }), fetch)).toEqual({ models: ['llama3'] })
    const pre = await fetch(`${server.url}/v1/chat/completions`, { method: 'OPTIONS' })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('speaks the Anthropic wire too', async () => {
    server = await startMockLlm({ script: [{ text: 'hello' }] })
    const agent = createHarnessAgent(hostOf(h, fetch), { provider: providerOf('anthropic', { baseUrl: server.url }), refs: [], mutates: false, origin: ORIGIN })
    expect((await drain(await agent.stream(ask('hi'), {}))).text).toBe('hello')
    expect(server.requests[0].url).toBe(`${server.url}/v1/messages`)
  })
})
