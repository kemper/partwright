# Engine sandbox — running model code on a separate origin

Status: **opt-in, default off** (kemper/partwright#1090, "option 2").

## The problem

Model code — typed by the user, written by an AI, or arriving inside an
imported session / share link / catalog fork — is evaluated with
`new Function('api', code)` inside the geometry Worker
(`src/geometry/engineWorker.ts`, and the Assembly/export pool in
`src/geometry/enginePool.ts`). That Worker is on the **app origin**, so the code
can `indexedDB.open('partwright')` and read every store — including `aiKeys`
(the user's provider API keys) — and `fetch` any `https:` host the app CSP
allows. Verified with the sandbox off: model code lists all 13 app stores,
opens `aiKeys`, and fetches a cross-origin URL with status 200.

The engine sandbox moves the Worker into a hidden iframe on a **different
origin**, which has no path to the app's storage, and fences its network with
that frame's own CSP.

## Modes

| Mode | Frame | Model code sees | Needs |
|---|---|---|---|
| `off` (default) | none — Worker created by the app | app origin: IndexedDB, `fetch` per app CSP | nothing |
| `opaque` | `<iframe sandbox="allow-scripts" allow="cross-origin-isolated" src="/sandbox">` — same URL, **opaque origin** | IndexedDB refused (`SecurityError`), no localStorage, `connect-src 'self'` | CORS (`Access-Control-Allow-Origin: *`) on `/assets/*` and `/openscad-libs/*` (shipped in `public/_headers`) |
| `origin` | `<iframe sandbox="allow-scripts allow-same-origin" allow="cross-origin-isolated" src="$VITE_SANDBOX_ORIGIN/sandbox">` | the sandbox origin's own (empty, partitioned) IndexedDB, no localStorage, `connect-src 'self'` (the sandbox origin) | a second hostname serving the same build + `VITE_SANDBOX_ORIGIN` at build time + `frame-src` in the app CSP |

Both sandbox modes were verified `crossOriginIsolated === true` in the frame
**and** in its Worker (Chromium 141), so SharedArrayBuffer / the WASM engines
work unchanged.

## Enabling it

- **Per browser:** Settings (⚙) → *Security — engine sandbox* → pick a mode,
  reload. Or from the console: `partwright.setEngineSandboxMode('opaque')`,
  reload; `partwright.getEngineSandboxStatus()` reports what's in effect.
  The value lives in `localStorage['partwright-engine-sandbox']` (AppConfig
  only stores numbers/booleans). It is intentionally **not** an in-app AI tool
  — a prompt-injected session must not be able to switch it off.
- **Per deployment:** build with `VITE_ENGINE_SANDBOX=opaque` (or `origin`) to
  change the default for everyone; a per-browser choice still wins.
- **Tunable:** `renderer.engineSandboxBootTimeoutMs` (Settings, default 20 s)
  — how long the frame + Worker may take to report cross-origin isolation
  before falling back.

## Architecture

```
app page (COOP same-origin, COEP require-corp)
 ├─ engine.ts / enginePool.ts ── createEngineWorker(() => new Worker(engineWorker.ts))
 │     off → the real Worker
 │     on  → SandboxedEngineWorker (Worker-shaped façade: postMessage/onmessage/onerror/onmessageerror/terminate)
 │            └─ MessageChannel: port1 kept, port2 sent with {type:'spawn', id}
 └─ hidden <iframe> sandbox.html  (src/sandbox/sandboxMain.ts — frame CSP, COEP, CORP cross-origin)
       └─ classic blob: Worker ── import(sandboxWorker.ts) ── receives port2
             sandboxWorker.ts: self.postMessage → port2.postMessage,
                               port2 messages → dispatched on self,
                               then import(engineWorker.ts)   ← unmodified
```

- **One hop.** After the handshake the app and the Worker talk directly over
  the MessagePort; the frame never relays geometry traffic. Transfer lists are
  preserved (mesh buffers still move rather than being re-serialised by a
  relay), though see the benchmark for what crossing a process costs.
- **engineWorker.ts is untouched.** The shim redirects `self.postMessage` and
  re-dispatches port messages as `message` events, which is what the engine's
  `self.onmessage` listens for.
- **Why a classic blob Worker.** A blob Worker inherits the frame document's
  origin and **CSP** (an http-URL Worker would take its CSP from its own
  response headers, i.e. the app's `/*` policy). Chromium refuses a
  `{type:'module'}` blob Worker from an opaque-origin document, but a classic
  one may `import()` the module shim cross-origin over CORS. Messages that
  arrive before the shim loads are parked on a global queue the shim drains.
  A blob Worker's base URL can't resolve root-relative paths, so the shim
  resolves string `fetch` URLs against its own module URL (BOSL2, fonts, the
  OCCT wasm).
- **Handshake + fallback.** The Worker's first port message reports
  `crossOriginIsolated` / `SharedArrayBuffer`. Until then the façade buffers
  everything the client posts. If the frame or Worker isn't isolated, fails to
  load, or misses the boot timeout, the sandbox is marked broken for the tab:
  the façade spins up a direct Worker, replays the buffer and forwards its
  events (the client never notices), and the user gets one toast + a `warn`
  Diagnostic Log entry (`source: 'engine'`). `getEngineSandboxStatus()` then
  reports `active: 'off'` with the `fallbackReason`.
- **Untrusted messages.** Everything from the frame / Worker is untrusted
  (`src/sandbox/protocol.ts`): frame messages must come from our iframe's
  `contentWindow` with the expected origin (`'null'` for opaque) and match a
  type + shape allow-list; Worker messages must be plain objects with an
  allow-listed engine `type` and a well-formed `callId`. Anything else is
  dropped with a Diagnostic Log warning. Field-level validation of geometry
  results stays engine.ts's job (option 1 hardens that side).
- **Main-thread evaluation.** `exportParamSweep` and `setReferenceGeometry`
  normally run model code synchronously on the main thread
  (`executeCode`). While the sandbox is active they evaluate in the sandboxed
  Worker instead (`setReferenceGeometry` then returns a Promise).
- **Early frame load.** `initEngine()` calls `prewarmEngineSandbox()` so the
  frame document + spawner load in parallel with the main thread's own WASM
  init.

### Frame headers

`sandbox.html` (served at `/sandbox` on Cloudflare) gets, in addition to the
site-wide `/*` headers:

```
Cross-Origin-Resource-Policy: cross-origin
Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval';
  worker-src 'self' blob:; connect-src 'self'; style-src 'unsafe-inline'; img-src 'none';
  font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

On Cloudflare Pages both CSP headers are delivered and the browser enforces
**both** (the intersection), which is what we want; the COEP comes from `/*`.
In `opaque` mode CSP `'self'` still matches the frame's URL origin (the app
host), so the Worker can load the engine's own assets but nothing else. Dev
and `vite preview` mirror these headers (`engineSandboxHeaders()` in
`vite.config.ts`, which replaces the app CSP on the frame document). The dev
server only answers `Origin: null` with CORS when
`PARTWRIGHT_SANDBOX_DEV_CORS=1` (the Playwright config sets it) — Vite
restricts dev-server CORS on purpose, and any site can send `Origin: null`
from a sandboxed iframe. `vite preview` always mirrors the production
`_headers` CORS.

## Deploying `origin` mode

1. **Add a second hostname to the same Cloudflare Pages project**, e.g.
   `sandbox.partwrightstudio.com` (Pages → Custom domains). It serves the
   identical build, so `/sandbox`, `/assets/*` and the wasm are there.
2. **Build with** `VITE_SANDBOX_ORIGIN=https://sandbox.partwrightstudio.com`
   (Pages → Settings → Environment variables, Production). Preview
   deployments without it simply can't select `origin` mode (the option is
   disabled; `setEngineSandboxMode('origin')` returns an error).
3. **Allow framing it from the app**: add
   `frame-src 'self' https://sandbox.partwrightstudio.com` to the `/*`
   `Content-Security-Policy` in `public/_headers` (the dev/preview servers add
   it automatically from `VITE_SANDBOX_ORIGIN`).
4. Optional hardening: scope the sandbox host with absolute-URL rules in
   `_headers` (`https://sandbox.partwrightstudio.com/*`) — e.g. a
   `frame-ancestors https://www.partwrightstudio.com` on `/sandbox`, and a
   redirect of every non-`/sandbox`, non-asset path on that host to the app,
   so the sandbox host isn't a second copy of the app.
5. Optionally set `VITE_ENGINE_SANDBOX=origin` to make it the default.

Same-site note: `sandbox.partwrightstudio.com` is same-*site* as
`www.partwrightstudio.com`. That doesn't matter for storage (origins are
separate) but Chromium may keep both in one renderer process (the benchmark
saw no extra renderer for `origin` mode locally, unlike `opaque`). A
different registrable domain would buy process isolation at the cost of a
cross-site embed (third-party storage partitioning applies; the frame needs no
storage anyway).

## Testing

- `tests/engine-sandbox.spec.ts` — per mode: a value saved through the app's
  `aiKeys` store is unreadable from model code; IndexedDB is refused
  (opaque) or empty/partitioned (origin); `localStorage` is absent; fetches
  to `https://example.com`, a loopback alias of the app host, and (origin
  mode) the app origin all fail **with a `connect-src` CSP violation**; and
  manifold-js, voxel, SCAD, BREP (api.BREP + replicad), reference geometry
  and the Assembly worker pool all work. Plus "off by default".
- `playwright.config.ts` starts a second dev server on `E2E_SANDBOX_PORT`
  (default `E2E_PORT + 1`) as the sandbox origin and passes
  `VITE_SANDBOX_ORIGIN` / `PARTWRIGHT_SANDBOX_DEV_CORS` to both servers (inert
  while the sandbox is off). Origin-mode tests skip if a reused server lacks
  the env.
- `tests/unit/engineSandbox.test.ts` — protocol guards + the setting module.

## Performance

`node scripts/bench-engine-sandbox.mjs [--iterations N] [--runs N]` builds
production (`vite build` with `VITE_SANDBOX_ORIGIN`), serves it with two
`vite preview` servers (app + sandbox origin, COOP/COEP on both) and drives
Playwright Chromium. Each (mode, iteration) uses a fresh persistent profile:
an empty disk cache for the cold start and a real disk HTTP + code cache for
the warm reload. Raw JSON + a Markdown table go to `--out`.

Measured 2026-10-24 on Chromium 141.0.7390.37 (headless, Playwright), 4 CPUs,
loopback servers; 5 iterations per mode (mode order rotated), 6 timed runs per
model after a warmup. Other agents shared the machine, so treat ±5–10 % as
noise. Raw results: `bench-2026-10-24T23-26-54-253Z.json` (not committed).

| Metric (median, min–max over 5 iterations) | off | opaque | origin |
|---|---|---|---|
| Cold start: navigation → engine ready | 1493ms (1422–1631) | 1432ms (1400–1492) | 1455ms (1346–1488) |
| Cold start: worker create → ready | 298ms (281–349) | 286ms (245–292) | 272ms (245–295) |
| Warm reload: navigation → engine ready | 1066ms (942–1328) | 1074ms (1038–1238) | 1078ms (989–1082) |
| Warm reload: worker create → ready | 219ms (156–272) | 210ms (176–229) | 189ms (146–271) |
| Cold load network: .wasm | 2 req / 466.2 KB (200×2, 304×0) | 2 req / 932.2 KB (200×2, 304×0) | 2 req / 932.1 KB (200×2, 304×0) |
| Cold load network: JS | 17 req / 1580.4 KB (200×16, 304×0) | 21 req / 1920.2 KB (200×20, 304×0) | 21 req / 1920.3 KB (200×20, 304×0) |
| Warm reload network: .wasm | 2 req / 0.2 KB (200×2, 304×0) | 2 req / 466.2 KB (200×2, 304×0) | 2 req / 0.2 KB (200×2, 304×0) |
| Warm reload network: JS | 17 req / 2.6 KB (200×14, 304×2) | 21 req / 358.8 KB (200×18, 304×2) | 21 req / 3.4 KB (200×18, 304×2) |
| Run cube (12 tris): engine round trip | 3ms (2.5–4.5) | 3ms (3–3.5) | 4ms (2–6) |
| Run cube: worker compute | 1ms (0–1) | 1ms | 0.5ms (0–1) |
| Run cube: round trip − compute (transfer/msg) | 2ms (2–3.5) | 2.5ms (2–2.5) | 4ms (1–5.5) |
| Run cube: partwright.run wall (incl. render) | 9.5ms (7.5–10.2) | 9.1ms (8.7–9.4) | 9.6ms (7.7–17.2) |
| Run sphere200k (204800 tris): engine round trip | 224.5ms (221–238) | 217.5ms (214–252) | 210ms (207.5–231.5) |
| Run sphere200k: worker compute | 224ms (219.5–237.5) | 209ms (205.5–235) | 209.5ms (205.5–231) |
| Run sphere200k: round trip − compute (transfer/msg) | 1ms (0.5–1) | 7.5ms (7–8.5) | 1ms (0.5–1) |
| Run sphere200k: partwright.run wall (incl. render) | 661.1ms (650.9–691.3) | 649.5ms (634.8–706.5) | 638.9ms (630.1–711.6) |
| Run sphere500k (500000 tris): engine round trip | 552.5ms (542–564) | 571.5ms (554–617.5) | 554.5ms (538–594) |
| Run sphere500k: worker compute | 547ms (538–559.5) | 543.5ms (536–583.5) | 549ms (537–590) |
| Run sphere500k: round trip − compute (transfer/msg) | 2.5ms (1.5–4) | 18ms (16–25) | 4ms (1.5–5) |
| Run sphere500k: partwright.run wall (incl. render) | 1622.2ms (1606.5–1653) | 1620.8ms (1613.4–1718.2) | 1670.3ms (1603.9–1727.4) |
| SCAD first use (cold context) | 371.2ms (358.5–619.5) | 609ms (568.6–639.5) | 581.6ms (534.1–620.7) |
| SCAD first use (after warm reload) | 527.2ms (311.1–663.4) | 556.8ms (509.2–668.2) | 554.4ms (534.8–729.3) |
| BREP first use (cold context) | 337.8ms (283.8–540.5) | 349.7ms (302.2–386.5) | 309.6ms (289.6–334.5) |
| BREP first use (after warm reload) | 363.1ms (334.6–553) | 349.2ms (289.3–382.6) | 363ms (306.4–560.4) |
| Lazy-engine reload network: .wasm | 2 req / 0.2 KB (200×2, 304×0) | 2 req / 10602.4 KB (200×2, 304×0) | 2 req / 0.2 KB (200×2, 304×0) |
| Lazy-engine reload network: JS | 8 req / 1.4 KB (200×8, 304×0) | 8 req / 3680.2 KB (200×8, 304×0) | 8 req / 1.4 KB (200×8, 304×0) |
| measureUserAgentSpecificMemory total | 480 MB (479.9–480.2) | 308.7 MB (308.3–308.9) | 480.2 MB (480.1–480.3) |
| …of which dedicated workers | 171.2 MB (171.1–171.3) | 0 MB | 0 MB |
| Browser process tree PSS | 1107.6 MB (1088.3–1114.8) | 1117.3 MB (1111.5–1131.2) | 1105.4 MB (1087–1126.6) |
| Renderer processes | 2 | 3 | 2 |
| crossOriginIsolated (frame / worker) | n/a (app is COI) | true / true | true / true |
| Active mode / fallbacks | off / 0 | opaque / 0 | origin / 0 |

How to read it:

- **Start-up is a wash.** Cold and warm "navigation → engine ready" are within
  noise across all three modes (~1.45 s cold, ~1.07 s warm). The frame is
  prewarmed in parallel with the main thread's own WASM init, so the extra
  document + spawner never lands on the critical path on loopback.
- **Cache reuse — the real cost of `opaque`.** On a warm reload `off` and
  `origin` revalidate/serve the engine from cache (≈0.2 KB wasm, ≈3 KB JS),
  but `opaque` re-downloads everything its Worker needs: **≈466 KB wasm +
  ≈359 KB JS per page load**, and after a reload the first SCAD/BREP use
  re-downloads **≈10.6 MB wasm + ≈3.7 MB JS** (vs ≈1 KB). An opaque origin gets
  a fresh cache partition per frame instance, so HTTP-cache and V8 wasm
  code-cache reuse are lost every load. On loopback this costs no visible time;
  on a real connection it is ~0.8 MB (and ~14 MB with the lazy engines) per
  page load. `origin` mode pays the double download only once (cold), because
  the sandbox origin has its own (persistent) cache entry.
- **Run round trips are unchanged except for the mesh copy in `opaque`.**
  Worker compute dominates. The post→result overhead beyond compute is
  ≈1–4 ms for `off`/`origin` at any size, but `opaque` adds **≈7 ms at 205k
  triangles and ≈18 ms at 500k** — the sandboxed frame runs in a separate
  renderer process (3 renderers vs 2), so the transferred mesh buffers are
  copied across processes instead of moved. `origin` (same-site) stayed in the
  app's process here, so its transfers stayed zero-copy. End-to-end
  `partwright.run` (incl. render) is within noise in all modes.
- **Lazy engines.** First SCAD use in a cold profile is ≈200 ms slower in
  both sandbox modes (the frame can't reuse the app's cached copy); after a
  warm reload all modes are within noise. BREP is within noise throughout.
- **Memory.** Whole-browser PSS is within noise (≈1.1 GB; `opaque` +≈10 MB for
  its extra renderer process). `measureUserAgentSpecificMemory` does not
  attribute workers inside a cross-origin frame (0 MB rows; and the opaque
  frame is excluded from the total entirely), so use the PSS row.
- **Isolation.** `crossOriginIsolated` was `true` in the frame **and** in its
  Worker in every sandboxed run; no fallbacks occurred.
- **Unmeasured:** Firefox, WebKit, real network latency/bandwidth, low-end
  devices, and Chromium configurations where same-site frames get their own
  process (would add the cross-process copy to `origin` too).

## Known limitations

- **Chromium only measured.** Firefox and WebKit are unmeasured; the
  opaque-origin + COI + blob-Worker combination in particular needs checking
  there (Safari's COI support in sandboxed frames is the main unknown). The
  fallback keeps the app working if a browser refuses.
- **coi-serviceworker fallback.** If the deployment's COOP/COEP headers are
  stripped and the app relies on `coi-serviceworker.js`, the sandbox frame is
  not controlled by that service worker (opaque frames never are), so it isn't
  isolated → the sandbox falls back to off (with the toast).
- **`opaque` mode loses HTTP/code-cache reuse** — see the warm-reload rows:
  an opaque origin gets a fresh cache partition per frame instance, so every
  page load re-downloads the engine JS and wasm the Worker needs (~0.8 MB for
  manifold-js; ~14 MB more the first time OCCT/OpenSCAD is used per load), and V8
  can't reuse compiled wasm from a previous load. `origin` mode keeps both.
- **Same-origin assets stay readable in `opaque` mode.** CSP `'self'` matches
  the app host, so model code can still `fetch` the app's public static files
  (no credentials, no storage). It cannot reach IndexedDB, other origins, or
  the AI provider hosts.
- **Message channel is the remaining boundary.** Model code can post
  arbitrary messages on its port to the app; they're type-allow-listed here,
  and field validation in engine.ts (option 1) is the defence in depth.
- **Not covered:** the OpenSCAD/replicad engines' `init()` on the main thread
  (no model code runs there), and any future code path that calls the sync
  `executeCode` — use `executeCodeAsync` (or check `engineSandboxActive()` in
  main.ts) for anything that evaluates user code.
- **Legal copy.** `src/content/data/legal.ts` still says code is "not inside a
  hardened security sandbox" — accurate while the default is off; revisit it
  when the default flips.
