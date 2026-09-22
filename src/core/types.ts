/**
 * The shared vocabulary every naming-things module compiles against.
 *
 * Nothing here reaches the network or the DOM: the parser, the pipeline, the
 * API client and the renderer all import these shapes so a candidate means the
 * same thing on both sides of a call.
 */

/** One proposed property name, with the type it implies and the case for it. */
export interface Candidate {
  name: string
  typeHint: string
  why: string
}

/** A taste preference a visitor can switch on when importing a style. */
export type PreferTag = 'id-like' | 'domain-nouns' | 'booleans-as-isX'

/**
 * One of the named styles the Preset control offers.
 *
 * The id is the only part of a style that can ask a prompt for something the
 * chips and the sliders cannot express, so it is a closed union rather than a
 * string: the run matches the token against a table of its own and writes its
 * own sentence from it, which is what keeps a hand-edited store entry from
 * becoming an instruction. `src/core/presets.ts` holds what each one sets.
 */
export type PresetId =
  | 'default'
  | 'enterprise-bean'
  | 'golf'
  | 'hungarian-hangover'
  | 'unix-kernel'
  | 'rails-ish'
  | 'data-science'
  | 'frontend-react'
  | 'pedantic-types'
  | 'caveman'

/**
 * Imported naming taste: context for the model, except for the casing.
 *
 * `prefer` and `weights` are weighed against everything else in a brief and
 * may lose to it. `naming` is the one field an answer is held to, because a
 * chip that leaves the cards reading exactly as they did is a control that
 * does not work — the ten come back in the casing chosen here whatever the
 * model wrote.
 */
export interface StyleVal {
  naming: 'camelCase' | 'snake_case' | 'PascalCase'
  prefer: PreferTag[]
  weights: {
    shortNames: number
    explicitUnits: number
    nullable: number
  }
  /**
   * The preset these values came from, while they are still exactly it.
   *
   * Absent on a style nobody chose a preset for, and dropped the moment a chip
   * or a slider moves: a preset that survived being edited would keep asking
   * for a run the controls no longer describe.
   */
  preset?: PresetId
}

/**
 * The plain-model choice: one candidate name, the reason it gave, and the model
 * that gave it.
 *
 * `model` is carried for the same reason `JevPick` carries one: the two badges
 * sit side by side, and a reader comparing them is entitled to know which judge
 * each answer came from. A pick that never arrived has no model, and the empty
 * string is how it says so.
 */
export interface LlmPick {
  name: string
  reason: string
  model: string
}

/**
 * The Jev Choice envelope.
 *
 * `confidence` is nullable because the envelope may omit it, and a missing
 * confidence must never read as zero confidence.
 */
export interface JevPick {
  choice: string
  confidence: number | null
  probabilities: Record<string, number>
  model: string
}

/**
 * The state object handed to Jev.
 *
 * The keys are labels the model reads, so they are spelled exactly
 * `descriptor`, `code`, `candidates` and `val`.
 */
export interface JevState {
  descriptor: string
  code: string
  candidates: Candidate[]
  val: StyleVal
}

/** Everything one head-to-head run produced, including whether the two agreed. */
export interface RunResult {
  descriptor: string
  code: string
  candidates: Candidate[]
  llm: LlmPick
  jev: JevPick
  val: StyleVal
  agree: boolean
}

/** Where a run has got to, for progressive rendering. */
export type RunStage = 'candidates' | 'llmPick' | 'jevPick'

/**
 * The two stages a visitor waits on side by side.
 *
 * Named because three parts of the UI take one of these and not the third: the
 * candidates stage fills the cards and has no badge, no failure of its own to
 * render and no clock beside a heading, since losing it ends the run outright.
 */
export type PickStage = Exclude<RunStage, 'candidates'>

/** Where a run sources its answers from, or that it has nowhere to source them. */
export type RunMode = 'live' | 'byo' | 'unconfigured'

/**
 * The starting style: camelCase, domain nouns, every weight balanced.
 *
 * This is a factory rather than a shared constant because the UI edits the
 * style in place; handing out one object would let a slider drag rewrite the
 * default for every later run.
 */
export function DEFAULT_VAL(): StyleVal {
  return {
    naming: 'camelCase',
    prefer: ['domain-nouns'],
    weights: {
      shortNames: 0.5,
      explicitUnits: 0.5,
      nullable: 0.5,
    },
  }
}
