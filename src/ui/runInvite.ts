/**
 * The invitation on Run: a slow green breath under the button to press next.
 *
 * Enabling a button says it may be pressed. It does not say it is the thing to
 * press, and on this page the difference matters twice — once when the page
 * opens holding a brief nobody has asked about yet, and once when Randomize
 * lands a new one over cleared results. Both times Run is the only move left,
 * and both times the only signal for it was an attribute coming off.
 *
 * Green, because green is already Run's on this page and the invitation is not
 * a new thing to learn: purple means the box is waiting on a model, orange and
 * blue mean a judge answered. A fourth colour here would be a legend entry for
 * a button that is simply ready.
 *
 * Quieter than the waiting border it sits beside, deliberately. That one is
 * reporting a call in flight and may fairly hold the eye; this one is an offer,
 * and an offer that flashes reads as a warning. The stylesheet spends it as a
 * halo that fades in and out over a couple of seconds, with no motion at all
 * for someone who asked for less.
 */

/** The class the stylesheet hangs the slow green halo on. */
const INVITING_CLASS = 'is-inviting'

/**
 * Say whether Run is the next thing worth pressing.
 *
 * A disabled button is never inviting, whatever the caller believes: Randomize
 * can fail, a run can still be in flight, and a control that cannot be pressed
 * must not be lit as though it could. The stylesheet refuses the same case on
 * its own, so the pulse is off even if this class is somehow left standing —
 * the guard here is so the DOM says the same thing the pixels do.
 *
 * Idempotent in both directions, because the callers are a click, a promise's
 * `then` and a page's first paint: clearing an invitation nobody made has to be
 * a no-op rather than a throw.
 */
export function setRunInviting(run: HTMLButtonElement, inviting: boolean): void {
  run.classList.toggle(INVITING_CLASS, inviting && !run.disabled)
}
