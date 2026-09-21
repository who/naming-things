/**
 * Which kind of run this page does, decided once at startup.
 *
 * Two modes that can run and one that cannot. Stored keys win, because someone
 * who put their own credentials in this browser meant to spend them rather than
 * a deployment's. A build-time Worker origin comes next, which is the hosted
 * demo's whole path. A build with neither is unconfigured, and is named as
 * such: there is nothing behind this page to answer with, so a page that cannot
 * reach a model has to say so rather than find something else to show.
 *
 * `VITE_API_BASE` is a URL and nothing else. It is inlined into the bundle by
 * the build, which is exactly why it must stay a non-secret: a credential read
 * from `import.meta.env` would be shipped to every visitor as source, and no
 * amount of care further down would take it back out again.
 *
 * The client handed back is the live one, bare. A live call that fails is a
 * live call that failed, and the page says the service is busy rather than
 * quietly answering out of a fixture: ten names no model wrote, sitting under
 * the prose a visitor typed, are a result the page did not produce.
 */

import type { RunMode } from '../core/types'
import { loadByoKeys, type ByoKeys } from './byo'
import type { ApiClient } from './client'
import { RemoteApiClient, type RemoteTarget } from './remote'

/** Everything the decision is made from, so it can be made without a browser. */
export interface ModeSources {
  baseUrl: string
  keys: ByoKeys | null
}

/** The resolved mode, and the client that serves it — or nothing, when none can. */
export interface ResolvedClient {
  mode: RunMode
  client: ApiClient | null
}

/**
 * The Worker origin this build was configured with, or the empty string.
 *
 * Absent, misspelled and whitespace-only all collapse to the same answer,
 * because each one is a build that was not pointed at a Worker — and a base URL
 * of `" "` would otherwise produce requests to a path with no host.
 */
function readBaseUrl(): string {
  const configured: unknown = import.meta.env.VITE_API_BASE

  return typeof configured === 'string' ? configured.trim() : ''
}

/** What this browser and this build actually offer, read once per startup. */
export function readModeSources(): ModeSources {
  return { baseUrl: readBaseUrl(), keys: loadByoKeys() }
}

/**
 * The mode those sources add up to.
 *
 * Kept apart from client construction so the precedence is one readable rule
 * rather than a shape inferred from which branch returned first.
 */
export function resolveMode(sources: ModeSources): RunMode {
  if (sources.keys !== null) {
    return 'byo'
  }

  return sources.baseUrl.trim() === '' ? 'unconfigured' : 'live'
}

/** Where a mode sends its calls, or nothing when it has nowhere to send them. */
function targetFor(mode: RunMode, sources: ModeSources): RemoteTarget | null {
  switch (mode) {
    case 'byo':
      return sources.keys
    case 'live':
      return sources.baseUrl
    case 'unconfigured':
      return null
  }
}

/**
 * The client this page should run with, and the mode to call it by.
 *
 * `sources` is a parameter rather than a read so the three branches can be
 * exercised without a build or a browser store; nothing but a test ever passes
 * it. An unconfigured build gets no client at all, which is the honest shape of
 * that case: a deployment that was never given an origin has no run to offer,
 * and a stand-in that answered anyway would be the deployment mistake hidden
 * behind a working-looking page.
 */
export function createClient(sources: ModeSources = readModeSources()): ResolvedClient {
  const mode = resolveMode(sources)
  const target = targetFor(mode, sources)

  return { mode, client: target === null ? null : new RemoteApiClient(target) }
}
