/**
 * The two strips above the fold: what kind of run this is, and what went wrong.
 *
 * Both regions start hidden in the markup and are shown only when they have
 * something to say, so an untouched page carries no empty bars. Neither one
 * ever renders a credential: the banner is fixed copy plus a short caller-
 * supplied reason, and the error strip shows a message only when it comes from
 * an error class whose text was written to be read by a visitor.
 */

import { CandidateParseError } from '../core/parseCandidates'
import { StateTooLargeError } from '../core/pipeline'
import type { RunMode } from '../core/types'
import type { UiRefs } from './dom'

/**
 * What each mode tells the visitor, or nothing when it has nothing to say.
 *
 * Sample mode names the way out, because a visitor who cannot tell canned
 * answers from live ones will read one fixed disagreement as the whole demo.
 * Byo names whose quota is being spent, which is the one thing separating it
 * from the hosted run.
 *
 * The hosted live run is the page working as intended, and a strip announcing
 * that is furniture: it tells a visitor nothing they can act on, and takes the
 * space directly above the answers to say it. So live carries no copy, and a
 * clean live run shows no bar at all.
 */
const MODE_COPY: Record<RunMode, string | null> = {
  sample: 'Sample run — add keys for live LLM and Jev',
  live: null,
  byo: 'Live run with your local keys',
}

/**
 * What a canned run owes a visitor who asked about something else.
 *
 * The fixture is one courier job, and its five names are about that job. A page
 * that answers a question about gym classes with parcel weights and says
 * nothing is claiming a result it did not produce — so the mismatch goes in the
 * strip that already names the kind of run this was, rather than being left for
 * the visitor to notice from the cards.
 */
export const CANNED_MISMATCH = 'answers are the courier example, not your text'

/**
 * Shown for any failure whose message was not written for a visitor.
 *
 * A transport error's text can carry a URL, a header or a key fragment, so it
 * stays in the console and this sentence goes on the page.
 */
const GENERIC_ERROR = 'That run could not finish. Try again in a moment.'

/**
 * Name the mode this run used, and why it is not the one that was asked for.
 *
 * `reason` is a short phrase the caller chose — "quota exceeded", "network
 * error" — not raw transport text, because it is appended to fixed copy and
 * shown verbatim. It is what separates a live run stopped by a quota from one
 * stopped by an outage, which is a distinction a visitor can act on.
 *
 * A mode with no copy takes the strip back down rather than leaving an empty
 * one, and nothing is lost with it: a run that has a reason to report has
 * already dropped to the canned answers, and is announced as sample.
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
 * Put a failure on the page instead of leaving it looking hung.
 *
 * A rejected payload and an over-budget state both explain themselves in their
 * message — which candidate broke which rule, how many bytes over the limit —
 * so those are shown word for word. Anything else is something the visitor
 * cannot act on, and gets the generic line.
 */
export function showError(refs: UiRefs, error: unknown): void {
  const readable = error instanceof CandidateParseError || error instanceof StateTooLargeError

  refs.error.textContent = readable ? error.message : GENERIC_ERROR
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
