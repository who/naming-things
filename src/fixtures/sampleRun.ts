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
    {
      name: 'grams',
      typeHint: 'number',
      why: 'The unit standing in for the quantity, which reads oddly on its own.',
    },
    {
      name: 'parcelGrams',
      typeHint: 'number',
      why: 'Shorter than the full phrase, if you accept the unit as the noun.',
    },
    {
      name: 'netWeightGrams',
      typeHint: 'number',
      why: 'The shipping term, which promises packaging is excluded — and it is not.',
    },
    {
      name: 'parcelMass',
      typeHint: 'number',
      why: 'Names what is measured, then drops the unit the axle check needs.',
    },
    {
      name: 'weightG',
      typeHint: 'number',
      why: 'The unit abbreviated: four characters saved, and a reader slowed down.',
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
      weight: 0.12,
      weightGrams: 0.46,
      parcelWeightGrams: 0.15,
      massGrams: 0.04,
      weightInGrams: 0.05,
      grams: 0.03,
      parcelGrams: 0.06,
      netWeightGrams: 0.04,
      parcelMass: 0.03,
      weightG: 0.02,
    },
    model: 'jev-1.13.0',
  },
}
