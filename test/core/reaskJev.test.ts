import { describe, expect, it } from 'vitest'

import type {
  ApiClient,
  CandidateDraft,
  GenerateCandidatesInput,
  LlmPickInput,
} from '../../src/api/client'
import { PipelineInputError, reaskJev, StateTooLargeError } from '../../src/core/pipeline'
import {
  DEFAULT_VAL,
  type Candidate,
  type JevPick,
  type JevState,
  type LlmPick,
  type PreferTag,
  type RunResult,
  type StyleVal,
} from '../../src/core/types'

const DESCRIPTOR = 'A courier delivery job with a parcel that has to be weighed.'

const CODE = 'interface DeliveryJob {\n  // the parcel, weighed in grams\n}'

const CANDIDATES: Candidate[] = [
  { name: 'weight', typeHint: 'number', why: 'The plain noun.' },
  { name: 'weightGrams', typeHint: 'number', why: 'Carries its unit.' },
  { name: 'massGrams', typeHint: 'number', why: 'The physically correct word.' },
  { name: 'parcelWeight', typeHint: 'number', why: 'Says what is being weighed.' },
  { name: 'grams', typeHint: 'number', why: 'The unit, standing in for the quantity.' },
]

const LLM_PICK: LlmPick = {
  name: 'weight',
  reason: 'Shortest name that still reads.',
  model: 'claude-haiku-4-5-20251001',
}

const JEV_PICK: JevPick = {
  choice: 'weightGrams',
  confidence: 0.71,
  probabilities: { weight: 0.14, weightGrams: 0.52, massGrams: 0.16, parcelWeight: 0.1, grams: 0.08 },
  model: 'jev-1.13.0',
}

/** The same envelope after the style talked it round to the short name. */
const SHORT_NAME_PICK: JevPick = {
  choice: 'weight',
  confidence: 0.64,
  probabilities: { weight: 0.58, weightGrams: 0.22, massGrams: 0.1, parcelWeight: 0.06, grams: 0.04 },
  model: 'jev-1.13.0',
}

/**
 * A finished run, exactly as the page would be holding it when Re-ask is clicked.
 *
 * Built fresh per test so an implementation that mutated what it was handed
 * cannot leak that mutation into the next assertion.
 */
function previousRun(overrides: Partial<RunResult> = {}): RunResult {
  return {
    descriptor: DESCRIPTOR,
    code: CODE,
    candidates: CANDIDATES.map((candidate) => ({ ...candidate })),
    llm: { ...LLM_PICK },
    jev: { ...JEV_PICK, probabilities: { ...JEV_PICK.probabilities } },
    val: DEFAULT_VAL(),
    agree: false,
    ...overrides,
  }
}

/** A style that says the opposite of the default, so it cannot pass unnoticed. */
function shortNameVal(): StyleVal {
  return {
    naming: 'snake_case',
    prefer: ['id-like', 'booleans-as-isX'],
    weights: { shortNames: 1, explicitUnits: 0, nullable: 0.2 },
  }
}

/**
 * An `ApiClient` that records every call and answers only the Jev side.
 *
 * The other two methods throw rather than return: a re-ask that regenerated
 * candidates or re-asked the LLM would be the one failure this issue exists to
 * prevent, so the stub makes that failure loud instead of merely countable.
 */
class JevOnlyClient implements ApiClient {
  readonly seen: { generate: GenerateCandidatesInput[]; llm: LlmPickInput[]; jev: JevState[] } = {
    generate: [],
    llm: [],
    jev: [],
  }

  constructor(private readonly answer: JevPick | Error = JEV_PICK) {}

  async generateCandidates(input: GenerateCandidatesInput): Promise<CandidateDraft> {
    this.seen.generate.push(input)

    throw new Error('a re-ask must not generate candidates')
  }

  async llmPick(input: LlmPickInput): Promise<LlmPick> {
    this.seen.llm.push(input)

    throw new Error('a re-ask must not ask the LLM again')
  }

  generateDescriptor(): Promise<string> {
    throw new Error('a re-ask must not rewrite the brief it is about')
  }

  async jevChoice(state: JevState): Promise<JevPick> {
    this.seen.jev.push(state)

    if (this.answer instanceof Error) {
      throw this.answer
    }

    return this.answer
  }
}

describe('reaskJev', () => {
  it('asks Jev alone, and hands back the same candidates and LLM pick', async () => {
    const client = new JevOnlyClient()
    const previous = previousRun()

    const result = await reaskJev(client, previous, DEFAULT_VAL())

    expect(client.seen.generate).toHaveLength(0)
    expect(client.seen.llm).toHaveLength(0)
    expect(client.seen.jev).toHaveLength(1)
    expect(result.candidates).toEqual(previous.candidates)
    expect(result.llm).toEqual(LLM_PICK)
    expect(result.descriptor).toBe(DESCRIPTOR)
    expect(result.code).toBe(CODE)
  })

  it('carries the style it was given into the state Jev reads', async () => {
    const client = new JevOnlyClient()
    const val = shortNameVal()

    const result = await reaskJev(client, previousRun(), val)

    const state = client.seen.jev[0]

    expect(state?.val).toEqual(val)
    expect(state?.descriptor).toBe(DESCRIPTOR)
    expect(state?.candidates).toEqual(CANDIDATES)
    expect(result.val).toEqual(val)
  })

  it('flips a disagreement to agreement when the new choice matches the standing pick', async () => {
    const client = new JevOnlyClient(SHORT_NAME_PICK)
    const previous = previousRun()

    const result = await reaskJev(client, previous, shortNameVal())

    expect(previous.agree).toBe(false)
    expect(result.jev.choice).toBe('weight')
    expect(result.llm.name).toBe('weight')
    expect(result.agree).toBe(true)
  })

  it('keeps the verdict at disagreement while the two sides still differ', async () => {
    const client = new JevOnlyClient()

    const result = await reaskJev(client, previousRun(), shortNameVal())

    expect(result.agree).toBe(false)
  })

  it('does not read two missing answers as a unanimous one', async () => {
    const client = new JevOnlyClient({ choice: '', confidence: null, probabilities: {}, model: '' })
    const previous = previousRun({ llm: { name: '', reason: 'the LLM side failed', model: '' } })

    const result = await reaskJev(client, previous, DEFAULT_VAL())

    expect(result.agree).toBe(false)
  })

  it('leaves the previous run untouched when Jev refuses to answer', async () => {
    const refusal = new Error('jev choice failed: 503')
    const client = new JevOnlyClient(refusal)
    const previous = previousRun()
    const before = structuredClone(previous)

    await expect(reaskJev(client, previous, shortNameVal())).rejects.toThrow(refusal)

    expect(previous).toEqual(before)
  })

  it('refuses a re-ask that has no run behind it', async () => {
    const client = new JevOnlyClient()
    const nothing = previousRun({ candidates: [] })

    await expect(reaskJev(client, nothing, DEFAULT_VAL())).rejects.toBeInstanceOf(
      PipelineInputError,
    )
    expect(client.seen.jev).toHaveLength(0)
  })

  it('refuses a style too large for the state budget before the call goes out', async () => {
    const client = new JevOnlyClient()
    const bloated: StyleVal = {
      ...DEFAULT_VAL(),
      prefer: Array.from({ length: 3000 }, (): PreferTag => 'id-like'),
    }

    await expect(reaskJev(client, previousRun(), bloated)).rejects.toBeInstanceOf(StateTooLargeError)
    expect(client.seen.jev).toHaveLength(0)
  })
})
