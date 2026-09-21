/**
 * Which kind of run this page does, decided once at startup.
 *
 * Three modes, in one fixed order. Stored keys win, because someone who put
 * their own credentials in this browser meant to spend them rather than a
 * deployment's. A build-time Worker origin comes next, which is the hosted
 * demo's whole path. Sample is what is left, and it is never a failure: the
 * page works with no key, no network and no configuration at all.
 *
 * `VITE_API_BASE` is a URL and nothing else. It is inlined into the bundle by
 * the build, which is exactly why it must stay a non-secret: a credential read
 * from `import.meta.env` would be shipped to every visitor as source, and no
 * amount of care further down would take it back out again.
 *
 * The client this module hands back is wrapped, not bare. A live path that
 * fails mid-run drops to the canned answers and says why, so a quota stop or a
 * bad minute upstream costs the visitor an explanation rather than a dead page.
 */

import type { RunMode } from '../core/types'
import { loadByoKeys, type ByoKeys } from './byo'
import type { ApiClient } from './client'
import { LiveCallError, RemoteApiClient, type FallbackReason, type RemoteTarget } from './remote'
import { SampleApiClient } from './sample'

/** Everything the decision is made from, so it can be made without a browser. */
export interface ModeSources {
  baseUrl: string
  keys: ByoKeys | null
}

/** The resolved mode, and the client that serves it. */
export interface ResolvedClient {
  mode: RunMode
  client: ApiClient
}

/** How a caller hears that this run dropped to canned answers, and why. */
export type FallbackListener = (reason: FallbackReason) => void

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

  return sources.baseUrl.trim() === '' ? 'sample' : 'live'
}

/** Where a mode sends its calls, or nothing when it does not send any. */
function targetFor(mode: RunMode, sources: ModeSources): RemoteTarget | null {
  switch (mode) {
    case 'byo':
      return sources.keys
    case 'live':
      return sources.baseUrl
    case 'sample':
      return null
  }
}

/**
 * Put the canned run behind a live one, once and permanently.
 *
 * The latch is the point. A run makes three calls, and a Worker that is out of
 * quota is out of quota for all three: retrying each one would spend three
 * round trips to reach the same canned answer and announce the same reason
 * three times over. The first classified failure switches this client over for
 * good, so the rest of that run — and the re-ask after it — comes straight from
 * the fixture with one banner explaining all of it.
 *
 * Only a classified live failure falls back. Anything else is a bug in this
 * app rather than a bad day upstream, and burying it under canned answers would
 * hide it from the one surface that would have shown it.
 */
export function withSampleFallback(live: ApiClient, onFallback?: FallbackListener): ApiClient {
  const canned = new SampleApiClient()
  let fellBack = false

  const announce = (reason: FallbackReason): void => {
    fellBack = true

    if (onFallback === undefined) {
      return
    }

    // A listener is a UI detail, and a bug in one must not take down the run
    // it was called to explain.
    try {
      onFallback(reason)
    } catch {
      /* the fallback outlives a broken listener */
    }
  }

  const attempt = async <T>(call: () => Promise<T>, fallback: () => Promise<T>): Promise<T> => {
    if (fellBack) {
      return fallback()
    }

    try {
      return await call()
    } catch (reason: unknown) {
      if (!(reason instanceof LiveCallError)) {
        throw reason
      }

      announce(reason.reason)

      return fallback()
    }
  }

  return {
    generateCandidates: (input) =>
      attempt(
        () => live.generateCandidates(input),
        // The same input, so the descriptor on the cards is still the one that
        // was typed: a fallback that quietly swapped in the fixture's prose
        // would read as the page having ignored the visitor.
        () => canned.generateCandidates(input),
      ),
    llmPick: (input) => attempt(() => live.llmPick(input), () => canned.llmPick(input)),
    jevChoice: (state) => attempt(() => live.jevChoice(state), () => canned.jevChoice(state)),
  }
}

/**
 * The client this page should run with, and the mode to call it by.
 *
 * `sources` is a parameter rather than a read so the three branches can be
 * exercised without a build or a browser store; nothing but a test ever passes
 * it. Sample mode gets the canned client unwrapped, because there is nothing
 * for it to fall back to.
 */
export function createClient(
  onFallback?: FallbackListener,
  sources: ModeSources = readModeSources(),
): ResolvedClient {
  const mode = resolveMode(sources)
  const target = targetFor(mode, sources)

  if (target === null) {
    return { mode, client: new SampleApiClient() }
  }

  return { mode, client: withSampleFallback(new RemoteApiClient(target), onFallback) }
}
