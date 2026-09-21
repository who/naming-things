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
  randomize: HTMLButtonElement
  run: HTMLButtonElement
  reaskJev: HTMLButtonElement
  valControls: HTMLElement
  cards: HTMLElement
  llmPick: HTMLElement
  jevPick: HTMLElement
  verdict: HTMLElement
  stateViewer: HTMLDetailsElement
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
    randomize: requireElement<HTMLButtonElement>(doc, 'randomize'),
    run: requireElement<HTMLButtonElement>(doc, 'run'),
    reaskJev: requireElement<HTMLButtonElement>(doc, 'reask-jev'),
    valControls: requireElement(doc, 'val-controls'),
    cards: requireElement(doc, 'cards'),
    llmPick: requireElement(doc, 'llm-pick'),
    jevPick: requireElement(doc, 'jev-pick'),
    verdict: requireElement(doc, 'verdict'),
    stateViewer: requireElement<HTMLDetailsElement>(doc, 'state-viewer'),
    banner: requireElement(doc, 'banner'),
    error: requireElement(doc, 'error'),
  }
}
