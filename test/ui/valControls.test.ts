import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_VAL, type StyleVal } from '../../src/core/types'
import { loadVal, mountValControls, saveVal } from '../../src/ui/valControls'

const STORAGE_KEY = 'naming-things:val'

/** Only the two methods this module ever reaches for. */
interface TestStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const REAL_STORAGE = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

/**
 * Put a store of our own in front of the runner's.
 *
 * The ambient `localStorage` here is neither jsdom's nor a browser's, so the
 * tests supply the behavior they are actually about: a store that works, and
 * a store that throws on every call the way a blocked one does.
 */
function useStorage(storage: TestStorage): void {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
}

/** A store that remembers, so persistence can be asserted end to end. */
function workingStorage(): TestStorage {
  const entries = new Map<string, string>()

  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
  }
}

/** A store that refuses, the way private browsing and a full quota both do. */
function blockedStorage(): TestStorage {
  return {
    getItem: () => {
      throw new Error('storage is blocked')
    },
    setItem: () => {
      throw new Error('storage is blocked')
    },
  }
}

/** A style that differs from the default in every field, so a round trip proves something. */
function customVal(): StyleVal {
  return {
    naming: 'snake_case',
    prefer: ['id-like', 'booleans-as-isX'],
    weights: { shortNames: 0.1, explicitUnits: 0.9, nullable: 0.2 },
  }
}

/** The slot the page shell publishes, standing on its own for these tests. */
function mountPoint(): HTMLElement {
  const root = document.createElement('div')

  document.body.replaceChildren(root)

  return root
}

function chip(root: HTMLElement, group: string, value: string): HTMLButtonElement {
  const found = root.querySelector<HTMLButtonElement>(
    `[data-group="${group}"] [data-value="${value}"]`,
  )

  if (found === null) {
    throw new Error(`no ${group} chip for ${value}`)
  }

  return found
}

function presetSelect(root: HTMLElement): HTMLSelectElement {
  const found = root.querySelector<HTMLSelectElement>('[data-group="preset"]')

  if (found === null) {
    throw new Error('no preset dropdown')
  }

  return found
}

/** Choose an option the way a visitor does: set it, then let the page hear about it. */
function choosePreset(root: HTMLElement, value: string): HTMLSelectElement {
  const select = presetSelect(root)

  select.value = value
  select.dispatchEvent(new Event('change'))

  return select
}

function slider(root: HTMLElement, weight: string): HTMLInputElement {
  const found = root.querySelector<HTMLInputElement>(`[data-weight="${weight}"]`)

  if (found === null) {
    throw new Error(`no slider for ${weight}`)
  }

  return found
}

beforeEach(() => {
  useStorage(workingStorage())
})

afterEach(() => {
  if (REAL_STORAGE !== undefined) {
    Object.defineProperty(globalThis, 'localStorage', REAL_STORAGE)
  }
})

describe('loadVal', () => {
  it('round-trips a style through saveVal', () => {
    const val = customVal()

    saveVal(val)

    expect(loadVal()).toEqual(val)
  })

  it('starts from the default when nothing was ever stored', () => {
    expect(loadVal()).toEqual(DEFAULT_VAL())
  })

  it('makes camelCase the casing a first visit arrives with', () => {
    expect(loadVal().naming).toBe('camelCase')
  })

  it('hands back a fresh default rather than a shared one', () => {
    const first = loadVal()

    first.weights.shortNames = 1

    expect(loadVal().weights.shortNames).toBe(0.5)
  })

  it('falls back to the default when the stored value is not JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{ not json at all')

    expect(loadVal()).toEqual(DEFAULT_VAL())
  })

  it('falls back to the default when a weight is out of range', () => {
    const val = customVal()

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...val, weights: { ...val.weights, nullable: 4 } }))

    expect(loadVal()).toEqual(DEFAULT_VAL())
  })

  it('falls back to the default when a weight is a string, not a number', () => {
    const val = customVal()

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...val, weights: { ...val.weights, shortNames: '0.4' } }),
    )

    expect(loadVal()).toEqual(DEFAULT_VAL())
  })

  it('refuses a prefer tag a later version invented', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...customVal(), prefer: ['verbs-as-doX'] }))

    expect(loadVal()).toEqual(DEFAULT_VAL())
  })

  it('refuses a naming style outside the union', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...customVal(), naming: 'kebab-case' }))

    expect(loadVal()).toEqual(DEFAULT_VAL())
  })

  it('accepts an empty prefer list, which is a real answer', () => {
    saveVal({ ...customVal(), prefer: [] })

    expect(loadVal().prefer).toEqual([])
  })

  it('falls back to the default when reading storage throws', () => {
    useStorage(blockedStorage())

    expect(loadVal()).toEqual(DEFAULT_VAL())
  })

  it('round-trips the preset a style was chosen from', () => {
    saveVal({ ...customVal(), preset: 'caveman' })

    expect(loadVal().preset).toBe('caveman')
  })

  it('refuses a preset id this build has no rule for, rather than sending it on', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...customVal(), preset: 'cave-man' }))

    expect(loadVal()).toEqual(DEFAULT_VAL())
  })
})

describe('mountValControls', () => {
  let root: HTMLElement
  let seen: StyleVal[]

  beforeEach(() => {
    root = mountPoint()
    seen = []
  })

  const record = (val: StyleVal): void => {
    seen.push(val)
  }

  it('shows the initial style as the pressed chips and the slider positions', () => {
    mountValControls(root, customVal(), record)

    expect(chip(root, 'naming', 'snake_case').getAttribute('aria-pressed')).toBe('true')
    expect(chip(root, 'naming', 'camelCase').getAttribute('aria-pressed')).toBe('false')
    expect(chip(root, 'prefer', 'id-like').getAttribute('aria-pressed')).toBe('true')
    expect(chip(root, 'prefer', 'domain-nouns').getAttribute('aria-pressed')).toBe('false')
    expect(slider(root, 'explicitUnits').value).toBe('0.9')
  })

  it('presses camelCase on a first visit, so Run needs no chip chosen first', () => {
    mountValControls(root, loadVal(), record)

    expect(chip(root, 'naming', 'camelCase').getAttribute('aria-pressed')).toBe('true')
    expect(chip(root, 'naming', 'snake_case').getAttribute('aria-pressed')).toBe('false')
    expect(chip(root, 'naming', 'PascalCase').getAttribute('aria-pressed')).toBe('false')
  })

  it('emits the new style when a naming chip is chosen', () => {
    mountValControls(root, DEFAULT_VAL(), record)

    chip(root, 'naming', 'PascalCase').click()

    expect(seen).toHaveLength(1)
    expect(seen.at(-1)?.naming).toBe('PascalCase')
  })

  it('releases the naming chip that was pressed before, since a property has one casing', () => {
    mountValControls(root, DEFAULT_VAL(), record)

    chip(root, 'naming', 'PascalCase').click()

    expect(chip(root, 'naming', 'camelCase').getAttribute('aria-pressed')).toBe('false')
    expect(chip(root, 'naming', 'PascalCase').getAttribute('aria-pressed')).toBe('true')
  })

  it('stacks prefer tags, because taste stacks', () => {
    mountValControls(root, DEFAULT_VAL(), record)

    chip(root, 'prefer', 'id-like').click()

    expect(seen.at(-1)?.prefer).toEqual(['domain-nouns', 'id-like'])
  })

  it('emits an empty list when the last prefer chip is switched off', () => {
    mountValControls(root, DEFAULT_VAL(), record)

    chip(root, 'prefer', 'domain-nouns').click()

    expect(seen.at(-1)?.prefer).toEqual([])
    expect(chip(root, 'prefer', 'domain-nouns').getAttribute('aria-pressed')).toBe('false')
  })

  it('emits a weight as a number, so the payload stays typed', () => {
    mountValControls(root, DEFAULT_VAL(), record)

    const control = slider(root, 'shortNames')

    control.value = '0.8'
    control.dispatchEvent(new Event('input'))

    expect(seen.at(-1)?.weights.shortNames).toBe(0.8)
    expect(typeof seen.at(-1)?.weights.shortNames).toBe('number')
  })

  it('writes the moved weight into its readout', () => {
    mountValControls(root, DEFAULT_VAL(), record)

    const control = slider(root, 'nullable')

    control.value = '0.3'
    control.dispatchEvent(new Event('input'))

    expect(root.querySelectorAll('.val-weight-value')[2]?.textContent).toBe('0.3')
  })

  it('persists every change, so a reload starts where the visitor left off', () => {
    mountValControls(root, DEFAULT_VAL(), record)

    chip(root, 'naming', 'snake_case').click()

    expect(loadVal().naming).toBe('snake_case')
  })

  it('hands out a copy, so a later change cannot rewrite a style already emitted', () => {
    mountValControls(root, DEFAULT_VAL(), record)

    chip(root, 'naming', 'snake_case').click()
    chip(root, 'naming', 'PascalCase').click()

    expect(seen[0]?.naming).toBe('snake_case')
  })

  it('leaves the caller’s initial object alone', () => {
    const initial = DEFAULT_VAL()

    mountValControls(root, initial, record)
    chip(root, 'naming', 'snake_case').click()

    expect(initial.naming).toBe('camelCase')
  })

  it('replaces its own controls when mounted twice', () => {
    mountValControls(root, DEFAULT_VAL(), record)
    mountValControls(root, DEFAULT_VAL(), record)

    expect(root.querySelectorAll('[data-group="naming"]')).toHaveLength(1)
  })

  it('names the default style on the dropdown, since that is where a first visit stands', () => {
    mountValControls(root, DEFAULT_VAL(), record)

    expect(presetSelect(root).value).toBe('default')
  })

  it('offers Caveman, whose single-syllable rule no chip can ask for', () => {
    mountValControls(root, DEFAULT_VAL(), record)

    const labels = [...presetSelect(root).options].map((option) => option.textContent)

    expect(labels).toContain('Caveman')
    expect(labels).toContain('Custom')
  })

  it('writes the chosen preset into the chips, the sliders and the emitted style', () => {
    mountValControls(root, customVal(), record)

    choosePreset(root, 'caveman')

    expect(chip(root, 'naming', 'camelCase').getAttribute('aria-pressed')).toBe('true')
    expect(chip(root, 'prefer', 'id-like').getAttribute('aria-pressed')).toBe('false')
    expect(slider(root, 'shortNames').value).toBe('1')
    expect(root.querySelectorAll('.val-weight-value')[0]?.textContent).toBe('1.0')
    expect(seen.at(-1)?.preset).toBe('caveman')
    expect(seen.at(-1)?.weights).toEqual({ shortNames: 1, explicitUnits: 0, nullable: 0 })
  })

  it('flips to Custom when a slider moves under a preset, and drops the preset with it', () => {
    mountValControls(root, DEFAULT_VAL(), record)
    choosePreset(root, 'caveman')

    const control = slider(root, 'nullable')

    control.value = '0.4'
    control.dispatchEvent(new Event('input'))

    expect(presetSelect(root).value).toBe('custom')
    expect(seen.at(-1)?.preset).toBeUndefined()
  })

  it('flips to Custom when a chip is pressed under a preset', () => {
    mountValControls(root, DEFAULT_VAL(), record)
    choosePreset(root, 'unix-kernel')

    chip(root, 'naming', 'PascalCase').click()

    expect(presetSelect(root).value).toBe('custom')
    expect(seen.at(-1)?.naming).toBe('PascalCase')
  })

  it('reads Custom for a style that is none of the presets', () => {
    mountValControls(root, customVal(), record)

    expect(presetSelect(root).value).toBe('custom')
  })

  it('names the preset again after a reload, because the style still is that preset', () => {
    mountValControls(root, DEFAULT_VAL(), record)
    choosePreset(root, 'golf')

    mountValControls(mountPoint(), loadVal(), record)

    expect(presetSelect(document.body).value).toBe('golf')
  })

  it('changes nothing when Custom is chosen, since it is a readout and not a style', () => {
    mountValControls(root, DEFAULT_VAL(), record)
    choosePreset(root, 'golf')

    const emitted = seen.length

    choosePreset(root, 'custom')

    expect(presetSelect(root).value).toBe('golf')
    expect(seen).toHaveLength(emitted)
  })

  it('persists the preset, so the next run still asks for what it asks for', () => {
    mountValControls(root, DEFAULT_VAL(), record)

    choosePreset(root, 'caveman')

    expect(loadVal().preset).toBe('caveman')
  })

  it('mounts and keeps emitting when storage is blocked entirely', () => {
    useStorage(blockedStorage())

    expect(() => {
      mountValControls(root, DEFAULT_VAL(), record)
    }).not.toThrow()

    expect(() => {
      chip(root, 'naming', 'snake_case').click()
    }).not.toThrow()

    expect(seen.at(-1)?.naming).toBe('snake_case')
  })
})
