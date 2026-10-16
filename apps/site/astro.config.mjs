// @ts-check
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'astro/config'

// The landing page at https://ohhi.md. Static, no client script: every page
// is one .html file, so /download keeps working on any static host.
export default defineConfig({
  site: 'https://ohhi.md',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file',
    // Stylesheets stay files, so public/_headers can say `style-src 'self'`.
    inlineStylesheets: 'never',
  },
  vite: {
    server: {
      // The bundled faces live in libs/ui/fonts/ and fonts.css names them
      // with relative url()s; `astro dev` serves them as /@fs/<realpath>,
      // which needs the folder allowed (apps/web/vite.config.ts does the
      // same). A build is unaffected: Vite emits the files as assets.
      fs: { allow: ['.', fileURLToPath(new URL('../../libs/ui/fonts', import.meta.url))] },
    },
  },
})
