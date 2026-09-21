/// <reference types="vite/client" />

/**
 * The build-time configuration this app reads, which is one public URL.
 *
 * Vite inlines every `VITE_`-prefixed variable into the bundle as source text,
 * so anything declared here is something every visitor can read. That is fine
 * for a Worker origin and is the reason no key is ever named in this file: the
 * credentials live in the Worker's own environment, and a browser that has its
 * own reads them from local storage rather than from the build.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
