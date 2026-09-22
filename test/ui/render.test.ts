import { beforeEach, describe, expect, it } from 'vitest'

import INDEX_HTML from '../../index.html?raw'
import { LiveCallError } from '../../src/api/remote'
import { DEFAULT_VAL, type Candidate, type RunResult } from '../../src/core/types'
import { SAMPLE_RUN } from '../fixtures/sampleRun'
import { NETWORK_DOWN, QUOTA_SPENT } from '../../src/ui/banner'
import { queryRefs, type UiRefs } from '../../src/ui/dom'
import {
  clearResults,
  renderCandidates,
  renderJevPick,
  renderLlmPick,
  renderStageError,
  renderVerdict,
  setStageLoading,
} from '../../src/ui/render'

/** Mount the shipped markup, minus the module script jsdom must not run. */
function mountShippedMarkup(): void {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(INDEX_HTML)?.[1] ?? ''

  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '')
}

/** The canned five, copied so a test that edits one cannot reach the fixture. */
function sampleCandidates(): Candidate[] {
  return SAMPLE_RUN.candidates.map((candidate) => ({ ...candidate }))
}

/** The canned run as a finished `RunResult`, agreement computed rather than asserted. */
function sampleResult(): RunResult {
  return {
    descriptor: SAMPLE_RUN.descriptor,
    code: SAMPLE_RUN.code,
    candidates: sampleCandidates(),
    llm: { ...SAMPLE_RUN.llm },
    jev: { ...SAMPLE_RUN.jev, probabilities: { ...SAMPLE_RUN.jev.probabilities } },
    val: DEFAULT_VAL(),
    agree: SAMPLE_RUN.llm.name === SAMPLE_RUN.jev.choice,
  }
}

function textOf(refs: UiRefs, selector: string): string {
  return refs.cards.ownerDocument.querySelector(selector)?.textContent ?? ''
}

describe('renderCandidates', () => {
  let refs: UiRefs

  beforeEach(() => {
    mountShippedMarkup()
    refs = queryRefs(document)
  })

  it('draws one row per candidate, in the order they arrived', () => {
    renderCandidates(refs, sampleCandidates())

    const rows = [...refs.cards.querySelectorAll('.candidate-row')]

    expect(rows).toHaveLength(SAMPLE_RUN.candidates.length)
    expect(rows.map((row) => row.querySelector('.candidate-name')?.textContent)).toEqual(
      SAMPLE_RUN.candidates.map((candidate) => candidate.name),
    )
  })

  it('heads the table with the three column labels', () => {
    renderCandidates(refs, sampleCandidates())

    const headings = [...refs.cards.querySelectorAll('.candidate-head .candidate-column')]

    expect(refs.cards.querySelector('.candidate-grid')?.getAttribute('role')).toBe('table')
    expect(headings.map((heading) => heading.textContent)).toEqual(['Name', 'Type', 'Why'])
  })

  it('shows the type hint and the case for each name', () => {
    renderCandidates(refs, sampleCandidates())

    const first = refs.cards.querySelector('.candidate-row')

    expect(first?.querySelector('.candidate-type')?.textContent).toBe(
      SAMPLE_RUN.candidates[0]?.typeHint,
    )
    expect(first?.querySelector('.candidate-why')?.textContent).toBe(SAMPLE_RUN.candidates[0]?.why)
  })

  it('renders markup in model output as literal text', () => {
    const hostile = '<img src=x onerror="boom()">'

    renderCandidates(refs, [
      { name: hostile, typeHint: '<b>number</b>', why: 'Tom & Jerry <script>alert(1)</script>' },
    ])

    expect(refs.cards.querySelector('img')).toBeNull()
    expect(refs.cards.querySelector('script')).toBeNull()
    expect(refs.cards.querySelector('b')).toBeNull()
    expect(refs.cards.querySelector('.candidate-name')?.textContent).toBe(hostile)
    expect(refs.cards.querySelector('.candidate-why')?.textContent).toContain('&')
  })

  it('gives each judge its own mark on the row it chose', () => {
    renderCandidates(refs, sampleCandidates(), {
      llm: SAMPLE_RUN.llm.name,
      jev: SAMPLE_RUN.jev.choice,
    })

    const llmRow = refs.cards.querySelector(`[data-name="${SAMPLE_RUN.llm.name}"]`)
    const jevRow = refs.cards.querySelector(`[data-name="${SAMPLE_RUN.jev.choice}"]`)

    expect(llmRow?.classList.contains('row-pick-llm')).toBe(true)
    expect(llmRow?.classList.contains('row-pick-jev')).toBe(false)
    expect(jevRow?.classList.contains('row-pick-jev')).toBe(true)
  })

  it('puts both marks on one row when the two judges agree', () => {
    const agreed = SAMPLE_RUN.llm.name

    renderCandidates(refs, sampleCandidates(), { llm: agreed, jev: agreed })

    const marked = [...refs.cards.querySelectorAll('.row-pick-llm')]

    // Both classes on one row is what the stylesheet's offset chase binds to: an
    // agreement split over two rows would animate as two picks rather than one.
    expect(marked).toHaveLength(1)
    expect(marked[0]?.classList.contains('row-pick-jev')).toBe(true)
  })

  it('highlights nothing while neither judge has answered', () => {
    renderCandidates(refs, sampleCandidates(), { llm: '', jev: '' })

    expect(refs.cards.querySelectorAll('.row-pick-llm')).toHaveLength(0)
    expect(refs.cards.querySelectorAll('.row-pick-jev')).toHaveLength(0)
  })

  it('replaces the previous run rather than appending to it', () => {
    renderCandidates(refs, sampleCandidates())
    renderCandidates(refs, [{ name: 'onlyOne', typeHint: 'number', why: 'The second run.' }])

    expect(refs.cards.querySelectorAll('.candidate-row')).toHaveLength(1)
    expect(refs.cards.textContent).not.toContain(SAMPLE_RUN.llm.name)
  })
})

describe('renderLlmPick', () => {
  let refs: UiRefs

  beforeEach(() => {
    mountShippedMarkup()
    refs = queryRefs(document)
  })

  it('shows the chosen name and the reasoning behind it', () => {
    renderLlmPick(refs, { ...SAMPLE_RUN.llm })

    expect(refs.llmPick.querySelector('.pick-name')?.textContent).toBe(SAMPLE_RUN.llm.name)
    expect(refs.llmPick.querySelector('.pick-reason')?.textContent).toBe(SAMPLE_RUN.llm.reason)
  })

  it('names the model behind the pick in its heading', () => {
    renderLlmPick(refs, { ...SAMPLE_RUN.llm })

    expect(refs.llmPick.querySelector('.pick-title')?.textContent).toBe(
      `Plain model (${SAMPLE_RUN.llm.model})`,
    )
  })

  it('reads a blank name as the failure it is', () => {
    renderLlmPick(refs, { name: '', reason: 'upstream refused the request', model: '' })

    expect(refs.llmPick.classList.contains('pick-failed')).toBe(true)
    expect(refs.llmPick.querySelector('.pick-error')?.textContent).toBe(
      'upstream refused the request',
    )
  })

  it('leaves the heading bare rather than empty-bracketed when nothing answered', () => {
    renderLlmPick(refs, { name: '', reason: 'upstream refused the request', model: '' })

    expect(refs.llmPick.querySelector('.pick-title')?.textContent).toBe('Plain model')
  })
})

describe('renderJevPick', () => {
  let refs: UiRefs

  beforeEach(() => {
    mountShippedMarkup()
    refs = queryRefs(document)
  })

  it('draws one bar per scored name, tallest first', () => {
    renderJevPick(
      refs,
      { ...SAMPLE_RUN.jev, probabilities: { ...SAMPLE_RUN.jev.probabilities } },
      sampleCandidates(),
    )

    const bars = [...refs.jevPick.querySelectorAll<HTMLElement>('.bar')]
    const expected = Object.entries(SAMPLE_RUN.jev.probabilities).sort(
      ([, left], [, right]) => right - left,
    )

    expect(bars.map((bar) => bar.dataset.name)).toEqual(expected.map(([name]) => name))
    expect(bars.map((bar) => bar.querySelector('.bar-value')?.textContent)).toEqual(
      expected.map(([, probability]) => `${Math.round(probability * 100)}%`),
    )
    expect(bars[0]?.querySelector<HTMLElement>('.bar-fill')?.style.width).toBe(
      `${Math.round((SAMPLE_RUN.jev.probabilities[SAMPLE_RUN.jev.choice] ?? 0) * 100)}%`,
    )
  })

  it('sits a candidate the vector skipped at zero instead of dropping it', () => {
    const partial: Record<string, number> = Object.fromEntries(
      Object.entries(SAMPLE_RUN.jev.probabilities).filter(([name]) => name !== 'massGrams'),
    )

    renderJevPick(refs, { ...SAMPLE_RUN.jev, probabilities: partial }, sampleCandidates())

    const bars = [...refs.jevPick.querySelectorAll<HTMLElement>('.bar')]
    const missing = bars.at(-1)

    expect(bars).toHaveLength(SAMPLE_RUN.candidates.length)
    expect(missing?.dataset.name).toBe('massGrams')
    expect(missing?.querySelector('.bar-value')?.textContent).toBe('0%')
    expect(missing?.querySelector<HTMLElement>('.bar-fill')?.style.width).toBe('0%')
  })

  it('shows the confidence as a percentage', () => {
    renderJevPick(refs, { ...SAMPLE_RUN.jev }, sampleCandidates())

    expect(refs.jevPick.querySelector('.confidence-value')?.textContent).toBe('71%')
  })

  it('shows a dash for a confidence the envelope omitted', () => {
    renderJevPick(refs, { ...SAMPLE_RUN.jev, confidence: null }, sampleCandidates())

    expect(refs.jevPick.querySelector('.confidence-value')?.textContent).toBe('—')
    expect(refs.jevPick.querySelector('.pick-confidence')?.textContent).not.toContain('0%')
  })

  it('names the model that answered', () => {
    renderJevPick(refs, { ...SAMPLE_RUN.jev }, sampleCandidates())

    expect(refs.jevPick.querySelector('.pick-model')?.textContent).toBe(SAMPLE_RUN.jev.model)
  })

  it('reads a blank choice as the failure it is', () => {
    renderJevPick(refs, { choice: '', confidence: null, probabilities: {}, model: '' })

    expect(refs.jevPick.classList.contains('pick-failed')).toBe(true)
    expect(refs.jevPick.querySelectorAll('.bar')).toHaveLength(0)
  })
})

describe('renderStageError', () => {
  let refs: UiRefs

  beforeEach(() => {
    mountShippedMarkup()
    refs = queryRefs(document)
  })

  it('replaces a stale answer rather than leaving it standing', () => {
    renderJevPick(refs, { ...SAMPLE_RUN.jev }, sampleCandidates())
    renderStageError(refs, 'jevPick', new LiveCallError('quota exceeded'))

    expect(refs.jevPick.textContent).not.toContain(SAMPLE_RUN.jev.choice)
    expect(refs.jevPick.querySelector('.pick-error')?.textContent).toBe(QUOTA_SPENT)
  })

  /**
   * The badge says what the strip would say, and no more.
   *
   * A side that went missing is the one place an upstream sentence could reach
   * the page through a region a visitor reads as closely as a pick, so the
   * badge carries the line written for the reason and never the reason itself:
   * "network error" is this app's vocabulary for its own console.
   */
  it('shows the line written for a live failure and never its own text', () => {
    renderStageError(refs, 'llmPick', new LiveCallError('network error'))

    const shown = refs.llmPick.querySelector('.pick-error')?.textContent

    expect(shown).toBe(NETWORK_DOWN)
    expect(shown).not.toContain('network error')
  })

  it('clears the failure the next time that side answers', () => {
    renderStageError(refs, 'llmPick', new Error('upstream refused the request'))
    renderLlmPick(refs, { ...SAMPLE_RUN.llm })

    expect(refs.llmPick.classList.contains('pick-failed')).toBe(false)
    expect(refs.llmPick.querySelector('.pick-error')).toBeNull()
  })
})

describe('renderVerdict', () => {
  let refs: UiRefs

  beforeEach(() => {
    mountShippedMarkup()
    refs = queryRefs(document)
  })

  it('reads DISAGREE for the sample fixture', () => {
    renderVerdict(refs, sampleResult())

    expect(textOf(refs, '.verdict-banner')).toBe('DISAGREE')
    expect(refs.verdict.querySelector('.verdict-banner')?.classList.contains('is-disagree')).toBe(
      true,
    )
  })

  it('reads AGREE when both sides landed on one name', () => {
    renderVerdict(refs, { ...sampleResult(), agree: true })

    expect(textOf(refs, '.verdict-banner')).toBe('AGREE')
    expect(refs.verdict.querySelector('.verdict-banner')?.classList.contains('is-agree')).toBe(true)
  })

  it('keeps the two badges and adds one banner, however many runs land', () => {
    renderVerdict(refs, sampleResult())
    renderVerdict(refs, { ...sampleResult(), agree: true })

    expect(refs.verdict.querySelectorAll('.verdict-banner')).toHaveLength(1)
    expect(refs.verdict.contains(refs.llmPick)).toBe(true)
    expect(refs.verdict.contains(refs.jevPick)).toBe(true)
  })

  it('re-arms the flash on every run', () => {
    renderVerdict(refs, sampleResult())
    const banner = refs.verdict.querySelector('.verdict-banner')

    banner?.classList.remove('verdict-flash')
    renderVerdict(refs, sampleResult())

    expect(banner?.classList.contains('verdict-flash')).toBe(true)
  })
})

describe('setStageLoading', () => {
  let refs: UiRefs

  beforeEach(() => {
    mountShippedMarkup()
    refs = queryRefs(document)
  })

  it('marks one stage as waiting without touching the other two', () => {
    setStageLoading(refs, 'jevPick', true)

    expect(refs.jevPick.classList.contains('is-loading')).toBe(true)
    expect(refs.jevPick.getAttribute('aria-busy')).toBe('true')
    expect(refs.cards.classList.contains('is-loading')).toBe(false)
    expect(refs.llmPick.classList.contains('is-loading')).toBe(false)
  })

  it('stops waiting when the stage lands', () => {
    setStageLoading(refs, 'candidates', true)
    setStageLoading(refs, 'candidates', false)

    expect(refs.cards.classList.contains('is-loading')).toBe(false)
    expect(refs.cards.getAttribute('aria-busy')).toBe('false')
  })
})

describe('clearResults', () => {
  let refs: UiRefs

  beforeEach(() => {
    mountShippedMarkup()
    refs = queryRefs(document)
  })

  it('leaves no trace of the previous run', () => {
    const candidates = sampleCandidates()

    renderCandidates(refs, candidates)
    renderLlmPick(refs, { ...SAMPLE_RUN.llm })
    renderJevPick(refs, { ...SAMPLE_RUN.jev }, candidates)
    renderVerdict(refs, sampleResult())

    clearResults(refs)

    expect(refs.cards.children).toHaveLength(0)
    expect(refs.llmPick.children).toHaveLength(0)
    expect(refs.jevPick.children).toHaveLength(0)
    expect(refs.verdict.querySelector('.verdict-banner')).toBeNull()
  })

  it('drops a failure left by the run before it', () => {
    renderStageError(refs, 'jevPick', new Error('jev choice timed out'))

    clearResults(refs)

    expect(refs.jevPick.classList.contains('pick-failed')).toBe(false)
  })
})
