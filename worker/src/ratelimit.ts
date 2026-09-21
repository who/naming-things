/**
 * The daily spend cap, counted in Workers KV.
 *
 * This demo is public and the Worker holds the keys, so the only thing standing
 * between a scripted loop and an unbounded bill is a counter. Two of them: one
 * per client address, so a single visitor cannot drain the budget alone, and
 * one across the whole Worker, so a crowd cannot either. Both roll over at UTC
 * midnight, which is why every key carries its own date rather than a window
 * that has to be expired by hand.
 *
 * KV is eventually consistent, and that is an accepted trade here. The goal is
 * bounding sustained spend, not exact fairness: two requests racing can both
 * read the same count and both write, overshooting the cap by a request or two.
 * A strongly consistent store would cost far more than the handful of provider
 * calls that overshoot is worth.
 */

import type { Env } from './cors'

/**
 * Cloudflare sets this header and a caller cannot spoof it.
 *
 * Anything a client could set instead — `X-Forwarded-For`, say — would make the
 * per-address cap a suggestion rather than a limit.
 */
const CLIENT_ADDRESS_HEADER = 'CF-Connecting-IP'

/**
 * The bucket a request with no client address falls into.
 *
 * One shared bucket rather than one per unknown, because a per-request fallback
 * would hand every anonymous caller its own fresh allowance, which is exactly
 * the bypass the cap exists to close.
 */
const UNKNOWN_ADDRESS = 'unknown'

/**
 * How long a counter outlives the day it counts, in seconds.
 *
 * Two days, so a key is comfortably past every timezone's reading of its own
 * date before it disappears, and old counters clean themselves up rather than
 * accumulating one row per address per day forever.
 */
const COUNTER_TTL_SECONDS = 172800

/**
 * The caps applied when the configuration does not name its own.
 *
 * Sized so a front-page burst degrades into sample mode rather than into a
 * bill, and sized for a demo that is linked in public: five thousand runs is
 * far more than one visitor will spend, and a hundred thousand bounds the worst
 * day the Worker can have.
 *
 * They are a floor as well as a fallback. A deployment whose vars are missing
 * or mistyped lands here, so a smaller number written in this file would quietly
 * become the cap the demo runs under.
 */
const DEFAULT_IP_DAILY_LIMIT = 5000
const DEFAULT_GLOBAL_DAILY_LIMIT = 100000

/**
 * What the router learned, and what it owes the caller.
 *
 * The refusals carry their own `error` string so the router spells the status
 * and nothing else: the strings are the client's branch points, and they belong
 * beside the rule that produced them.
 */
export type RateLimitOutcome =
  | { allowed: true }
  | { allowed: false; error: 'quota_exceeded'; retryAfter: number }
  | { allowed: false; error: 'ratelimit_unconfigured' }

/**
 * The UTC date a moment falls on, as `YYYY-MM-DD`.
 *
 * UTC rather than local time because a Worker runs in whichever data centre
 * took the request: a local-time day would roll over at a different instant per
 * colocation and give the same visitor several fresh allowances a day.
 */
export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/**
 * How long until the counters roll over, in seconds.
 *
 * Floored at one second rather than zero, so `Retry-After` is always a delay a
 * client can actually wait out — and never a negative number, which a browser
 * would read as a header it should ignore.
 */
function secondsUntilUtcMidnight(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)

  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000))
}

/**
 * A stored counter as a number, treating anything unreadable as zero.
 *
 * A key that has expired reads as `null`, and a value that somehow is not a
 * count is not worth failing a request over: both mean "nothing counted yet",
 * and starting from zero is the same answer the expiry would have given.
 */
function readCount(stored: string | null): number {
  const count = Number(stored)

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

/**
 * A configured limit, or the default when the variable is missing or nonsense.
 *
 * Limits live in wrangler vars so a cap can be tuned without shipping code, and
 * a var arrives as a string — including the empty string, and including
 * whatever a typo produced. None of those should read as a limit of zero, which
 * would take the live path down entirely.
 */
function readLimit(configured: string | undefined, fallback: number): number {
  const limit = Number(configured)

  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : fallback
}

/**
 * Count one request against both caps, and say whether it may proceed.
 *
 * Called before the upstream request rather than after it, so a provider that
 * errors still costs quota: otherwise a retry storm against a failing provider
 * would be free, and the cap would be loosest exactly when the Worker is having
 * its worst day.
 *
 * A missing binding fails closed. Failing open on a public endpoint that spends
 * money would turn one misconfigured deploy into the outcome this whole module
 * exists to prevent, so an unconfigured Worker serves sample mode instead of
 * serving the budget to whoever asks first. A KV failure is treated the same
 * way and logged, because a counter that cannot be written is a counter that
 * does not exist.
 */
export async function checkAndIncrement(env: Env, request: Request): Promise<RateLimitOutcome> {
  const counters = env.RATE_LIMIT

  if (counters === undefined || counters === null) {
    return { allowed: false, error: 'ratelimit_unconfigured' }
  }

  const now = new Date()
  const day = utcDayKey(now)
  const address = request.headers.get(CLIENT_ADDRESS_HEADER) ?? UNKNOWN_ADDRESS

  // Each key carries the date it counts, so a request that crosses midnight
  // mid-flight writes tomorrow's counter and leaves today's alone rather than
  // corrupting whichever day it started in.
  const addressKey = `ip:${address === '' ? UNKNOWN_ADDRESS : address}:${day}`
  const globalKey = `global:${day}`

  let addressCount: number
  let globalCount: number

  try {
    const [storedAddress, storedGlobal] = await Promise.all([
      counters.get(addressKey),
      counters.get(globalKey),
    ])

    addressCount = readCount(storedAddress)
    globalCount = readCount(storedGlobal)
  } catch (reason: unknown) {
    console.error('rate limit counters could not be read', reason)

    return { allowed: false, error: 'ratelimit_unconfigured' }
  }

  // Compared before the increment, so a limit of twenty admits twenty requests
  // and refuses the twenty-first.
  if (
    addressCount >= readLimit(env.IP_DAILY_LIMIT, DEFAULT_IP_DAILY_LIMIT) ||
    globalCount >= readLimit(env.GLOBAL_DAILY_LIMIT, DEFAULT_GLOBAL_DAILY_LIMIT)
  ) {
    return { allowed: false, error: 'quota_exceeded', retryAfter: secondsUntilUtcMidnight(now) }
  }

  try {
    await Promise.all([
      counters.put(addressKey, String(addressCount + 1), { expirationTtl: COUNTER_TTL_SECONDS }),
      counters.put(globalKey, String(globalCount + 1), { expirationTtl: COUNTER_TTL_SECONDS }),
    ])
  } catch (reason: unknown) {
    console.error('rate limit counters could not be written', reason)

    return { allowed: false, error: 'ratelimit_unconfigured' }
  }

  return { allowed: true }
}
