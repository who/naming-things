import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import INDEX_HTML from '../../index.html?raw'
import { DESCRIPTOR_BANK } from '../../src/core/descriptors'
import { SAMPLE_RUN } from '../fixtures/sampleRun'
import { bootstrap } from '../../src/main'
import { queryRefs, type UiRefs } from '../../src/ui/dom'

const BASE_URL = 'https://naming-things-worker.example.workers.dev'

/** A brief the bank does not hold, so a swap is visible as a swap. */
const NEXT_BRIEF =
  'A ShiftAssignment in a hospital rota, holding the ward, the nurse and the hours the shift '
  + 'covers. The property to name is the moment the assignment was accepted, absent until someone '
  + 'accepts it, and read by the payroll export.'

/**
 * The published contract: each ref name paired with the id later issues bind
 * to. Spelled out here rather than imported so a rename in `dom.ts` has to be
 * a deliberate change to the contract, not a silent one.
 */
const CONTRACT_IDS: Record<keyof UiRefs, string> = {
  descriptor: 'descriptor',
  descriptorShell: 'descriptor-shell',
  randomize: 'randomize',
  run: 'run',
  reaskJev: 'reask-jev',
  valControls: 'val-controls',
  cards: 'cards',
  llmPick: 'llm-pick',
  jevPick: 'jev-pick',
  verdict: 'verdict',
  stateOpen: 'state-open',
  stateModal: 'state-modal',
  stateClose: 'state-close',
  stateViewer: 'state-viewer',
  banner: 'banner',
  error: 'error',
}

/**
 * Answer the four Worker routes from the fixture, so a click drives a whole run.
 *
 * The page has no client of its own to fall back on any more, which makes a
 * transport the precondition for every test below: without one there is nothing
 * to press. Answers are keyed by route rather than queued in order, because the
 * two picks are asked for at once and neither order is the run's.
 */
function useWorker(): void {
  vi.stubEnv('VITE_API_BASE', BASE_URL)
  vi.stubGlobal('fetch', (url: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(workerPayload(String(url))),
    } as unknown as Response),
  )
}

function workerPayload(url: string): Record<string, unknown> {
  if (url.endsWith('/api/llm/candidates')) {
    return {
      descriptor: SAMPLE_RUN.descriptor,
      code: SAMPLE_RUN.code,
      candidates: SAMPLE_RUN.candidates.map((candidate) => ({ ...candidate })),
    }
  }

  if (url.endsWith('/api/llm/pick')) {
    return { ...SAMPLE_RUN.llm }
  }

  if (url.endsWith('/api/jev/choice')) {
    return { ...SAMPLE_RUN.jev, probabilities: { ...SAMPLE_RUN.jev.probabilities } }
  }

  if (url.endsWith('/api/llm/descriptor')) {
    return { descriptor: NEXT_BRIEF }
  }

  throw new Error(`the transport was called for an unknown route: ${url}`)
}

/** Mount the shipped markup, minus the module script jsdom must not run. */
function mountShippedMarkup(): void {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(INDEX_HTML)?.[1] ?? ''

  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '')
}

describe('queryRefs', () => {
  beforeEach(() => {
    mountShippedMarkup()
  })

  it('resolves every contract id from the shipped markup', () => {
    const refs = queryRefs(document)

    for (const [name, id] of Object.entries(CONTRACT_IDS)) {
      expect(refs[name as keyof UiRefs].id, `${name} should resolve #${id}`).toBe(id)
    }
  })

  it('names the id the markup is missing', () => {
    document.getElementById('jev-pick')?.remove()

    expect(() => queryRefs(document)).toThrow(/#jev-pick/)
  })
})

/**
 * The page's one answer for a build that was never pointed at an API.
 *
 * Kept in its own block because it is the case with no transport at all: there
 * is nothing behind this page to stand in for a Worker, so the buttons have to
 * come up dead and the strip above them has to say why.
 */
describe('bootstrap, unconfigured', () => {
  beforeEach(() => {
    mountShippedMarkup()
    vi.stubEnv('VITE_API_BASE', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('names the missing configuration and leaves every button down', () => {
    const refs = bootstrap(document)

    expect(refs.banner.hidden).toBe(false)
    expect(refs.banner.textContent).toContain('never given an API to call')
    expect(refs.randomize.disabled).toBe(true)
    expect(refs.run.disabled).toBe(true)
    expect(refs.reaskJev.disabled).toBe(true)
  })

  it('still puts a brief in the box, so the page reads as a page', () => {
    const refs = bootstrap(document)

    expect(DESCRIPTOR_BANK).toContain(refs.descriptor.value)
  })
})

describe('bootstrap', () => {
  beforeEach(() => {
    mountShippedMarkup()
    useWorker()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('prefills the descriptor from the local bank', () => {
    const refs = bootstrap(document)

    expect(DESCRIPTOR_BANK).toContain(refs.descriptor.value)
  })

  // Randomize goes through the client, so the swap lands a turn later and the
  // prose that arrives is the Worker's rather than another brief off the bank.
  it('swaps the descriptor for a different one on Randomize', async () => {
    const refs = bootstrap(document)
    const before = refs.descriptor.value

    refs.randomize.click()

    // The new brief and the button coming back are written in different turns:
    // the swap lands in the `then`, the re-enable in the `finally` behind it. A
    // wait on the value alone therefore reads the button mid-click, so both go
    // in the same wait. A Randomize that never re-enables still fails here, on
    // a wait that runs out rather than on a single early look.
    await vi.waitFor(() => {
      expect(refs.descriptor.value).not.toBe(before)
      expect(refs.randomize.disabled).toBe(false)
    })

    expect(refs.descriptor.value).toBe(NEXT_BRIEF)
  })

  // The border is a stylesheet's business; what has to hold here is that the
  // class is on for the whole call and off once it settles.
  it('marks the descriptor shell as waiting for the length of a Randomize', async () => {
    const refs = bootstrap(document)

    refs.randomize.click()

    expect(refs.descriptorShell.classList.contains('is-waiting')).toBe(true)
    expect(refs.descriptorShell.getAttribute('aria-busy')).toBe('true')

    await vi.waitFor(() => {
      expect(refs.descriptorShell.classList.contains('is-waiting')).toBe(false)
    })

    expect(refs.descriptorShell.getAttribute('aria-busy')).toBe('false')
  })

  it('enables Run and holds Re-ask Jev back until a run has landed', () => {
    const refs = bootstrap(document)

    expect(refs.run.disabled).toBe(false)
    expect(refs.reaskJev.disabled).toBe(true)
  })

  it('fills the table, both badges and the verdict from one click of Run', async () => {
    const refs = bootstrap(document)

    refs.run.click()

    expect(refs.run.disabled).toBe(true)

    await vi.waitFor(
      () => {
        expect(refs.verdict.querySelector('.verdict-banner')?.textContent).toBe(
          'Claude Haiku disagrees with Jev',
        )
      },
      { timeout: 5000 },
    )

    expect(refs.cards.querySelectorAll('.candidate-row')).toHaveLength(SAMPLE_RUN.candidates.length)
    expect(refs.llmPick.querySelector('.pick-name')?.textContent).toBe(SAMPLE_RUN.llm.name)
    expect(refs.jevPick.querySelector('.pick-name')?.textContent).toBe(SAMPLE_RUN.jev.choice)
    expect(refs.run.disabled).toBe(false)
  })

  it('refuses a second run while the first is still in flight', async () => {
    const refs = bootstrap(document)

    refs.run.click()
    // Force the button back on: only the in-flight guard can turn this click away.
    refs.run.disabled = false
    refs.run.click()

    expect(refs.run.disabled).toBe(false)

    await vi.waitFor(
      () => {
        expect(refs.verdict.querySelector('.verdict-banner')).not.toBeNull()
      },
      { timeout: 5000 },
    )

    expect(refs.cards.querySelectorAll('.candidate-row')).toHaveLength(SAMPLE_RUN.candidates.length)
  })
})
