/**
 * The one sequence behind a run.
 *
 * A descriptor and a style go in; a finished head-to-head comes out. Every
 * model call goes through `ApiClient`, so this module never learns whether it
 * is driving a Worker proxy or someone's own key — the hosted run and a
 * bring-your-own-keys run are two clients, not two code paths. Nothing here
 * touches the DOM or a Node built-in.
 */

import type { ApiClient, CandidateDraft } from '../api/client'
import type {
  Candidate,
  JevPick,
  JevState,
  LlmPick,
  RunResult,
  RunStage,
  StyleVal,
} from './types'

/** Longer than this is not a description of a thing, it is a document. */
const MAX_DESCRIPTOR_LENGTH = 1200

/** The serialized-state budget the System One judge is held to elsewhere. */
const MAX_STATE_BYTES = 8192

/**
 * Raised when a run cannot start from what the visitor typed.
 *
 * This throws out of `runPipeline` before the first round trip, so an empty box
 * or a pasted novel costs nothing.
 */
export class PipelineInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PipelineInputError'
  }
}

/**
 * Raised when the assembled Jev state will not fit the byte budget.
 *
 * It carries the measured size as well as the limit, because "too large" with
 * no number is not something a visitor can act on.
 */
export class StateTooLargeError extends Error {
  readonly bytes: number
  readonly limit: number

  constructor(bytes: number) {
    super(`jev state is ${bytes} bytes, over the ${MAX_STATE_BYTES}-byte budget`)
    this.name = 'StateTooLargeError'
    this.bytes = bytes
    this.limit = MAX_STATE_BYTES
  }
}

/** Everything the Jev state is built from, in one packet. */
export interface JevStateInput {
  descriptor: string
  code: string
  candidates: Candidate[]
  val: StyleVal
}

/** What a run starts from: the prose to name things in, and the taste to do it with. */
export interface RunInput {
  descriptor: string
  val: StyleVal
}

/**
 * One stage reaching its end, reported the moment it does.
 *
 * Only the two picks can report a failure: losing the candidates leaves nothing
 * to choose between, so that failure ends the run instead of arriving here.
 */
export type RunStageEvent =
  | { stage: 'candidates'; failed: false; code: string; candidates: Candidate[] }
  | { stage: 'llmPick'; failed: false; llm: LlmPick }
  | { stage: 'jevPick'; failed: false; jev: JevPick }
  | { stage: Exclude<RunStage, 'candidates'>; failed: true; error: Error }

/** How a caller watches a run unfold. Called in completion order, never in a fixed one. */
export type StageListener = (event: RunStageEvent) => void

/** Anything thrown, as an Error, so callers never have to guess at a reason's shape. */
function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

/**
 * The stand-in for an LLM pick that never arrived.
 *
 * An empty name is a value no successful pick can hold — the parser requires
 * every candidate name to be a JavaScript identifier — so the renderer can read
 * it as "this side failed" without a second flag to carry around.
 */
function failedLlmPick(error: Error): LlmPick {
  // No model answered, so there is no judge to name on the badge either.
  return { name: '', reason: error.message, model: '' }
}

/**
 * The same stand-in for the Jev side.
 *
 * The envelope has nowhere to put a message, so the reason travels on the
 * `jevPick` stage event rather than being wedged into `model`.
 */
function failedJevPick(): JevPick {
  return { choice: '', confidence: null, probabilities: {}, model: '' }
}

/**
 * Assemble the state handed to Jev, or refuse it for being too big.
 *
 * The four keys are spelled `descriptor`, `code`, `candidates` and `val`, in
 * that order, because the model reads them as labels: renaming or reordering
 * one changes what an answer means. `val` is always present, even when the
 * visitor never touched a slider, since making the imported style visible to
 * the judge is the whole point of the style import.
 */
export function buildJevState(input: JevStateInput): JevState {
  const state: JevState = {
    descriptor: input.descriptor,
    code: input.code,
    candidates: input.candidates,
    val: input.val,
  }

  const bytes = new TextEncoder().encode(JSON.stringify(state)).length

  if (bytes > MAX_STATE_BYTES) {
    throw new StateTooLargeError(bytes)
  }

  return state
}

/**
 * Run one head-to-head: generate the options, then race the two judges.
 *
 * The two picks go out concurrently and are collected with `Promise.allSettled`
 * rather than `Promise.all`, so a Jev outage still shows the plain model's
 * answer and vice versa; each failure is reported on its own stage and leaves a
 * blank-named pick in the result. Both sides failing still returns the
 * candidates, because ten cards over an error strip beat an empty page.
 */
export async function runPipeline(
  client: ApiClient,
  input: RunInput,
  onStage?: StageListener,
): Promise<RunResult> {
  const descriptor = input.descriptor.trim()

  if (descriptor.length === 0) {
    throw new PipelineInputError('descriptor is empty')
  }

  if (descriptor.length > MAX_DESCRIPTOR_LENGTH) {
    throw new PipelineInputError(
      `descriptor is ${descriptor.length} characters, over the ${MAX_DESCRIPTOR_LENGTH}-character limit`,
    )
  }

  // A listener is a UI detail, and a bug in one must not take the run down
  // with it: a thrown callback loses that notification and nothing else.
  const emit = (event: RunStageEvent): void => {
    if (onStage === undefined) {
      return
    }

    try {
      onStage(event)
    } catch {
      /* the run outlives a broken listener */
    }
  }

  const draft: CandidateDraft = await client.generateCandidates({ descriptor, val: input.val })

  emit({ stage: 'candidates', failed: false, code: draft.code, candidates: draft.candidates })

  const llmTracked = (async (): Promise<LlmPick> => {
    try {
      const llm = await client.llmPick({
        descriptor: draft.descriptor,
        code: draft.code,
        candidates: draft.candidates,
      })

      emit({ stage: 'llmPick', failed: false, llm })

      return llm
    } catch (reason: unknown) {
      const error = toError(reason)

      emit({ stage: 'llmPick', failed: true, error })

      throw error
    }
  })()

  const jevTracked = (async (): Promise<JevPick> => {
    try {
      // Built inside the branch so an over-budget state costs the Jev side
      // alone — and still throws before the call goes out, not after.
      const state = buildJevState({
        descriptor: draft.descriptor,
        code: draft.code,
        candidates: draft.candidates,
        val: input.val,
      })
      const jev = await client.jevChoice(state)

      emit({ stage: 'jevPick', failed: false, jev })

      return jev
    } catch (reason: unknown) {
      const error = toError(reason)

      emit({ stage: 'jevPick', failed: true, error })

      throw error
    }
  })()

  const [llmOutcome, jevOutcome] = await Promise.allSettled([llmTracked, jevTracked])

  const llm =
    llmOutcome.status === 'fulfilled' ? llmOutcome.value : failedLlmPick(toError(llmOutcome.reason))
  const jev = jevOutcome.status === 'fulfilled' ? jevOutcome.value : failedJevPick()

  return {
    descriptor: draft.descriptor,
    code: draft.code,
    candidates: draft.candidates,
    llm,
    jev,
    val: input.val,
    // Exact string comparison, because both sides are spelling the same
    // candidate name — but only when both sides actually answered, or two
    // blank stand-ins would read as unanimous agreement.
    agree:
      llmOutcome.status === 'fulfilled' &&
      jevOutcome.status === 'fulfilled' &&
      llm.name === jev.choice,
  }
}

/**
 * Ask Jev again about the run already on the page, under a new style.
 *
 * The previous `RunResult` is the whole input rather than a handful of loose
 * arguments, so there is no way to re-ask about candidates a visitor never saw.
 * The state goes through `buildJevState` exactly as a first run's does, which is
 * what holds both paths to the same byte budget and the same key order, and an
 * over-budget style is refused here before the call goes out.
 *
 * Nothing is regenerated: the same ten candidates and the same LLM pick come
 * back untouched, and only the Jev answer, the style and the agreement flag are
 * new. Holding the other judge still is the point — a pick that moves when the
 * only thing that changed is `val` is the style import doing something visible.
 */
export async function reaskJev(
  client: ApiClient,
  previous: RunResult,
  val: StyleVal,
): Promise<RunResult> {
  // A re-ask is meaningless without a run behind it, and a caller reaching this
  // function directly has no disabled button standing in its way.
  if (previous === null || previous === undefined || previous.candidates.length === 0) {
    throw new PipelineInputError('re-ask needs a finished run: there are no candidates to re-ask about')
  }

  const state = buildJevState({
    descriptor: previous.descriptor,
    code: previous.code,
    candidates: previous.candidates,
    val,
  })

  const jev = await client.jevChoice(state)

  return {
    descriptor: previous.descriptor,
    code: previous.code,
    candidates: previous.candidates,
    llm: previous.llm,
    jev,
    val,
    // Recomputed rather than carried over, because flipping DISAGREE to AGREE
    // without a second draft is the thing this button exists to show. A run
    // whose LLM side failed carries a blank name, and blank matching blank
    // would read as unanimous agreement instead of as two missing answers.
    agree: previous.llm.name !== '' && jev.choice !== '' && previous.llm.name === jev.choice,
  }
}
