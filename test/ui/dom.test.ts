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
  randomize: 'randomize',
  run: 'run',
  reaskJev: 'reask-jev',
  valControls: 'val-controls',
  cards: 'cards',
  llmPick: 'llm-pick',
  jevPick: 'jev-pick',
  verdict: 'verdict',
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

  it('swaps the descriptor for a different one on Randomize', () => {
    const refs = bootstrap(document)
    const before = refs.descriptor.value

    refs.randomize.click()

    expect(refs.descriptor.value).not.toBe(before)
    expect(DESCRIPTOR_BANK).toContain(refs.descriptor.value)
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
