/**
 * The canned run behind sample mode.
 *
 * A visitor with no key still has to see the point of the page, so this
 * fixture is a real disagreement rather than a pleasant one: the plain model
 * reaches for the short noun and Jev reaches for the name that carries its
 * unit. An agreeing fixture would demo nothing.
 */

import type { Candidate, JevPick, LlmPick } from '../core/types'

/** One complete head-to-head, minus the style, which the visitor owns. */
export interface SampleRun {
  descriptor: string
  code: string
  candidates: readonly Candidate[]
  llm: LlmPick
  jev: JevPick
}

export const SAMPLE_RUN: SampleRun = {
  descriptor:
    'A DeliveryJob in a courier dispatch system, holding the pickup address, the drop-off address, the time the driver has to arrive by and the moment the parcel was collected. The property to name is the weight of that parcel, recorded in whole grams at the depot scale and never absent. Dispatch sums it across a van load to check against the axle limit, so the name has to hold its own beside a capacity figure.',
  code: [
    'interface DeliveryJob {',
    '  pickupAddress: string',
    '  dropOffAddress: string',
    '  arriveBy: Date',
    '  collectedAt: Date | null',
    '  // the parcel, weighed in grams — what should this be called?',
    '}',
  ].join('\n'),
  candidates: [
    {
      name: 'weight',
      typeHint: 'number',
      why: 'The plain noun, and the first thing most people reach for.',
    },
    {
      name: 'weightGrams',
      typeHint: 'number',
      why: 'Carries the unit in the key, so no caller has to guess kilograms.',
    },
    {
      name: 'parcelWeightGrams',
      typeHint: 'number',
      why: 'Says both what is weighed and in what unit, at the cost of length.',
    },
    {
      name: 'massGrams',
      typeHint: 'number',
      why: 'Physically correct, though couriers and their paperwork all say weight.',
    },
    {
      name: 'weightInGrams',
      typeHint: 'number',
      why: 'Reads like prose, but the preposition earns nothing inside a key.',
    },
  ],
  llm: {
    name: 'weight',
    reason:
      'The surrounding interface is already about a parcel, so the shorter name reads cleanly at every call site.',
    // The pin both live paths ask for, so a canned badge names the same judge a
    // live one would rather than advertising itself as a fixture.
    model: 'claude-haiku-4-5-20251001',
  },
  jev: {
    choice: 'weightGrams',
    confidence: 0.71,
    probabilities: {
      weight: 0.14,
      weightGrams: 0.52,
      parcelWeightGrams: 0.21,
      massGrams: 0.05,
      weightInGrams: 0.08,
    },
    model: 'jev-1.13.0',
  },
}
