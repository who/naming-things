import { beforeEach, describe, expect, it, vi } from 'vitest'

import INDEX_HTML from '../../index.html?raw'
import { DESCRIPTOR_BANK } from '../../src/core/descriptors'
import { SAMPLE_RUN } from '../../src/fixtures/sampleRun'
import { bootstrap } from '../../src/main'
import { queryRefs, type UiRefs } from '../../src/ui/dom'

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

describe('bootstrap', () => {
  beforeEach(() => {
    mountShippedMarkup()
  })

  it('prefills the descriptor from the local bank', () => {
    const refs = bootstrap(document)

    expect(DESCRIPTOR_BANK).toContain(refs.descriptor.value)
  })

  // Randomize goes through the client now, so the swap lands a turn later even
  // in sample mode, where the bank answers it without a network in sight.
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

    expect(DESCRIPTOR_BANK).toContain(refs.descriptor.value)
  })

  // The border is a stylesheet's business; what has to hold here is that the
  // class is on for the whole call and off once it settles, in the mode where
  // the answer comes back in a single microtask.
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

  it('fills the cards, both badges and the verdict from one click of Run', async () => {
    const refs = bootstrap(document)

    refs.run.click()

    expect(refs.run.disabled).toBe(true)

    await vi.waitFor(
      () => {
        expect(refs.verdict.querySelector('.verdict-banner')?.textContent).toBe('DISAGREE')
      },
      { timeout: 5000 },
    )

    expect(refs.cards.querySelectorAll('.card')).toHaveLength(SAMPLE_RUN.candidates.length)
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

    expect(refs.cards.querySelectorAll('.card')).toHaveLength(SAMPLE_RUN.candidates.length)
  })
})
