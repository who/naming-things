import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadByoKeys, type ByoKeys } from '../../src/api/byo'
import { createClient, readModeSources, resolveMode, type ModeSources } from '../../src/api/mode'
import { LiveCallError, RemoteApiClient } from '../../src/api/remote'

const STORAGE_KEY = 'naming-things:keys'

const BASE_URL = 'https://naming-things-worker.example.workers.dev'

const KEYS: ByoKeys = { anthropicKey: 'local-anthropic-key', typesafeKey: 'local-typesafe-key' }

/** Only the one method this module ever reaches for. */
interface TestStorage {
  getItem(key: string): string | null
}

/**
 * Put a store of our own in front of the runner's.
 *
 * The same trick the style-control tests use, for the same reason: the ambient
 * `localStorage` here is neither jsdom's nor a browser's, so each test supplies
 * exactly the store it is about — one holding a document, one holding nonsense,
 * one that throws the way a blocked store does.
 */
function useStorage(stored: string | null): void {
  const storage: TestStorage = { getItem: (key) => (key === STORAGE_KEY ? stored : null) }

  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
}

/** A store that refuses every call, the way private browsing does. */
function useBlockedStorage(): void {
  const storage: TestStorage = {
    getItem: () => {
      throw new Error('storage is blocked')
    },
  }

  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
}

function sources(baseUrl: string, keys: ByoKeys | null): ModeSources {
  return { baseUrl, keys }
}

/** A transport that never opens, the way an offline browser's does not. */
function useOfflineTransport(): void {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  useStorage(null)
})

describe('resolveMode', () => {
  it('lets stored keys win over a configured Worker', () => {
    expect(resolveMode(sources(BASE_URL, KEYS))).toBe('byo')
  })

  it('runs live through the Worker when only a base URL is configured', () => {
    expect(resolveMode(sources(BASE_URL, null))).toBe('live')
  })

  it('is unconfigured when neither a key nor an origin is there', () => {
    expect(resolveMode(sources('', null))).toBe('unconfigured')
  })

  it('reads a whitespace-only base URL as no base URL at all', () => {
    expect(resolveMode(sources('   ', null))).toBe('unconfigured')
  })
})

describe('loadByoKeys', () => {
  it('returns nothing when the entry was never written', () => {
    useStorage(null)

    expect(loadByoKeys()).toBeNull()
  })

  it('returns nothing when the entry is not JSON', () => {
    useStorage('{not json at all')

    expect(loadByoKeys()).toBeNull()
  })

  it('returns nothing for a document of the wrong shape', () => {
    useStorage(JSON.stringify([KEYS]))

    expect(loadByoKeys()).toBeNull()
  })

  it('returns nothing when only one of the two keys is there', () => {
    useStorage(JSON.stringify({ anthropicKey: KEYS.anthropicKey }))

    expect(loadByoKeys()).toBeNull()
  })

  it('treats a present but empty key as an absent one', () => {
    useStorage(JSON.stringify({ anthropicKey: KEYS.anthropicKey, typesafeKey: '   ' }))

    expect(loadByoKeys()).toBeNull()
  })

  it('returns nothing rather than throwing when the store is blocked', () => {
    useBlockedStorage()

    expect(loadByoKeys()).toBeNull()
  })

  it('reads a well-formed pair, trimmed', () => {
    useStorage(JSON.stringify({ anthropicKey: ` ${KEYS.anthropicKey} `, typesafeKey: KEYS.typesafeKey }))

    expect(loadByoKeys()).toEqual(KEYS)
  })
})

describe('readModeSources', () => {
  it('reads the build variable and the stored keys together', () => {
    vi.stubEnv('VITE_API_BASE', ` ${BASE_URL} `)
    useStorage(JSON.stringify(KEYS))

    expect(readModeSources()).toEqual({ baseUrl: BASE_URL, keys: KEYS })
  })

  it('reports no base URL when the build was never given one', () => {
    vi.stubEnv('VITE_API_BASE', '')
    useStorage(null)

    expect(readModeSources()).toEqual({ baseUrl: '', keys: null })
  })
})

describe('createClient', () => {
  /**
   * The case the whole page hangs on: a build with nowhere to send a call.
   *
   * There is no stand-in behind this branch any more, and the absence is what
   * the test is for. A client here — any client — would be ten names no model
   * wrote, served under a visitor's own prose by a deployment that was never
   * finished, and nothing further down the page could tell the difference.
   */
  it('has no client at all for an unconfigured build', () => {
    const resolved = createClient(sources('', null))

    expect(resolved.mode).toBe('unconfigured')
    expect(resolved.client).toBeNull()
  })

  it('serves a live client when a Worker is configured', () => {
    const resolved = createClient(sources(BASE_URL, null))

    expect(resolved.mode).toBe('live')
    expect(resolved.client).toBeInstanceOf(RemoteApiClient)
  })

  it('serves a byo client when this browser holds its own keys', () => {
    const resolved = createClient(sources(BASE_URL, KEYS))

    expect(resolved.mode).toBe('byo')
    expect(resolved.client).toBeInstanceOf(RemoteApiClient)
  })
})

/**
 * Randomize, at the seam where a mode decides what it can do.
 *
 * The button reaches a model or it reaches nothing. A live path that cannot
 * answer says so by refusing, which is what leaves the prose already in the box
 * standing and the busy line above it — as against a brief quietly dealt from
 * somewhere else and presented as the model's.
 */
describe('generateDescriptor', () => {
  it('refuses, rather than substituting, when the live path cannot answer', async () => {
    const resolved = createClient(sources(BASE_URL, null))

    useOfflineTransport()

    expect(resolved.mode).toBe('live')
    await expect(resolved.client?.generateDescriptor()).rejects.toMatchObject({
      reason: 'network error',
    })
    await expect(resolved.client?.generateDescriptor()).rejects.toBeInstanceOf(LiveCallError)
  })
})
