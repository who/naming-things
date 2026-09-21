import './ui/styles.css'

import type { ApiClient } from './api/client'
import { createClient } from './api/mode'
import type { FallbackReason } from './api/remote'
import { describesSampleRun } from './api/sample'
import { pickRandomDescriptor } from './core/descriptors'
import { buildJevState, reaskJev, runPipeline, type RunStageEvent } from './core/pipeline'
import type { Candidate, RunMode, RunResult, RunStage, StyleVal } from './core/types'
import { setActivityWaiting } from './ui/activityCard'
import {
  CANNED_MISMATCH,
  clearError,
  RANDOMIZE_BUSY,
  setModeBanner,
  showBusy,
  showError,
} from './ui/banner'
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
import { clearStatePayload, mountStateModal, renderStatePayload } from './ui/stateViewer'
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
 * Name what the run on the page actually is.
 *
 * Canned answers reach a visitor two ways — sample mode, where there was never
 * a key, and a live run that fell back mid-flight — and to whoever is reading
 * the cards those are the same claim: ten names that came out of a fixture
 * rather than out of a model that read the box. Both land under the sample
 * copy, with the fallback reason kept alongside so a quota stop still reads as
 * a quota stop.
 *
 * The mismatch note is added only when the prose on the page is not the prose
 * the fixture was written about. Someone running the courier example in sample
 * mode is being answered about the thing they asked about, and warning them off
 * a result that happens to be correct would be its own small dishonesty.
 */
function announceRun(
  refs: UiRefs,
  mode: RunMode,
  fallback: FallbackReason | null,
  descriptor: string,
): void {
  if (mode !== 'sample' && fallback === null) {
    setModeBanner(refs, mode)

    return
  }

  const notes: string[] = []

  if (fallback !== null) {
    notes.push(fallback)
  }

  if (!describesSampleRun(descriptor)) {
    notes.push(CANNED_MISMATCH)
  }

  setModeBanner(refs, 'sample', notes.length === 0 ? undefined : notes.join('; '))
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
 * Randomize goes through the same client Run does, so a page with a model
 * behind it writes a fresh brief instead of dealing another card off the local
 * bank, and a page without one deals from the bank exactly as before. It never
 * starts a run, though it does end one: the cards, the badges and the verdict
 * all answered the brief being replaced, so they come down with it and the new
 * prose sits alone in the box until the visitor asks for names for it.
 *
 * Run goes through whichever client this build and this browser add up to, and
 * through the fallback behind it, so the page works with no key and no network
 * and says which of those it is doing. The style the controls hold is the one
 * the next run carries, and moving a control after a run rewrites the visible
 * payload so the change is readable before Jev is ever asked again. Re-ask Jev
 * then spends that style on a second opinion over the same ten cards, so it
 * stays disabled until a run has left something on the page worth re-asking
 * about. The state viewer is wired here too, and stays shut and unopenable
 * until a run has built a payload worth opening it for.
 */
export function bootstrap(doc: Document = document): UiRefs {
  const refs = queryRefs(doc)
  let fallback: FallbackReason | null = null
  const { client, mode } = createClient((reason) => {
    // A live run that dropped to canned answers has to say so where the mode is
    // already named. One fixed disagreement read as a live one is the demo
    // claiming something it did not do. The reason is kept rather than just
    // shown, because every run after this one comes from the fixture too.
    fallback = reason
    announceRun(refs, mode, fallback, refs.descriptor.value)
  })
  let running = false
  let randomizing = false
  let val = loadVal()
  let lastRun: RunResult | null = null

  /**
   * Take down everything the last run left on the page.
   *
   * Run clears these regions itself as it starts, because it begins filling
   * them back in on the same click. Randomize has no run behind it and nothing
   * to put in their place, so the clearing has to be a step of its own — and it
   * has to take the bookkeeping with the pixels: a `lastRun` left standing
   * would let Re-ask Jev ask a judge about cards that are no longer on screen.
   */
  const clearPreviousRun = (): void => {
    clearResults(refs)
    clearStatePayload(refs)
    clearError(refs)
    lastRun = null
    refs.reaskJev.disabled = true
  }

  setModeBanner(refs, mode)
  mountStateModal(refs)

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

  // The first brief comes from the bank in every mode: a page that spent a
  // round trip before the visitor had asked for anything would be slower to
  // read and would charge a deployment for a brief nobody requested.
  refs.descriptor.value = pickRandomDescriptor()
  refs.randomize.addEventListener('click', () => {
    // The same guard Run uses. A second click while the first is still in
    // flight would race two briefs into one box, and the later answer is not
    // necessarily the later click.
    if (randomizing) {
      return
    }

    // Read before the box is emptied. This is the brief being replaced, and a
    // model asked to avoid an empty string has been asked to avoid nothing.
    const replaced = refs.descriptor.value

    randomizing = true
    refs.randomize.disabled = true
    // A greyed button is the whole of the current feedback, and a model takes
    // seconds to answer. The box about to be rewritten is the thing that is
    // waiting, so the box is what says so.
    setActivityWaiting(refs.descriptorShell, true)
    // Everything below the box was an answer about the brief on its way out.
    // Ten names for a courier job sitting under a description of something
    // else is the page claiming a run it never did, so the old run goes as soon
    // as the new brief is asked for rather than whenever it happens to arrive.
    clearPreviousRun()
    refs.descriptor.value = ''

    void client
      .generateDescriptor(replaced)
      .then((descriptor) => {
        refs.descriptor.value = descriptor
      })
      .catch((reason: unknown) => {
        // The prose comes back, because it may be the visitor's own and nothing
        // arrived to replace it. The results do not: they answered the last run
        // of that brief, and that run ended at the click whether or not a new
        // brief followed it. The strip gets the fixed line rather than the
        // failure: nothing that reaches here is about a run, and none of it was
        // written for a visitor to read.
        refs.descriptor.value = replaced
        console.error(reason)
        showBusy(refs, RANDOMIZE_BUSY)
      })
      .finally(() => {
        // Both settlements, and both orders of them: the border must not be
        // left running over a box that has stopped waiting.
        randomizing = false
        refs.randomize.disabled = false
        setActivityWaiting(refs.descriptorShell, false)
      })
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
        // Said once the cards exist, and against the prose the run actually
        // used: a box edited while the run was in flight describes the next
        // run, not the one being announced.
        announceRun(refs, mode, fallback, result.descriptor)
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
