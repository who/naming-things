import { describe, expect, it } from 'vitest'

import { bootstrap } from '../src/main'

describe('bootstrap', () => {
  it('throws when the shell markup is missing', () => {
    document.body.innerHTML = '<div id="app"></div>'

    expect(() => bootstrap()).toThrow(/no element matches/)
  })
})
