import { describe, expect, it } from 'vitest'

import { parseCandidates } from '../../src/core/parseCandidates'
import { SAMPLE_RUN } from './sampleRun'

/** Floating-point addition of ten literals lands near 1, not on it. */
const PROBABILITY_TOLERANCE = 5

/**
 * The fixture, held to the shape a real run has.
 *
 * Every rendering test draws from this one object, so a fixture that drifted
 * out of shape would not fail here — it would fail as a run of assertions
 * elsewhere that all quietly stopped testing the case they were written for.
 */
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
