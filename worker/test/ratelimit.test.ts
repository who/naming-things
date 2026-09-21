/**
 * @vitest-environment node
 *
 * The daily caps, counted in a Map instead of in Workers KV.
 *
 * The cases here are about what the counter does at its edges rather than about
 * KV: the request that fits, the one that does not, the caller with no address
 * to count under, the deployment with no namespace to count in, and the moment
 * the day rolls over. The clock is faked because two of those cases are
 * questions about dates, and a suite that waited for real midnight would only
 * pass once a day.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import worker from '../src/index'
import { checkAndIncrement, utcDayKey } from '../src/ratelimit'

/** The allowlist, spelled the way the other Worker suites spell it. */
const ALLOWED_ORIGIN = 'https://who.github.io'

/** The Worker never touches `ctx`, so the stub only has to exist. */
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} }

/** A fixed instant well inside a day, so a rollover has to be asked for. */
const MIDDAY = new Date('2026-09-21T12:00:00.000Z')

/** Two addresses, so one caller exhausting its cap can be shown not to touch the other. */
const ADDRESS = '203.0.113.7'
const OTHER_ADDRESS = '198.51.100.4'

/** What a `put` recorded, so the expiry can be asserted rather than assumed. */
interface StoredCounter {
  value: string
  expirationTtl?: number
}

/**
 * Workers KV, reduced to the two calls this module makes.
 *
 * It keeps the written options so the self-cleaning expiry is covered, and it
 * can be told to throw, because a KV that fails is the case that decides
 * whether the Worker fails open or closed.
 */
function memoryCounters() {
  const stored = new Map<string, StoredCounter>()
  const failures = { read: false, write: false }

  return {
    stored,
    failures,
    get: async (key: string): Promise<string | null> => {
      if (failures.read) {
        throw new Error('KV unavailable')
      }

      return stored.get(key)?.value ?? null
    },
    put: async (
      key: string,
      value: string,
      options?: { expirationTtl?: number },
    ): Promise<void> => {
      if (failures.write) {
        throw new Error('KV unavailable')
      }

      stored.set(key, { value, expirationTtl: options?.expirationTtl })
    },
  }
}

/** An env carrying a fresh namespace and whatever caps the case is about. */
function envWith(
  counters: ReturnType<typeof memoryCounters> | undefined,
  limits: { IP_DAILY_LIMIT?: string; GLOBAL_DAILY_LIMIT?: string } = {},
) {
  return {
    ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    ANTHROPIC_API_KEY: 'test-key-not-a-real-one',
    TYPESAFE_API_KEY: 'test-key-not-a-real-one',
    RATE_LIMIT: counters,
    ...limits,
  } as never
}

/** A request from a given address, or from none at all. */
function requestFrom(address?: string): Request {
  return new Request('https://worker.test/api/llm/pick', {
    method: 'POST',
    headers: address === undefined ? {} : { 'CF-Connecting-IP': address },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(MIDDAY)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('utcDayKey', () => {
  it('formats a moment as the UTC date it falls on', () => {
    expect(utcDayKey(MIDDAY)).toBe('2026-09-21')
  })

  it('reads the last second of a UTC day as that day, not the next', () => {
    expect(utcDayKey(new Date('2026-09-21T23:59:59.999Z'))).toBe('2026-09-21')
  })
})

describe('a first request', () => {
  it('is allowed, and starts both counters at one', async () => {
    const counters = memoryCounters()

    await expect(checkAndIncrement(envWith(counters), requestFrom(ADDRESS))).resolves.toEqual({
      allowed: true,
    })

    expect(counters.stored.get(`ip:${ADDRESS}:2026-09-21`)?.value).toBe('1')
    expect(counters.stored.get('global:2026-09-21')?.value).toBe('1')
  })

  it('writes both counters with an expiry, so old days clean themselves up', async () => {
    const counters = memoryCounters()

    await checkAndIncrement(envWith(counters), requestFrom(ADDRESS))

    expect(counters.stored.get(`ip:${ADDRESS}:2026-09-21`)?.expirationTtl).toBe(172800)
    expect(counters.stored.get('global:2026-09-21')?.expirationTtl).toBe(172800)
  })
})

describe('the per-address cap', () => {
  it('admits exactly the configured number of requests and refuses the next', async () => {
    const counters = memoryCounters()
    const env = envWith(counters, { IP_DAILY_LIMIT: '3' })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(checkAndIncrement(env, requestFrom(ADDRESS))).resolves.toEqual({ allowed: true })
    }

    const refused = await checkAndIncrement(env, requestFrom(ADDRESS))

    expect(refused).toMatchObject({ allowed: false, error: 'quota_exceeded' })
  })

  it('leaves a second address its own full allowance', async () => {
    const counters = memoryCounters()
    const env = envWith(counters, { IP_DAILY_LIMIT: '1' })

    await checkAndIncrement(env, requestFrom(ADDRESS))

    await expect(checkAndIncrement(env, requestFrom(ADDRESS))).resolves.toMatchObject({
      allowed: false,
      error: 'quota_exceeded',
    })
    await expect(checkAndIncrement(env, requestFrom(OTHER_ADDRESS))).resolves.toEqual({
      allowed: true,
    })
  })

  it('reports a retry delay that lands on the next UTC midnight', async () => {
    const counters = memoryCounters()
    const env = envWith(counters, { IP_DAILY_LIMIT: '1' })

    await checkAndIncrement(env, requestFrom(ADDRESS))

    const refused = await checkAndIncrement(env, requestFrom(ADDRESS))

    // Midday, so half a day remains — and the value is a positive number of
    // seconds whatever the hour, because a negative delay is not a delay.
    expect(refused).toEqual({ allowed: false, error: 'quota_exceeded', retryAfter: 43200 })
  })

  it('never reports a negative delay, even a millisecond before midnight', async () => {
    vi.setSystemTime(new Date('2026-09-21T23:59:59.999Z'))

    const counters = memoryCounters()
    const env = envWith(counters, { IP_DAILY_LIMIT: '1' })

    await checkAndIncrement(env, requestFrom(ADDRESS))

    const refused = await checkAndIncrement(env, requestFrom(ADDRESS))

    expect(refused).toEqual({ allowed: false, error: 'quota_exceeded', retryAfter: 1 })
  })
})

describe('the global cap', () => {
  it('refuses a fresh address once the Worker as a whole is over', async () => {
    const counters = memoryCounters()
    const env = envWith(counters, { IP_DAILY_LIMIT: '100', GLOBAL_DAILY_LIMIT: '2' })

    await checkAndIncrement(env, requestFrom(ADDRESS))
    await checkAndIncrement(env, requestFrom(OTHER_ADDRESS))

    // A third address that has spent nothing of its own: the cap that stops it
    // can only be the global one.
    await expect(checkAndIncrement(env, requestFrom('192.0.2.9'))).resolves.toMatchObject({
      allowed: false,
      error: 'quota_exceeded',
    })
  })
})

describe('a request with no client address', () => {
  it('is counted under one shared bucket rather than given a fresh allowance', async () => {
    const counters = memoryCounters()
    const env = envWith(counters, { IP_DAILY_LIMIT: '1' })

    await expect(checkAndIncrement(env, requestFrom())).resolves.toEqual({ allowed: true })
    expect(counters.stored.get('ip:unknown:2026-09-21')?.value).toBe('1')

    await expect(checkAndIncrement(env, requestFrom())).resolves.toMatchObject({
      allowed: false,
      error: 'quota_exceeded',
    })
  })
})

describe('a deployment with no namespace bound', () => {
  it('fails closed rather than serving the budget uncounted', async () => {
    await expect(checkAndIncrement(envWith(undefined), requestFrom(ADDRESS))).resolves.toEqual({
      allowed: false,
      error: 'ratelimit_unconfigured',
    })
  })

  it('treats a namespace that cannot be read the same way', async () => {
    const counters = memoryCounters()

    counters.failures.read = true
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(checkAndIncrement(envWith(counters), requestFrom(ADDRESS))).resolves.toEqual({
      allowed: false,
      error: 'ratelimit_unconfigured',
    })
  })

  it('refuses rather than letting a request through on a counter it could not write', async () => {
    const counters = memoryCounters()

    counters.failures.write = true
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(checkAndIncrement(envWith(counters), requestFrom(ADDRESS))).resolves.toEqual({
      allowed: false,
      error: 'ratelimit_unconfigured',
    })
  })
})

describe('the day rolling over', () => {
  it('starts a fresh counter and leaves the exhausted day untouched', async () => {
    const counters = memoryCounters()
    const env = envWith(counters, { IP_DAILY_LIMIT: '1' })

    await checkAndIncrement(env, requestFrom(ADDRESS))
    await expect(checkAndIncrement(env, requestFrom(ADDRESS))).resolves.toMatchObject({
      allowed: false,
    })

    vi.setSystemTime(new Date('2026-09-22T00:00:01.000Z'))

    await expect(checkAndIncrement(env, requestFrom(ADDRESS))).resolves.toEqual({ allowed: true })

    // Yesterday's count is still exactly what yesterday spent: each write
    // targets its own dated key, so crossing midnight cannot rewrite history.
    expect(counters.stored.get(`ip:${ADDRESS}:2026-09-21`)?.value).toBe('1')
    expect(counters.stored.get(`ip:${ADDRESS}:2026-09-22`)?.value).toBe('1')
  })
})

describe('the routes as the router wraps them', () => {
  function send(request: Request, env: unknown): Promise<Response> {
    return worker.fetch(request, env as never, CTX as never)
  }

  function post(path: string): Request {
    return new Request(`https://worker.test${path}`, {
      method: 'POST',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': ADDRESS,
      },
      body: JSON.stringify({ descriptor: 'a saved search' }),
    })
  }

  it.each(['/api/llm/candidates', '/api/llm/pick', '/api/jev/choice'])(
    'answers %s over quota with 429, a retry hint and its CORS grant',
    async (path) => {
      const env = envWith(memoryCounters(), { IP_DAILY_LIMIT: '1' })

      await send(post(path), env)

      const response = await send(post(path), env)

      expect(response.status).toBe(429)
      await expect(response.json()).resolves.toEqual({
        error: 'quota_exceeded',
        retryAfter: 43200,
      })
      expect(response.headers.get('Retry-After')).toBe('43200')
      // Without the grant the browser cannot read the body, and a quota refusal
      // it cannot read is an opaque network error instead of sample mode.
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN)
    },
  )

  it('answers a live route with 503 when no namespace is bound', async () => {
    const response = await send(post('/api/jev/choice'), envWith(undefined))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'ratelimit_unconfigured' })
  })

  it('counts a request whose body never parses, so a retry storm cannot be free', async () => {
    const counters = memoryCounters()
    const env = envWith(counters, { IP_DAILY_LIMIT: '1' })

    const malformed = new Request('https://worker.test/api/llm/pick', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': ADDRESS },
      body: '{',
    })

    await expect((await send(malformed, env)).json()).resolves.toEqual({ error: 'invalid_json' })

    const response = await send(post('/api/llm/pick'), env)

    expect(response.status).toBe(429)
  })

  it('leaves the health route uncounted however often it is probed', async () => {
    const counters = memoryCounters()
    const env = envWith(counters, { IP_DAILY_LIMIT: '1' })

    for (let probe = 0; probe < 5; probe += 1) {
      const response = await send(
        new Request('https://worker.test/api/health', {
          headers: { 'CF-Connecting-IP': ADDRESS },
        }),
        env,
      )

      expect(response.status).toBe(200)
    }

    expect(counters.stored.size).toBe(0)

    // And the allowance the probes did not spend is still there to spend.
    await expect(checkAndIncrement(env, requestFrom(ADDRESS))).resolves.toEqual({ allowed: true })
  })
})
