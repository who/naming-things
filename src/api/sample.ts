/**
 * The zero-key implementation of `ApiClient`.
 *
 * Every answer is a slice of `SAMPLE_RUN`, handed back after a short pause so
 * the per-stage loading states in the UI are something a visitor can actually
 * see. No network, no keys, no environment: this is the client the page falls
 * back to when nothing else is configured.
 */

import { parseCandidates } from '../core/parseCandidates'
import type { JevPick, JevState, LlmPick } from '../core/types'
import { SAMPLE_RUN } from '../fixtures/sampleRun'
import type {
  ApiClient,
  CandidateDraft,
  GenerateCandidatesInput,
  LlmPickInput,
} from './client'

/**
 * Per-stage pauses, in milliseconds.
 *
 * They are long enough to read a spinner and short enough that the three of
 * them together stay well inside the budget for one sample run.
 */
const CANDIDATES_DELAY_MS = 350
const LLM_PICK_DELAY_MS = 200
const JEV_CHOICE_DELAY_MS = 250

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

export class SampleApiClient implements ApiClient {
  /**
   * Hand back the canned sketch and the canned five.
   *
   * The fixture goes through `parseCandidates` rather than around it, so the
   * canned path and the live path are held to one validation contract and a
   * fixture that drifted out of shape fails here instead of on the cards. The
   * descriptor echoed back is the visitor's, not the fixture's: someone who
   * edited the prose should keep seeing their own words above the results,
   * even though the answers below are canned.
   */
  async generateCandidates(input: GenerateCandidatesInput): Promise<CandidateDraft> {
    await pause(CANDIDATES_DELAY_MS)

    return {
      descriptor: input.descriptor,
      code: SAMPLE_RUN.code,
      candidates: parseCandidates(SAMPLE_RUN.candidates.map((candidate) => ({ ...candidate }))),
    }
  }

  async llmPick(_input: LlmPickInput): Promise<LlmPick> {
    await pause(LLM_PICK_DELAY_MS)

    return { ...SAMPLE_RUN.llm }
  }

  async jevChoice(_state: JevState): Promise<JevPick> {
    await pause(JEV_CHOICE_DELAY_MS)

    return { ...SAMPLE_RUN.jev, probabilities: { ...SAMPLE_RUN.jev.probabilities } }
  }
}
