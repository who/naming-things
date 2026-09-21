/**
 * @vitest-environment node
 *
 * The router under the runtime it actually meets: bare `Request` objects, no
 * DOM. The Worker is reached through its default export rather than through a
 * helper, because the export is what Cloudflare calls and a test that bypassed
 * it could pass while the deployed entry point was wrong.
 */

import { describe, expect, it } from 'vitest'

import worker from '../src/index'

/**
 * Workers KV reduced to the two calls the limiter makes.
 *
 * The caps themselves are covered in ratelimit.test.ts. Here the namespace only
 * has to exist, because a Worker with none bound refuses every live route and
 * this suite is about which route a request reaches.
 */
function memoryCounters() {
  const stored = new Map<string, string>()

  return {
    get: async (key: string): Promise<string | null> => stored.get(key) ?? null,
    put: async (key: string, value: string): Promise<void> => {
      stored.set(key, value)
    },
  }
}

/** The deployed allowlist, spelled the way wrangler.toml spells it, with caps set well past what this suite spends. */
const ENV = {
  ALLOWED_ORIGINS: 'https://who.github.io,http://localhost:5173',
  RATE_LIMIT: memoryCounters(),
  IP_DAILY_LIMIT: '1000',
  GLOBAL_DAILY_LIMIT: '1000',
} as never

/** An origin on the list, and one that merely starts like it. */
const ALLOWED_ORIGIN = 'https://who.github.io'
const DENIED_ORIGIN = 'https://who.github.io.evil.test'

/** The Worker never touches `ctx` yet, so the stub only has to exist. */
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} }

/** Bigger than the 16384-byte cap, and JSON the parser would otherwise accept. */
const OVERSIZED_BODY = JSON.stringify({ descriptor: 'x'.repeat(20000) })

function send(request: Request): Promise<Response> {
  return worker.fetch(request, ENV, CTX as never)
}

describe('health', () => {
  it('answers a probe that sends no Origin at all', async () => {
    const response = await send(new Request('https://worker.test/api/health'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('grants CORS to a browser on the allowlist', async () => {
    const response = await send(
      new Request('https://worker.test/api/health', { headers: { Origin: ALLOWED_ORIGIN } }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN)
  })

  it('refuses a method the route does not have', async () => {
    const response = await send(new Request('https://worker.test/api/health', { method: 'POST' }))

    expect(response.status).toBe(405)
    await expect(response.json()).resolves.toEqual({ error: 'method_not_allowed' })
  })
})

describe('preflight', () => {
  it('grants the allowlisted origin the headers the client needs', async () => {
    const response = await send(
      new Request('https://worker.test/api/jev/choice', {
        method: 'OPTIONS',
        headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'POST' },
      }),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400')
  })

  it('echoes nothing back to an origin that only looks allowlisted', async () => {
    const response = await send(
      new Request('https://worker.test/api/jev/choice', {
        method: 'OPTIONS',
        headers: { Origin: DENIED_ORIGIN, 'Access-Control-Request-Method': 'POST' },
      }),
    )

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(await response.text()).not.toContain(DENIED_ORIGIN)
  })

  it('answers a preflight for a path that has no route', async () => {
    const response = await send(
      new Request('https://worker.test/api/nothing', {
        method: 'OPTIONS',
        headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'POST' },
      }),
    )

    expect(response.status).toBe(204)
  })
})

describe('routing', () => {
  it('reports an unknown path as JSON rather than as bare text', async () => {
    const response = await send(new Request('https://worker.test/api/llm/nope'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
  })

  it('refuses a GET on a provider route', async () => {
    const response = await send(new Request('https://worker.test/api/llm/pick'))

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toContain('POST')
  })

  // All four provider routes have real handlers now, and this env carries no
  // key of either kind, so each handler's own refusal is what proves the
  // request got past the router — and proves the two judges refuse under their
  // own error strings rather than a shared one. The handlers themselves are
  // tested against a stubbed provider in llm.test.ts and jev.test.ts.
  it.each([
    ['/api/llm/candidates', 'llm_unconfigured'],
    ['/api/llm/pick', 'llm_unconfigured'],
    ['/api/llm/descriptor', 'llm_unconfigured'],
    ['/api/jev/choice', 'jev_unconfigured'],
  ])('hands a well-formed POST to %s to the handler behind it', async (path, error) => {
    const response = await send(
      new Request(`https://worker.test${path}`, {
        method: 'POST',
        headers: { Origin: ALLOWED_ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptor: 'a saved search' }),
      }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN)
  })
})

describe('body handling', () => {
  it('rejects JSON that parses but is not an object', async () => {
    const response = await send(
      new Request('https://worker.test/api/llm/pick', {
        method: 'POST',
        body: JSON.stringify(['a saved search']),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_body' })
  })

  it('rejects a body that is not JSON at all', async () => {
    const response = await send(
      new Request('https://worker.test/api/llm/pick', { method: 'POST', body: '{' }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_json' })
  })

  it('refuses an oversized body on the strength of its Content-Length', async () => {
    const response = await send(
      new Request('https://worker.test/api/jev/choice', {
        method: 'POST',
        body: OVERSIZED_BODY,
      }),
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'payload_too_large' })
  })

  it('refuses an oversized body that declared no length', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(OVERSIZED_BODY))
        controller.close()
      },
    })

    const request = new Request('https://worker.test/api/jev/choice', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)

    // The point of this case: with nothing to check the header against, only
    // the count kept while reading can stop the body.
    expect(request.headers.get('Content-Length')).toBeNull()

    const response = await send(request)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'payload_too_large' })
  })
})
