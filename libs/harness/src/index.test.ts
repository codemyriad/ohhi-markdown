import { describe, expect, it } from 'vitest'
import { createHarnessAgent, createModel, renderRefs, systemPrompt, toolsFromContract } from './index.js'

// Wave 0 scaffold: the runtime API exists (dependants type-check) and says
// plainly that it is not built yet. Builder A replaces this file's subject.
describe('@ohhi/harness scaffold', () => {
  it('every runtime stub throws "not built"', () => {
    const stubs: Array<() => unknown> = [
      () => createModel({ id: 'p', name: 'P', kind: 'openai', baseUrl: '', model: 'm' }, fetch),
      () => toolsFromContract({} as never, { mutates: false }),
      () => systemPrompt({ skills: [], refs: [] }),
      () => renderRefs([]),
      () => createHarnessAgent({} as never, {} as never),
    ]
    for (const stub of stubs) expect(stub).toThrow('not built: wave 1 A')
  })
})
