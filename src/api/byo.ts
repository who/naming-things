/**
 * The local-only key store, and the only thing that turns byo mode on.
 *
 * The hosted demo runs through the Worker, which is where a key is allowed to
 * live. This module exists for the other case: someone running the page from
 * their own machine who would rather spend their own quota than a deployment's.
 * Nothing in the UI ever writes this entry — it is put there by hand, by
 * someone who knows they are putting a credential in a browser store — so the
 * public page cannot become a box that invites a stranger to paste a key.
 *
 * Reading is total: an absent entry, unreadable storage, a corrupt document or
 * a half-filled one all come back as "no keys", because every one of those
 * means the same thing to the caller and none of them is worth a broken page.
 */

/** The two credentials a browser needs to run with no Worker in front of it. */
export interface ByoKeys {
  anthropicKey: string
  typesafeKey: string
}

/** Namespaced exactly the way the style preference is, so the two cannot collide. */
const STORAGE_KEY = 'naming-things:keys'

/**
 * The longest a credential may be.
 *
 * Not a validation of the key so much as a guard on what gets pasted into a
 * request header: anything past this is not a key that was copied from a
 * provider console.
 */
const MAX_KEY_LENGTH = 512

/**
 * One key field, or nothing.
 *
 * An empty string is absence, not a key: a half-filled entry left behind by a
 * cleared field would otherwise send an empty credential to a provider and
 * collect a 401 where the deployment's own path was still there to be used.
 */
function readKey(fields: Record<string, unknown>, field: string): string | null {
  const value = fields[field]

  if (typeof value !== 'string') {
    return null
  }

  const key = value.trim()

  return key.length === 0 || key.length > MAX_KEY_LENGTH ? null : key
}

/**
 * The stored pair, or nothing at all.
 *
 * Both keys are required together because a run is a head-to-head: one key
 * would put a live judge beside a silent one and call the two comparable. A
 * deployment can serve half a run, since its two routes fail independently and
 * say which one went quiet; a browser holding one key cannot say anything of
 * the sort, so this store is ignored until it holds both and the page runs
 * through the deployment instead.
 */
export function loadByoKeys(): ByoKeys | null {
  let stored: string | null = null

  try {
    stored = globalThis.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }

  if (stored === null) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(stored)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }

  const fields = parsed as Record<string, unknown>
  const anthropicKey = readKey(fields, 'anthropicKey')
  const typesafeKey = readKey(fields, 'typesafeKey')

  if (anthropicKey === null || typesafeKey === null) {
    return null
  }

  return { anthropicKey, typesafeKey }
}
