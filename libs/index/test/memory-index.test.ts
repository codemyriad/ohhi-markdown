import { MemoryIndex } from '../src/memory-index.js'
import { describeIndexConformance } from './conformance.js'

describeIndexConformance('MemoryIndex', () => new MemoryIndex())
