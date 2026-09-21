# naming-things

Describe something in prose. Get **five** names for one class property. Watch **LLM vs Jev** pick head-to-head.

```text
descriptor ──► five candidates + tiny interface sketch
                 │
                 ├── LLM pick  (one name + one-line why)
                 └── Jev Choice (probs + confidence)
                        ▲
                   optional val (style weights)
```

Every run is a live run. The hosted page goes through a Cloudflare Worker that holds the
secrets; a local page can spend its own keys instead. There are no canned answers behind
either: a call that will not answer says so.

- Live Worker: `https://naming-things.who-cf.workers.dev`
- Live demo: `https://who.github.io/naming-things/`

Pinned models: `claude-haiku-4-5-20251001` · `jev-1.13.0`

---

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:5173/naming-things/](http://localhost:5173/naming-things/) — the `/naming-things/` base path matches GitHub Pages.

```bash
npm run build      # → dist/
npm run preview
npm run typecheck
npm test           # app + Worker suites
```

---

## How one run works

```mermaid
sequenceDiagram
  participant You
  participant Page
  participant API as ApiClient
  participant W as Worker (secrets)
  participant LLM as Anthropic
  participant Jev as TypeSafe System One

  You->>Page: descriptor + optional val
  Page->>API: generateCandidates
  API->>W: POST /api/llm/candidates
  W->>LLM: tool-forced JSON
  LLM-->>W: sketch + candidates
  W-->>API: result
  par LLM judge
    Page->>API: llmPick
    API->>W: POST /api/llm/pick
    W->>LLM: choose one
    LLM-->>Page: pick + why
  and Jev judge
    Page->>API: jevChoice (state + val)
    API->>W: POST /api/jev/choice
    W->>Jev: Choice over 5 options
    Jev-->>Page: pick + probs + confidence
  end
  Page-->>You: head-to-head (agree / disagree)
```

```text
Run
  parse descriptor
  generateCandidates   # sketch + exactly 5 {name, typeHint, why}
  Promise.allSettled
    llmPick
    jevChoice          # buildJevState(descriptor, code, candidates, val?)
  render cards + badges
Re-ask Jev
  reuse candidates on screen
  jevChoice only       # val change can move the pick
```

---

## Layout

```text
naming-things/
├── src/
│   ├── core/          # pipeline, parser, types — no DOM, no network
│   ├── api/           # ApiClient: remote (Worker) | byo
│   └── ui/            # cards, banner, val controls, state JSON
├── worker/            # Cloudflare Worker — only place secrets live
│   ├── src/           # cors, llm, jev, ratelimit, router
│   └── wrangler.toml
└── .github/workflows/pages.yml
```

```text
<Page> (src/main.ts)
  descriptor + Randomize + valControls
  Run / Re-ask Jev
  property cards (5)
  LLM badge  vs  Jev badge
  State sent to Jev (JSON)
```

---

## Modes

```text
resolveMode()
  if localStorage naming-things:keys has both keys → byo
  else if VITE_API_BASE set at build               → remote (Worker)
  else                                              → unconfigured
```

| Mode | Keys | Where calls go |
|------|------|----------------|
| remote | Worker secrets | `VITE_API_BASE` → Worker |
| byo | both keys in `localStorage` | browser → Anthropic + TypeSafe |
| unconfigured | none | nowhere — the page says so and the buttons stay down |

**Public demo = remote only.** Never paste keys into the hosted page.

Worker secrets (already used for the live stub):

```bash
cd worker
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TYPESAFE_API_KEY
```

Health check (no quota cost):

```bash
curl https://naming-things.who-cf.workers.dev/api/health
# {"ok":true,"hasTypeSafe":true,"hasAnthropic":true,...}
```

---

## `val` — style import

`val` rides in Jev **state** as context, not a hard gate in app code.

```text
StyleVal
  naming:   camelCase | snake_case | PascalCase
  prefer:   id-like | domain-nouns | booleans-as-isX   (any subset)
  weights:  shortNames | explicitUnits | nullable       (0..1)
```

```diff
 buildJevState(...)
   descriptor
   code
   candidates
+  val          # from the style controls / localStorage
```

Push `explicitUnits` up, hit **Re-ask Jev**, and watch a short name lose to one that carries its unit.

---

## Deploy

### Pages (static app)

```text
push main
  → Actions: npm ci && npm run build
  → upload dist/
  → https://who.github.io/naming-things/
```

A fork enables its own copy under repo **Settings → Pages → Source → GitHub Actions**.

Optional build env (URL only — never a key):

```text
VITE_API_BASE=https://naming-things.who-cf.workers.dev
```

### Worker

```bash
cd worker
npm install
npx wrangler kv namespace create RATE_LIMIT   # paste id into wrangler.toml
# ALLOWED_ORIGINS already includes who.github.io + localhost:5173
npm run deploy
```

Routes: `POST /api/llm/candidates` · `POST /api/llm/pick` · `POST /api/jev/choice` · `GET /api/health`

Caps (wrangler vars): `IP_DAILY_LIMIT=20` · `GLOBAL_DAILY_LIMIT=300`

---

## Rules this repo does not bend

1. **No secrets in `import.meta.env`** — Vite would bake them into `dist/`.
2. **No committed `.env`.**
3. **No keys in the Pages bundle** — Worker (or local BYO) only.
4. **Jev = Choice only** here — Noul has no confidence; the demo needs probs.

---

## Limitations

One property per run. The two judges can disagree with each other and with you — that disagreement is the point. A rate-limit or provider failure ends the run and says the service is busy; nothing is filled in from a fixture in its place.
