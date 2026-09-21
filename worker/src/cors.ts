/**
 * Which browser origins this Worker answers, and the headers that say so.
 *
 * The Worker holds the provider keys, so the allowlist is the only thing
 * standing between a stranger's page and this account's API spend. It is read
 * from a plain wrangler variable rather than compiled in, so an origin can be
 * added by editing config instead of shipping code — and an origin that is not
 * on the list is answered with no CORS headers at all, never a wildcard.
 */

/** The bindings this Worker reads. Plain variables only: a secret never lands here. */
export interface Env {
  ALLOWED_ORIGINS: string
}

/** A day: long enough to spare a visitor repeat preflights, short enough that an allowlist edit lands. */
const PREFLIGHT_MAX_AGE_SECONDS = 86400

/** Every method the router answers. OPTIONS is here because the preflight asks about itself. */
const ALLOWED_METHODS = 'GET, POST, OPTIONS'

/** The one header the browser client sends beyond the CORS-safelisted set. */
const ALLOWED_HEADERS = 'Content-Type'

/**
 * Is this origin one the allowlist names?
 *
 * The comparison is exact after trimming, so `https://who.github.io.evil.test`
 * is not a match the way a prefix or substring test would make it. A missing or
 * malformed binding denies everything rather than throwing: a Worker deployed
 * without its variable should turn the live path off, not fall over on it.
 */
export function isAllowedOrigin(origin: string, env: Env): boolean {
  if (origin === '' || typeof env.ALLOWED_ORIGINS !== 'string') {
    return false
  }

  return env.ALLOWED_ORIGINS.split(',').some((allowed) => allowed.trim() === origin)
}

/**
 * The CORS headers this request has earned, which for most requests is none.
 *
 * An empty object is the deliberate answer in two cases: a request with no
 * `Origin` header at all, such as a health probe from curl, and a request from
 * an origin outside the allowlist. Neither gets an echo of anything it sent.
 * `Vary` rides along whenever the headers do, because the response body is the
 * same for every origin but these headers are not, and a shared cache that
 * missed that would serve one origin's grant to another.
 */
export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin')

  if (origin === null || !isAllowedOrigin(origin, env)) {
    return {}
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': String(PREFLIGHT_MAX_AGE_SECONDS),
    Vary: 'Origin',
  }
}
