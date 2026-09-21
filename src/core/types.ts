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

/** Imported naming taste, carried as context rather than enforced as a gate. */
export interface StyleVal {
  naming: 'camelCase' | 'snake_case' | 'PascalCase'
  prefer: PreferTag[]
  weights: {
    shortNames: number
    explicitUnits: number
    nullable: number
  }
}

/** The plain-model choice: one candidate name and the reason it gave. */
export interface LlmPick {
  name: string
  reason: string
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

/** Where a run sources its answers from. */
export type RunMode = 'sample' | 'live' | 'byo'

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
