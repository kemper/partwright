# Partwright — Iteration Workflow

## Testing without side effects

Use `runIsolated` to test code variations without changing the editor or viewport:

```js
const r = await partwright.runIsolated(code);
// r.geometryData = full stats (same schema as geometry-data)
// r.thumbnail = data:image/png base64 string (4 isometric views)
```

## Assertions — structured validation

Check geometry against expectations in one call:

```js
const r = await partwright.runAndAssert(code, {
  minVolume: 1000,      // volume bounds
  maxVolume: 50000,
  isManifold: true,     // must be valid manifold
  maxComponents: 1,     // detect failed booleans
  genus: 0,             // exact topological genus (0 = solid, N = N holes)
  minGenus: 1,          // genus range -- useful when exact count is unpredictable
  maxGenus: 20,
  minBounds: [10,10,5], // minimum bounding box dimensions [X,Y,Z]
  maxBounds: [50,50,30],
  minTriangles: 100,    // mesh complexity bounds
  maxTriangles: 50000,
  boundsRatio: { widthToDepth: [1.2, 1.8], widthToHeight: [1.5, 2.5] },  // proportion ranges
  notes: "Design rationale or context for this version",  // optional: attached to saved version
});
// r.passed = true/false
// r.failures = ["volume 500.0 < minVolume 1000"] (only if failed)
// r.stats = full geometry stats
```

## Assert + save in one call

`runAndSave` accepts optional assertions. If provided, validates in isolation first — fails fast
without saving if assertions don't pass. On success, saves the version and returns stat diff:

```js
const r = await partwright.runAndSave(code, "v2 - added towers", {
  isManifold: true, maxComponents: 1
});
// If assertions fail: r.passed = false, r.failures = [...], version NOT saved
// If assertions pass (or no assertions given):
// r.passed       = true (only present when assertions provided)
// r.geometry     = full geometry stats
// r.version      = { id, index, label }
// r.diff         = { volume: { from, to, delta }, componentCount: ..., ... }
// r.galleryUrl   = gallery URL for human review
```

## Forking a prior version

When iterating on a design, the common flow is *load a previous version, tweak it, save as a new version*.
Doing that across separate `loadVersion` -> `getCode` -> modify -> `runAndSave` calls is fragile: if any
step fails silently (wrong arg type, a client-side content filter on `getCode`, etc.) you can end up saving
a regression without noticing. `forkVersion` collapses the whole chain into one server-side call:

```js
const r = await partwright.forkVersion(
  { index: 11 },                       // or { id: "Kx3Pq9mA2wEr" } from listVersions()
  code => code.replace('towerH = 28', 'towerH = 35'),
  "v11a - taller towers",              // label for the new version
  { isManifold: true, maxComponents: 1 }, // optional assertions (validated before saving)
  true                                  // carryColors (default true) — re-apply parent colors
);
// On success:
//   r.passed       = true (only when assertions provided)
//   r.parent       = { id, index, label } of the version you forked from
//   r.geometry     = full geometry stats
//   r.version      = { id, index, label } of the newly saved version
//   r.diff         = stat diff vs. the previous current version
//   r.codeDiff     = { changed, added, removed, diff } — what actually changed in the SOURCE.
//                    Verify your transform landed here: changed:false means the code is
//                    byte-identical to the parent (your edit was a no-op).
//   r.colors       = { carried: [names], dropped: [names] } when the parent had colors
//   r.galleryUrl   = gallery URL for human review
// On failure:
//   r.error        = "No version found with index ..." / "transformFn threw: ..." / etc.
//   r.passed=false + r.failures=[...] if assertions didn't pass (nothing saved)
```

`target` is an object with exactly one of `{ index }` (numeric, 1-based) or `{ id }` (string from
`listVersions()[].id`). The two are never mixed, so there's no ambiguity about which field is being
looked up. This is the recommended way to build parallel branches (v11a, v11b, ...) off a shared
parent without a load/read/modify/save round-trip chain.

**Color carry-over.** If the parent version has color regions, `forkVersion` re-applies them to the
forked geometry automatically — each region's geometry-relative descriptor (box / slab / `byLabel` /
coplanar / connected-from-seed) is re-resolved against the new mesh, so a dimension tweak does **not**
force you to repaint. Regions whose descriptor no longer matches (a label the new code dropped, raw
triangle ids on changed topology) are skipped and reported in `r.colors.dropped`. Pass `carryColors:
false` for an intentionally uncolored fork.

> When the AI tool form is used, pass `patches: [{find, replace}, ...]` instead of a `transformFn`.
> Each `find` must occur **exactly once** in the parent code — a find that matches zero or multiple
> times is rejected with an error rather than silently saving the parent unchanged, so copy the exact
> text (whitespace included) from `getCode()`/`loadVersion()`.

## Copying colors onto a rebuilt version

When you rebuild geometry from scratch with `runAndSave` (rather than forking) but it matches an
earlier *painted* version, transfer the colors in one call instead of repainting region by region:

```js
const r = await partwright.copyColorsFromVersion({ index: 7 }); // the painted version
// r.source  = { index, label }
// r.carried = [names] re-resolved onto the current mesh
// r.dropped = [names] whose descriptor no longer matches — repaint those
```

This is in-memory like any paint op — your next `runAndSave` serializes the current regions, so they
persist with it. (You don't need this after `forkVersion`, which already carries colors.)

## Modify and test

Modify current editor code with a transform function and test the result without committing:

```js
const r = await partwright.modifyAndTest(
  code => code.replace('towerH = 28', 'towerH = 35'),
  { isManifold: true, maxComponents: 1 }
);
// r.modifiedCode = the transformed code string
// r.codeDiff     = { changed, added, removed, diff } — confirm the tweak landed.
//                  changed:false means your transform matched nothing (a no-op);
//                  the stats below would then describe the UNCHANGED code.
// r.stats        = geometry stats of the modified code
// r.passed       = true/false (only if assertions given)
// r.failures     = [...] (only if failed)
```

> Prefer the AI tool's `find`/`replace` (or `patches`) form over a bare `code => code.replace(...)`
> transform: a string `replace` whose needle is absent returns the code **unchanged with no error**,
> so the tweak silently no-ops. The `find`/`replace` form is rejected when the needle doesn't match
> exactly once. Either way, check `codeDiff.changed` before trusting the result.

## Multi-query current geometry

Query multiple properties of the already-computed geometry in a single call:

```js
const r = partwright.query({
  sliceAt: [5, 10, 15, 20],  // cross-sections at these Z heights
  decompose: true,             // component breakdown
  boundingBox: true,           // bounding box
});
// r.slices     = { z5: {area, contours, ...}, z10: {...}, ... }
// r.components = [{ index, volume, centroid, boundingBox }, ...]
// r.boundingBox = { min: [...], max: [...] }
// r.stats      = current geometry-data stats
```

## Batch session creation

Create a complete session with multiple versions in one call:

```js
const r = await partwright.createSessionWithVersions("Castle", [
  { code: v1Code, label: "v1 - walls" },
  { code: v2Code, label: "v2 - towers" },
  { code: v3Code, label: "v3 - gate" },
]);
// r.session = {id, name}
// r.versions = [{version, geometry}, ...]
// r.galleryUrl = "/editor?session=abc&gallery"
```

## Session notes — tracking design context

Use session notes to build a persistent record of the design story. This enables any agent (or human) resuming the session later to understand what happened and why.

**When to log notes:**
- Before first version: log the user's requirements and constraints
- On each version: include rationale in the label and optional `notes` field
- When the user gives feedback: log it as a note, then save the next version
- On key decisions: log dimensions, materials, constraints, tradeoffs
- On failed attempts: log what didn't work and why

**Prefix conventions** (so notes are scannable):

```js
await partwright.addSessionNote("[REQUIREMENT] 5.5x5.5x36in boards, snap-on C-channel, screw holes");
await partwright.addSessionNote("[FEEDBACK] User: groove looks too shallow, wants full tongue insertion");
await partwright.addSessionNote("[DECISION] Omitted right wall on end pieces for clearance");
await partwright.addSessionNote("[MEASUREMENT] Tongue width = outerW - 2*wallT = 133.7mm");
await partwright.addSessionNote("[ATTEMPT] v2 tried 3mm walls but too flimsy. Increased to 5mm in v3");
await partwright.addSessionNote("[TODO] Add chamfer to bottom edge for easier print removal");
```

Version-level notes go in the `runAndSave` assertions object:

```js
await partwright.runAndSave(code, "v2 - widened tongue per feedback", {
  isManifold: true,
  notes: "Changed tabW from 20mm to outerW - 2*wallT per user request"
});
```

## Resuming a session

When opening a session you haven't worked on (or returning after time away), **always call `getSessionContext()` first**:

```js
await partwright.openSession(sessionId);
const ctx = await partwright.getSessionContext();
// ctx.session    -- {id, name, created, updated}
// ctx.versions   -- [{index, label, timestamp, notes?, geometrySummary: {volume, boundingBox, ...}}]
// ctx.notes      -- [{id, text, timestamp}]  (all session notes)
// ctx.currentVersion -- {index, label}
// ctx.versionCount
// ctx.agentHints -- {apiDocsUrl, recommendedEntrypoint, codeMustReturnManifold, recentErrors, spending}
//   recentErrors: last 5 validation errors from this page session (helps avoid repeating mistakes)
```

Read the notes and version history before making changes. The notes tell you:
- What the user originally asked for (`[REQUIREMENT]` notes)
- What was tried and why (`[DECISION]` and `[ATTEMPT]` notes)
- What feedback the user gave (`[FEEDBACK]` notes)
- What measurements or constraints matter (`[MEASUREMENT]` notes)
- What still needs to be done (`[TODO]` notes)

## Recommended iteration pattern

1. Write initial code, assert+save in one call: `runAndSave(code, "v1 - base", {isManifold: true, maxComponents: 1})`
2. **Visually verify** — call `renderViews()` (cheap) to catch obvious errors; before declaring done, do an all-faces pass with `renderViews({ views: "box" })`.
3. Modify code, test with `modifyAndTest(patchFn)` or `runIsolated(code)` — no side effects
4. When satisfied, save: `runAndSave(modifiedCode, "v2 - improvements", assertions)` — check the diff
5. Use `query({sliceAt: [...], decompose: true})` for follow-up inspection without re-running
6. Repeat.
7. When done, briefly say what you built — it's already saved as a version, so you don't need to produce any link.
   - **In-app chat assistant:** do NOT mint or paste a share/export URL into the conversation. The encoded share link is enormous and pasting it just burns the user's tokens, and the user already has a **Share** button (↗) in the toolbar that builds one on demand. Just confirm the work is saved.
   - **External / console agents** (driving Partwright from outside the browser, e.g. via the console or Claude Code) have no toolbar to click, so hand the user a **share link**: `const { url } = await partwright.getShareLink()` — a self-contained, read-only URL that encodes the whole design so anyone can open and fork it. Prefer it over `getSessionUrl()`/`getGalleryUrl()`, which only resolve against *your* browser's local storage and won't open for the user.
