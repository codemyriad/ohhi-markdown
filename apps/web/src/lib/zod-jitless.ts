/**
 * zod without `eval`, before any schema exists.
 *
 * The Content Security Policy forbids eval (`public/_headers`, the desktop's
 * policy; docs/desktop-builds.md). zod 4 compiles a fast path for object
 * schemas with `new Function`, and decides whether it may when each object
 * schema is CONSTRUCTED — probing `new Function('')`, which a strict policy
 * blocks and Firefox reports as a CSP violation even though zod catches it.
 * `jitless` skips the probe and the compile, but only for schemas built after
 * it is set, and schemas are built when their modules load. So this is a
 * module of its own, imported FIRST by `main.ts`: an import is evaluated
 * before the importing module's body, so a `z.config` call in `main.ts`
 * itself ran after every schema module had already loaded.
 */
import { z } from 'zod'

z.config({ jitless: true })
