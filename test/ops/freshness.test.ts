import { afterEach, describe, expect, it, vi } from 'vitest'

import { findNewBuild, readBuildId } from '../../src/ops/freshness'

/** The shape a deploy stamps: a run and the attempt that shipped it. */
const STAMPED = '17-1'

/** Stamp the document under test, the way the build plugin stamps a real one. */
function stamp(build: string): void {
  const meta = document.createElement('meta')

  meta.setAttribute('name', 'build-id')
  meta.setAttribute('content', build)
  document.head.append(meta)
}

/** Stand a `version.json` up in front of the check, with the body it answers. */
function serve(body: unknown, ok = true): ReturnType<typeof vi.fn> {
  const fetched = vi.fn(() =>
    Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response),
  )

  vi.stubGlobal('fetch', fetched)

  return fetched
}

afterEach(() => {
  for (const meta of document.querySelectorAll('meta[name="build-id"]')) {
    meta.remove()
  }

  vi.unstubAllGlobals()
})

describe('readBuildId', () => {
  it('reads the stamp the build left', () => {
    stamp(STAMPED)

    expect(readBuildId(document)).toBe(STAMPED)
  })

  /**
   * A dev server's document and anything built before the stamp existed both
   * land here, and neither is evidence of staleness.
   */
  it('has nothing to say about an unstamped document', () => {
    expect(readBuildId(document)).toBeNull()
  })

  it('treats a blank stamp as no stamp', () => {
    stamp('   ')

    expect(readBuildId(document)).toBeNull()
  })
})

describe('findNewBuild', () => {
  it('reports the deployed id when the document is not it', async () => {
    stamp(STAMPED)
    serve({ build: '18-1' })

    await expect(findNewBuild(document)).resolves.toBe('18-1')
  })

  it('stays quiet when the document is the deployed build', async () => {
    stamp(STAMPED)
    serve({ build: STAMPED })

    await expect(findNewBuild(document)).resolves.toBeNull()
  })

  /**
   * The ask is the thing that must not be cached. `no-store` keeps the
   * browser's copy out of the answer and the query keeps the CDN's out, which
   * is what stops the deployment from agreeing with the document simply
   * because both came from the same ten-minute cache.
   */
  it('asks past both caches', async () => {
    stamp(STAMPED)

    const fetched = serve({ build: STAMPED })

    await findNewBuild(document)

    const [url, options] = fetched.mock.calls[0] as [string, RequestInit]

    expect(url).toContain('version.json?asked=')
    expect(options.cache).toBe('no-store')
  })

  it('does not ask at all when the document carries no stamp', async () => {
    const fetched = serve({ build: '18-1' })

    await expect(findNewBuild(document)).resolves.toBeNull()
    expect(fetched).not.toHaveBeenCalled()
  })

  /**
   * Offline, mid-deploy, or behind something that answers with a login page:
   * none of those knows which build is current, and a page that reloaded on
   * them would reload for no reason at all.
   */
  it('stays quiet when the deployment cannot be reached', async () => {
    stamp(STAMPED)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    )

    await expect(findNewBuild(document)).resolves.toBeNull()
  })

  it('stays quiet when version.json is missing', async () => {
    stamp(STAMPED)
    serve({ build: '18-1' }, false)

    await expect(findNewBuild(document)).resolves.toBeNull()
  })

  it.each([[{}], [{ build: '' }], [{ build: 7 }], [null], [['18-1']]])(
    'stays quiet on a body that carries no id: %j',
    async (body) => {
      stamp(STAMPED)
      serve(body)

      await expect(findNewBuild(document)).resolves.toBeNull()
    },
  )
})
