/**
 * `@ohhi/testkit/src/node` — the Node-only half of the testkit. The package
 * root stays browser-reachable; anything that needs `node:*` is exported here.
 */
export { startMockLlm, type MockLlmServer } from './mock-llm-server.js'
