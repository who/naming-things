import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadByoKeys, type ByoKeys } from '../../src/api/byo'
import { createClient, readModeSources, resolveMode, type ModeSources } from '../../src/api/mode'
import { SampleApiClient } from '../../src/api/sample'

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

afterEach(() => {
  vi.unstubAllEnvs()
  useStorage(null)
})

describe('resolveMode', () => {
  it('lets stored keys win over a configured Worker', () => {
    expect(resolveMode(sources(BASE_URL, KEYS))).toBe('byo')
  })

  it('runs live through the Worker when only a base URL is configured', () => {
    expect(resolveMode(sources(BASE_URL, null))).toBe('live')
  })

  it('falls to sample when nothing is configured', () => {
    expect(resolveMode(sources('', null))).toBe('sample')
  })

  it('reads a whitespace-only base URL as no base URL at all', () => {
    expect(resolveMode(sources('   ', null))).toBe('sample')
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
  it('hands back the canned client, unwrapped, in sample mode', () => {
    const resolved = createClient(undefined, sources('', null))

    expect(resolved.mode).toBe('sample')
    expect(resolved.client).toBeInstanceOf(SampleApiClient)
  })

  it('wraps a live client when a Worker is configured', () => {
    const resolved = createClient(undefined, sources(BASE_URL, null))

    expect(resolved.mode).toBe('live')
    expect(resolved.client).not.toBeInstanceOf(SampleApiClient)
  })

  it('wraps a byo client when this browser holds its own keys', () => {
    const resolved = createClient(undefined, sources(BASE_URL, KEYS))

    expect(resolved.mode).toBe('byo')
    expect(resolved.client).not.toBeInstanceOf(SampleApiClient)
  })
})
