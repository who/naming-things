/**
 * The two strips above the fold: what kind of run this is, and what went wrong.
 *
 * Both regions start hidden in the markup and are shown only when they have
 * something to say, so an untouched page carries no empty bars. Neither one
 * ever renders a credential: the banner is fixed copy plus a short caller-
 * supplied reason, and the error strip shows a message only when it comes from
 * an error class whose text was written to be read by a visitor.
 */

import { LiveCallError } from '../api/remote'
import { CandidateParseError } from '../core/parseCandidates'
import { StateTooLargeError } from '../core/pipeline'
import type { RunMode } from '../core/types'
import type { UiRefs } from './dom'

/**
 * What each mode tells the visitor, or nothing when it has nothing to say.
 *
 * Byo names whose quota is being spent, which is the one thing separating it
 * from the hosted run. An unconfigured build names the only thing a visitor
 * could otherwise be left to infer from three dead buttons: this deployment was
 * never pointed at an API, so there is nothing here to press.
 *
 * The hosted live run is the page working as intended, and a strip announcing
 * that is furniture: it tells a visitor nothing they can act on, and takes the
 * space directly above the answers to say it. So live carries no copy, and a
 * clean live run shows no bar at all.
 */
const MODE_COPY: Record<RunMode, string | null> = {
  live: null,
  byo: 'Live run with your local keys',
  unconfigured: 'This build was never given an API to call — nothing here can run',
}

/**
 * Shown for any failure whose message was not written for a visitor.
 *
 * A transport error's text can carry a URL, a header or a key fragment, so it
 * stays in the console and this sentence goes on the page.
 */
const GENERIC_ERROR = 'That run could not finish. Try again in a moment.'

/**
 * The one thing said about a live call that would not answer.
 *
 * A quota that has run out, a Worker missing its keys and a provider having a
 * bad minute are four short reasons inside this app and one sentence outside
 * it, because they are one situation to whoever is reading: the names are not
 * coming right now, and the thing to do is ask again later. Nothing stands in
 * for them in the meantime — a page that filled the cards from a fixture here
 * would be answering with names no model chose.
 */
export const RUN_BUSY = 'Too busy to answer that right now. Try again in a moment.'

/**
 * What a visitor is told when Randomize comes back with nothing.
 *
 * Randomize is not a run, so the line above would name something that never
 * started. What is left to say is short and true either way: whatever went
 * wrong upstream, the box still holds the prose it held a second ago and the
 * button is ready to be pressed again.
 */
export const RANDOMIZE_BUSY = 'Could not fetch a new brief right now. Try again in a moment.'

/**
 * Name the mode this run used, and why it is not the one that was asked for.
 *
 * `reason` is a short phrase the caller chose — "quota exceeded", "network
 * error" — not raw transport text, because it is appended to fixed copy and
 * shown verbatim. Nothing in the app passes one today; the parameter stays
 * because the strip is the place a standing condition on a mode belongs, as
 * against a failed run, which is the error strip's business and is over.
 *
 * A mode with no copy takes the strip back down rather than leaving an empty
 * one.
 */
export function setModeBanner(refs: UiRefs, mode: RunMode, reason?: string): void {
  const copy = MODE_COPY[mode]

  if (copy === null) {
    refs.banner.textContent = ''
    refs.banner.hidden = true

    return
  }

  refs.banner.textContent = reason === undefined ? copy : `${copy} (${reason})`
  refs.banner.hidden = false
}

/**
 * The most a visitor can usefully be told about one failure.
 *
 * A rejected payload and an over-budget state both explain themselves in their
 * message — which candidate broke which rule, how many bytes over the limit —
 * so those are passed through word for word. A live call that would not answer
 * is the busy line instead: its own message names an upstream condition in this
 * app's vocabulary, and the visitor's half of that is one sentence. Anything
 * else is something nobody can act on, and gets the generic line.
 *
 * One function, because the error strip and the two pick badges must not
 * disagree about how much of the same failure is safe to put on screen.
 */
export function visitorMessage(error: unknown): string {
  if (error instanceof LiveCallError) {
    return RUN_BUSY
  }

  const readable = error instanceof CandidateParseError || error instanceof StateTooLargeError

  return readable ? error.message : GENERIC_ERROR
}

/**
 * Put a failure on the page instead of leaving it looking hung.
 */
export function showError(refs: UiRefs, error: unknown): void {
  refs.error.textContent = visitorMessage(error)
  refs.error.hidden = false
}

/**
 * Put fixed copy in the error strip, with no failure to inspect first.
 *
 * `showError` exists to decide how much of an error is safe to show. This is
 * for the cases where that question is already settled because the copy is a
 * constant in this module rather than anything a transport produced, so there
 * is nothing to leak and nothing to classify.
 */
export function showBusy(refs: UiRefs, copy: string): void {
  refs.error.textContent = copy
  refs.error.hidden = false
}

/**
 * Take the error strip back down.
 *
 * Called as a run starts: the previous run's failure sitting over a fresh set
 * of cards reads as a verdict on those cards.
 */
export function clearError(refs: UiRefs): void {
  refs.error.textContent = ''
  refs.error.hidden = true
}
