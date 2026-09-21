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
 * The three calls one head-to-head run needs, and the one that writes what a
 * run is about.
 *
 * A run is three methods over two round trips: `generateCandidates` produces
 * the sketch and the options together, then `llmPick` and `jevChoice` race
 * over that same material. `generateDescriptor` sits outside all of that — it
 * answers the Randomize button, before there is a run to speak of, and takes
 * the prose currently on screen only so the next brief is visibly a new one.
 * It lives on this interface rather than beside the bank because a mode that
 * can ask a model for a brief and one that can only shuffle canned prose are
 * the same two implementations the run calls already distinguish between.
 */
export interface ApiClient {
  generateCandidates(input: GenerateCandidatesInput): Promise<CandidateDraft>
  llmPick(input: LlmPickInput): Promise<LlmPick>
  jevChoice(state: JevState): Promise<JevPick>
  generateDescriptor(avoid?: string): Promise<string>
}
