/**
 * The ExApp's registered script on AppAPI's embedded page
 * (`/apps/app_api/embedded/ohhi/app`) — nextcloud-build decision 1. Built by
 * `vite.embed.config.ts` into `dist-embed/embed.js`, ONE classic IIFE with no
 * `import()` (`scripts/assert-embed-single-bundle.mjs` checks): the page's CSP
 * nonce covers this script and nothing it could load. It fills the innermost
 * `#content` with an iframe of the web build and does nothing else.
 */
import { mountFrame } from './lib/nextcloud/embed-frame.js'

function run(): void {
  mountFrame(document, location.search)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true })
else run()
