/**
 * The waiting treatment borrowed from ActivityCard, in about thirty lines.
 *
 * ActivityCard (github.com/who/ActivityCard) is a React component, and the
 * part of it worth having here is not the component: it is one visual idea —
 * a purple highlight travelling around the border of the thing that is
 * thinking. This page is vanilla Vite and TypeScript, and pulling a React
 * runtime into a static demo to rent one border animation would cost every
 * visitor a framework download for an effect that is a class toggle and a
 * conic gradient. So the idea is vendored and the dependency is not; the
 * gradient itself lives in `styles.css` next to the rest of the page's chrome.
 *
 * Purple is doing work, not decoration. Orange already means the plain model
 * on this page and blue already means Jev, so a waiting state in either colour
 * would read as one of those two sides answering. ActivityCard's purple is the
 * one accent here that belongs to neither.
 */

/** The class the stylesheet hangs the travelling border and the pulse on. */
const WAITING_CLASS = 'is-waiting'

/**
 * Say whether the thing inside this shell is waiting on an answer.
 *
 * Idempotent in both directions, because the callers are a promise's start and
 * its `finally`: a second click that the in-flight guard turned away must not
 * be able to leave the border running after the first call settles, and
 * clearing a shell that was never marked has to be a no-op rather than a
 * throw.
 *
 * `aria-busy` rides along with the class for the same reason the run stages set
 * it: the border is invisible to a screen reader, and a box whose text is about
 * to be replaced should announce the wait rather than the stale prose.
 */
export function setActivityWaiting(shell: HTMLElement, waiting: boolean): void {
  shell.classList.toggle(WAITING_CLASS, waiting)
  shell.setAttribute('aria-busy', String(waiting))
}
