/**
 * The run, made visible.
 *
 * Everything a visitor reads after clicking Run is built here: the ten
 * candidate table, the two pick badges, the probability bars and the verdict
 * strip. Every value on this page is model output, so nothing is ever assigned
 * as markup — each node is constructed and filled through `textContent`, and a
 * candidate named `<img onerror=...>` lands in a cell as those literal
 * characters rather than as an element.
 *
 * The functions are stateless and idempotent: each one replaces the contents of
 * the region it owns, so a second run overwrites the first instead of stacking
 * on top of it. What a run has learned so far lives in the caller.
 */

import type { Candidate, JevPick, LlmPick, PickStage, RunResult, RunStage } from '../core/types'
import { visitorMessage } from './banner'
import type { UiRefs } from './dom'

/** The heading each badge carries, so a failure is still labelled with its side. */
const LLM_TITLE = 'Plain model'
const JEV_TITLE = 'Jev Choice'

/** Shown for a confidence the envelope omitted. A missing number is not zero. */
const NO_CONFIDENCE = '—'

/** The count-up a side wears while it is still being waited on. */
const ELAPSED_CLASS = 'pick-elapsed'

/** The duration that outlives the wait, worn by the heading instead of the body. */
const DURATION_CLASS = 'pick-title-elapsed'

/** Worn for the length of one verdict animation, then taken off again. */
const FLASH_CLASS = 'verdict-flash'

/**
 * Which candidate each side chose.
 *
 * An empty string means that side has not answered yet, or answered with the
 * blank stand-in a failed stage leaves behind — no candidate name can be empty,
 * so neither value ever highlights a row by accident.
 */
export interface PickHighlight {
  llm: string
  jev: string
}

/**
 * The class a row wears for each judge that picked it.
 *
 * Spelled here because the stylesheet hangs a travelling orb on each of them,
 * and an orb whose class the renderer stopped writing would be an animation
 * nothing on the page could start.
 */
const LLM_PICK_CLASS = 'row-pick-llm'
const JEV_PICK_CLASS = 'row-pick-jev'

/** The columns, in the order a row lays them out. */
const COLUMN_TITLES: readonly string[] = ['Name', 'Type', 'Why']

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

/** One cell, carrying the table role its place in the row gives it. */
function cell<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text: string,
  role: string,
): HTMLElementTagNameMap[K] {
  const node = element(doc, tag, className, text)

  node.setAttribute('role', role)

  return node
}

/**
 * The three column headings.
 *
 * Rendered rather than written into `index.html` because the region is emptied
 * between runs, and a header sitting in the markup would be cleared with the
 * rows it labels and never come back.
 */
function headerRow(doc: Document): HTMLElement {
  const head = element(doc, 'div', 'candidate-head')

  head.setAttribute('role', 'row')
  head.append(
    ...COLUMN_TITLES.map((title) => cell(doc, 'span', 'candidate-column', title, 'columnheader')),
  )

  return head
}

/**
 * One candidate as a row, wearing a class for each judge that chose it.
 *
 * The name is the row's header rather than another cell: it is what the other
 * two columns are about, and it is the string both badges below echo.
 */
function candidateRow(doc: Document, candidate: Candidate, highlight: PickHighlight): HTMLElement {
  const row = element(doc, 'div', 'candidate-row')

  row.setAttribute('role', 'row')
  row.dataset.name = candidate.name

  if (candidate.name === highlight.llm) {
    row.classList.add(LLM_PICK_CLASS)
  }

  if (candidate.name === highlight.jev) {
    row.classList.add(JEV_PICK_CLASS)
  }

  row.append(
    cell(doc, 'code', 'candidate-name', candidate.name, 'rowheader'),
    cell(doc, 'span', 'candidate-type', candidate.typeHint, 'cell'),
    cell(doc, 'span', 'candidate-why', candidate.why, 'cell'),
  )

  return row
}

/**
 * Draw the ten candidates as one table, marking the rows the two sides chose.
 *
 * A table rather than ten boxes because the candidates differ by a word and a
 * type, and the question a visitor has is which of them to prefer. Rows put the
 * names under one another so that comparison is a glance down a column; the
 * cards it replaces made it a reading exercise, ten times over.
 *
 * The highlight is applied here rather than patched on afterwards, so the rows
 * are rebuilt from the candidates and the current picks every time and can
 * never drift out of step with the badges below them.
 */
export function renderCandidates(
  refs: UiRefs,
  candidates: readonly Candidate[],
  highlight: PickHighlight = { llm: '', jev: '' },
): void {
  const doc = refs.cards.ownerDocument
  const grid = element(doc, 'div', 'candidate-grid')

  grid.setAttribute('role', 'table')
  grid.append(
    headerRow(doc),
    ...candidates.map((candidate) => candidateRow(doc, candidate, highlight)),
  )
  refs.cards.replaceChildren(grid)
}

/**
 * The plain model's heading, with the judge named in parentheses.
 *
 * The id goes in a span of its own because the heading is upper-cased chrome
 * and a provider model string is not chrome: `CLAUDE-HAIKU-4-5-20251001` is not
 * an id anyone could paste back. A pick that failed has no model, and an empty
 * pair of brackets would read as a bug rather than as an absence, so the
 * parenthetical appears only when something answered.
 */
function llmTitle(doc: Document, model: string): HTMLHeadingElement {
  const title = element(doc, 'h2', 'pick-title', LLM_TITLE)

  if (model !== '') {
    title.append(element(doc, 'span', 'pick-title-model', ` (${model})`))
  }

  return title
}

/**
 * Fill the plain model's badge with its name, its reasoning, and the model
 * behind both.
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
    llmTitle(doc, pick.model),
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
 * Put the running clock where that side's answer will land.
 *
 * Two shapes, because the pane is in a different state at each of the places a
 * wait begins. A fresh run has emptied it, so the waiting view is built whole:
 * the side's heading over the count-up, which is what keeps a thinking pane
 * labelled. A re-ask has the previous Jev answer sitting there and that answer
 * is still the best thing on the page, so the count-up joins it rather than
 * taking its place.
 *
 * Every frame after the first finds a count-up already there and writes one
 * string into it. That is the whole reason this is not a rebuild: it runs on
 * every animation frame for as long as a model takes to answer, and a pane
 * replaced sixty times a second would throw away the selection, the scroll
 * position and the accessibility tree of the thing underneath it.
 */
export function renderPickWaiting(refs: UiRefs, stage: PickStage, elapsed: string): void {
  const region = stageRegion(refs, stage)
  const running = region.querySelector<HTMLElement>(`.${ELAPSED_CLASS}`)

  if (running !== null) {
    running.textContent = elapsed

    return
  }

  const doc = region.ownerDocument
  const counter = element(doc, 'p', ELAPSED_CLASS, elapsed)

  if (region.childElementCount === 0) {
    region.append(
      element(doc, 'h2', 'pick-title', stage === 'llmPick' ? LLM_TITLE : JEV_TITLE),
      counter,
    )

    return
  }

  region.append(counter)
}

/**
 * Take the running clock back off again.
 *
 * For a wait that ended with nothing to put in its place: a re-ask that failed
 * leaves the previous answer standing, and a number frozen under that answer
 * would read as the time it took rather than as the time an attempt spent
 * before giving up.
 */
export function clearPickWaiting(refs: UiRefs, stage: PickStage): void {
  stageRegion(refs, stage).querySelector(`.${ELAPSED_CLASS}`)?.remove()
}

/**
 * Write how long that side took beside its heading.
 *
 * The heading is where a finished duration belongs. The body is the answer, and
 * a measurement of the wait should not be sitting next to the name that was
 * chosen once the wait is over. It is written after the pick is rendered rather
 * than during it, because rendering replaces the whole pane and would carry the
 * duration out with everything else that was there.
 *
 * A pane with no heading has had nothing rendered into it, and is left alone: a
 * bare number in an empty badge measures nothing a visitor can see.
 */
export function renderPickDuration(refs: UiRefs, stage: PickStage, elapsed: string): void {
  const title = stageRegion(refs, stage).querySelector('.pick-title')

  if (title === null) {
    return
  }

  // A re-ask replaces the previous duration rather than lining up beside it.
  title.querySelector(`.${DURATION_CLASS}`)?.remove()
  title.append(element(title.ownerDocument, 'span', DURATION_CLASS, ` · ${elapsed}`))
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
 * outright, so there is nothing to draw in their place. The wording is the
 * error strip's, not the failure's own: a badge sitting beside a live pick is
 * read as closely as the pick is, and an upstream sentence rendered there would
 * be the one place a visitor is shown text nobody wrote for them.
 */
export function renderStageError(refs: UiRefs, stage: PickStage, error: Error): void {
  renderFailure(
    stageRegion(refs, stage),
    stage === 'llmPick' ? LLM_TITLE : JEV_TITLE,
    visitorMessage(error),
  )
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
