import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * The id every artifact of one build carries.
 *
 * The workflow passes the run and the attempt, so re-deploying the same commit
 * still produces a new id — and that is the case that matters most, since a
 * redeploy of unchanged source is exactly when a cached document looks current
 * and is not. A build with no run to name falls back to the clock, which is
 * distinct enough for a local `vite preview`.
 */
const BUILD_ID = process.env.BUILD_ID?.trim() || String(Date.now())

/**
 * Stamp this build's id into the document, and publish it beside the document.
 *
 * Vite hashes everything under `assets/`, so a visitor who loads this HTML runs
 * this build's JS and CSS: the document is the only sticky artifact, and GitHub
 * Pages serves it from a CDN for minutes with no header configuration to turn
 * that off. The page therefore has to notice on its own that it is the old one.
 * The meta tag is what it reads about itself, `version.json` is what it reads
 * about the deployment, and `src/ops/freshness.ts` is the half of the mechanism
 * that runs in the browser.
 *
 * The `Cache-Control` meta is advisory — most browsers ignore an http-equiv
 * cache directive on a document that arrived over HTTP — and it is here for the
 * proxy that still honours it, at the cost of one line.
 */
function stampBuild(): Plugin {
  return {
    name: 'naming-things:stamp-build',
    // Appended rather than prepended, so the charset declaration keeps the
    // first line of the head where a parser wants to find it.
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { name: 'build-id', content: BUILD_ID },
          injectTo: 'head',
        },
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Cache-Control', content: 'no-cache, must-revalidate' },
          injectTo: 'head',
        },
      ]
    },
    generateBundle() {
      // Unhashed on purpose: the page asks for this file by name, and a name
      // that changed with the build would be a name the old document cannot ask
      // for. Freshness comes from the query the ask carries, not from the path.
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ build: BUILD_ID })}\n`,
      })
    },
  }
}

export default defineConfig({
  base: '/naming-things/',
  plugins: [stampBuild()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'worker/test/**/*.test.ts'],
  },
})
