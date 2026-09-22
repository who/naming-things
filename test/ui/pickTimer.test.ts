import { beforeEach, describe, expect, it } from 'vitest'

import INDEX_HTML from '../../index.html?raw'
import { queryRefs, type UiRefs } from '../../src/ui/dom'
import { createPickTimers, formatElapsed, type TimerHost } from '../../src/ui/pickTimer'
import { renderJevPick, renderLlmPick, renderStageError } from '../../src/ui/render'
import { SAMPLE_RUN } from '../fixtures/sampleRun'

/** Mount the shipped markup, minus the module script jsdom must not run. */
function mountShippedMarkup(): void {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(INDEX_HTML)?.[1] ?? ''

  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '')
}

/** A clock that moves only when a test says so, and frames that run only on demand. */
interface FakeHost extends TimerHost {
  advance(ms: number): void
  frame(): void
  pending(): number
}

function fakeHost(): FakeHost {
  let clock = 0
  let nextHandle = 1

  const frames = new Map<number, () => void>()

  return {
    now: () => clock,
    schedule: (tick) => {
      const handle = nextHandle++

      frames.set(handle, tick)

      return handle
    },
    cancel: (handle) => {
      frames.delete(handle)
    },
    advance: (ms) => {
      clock += ms
    },
    // Every callback waiting on a frame gets one, the way a browser runs them:
    // each tick asks for its replacement, which waits for the frame after this.
    frame: () => {
      const due = [...frames.values()]

      frames.clear()

      for (const tick of due) {
        tick()
      }
    },
    pending: () => frames.size,
  }
}

function elapsedText(refs: UiRefs, side: 'llmPick' | 'jevPick'): string {
  return refs[side].querySelector('.pick-elapsed')?.textContent ?? ''
}

function titleText(refs: UiRefs, side: 'llmPick' | 'jevPick'): string {
  return refs[side].querySelector('.pick-title')?.textContent ?? ''
}

describe('formatElapsed', () => {
  it('keeps a sub-second wait in whole milliseconds', () => {
    expect(formatElapsed(482.6)).toBe('483ms')
  })

  it('reads a longer wait in seconds, to the hundredth', () => {
    expect(formatElapsed(1240)).toBe('1.24s')
  })

  it('reports an answer that arrived at once, rather than nothing at all', () => {
    expect(formatElapsed(0.4)).toBe('0ms')
  })

  it('refuses to report a clock that went backwards or never read', () => {
    expect(formatElapsed(-10)).toBe('0ms')
    expect(formatElapsed(Number.NaN)).toBe('0ms')
  })
})

describe('createPickTimers', () => {
  let refs: UiRefs
  let host: FakeHost

  beforeEach(() => {
    mountShippedMarkup()
    refs = queryRefs(document)
    host = fakeHost()
  })

  it('labels the waiting pane and counts up inside it', () => {
    const timers = createPickTimers(refs, host)

    timers.start('llmPick')

    expect(titleText(refs, 'llmPick')).toBe('Plain model')
    expect(elapsedText(refs, 'llmPick')).toBe('0ms')

    host.advance(340)
    host.frame()

    expect(elapsedText(refs, 'llmPick')).toBe('340ms')

    host.advance(900)
    host.frame()

    expect(elapsedText(refs, 'llmPick')).toBe('1.24s')
  })

  it('times the two sides apart', () => {
    const timers = createPickTimers(refs, host)

    timers.start('llmPick')
    timers.start('jevPick')

    host.advance(500)
    host.frame()
    timers.stop('llmPick')
    renderLlmPick(refs, SAMPLE_RUN.llm)
    timers.showDuration('llmPick')

    host.advance(2000)
    host.frame()
    timers.stop('jevPick')
    renderJevPick(refs, SAMPLE_RUN.jev, [...SAMPLE_RUN.candidates])
    timers.showDuration('jevPick')

    expect(titleText(refs, 'llmPick')).toContain('500ms')
    expect(titleText(refs, 'jevPick')).toContain('2.50s')
  })

  it('leaves the count-up out of the settled pane, keeping it to the heading', () => {
    const timers = createPickTimers(refs, host)

    timers.start('llmPick')
    host.advance(1500)
    timers.stop('llmPick')
    renderLlmPick(refs, SAMPLE_RUN.llm)
    timers.showDuration('llmPick')

    expect(refs.llmPick.querySelector('.pick-elapsed')).toBeNull()
    expect(refs.llmPick.querySelector('.pick-title-elapsed')?.textContent).toContain('1.50s')
  })

  it('says how long a side spent before it failed', () => {
    const timers = createPickTimers(refs, host)

    timers.start('jevPick')
    host.advance(9000)
    timers.stop('jevPick')
    renderStageError(refs, 'jevPick', new Error('upstream gave up'))
    timers.showDuration('jevPick')

    expect(titleText(refs, 'jevPick')).toContain('9.00s')
  })

  it('stops counting once the answer is in hand', () => {
    const timers = createPickTimers(refs, host)

    timers.start('jevPick')
    host.advance(200)
    timers.stop('jevPick')

    expect(host.pending()).toBe(0)

    host.advance(5000)
    host.frame()

    expect(elapsedText(refs, 'jevPick')).toBe('0ms')
  })

  it('joins an answer already on the page rather than replacing it', () => {
    const timers = createPickTimers(refs, host)

    renderJevPick(refs, SAMPLE_RUN.jev, [...SAMPLE_RUN.candidates])
    timers.start('jevPick')

    expect(refs.jevPick.querySelector('.pick-name')?.textContent).toBe(SAMPLE_RUN.jev.choice)
    expect(elapsedText(refs, 'jevPick')).toBe('0ms')
  })

  it('times only the latest attempt when a side is asked again', () => {
    const timers = createPickTimers(refs, host)

    timers.start('llmPick')
    host.advance(3000)
    timers.start('llmPick')

    expect(host.pending()).toBe(1)

    host.advance(120)
    timers.stop('llmPick')
    renderLlmPick(refs, SAMPLE_RUN.llm)
    timers.showDuration('llmPick')

    expect(titleText(refs, 'llmPick')).toContain('120ms')
    expect(titleText(refs, 'llmPick')).not.toContain('3.12s')
  })

  it('takes the count-up back off and forgets what it measured', () => {
    const timers = createPickTimers(refs, host)

    renderJevPick(refs, SAMPLE_RUN.jev, [...SAMPLE_RUN.candidates])
    timers.start('jevPick')
    host.advance(700)
    timers.clear('jevPick')
    timers.showDuration('jevPick')

    expect(refs.jevPick.querySelector('.pick-elapsed')).toBeNull()
    expect(refs.jevPick.querySelector('.pick-name')?.textContent).toBe(SAMPLE_RUN.jev.choice)
    expect(host.pending()).toBe(0)
    expect(titleText(refs, 'jevPick')).not.toContain('700ms')
  })

  it('carries no duration across a fresh run', () => {
    const timers = createPickTimers(refs, host)

    timers.start('llmPick')
    host.advance(900)
    timers.stop('llmPick')
    timers.reset()

    renderLlmPick(refs, SAMPLE_RUN.llm)
    timers.showDuration('llmPick')

    expect(refs.llmPick.querySelector('.pick-title-elapsed')).toBeNull()
  })

  it('survives a stop on a clock that was never started', () => {
    const timers = createPickTimers(refs, host)

    expect(() => {
      timers.stop('llmPick')
      timers.showDuration('llmPick')
      timers.reset()
    }).not.toThrow()
  })
})
