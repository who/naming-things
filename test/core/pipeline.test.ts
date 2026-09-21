import { describe, expect, it } from 'vitest'

import type {
  ApiClient,
  CandidateDraft,
  GenerateCandidatesInput,
  LlmPickInput,
} from '../../src/api/client'
import {
  buildJevState,
  PipelineInputError,
  runPipeline,
  StateTooLargeError,
  type RunStageEvent,
} from '../../src/core/pipeline'
import { DEFAULT_VAL, type Candidate, type JevPick, type JevState, type LlmPick } from '../../src/core/types'

/** A descriptor over the 1200-character cap, built from one repeated sentence. */
const OVERLONG_DESCRIPTOR = 'A parcel with a weight nobody has named yet. '.repeat(40)

/** A code sketch big enough to blow the 8192-byte state budget on its own. */
const OVERSIZED_CODE = 'x'.repeat(9000)

const DESCRIPTOR = 'A courier delivery job with a parcel that has to be weighed.'

const CODE = 'interface DeliveryJob {\n  // the parcel, weighed in grams\n}'

const CANDIDATES: Candidate[] = [
  { name: 'weight', typeHint: 'number', why: 'The plain noun.' },
  { name: 'weightGrams', typeHint: 'number', why: 'Carries its unit.' },
  { name: 'massGrams', typeHint: 'number', why: 'The physically correct word.' },
  { name: 'parcelWeight', typeHint: 'number', why: 'Says what is being weighed.' },
  { name: 'grams', typeHint: 'number', why: 'The unit, standing in for the quantity.' },
]

const LLM_PICK: LlmPick = { name: 'weight', reason: 'Shortest name that still reads.' }

const JEV_PICK: JevPick = {
  choice: 'weightGrams',
  confidence: 0.71,
  probabilities: { weight: 0.14, weightGrams: 0.52, massGrams: 0.16, parcelWeight: 0.1, grams: 0.08 },
  model: 'jev-1.13.0',
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

interface StubOptions {
  code?: string
  llm?: LlmPick | Error
  jev?: JevPick | Error
  llmDelayMs?: number
  jevDelayMs?: number
}

/**
 * An `ApiClient` that answers from constants and records what it was asked.
 *
 * Either pick can be handed an `Error` instead of a value, which is how the
 * partial-failure paths are driven without a network anywhere in sight.
 */
class StubApiClient implements ApiClient {
  readonly seen: { generate: GenerateCandidatesInput[]; llm: LlmPickInput[]; jev: JevState[] } = {
    generate: [],
    llm: [],
    jev: [],
  }

  constructor(private readonly options: StubOptions = {}) {}

  async generateCandidates(input: GenerateCandidatesInput): Promise<CandidateDraft> {
    this.seen.generate.push(input)

    return {
      descriptor: input.descriptor,
      code: this.options.code ?? CODE,
      candidates: CANDIDATES.map((candidate) => ({ ...candidate })),
    }
  }

  async llmPick(input: LlmPickInput): Promise<LlmPick> {
    this.seen.llm.push(input)

    await pause(this.options.llmDelayMs ?? 0)

    const llm = this.options.llm ?? LLM_PICK

    if (llm instanceof Error) {
      throw llm
    }

    return llm
  }

  async jevChoice(state: JevState): Promise<JevPick> {
    this.seen.jev.push(state)

    await pause(this.options.jevDelayMs ?? 0)

    const jev = this.options.jev ?? JEV_PICK

    if (jev instanceof Error) {
      throw jev
    }

    return jev
  }
}

describe('buildJevState', () => {
  it('spells the four keys in the order the model reads them', () => {
    const state = buildJevState({
      descriptor: DESCRIPTOR,
      code: CODE,
      candidates: CANDIDATES,
      val: DEFAULT_VAL(),
    })

    expect(Object.keys(state)).toEqual(['descriptor', 'code', 'candidates', 'val'])
  })

  it('carries the style even when the visitor never touched it', () => {
    const state = buildJevState({
      descriptor: DESCRIPTOR,
      code: CODE,
      candidates: CANDIDATES,
      val: DEFAULT_VAL(),
    })

    expect(state.val).toEqual(DEFAULT_VAL())
  })

  it('refuses a state over the byte budget, naming the size and the limit', () => {
    const build = (): JevState =>
      buildJevState({
        descriptor: DESCRIPTOR,
        code: OVERSIZED_CODE,
        candidates: CANDIDATES,
        val: DEFAULT_VAL(),
      })

    expect(build).toThrow(StateTooLargeError)

    try {
      build()
      expect.unreachable('an over-budget state must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(StateTooLargeError)
      expect((error as StateTooLargeError).limit).toBe(8192)
      expect((error as StateTooLargeError).bytes).toBeGreaterThan(8192)
    }
  })
})

describe('runPipeline', () => {
  it('returns both picks and reports a disagreement', async () => {
    const client = new StubApiClient()

    const result = await runPipeline(client, { descriptor: DESCRIPTOR, val: DEFAULT_VAL() })

    expect(result.descriptor).toBe(DESCRIPTOR)
    expect(result.code).toBe(CODE)
    expect(result.candidates).toHaveLength(5)
    expect(result.llm).toEqual(LLM_PICK)
    expect(result.jev).toEqual(JEV_PICK)
    expect(result.agree).toBe(false)
  })

  it('reports agreement when the two spell the same name', async () => {
    const client = new StubApiClient({ llm: { name: 'weightGrams', reason: 'The unit earns it.' } })

    const result = await runPipeline(client, { descriptor: DESCRIPTOR, val: DEFAULT_VAL() })

    expect(result.agree).toBe(true)
  })

  it('hands the judge a state built from the same draft the cards show', async () => {
    const client = new StubApiClient()

    const result = await runPipeline(client, { descriptor: `  ${DESCRIPTOR}  `, val: DEFAULT_VAL() })
    const state = client.seen.jev[0]

    expect(client.seen.generate[0]?.descriptor).toBe(DESCRIPTOR)
    expect(state?.descriptor).toBe(DESCRIPTOR)
    expect(state?.code).toBe(result.code)
    expect(state?.candidates).toEqual(result.candidates)
  })

  it('announces each stage as it lands, in completion order', async () => {
    const client = new StubApiClient({ llmDelayMs: 30, jevDelayMs: 0 })
    const stages: RunStageEvent['stage'][] = []

    await runPipeline(client, { descriptor: DESCRIPTOR, val: DEFAULT_VAL() }, (event) => {
      stages.push(event.stage)
    })

    expect(stages).toEqual(['candidates', 'jevPick', 'llmPick'])
  })

  it('keeps the LLM pick when Jev fails', async () => {
    const client = new StubApiClient({ jev: new Error('jev is over quota') })
    const failures: RunStageEvent[] = []

    const result = await runPipeline(client, { descriptor: DESCRIPTOR, val: DEFAULT_VAL() }, (event) => {
      if (event.failed) {
        failures.push(event)
      }
    })

    expect(result.llm).toEqual(LLM_PICK)
    expect(result.jev.choice).toBe('')
    expect(result.jev.confidence).toBeNull()
    expect(result.agree).toBe(false)
    expect(result.candidates).toHaveLength(5)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.stage).toBe('jevPick')
  })

  it('keeps the Jev choice when the LLM fails', async () => {
    const client = new StubApiClient({ llm: new Error('the model timed out') })
    const failures: RunStageEvent[] = []

    const result = await runPipeline(client, { descriptor: DESCRIPTOR, val: DEFAULT_VAL() }, (event) => {
      if (event.failed) {
        failures.push(event)
      }
    })

    expect(result.jev).toEqual(JEV_PICK)
    expect(result.llm.name).toBe('')
    expect(result.llm.reason).toBe('the model timed out')
    expect(result.agree).toBe(false)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.stage).toBe('llmPick')
  })

  it('still returns the candidates when both picks fail', async () => {
    const client = new StubApiClient({
      llm: new Error('the model timed out'),
      jev: new Error('jev is over quota'),
    })

    const result = await runPipeline(client, { descriptor: DESCRIPTOR, val: DEFAULT_VAL() })

    expect(result.candidates).toHaveLength(5)
    expect(result.code).toBe(CODE)
    expect(result.llm.name).toBe('')
    expect(result.jev.choice).toBe('')
    expect(result.agree).toBe(false)
  })

  it('charges an over-budget state to the Jev side alone, before the call goes out', async () => {
    const client = new StubApiClient({ code: OVERSIZED_CODE })
    const failures: RunStageEvent[] = []

    const result = await runPipeline(client, { descriptor: DESCRIPTOR, val: DEFAULT_VAL() }, (event) => {
      if (event.failed) {
        failures.push(event)
      }
    })

    expect(client.seen.jev).toHaveLength(0)
    expect(result.llm).toEqual(LLM_PICK)
    expect(result.jev.choice).toBe('')
    expect(failures).toHaveLength(1)
    expect(failures[0]?.failed === true ? failures[0].error : null).toBeInstanceOf(StateTooLargeError)
  })

  it('rejects an empty descriptor before any call goes out', async () => {
    const client = new StubApiClient()

    await expect(runPipeline(client, { descriptor: '   \n  ', val: DEFAULT_VAL() })).rejects.toThrow(
      PipelineInputError,
    )
    expect(client.seen.generate).toHaveLength(0)
  })

  it('rejects an over-long descriptor before any call goes out', async () => {
    const client = new StubApiClient()

    await expect(
      runPipeline(client, { descriptor: OVERLONG_DESCRIPTOR, val: DEFAULT_VAL() }),
    ).rejects.toThrow(/1200-character limit/)
    expect(client.seen.generate).toHaveLength(0)
  })

  it('survives a listener that throws on every stage', async () => {
    const client = new StubApiClient()

    const result = await runPipeline(client, { descriptor: DESCRIPTOR, val: DEFAULT_VAL() }, () => {
      throw new Error('the renderer is broken')
    })

    expect(result.llm).toEqual(LLM_PICK)
    expect(result.jev).toEqual(JEV_PICK)
  })
})
