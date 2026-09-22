import { beforeEach, describe, expect, it } from 'vitest'

import { setRunInviting } from '../../src/ui/runInvite'

/** The class the stylesheet hangs the halo on, spelled here so a rename shows up. */
const INVITING_CLASS = 'is-inviting'

let run: HTMLButtonElement

beforeEach(() => {
  run = document.createElement('button')
})

describe('setRunInviting', () => {
  it('puts the offer on and takes it back off', () => {
    setRunInviting(run, true)
    expect(run.classList.contains(INVITING_CLASS)).toBe(true)

    setRunInviting(run, false)
    expect(run.classList.contains(INVITING_CLASS)).toBe(false)
  })

  /**
   * The callers are a click, a promise's `then` and a page's first paint, and
   * none of them knows what the others did: clearing an offer nobody made, or
   * making one twice, has to be as ordinary as making it once.
   */
  it('is a no-op the second time either way', () => {
    setRunInviting(run, false)
    expect(run.classList.contains(INVITING_CLASS)).toBe(false)

    setRunInviting(run, true)
    setRunInviting(run, true)
    expect(run.classList.contains(INVITING_CLASS)).toBe(true)
  })

  /**
   * The case worth a test of its own: Run is greyed for the length of every run
   * it starts, and a page that lit the button anyway would be inviting a click
   * it has already decided to refuse.
   */
  it('refuses to invite a click on a disabled button', () => {
    run.disabled = true
    setRunInviting(run, true)

    expect(run.classList.contains(INVITING_CLASS)).toBe(false)
  })

  it('leaves nothing behind when the button is disabled mid-offer', () => {
    setRunInviting(run, true)
    run.disabled = true
    setRunInviting(run, true)

    expect(run.classList.contains(INVITING_CLASS)).toBe(false)
  })
})
