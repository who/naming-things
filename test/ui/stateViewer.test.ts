import { beforeEach, describe, expect, it } from 'vitest'

import INDEX_HTML from '../../index.html?raw'
import { CandidateParseError } from '../../src/core/parseCandidates'
import { StateTooLargeError } from '../../src/core/pipeline'
import { DEFAULT_VAL, type JevState, type RunMode } from '../../src/core/types'
import { SAMPLE_RUN } from '../../src/fixtures/sampleRun'
import { clearError, setModeBanner, showError } from '../../src/ui/banner'
import { queryRefs, type UiRefs } from '../../src/ui/dom'
import {
  clearStatePayload,
  closeStateModal,
  mountStateModal,
  openStateModal,
  renderStatePayload,
} from '../../src/ui/stateViewer'

/** Mount the shipped markup, minus the module script jsdom must not run. */
function mountShippedMarkup(): void {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(INDEX_HTML)?.[1] ?? ''

  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '')
}

/** The canned run as the state the pipeline would have handed to Jev. */
function sampleState(): JevState {
  return {
    descriptor: SAMPLE_RUN.descriptor,
    code: SAMPLE_RUN.code,
    candidates: SAMPLE_RUN.candidates.map((candidate) => ({ ...candidate })),
    val: DEFAULT_VAL(),
  }
}

function payloadText(refs: UiRefs): string {
  return refs.stateViewer.querySelector('.state-json')?.textContent ?? ''
}

/** The gutter's digits, in the order they are painted. */
function lineNumbers(refs: UiRefs): string[] {
  return [...refs.stateViewer.querySelectorAll('.state-line-number')].map(
    (number) => number.textContent ?? '',
  )
}

describe('renderStatePayload', () => {
  let refs: UiRefs

  beforeEach(() => {
    mountShippedMarkup()
    refs = queryRefs(document)
  })

  it('round-trips the payload it was given', () => {
    const state = sampleState()

    renderStatePayload(refs, state)

    expect(JSON.parse(payloadText(refs))).toEqual(state)
  })

  it('pretty-prints with two-space indentation', () => {
    renderStatePayload(refs, sampleState())

    expect(payloadText(refs)).toContain('\n  "descriptor":')
  })

  it('shows markup in the payload as characters, not as elements', () => {
    const state = sampleState()

    state.descriptor = '<script>alert(1)</script>'

    renderStatePayload(refs, state)

    expect(refs.stateViewer.querySelector('script')).toBeNull()
    expect(payloadText(refs)).toContain('<script>alert(1)</script>')
  })

  it('replaces the previous run rather than stacking a second payload', () => {
    const first = sampleState()
    const second = sampleState()

    second.descriptor = 'A second descriptor entirely.'

    renderStatePayload(refs, first)
    renderStatePayload(refs, second)

    expect(refs.stateViewer.querySelectorAll('.state-json')).toHaveLength(1)
    expect(payloadText(refs)).toContain('A second descriptor entirely.')
    expect(payloadText(refs)).not.toContain(first.descriptor)
  })

  it('numbers every line of the payload, from one', () => {
    renderStatePayload(refs, sampleState())

    const lines = payloadText(refs).split('\n')

    expect(lines.length).toBeGreaterThan(1)
    expect(lineNumbers(refs)).toEqual(lines.map((_unused, index) => String(index + 1)))
  })

  it('keeps the numbers out of the payload, so a copy of it still parses', () => {
    renderStatePayload(refs, sampleState())

    expect(() => JSON.parse(payloadText(refs))).not.toThrow()
    expect(payloadText(refs).startsWith('1')).toBe(false)
  })

  it('renumbers rather than stacking a second gutter', () => {
    renderStatePayload(refs, sampleState())
    renderStatePayload(refs, sampleState())

    expect(refs.stateViewer.querySelectorAll('.state-line-numbers')).toHaveLength(1)
    expect(lineNumbers(refs)).toHaveLength(payloadText(refs).split('\n').length)
  })

  it('leaves the modal as it found it, so a re-ask does not raise a panel', () => {
    renderStatePayload(refs, sampleState())

    expect(refs.stateModal.hidden).toBe(true)
  })

  it('opens the viewer to the opener only once there is a payload', () => {
    expect(refs.stateOpen.disabled).toBe(true)

    renderStatePayload(refs, sampleState())

    expect(refs.stateOpen.disabled).toBe(false)
  })

  it('is taken back down by clearStatePayload', () => {
    renderStatePayload(refs, sampleState())
    clearStatePayload(refs)

    expect(refs.stateViewer.querySelector('.state-json')).toBeNull()
    expect(refs.stateViewer.querySelector('.state-line-number')).toBeNull()
  })

  it('says why it is empty, and shuts the opener, when the payload is cleared', () => {
    renderStatePayload(refs, sampleState())
    clearStatePayload(refs)

    expect(refs.stateViewer.querySelector('.state-empty')?.textContent).toContain('No run yet')
    expect(refs.stateOpen.disabled).toBe(true)
  })
})

describe('the state modal', () => {
  let refs: UiRefs

  beforeEach(() => {
    mountShippedMarkup()
    refs = queryRefs(document)
    mountStateModal(refs)
    renderStatePayload(refs, sampleState())
  })

  it('ships closed, over a viewer that admits it has nothing yet', () => {
    mountShippedMarkup()

    const fresh = queryRefs(document)

    expect(fresh.stateModal.hidden).toBe(true)
    expect(fresh.stateOpen.disabled).toBe(true)
    expect(fresh.stateViewer.querySelector('.state-empty')).not.toBeNull()
  })

  it('declares itself a modal dialog', () => {
    expect(refs.stateModal.getAttribute('role')).toBe('dialog')
    expect(refs.stateModal.getAttribute('aria-modal')).toBe('true')
  })

  it('opens on the opener, and puts the keyboard inside', () => {
    refs.stateOpen.click()

    expect(refs.stateModal.hidden).toBe(false)
    expect(document.activeElement).toBe(refs.stateClose)
  })

  it('closes on Close, and hands the keyboard back to the opener', () => {
    refs.stateOpen.click()
    refs.stateClose.click()

    expect(refs.stateModal.hidden).toBe(true)
    expect(document.activeElement).toBe(refs.stateOpen)
  })

  it('closes on Escape from anywhere on the page', () => {
    openStateModal(refs)
    refs.descriptor.focus()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(refs.stateModal.hidden).toBe(true)
    expect(document.activeElement).toBe(refs.stateOpen)
  })

  it('leaves the descriptor alone when Escape arrives with the modal already shut', () => {
    refs.descriptor.focus()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(document.activeElement).toBe(refs.descriptor)
  })

  it('closes on a click outside the dialog', () => {
    openStateModal(refs)

    refs.stateModal.querySelector<HTMLElement>('.state-backdrop')?.click()

    expect(refs.stateModal.hidden).toBe(true)
  })

  it('stays open when the click lands on the payload itself', () => {
    openStateModal(refs)

    refs.stateViewer.querySelector<HTMLElement>('.state-json')?.click()

    expect(refs.stateModal.hidden).toBe(false)
  })

  it('ignores a second close, so a stray Escape cannot steal focus twice', () => {
    openStateModal(refs)
    closeStateModal(refs)
    refs.descriptor.focus()
    closeStateModal(refs)

    expect(document.activeElement).toBe(refs.descriptor)
  })
})

describe('setModeBanner', () => {
  let refs: UiRefs

  beforeEach(() => {
    mountShippedMarkup()
    refs = queryRefs(document)
  })

  const COPY: Record<'sample' | 'byo', string> = {
    sample: 'Sample run — add keys for live LLM and Jev',
    byo: 'Live run with your local keys',
  }

  for (const [mode, copy] of Object.entries(COPY)) {
    it(`names the ${mode} mode and shows the strip`, () => {
      setModeBanner(refs, mode as RunMode)

      expect(refs.banner.textContent).toBe(copy)
      expect(refs.banner.hidden).toBe(false)
    })
  }

  it('says nothing at all for a hosted live run', () => {
    setModeBanner(refs, 'sample')
    setModeBanner(refs, 'live')

    expect(refs.banner.textContent).toBe('')
    expect(refs.banner.hidden).toBe(true)
  })

  it('appends a fallback reason in parentheses', () => {
    setModeBanner(refs, 'sample', 'quota exceeded')

    expect(refs.banner.textContent).toBe(`${COPY.sample} (quota exceeded)`)
  })

  it('starts hidden, so an untouched page carries no empty bar', () => {
    expect(refs.banner.hidden).toBe(true)
  })
})

describe('showError', () => {
  let refs: UiRefs

  beforeEach(() => {
    mountShippedMarkup()
    refs = queryRefs(document)
  })

  it('shows a rejected payload word for word', () => {
    const error = new CandidateParseError('candidate 2: name "3rd" is not a JavaScript identifier')

    showError(refs, error)

    expect(refs.error.textContent).toBe(error.message)
    expect(refs.error.hidden).toBe(false)
  })

  it('shows an over-budget state word for word, including the byte counts', () => {
    const error = new StateTooLargeError(9001)

    showError(refs, error)

    expect(refs.error.textContent).toBe(error.message)
    expect(refs.error.textContent).toContain('9001')
  })

  it('keeps an unreadable failure off the page', () => {
    showError(refs, new Error('fetch failed: https://example.test?key=sk-secret'))

    expect(refs.error.textContent).not.toContain('sk-secret')
    expect(refs.error.textContent).toBe('That run could not finish. Try again in a moment.')
  })

  it('says something even when what was thrown is not an Error', () => {
    showError(refs, 'nope')

    expect(refs.error.textContent).toBe('That run could not finish. Try again in a moment.')
    expect(refs.error.hidden).toBe(false)
  })

  it('is taken back down by clearError', () => {
    showError(refs, new CandidateParseError('candidates must be an array'))
    clearError(refs)

    expect(refs.error.textContent).toBe('')
    expect(refs.error.hidden).toBe(true)
  })
})
