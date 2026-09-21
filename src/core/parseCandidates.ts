/**
 * The gate between model output and the cards.
 *
 * A head-to-head over nine options is not the demo, so this module fails
 * closed: either the model produced exactly ten well-formed candidates, or
 * the run is an error the UI can name. Nothing here touches the network or the
 * DOM, so the browser and the Cloudflare Worker can both apply the same rules
 * to the same payload.
 */

import type { Candidate } from './types'

/**
 * How many candidates one run must yield. Any other count is an error.
 *
 * Exported because the count is a fact about the run rather than about this
 * parser: the prompt that asks for the names and the tool schema that shapes
 * them are written from the same number, and a second copy of it is a second
 * chance for the ask and the gate to drift apart.
 */
export const CANDIDATE_COUNT = 10

/** A leading letter or underscore, then letters, digits or underscores. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A type hint rides in a card header, so it stays short enough to read. */
const MAX_TYPE_HINT_LENGTH = 24

/** The case for a name is a sentence, not an essay. */
const MAX_WHY_LENGTH = 140

/**
 * Raised when model output cannot become ten well-formed candidates.
 *
 * The message names the offending index and the rule it broke, so the error
 * surface can show something more useful than "parsing failed".
 */
export class CandidateParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CandidateParseError'
  }
}

/**
 * Read one string field, rejecting anything that is not already a string.
 *
 * Numbers and nulls are refused rather than coerced: a model that answered
 * with the wrong shape has not answered, and `String(null)` would smuggle the
 * word "null" onto a card.
 */
function readString(entry: Record<string, unknown>, field: string, index: number): string {
  const value = entry[field]

  if (typeof value !== 'string') {
    throw new CandidateParseError(`candidate ${index}: ${field} must be a string`)
  }

  return value.trim()
}

/**
 * Validate raw model output into exactly ten candidates, or throw.
 *
 * Names must be usable as property keys and as Jev choice option keys, which
 * is why they are checked against the identifier shape and rejected on an
 * exact collision. Comparison is case-sensitive, so `itemCount` and
 * `ItemCount` are two distinct options rather than a duplicate.
 */
export function parseCandidates(raw: unknown): Candidate[] {
  if (!Array.isArray(raw)) {
    throw new CandidateParseError('candidates must be an array')
  }

  if (raw.length !== CANDIDATE_COUNT) {
    throw new CandidateParseError(
      `candidates must hold exactly ${CANDIDATE_COUNT} items, not ${raw.length}`,
    )
  }

  const seen = new Set<string>()
  const parsed: Candidate[] = []

  for (let index = 0; index < raw.length; index += 1) {
    const entry: unknown = raw[index]

    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new CandidateParseError(`candidate ${index}: must be an object`)
    }

    const fields = entry as Record<string, unknown>
    const name = readString(fields, 'name', index)
    const typeHint = readString(fields, 'typeHint', index)
    const why = readString(fields, 'why', index)

    if (!IDENTIFIER.test(name)) {
      throw new CandidateParseError(
        `candidate ${index}: name ${JSON.stringify(name)} is not a JavaScript identifier`,
      )
    }

    if (seen.has(name)) {
      throw new CandidateParseError(
        `candidate ${index}: name ${JSON.stringify(name)} repeats an earlier candidate`,
      )
    }

    seen.add(name)

    if (typeHint.length === 0 || typeHint.length > MAX_TYPE_HINT_LENGTH) {
      throw new CandidateParseError(
        `candidate ${index}: typeHint must be 1 to ${MAX_TYPE_HINT_LENGTH} characters, not ${typeHint.length}`,
      )
    }

    if (why.length === 0 || why.length > MAX_WHY_LENGTH) {
      throw new CandidateParseError(
        `candidate ${index}: why must be 1 to ${MAX_WHY_LENGTH} characters, not ${why.length}`,
      )
    }

    parsed.push({ name, typeHint, why })
  }

  Object.freeze(parsed)

  return parsed
}
