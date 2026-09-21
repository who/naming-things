import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadByoKeys, type ByoKeys } from '../../src/api/byo'
import { createClient, readModeSources, resolveMode, type ModeSources } from '../../src/api/mode'
import type { FallbackReason } from '../../src/api/remote'
import { describesSampleRun, SampleApiClient } from '../../src/api/sample'
import { DESCRIPTOR_BANK } from '../../src/core/descriptors'
import { DEFAULT_VAL } from '../../src/core/types'
import { SAMPLE_RUN } from '../../src/fixtures/sampleRun'

const STORAGE_KEY = 'naming-things:keys'

const BASE_URL = 'https://naming-things-worker.example.workers.dev'

const KEYS: ByoKeys = { anthropicKey: 'local-anthropic-key', typesafeKey: 'local-typesafe-key' }

/** Prose the courier fixture is plainly not about. */
const EDITED_DESCRIPTOR = 'A gym class booking. A member holds a slot until the class starts.'

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

  /**
   * The mismatch the banner is built on, checked where the page sees it.
   *
   * Sample mode answers a gym class with parcel weights, because that is the
   * only run it has. What must not happen is that going unsaid, so the draft it
   * returns has to remain something the descriptor check can call canned.
   */
  it('answers unrelated prose with the fixture, and the run stays detectably canned', async () => {
    const resolved = createClient(undefined, sources('', null))

    const draft = await resolved.client.generateCandidates({
      descriptor: EDITED_DESCRIPTOR,
      val: DEFAULT_VAL(),
    })

    expect(resolved.mode).toBe('sample')
    expect(draft.candidates.map((candidate) => candidate.name)).toEqual(
      SAMPLE_RUN.candidates.map((candidate) => candidate.name),
    )
    expect(describesSampleRun(draft.descriptor)).toBe(false)
  })
})

/**
 * Randomize, at the seam where a mode decides what it can do.
 *
 * The button reaches a model in the two live modes and the local bank in sample
 * mode, and the wrapper in between turns a live path that cannot answer into
 * the second of those. What must not happen is a visitor clicking Randomize and
 * getting nothing, whichever of the three they are in.
 */
describe('generateDescriptor', () => {
  it('deals from the bank in sample mode, avoiding the brief on screen', async () => {
    const resolved = createClient(undefined, sources('', null))
    const onScreen = DESCRIPTOR_BANK[0]

    const next = await resolved.client.generateDescriptor(onScreen)

    expect(DESCRIPTOR_BANK).toContain(next)
    expect(next).not.toBe(onScreen)
  })

  it('falls back to the bank, and says why, when the live path cannot answer', async () => {
    const reasons: FallbackReason[] = []
    const resolved = createClient((reason) => reasons.push(reason), sources(BASE_URL, null))

    useOfflineTransport()

    const next = await resolved.client.generateDescriptor()

    expect(resolved.mode).toBe('live')
    expect(DESCRIPTOR_BANK).toContain(next)
    expect(reasons).toEqual(['network error'])
  })
})
