/**
 * The payload handed to Jev, shown exactly as it went out.
 *
 * The demo's whole claim is that Jev chose from this state, so the viewer has
 * to be the state rather than a description of it: the caller passes the same
 * `JevState` the transport was given, and this module only pretty-prints it.
 * The payload carries model output, so it is written through `textContent` and
 * never as markup.
 *
 * It lives in a modal rather than in a fold on the page. The state runs to
 * dozens of lines, which is a panel's worth of column next to the controls and
 * a readable listing when it gets the screen to itself — and reading it is a
 * deliberate act, not something the visitor should have to scroll past on the
 * way to the cards.
 *
 * The line numbers sit in their own list beside the payload rather than at the
 * head of each line. A number folded into the text would come back out again
 * with any copy of it, and the point of showing the state verbatim is that what
 * is on screen can be pasted somewhere and still parse.
 */

import type { JevState } from '../core/types'
import type { UiRefs } from './dom'

/** Two spaces: deep enough to read the nesting, narrow enough for the panel. */
const STATE_INDENT = 2

/** The one block this module owns inside the modal body. */
const PAYLOAD_CLASS = 'state-json'

/** What the viewer says before a run has built anything to put in it. */
const EMPTY_COPY = 'No run yet — press Run to build the state Jev is asked with.'

/** The gutter for one payload, numbered from one, as decoration only. */
function lineNumbers(doc: Document, count: number): HTMLElement {
  const gutter = doc.createElement('ol')

  gutter.className = 'state-line-numbers'
  // A screen reader reading the digits would interleave a count through the
  // JSON; the numbers are there to be pointed at, not to be read out.
  gutter.setAttribute('aria-hidden', 'true')
  gutter.append(
    ...Array.from({ length: count }, (_unused, index) => {
      const line = index + 1
      const number = doc.createElement('li')

      number.className = 'state-line-number'
      number.dataset.line = String(line)
      number.textContent = String(line)

      return number
    }),
  )

  return gutter
}

/**
 * Write the state into the viewer, replacing whatever run was there before.
 *
 * The body is rebuilt rather than patched, so a second run overwrites the first
 * instead of stacking a second payload under the same heading. The modal's open
 * or closed state is left alone: a visitor reading the payload when a re-ask
 * lands watches it change under them, which is the point of re-asking.
 *
 * Enabling the opener here is what keeps the button honest. The payload
 * existing is exactly the condition under which there is something to open.
 */
export function renderStatePayload(refs: UiRefs, state: JevState): void {
  const doc = refs.stateViewer.ownerDocument
  const json = JSON.stringify(state, null, STATE_INDENT)
  const payload = doc.createElement('pre')
  const frame = doc.createElement('div')

  payload.className = PAYLOAD_CLASS
  payload.textContent = json

  frame.className = 'state-payload'
  frame.append(lineNumbers(doc, json.split('\n').length), payload)

  refs.stateViewer.replaceChildren(frame)
  refs.stateOpen.disabled = false
}

/**
 * Drop the payload a previous run left behind.
 *
 * Called as a run starts, because a stale payload under a live heading claims
 * Jev was asked about a descriptor that is no longer on the page — and a run
 * that dies before its state is built would otherwise leave that lie sitting
 * there. The empty line goes back in rather than nothing at all, so a visitor
 * who already has the modal open sees why it went blank.
 */
export function clearStatePayload(refs: UiRefs): void {
  const empty = refs.stateViewer.ownerDocument.createElement('p')

  empty.className = 'state-empty'
  empty.textContent = EMPTY_COPY

  refs.stateViewer.replaceChildren(empty)
  refs.stateOpen.disabled = true
}

/** Raise the modal and put the keyboard inside it. */
export function openStateModal(refs: UiRefs): void {
  refs.stateModal.hidden = false
  refs.stateClose.focus()
}

/**
 * Take the modal back down and hand the keyboard back to the opener.
 *
 * The guard is what makes a document-wide Escape key safe to listen for: with
 * the modal already down, Escape belongs to whatever the visitor is actually
 * doing, and stealing focus to a button they did not press would interrupt a
 * descriptor mid-sentence.
 */
export function closeStateModal(refs: UiRefs): void {
  if (refs.stateModal.hidden) {
    return
  }

  refs.stateModal.hidden = true
  refs.stateOpen.focus()
}

/** Whether a click landed on something whose whole job is to dismiss. */
function dismisses(target: EventTarget | null): boolean {
  return target instanceof Element && target.hasAttribute('data-state-dismiss')
}

/**
 * Wire the three ways out of the modal, plus the one way in.
 *
 * Escape is bound on the document rather than on the dialog, because a dialog
 * that only answers Escape while something inside it holds focus is a dialog a
 * visitor can get stuck in. The backdrop is marked in the markup instead of
 * being compared by identity here, so a click on the dialog itself — which
 * bubbles through the same handler — is not mistaken for a click outside it.
 */
export function mountStateModal(refs: UiRefs): void {
  refs.stateOpen.addEventListener('click', () => {
    openStateModal(refs)
  })

  refs.stateClose.addEventListener('click', () => {
    closeStateModal(refs)
  })

  refs.stateModal.addEventListener('click', (event) => {
    if (dismisses(event.target)) {
      closeStateModal(refs)
    }
  })

  refs.stateModal.ownerDocument.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeStateModal(refs)
    }
  })
}
