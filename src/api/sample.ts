/**
 * The zero-key implementation of `ApiClient`.
 *
 * Every answer is a slice of `SAMPLE_RUN`, handed back after a short pause so
 * the per-stage loading states in the UI are something a visitor can actually
 * see. No network, no keys, no environment: this is the client the page falls
 * back to when nothing else is configured.
 *
 * It also answers the one question a canned run raises: whether the prose on
 * the page is the prose those canned answers were written about. The cards
 * cannot show that difference, so something has to be able to state it.
 */

import { pickRandomDescriptor } from '../core/descriptors'
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

/** One comparable form: the same words, without the spacing or the case. */
function comparable(descriptor: string): string {
  return descriptor.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Whether the canned answers are actually about this prose.
 *
 * Sample mode serves one courier job's five names whatever the box says, and
 * from the cards alone that is indistinguishable from a live run that happened
 * to be about a parcel. This is the question that separates the two, asked of
 * the descriptor because the descriptor is the only part of a canned run the
 * visitor wrote.
 *
 * Spacing and case are not part of it. Prose that came back from a textarea
 * with a stray newline is still the fixture's, and a visitor who lower-cased a
 * word has not changed the thing being described.
 */
export function describesSampleRun(descriptor: string): boolean {
  return comparable(descriptor) === comparable(SAMPLE_RUN.descriptor)
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

  /**
   * A brief out of the local bank, since a canned client has no model to ask.
   *
   * The one method here that does not pause. The three above are answers a run
   * waits on, and their delays are what make the per-stage spinners visible;
   * Randomize is a button that swaps the text in a box, and a spinner over a
   * lookup would be theatre rather than feedback.
   */
  generateDescriptor(avoid?: string): Promise<string> {
    return Promise.resolve(pickRandomDescriptor(avoid))
  }
}
