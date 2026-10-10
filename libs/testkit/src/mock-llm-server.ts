/**
 * The scripted LLM of `mock-llm.ts` behind `node:http`, for the e2e (the
 * webview's real `fetch` talks to it) and for `ohhi ask`'s tests. Node-only:
 * import it from `@ohhi/testkit/src/node`, never from the package root, which
 * the browser bundle may reach.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mockLlmFetch, type MockLlmOptions, type MockRequest, type MockTurn } from './mock-llm.js'

export interface MockLlmServer {
  /** `http://127.0.0.1:<port>` — append `/v1` for an OpenAI-shaped base URL. */
  url: string
  port: number
  readonly requests: MockRequest[]
  remaining(): number
  close(): Promise<void>
}

/** Serve `script` on `port` (0 = any free port) on 127.0.0.1, with permissive CORS. */
export async function startMockLlm(opts: { port?: number; script: MockTurn[] } & MockLlmOptions): Promise<MockLlmServer> {
  const mock = mockLlmFetch(opts.script, opts)
  const server = createServer((req, res) => void handle(req, res))

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
    const answer = await mock(`http://${req.headers.host ?? '127.0.0.1'}${req.url ?? '/'}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
    })
    res.writeHead(answer.status, { ...Object.fromEntries(answer.headers.entries()), ...cors })
    if (answer.body) for await (const c of answer.body as unknown as AsyncIterable<Uint8Array>) res.write(c)
    res.end()
  }

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests: mock.requests,
    remaining: mock.remaining,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
        server.closeAllConnections()
      }),
  }
}
