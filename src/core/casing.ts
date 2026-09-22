/**
 * The casing a run asked for, applied to the names it got back.
 *
 * The naming chip used to be advice and nothing more: the prompt mentioned it,
 * the model weighed it against everything else in the brief, and a visitor who
 * switched to PascalCase and clicked Run often read the same camelCase ten
 * again. A control that does not visibly move the thing it names is worse than
 * no control, so the casing is settled here rather than hoped for upstream.
 *
 * Nothing here touches the network or the DOM, so the page, the tests and the
 * Worker's own copy of this rule all read a name the same way.
 */

import { IDENTIFIER } from './parseCandidates'
import type { Candidate, StyleVal } from './types'

/** The three the chips offer, which are the three a name can be rewritten into. */
export type Casing = StyleVal['naming']

/**
 * An identifier split into the words it was built from.
 *
 * Both boundaries a property name uses: the underscore, and the step from a
 * lowercase character to an uppercase one. The second rule keeps an acronym
 * whole — `httpURLCount` is three words rather than five — so `snake_case`
 * renders it `http_url_count` instead of scattering it a letter at a time.
 */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_]+/)
    .filter((word) => word.length > 0)
}

/** One name, rewritten into one casing. */
export function recase(name: string, casing: Casing): string {
  const lower = words(name).map((word) => word.toLowerCase())

  if (casing === 'snake_case') {
    return lower.join('_')
  }

  const capitalized = lower.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)

  if (casing === 'PascalCase') {
    return capitalized.join('')
  }

  const [first = ''] = lower

  return `${first}${capitalized.slice(1).join('')}`
}

/**
 * The ten in the chosen casing, or the ten exactly as they arrived.
 *
 * All ten or none: rewriting is only safe while it leaves ten distinct
 * identifiers. Two names that differ by casing alone collapse into a single
 * option key, and the Jev payload built from that would offer nine options
 * while the page went on drawing ten cards. A name with nothing left to
 * rewrite — a lone underscore has no word inside it — says the same thing
 * about the set it came from, so that set is handed back untouched.
 */
export function applyCasing(candidates: readonly Candidate[], casing: Casing): Candidate[] {
  const recased = candidates.map((candidate) => ({
    ...candidate,
    name: recase(candidate.name, casing),
  }))
  const names = new Set(recased.map((candidate) => candidate.name))

  if (names.size !== recased.length || recased.some(({ name }) => !IDENTIFIER.test(name))) {
    return [...candidates]
  }

  return recased
}
