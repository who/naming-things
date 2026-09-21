import { describe, expect, it } from 'vitest'

import { DESCRIPTOR_BANK, pickRandomDescriptor } from '../../src/core/descriptors'

const MAX_DESCRIPTOR_LENGTH = 600

describe('DESCRIPTOR_BANK', () => {
  it('holds twelve descriptors', () => {
    expect(DESCRIPTOR_BANK).toHaveLength(12)
  })

  it('keeps every descriptor inside the serialized state budget', () => {
    for (const descriptor of DESCRIPTOR_BANK) {
      expect(descriptor.length).toBeLessThan(MAX_DESCRIPTOR_LENGTH)
    }
  })
})

describe('pickRandomDescriptor', () => {
  it('never returns the descriptor it was told to exclude', () => {
    const excluded = DESCRIPTOR_BANK[0]
    expect(excluded).toBeDefined()

    for (let call = 0; call < 50; call += 1) {
      expect(pickRandomDescriptor(excluded)).not.toBe(excluded)
    }
  })
})
