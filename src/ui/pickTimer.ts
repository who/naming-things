/**
 * Two clocks, one per judge, so a slow side is visibly the slow one.
 *
 * The page races a plain model against Jev Choice, and until now the only thing
 * it said about the race was which answer arrived. A single spinner over both
 * badges would have been the wrong instrument: the two calls go out together
 * and land whenever they land, so one clock across the pair would report the
 * slower of them and quietly credit its time to the faster. Each side gets its
 * own.
 *
 * What is measured is the wait a visitor actually sat through — from the moment
 * that side's request goes out to the moment its answer is on screen — and not
 * whatever a provider reports about its own service time. The number on the
 * badge should be the one a person could have timed with a stopwatch, including
 * the network in between, because that is the thing they were waiting on.
 *
 * A failure is timed exactly the same way. A side that spent nine seconds
 * before erroring spent nine seconds, and hiding that would leave the slowest
 * case on the page as the one case with no duration on it.
 */

import type { PickStage } from '../core/types'
import type { UiRefs } from './dom'
import { clearPickWaiting, renderPickDuration, renderPickWaiting } from './render'

/** Below this a duration reads in whole milliseconds; at or above it, in seconds. */
const ONE_SECOND = 1000

/**
 * The wall clock and the frame scheduler, taken rather than reached for.
 *
 * Both live on the window, and both are the two things a test cannot wait on
 * honestly: a real animation frame arrives when the host feels like it, and a
 * real clock cannot be asked to say that four hundred milliseconds have passed.
 * Injecting the pair is what lets the count-up be tested by advancing a number.
 */
export interface TimerHost {
  now(): number
  schedule(tick: () => void): number
  cancel(handle: number): void
}

/** One side's clock: when it started, whether it is still going, what it measured. */
interface Clock {
  running: boolean
  startedAt: number
  frame: number | null
  elapsed: number | null
}

/** What the page shows for a duration, at the granularity that reads. */
export function formatElapsed(ms: number): string {
  // A clock that went backwards, or never read at all, is shown as no time
  // rather than as a negative one — and a fast answer keeps its milliseconds
  // instead of rounding down to a zero that would look like a failure to time.
  const elapsed = Number.isFinite(ms) && ms > 0 ? ms : 0

  return elapsed < ONE_SECOND
    ? `${Math.round(elapsed)}ms`
    : `${(elapsed / ONE_SECOND).toFixed(2)}s`
}

/**
 * The real clock and the real frames, off the document that is being painted.
 *
 * A document with no window — jsdom builds them, and so does any parser that
 * never attached one — has no frames to count in. The clock still reads, so a
 * duration still lands on the heading; only the ticking between the two ends
 * goes missing, which is the honest outcome for a page nobody is watching.
 */
export function browserHost(doc: Document): TimerHost {
  const view = doc.defaultView

  if (view === null) {
    return { now: () => Date.now(), schedule: () => 0, cancel: () => undefined }
  }

  return {
    now: () => view.performance.now(),
    schedule: (tick) => view.requestAnimationFrame(tick),
    cancel: (handle) => {
      view.cancelAnimationFrame(handle)
    },
  }
}

/** The four things a run does to a side's clock. */
export interface PickTimers {
  start(stage: PickStage): void
  stop(stage: PickStage): void
  showDuration(stage: PickStage): void
  clear(stage: PickStage): void
  reset(): void
}

/**
 * Wire two clocks to the two badges.
 *
 * The caller drives them in the order the page already works in: `start` when
 * the request goes out, `stop` the moment the answer is in hand, then
 * `showDuration` once that answer has been rendered — after, because rendering
 * replaces the pane and a duration written before it would be painted over by
 * the thing it describes.
 *
 * Every method is safe to call on a clock that is not running. Two of the three
 * callers are a promise's `finally` and a guard against a double click, and a
 * timer that threw on a second stop would take a finished run down with it.
 */
export function createPickTimers(
  refs: UiRefs,
  host: TimerHost = browserHost(refs.llmPick.ownerDocument),
): PickTimers {
  const clocks: Record<PickStage, Clock> = {
    llmPick: { running: false, startedAt: 0, frame: null, elapsed: null },
    jevPick: { running: false, startedAt: 0, frame: null, elapsed: null },
  }

  const cancelFrame = (clock: Clock): void => {
    if (clock.frame !== null) {
      host.cancel(clock.frame)
      clock.frame = null
    }
  }

  /** One frame, which paints the count-up and then asks for the next one. */
  const scheduleTick = (stage: PickStage): void => {
    const clock = clocks[stage]

    clock.frame = host.schedule(() => {
      clock.frame = null
      renderPickWaiting(refs, stage, formatElapsed(host.now() - clock.startedAt))
      scheduleTick(stage)
    })
  }

  const start = (stage: PickStage): void => {
    const clock = clocks[stage]

    // A second run of the same side abandons the first clock rather than
    // leaving two of them writing into one pane. Only the latest attempt is on
    // screen, so only the latest attempt is being timed.
    cancelFrame(clock)
    clock.running = true
    clock.startedAt = host.now()
    clock.elapsed = null
    renderPickWaiting(refs, stage, formatElapsed(0))
    scheduleTick(stage)
  }

  const stop = (stage: PickStage): void => {
    const clock = clocks[stage]

    if (!clock.running) {
      return
    }

    cancelFrame(clock)
    clock.running = false
    clock.elapsed = host.now() - clock.startedAt
  }

  const showDuration = (stage: PickStage): void => {
    const { elapsed } = clocks[stage]

    if (elapsed === null) {
      return
    }

    renderPickDuration(refs, stage, formatElapsed(elapsed))
  }

  const clear = (stage: PickStage): void => {
    const clock = clocks[stage]

    cancelFrame(clock)
    clock.running = false
    clock.elapsed = null
    clearPickWaiting(refs, stage)
  }

  return {
    start,
    stop,
    showDuration,
    clear,
    reset: () => {
      clear('llmPick')
      clear('jevPick')
    },
  }
}
