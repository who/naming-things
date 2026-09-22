import { describe, expect, it } from 'vitest'

import { applyCasing, recase } from '../../src/core/casing'
import type { Candidate } from '../../src/core/types'

/** Ten camelCase names, which is what a model tends to answer whatever it was asked. */
const CAMEL: readonly Candidate[] = [
  { name: 'lastRunAt', typeHint: 'Date | null', why: 'The moment, and that it may never have come.' },
  { name: 'runCount', typeHint: 'number', why: 'How many times, without saying when.' },
  { name: 'queryText', typeHint: 'string', why: 'Prose rather than a structured filter.' },
  { name: 'isPinned', typeHint: 'boolean', why: 'Reads as a yes-or-no at the call site.' },
  { name: 'ownerId', typeHint: 'string', why: 'Identifier-shaped, never a display name.' },
  { name: 'workspaceId', typeHint: 'string', why: 'Scopes the search to its workspace.' },
  { name: 'createdAt', typeHint: 'Date', why: 'When the search was written.' },
  { name: 'scheduleId', typeHint: 'string | null', why: 'Points at the schedule itself.' },
  { name: 'resultCount', typeHint: 'number', why: 'What came back, not what was asked.' },
  { name: 'isArchived', typeHint: 'boolean', why: 'The other yes-or-no, spelled the same way.' },
]

/** The ten, with two entries swapped for names under test. */
function withNames(...names: string[]): Candidate[] {
  return CAMEL.map((candidate, index) => ({ ...candidate, name: names[index] ?? candidate.name }))
}

describe('recase', () => {
  it('rewrites one name into each of the three casings', () => {
    expect(recase('lastRunAt', 'PascalCase')).toBe('LastRunAt')
    expect(recase('lastRunAt', 'snake_case')).toBe('last_run_at')
    expect(recase('last_run_at', 'camelCase')).toBe('lastRunAt')
    expect(recase('LastRunAt', 'camelCase')).toBe('lastRunAt')
  })

  it('leaves a name that is already in the asked-for casing exactly as it is', () => {
    for (const { name } of CAMEL) {
      expect(recase(name, 'camelCase')).toBe(name)
    }
  })

  it('keeps an acronym whole rather than scattering it a letter at a time', () => {
    expect(recase('httpURLCount', 'snake_case')).toBe('http_url_count')
    expect(recase('httpURLCount', 'PascalCase')).toBe('HttpUrlCount')
    expect(recase('utf8Bytes', 'snake_case')).toBe('utf8_bytes')
  })
})

describe('applyCasing', () => {
  it('puts all ten into the casing the visitor chose', () => {
    expect(applyCasing(CAMEL, 'PascalCase').map(({ name }) => name)).toEqual([
      'LastRunAt',
      'RunCount',
      'QueryText',
      'IsPinned',
      'OwnerId',
      'WorkspaceId',
      'CreatedAt',
      'ScheduleId',
      'ResultCount',
      'IsArchived',
    ])
  })

  it('carries the rest of each candidate through untouched', () => {
    const [first] = applyCasing(CAMEL, 'snake_case')

    expect(first).toEqual({
      name: 'last_run_at',
      typeHint: 'Date | null',
      why: 'The moment, and that it may never have come.',
    })
  })

  it('keeps the ten it was given when the rewrite would merge two of them', () => {
    const colliding = withNames('lastRunAt', 'LastRunAt')

    expect(applyCasing(colliding, 'PascalCase').map(({ name }) => name)).toEqual(
      colliding.map(({ name }) => name),
    )
  })

  it('keeps the ten it was given when a rewrite would not be an identifier', () => {
    const unnameable = withNames('_')

    expect(applyCasing(unnameable, 'camelCase')).toEqual(unnameable)
  })
})
