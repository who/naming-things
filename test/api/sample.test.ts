import { describe, expect, it } from 'vitest'

import { describesSampleRun, SampleApiClient } from '../../src/api/sample'
import { parseCandidates } from '../../src/core/parseCandidates'
import { DEFAULT_VAL } from '../../src/core/types'
import { SAMPLE_RUN } from '../../src/fixtures/sampleRun'

/** Floating-point addition of ten literals lands near 1, not on it. */
const PROBABILITY_TOLERANCE = 5

/** A sample run that takes longer than this stops reading as a demo. */
const SAMPLE_RUN_BUDGET_MS = 1200

/** A descriptor nobody would mistake for the canned one. */
const EDITED_DESCRIPTOR = 'A library loan. A member borrows a book until a due date.'

describe('SAMPLE_RUN', () => {
  it('satisfies the production parser', () => {
    const parsed = parseCandidates(SAMPLE_RUN.candidates.map((candidate) => ({ ...candidate })))

    expect(parsed).toHaveLength(10)
    expect(parsed.map((candidate) => candidate.name)).toContain(SAMPLE_RUN.jev.choice)
  })

  it('encodes a disagreement between the two models', () => {
    expect(SAMPLE_RUN.llm.name).not.toBe(SAMPLE_RUN.jev.choice)
    expect(SAMPLE_RUN.candidates.map((candidate) => candidate.name)).toContain(SAMPLE_RUN.llm.name)
  })

  it('scores every candidate, and only the candidates', () => {
    expect(Object.keys(SAMPLE_RUN.jev.probabilities).sort()).toEqual(
      SAMPLE_RUN.candidates.map((candidate) => candidate.name).sort(),
    )
  })

  it('carries probabilities that sum to one', () => {
    const total = Object.values(SAMPLE_RUN.jev.probabilities).reduce((sum, p) => sum + p, 0)

    expect(total).toBeCloseTo(1, PROBABILITY_TOLERANCE)
  })

  it('reports a believable confidence and a named model', () => {
    expect(SAMPLE_RUN.jev.confidence).toBe(0.71)
    expect(SAMPLE_RUN.jev.model).toBe('jev-1.13.0')
  })
})

describe('describesSampleRun', () => {
  it('recognizes the fixture prose through spacing and case', () => {
    const retyped = `\n  ${SAMPLE_RUN.descriptor.toUpperCase().replace(/ /g, '\n   ')}  `

    expect(describesSampleRun(retyped)).toBe(true)
  })

  it('does not recognize prose the canned answers are not about', () => {
    expect(describesSampleRun(EDITED_DESCRIPTOR)).toBe(false)
  })

  it('reads an empty box as prose of its own, not as the fixture', () => {
    expect(describesSampleRun('   ')).toBe(false)
  })
})

describe('SampleApiClient', () => {
  it('echoes the descriptor it was given rather than the fixture one', async () => {
    const draft = await new SampleApiClient().generateCandidates({
      descriptor: EDITED_DESCRIPTOR,
      val: DEFAULT_VAL(),
    })

    expect(draft.descriptor).toBe(EDITED_DESCRIPTOR)
    expect(draft.code).toBe(SAMPLE_RUN.code)
    expect(draft.candidates).toHaveLength(10)
  })

  it('answers edited prose with the fixture, which the descriptor check can see', async () => {
    const draft = await new SampleApiClient().generateCandidates({
      descriptor: EDITED_DESCRIPTOR,
      val: DEFAULT_VAL(),
    })

    expect(draft.candidates.map((candidate) => candidate.name)).toEqual(
      SAMPLE_RUN.candidates.map((candidate) => candidate.name),
    )
    expect(describesSampleRun(draft.descriptor)).toBe(false)
  })

  it('serves a whole run from the fixture inside the budget', async () => {
    const client = new SampleApiClient()
    const startedAt = Date.now()

    const draft = await client.generateCandidates({
      descriptor: EDITED_DESCRIPTOR,
      val: DEFAULT_VAL(),
    })
    const llm = await client.llmPick({
      descriptor: draft.descriptor,
      code: draft.code,
      candidates: draft.candidates,
    })
    const jev = await client.jevChoice({
      descriptor: draft.descriptor,
      code: draft.code,
      candidates: draft.candidates,
      val: DEFAULT_VAL(),
    })

    expect(Date.now() - startedAt).toBeLessThan(SAMPLE_RUN_BUDGET_MS)
    expect(llm.name).toBe(SAMPLE_RUN.llm.name)
    expect(jev.choice).toBe(SAMPLE_RUN.jev.choice)
  })

  it('hands out copies, so one run cannot edit the fixture for the next', async () => {
    const jev = await new SampleApiClient().jevChoice({
      descriptor: EDITED_DESCRIPTOR,
      code: SAMPLE_RUN.code,
      candidates: SAMPLE_RUN.candidates.map((candidate) => ({ ...candidate })),
      val: DEFAULT_VAL(),
    })

    jev.probabilities['weight'] = 0.99

    expect(SAMPLE_RUN.jev.probabilities['weight']).toBe(0.12)
  })
})
