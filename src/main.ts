import './ui/styles.css'

import type { ApiClient } from './api/client'
import { createClient } from './api/mode'
import { pickRandomDescriptor } from './core/descriptors'
import { buildJevState, reaskJev, runPipeline, type RunStageEvent } from './core/pipeline'
import type { Candidate, RunResult, RunStage, StyleVal } from './core/types'
import { clearError, setModeBanner, showError } from './ui/banner'
import { queryRefs, type UiRefs } from './ui/dom'
import {
  clearResults,
  renderCandidates,
  renderJevPick,
  renderLlmPick,
  renderStageError,
  renderVerdict,
  setStageLoading,
} from './ui/render'
import { clearStatePayload, renderStatePayload } from './ui/stateViewer'
import { loadVal, mountValControls } from './ui/valControls'

const APP_SELECTOR = '#app'

/** Every stage waits at once, and each stops waiting on its own event. */
const STAGES: readonly RunStage[] = ['candidates', 'llmPick', 'jevPick']

/**
 * Show the payload the transport would be handed for this run and this style.
 *
 * Rebuilt through the pipeline's own builder rather than assembled here, so
 * the viewer cannot show a payload that differs from the one that goes out.
 * An over-budget state throws exactly as it throws inside a run, which is why
 * the style controls route their failures to the error strip too.
 */
function showStatePayload(refs: UiRefs, run: RunResult, val: StyleVal): void {
  renderStatePayload(
    refs,
    buildJevState({
      descriptor: run.descriptor,
      code: run.code,
      candidates: run.candidates,
      val,
    }),
  )
}

/**
 * Drive one run and paint it as it arrives.
 *
 * The two picks land in whatever order they finish, so what the run has learned
 * so far is kept here and the cards are redrawn from it each time: the badge and
 * the highlighted card always agree, whichever judge answered first. Every stage
 * stops waiting the moment its event arrives, which is what makes a slow Jev
 * visible as a slow Jev rather than as a slow page.
 */
async function executeRun(refs: UiRefs, client: ApiClient, val: StyleVal): Promise<RunResult> {
  let candidates: readonly Candidate[] = []
  const highlight = { llm: '', jev: '' }

  clearResults(refs)
  clearError(refs)
  clearStatePayload(refs)

  for (const stage of STAGES) {
    setStageLoading(refs, stage, true)
  }

  const onStage = (event: RunStageEvent): void => {
    setStageLoading(refs, event.stage, false)

    if (event.failed) {
      renderStageError(refs, event.stage, event.error)

      return
    }

    switch (event.stage) {
      case 'candidates':
        candidates = event.candidates
        break
      case 'llmPick':
        highlight.llm = event.llm.name
        renderLlmPick(refs, event.llm)
        break
      case 'jevPick':
        highlight.jev = event.jev.choice
        renderJevPick(refs, event.jev, candidates)
        break
    }

    renderCandidates(refs, candidates, highlight)
  }

  try {
    const result = await runPipeline(client, { descriptor: refs.descriptor.value, val }, onStage)

    renderVerdict(refs, result)
    showStatePayload(refs, result, result.val)

    return result
  } finally {
    // A run that threw before its stages reported still has to stop spinning.
    for (const stage of STAGES) {
      setStageLoading(refs, stage, false)
    }
  }
}

/**
 * Ask Jev again about the run on the page, and repaint only its half.
 *
 * The cards and the LLM badge deliberately keep their answers: holding one
 * judge still is what makes a moved Jev pick readable as the style's doing
 * rather than as a second opinion on a second draft. The cards are redrawn only
 * so the highlighted card goes on agreeing with the badge above it. A re-ask
 * that fails leaves the previous answer standing, because a good pick is worth
 * more on screen than an empty badge over an error.
 */
async function executeReask(
  refs: UiRefs,
  client: ApiClient,
  previous: RunResult,
  val: StyleVal,
): Promise<RunResult> {
  clearError(refs)
  setStageLoading(refs, 'jevPick', true)

  try {
    const result = await reaskJev(client, previous, val)

    renderJevPick(refs, result.jev, result.candidates)
    renderCandidates(refs, result.candidates, { llm: result.llm.name, jev: result.jev.choice })
    renderVerdict(refs, result)
    showStatePayload(refs, result, result.val)

    return result
  } finally {
    setStageLoading(refs, 'jevPick', false)
  }
}

/**
 * Hydrate the page shell: resolve the element contract, seed the descriptor
 * box, mount the style controls, and wire Randomize, Run and Re-ask Jev.
 *
 * Run goes through whichever client this build and this browser add up to, and
 * through the fallback behind it, so the page works with no key and no network
 * and says which of those it is doing. The style the controls hold is the one
 * the next run carries, and moving a control after a run rewrites the visible
 * payload so the change is readable before Jev is ever asked again. Re-ask Jev
 * then spends that style on a second opinion over the same five cards, so it
 * stays disabled until a run has left something on the page worth re-asking
 * about.
 */
export function bootstrap(doc: Document = document): UiRefs {
  const refs = queryRefs(doc)
  const { client, mode } = createClient((reason) => {
    // A live run that dropped to canned answers has to say so where the mode is
    // already named. One fixed disagreement read as a live one is the demo
    // claiming something it did not do.
    setModeBanner(refs, 'sample', reason)
  })
  let running = false
  let val = loadVal()
  let lastRun: RunResult | null = null

  setModeBanner(refs, mode)

  mountValControls(refs.valControls, val, (next) => {
    val = next

    if (lastRun === null) {
      return
    }

    try {
      showStatePayload(refs, lastRun, val)
    } catch (reason: unknown) {
      // A style big enough to burst the byte budget is still a refused state,
      // and saying so beats leaving the last run's payload passing for this one.
      clearStatePayload(refs)
      showError(refs, reason)
    }
  })

  refs.descriptor.value = pickRandomDescriptor()
  refs.randomize.addEventListener('click', () => {
    refs.descriptor.value = pickRandomDescriptor(refs.descriptor.value)
  })

  refs.run.disabled = false
  refs.run.addEventListener('click', () => {
    // The disabled button already turns most double-clicks away; the flag is
    // what guarantees two runs can never interleave and paint over each other.
    if (running) {
      return
    }

    running = true
    refs.run.disabled = true

    void executeRun(refs, client, val)
      .then((result) => {
        lastRun = result
      })
      .catch((reason: unknown) => {
        // A refused descriptor or a lost draft leaves the regions empty, so the
        // reason has to be said out loud or the page just looks broken. The
        // previous run goes with it: its cards are gone from the page, and
        // re-asking about cards nobody can see is worse than not re-asking.
        lastRun = null
        showError(refs, reason)
      })
      .finally(() => {
        running = false
        refs.run.disabled = false
        refs.reaskJev.disabled = lastRun === null
      })
  })

  refs.reaskJev.addEventListener('click', () => {
    // The same pair of guards Run uses, for the same reason: the disabled
    // attribute turns the second click away, and the flag turns away the one
    // that got there first. A re-ask and a run must never paint over each other.
    if (running || lastRun === null) {
      return
    }

    const previous = lastRun

    running = true
    refs.run.disabled = true
    refs.reaskJev.disabled = true

    void executeReask(refs, client, previous, val)
      .then((result) => {
        lastRun = result
      })
      .catch((reason: unknown) => {
        showError(refs, reason)
      })
      .finally(() => {
        running = false
        refs.run.disabled = false
        refs.reaskJev.disabled = lastRun === null
      })
  })

  return refs
}

if (document.querySelector(APP_SELECTOR) !== null) {
  bootstrap()
}
