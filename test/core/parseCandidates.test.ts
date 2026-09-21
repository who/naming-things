import { describe, expect, it } from 'vitest'

import { CandidateParseError, parseCandidates } from '../../src/core/parseCandidates'

const VALID: readonly unknown[] = [
  { name: 'pickupAddress', typeHint: 'string', why: 'Where the courier collects the parcel.' },
  { name: 'dropOffAddress', typeHint: 'string', why: 'Where the parcel is handed over.' },
  { name: 'arriveBy', typeHint: 'Date', why: 'The far end of the promised window.' },
  { name: 'weightGrams', typeHint: 'number', why: 'Weight in minor units avoids float drift.' },
  { name: 'collected', typeHint: 'boolean', why: 'True once the driver has the parcel.' },
  { name: 'collectedAt', typeHint: 'Date | null', why: 'The moment, rather than the fact.' },
  { name: 'driverId', typeHint: 'string', why: 'Identifier-shaped, never a display name.' },
  { name: 'routeCode', typeHint: 'string', why: 'The round the job was planned onto.' },
  { name: 'parcelCount', typeHint: 'number', why: 'How many boxes travel under one job.' },
  { name: 'signedFor', typeHint: 'boolean', why: 'Whether someone put their name to it.' },
]

/** A fresh copy of the valid ten, so a mutation in one test cannot leak. */
function validInput(): unknown[] {
  return VALID.map((candidate) => ({ ...(candidate as Record<string, unknown>) }))
}

/** The valid ten with one entry swapped for something under test. */
function withEntry(index: number, entry: unknown): unknown[] {
  const input = validInput()
  input[index] = entry

  return input
}

describe('parseCandidates', () => {
  it('returns ten candidates for well-formed input', () => {
    const parsed = parseCandidates(validInput())

    expect(parsed).toHaveLength(10)
    expect(parsed[0]).toEqual({
      name: 'pickupAddress',
      typeHint: 'string',
      why: 'Where the courier collects the parcel.',
    })
  })

  it('freezes the array it hands back', () => {
    expect(Object.isFrozen(parseCandidates(validInput()))).toBe(true)
  })

  it('trims surrounding whitespace rather than rejecting it', () => {
    const parsed = parseCandidates(
      withEntry(0, { name: '  pickupAddress  ', typeHint: ' string ', why: '  Collected here.  ' }),
    )

    expect(parsed[0]).toEqual({
      name: 'pickupAddress',
      typeHint: 'string',
      why: 'Collected here.',
    })
  })

  it('accepts a reserved word, which is still a valid property key', () => {
    const parsed = parseCandidates(
      withEntry(0, { name: 'class', typeHint: 'string', why: 'Reserved words are legal keys.' }),
    )

    expect(parsed[0]?.name).toBe('class')
  })

  it('accepts names that differ only by case', () => {
    const parsed = parseCandidates(
      withEntry(1, { name: 'PickupAddress', typeHint: 'string', why: 'A distinct option key.' }),
    )

    expect(parsed[1]?.name).toBe('PickupAddress')
  })

  it('rejects a non-array', () => {
    expect(() => parseCandidates({ candidates: validInput() })).toThrow(CandidateParseError)
    expect(() => parseCandidates(null)).toThrow(/must be an array/)
  })

  it('rejects nine items', () => {
    expect(() => parseCandidates(validInput().slice(0, 9))).toThrow(/exactly 10 items, not 9/)
  })

  it('rejects eleven items', () => {
    const input = validInput()
    input.push({ name: 'refunded', typeHint: 'boolean', why: 'One too many.' })

    expect(() => parseCandidates(input)).toThrow(/exactly 10 items, not 11/)
  })

  it('rejects an entry that is not an object', () => {
    expect(() => parseCandidates(withEntry(2, 'pickupAddress'))).toThrow(
      /candidate 2: must be an object/,
    )
  })

  it('rejects a name that is not a JavaScript identifier', () => {
    expect(() =>
      parseCandidates(withEntry(3, { name: '2weight', typeHint: 'number', why: 'Leads with a digit.' })),
    ).toThrow(/candidate 3: name "2weight" is not a JavaScript identifier/)
  })

  it('rejects an exact duplicate name', () => {
    expect(() =>
      parseCandidates(
        withEntry(4, { name: 'pickupAddress', typeHint: 'string', why: 'Collides as an option key.' }),
      ),
    ).toThrow(/candidate 4: name "pickupAddress" repeats an earlier candidate/)
  })

  it('rejects an empty typeHint', () => {
    expect(() =>
      parseCandidates(withEntry(1, { name: 'dropOffAddress', typeHint: '   ', why: 'No type at all.' })),
    ).toThrow(/candidate 1: typeHint must be 1 to 24 characters, not 0/)
  })

  it('rejects an over-long typeHint', () => {
    expect(() =>
      parseCandidates(
        withEntry(1, { name: 'dropOffAddress', typeHint: 'x'.repeat(25), why: 'Too long to read.' }),
      ),
    ).toThrow(/typeHint must be 1 to 24 characters, not 25/)
  })

  it('rejects an empty why', () => {
    expect(() =>
      parseCandidates(withEntry(0, { name: 'pickupAddress', typeHint: 'string', why: '' })),
    ).toThrow(/candidate 0: why must be 1 to 140 characters, not 0/)
  })

  it('rejects an over-long why', () => {
    expect(() =>
      parseCandidates(
        withEntry(0, { name: 'pickupAddress', typeHint: 'string', why: 'w'.repeat(141) }),
      ),
    ).toThrow(/candidate 0: why must be 1 to 140 characters, not 141/)
  })

  it('rejects a non-string field rather than coercing it', () => {
    expect(() =>
      parseCandidates(withEntry(3, { name: 'weightGrams', typeHint: 7, why: 'A number, not a string.' })),
    ).toThrow(/candidate 3: typeHint must be a string/)

    expect(() =>
      parseCandidates(withEntry(3, { name: 'weightGrams', typeHint: 'number', why: null })),
    ).toThrow(/candidate 3: why must be a string/)
  })
})
