/**
 * The Worker that fronts every live call, and the only place a key may live.
 *
 * This module is the router and the gate: it answers the CORS preflight,
 * dispatches the four routes, and refuses anything oversized, unrouted or sent
 * with the wrong method before a handler runs. The two LLM routes reach a
 * provider through `./llm` and the Jev route reaches System One through
 * `./jev`; the rate-limit issue wraps all three in place now that they are
 * real.
 *
 * Every refusal is JSON with an `error` key, so the client branches on a stable
 * string instead of parsing status text that varies by runtime.
 */

import { corsHeaders, type Env } from './cors'
import { jevChoice } from './jev'
import { generateCandidates, pickBest } from './llm'

/**
 * The body budget, in bytes.
 *
 * A descriptor, a code block and five candidates fit inside this with room to
 * spare, so anything past it is not a run this Worker was built to serve. The
 * cap bounds parsing cost here and provider spend later, which is why the
 * router enforces it rather than each handler.
 */
const MAX_BODY_BYTES = 16384

/** The unauthenticated liveness route, so a probe never has to POST. */
const HEALTH_ROUTE = '/api/health'

/** What a provider handler is handed once the router has vetted the request. */
type RouteHandler = (body: Record<string, unknown>, env: Env) => Promise<Response> | Response

/** Either a parsed object body, or the refusal to send back instead. */
type BodyOutcome =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string }

/** A JSON response, so the content type is spelled in one place. */
function json(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

/** The same, for the failure case, so the `error` key is spelled in one place. */
function errorJson(error: string, status: number, headers: Record<string, string> = {}): Response {
  return json({ error }, status, headers)
}

/**
 * Put this request's CORS grant on a response that was built without one.
 *
 * Handlers should not have to think about the allowlist, and every refusal
 * needs these headers too: a 413 the browser cannot read because it lost its
 * CORS grant is an opaque network error in the console rather than a message
 * the visitor can act on.
 */
function withCors(response: Response, headers: Record<string, string>): Response {
  const merged = new Headers(response.headers)

  for (const [name, value] of Object.entries(headers)) {
    merged.set(name, value)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  })
}

/**
 * One slot per operation, which is what kept the later issues independent: the
 * LLM work took two of these slots without touching the third, and the Jev work
 * took that one with no shared handler to untangle first. Every handler here
 * answers a request the router has already vetted, and each one refuses on its
 * own terms — a deployment holding only one of the two keys still serves the
 * half of the head-to-head it is configured for.
 */
const POST_ROUTES: Record<string, RouteHandler> = {
  '/api/llm/candidates': generateCandidates,
  '/api/llm/pick': pickBest,
  '/api/jev/choice': jevChoice,
}

/**
 * Read the body, or give up the moment it goes over budget.
 *
 * `Content-Length` is checked first because it lets an oversized request be
 * refused without reading a byte of it, and checked again as the stream arrives
 * because that header comes from the caller: it is absent on a chunked body,
 * and it can simply be a lie. Cancelling mid-read is what stops a sender from
 * streaming megabytes at a Worker that has already said no.
 */
async function readBody(request: Request): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('Content-Length') ?? '0')

  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return null
  }

  if (request.body === null) {
    return new Uint8Array(0)
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    if (value === undefined) {
      continue
    }

    total += value.byteLength

    if (total > MAX_BODY_BYTES) {
      await reader.cancel()

      return null
    }

    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return merged
}

/**
 * The body as a JSON object, or the reason it is not one.
 *
 * A handler is only ever handed an object, because every route here takes named
 * fields: a bare string, a number or an array is a client that has misread the
 * contract, and saying so with a 400 beats letting a handler trip over a
 * missing property one provider call later.
 */
async function readJsonBody(request: Request): Promise<BodyOutcome> {
  const raw = await readBody(request)

  if (raw === null) {
    return { ok: false, status: 413, error: 'payload_too_large' }
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return { ok: false, status: 400, error: 'invalid_json' }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: 'invalid_body' }
  }

  return { ok: true, body: parsed as Record<string, unknown> }
}

/**
 * Route one request, having first worked out what CORS it is owed.
 *
 * The preflight is answered before anything looks at the path, because a
 * browser asks about a route it has not called yet and an unknown path must not
 * turn that question into a 404 the client reads as a dead endpoint. A
 * disallowed origin still gets its 204 — with no CORS headers on it, which is
 * precisely the answer that makes the browser refuse the real request.
 */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request, env)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }

  const { pathname } = new URL(request.url)

  if (pathname === HEALTH_ROUTE) {
    if (request.method !== 'GET') {
      return errorJson('method_not_allowed', 405, { ...headers, Allow: 'GET, OPTIONS' })
    }

    return json({ status: 'ok' }, 200, headers)
  }

  const handler = POST_ROUTES[pathname]

  if (handler === undefined) {
    return errorJson('not_found', 404, headers)
  }

  if (request.method !== 'POST') {
    return errorJson('method_not_allowed', 405, { ...headers, Allow: 'POST, OPTIONS' })
  }

  const outcome = await readJsonBody(request)

  if (!outcome.ok) {
    return errorJson(outcome.error, outcome.status, headers)
  }

  return withCors(await handler(outcome.body, env), headers)
}

/**
 * The module Worker entry point.
 *
 * Module syntax rather than a service worker, because typed `env` bindings are
 * how the allowlist — and, later, the secrets — reach this code at all. `ctx`
 * is part of the runtime's signature and goes unused until the rate limiter has
 * background work to hand it.
 */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env)
  },
}
