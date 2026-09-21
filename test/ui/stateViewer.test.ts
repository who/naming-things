import { beforeEach, describe, expect, it } from 'vitest'

import INDEX_HTML from '../../index.html?raw'
import { CandidateParseError } from '../../src/core/parseCandidates'
import { StateTooLargeError } from '../../src/core/pipeline'
import { DEFAULT_VAL, type JevState, type RunMode } from '../../src/core/types'
import { SAMPLE_RUN } from '../../src/fixtures/sampleRun'
import { clearError, setModeBanner, showError } from '../../src/ui/banner'
import { queryRefs, type UiRefs } from '../../src/ui/dom'
import { clearStatePayload, renderStatePayload } from '../../src/ui/stateViewer'

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

  it('leaves the viewer collapsed, so the payload costs no fold space', () => {
    renderStatePayload(refs, sampleState())

    expect(refs.stateViewer.open).toBe(false)
  })

  it('is taken back down by clearStatePayload', () => {
    renderStatePayload(refs, sampleState())
    clearStatePayload(refs)

    expect(refs.stateViewer.querySelector('.state-json')).toBeNull()
  })
})

describe('setModeBanner', () => {
  let refs: UiRefs

  beforeEach(() => {
    mountShippedMarkup()
    refs = queryRefs(document)
  })

  const COPY: Record<RunMode, string> = {
    sample: 'Sample run — add keys for live LLM and Jev',
    live: 'Live run via Worker proxy',
    byo: 'Live run with your local keys',
  }

  for (const [mode, copy] of Object.entries(COPY)) {
    it(`names the ${mode} mode and shows the strip`, () => {
      setModeBanner(refs, mode as RunMode)

      expect(refs.banner.textContent).toBe(copy)
      expect(refs.banner.hidden).toBe(false)
    })
  }

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
