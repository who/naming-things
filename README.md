# naming-things

Describe a thing in plain prose, get five candidate names for one of its
properties, and watch two judges pick between them side by side.

The hero demo is the class-property picker. You type a description — a courier
delivery job, a thermostat schedule, whatever you are actually modelling — and
a model sketches it as a small TypeScript interface and proposes five names for
one property it cannot decide about. Then the head-to-head: a plain LLM call
picks its favourite and says why in a line, and Jev Choice picks one too and
shows a confidence and a probability for every option. When the two disagree,
the page says so, and the disagreement is the interesting part. The sample run
shipped with the page is a real one: the plain model reaches for `weight` and
Jev reaches for `weightGrams`.

Two model identifiers are pinned so a run is reproducible: `claude-haiku-4-5-20251001`
for the LLM side and `jev-1.13.0` for Jev. Both the Worker and the local
bring-your-own-keys path hold the same two pins, and the Jev side refuses an
envelope reporting any other model rather than quietly comparing two judges.

## Quick start

```bash
npm install
npm run dev
```

Then open http://localhost:5173/naming-things/ — the dev server serves under
that path because the built app is published under it on Pages.

**Sample mode needs no keys.** With nothing configured, every answer comes from
a fixture after a short pause, the banner says so, and the page is fully
usable: the cards render, both picks render, the style controls work, and
Re-ask Jev works. Keys turn the canned answers into live ones; they are not
what makes the page run.

Other scripts that exist:

```bash
npm run build      # production bundle into dist/
npm run preview    # serve that bundle locally
npm run typecheck  # tsc --noEmit
npm test           # vitest, app and Worker suites
```

## Architecture

Three pieces, and only one of them is ever allowed to hold a key.

**The page** is a static Vite app with no framework and no server of its own.
`src/core/` holds the run logic — the pipeline, the candidate parser, the
shared types — and never touches the DOM or the network. `src/ui/` renders and
never calls a model. In between sits `src/api/client.ts`, a three-method
interface: `generateCandidates`, `llmPick`, `jevChoice`. Sample mode, the
Worker-proxied live mode and bring-your-own-keys mode are three implementations
of that interface rather than three branches in the run logic.

**One run is two round trips.** The first returns the interface sketch and the
five candidates together, because candidates for a field the sketch does not
contain would read as nonsense. The two judges then race over that same
material, settled with `Promise.allSettled`: either side can fail without
taking the other down, and a run whose LLM side went quiet still renders Jev's
pick beside an explanation. The state handed to Jev is assembled by
`buildJevState`, which refuses anything over an 8 KB budget before the call
goes out. Re-ask Jev reuses the candidates already on screen and re-runs the
Choice call alone, so a pick that moves when the only thing that changed was
your style is the style import doing something visible.

**The Worker** is a Cloudflare Worker under `worker/`, and it is the only place
a secret lives. It fronts three POST routes — `/api/llm/candidates`,
`/api/llm/pick`, `/api/jev/choice` — plus an unauthenticated `GET /api/health`
that is deliberately not counted against any quota. It answers the CORS
preflight from an origin allowlist, refuses bodies over 16 KB, and counts every
provider-bound request against a per-IP and a global daily cap held in KV.
Every refusal is JSON with a stable `error` key.

A live call that fails is classified rather than surfaced raw: `quota exceeded`,
`service unavailable`, `provider error` or `network error`. The first
classified failure latches the whole run over to the canned answers and names
the reason in the banner, because a Worker that is out of quota is out of
quota for all three calls and three round trips to learn that once is a waste.
Upstream error text stays in the console — it can carry a URL, a header or a
key fragment — and the page shows the short reason instead.

## Deploying

### The page

`.github/workflows/pages.yml` publishes on every push to `main`: `npm ci`, then
`npm run build`, then upload `dist/` and deploy to GitHub Pages. Enable Pages
for the repository with **Build and deployment → Source → GitHub Actions** and
the next push publishes.

A build with no configuration produces a sample-mode page, which is a complete
demo and the right default for a fork. To point the published page at a Worker,
give the build step `VITE_API_BASE` — the Worker's origin, and nothing else.
It is a URL, not a credential, which is the only reason it may be inlined into
the bundle at all.

### The Worker

```bash
cd worker
npm install
npx wrangler kv namespace create RATE_LIMIT
```

Paste the id that prints over the placeholder in `worker/wrangler.toml`, set
`ALLOWED_ORIGINS` to the origins that may spend this Worker's budget — the
Pages URL and `http://localhost:5173` — and tune `IP_DAILY_LIMIT` and
`GLOBAL_DAILY_LIMIT` if the defaults of 20 and 300 runs a day do not suit.
Widening the allowlist to a wildcard hands your provider budget to any site on
the web.

Then the secrets and the deploy:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TYPESAFE_API_KEY
npm run deploy
```

`wrangler secret put` prompts for the value and stores it in the Worker's
environment. A Worker missing either secret does not break: the affected route
answers with an `_unconfigured` error, the page reads that as "live path off
rather than broken", and the run falls back to sample mode with
`service unavailable` on the banner.

Confirm it is up with `curl https://your-worker.workers.dev/api/health`.

## Keys

**Worker secrets are the only supported way to serve this page publicly.**
`wrangler secret put ANTHROPIC_API_KEY` and `wrangler secret put TYPESAFE_API_KEY`
put the credentials in the Worker's environment, where the browser never sees
them, and the Worker's origin allowlist and daily caps bound what they can
spend.

For local work there is a second path. If `localStorage` holds a
`naming-things:keys` entry with both keys, the page skips the Worker and calls
the providers directly with your own credentials:

```js
localStorage.setItem('naming-things:keys', JSON.stringify({
  anthropicKey: 'sk-ant-...',
  typesafeKey: '...',
}))
```

Nothing in the UI writes that entry — there is no box inviting anyone to paste
a key — and both keys are required together, because one live judge beside one
canned judge is not a head-to-head. **Never do this on the hosted page.** A key
in a browser store on a public site is a key you have handed to that site, and
the direct Anthropic call sends `anthropic-dangerous-direct-browser-access`,
a header that exists precisely because a key in a page is normally a mistake.

Mode precedence is decided once at startup by `resolveMode`: stored keys win,
a build-time `VITE_API_BASE` comes next, and sample is what is left. The banner
always names which of the three you are in.

Three rules this repository does not bend:

1. **No secret goes through `import.meta.env`.** Vite inlines build-time
   environment into `dist/`, so a key read that way ships to every visitor as
   source and no care further down takes it back out. `VITE_API_BASE` is a URL
   and is the only build-time variable here.
2. **No `.env` is committed.** `.gitignore` covers `.env` and `.env.*`, and the
   app has no `.env` to begin with.
3. **No key is hardcoded in the Pages app.** The published bundle is static and
   world-readable; anything in it is public.

## val — the imported style

The style controls beside the run button are the `val` payload, and their whole
point is that Jev sees them. `StyleVal` in `src/core/types.ts` has three parts:

- `naming` — exactly one of `camelCase`, `snake_case`, `PascalCase`.
- `prefer` — any number of `id-like`, `domain-nouns`, `booleans-as-isX`,
  including none.
- `weights` — `shortNames`, `explicitUnits` and `nullable`, each a number from
  0 to 1 in tenths.

The style is remembered under the `naming-things:val` key in `localStorage`,
and a corrupt or unreadable entry falls back to the default rather than
breaking the page. It is carried to the judge as context, never enforced as a
gate: nothing rejects a candidate for disagreeing with your casing.

Open **State sent to Jev** on the page to watch the payload change as you move
a control. One worked example, with the sample run's material:

```json
{
  "descriptor": "A courier delivery job. Dispatch hands the driver a pickup address, a drop-off address, a window to arrive in, and the weight of the parcel.",
  "code": "interface DeliveryJob {\n  pickupAddress: string\n  dropOffAddress: string\n  arriveBy: Date\n  collectedAt: Date | null\n  // the parcel, weighed in grams — what should this be called?\n}",
  "candidates": [
    { "name": "weight", "typeHint": "number", "why": "The plain noun, and the first thing most people reach for." },
    { "name": "weightGrams", "typeHint": "number", "why": "Carries the unit in the key, so no caller has to guess kilograms." },
    { "name": "parcelWeightGrams", "typeHint": "number", "why": "Says both what is weighed and in what unit, at the cost of length." },
    { "name": "massGrams", "typeHint": "number", "why": "Physically correct, though couriers and their paperwork all say weight." },
    { "name": "weightInGrams", "typeHint": "number", "why": "Reads like prose, but the preposition earns nothing inside a key." }
  ],
  "val": {
    "naming": "camelCase",
    "prefer": ["domain-nouns"],
    "weights": { "shortNames": 0.5, "explicitUnits": 0.5, "nullable": 0.5 }
  }
}
```

Push `explicitUnits` up and re-ask, and `weightGrams` is the name that gains.

## Limitations

Jev is asked a Choice question and nothing else. Noul carries no confidence,
and a judge that cannot say how sure it is has nothing to put in the badge or
the probability bars beside the plain model's one-line reason — so the demo
uses Choice only, and the comparison stays honest about what each side
reported.

The rest of the edges are deliberate rather than unfinished: one property per
run, exactly five candidates, a descriptor capped at 1200 characters, a Jev
state capped at 8 KB, and a confidence the envelope omitted rendered as absent
rather than as zero. A missing confidence is the judge saying nothing; zero is
the judge saying it has no faith in its own pick, and the page draws them
differently.
