/**
 * Typed lookups for the element ids `index.html` publishes.
 *
 * The ids are a contract later issues bind to, so the lookup is fail-fast: a
 * markup typo raises here, in a test, instead of surfacing as a silent no-op
 * halfway through a run.
 */

/** Every element the page hydrates, resolved once at startup. */
export interface UiRefs {
  descriptor: HTMLTextAreaElement
  descriptorShell: HTMLElement
  randomize: HTMLButtonElement
  run: HTMLButtonElement
  reaskJev: HTMLButtonElement
  valControls: HTMLElement
  cards: HTMLElement
  llmPick: HTMLElement
  jevPick: HTMLElement
  verdict: HTMLElement
  stateOpen: HTMLButtonElement
  stateModal: HTMLElement
  stateClose: HTMLButtonElement
  stateViewer: HTMLElement
  legendModel: HTMLElement
  banner: HTMLElement
  error: HTMLElement
}

function requireElement<T extends HTMLElement>(doc: Document, id: string): T {
  const element = doc.getElementById(id)

  if (element === null) {
    throw new Error(`queryRefs: no element matches #${id}`)
  }

  return element as T
}

/**
 * Resolve the whole element contract from `doc`, throwing on the first id the
 * markup is missing.
 */
export function queryRefs(doc: Document = document): UiRefs {
  return {
    descriptor: requireElement<HTMLTextAreaElement>(doc, 'descriptor'),
    // The shell around the box, not the box itself: a textarea is a replaced
    // element and cannot carry the pseudo-elements the waiting border is drawn
    // from, so the decoration needs an ordinary element to live on.
    descriptorShell: requireElement(doc, 'descriptor-shell'),
    randomize: requireElement<HTMLButtonElement>(doc, 'randomize'),
    run: requireElement<HTMLButtonElement>(doc, 'run'),
    reaskJev: requireElement<HTMLButtonElement>(doc, 'reask-jev'),
    valControls: requireElement(doc, 'val-controls'),
    cards: requireElement(doc, 'cards'),
    llmPick: requireElement(doc, 'llm-pick'),
    jevPick: requireElement(doc, 'jev-pick'),
    verdict: requireElement(doc, 'verdict'),
    stateOpen: requireElement<HTMLButtonElement>(doc, 'state-open'),
    stateModal: requireElement(doc, 'state-modal'),
    stateClose: requireElement<HTMLButtonElement>(doc, 'state-close'),
    stateViewer: requireElement(doc, 'state-viewer'),
    // The half of the legend that names a judge rather than a colour. It is a
    // ref like any other because a run rewrites it, and the markup ships the
    // placeholder it carries until one does.
    legendModel: requireElement(doc, 'legend-model'),
    banner: requireElement(doc, 'banner'),
    error: requireElement(doc, 'error'),
  }
}
