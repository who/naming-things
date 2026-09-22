/**
 * The check that gets a visitor off a build the deployment has replaced.
 *
 * GitHub Pages serves this document through a CDN that holds it for minutes and
 * offers nothing to say otherwise: Pages has no header configuration, and a
 * `_headers` file is read by other hosts and not by this one. So a deploy lands,
 * the site is new, and a visitor who opens the page inside that window is handed
 * the previous one — old markup, and the old hashed bundle it names — with a
 * hard refresh no help, because the refresh asks the same cache.
 *
 * What a build does control is what it puts inside the document. Every build
 * stamps its own id into the HTML and writes that id to `version.json` beside
 * it, so the page can read what it is and ask the deployment what is current.
 * When the two disagree the page reloads past the cache, carrying the new id in
 * the URL: a query the shared cache has never seen cannot be answered with the
 * stale copy that raised the question.
 *
 * Every step here is total. An unstamped document, an unreachable or unparsable
 * `version.json`, a storage that refuses to be read: each of them means only
 * "nothing to say about freshness", and none is worth a failure on a page that
 * is otherwise working perfectly well.
 */

/** Written beside the document by the build, and read back with a fresh query. */
const VERSION_FILE = 'version.json'

/** The stamp the build injects, spelled the same way in `vite.config.ts`. */
const BUILD_META = 'meta[name="build-id"]'

/** Carried on the reload so the cache that served the old document cannot serve it twice. */
const BUILD_PARAM = 'build'

/** Namespaced the way the style and the keys are, so the three cannot collide. */
const RELOADED_KEY = 'naming-things:reloaded-onto'

/**
 * The id this document was built with, or nothing when it carries no stamp.
 *
 * A document with no stamp is a document this module cannot reason about — a
 * dev server's first render, or a build from before the stamp existed — and the
 * honest answer for it is silence rather than a guess that something is stale.
 */
export function readBuildId(doc: Document): string | null {
  const stamped = doc.querySelector(BUILD_META)?.getAttribute('content')?.trim() ?? ''

  return stamped.length === 0 ? null : stamped
}

/**
 * The id the deployment is serving now, or nothing when it cannot be read.
 *
 * `no-store` keeps the browser's own cache out of the answer, and the timestamp
 * keeps the CDN's out of it: a shared cache keys on the whole URL, so a query
 * nobody has asked before has to be answered from the origin. Without it this
 * request would be served by the same ten-minute cache that is holding the
 * document, and would agree with the document every time.
 */
async function readDeployedId(doc: Document): Promise<string | null> {
  let url: URL

  try {
    url = new URL(VERSION_FILE, doc.baseURI)
  } catch {
    return null
  }

  url.searchParams.set('asked', String(Date.now()))

  let payload: unknown

  try {
    const response = await fetch(url.href, { cache: 'no-store' })

    if (!response.ok) {
      return null
    }

    payload = await response.json()
  } catch {
    return null
  }

  if (typeof payload !== 'object' || payload === null) {
    return null
  }

  const build = (payload as Record<string, unknown>).build

  return typeof build === 'string' && build.trim().length > 0 ? build.trim() : null
}

/**
 * The deployed id when this document is not it, and null every other time.
 *
 * Separated from the reload so the decision can be tested without navigating:
 * what is worth getting right is which pairs of ids count as stale, and that is
 * all this answers.
 */
export async function findNewBuild(doc: Document = document): Promise<string | null> {
  const stamped = readBuildId(doc)

  if (stamped === null) {
    return null
  }

  const deployed = await readDeployedId(doc)

  return deployed === null || deployed === stamped ? null : deployed
}

/**
 * Reload onto the named build, at most once for that build.
 *
 * The guard is what keeps a wedged cache from becoming a reload loop: if the
 * document that comes back still says it is the old build, this session has
 * already spent its one attempt on that id and stops. A visitor staring at a
 * page that reloads forever is worse off than one looking at a ten-minute-old
 * legend, so the failure mode is deliberately quiet.
 *
 * `replace` rather than an assignment, so the stale document does not become an
 * entry in the visitor's history that Back returns them to.
 */
function reloadOnto(view: Window, build: string): void {
  let attempted: string | null = null

  try {
    attempted = view.sessionStorage.getItem(RELOADED_KEY)
  } catch {
    // An unreadable store cannot promise this is the first attempt, and a
    // reload loop is the one outcome worth refusing outright.
    return
  }

  if (attempted === build) {
    return
  }

  try {
    view.sessionStorage.setItem(RELOADED_KEY, build)
  } catch {
    return
  }

  let url: URL

  try {
    url = new URL(view.location.href)
  } catch {
    return
  }

  url.searchParams.set(BUILD_PARAM, build)
  view.location.replace(url.href)
}

/**
 * Watch for a newer build, now and whenever the tab is looked at again.
 *
 * The second half is the case the first cannot cover: a tab left open across a
 * deploy is exactly the visitor who keeps the old UI longest, and the moment
 * they come back to it is the moment a reload costs them nothing. There is no
 * timer beyond that — a page nobody is looking at has no stale UI to fix, and a
 * demo is not worth a heartbeat.
 */
export function watchForNewBuild(doc: Document = document): void {
  const view = doc.defaultView

  if (view === null) {
    return
  }

  const check = (): void => {
    void findNewBuild(doc).then((build) => {
      if (build !== null) {
        reloadOnto(view, build)
      }
    })
  }

  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') {
      check()
    }
  })

  check()
}
