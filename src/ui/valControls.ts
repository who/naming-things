/**
 * The taste controls: what a visitor wants names to look like.
 *
 * `val` is context the judge reads, never a gate this code enforces. Nothing
 * here filters, reorders or rejects a candidate — the controls only assemble
 * the object that rides along inside the Jev state, and letting the model
 * answer for itself under that context is the whole point of showing it.
 *
 * The choice outlives the tab, because a demo that forgets your style on every
 * reload is a demo you stop adjusting. Storage is best-effort in both
 * directions: a blocked or corrupt store costs the persistence, never the
 * session.
 */

import {
  CUSTOM_LABEL,
  CUSTOM_VALUE,
  PRESETS,
  presetFor,
  readPresetId,
} from '../core/presets'
import { DEFAULT_VAL, type PreferTag, type StyleVal } from '../core/types'

/** Namespaced, so the bring-your-own-keys entry added later cannot collide. */
const STORAGE_KEY = 'naming-things:val'

/** The casings a property can have. A property has exactly one, so this is single-select. */
const NAMING_STYLES: readonly StyleVal['naming'][] = ['camelCase', 'snake_case', 'PascalCase']

/** Taste stacks, so any number of these can be on at once — including none. */
const PREFER_TAGS: readonly PreferTag[] = ['id-like', 'domain-nouns', 'booleans-as-isX']

/** Each weight, with the words a visitor reads instead of the field name. */
const WEIGHTS: readonly { key: keyof StyleVal['weights']; label: string }[] = [
  { key: 'shortNames', label: 'Short names' },
  { key: 'explicitUnits', label: 'Explicit units' },
  { key: 'nullable', label: 'Nullable' },
]

/** Tenths: fine enough to change an answer, coarse enough to read in the payload. */
const WEIGHT_STEP = 0.1

/** Called with a fresh style object every time a control moves. */
export type ValListener = (val: StyleVal) => void

/** One element, built and filled without ever going through `innerHTML`. */
function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag)

  node.className = className

  if (text !== undefined) {
    node.textContent = text
  }

  return node
}

/** A copy the caller owns, so a later slider drag cannot rewrite a value already handed out. */
function snapshot(val: StyleVal): StyleVal {
  const copy: StyleVal = {
    naming: val.naming,
    prefer: [...val.prefer],
    weights: { ...val.weights },
  }

  // Written only when there is one, so a style nobody chose a preset for
  // serializes as the three fields it has always had rather than as one of
  // them spelled `null`.
  if (val.preset !== undefined) {
    copy.preset = val.preset
  }

  return copy
}

/**
 * One stored weight, or `null` when it is not a number in range.
 *
 * A weight outside 0 to 1 is not a slider position, so it is refused rather
 * than clamped: a value that never came from these controls is evidence the
 * whole stored object is something else.
 */
function readWeight(source: Record<string, unknown>, key: string): number | null {
  const value = source[key]

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return null
  }

  return value
}

/**
 * Validate a parsed store entry into a `StyleVal`, or refuse it.
 *
 * Every field is checked against the same unions the types declare, so a tag
 * written by a future version — or by hand in devtools — cannot ride into the
 * payload as something the model is told the visitor asked for. A repeated
 * prefer tag is refused for the same reason: these controls never emit one.
 */
function parseVal(raw: unknown): StyleVal | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }

  const fields = raw as Record<string, unknown>
  const naming = NAMING_STYLES.find((style) => style === fields.naming)

  if (naming === undefined || !Array.isArray(fields.prefer)) {
    return null
  }

  const prefer: PreferTag[] = []

  for (const entry of fields.prefer) {
    const tag = PREFER_TAGS.find((known) => known === entry)

    if (tag === undefined || prefer.includes(tag)) {
      return null
    }

    prefer.push(tag)
  }

  const stored = fields.weights

  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return null
  }

  const source = stored as Record<string, unknown>
  const weights = DEFAULT_VAL().weights

  for (const { key } of WEIGHTS) {
    const value = readWeight(source, key)

    if (value === null) {
      return null
    }

    weights[key] = value
  }

  if (fields.preset === undefined) {
    return { naming, prefer, weights }
  }

  const preset = readPresetId(fields.preset)

  // A preset id is the one stored field that turns into a line of the prompt,
  // so an unknown one is refused with the entry around it rather than quietly
  // dropped: a style carrying a name this build cannot honour is a style from
  // somewhere else, and running it as though the name were absent would spend
  // a run on something nobody asked for.
  return preset === null ? null : { naming, prefer, weights, preset }
}

/**
 * The style the visitor last chose, or the default when there is not one.
 *
 * Reading `localStorage` at all can throw where storage is blocked, so the
 * access and the parse are both guarded and every failure lands on the same
 * fresh default. A corrupt preference must never brick the page.
 */
export function loadVal(): StyleVal {
  let stored: string | null = null

  try {
    stored = globalThis.localStorage.getItem(STORAGE_KEY)
  } catch {
    return DEFAULT_VAL()
  }

  if (stored === null) {
    return DEFAULT_VAL()
  }

  try {
    return parseVal(JSON.parse(stored)) ?? DEFAULT_VAL()
  } catch {
    return DEFAULT_VAL()
  }
}

/**
 * Remember the style for the next visit, or carry on without remembering it.
 *
 * Private browsing and a full quota both throw here, and neither is worth
 * interrupting a run over: the controls keep working for this session and the
 * next reload simply starts from the default.
 */
export function saveVal(val: StyleVal): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
  } catch {
    /* an unwritable store costs the reload, not the session */
  }
}

/**
 * One mounted control, and the way to make it show a style it did not set.
 *
 * Every control here edits the same live style object, so a preset arriving
 * from the dropdown has to be repainted onto each of them; `refresh` is that,
 * and it never emits, because the change it is showing has already been
 * reported by whoever caused it.
 */
interface Control {
  node: HTMLElement
  refresh: () => void
}

/** One chip, pressed or not, labelled with the value it stands for. */
function buildChip(doc: Document, value: string, pressed: boolean): HTMLButtonElement {
  const chip = element(doc, 'button', 'chip', value)

  chip.type = 'button'
  chip.dataset.value = value
  chip.setAttribute('aria-pressed', String(pressed))

  return chip
}

/** The labelled row a chip group or a slider sits in. */
function buildGroup(doc: Document, label: string): HTMLElement {
  const group = element(doc, 'div', 'val-group')

  group.append(element(doc, 'span', 'val-label', label))

  return group
}

/** The casing row: choosing one chip releases whichever was pressed before. */
function buildNamingGroup(doc: Document, val: StyleVal, edited: () => void): Control {
  const group = buildGroup(doc, 'Naming')
  const chips = element(doc, 'div', 'chips')

  chips.dataset.group = 'naming'
  chips.setAttribute('role', 'group')
  chips.setAttribute('aria-label', 'Naming style')

  const buttons = NAMING_STYLES.map((style) => ({
    style,
    chip: buildChip(doc, style, style === val.naming),
  }))

  const refresh = (): void => {
    for (const { style, chip } of buttons) {
      chip.setAttribute('aria-pressed', String(style === val.naming))
    }
  }

  for (const { style, chip } of buttons) {
    chip.addEventListener('click', () => {
      val.naming = style

      refresh()
      edited()
    })
  }

  chips.append(...buttons.map((button) => button.chip))
  group.append(chips)

  return { node: group, refresh }
}

/** The taste row: every chip toggles on its own, and none pressed is a valid answer. */
function buildPreferGroup(doc: Document, val: StyleVal, edited: () => void): Control {
  const group = buildGroup(doc, 'Prefer')
  const chips = element(doc, 'div', 'chips')

  chips.dataset.group = 'prefer'
  chips.setAttribute('role', 'group')
  chips.setAttribute('aria-label', 'Naming preferences')

  const buttons = PREFER_TAGS.map((tag) => ({ tag, chip: buildChip(doc, tag, val.prefer.includes(tag)) }))

  const refresh = (): void => {
    for (const { tag, chip } of buttons) {
      chip.setAttribute('aria-pressed', String(val.prefer.includes(tag)))
    }
  }

  for (const { tag, chip } of buttons) {
    chip.addEventListener('click', () => {
      const at = val.prefer.indexOf(tag)

      if (at === -1) {
        val.prefer.push(tag)
      } else {
        val.prefer.splice(at, 1)
      }

      chip.setAttribute('aria-pressed', String(at === -1))
      edited()
    })

    chips.append(chip)
  }

  group.append(chips)

  return { node: group, refresh }
}

/** One slider and its readout, so the number in the payload is also on the page. */
function buildWeight(
  doc: Document,
  val: StyleVal,
  key: keyof StyleVal['weights'],
  label: string,
  edited: () => void,
): Control {
  const field = element(doc, 'label', 'val-weight')
  const slider = element(doc, 'input', 'val-slider')

  slider.type = 'range'
  slider.min = '0'
  slider.max = '1'
  slider.step = String(WEIGHT_STEP)
  slider.value = String(val.weights[key])
  slider.dataset.weight = key

  const readout = element(doc, 'span', 'val-weight-value', val.weights[key].toFixed(1))

  const refresh = (): void => {
    slider.value = String(val.weights[key])
    readout.textContent = val.weights[key].toFixed(1)
  }

  slider.addEventListener('input', () => {
    const value = Number(slider.value)

    // A range input hands back a string, and the payload is typed: anything
    // that is not a number is dropped rather than serialized as one.
    if (!Number.isFinite(value)) {
      return
    }

    val.weights[key] = value
    readout.textContent = value.toFixed(1)
    edited()
  })

  field.append(element(doc, 'span', 'val-weight-name', label), slider, readout)

  return { node: field, refresh }
}

/** One option of the dropdown, carrying the id the style is written from. */
function buildOption(doc: Document, value: string, label: string): HTMLOptionElement {
  const option = element(doc, 'option', 'val-option', label)

  option.value = value

  return option
}

/** Write one style over another in place, since every mounted control reads that object. */
function applyPreset(val: StyleVal, next: StyleVal): void {
  val.naming = next.naming
  val.prefer = [...next.prefer]
  val.weights = { ...next.weights }

  if (next.preset === undefined) {
    delete val.preset
  } else {
    val.preset = next.preset
  }
}

/**
 * The preset row: one dropdown that fills every control below it.
 *
 * `Custom` is a readout rather than a style — there is no such thing to apply,
 * only styles that are not any of the named ones — so choosing it puts the
 * dropdown straight back onto whatever the controls currently add up to
 * instead of moving anything.
 *
 * The controls it repaints arrive as a list that is still empty here, because
 * each of them is built with the callback that flips this dropdown to Custom
 * and the two would otherwise have to exist before each other. Nothing reads
 * the list until a visitor changes the selection, by which point mounting has
 * long since filled it.
 */
function buildPresetGroup(
  doc: Document,
  val: StyleVal,
  controls: readonly Control[],
  emit: () => void,
): Control {
  const group = buildGroup(doc, 'Preset')
  const select = element(doc, 'select', 'val-select')

  select.dataset.group = 'preset'
  select.setAttribute('aria-label', 'Style preset')

  for (const preset of PRESETS) {
    select.append(buildOption(doc, preset.id, preset.label))
  }

  select.append(buildOption(doc, CUSTOM_VALUE, CUSTOM_LABEL))

  const refresh = (): void => {
    select.value = presetFor(val)
  }

  select.addEventListener('change', () => {
    const chosen = PRESETS.find((preset) => preset.id === select.value)

    if (chosen === undefined) {
      refresh()

      return
    }

    applyPreset(val, chosen.val())

    for (const control of controls) {
      control.refresh()
    }

    emit()
  })

  refresh()
  group.append(select)

  return { node: group, refresh }
}

/**
 * Build the style controls inside `root` and report every change.
 *
 * The mounted state starts as a copy of `initial`, so the caller's object is
 * never edited underneath it, and each change hands out a fresh copy for the
 * same reason. `onChange` fires on every interaction rather than on a commit,
 * because the state viewer beside these controls is meant to track them live.
 * Saving happens on the same edge: there is no separate apply step to forget.
 */
export function mountValControls(root: HTMLElement, initial: StyleVal, onChange: ValListener): void {
  const doc = root.ownerDocument
  const val = snapshot(initial)
  const controls: Control[] = []

  const emit = (): void => {
    const next = snapshot(val)

    saveVal(next)
    onChange(next)
  }

  // A chip or a slider moved by hand leaves the style no longer being the
  // preset it was, and says so on the dropdown. Losing the id also loses
  // whatever line that preset added to the prompt, which is the point: the run
  // has to be the one the controls describe, not the one they used to.
  const edited = (): void => {
    delete val.preset

    preset.refresh()
    emit()
  }

  const preset = buildPresetGroup(doc, val, controls, emit)
  const naming = buildNamingGroup(doc, val, edited)
  const prefer = buildPreferGroup(doc, val, edited)
  const weights = element(doc, 'div', 'val-weights')

  for (const { key, label } of WEIGHTS) {
    const weight = buildWeight(doc, val, key, label, edited)

    controls.push(weight)
    weights.append(weight.node)
  }

  controls.push(naming, prefer)

  // Replaced rather than appended, so mounting twice cannot leave two sets of
  // chips disagreeing about which style is selected.
  root.replaceChildren(preset.node, naming.node, prefer.node, weights)
}
