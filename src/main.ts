import './ui/styles.css'

import type { ApiClient } from './api/client'
import { createClient } from './api/mode'
import { pickRandomDescriptor } from './core/descriptors'
import { buildJevState, reaskJev, runPipeline, type RunStageEvent } from './core/pipeline'
import type { Candidate, RunResult, RunStage, StyleVal } from './core/types'
import { setActivityWaiting } from './ui/activityCard'
import { clearError, RANDOMIZE_BUSY, setModeBanner, showBusy, showError } from './ui/banner'
import { queryRefs, type UiRefs } from './ui/dom'
import { createPickTimers, type PickTimers } from './ui/pickTimer'
import {
  clearResults,
  renderCandidates,
  renderJevPick,
  renderLlmPick,
  renderStageError,
  renderVerdict,
  setStageLoading,
} from './ui/render'
import { setRunInviting } from './ui/runInvite'
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
 * Drive one run and paint it as it arrives.
 *
 * The two picks land in whatever order they finish, so what the run has learned
 * so far is kept here and the rows are redrawn from it each time: the badge and
 * the highlighted row always agree, whichever judge answered first. Every stage
 * stops waiting the moment its event arrives, which is what makes a slow Jev
 * visible as a slow Jev rather than as a slow page.
 */
async function executeRun(
  refs: UiRefs,
  client: ApiClient,
  val: StyleVal,
  timers: PickTimers,
): Promise<RunResult> {
  let candidates: readonly Candidate[] = []
  const highlight = { llm: '', jev: '' }

  clearResults(refs)
  clearError(refs)
  clearStatePayload(refs)
  // The previous run's two durations went out with its rows. Forgetting them
  // here is what stops one of them reappearing beside an answer it never timed.
  timers.reset()

  for (const stage of STAGES) {
    setStageLoading(refs, stage, true)
  }

  const onStage = (event: RunStageEvent): void => {
    setStageLoading(refs, event.stage, false)

    if (event.failed) {
      timers.stop(event.stage)
      renderStageError(refs, event.stage, event.error)
      timers.showDuration(event.stage)

      return
    }

    switch (event.stage) {
      case 'candidates':
        candidates = event.candidates
        // Both judges are asked the instant this event lands, which makes it
        // the moment their waits begin. Timing from the click instead would
        // charge each side for the draft it did not write.
        timers.start('llmPick')
        timers.start('jevPick')
        break
      case 'llmPick':
        highlight.llm = event.llm.name
        timers.stop('llmPick')
        renderLlmPick(refs, event.llm)
        timers.showDuration('llmPick')
        break
      case 'jevPick':
        highlight.jev = event.jev.choice
        timers.stop('jevPick')
        renderJevPick(refs, event.jev, candidates)
        timers.showDuration('jevPick')
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
    // A run that threw before its stages reported still has to stop spinning,
    // and a clock nothing is coming back to stop would count on forever.
    for (const stage of STAGES) {
      setStageLoading(refs, stage, false)
    }

    timers.stop('llmPick')
    timers.stop('jevPick')
  }
}

/**
 * Ask Jev again about the run on the page, and repaint only its half.
 *
 * The table and the LLM badge deliberately keep their answers: holding one
 * judge still is what makes a moved Jev pick readable as the style's doing
 * rather than as a second opinion on a second draft. The rows are redrawn only
 * so the highlighted row goes on agreeing with the badge above it. A re-ask
 * that fails leaves the previous answer standing, because a good pick is worth
 * more on screen than an empty badge over an error.
 */
async function executeReask(
  refs: UiRefs,
  client: ApiClient,
  previous: RunResult,
  val: StyleVal,
  timers: PickTimers,
): Promise<RunResult> {
  clearError(refs)
  setStageLoading(refs, 'jevPick', true)
  // Only Jev is being asked again, so only Jev's clock restarts. The plain
  // model's duration is still true of the answer still on screen beside it.
  timers.start('jevPick')

  try {
    const result = await reaskJev(client, previous, val)

    timers.stop('jevPick')
    renderJevPick(refs, result.jev, result.candidates)
    timers.showDuration('jevPick')
    renderCandidates(refs, result.candidates, { llm: result.llm.name, jev: result.jev.choice })
    renderVerdict(refs, result)
    showStatePayload(refs, result, result.val)

    return result
  } catch (reason: unknown) {
    // The previous answer stays, so the count-up over it goes: a number left
    // under an answer this attempt never replaced would be read as that
    // answer's, and it is a failed attempt's.
    timers.clear('jevPick')

    throw reason
  } finally {
    setStageLoading(refs, 'jevPick', false)
  }
}

/**
 * Hydrate the page shell: resolve the element contract, seed the descriptor
 * box, mount the style controls, and wire Randomize, Run and Re-ask Jev.
 *
 * Randomize goes through the same client Run does, so the brief is written by
 * the same model that will be asked to name things in it. It never starts a
 * run, though it does end one: the rows, the badges and the verdict all
 * answered the brief being replaced, so they come down with it and the new
 * prose sits alone in the box until the visitor asks for names for it.
 *
 * Run goes through whichever client this build and this browser add up to, and
 * through nothing else: a call that will not answer leaves the regions empty
 * under a line saying so, because the alternative is a page that shows names no
 * model chose. A build with no client at all never gets this far. The style the
 * controls hold is the one the next run carries, and moving a control after a
 * run rewrites the visible payload so the change is readable before Jev is ever
 * asked again. Re-ask Jev then spends that style on a second opinion over the
 * same ten names, so it stays disabled until a run has left something on the
 * page worth re-asking about. The state viewer is wired here too, and stays shut and unopenable
 * until a run has built a payload worth opening it for.
 */
export function bootstrap(doc: Document = document): UiRefs {
  const refs = queryRefs(doc)
  const { client, mode } = createClient()

  setModeBanner(refs, mode)
  mountStateModal(refs)
  // The first brief comes from the bank in every mode: a page that spent a
  // round trip before the visitor had asked for anything would be slower to
  // read and would charge a deployment for a brief nobody requested.
  refs.descriptor.value = pickRandomDescriptor()

  if (client === null) {
    // Nothing to ask, so nothing to offer. Randomize goes down with the other
    // two — it is a model call like the rest — and the banner above carries the
    // whole explanation. A build that reached this branch is missing its API
    // origin, which is a deployment to fix rather than a page to work around.
    refs.randomize.disabled = true

    return refs
  }

  const timers = createPickTimers(refs)

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
   * would let Re-ask Jev ask a judge about names that are no longer on screen.
   */
  const clearPreviousRun = (): void => {
    clearResults(refs)
    timers.reset()
    clearStatePayload(refs)
    clearError(refs)
    lastRun = null
    refs.reaskJev.disabled = true
  }

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
    // And the offer on Run comes down while the box is empty. There is nothing
    // to run on until a brief lands, and two things breathing at once would
    // have the page pointing at the button and the box in the same breath.
    setRunInviting(refs.run, false)
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
        // A fresh brief over cleared results: Run is the only move left, and
        // the offer goes back on the button that makes it. Only here, though —
        // the failure branch below restores prose the visitor has already seen
        // under a line explaining what went wrong, and a button breathing over
        // that line would be competing with the thing worth reading.
        setRunInviting(refs.run, true)
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
  // The page opens on a brief from the bank with nothing under it, which is
  // exactly the state the offer is for: the first thing a visitor can usefully
  // do here is press Run, and until now the only thing saying so was an
  // attribute coming off a button.
  setRunInviting(refs.run, true)
  refs.run.addEventListener('click', () => {
    // The disabled button already turns most double-clicks away; the flag is
    // what guarantees two runs can never interleave and paint over each other.
    if (running) {
      return
    }

    running = true
    refs.run.disabled = true
    // The offer was taken, so it stops being made — and it is not made again
    // when the run ends. Run is pressable over a finished run, but the ten
    // names and the two badges under it are what the visitor came for, and a
    // button pulsing beside them would be asking for the click it just had.
    setRunInviting(refs.run, false)

    void executeRun(refs, client, val, timers)
      .then((result) => {
        lastRun = result
      })
      .catch((reason: unknown) => {
        // A refused descriptor or a lost draft leaves the regions empty, so the
        // reason has to be said out loud or the page just looks broken. The
        // previous run goes with it: its rows are gone from the page, and
        // re-asking about rows nobody can see is worse than not re-asking.
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

    void executeReask(refs, client, previous, val, timers)
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
