# Engine sandbox — running model code on a separate origin

Status: **opt-in, default off** (kemper/partwright#1090, "option 2"). Builds on
the engine-Worker lockdown (#1109, "option 1"), which strips network/storage
globals from the Worker realm and keeps model code off the main thread; the
sandbox adds an origin boundary under that. Inside whichever Worker runs it,
model code is evaluated in an SES Compartment (#1127, **on by default** — see
[SES compartment](#ses-compartment-1127) below), which bounds the *realm*: no
Worker global, frozen built-ins. The layers are complementary — the iframe
bounds the *origin* (no app IndexedDB even after an escape), SES bounds the
*realm*.

## The problem

Model code — typed by the user, written by an AI, or arriving inside an
imported session / share link / catalog fork — is evaluated with
`new Function('api', code)` inside the geometry Worker
(`src/geometry/engineWorker.ts`, and the Assembly/export pool in
`src/geometry/enginePool.ts`). That Worker is on the **app origin**, so the code
can `indexedDB.open('partwright')` and read every store — including `aiKeys`
(the user's provider API keys) — and `fetch` any `https:` host the app CSP
allows. Verified before #1109's lockdown with the sandbox off: model code
listed all 13 app stores, opened `aiKeys`, and fetched a cross-origin URL with
status 200. The lockdown removes those globals from the realm; the sandbox
makes the *origin* itself worthless to model code even if a global ever leaks.

The engine sandbox moves the Worker into a hidden iframe on a **different
origin**, which has no path to the app's storage, and fences its network with
that frame's own CSP.

## Modes

| Mode | Frame | Model code sees | Needs |
|---|---|---|---|
| `off` (default) | none — Worker created by the app | app origin: IndexedDB, `fetch` per app CSP | nothing |
| `opaque` | `<iframe sandbox="allow-scripts" allow="cross-origin-isolated" src="/sandbox">` — same URL, **opaque origin** | IndexedDB refused (`SecurityError`), no localStorage, `connect-src 'self'` | CORS (`Access-Control-Allow-Origin: *`) on `/assets/*` and `/openscad-libs/*` (shipped in `public/_headers`) |
| `origin` | `<iframe sandbox="allow-scripts allow-same-origin" allow="cross-origin-isolated" src="$VITE_SANDBOX_ORIGIN/sandbox">` | the sandbox origin's own (empty, partitioned) IndexedDB, no localStorage, `connect-src 'self'` (the sandbox origin) | a second hostname serving ONLY the sandbox (see deployment) + `VITE_SANDBOX_ORIGIN` / `VITE_APP_ORIGIN` at build time + `frame-src` in the app CSP |

Both sandbox modes were verified `crossOriginIsolated === true` in the frame
**and** in its Worker (Chromium 141), so SharedArrayBuffer / the WASM engines
work unchanged.

## Enabling it

- **Per browser:** Settings (⚙) → *Security — engine sandbox* → pick a mode,
  reload. Or from the console: `partwright.setEngineSandboxMode('opaque')`,
  reload; `partwright.getEngineSandboxStatus()` reports what's in effect.
  **The mode is captured once per tab**, at page load: changing the setting —
  here or in another tab, which shares localStorage — never flips a running
  tab; it shows up as `pendingAfterReload` until that tab reloads.
  The value lives in `localStorage['partwright-engine-sandbox']` (AppConfig
  only stores numbers/booleans). It is intentionally **not** an in-app AI tool
  — a prompt-injected session must not be able to switch it off.
- **Per deployment:** build with `VITE_ENGINE_SANDBOX=opaque` (or `origin`) to
  change the default for everyone; a per-browser choice still wins.
- **Tunables** (Settings → Security): `renderer.engineSandboxBootTimeoutMs`
  (default 20 s — frame load / Worker spawn deadline),
  `renderer.engineSandboxMaxFrameRestarts` (default 2 — consecutive frame
  restarts before failing closed), `renderer.engineSandboxHeartbeatMs`
  (default 2 s — liveness ping; ~3 missed ⇒ frame restart).

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
  `self.onmessage` listens for. It captures `MessagePort.prototype.postMessage`,
  `dispatchEvent` and `MessageEvent` *before* any model code runs, so a model
  that patches those built-ins can't read or forge later traffic; #1109's
  lockdown then pins the redirected `postMessage`. The engine's private
  same-origin asset fetch (`fetchAppAsset`) goes through the shim's
  URL-resolving `fetch`.
- **Why a classic blob Worker.** A blob Worker inherits the frame document's
  origin and **CSP** (an http-URL Worker would take its CSP from its own
  response headers, i.e. the app's `/*` policy). Chromium refuses a
  `{type:'module'}` blob Worker from an opaque-origin document, but a classic
  one may `import()` the module shim cross-origin over CORS. Messages that
  arrive before the shim loads are parked on a global queue the shim drains.
  A blob Worker's base URL can't resolve root-relative paths, so the shim
  resolves string `fetch` URLs against its own module URL (BOSL2, fonts, the
  OCCT wasm).
- **Fail closed.** The Worker's first port message reports
  `crossOriginIsolated` / `SharedArrayBuffer`. Until then the façade buffers
  what the client posts — and that buffer is only ever delivered to a
  **sandboxed** Worker. Nothing falls back to an app-origin Worker on its own:
  - a spawn that times out *after* the frame was ready, or a frame that stops
    answering the liveness ping / disappears (its renderer crashed — e.g. model
    code OOM-killed it), **restarts the iframe**: connected façades error out
    (the client rejects what was in flight and asks for a new Worker), waiting
    ones re-spawn with their buffer in the new frame. Bounded by
    `engineSandboxMaxFrameRestarts` consecutive restarts;
  - anything else — frame/Worker not cross-origin isolated, frame didn't load,
    restart budget spent, `origin` mode misconfigured — marks the sandbox
    **unavailable** for the tab: every queued and later engine call fails with
    `engine sandbox unavailable: …`, no iframe is left, a `warn` Diagnostic Log
    entry + one toast are emitted, and a **persistent status pill** in the
    viewport offers the only way out: an explicit per-tab **Run without
    sandbox (this tab)** (`partwright.runWithoutEngineSandbox()`, state
    `bypassed`, its own warning pill). Reload re-enables the sandbox.
- **Same Worker seam for every boot.** Boots, crash restarts, Cancel and
  #1109's per-session recycle (`claimEngineWorker`) all go through
  `createEngineWorker`, so a recycled Worker is just as sandboxed.
- **Untrusted messages.** Everything from the frame / Worker is untrusted
  (`src/sandbox/protocol.ts`): frame messages must come from our iframe's
  `contentWindow` with the expected origin (`'null'` for opaque) and match a
  type + shape allow-list; Worker messages must be plain objects with an
  allow-listed engine `type` and a well-formed `callId`. Anything else is
  dropped with a Diagnostic Log warning. The engine type list is the one
  #1109's field-level validator uses (`ENGINE_WORKER_MESSAGE_TYPES`); a unit
  test pins it to the `type:` literals engineWorker.ts actually posts. In
  `origin` mode the frame also checks the *sender* of `spawn`/`terminate`
  against `VITE_APP_ORIGIN`, and its CSP `frame-ancestors` limits who may embed
  it at all.
- **No main-thread evaluation.** Since #1109 there is no synchronous
  main-thread `executeCode`; `exportParamSweep`, `setReferenceGeometry` and
  voxel paint/export all build in the (sandboxed) Worker.
  `setReferenceGeometry` is async and drops a result overtaken by a newer
  set/clear or a session switch.
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
  font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';
  frame-ancestors 'self' <app origin(s)>
```

`frame-ancestors 'self'` covers `opaque` mode (the frame's URL origin is the
app's); `public/_headers` adds the production app hosts for `origin` mode, and
dev/preview add `VITE_APP_ORIGIN`.

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

Production uses a **second Cloudflare Pages project**, `partwright-sandbox`
(`https://partwright-sandbox.pages.dev`), built from the same repo and the
same `production` branch with the default `npm run build`. It needs no DNS:
`pages.dev` is on the Public Suffix List, so it is a separate *site* from
`www.partwrightstudio.com`. (The domain itself is on Namecheap DNS, so a
`sandbox.partwrightstudio.com` host could not use a Cloudflare redirect rule,
and Pages' `_redirects` cannot match on the hostname.)

1. **Create the `partwright-sandbox` Pages project** (connect to Git, same
   repo, production branch `production`, build `npm run build`, output
   `dist`). Turn preview deployments off; it only needs production. **Never
   delete it**: `pages.dev` names are first-come, so a deleted project's name
   could be claimed by someone else, and the app would frame their page.
2. **Production env vars on BOTH projects** (Settings → Variables and
   Secrets, type Text):
   `VITE_SANDBOX_ORIGIN=https://partwright-sandbox.pages.dev` and
   `VITE_APP_ORIGIN=https://www.partwrightstudio.com,https://partwrightstudio.com`.
   The frame refuses spawn requests from any other origin, so a missing
   `VITE_APP_ORIGIN` makes `origin` mode fail closed. Preview deployments
   without these simply can't select `origin` mode (the option is disabled;
   `setEngineSandboxMode('origin')` returns an error).
3. **The sandbox host never runs the app.** It serves the full build, so
   without a guard a user who opened `/editor` there would save sessions and
   **AI keys into the sandbox origin's storage.** Browsers partition
   third-party storage today, so the framed Worker would normally see a
   separate bucket, but partitioning can be disabled by policy, relaxed by
   the Storage Access API, or changed by browsers later, so the app must not
   rely on it. `src/entry.ts` checks this first (`sandboxHostAction` in
   `src/sandbox/sandboxHostGuard.ts`): on the `VITE_SANDBOX_ORIGIN` origin, and
   on `https://partwright-sandbox.pages.dev` by name in case the sandbox
   project's build lacks the env var, it redirects to the first
   `VITE_APP_ORIGIN` (falling back to `www.partwrightstudio.com` on the
   production host), keeping path, query and hash, before loading any app
   bundle or touching storage. It shows a static notice if there's nowhere to
   send the visitor. `sandbox.html` doesn't load `entry.ts`, so the frame is
   unaffected, and the content pages (`/help`, `/catalog`, …) ship no
   storage-writing JS. Per-deploy hosts
   (`<hash>.partwright-sandbox.pages.dev`) are other origins the frame never
   runs on, so they don't need the guard. Keep new storage-touching code
   behind `entry.ts`'s dynamic imports.
4. **Framing is allowed from the app** by `frame-src 'self'
   https://partwright-sandbox.pages.dev` on the `/*` CSP in `public/_headers`
   (the dev/preview servers add it from `VITE_SANDBOX_ORIGIN`). The sandbox
   document's `frame-ancestors` already lists the production app hosts.
   Changing the sandbox host means updating that `frame-src` and
   `PRODUCTION_SANDBOX_ORIGIN` in `src/sandbox/sandboxHostGuard.ts`.
5. Optionally set `VITE_ENGINE_SANDBOX=origin` to make it the default. Until
   then the mode is opt-in per browser (Advanced Settings → Security, or
   `partwright.setEngineSandboxMode('origin')`), and the `/legal` "Code
   execution" text should be updated when the default flips.

Verify after a release:

```bash
curl -sI https://partwright-sandbox.pages.dev/sandbox   # 200, two CSP headers, cross-origin-resource-policy: cross-origin
```

Opening `https://partwright-sandbox.pages.dev/editor` in a browser should land
on `https://www.partwrightstudio.com/editor`. Then, on `www`:
`partwright.setEngineSandboxMode('origin'); location.reload()`, and
`partwright.getEngineSandboxStatus()` should report `active: 'origin'`,
`state: 'ready'`, both `crossOriginIsolated` flags `true` and no
`unavailableReason`.

Site note: being a different site, the frame most likely runs in its own
renderer process (stronger isolation). Mesh results are then copied across
processes, measured for `opaque` below at ≈7 ms for 205k triangles and
≈18 ms for 500k. Unlike `opaque`, the frame's HTTP cache persists, so it
downloads the engine once rather than on every page load. Third-party storage
partitioning applies; the frame needs no storage.

## SES compartment (#1127)

Independent of the mode above, every engine Worker — the editor's, each
Assembly/export pool Worker, and the Worker inside this sandbox frame —
evaluates model code in a Hardened JavaScript (SES) `Compartment`, **on by
default**. Full design notes: docs/architecture-notes.md → "SES compartment
for model code". In short:

- **Ordering.** Worker `init`: SES `lockdown()` → engine init (manifold-3d;
  OpenSCAD/OpenCASCADE load lazily later on frozen intrinsics) →
  `workerLockdown`'s denylist + default-deny audit (#1119), which allowlists
  the capability-free globals SES installs (`workerGlobalAllowlist.ts`, group
  `ses`). Any SES failure fails closed with the usual "Geometry engine refused
  to start for security reasons" refusal + Diagnostic Log entry.
- **Preset.** `evalTaming: 'unsafe-eval'` (else SDF figures 4.3× slower —
  the engine's own `new Function` code would run under SES's `with`
  evaluator), `overrideTaming: 'min'` (else BOSL2 ~2× slower), and the
  error/console/stack/locale/trapping options relaxed so the engine realm
  behaves exactly as before. A fresh compartment per run, with a prelude that
  binds the compartment globals as local `const`s (else hot model closures are
  1.85× slower).
- **Glue fix.** `overrideTaming: 'min'` needs a build-time rewrite of the
  override-mistake assignments in the manifold-3d and replicad-opencascadejs
  glue (`src/geometry/sesGlueFix.ts`, Vite plugin `sesOverrideMistakeFix`);
  `tests/unit/sesGlueFix.test.ts` pins the rewrite count per installed file.
- **Kill switch.** `localStorage['partwright.sesSandbox'] = 'off'` (per browser)
  or build/dev with `VITE_SES_SANDBOX=0`. Off is exactly the pre-#1127
  behaviour (`new Function`, `ses` never loaded).
- **Relation to this sandbox.** SES bounds the *realm* (model code can't name
  the Worker global or patch shared built-ins/api objects); the frame bounds
  the *origin*. Inside the frame both apply (e2e: engine-ses.spec "the #1110
  iframe-sandbox Worker runs model code under SES too").

**Performance (SES on vs off)** — measured with the opt-in
`SES_PERF=1 E2E_PORT=5291 npx playwright test ses-bench --grep perf`
(dev server, headless Chromium 141, medians; Worker init = `init` → `ready`
over 5 fresh Workers; runs = Worker-side compute time):

Measured 2026-10-26, 4 CPUs, one Worker per page:

| | SES off | SES on | on / off |
|---|---|---|---|
| Worker init (`init` → `ready`) | 32 ms | 59 ms (SES itself ~35–40 ms) | +27 ms |
| trivial cube (15 runs) | 0 ms | 1 ms | +≈1 ms (fresh compartment + hardening the run's `api`) |
| 64-sphere union, ~150k tris (5) | 812 ms | 844 ms | 1.04 |
| `levelSet` + model-code JS closure (3) | 1470 ms | 1415 ms | 0.96 |
| SDF figure `cat_calico` (3) | 5235 ms | 5177 ms | 0.99 |
| BOSL2 `modular_drawer_bin` (2) | 23300 ms | 23495 ms | 1.01 |

Runs are within noise; the init cost is paid once per Worker (per session, and
per Assembly pool Worker). `ses` is its own lazy chunk (`sesLoader-*.js`,
86 KB minified) on the Worker's start path; the kill switch never loads it.

**Catalog sweep** — `SES_SWEEP=1 E2E_PORT=5291 npx playwright test ses-bench
--grep sweep` runs every `public/catalog` entry with SES on and off and fails
on any difference in triangle count or volume (≈45 min; results in
`.ses-bench/`, `SES_SWEEP_ONLY=a,b` to narrow).

Last run (2026-10-26, 161 entries): **158 identical, 0 different**, 3
failing identically in both modes (`mechanical_orrery`, `pocket_watch` — the
180 s cap; `sdf_gyroid_chamber` — "memory access out of bounds" in a
long-lived Worker). Two entries timed out once, one in each mode (`diva` with
SES on, `dog_dalmatian` with SES off), and rendered identically when re-run
(`SES_SWEEP_ONLY`): one long-lived page running ~160 heavy models in a row
occasionally stalls. Worker time over the 111 models above 200 ms: total
+6.8 %, per-model on/off median 1.10 (p10 0.91, p90 1.25) — per-model noise in
a 45-minute run is ±25 %; the controlled perf runs above are the measurement.

## Testing

- `tests/engine-sandbox.spec.ts` — per mode (the storage/network probe runs
  with the SES kill switch on, i.e. assuming model code already holds the
  Worker realm; under SES it can't even name `indexedDB`/`fetch`): a value
  saved through the app's
  `aiKeys` store is unreadable from model code; IndexedDB is refused
  (opaque) or empty/partitioned (origin); `localStorage` is absent; fetches
  to `https://example.com`, a loopback alias of the app host, and (origin
  mode) the app origin all fail from model code, and the frame's own CSP
  refuses them **with a `connect-src` violation** (probed in the frame
  document, since #1109 already removes `fetch` from the Worker realm);
  manifold-js, voxel, SCAD, BREP (api.BREP + replicad), reference geometry
  and the Assembly worker pool all work. Plus: a dead frame is replaced and
  model code stays sandboxed; with no restart budget it **fails closed**
  (runs refused, pill shown) until the explicit bypass; the mode is captured
  once per tab; off by default.
- `playwright.config.ts` starts a second dev server on `E2E_SANDBOX_PORT`
  (default `E2E_PORT + 1000`, clear of the parallel-worktree ports) as the
  sandbox origin, with its own Vite `cacheDir` (`VITE_CACHE_DIR`), and passes
  `VITE_SANDBOX_ORIGIN` / `VITE_APP_ORIGIN` / `PARTWRIGHT_SANDBOX_DEV_CORS` to
  both servers (inert while the sandbox is off). Origin-mode tests skip if a
  reused server lacks the env; opaque-mode tests skip if the server doesn't
  answer `Origin: null` with CORS.
- `tests/unit/engineSandbox.test.ts` — protocol guards, the parent-origin
  check, app/frame constant parity, the Worker message-type list vs
  engineWorker.ts, and the setting module.

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
| Active mode / fallbacks¹ | off / 0 | opaque / 0 | origin / 0 |

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
  Worker in every sandboxed run; no fallbacks occurred. (¹ Measured before the
  fail-closed rework and the #1109 merge; the bench now reports "unavailable"
  in that row. The hot paths it measures are unchanged.)
- **Unmeasured:** Firefox, WebKit, real network latency/bandwidth, low-end
  devices, and Chromium configurations where same-site frames get their own
  process (would add the cross-process copy to `origin` too).

## Known limitations

- **Chromium only measured.** Firefox and WebKit are unmeasured; the
  opaque-origin + COI + blob-Worker combination in particular needs checking
  there (Safari's COI support in sandboxed frames is the main unknown). A
  browser that refuses gets the fail-closed pill, not a silent downgrade.
- **coi-serviceworker fallback.** If the deployment's COOP/COEP headers are
  stripped and the app relies on `coi-serviceworker.js`, the sandbox frame is
  not controlled by that service worker (opaque frames never are), so it isn't
  isolated → the sandbox is unavailable (fail closed, pill + bypass).
- **Crash detection is a heartbeat.** Chromium 141 doesn't fire MessagePort
  `close` when the frame's renderer dies, so a crash is noticed by ~3 missed
  liveness pings (default ≈6 s) and in-flight runs fail then. The e2e
  simulates a crash by removing the iframe (headless Chromium here keeps the
  opaque frame in the app's renderer, so CDP `Page.crash` kills the page).
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
  arbitrary messages on its port to the app; they're type-allow-listed here
  and field-validated by #1109 (`checkEngineWorkerMessage`).
- **Legal copy.** `src/content/data/legal.ts` describes the default (SES
  compartment in a locked-down Worker, #1127) as layers of defence, not a
  guarantee; it doesn't claim the origin sandbox, which is still opt-in —
  revisit it if this sandbox's default flips.
