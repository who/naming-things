/**
 * The named styles behind the Preset control.
 *
 * A preset is a shortcut through the controls that were already there, not a
 * second way of describing taste: each one is a `StyleVal` written out in
 * full, so choosing Golf leaves the chips pressed and the sliders standing
 * where the run will actually find them, and a visitor can carry on tuning
 * from that starting point rather than from the default.
 *
 * Two of them ask for something no chip and no slider can say. Caveman wants
 * every word of every name to be one syllable; Hungarian hangover wants a type
 * prefix welded to the front of each name. Those two carry a `rule` — a line
 * the candidates prompt states as a requirement — and they are the only reason
 * a preset id travels inside `val` at all. The id is a closed union rather
 * than a sentence for exactly that reason: it reaches a prompt, and the side
 * that writes the sentence is always this code rather than whatever a store
 * entry happened to hold.
 */

import { CANDIDATE_COUNT } from './parseCandidates'
import { DEFAULT_VAL, type PresetId, type StyleVal } from './types'

/** One entry of the dropdown: what it is called, what it sets, what it demands. */
export interface Preset {
  id: PresetId
  label: string
  /** A factory for the same reason `DEFAULT_VAL` is one: the UI edits its style in place. */
  val: () => StyleVal
  /** The line the prompt is held to, or the empty string when the chips said it all. */
  rule: string
}

/** What the dropdown reads when the controls do not add up to any preset. */
export const CUSTOM_LABEL = 'Custom'

/** The value that label sits on, which is never written into a style. */
export const CUSTOM_VALUE = 'custom'

/** The monosyllable demand, which is the whole of Caveman and cannot be a weight. */
const CAVEMAN_RULE = [
  `Every word of every one of the ${CANDIDATE_COUNT} names is a single syllable. Compounds are fine`,
  'while each stem is one syllable — processTransaction becomes doDeal, confirmedAtMs becomes',
  'gotTime — but a name carrying one word of two syllables is not a candidate, whatever else it has',
  'going for it.',
].join('\n')

/** The prefix habit, which is a shape the prefer chips have no word for. */
const HUNGARIAN_RULE = [
  "Start every name with a short prefix naming the value's type — n for a number, s for a string, b",
  'for a boolean, dt for a moment in time — and then the name proper: nWeightGrams, bIsPaid,',
  'dtLastRun. The prefix is part of the name rather than a note about it.',
].join('\n')

/**
 * The presets, in the order the dropdown offers them.
 *
 * Default comes first because it is where an untouched page already stands,
 * and the rest run from the most verbose habit to the least. No two of them
 * set the same values: the control reads its own selection back out of the
 * style, so a pair of identical snapshots would be two names for one thing and
 * only one of them would ever show.
 */
export const PRESETS: readonly Preset[] = [
  {
    id: 'default',
    label: 'Default',
    val: DEFAULT_VAL,
    rule: '',
  },
  {
    id: 'enterprise-bean',
    label: 'Enterprise Bean',
    val: () => ({
      naming: 'camelCase',
      prefer: ['domain-nouns'],
      weights: { shortNames: 0, explicitUnits: 0.9, nullable: 0.9 },
      preset: 'enterprise-bean',
    }),
    rule: '',
  },
  {
    id: 'golf',
    label: 'Golf',
    val: () => ({
      naming: 'camelCase',
      prefer: [],
      weights: { shortNames: 1, explicitUnits: 0, nullable: 0.1 },
      preset: 'golf',
    }),
    rule: '',
  },
  {
    id: 'hungarian-hangover',
    label: 'Hungarian hangover',
    val: () => ({
      naming: 'camelCase',
      prefer: ['id-like'],
      weights: { shortNames: 0.4, explicitUnits: 0.7, nullable: 0.5 },
      preset: 'hungarian-hangover',
    }),
    rule: HUNGARIAN_RULE,
  },
  {
    id: 'unix-kernel',
    label: 'Unix kernel',
    val: () => ({
      naming: 'snake_case',
      prefer: [],
      weights: { shortNames: 0.9, explicitUnits: 0.2, nullable: 0.2 },
      preset: 'unix-kernel',
    }),
    rule: '',
  },
  {
    id: 'rails-ish',
    label: 'Rails-ish',
    val: () => ({
      naming: 'snake_case',
      prefer: ['domain-nouns'],
      weights: { shortNames: 0.6, explicitUnits: 0.3, nullable: 0.4 },
      preset: 'rails-ish',
    }),
    rule: '',
  },
  {
    id: 'data-science',
    label: 'Data science',
    val: () => ({
      naming: 'snake_case',
      prefer: ['domain-nouns'],
      weights: { shortNames: 0.3, explicitUnits: 1, nullable: 0.5 },
      preset: 'data-science',
    }),
    rule: '',
  },
  {
    id: 'frontend-react',
    label: 'Frontend React',
    val: () => ({
      naming: 'camelCase',
      prefer: ['booleans-as-isX'],
      weights: { shortNames: 0.5, explicitUnits: 0.3, nullable: 0.6 },
      preset: 'frontend-react',
    }),
    rule: '',
  },
  {
    id: 'pedantic-types',
    label: 'Pedantic types',
    val: () => ({
      naming: 'camelCase',
      prefer: ['domain-nouns'],
      weights: { shortNames: 0, explicitUnits: 1, nullable: 1 },
      preset: 'pedantic-types',
    }),
    rule: '',
  },
  {
    id: 'caveman',
    label: 'Caveman',
    val: () => ({
      naming: 'camelCase',
      prefer: [],
      weights: { shortNames: 1, explicitUnits: 0, nullable: 0 },
      preset: 'caveman',
    }),
    rule: CAVEMAN_RULE,
  },
]

/**
 * A stored or imported token as a preset id, or nothing.
 *
 * Checked against the table rather than against a shape, because the id is the
 * one field of a style that turns into an instruction: an unknown token has no
 * sentence behind it here and must never reach the wire as though it had.
 */
export function readPresetId(value: unknown): PresetId | null {
  return PRESETS.find((preset) => preset.id === value)?.id ?? null
}

/** The same prefer tags in any order, since the chips record the order they were clicked in. */
function samePrefer(left: StyleVal, right: StyleVal): boolean {
  return (
    left.prefer.length === right.prefer.length
    && left.prefer.every((tag) => right.prefer.includes(tag))
  )
}

/**
 * The preset these values are, or `custom` when they are not one.
 *
 * Read out of the style rather than remembered beside it, so the name on the
 * dropdown is always true of the controls underneath it. That matters most in
 * the direction a visitor travels by accident: nudging one slider after
 * choosing Caveman has to stop saying Caveman, because the run it describes is
 * no longer the one Caveman asks for.
 */
export function presetFor(val: StyleVal): PresetId | typeof CUSTOM_VALUE {
  for (const preset of PRESETS) {
    const candidate = preset.val()

    if (
      candidate.naming === val.naming
      && candidate.preset === val.preset
      && samePrefer(candidate, val)
      && (Object.keys(candidate.weights) as (keyof StyleVal['weights'])[]).every(
        (key) => candidate.weights[key] === val.weights[key],
      )
    ) {
      return preset.id
    }
  }

  return CUSTOM_VALUE
}

/** The line this style's preset demands of the ten names, or nothing when it demands none. */
export function presetRule(val: StyleVal): string {
  if (val.preset === undefined) {
    return ''
  }

  return PRESETS.find((preset) => preset.id === val.preset)?.rule ?? ''
}
