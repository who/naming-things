import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ByoKeys } from '../../src/api/byo'
import { LiveCallError, RemoteApiClient } from '../../src/api/remote'
import { DEFAULT_VAL, type Candidate, type JevState } from '../../src/core/types'

/** Written with a trailing slash on purpose: a base pasted from an address bar has one. */
const BASE_URL = 'https://naming-things-worker.example.workers.dev/'

const KEYS: ByoKeys = { anthropicKey: 'local-anthropic-key', typesafeKey: 'local-typesafe-key' }

const DESCRIPTOR = 'A courier delivery job with a parcel that has to be weighed.'

/** A brief long enough to clear the floor a written one has to clear. */
const BRIEF =
  'A SavedSearch in an analytics console, holding the query text and the account that wrote it. '
  + 'The property to name is the moment a schedule last ran the search, held as a timestamp and '
  + 'absent until a schedule has fired once.'

const CODE = 'interface DeliveryJob {\n  // the parcel, weighed in grams\n}'

const CANDIDATES: Candidate[] = [
  { name: 'weight', typeHint: 'number', why: 'The plain noun.' },
  { name: 'weightGrams', typeHint: 'number', why: 'Carries its unit.' },
  { name: 'massGrams', typeHint: 'number', why: 'The physically correct word.' },
  { name: 'parcelWeight', typeHint: 'number', why: 'Says what is being weighed.' },
  { name: 'grams', typeHint: 'number', why: 'The unit, standing in for the quantity.' },
  { name: 'parcelWeightGrams', typeHint: 'number', why: 'Says what is weighed and in what.' },
  { name: 'weightInGrams', typeHint: 'number', why: 'Prose, with a preposition inside a key.' },
  { name: 'netWeightGrams', typeHint: 'number', why: 'The shipping term for it.' },
  { name: 'weightG', typeHint: 'number', why: 'The unit, abbreviated to one letter.' },
  { name: 'depotWeight', typeHint: 'number', why: 'Names where it was weighed, not the unit.' },
]

const PROBABILITIES = {
  weight: 0.12,
  weightGrams: 0.44,
  massGrams: 0.12,
  parcelWeight: 0.08,
  grams: 0.06,
  parcelWeightGrams: 0.07,
  weightInGrams: 0.04,
  netWeightGrams: 0.03,
  weightG: 0.02,
  depotWeight: 0.02,
}

const STATE: JevState = {
  descriptor: DESCRIPTOR,
  code: CODE,
  candidates: CANDIDATES,
  val: DEFAULT_VAL(),
}

/** One request the stubbed transport saw, kept for its URL, headers and body. */
interface TransportCall {
  url: string
  init: RequestInit
}

let calls: TransportCall[] = []

/**
 * Stand a scripted transport in front of the client.
 *
 * Each queued entry answers one call in order, so a test can say "this route
 * refuses and the next one is never reached" without a mock framework's worth
 * of ceremony. The responses are the three properties `postJson` actually
 * reads, rather than whole `Response` objects the runtime would have to build.
 */
function useTransport(...responses: Array<() => Promise<Response>>): void {
  const queued = [...responses]

  calls = []

  vi.stubGlobal('fetch', (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init })

    const next = queued.shift()

    if (next === undefined) {
      throw new Error(`the transport was called again, for ${url}`)
    }

    return next()
  })
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

/** An answer, JSON and in range. */
function answers(body: unknown): () => Promise<Response> {
  return () => Promise.resolve(jsonResponse(200, body))
}

/** A refusal carrying the Worker's `error` key. */
function refuses(status: number, error: string): () => Promise<Response> {
  return () => Promise.resolve(jsonResponse(status, { error }))
}

/** A body that is not JSON at all, the way an edge's error page is not. */
function servesHtml(status: number): () => Promise<Response> {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    } as unknown as Response)
}

/** A connection that never opened. */
function offline(): () => Promise<Response> {
  return () => Promise.reject(new TypeError('Failed to fetch'))
}

function bodyOf(call: TransportCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>
}

function headersOf(call: TransportCall): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>
}

function firstCall(): TransportCall {
  const call = calls[0]

  if (call === undefined) {
    throw new Error('the transport was never called')
  }

  return call
}

function worker(): RemoteApiClient {
  return new RemoteApiClient(BASE_URL)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RemoteApiClient, through the Worker', () => {
  it('posts one route per call, with no doubled slash from the base URL', async () => {
    useTransport(answers({ descriptor: DESCRIPTOR, code: CODE, candidates: CANDIDATES }))

    const draft = await worker().generateCandidates({ descriptor: DESCRIPTOR, val: DEFAULT_VAL() })
    const call = firstCall()

    expect(call.url).toBe(
      'https://naming-things-worker.example.workers.dev/api/llm/candidates',
    )
    expect(call.init.method).toBe('POST')
    expect(bodyOf(call)).toEqual({ descriptor: DESCRIPTOR, val: DEFAULT_VAL() })
    expect(draft.descriptor).toBe(DESCRIPTOR)
    expect(draft.code).toBe(CODE)
    expect(draft.candidates).toHaveLength(10)
  })

  it('rewrites the ten the Worker sent into the casing this page asked for', async () => {
    useTransport(answers({ descriptor: DESCRIPTOR, code: CODE, candidates: CANDIDATES }))

    // A Worker one deploy behind answers in whatever casing the model used, so
    // the page applies the rule again rather than trusting the answer to it.
    const draft = await worker().generateCandidates({
      descriptor: DESCRIPTOR,
      val: { ...DEFAULT_VAL(), naming: 'PascalCase' },
    })

    expect(draft.candidates.map(({ name }) => name)).toEqual([
      'Weight',
      'WeightGrams',
      'MassGrams',
      'ParcelWeight',
      'Grams',
      'ParcelWeightGrams',
      'WeightInGrams',
      'NetWeightGrams',
      'WeightG',
      'DepotWeight',
    ])
  })

  it('reads a pick, and refuses a name that was never offered', async () => {
    useTransport(
      answers({ name: 'weightGrams', reason: 'Carries its unit.', model: 'claude-haiku-4-5-20251001' }),
    )

    const pick = await worker().llmPick({
      descriptor: DESCRIPTOR,
      code: CODE,
      candidates: CANDIDATES,
    })

    expect(pick).toEqual({
      name: 'weightGrams',
      reason: 'Carries its unit.',
      model: 'claude-haiku-4-5-20251001',
    })

    useTransport(
      answers({ name: 'parcelMass', reason: 'A name nobody proposed.', model: 'claude-haiku-4-5-20251001' }),
    )

    await expect(
      worker().llmPick({ descriptor: DESCRIPTOR, code: CODE, candidates: CANDIDATES }),
    ).rejects.toMatchObject({ reason: 'provider error' })
  })

  it('asks for a brief, carrying the prose it is replacing', async () => {
    useTransport(answers({ descriptor: BRIEF }))

    const descriptor = await worker().generateDescriptor(DESCRIPTOR)
    const call = firstCall()

    expect(call.url).toBe(
      'https://naming-things-worker.example.workers.dev/api/llm/descriptor',
    )
    expect(bodyOf(call)).toEqual({ avoid: DESCRIPTOR })
    expect(descriptor).toBe(BRIEF)
  })

  it('sends nothing to steer away from when there is no prose to replace', async () => {
    useTransport(answers({ descriptor: BRIEF }))

    await worker().generateDescriptor()

    expect(bodyOf(firstCall())).toEqual({})
  })

  it('refuses a brief too short to have a property named in it', async () => {
    useTransport(answers({ descriptor: 'A parcel that needs a name.' }))

    await expect(worker().generateDescriptor()).rejects.toMatchObject({
      reason: 'provider error',
    })
  })

  it('reads the flat Jev answer the Worker has already unwrapped', async () => {
    useTransport(
      answers({
        choice: 'weightGrams',
        confidence: 0.71,
        probabilities: PROBABILITIES,
        model: 'jev-1.13.0',
      }),
    )

    const pick = await worker().jevChoice(STATE)

    expect(firstCall().url).toBe(
      'https://naming-things-worker.example.workers.dev/api/jev/choice',
    )
    expect(pick.choice).toBe('weightGrams')
    expect(pick.confidence).toBe(0.71)
    expect(pick.model).toBe('jev-1.13.0')
  })

  it('reads an omitted confidence as unstated rather than as zero', async () => {
    useTransport(
      answers({ choice: 'weight', probabilities: PROBABILITIES, model: 'jev-1.13.0' }),
    )

    await expect(worker().jevChoice(STATE)).resolves.toMatchObject({ confidence: null })
  })

  it('refuses a distribution scoring something that was never offered', async () => {
    useTransport(
      answers({
        choice: 'weight',
        confidence: 0.5,
        probabilities: { ...PROBABILITIES, parcelMass: 0.4 },
        model: 'jev-1.13.0',
      }),
    )

    await expect(worker().jevChoice(STATE)).rejects.toMatchObject({ reason: 'provider error' })
  })
})

describe('RemoteApiClient failure classification', () => {
  const input = { descriptor: DESCRIPTOR, val: DEFAULT_VAL() }

  it('calls a quota stop a quota stop', async () => {
    useTransport(refuses(429, 'quota_exceeded'))

    await expect(worker().generateCandidates(input)).rejects.toMatchObject({
      reason: 'quota exceeded',
    })
  })

  it('calls an unconfigured deployment unavailable, whichever binding it is missing', async () => {
    useTransport(refuses(503, 'llm_unconfigured'))

    await expect(worker().generateCandidates(input)).rejects.toMatchObject({
      reason: 'service unavailable',
    })

    useTransport(refuses(503, 'ratelimit_unconfigured'))

    await expect(worker().generateCandidates(input)).rejects.toMatchObject({
      reason: 'service unavailable',
    })
  })

  it('calls an overloaded provider busy, whichever side reported it', async () => {
    useTransport(refuses(502, 'llm_upstream_busy'))

    await expect(worker().generateCandidates(input)).rejects.toMatchObject({
      reason: 'upstream busy',
    })

    useTransport(refuses(502, 'jev_upstream_busy'))

    await expect(worker().generateCandidates(input)).rejects.toMatchObject({
      reason: 'upstream busy',
    })
  })

  /**
   * A run on the visitor's own keys has no Worker in front of it, so overload
   * arrives as a status and a body this app did not write. The status is enough
   * to tell that case from a provider refusing on the merits.
   */
  it('reads a bare overload status as busy even with nothing to read in the body', async () => {
    useTransport(refuses(529, 'overloaded_error'))

    await expect(worker().generateCandidates(input)).rejects.toMatchObject({
      reason: 'upstream busy',
    })
  })

  it('calls anything else upstream a provider error', async () => {
    useTransport(refuses(500, 'llm_upstream_error'))

    await expect(worker().generateCandidates(input)).rejects.toMatchObject({
      reason: 'provider error',
    })
  })

  it('reads an HTML error page as a provider error, not as a parse failure', async () => {
    useTransport(servesHtml(502))

    await expect(worker().generateCandidates(input)).rejects.toMatchObject({
      reason: 'provider error',
    })

    useTransport(servesHtml(200))

    await expect(worker().generateCandidates(input)).rejects.toMatchObject({
      reason: 'provider error',
    })
  })

  it('reads a malformed but successful answer as a provider error', async () => {
    useTransport(answers({ descriptor: DESCRIPTOR, code: CODE, candidates: CANDIDATES.slice(1) }))

    await expect(worker().generateCandidates(input)).rejects.toMatchObject({
      reason: 'provider error',
    })
  })

  it('calls a connection that never opened a network error', async () => {
    useTransport(offline())

    await expect(worker().generateCandidates(input)).rejects.toBeInstanceOf(LiveCallError)

    useTransport(offline())

    await expect(worker().generateCandidates(input)).rejects.toMatchObject({
      reason: 'network error',
    })
  })
})

describe('RemoteApiClient, with the visitor’s own keys', () => {
  it('forces the tool call, and says out loud that it is a browser', async () => {
    useTransport(
      answers({
        content: [
          { type: 'text', text: 'Thinking out loud before the tool call.' },
          {
            type: 'tool_use',
            name: 'propose_properties',
            input: { code: CODE, properties: CANDIDATES },
          },
        ],
      }),
    )

    const draft = await new RemoteApiClient(KEYS).generateCandidates({
      descriptor: DESCRIPTOR,
      val: DEFAULT_VAL(),
    })
    const call = firstCall()

    expect(call.url).toBe('https://api.anthropic.com/v1/messages')
    expect(headersOf(call)['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(headersOf(call)['x-api-key']).toBe(KEYS.anthropicKey)
    expect(bodyOf(call).tool_choice).toEqual({ type: 'tool', name: 'propose_properties' })
    expect(draft.descriptor).toBe(DESCRIPTOR)
    expect(draft.candidates).toHaveLength(10)
  })

  it('asks for the casing as a requirement, and holds the answer to it', async () => {
    useTransport(
      answers({
        content: [
          {
            type: 'tool_use',
            name: 'propose_properties',
            input: { code: CODE, properties: CANDIDATES },
          },
        ],
      }),
    )

    const draft = await new RemoteApiClient(KEYS).generateCandidates({
      descriptor: DESCRIPTOR,
      val: { ...DEFAULT_VAL(), naming: 'snake_case' },
    })
    const prompt = String((bodyOf(firstCall()).messages as { content: string }[])[0]?.content)

    expect(prompt).toContain('Write every one of the 10 names in snake_case')
    expect(prompt).not.toContain('casing snake_case')
    expect(draft.candidates.map(({ name }) => name)).toEqual([
      'weight',
      'weight_grams',
      'mass_grams',
      'parcel_weight',
      'grams',
      'parcel_weight_grams',
      'weight_in_grams',
      'net_weight_grams',
      'weight_g',
      'depot_weight',
    ])
  })

  it('asks a Caveman run for single syllables alongside the casing', async () => {
    useTransport(
      answers({
        content: [
          {
            type: 'tool_use',
            name: 'propose_properties',
            input: { code: CODE, properties: CANDIDATES },
          },
        ],
      }),
    )

    await new RemoteApiClient(KEYS).generateCandidates({
      descriptor: DESCRIPTOR,
      val: { ...DEFAULT_VAL(), preset: 'caveman' },
    })

    const prompt = String((bodyOf(firstCall()).messages as { content: string }[])[0]?.content)

    expect(prompt).toContain('Every word of every one of the 10 names is a single syllable')
    expect(prompt).toContain('Write every one of the 10 names in camelCase')
  })

  it('adds no rule for a preset that is only a position of the chips', async () => {
    useTransport(
      answers({
        content: [
          {
            type: 'tool_use',
            name: 'propose_properties',
            input: { code: CODE, properties: CANDIDATES },
          },
        ],
      }),
    )

    await new RemoteApiClient(KEYS).generateCandidates({
      descriptor: DESCRIPTOR,
      val: { ...DEFAULT_VAL(), preset: 'golf' },
    })

    const prompt = String((bodyOf(firstCall()).messages as { content: string }[])[0]?.content)

    expect(prompt).not.toContain('single syllable')
    expect(prompt).not.toContain('golf')
  })

  it('writes a brief through the same forced tool call', async () => {
    useTransport(
      answers({
        content: [{ type: 'tool_use', name: 'write_descriptor', input: { descriptor: BRIEF } }],
      }),
    )

    const descriptor = await new RemoteApiClient(KEYS).generateDescriptor(DESCRIPTOR)
    const call = firstCall()

    expect(call.url).toBe('https://api.anthropic.com/v1/messages')
    expect(bodyOf(call).tool_choice).toEqual({ type: 'tool', name: 'write_descriptor' })
    expect(String((bodyOf(call).messages as { content: string }[])[0]?.content)).toContain(
      `<avoid>\n${DESCRIPTOR}\n</avoid>`,
    )
    expect(descriptor).toBe(BRIEF)
  })

  it('asks System One its one question and unwraps the envelope', async () => {
    useTransport(
      answers({
        model: 'jev-1.13.0',
        answers: {
          best_property: {
            type: 'choice',
            choice: 'weightGrams',
            confidence: 0.71,
            probabilities: PROBABILITIES,
          },
        },
      }),
    )

    const pick = await new RemoteApiClient(KEYS).jevChoice(STATE)
    const call = firstCall()
    const question = (bodyOf(call).questions as Record<string, { criteria: Record<string, string> }>)
      .best_property

    expect(call.url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(headersOf(call).Authorization).toBe(`Bearer ${KEYS.typesafeKey}`)
    expect(Object.keys(question?.criteria ?? {})).toEqual(CANDIDATES.map((one) => one.name))
    expect(pick.choice).toBe('weightGrams')
    expect(pick.model).toBe('jev-1.13.0')
  })

  it('refuses an envelope that answered as a different judge', async () => {
    useTransport(
      answers({
        model: 'jev-0.9.0',
        answers: {
          best_property: { type: 'choice', choice: 'weight', probabilities: PROBABILITIES },
        },
      }),
    )

    await expect(new RemoteApiClient(KEYS).jevChoice(STATE)).rejects.toMatchObject({
      reason: 'provider error',
    })
  })

  it('refuses an envelope with no answer in it', async () => {
    useTransport(answers({ model: 'jev-1.13.0', answers: {} }))

    await expect(new RemoteApiClient(KEYS).jevChoice(STATE)).rejects.toMatchObject({
      reason: 'provider error',
    })
  })
})
