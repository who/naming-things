/**
 * The payload handed to Jev, shown exactly as it went out.
 *
 * The demo's whole claim is that Jev chose from this state, so the viewer has
 * to be the state rather than a description of it: the caller passes the same
 * `JevState` the transport was given, and this module only pretty-prints it.
 * The payload carries model output, so it is written through `textContent` and
 * never as markup.
 */

import type { JevState } from '../core/types'
import type { UiRefs } from './dom'

/** Two spaces: deep enough to read the nesting, narrow enough for the panel. */
const STATE_INDENT = 2

/** The one block this module owns inside the details element. */
const PAYLOAD_CLASS = 'state-json'

/**
 * Write the state into the viewer, replacing whatever run was there before.
 *
 * The `pre` block is reused rather than re-created, so a second run overwrites
 * the first instead of stacking a second payload under the same summary. The
 * details element's open or closed state is left alone: a visitor who opened
 * the payload keeps it open across runs, and one who never opened it is not
 * interrupted by a panel unfolding mid-run.
 */
export function renderStatePayload(refs: UiRefs, state: JevState): void {
  const existing = refs.stateViewer.querySelector<HTMLPreElement>(`.${PAYLOAD_CLASS}`)
  const payload = existing ?? refs.stateViewer.ownerDocument.createElement('pre')

  payload.className = PAYLOAD_CLASS
  payload.textContent = JSON.stringify(state, null, STATE_INDENT)

  if (existing === null) {
    refs.stateViewer.append(payload)
  }
}

/**
 * Drop the payload a previous run left behind.
 *
 * Called as a run starts, because a stale payload under a live summary claims
 * Jev was asked about a descriptor that is no longer on the page — and a run
 * that dies before its state is built would otherwise leave that lie sitting
 * there.
 */
export function clearStatePayload(refs: UiRefs): void {
  refs.stateViewer.querySelector(`.${PAYLOAD_CLASS}`)?.remove()
}
