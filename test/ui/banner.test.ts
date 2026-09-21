import { describe, expect, it } from 'vitest'

import { LiveCallError, type FallbackReason } from '../../src/api/remote'
import {
  NETWORK_DOWN,
  PROVIDER_FAILED,
  QUOTA_SPENT,
  RUN_BUSY,
  SERVICE_OFF,
  visitorMessage,
} from '../../src/ui/banner'

/**
 * The published mapping, spelled out here rather than imported, so a line moved
 * from one failure to another has to be a deliberate change to what the page
 * tells a visitor and not a silent one.
 */
const EXPECTED: Record<FallbackReason, string> = {
  'quota exceeded': QUOTA_SPENT,
  'service unavailable': SERVICE_OFF,
  'upstream busy': RUN_BUSY,
  'provider error': PROVIDER_FAILED,
  'network error': NETWORK_DOWN,
}

describe('visitorMessage', () => {
  it('gives each live failure its own line', () => {
    for (const [reason, copy] of Object.entries(EXPECTED)) {
      expect(visitorMessage(new LiveCallError(reason as FallbackReason))).toBe(copy)
    }

    expect(new Set(Object.values(EXPECTED)).size).toBe(Object.keys(EXPECTED).length)
  })

  /**
   * The regression this file exists for: every live failure used to come out as
   * the busy line, which told someone looking at a spent quota or an
   * unconfigured deployment to try again in a moment. Only overload is worth
   * that sentence.
   */
  it('keeps the busy wording for overload alone', () => {
    const busy = Object.entries(EXPECTED)
      .filter(([, copy]) => copy === RUN_BUSY)
      .map(([reason]) => reason)

    expect(busy).toEqual(['upstream busy'])
  })

  it('never puts the reason vocabulary itself on the page', () => {
    for (const reason of Object.keys(EXPECTED)) {
      expect(visitorMessage(new LiveCallError(reason as FallbackReason))).not.toContain(reason)
    }
  })

  /**
   * A reason this module has no line for is still a failure someone is waiting
   * on. It lands on the same sentence an ordinary error does, which is the one
   * written for a failure nobody can act on — not an empty strip, and not the
   * busy line it used to inherit.
   */
  it('falls back to the generic line for a reason it was never told about', () => {
    const unknown = new LiveCallError('teapot' as FallbackReason)

    expect(visitorMessage(unknown)).toBe(visitorMessage(new Error('boom')))
    expect(visitorMessage(unknown)).not.toBe(RUN_BUSY)
  })
})
