/**
 * The run, made visible.
 *
 * Everything a visitor reads after clicking Run is built here: the five
 * property cards, the two pick badges, the probability bars and the verdict
 * strip. Every value on this page is model output, so nothing is ever assigned
 * as markup — each node is constructed and filled through `textContent`, and a
 * candidate named `<img onerror=...>` lands on a card as those literal
 * characters rather than as an element.
 *
 * The functions are stateless and idempotent: each one replaces the contents of
 * the region it owns, so a second run overwrites the first instead of stacking
 * on top of it. What a run has learned so far lives in the caller.
 */

import type { Candidate, JevPick, LlmPick, RunResult, RunStage } from '../core/types'
import type { UiRefs } from './dom'

/** The heading each badge carries, so a failure is still labelled with its side. */
const LLM_TITLE = 'Plain model'
const JEV_TITLE = 'Jev Choice'

/** Shown for a confidence the envelope omitted. A missing number is not zero. */
const NO_CONFIDENCE = '—'

/** Worn for the length of one verdict animation, then taken off again. */
const FLASH_CLASS = 'verdict-flash'

/**
 * Which candidate each side chose.
 *
 * An empty string means that side has not answered yet, or answered with the
 * blank stand-in a failed stage leaves behind — no candidate name can be empty,
 * so neither value ever highlights a card by accident.
 */
export interface CardHighlight {
  llm: string
  jev: string
}

/** Build one filled element, without ever going through `innerHTML`. */
function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag)

  node.className = className

  if (text !== undefined) {
    node.textContent = text
  }

  return node
}

/** The region a stage owns. Each stage writes to exactly one. */
function stageRegion(refs: UiRefs, stage: RunStage): HTMLElement {
  switch (stage) {
    case 'candidates':
      return refs.cards
    case 'llmPick':
      return refs.llmPick
    case 'jevPick':
      return refs.jevPick
  }
}

/** Put a titled error where an answer would have gone, dropping whatever was there. */
function renderFailure(region: HTMLElement, title: string, message: string): void {
  const doc = region.ownerDocument

  region.classList.add('pick-failed')
  region.replaceChildren(
    element(doc, 'h2', 'pick-title', title),
    element(doc, 'p', 'pick-error', message),
  )
}

/**
 * Draw the five cards, marking the ones the two sides chose.
 *
 * The highlight is applied here rather than patched on afterwards, so the cards
 * are rebuilt from the candidates and the current picks every time and can
 * never drift out of step with the badges below them.
 */
export function renderCandidates(
  refs: UiRefs,
  candidates: readonly Candidate[],
  highlight: CardHighlight = { llm: '', jev: '' },
): void {
  const doc = refs.cards.ownerDocument

  refs.cards.replaceChildren(
    ...candidates.map((candidate) => {
      const card = element(doc, 'article', 'card')

      card.dataset.name = candidate.name

      if (candidate.name === highlight.llm) {
        card.classList.add('card-pick-llm')
      }

      if (candidate.name === highlight.jev) {
        card.classList.add('card-pick-jev')
      }

      card.append(
        element(doc, 'code', 'card-name', candidate.name),
        element(doc, 'span', 'card-type', candidate.typeHint),
        element(doc, 'p', 'card-why', candidate.why),
      )

      return card
    }),
  )
}

/**
 * Fill the plain model's badge with its name and its reasoning.
 *
 * The pipeline reports a failed pick as an empty name carrying the error in
 * `reason`, so that shape is rendered as the failure it is rather than as a
 * nameless answer.
 */
export function renderLlmPick(refs: UiRefs, pick: LlmPick): void {
  if (pick.name === '') {
    renderFailure(refs.llmPick, LLM_TITLE, pick.reason)

    return
  }

  const doc = refs.llmPick.ownerDocument

  refs.llmPick.classList.remove('pick-failed')
  refs.llmPick.replaceChildren(
    element(doc, 'h2', 'pick-title', LLM_TITLE),
    element(doc, 'code', 'pick-name', pick.name),
    element(doc, 'p', 'pick-reason', pick.reason),
  )
}

/**
 * Fill Jev's badge: the choice, the confidence, and the whole distribution.
 *
 * Bars are drawn for every candidate on the page as well as every name the
 * envelope scored, so a vector that skips a candidate shows that candidate
 * sitting at zero instead of quietly vanishing from the comparison. They are
 * sorted by probability so the shape of the answer reads at a glance, and the
 * confidence falls back to a dash when the envelope omitted it, because an
 * absent number and a zero mean opposite things.
 */
export function renderJevPick(
  refs: UiRefs,
  pick: JevPick,
  candidates: readonly Candidate[] = [],
): void {
  if (pick.choice === '') {
    renderFailure(refs.jevPick, JEV_TITLE, 'Jev did not answer this run.')

    return
  }

  const doc = refs.jevPick.ownerDocument
  const names = new Set<string>([
    ...candidates.map((candidate) => candidate.name),
    ...Object.keys(pick.probabilities),
  ])
  const bars = [...names]
    .map((name) => ({ name, probability: pick.probabilities[name] ?? 0 }))
    .sort((left, right) => right.probability - left.probability)

  const confidence = element(doc, 'p', 'pick-confidence', 'confidence ')

  confidence.append(
    element(
      doc,
      'span',
      'confidence-value',
      pick.confidence === null ? NO_CONFIDENCE : `${Math.round(pick.confidence * 100)}%`,
    ),
  )

  const chart = element(doc, 'ul', 'bars')

  chart.append(
    ...bars.map(({ name, probability }) => {
      const percent = Math.round(probability * 100)
      const row = element(doc, 'li', name === pick.choice ? 'bar bar-chosen' : 'bar')
      const track = element(doc, 'span', 'bar-track')
      const fill = element(doc, 'span', 'bar-fill')

      fill.style.width = `${percent}%`
      track.append(fill)
      row.dataset.name = name
      row.append(
        element(doc, 'span', 'bar-name', name),
        track,
        element(doc, 'span', 'bar-value', `${percent}%`),
      )

      return row
    }),
  )

  refs.jevPick.classList.remove('pick-failed')
  refs.jevPick.replaceChildren(
    element(doc, 'h2', 'pick-title', JEV_TITLE),
    element(doc, 'code', 'pick-name', pick.choice),
    confidence,
    chart,
    element(doc, 'p', 'pick-model', pick.model),
  )
}

/** The strip's own element, created on first use and reused after that. */
function verdictBanner(refs: UiRefs): HTMLElement {
  const existing = refs.verdict.querySelector<HTMLElement>('.verdict-banner')

  if (existing !== null) {
    return existing
  }

  const banner = element(refs.verdict.ownerDocument, 'p', 'verdict-banner')

  // Prepended rather than appended: the strip already holds the two badges, and
  // the headline belongs above them.
  refs.verdict.prepend(banner)

  return banner
}

/**
 * Announce whether the two sides landed on the same name, and flash it.
 *
 * The flash class is taken off and put back across a forced reflow because a
 * second run reaching the same verdict would otherwise re-add a class the
 * element already carries, and the animation would never restart.
 */
export function renderVerdict(refs: UiRefs, result: RunResult): void {
  const banner = verdictBanner(refs)

  banner.textContent = result.agree ? 'AGREE' : 'DISAGREE'
  banner.classList.toggle('is-agree', result.agree)
  banner.classList.toggle('is-disagree', !result.agree)

  banner.classList.remove(FLASH_CLASS)
  void banner.offsetWidth
  banner.classList.add(FLASH_CLASS)
  banner.addEventListener(
    'animationend',
    () => {
      banner.classList.remove(FLASH_CLASS)
    },
    { once: true },
  )
}

/**
 * Mark one stage as still working, independently of the other two.
 *
 * `aria-busy` rides along with the class so the live regions announce the wait
 * rather than reading out a half-filled result.
 */
export function setStageLoading(refs: UiRefs, stage: RunStage, loading: boolean): void {
  const region = stageRegion(refs, stage)

  region.classList.toggle('is-loading', loading)
  region.setAttribute('aria-busy', String(loading))
}

/**
 * Show why a side went missing, in the place its answer would have been.
 *
 * Only the two picks can fail this way: losing the candidates ends the run
 * outright, so there is nothing to draw in their place.
 */
export function renderStageError(
  refs: UiRefs,
  stage: Exclude<RunStage, 'candidates'>,
  error: Error,
): void {
  renderFailure(stageRegion(refs, stage), stage === 'llmPick' ? LLM_TITLE : JEV_TITLE, error.message)
}

/**
 * Empty every results region before a fresh run starts.
 *
 * Without this, the previous run's verdict would sit over the new run's loading
 * states and read as an answer to the descriptor now in the box.
 */
export function clearResults(refs: UiRefs): void {
  refs.cards.replaceChildren()
  refs.llmPick.replaceChildren()
  refs.jevPick.replaceChildren()
  refs.llmPick.classList.remove('pick-failed')
  refs.jevPick.classList.remove('pick-failed')
  refs.verdict.querySelector('.verdict-banner')?.remove()
}
