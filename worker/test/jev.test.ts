/**
 * @vitest-environment node
 *
 * The Jev Choice handler with System One replaced by a stub.
 *
 * The cases are about the envelope rather than about the judgement: the model
 * pin, a choice that was never offered, a probability that is not a
 * probability, and the difference between a judge that reported no confidence
 * and one that reported none at all. The stub stands in for `fetch` because
 * that is the only way out of a Worker, and stubbing it keeps the suite offline
 * and free.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import worker from '../src/index'
import { buildChoiceQuestion, jevChoice } from '../src/jev'

/** Obviously fake, and asserted never to reach a response body. */
const KEY = 'test-key-not-a-real-one'

/**
 * Workers KV reduced to the two calls the limiter makes.
 *
 * The caps are covered in ratelimit.test.ts. This suite reaches the handler
 * through the router once, and a Worker with no namespace bound refuses that
 * route before the judge is ever asked, so the namespace has to be here.
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

const ENV = {
  ALLOWED_ORIGINS: 'https://who.github.io',
  TYPESAFE_API_KEY: KEY,
  RATE_LIMIT: memoryCounters(),
  IP_DAILY_LIMIT: '1000',
  GLOBAL_DAILY_LIMIT: '1000',
} as never

/** No key, and no namespace either: the handler is called directly, so neither is reached. */
const UNCONFIGURED_ENV = { ALLOWED_ORIGINS: 'https://who.github.io' }

/** The pin the handler sends and the pin it demands back. */
const MODEL = 'jev-1.13.0'

const DESCRIPTOR = 'a saved search a visitor can re-run later'
const CODE = 'interface SavedSearch {\n  id: string\n}'

/** The five a finished run puts to the judge. */
const CANDIDATES = [
  { name: 'lastRunAt', typeHint: 'Date | null', why: 'Names the moment, and admits it may never have run.' },
  { name: 'runCount', typeHint: 'number', why: 'Counts the runs without implying when they happened.' },
  { name: 'queryText', typeHint: 'string', why: 'Says the search is prose rather than a structured filter.' },
  { name: 'isPinned', typeHint: 'boolean', why: 'Reads as a yes-or-no at the call site.' },
  { name: 'ownerId', typeHint: 'string', why: 'Identifier-shaped, so it is never read as a display name.' },
]

/** The imported style, which travels into the state as the visitor left it. */
const VAL = {
  naming: 'snake_case',
  prefer: ['id-like'],
  weights: { shortNames: 0.25, explicitUnits: 0.5, nullable: 0.5 },
}

/** The Worker never touches `ctx`, so the stub only has to exist. */
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} }

/** A full distribution over the five, so a case can break exactly one thing. */
const PROBABILITIES = {
  lastRunAt: 0.71,
  runCount: 0.11,
  queryText: 0.09,
  isPinned: 0.06,
  ownerId: 0.03,
}

function state(overrides: Record<string, unknown> = {}) {
  return { descriptor: DESCRIPTOR, code: CODE, candidates: CANDIDATES, val: VAL, ...overrides }
}

/** One System One envelope, with the answer under the key the question used. */
function envelope(answer: Record<string, unknown>, model: string = MODEL): Response {
  return new Response(
    JSON.stringify({
      model,
      usage: { input_tokens: 412, output_tokens: 18 },
      answers: { best_property: { type: 'choice', ...answer } },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

/** The envelope a happy path gets, so a case can name only what it changes. */
function chosen(overrides: Record<string, unknown> = {}, model: string = MODEL): Response {
  return envelope(
    { choice: 'lastRunAt', confidence: 0.82, probabilities: PROBABILITIES, ...overrides },
    model,
  )
}

/** Put a stub in front of System One, and hand back the spy on it. */
function stubFetch(make: () => Response) {
  const stub = vi.fn(() => Promise.resolve(make()))

  vi.stubGlobal('fetch', stub)

  return stub
}

/** What the Worker actually posted upstream, decoded. */
function sentPayload(stub: ReturnType<typeof stubFetch>): Record<string, any> {
  const [, init] = stub.mock.calls[0] as unknown as [string, RequestInit]

  return JSON.parse(String(init.body))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('buildChoiceQuestion', () => {
  it('offers one option per candidate name, described by its type and its case', () => {
    const question = buildChoiceQuestion(CANDIDATES)

    expect(question.type).toBe('choice')
    expect(Object.keys(question.criteria)).toEqual(CANDIDATES.map((candidate) => candidate.name))
    expect(question.criteria.lastRunAt).toBe(`${CANDIDATES[0].typeHint} — ${CANDIDATES[0].why}`)
  })
})

describe('jevChoice', () => {
  it('returns the pick, the confidence and the whole distribution', async () => {
    stubFetch(() => chosen())

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      choice: 'lastRunAt',
      confidence: 0.82,
      probabilities: PROBABILITIES,
      model: MODEL,
    })
  })

  it('asks one pinned Choice question over the state the browser built', async () => {
    const stub = stubFetch(() => chosen())

    await jevChoice(state(), ENV)

    const [url, init] = stub.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    const payload = sentPayload(stub)

    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(payload.model).toBe(MODEL)
    expect(Object.keys(payload.questions)).toEqual(['best_property'])
    expect(payload.questions.best_property.type).toBe('choice')
    expect(Object.keys(payload.questions.best_property.criteria)).toEqual(
      CANDIDATES.map((candidate) => candidate.name),
    )
    // The four keys the page shows in its state viewer, with the imported style
    // forwarded as the visitor left it rather than rewritten into advice.
    expect(Object.keys(payload.state).sort()).toEqual(['candidates', 'code', 'descriptor', 'val'])
    expect(payload.state.val).toEqual(VAL)
    expect(payload.state.candidates).toEqual(CANDIDATES)
  })

  it('refuses an answer from a model that is not the pinned one', async () => {
    stubFetch(() => chosen({}, 'jev-latest'))

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'jev_bad_response' })
  })

  it('refuses a choice that was never on the list', async () => {
    stubFetch(() => chosen({ choice: 'lastRun' }))

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'jev_bad_response' })
  })

  it('refuses a probability outside the unit interval', async () => {
    stubFetch(() => chosen({ probabilities: { ...PROBABILITIES, runCount: 1.4 } }))

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'jev_bad_response' })
  })

  it('refuses a probability that is not a number at all', async () => {
    stubFetch(() => chosen({ probabilities: { ...PROBABILITIES, ownerId: '0.03' } }))

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'jev_bad_response' })
  })

  it('refuses a distribution naming an option that was never offered', async () => {
    stubFetch(() => chosen({ probabilities: { ...PROBABILITIES, searchQuery: 0.5 } }))

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'jev_bad_response' })
  })

  it('accepts a distribution that simply left a candidate out', async () => {
    stubFetch(() => chosen({ probabilities: { lastRunAt: 0.94, runCount: 0.06 } }))

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      probabilities: { lastRunAt: 0.94, runCount: 0.06 },
    })
  })

  it('carries a reported null confidence through as null rather than as zero', async () => {
    stubFetch(() => chosen({ confidence: null }))

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ choice: 'lastRunAt', confidence: null })
  })

  it('reads an omitted confidence the same way, since neither one is a number', async () => {
    stubFetch(() => envelope({ choice: 'isPinned', probabilities: { isPinned: 1 } }))

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ choice: 'isPinned', confidence: null })
  })

  it('refuses a confidence that arrived as a string', async () => {
    stubFetch(() => chosen({ confidence: '0.82' }))

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'jev_bad_response' })
  })

  it('refuses an envelope with no answers object in it', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ model: MODEL, usage: { input_tokens: 412 } }), {
          status: 200,
        }),
    )

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'jev_bad_response' })
  })

  it('refuses an answer that came back as some other question type', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            model: MODEL,
            answers: { best_property: { type: 'noul', noul: 0.8 } },
          }),
          { status: 200 },
        ),
    )

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'jev_bad_response' })
  })

  it('keeps an unreadable upstream body in the log and out of the response', async () => {
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {})

    stubFetch(() => new Response(`<html>${KEY}</html>`, { status: 200 }))

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(502)
    expect(await response.text()).toBe(JSON.stringify({ error: 'jev_bad_response' }))
    expect(String(logged.mock.calls[0]?.[0])).toContain('<html>')
  })

  it('says the judge is busy rather than blaming the key', async () => {
    const stub = stubFetch(() => new Response('{"detail":"slow down"}', { status: 429 }))

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'jev_upstream_busy' })
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('reports any other upstream failure as its own error, without echoing the key', async () => {
    stubFetch(() => new Response(`{"key":"${KEY}"}`, { status: 500 }))

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(502)
    expect(await response.text()).toBe(JSON.stringify({ error: 'jev_upstream_error' }))
  })

  it('reports a judge that never answered', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('timed out', 'TimeoutError'))),
    )

    const response = await jevChoice(state(), ENV)

    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toEqual({ error: 'jev_unreachable' })
  })

  it('answers 503 and spends nothing when no key was configured', async () => {
    const stub = stubFetch(() => chosen())

    const response = await jevChoice(state(), UNCONFIGURED_ENV)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'jev_unconfigured' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('refuses a state over the byte budget before the call goes out', async () => {
    const stub = stubFetch(() => chosen())
    const bloated = CANDIDATES.map((candidate) => ({ ...candidate, why: 'w'.repeat(140) }))

    const response = await jevChoice(
      state({ descriptor: 'd'.repeat(1200), code: 'c'.repeat(2000), candidates: bloated, val: {
        naming: 'camelCase',
        note: 'n'.repeat(4000),
      } }),
      ENV,
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'state_too_large' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('refuses a run that is not five candidates before the call goes out', async () => {
    const stub = stubFetch(() => chosen())

    const response = await jevChoice(state({ candidates: CANDIDATES.slice(0, 4) }), ENV)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_body' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('refuses two candidates sharing a name, which would collide as option keys', async () => {
    const repeated = [...CANDIDATES.slice(0, 4), { ...CANDIDATES[0] }]
    const stub = stubFetch(() => chosen())

    const response = await jevChoice(state({ candidates: repeated }), ENV)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_body' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('refuses a state with no style on it at all', async () => {
    stubFetch(() => chosen())

    const response = await jevChoice({ descriptor: DESCRIPTOR, code: CODE, candidates: CANDIDATES }, ENV)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_body' })
  })
})

describe('through the router', () => {
  it('reaches the Jev handler and keeps the CORS grant on the way back', async () => {
    stubFetch(() => chosen())

    const response = await worker.fetch(
      new Request('https://worker.test/api/jev/choice', {
        method: 'POST',
        headers: { Origin: 'https://who.github.io', 'Content-Type': 'application/json' },
        body: JSON.stringify(state()),
      }),
      ENV,
      CTX as never,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://who.github.io')
    await expect(response.json()).resolves.toMatchObject({ choice: 'lastRunAt', model: MODEL })
  })
})
