/**
 * The one seam every model call goes through.
 *
 * The pipeline is written against this interface and nothing else, so sample
 * mode, the Worker-proxied live mode and a bring-your-own-key mode are three
 * implementations rather than three branches in the run logic. Nothing here
 * mentions HTTP, keys or the DOM.
 */

import type { Candidate, JevPick, JevState, LlmPick, StyleVal } from '../core/types'

/** What a run knows before any model has spoken: the prose and the taste. */
export interface GenerateCandidatesInput {
  descriptor: string
  val: StyleVal
}

/**
 * The first round trip's whole output.
 *
 * The code sketch comes back from the same call as the candidates because the
 * two have to agree — candidates for a field that the sketch does not contain
 * would read as nonsense on the cards. `descriptor` is echoed rather than
 * assumed so the caller can build the Jev state from one consistent packet.
 */
export interface CandidateDraft {
  descriptor: string
  code: string
  candidates: Candidate[]
}

/** What the plain model sees when asked to choose: the prose, the sketch, the five. */
export interface LlmPickInput {
  descriptor: string
  code: string
  candidates: Candidate[]
}

/**
 * The three calls one head-to-head run needs.
 *
 * There are three methods and two round trips: `generateCandidates` produces
 * the sketch and the options together, then `llmPick` and `jevChoice` race
 * over that same material.
 */
export interface ApiClient {
  generateCandidates(input: GenerateCandidatesInput): Promise<CandidateDraft>
  llmPick(input: LlmPickInput): Promise<LlmPick>
  jevChoice(state: JevState): Promise<JevPick>
}
