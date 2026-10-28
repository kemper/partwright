---
session: "4d3c0b91"
timestamp: "2026-10-28T19:00:00Z"
tools: [explore-by-grep, playwright]
---

## Human

Shared feedback from an in-app agent that repeatedly failed to fix 1–3 mm
features (teeth, fangs) on a large multi-object model. It blamed mostly its own
process, plus tool gaps: no zoomed or targeted camera on renderView, no ray or
nearest-surface query in model code, no cross-object access, modifyAndTest not
returning console logs, and the current object "flipping" when it used the
`object` parameter.

After discussing a private agent workspace (a cloned session in a hidden
iframe the user can watch), asked to: open a tracking issue, do the cheap
fixes (renderView zoom, modifyAndTest logs), add the ray/nearest-surface
queries to model code, and do the quick fix for the object flipping.

## Assistant

## Key decisions

**Tracking issue (#1197)** holds the whole plan: these four quick fixes plus
the follow-ups (AI guidance on establishing ground truth, cross-object access,
"run superseded", and the multi-step private-workspace feature).

**Zoom = `focus` + `padding` + `clip`** on renderView, renderViews, probePixel
and probePixels. `focus` takes a labelled part (name / `{part}` / `{piece}`)
or a world box `{min, max}`; the renderer already had a `frame` option (used
by part detection) that wasn't exposed. Named `focus`, not `part`: on
object-targetable tools a top-level `part` key is the legacy OBJECT target.
`clip` uses three.js local clipping planes on the offscreen render. The probe
tools take the same keys and skip hits outside a clipped box, so a pixel
picked off a zoomed or clipped image maps back to the surface the agent saw.
The default margin is an app-config knob (`renderer.viewFocusPadding`).

**Zoom narrows the field of view instead of moving the camera in.** The first
version kept the old "two box-widths away" distance, and the e2e test showed
the camera then sat inside the hollow shell around a small feature. In a real
model that means inside the jaw around a tooth. A framed camera now stays
outside the whole mesh, with the FOV set so the box fills the frame as before.
Unframed renders are unchanged.

**Ray / closest-point in model code** (`api.raycast`, `api.closestPoint`, also
on `api.meshOps`): a pure module (`src/geometry/meshQuery.ts`) with its own
small bounding-volume tree, cached per Manifold so probe loops pay the build
once. It doesn't use three-mesh-bvh because the Worker sandbox shouldn't pull
in three.js. Crossings through a shared edge are merged; `inside` comes from
ray parity. A brute-force comparison test caught rays that graze a vertex
being pruned by the tree's box test, so triangle boxes get a tiny relative pad.

**Object focus**: read-only targeted tools (renders, queries, modifyAndTest,
…; `FOCUS_RETURNING_TOOLS`) switch back to the user's object afterwards, but
only if nobody moved focus during the call. Model-changing tools leave the
object focused so the user sees the change. While checking that this was safe,
found that `changeObject` (which the AI's targeting uses) skipped the draft
stash/restore a rail click does, so a round trip could lose the user's unsaved
typing. It now goes through `selectPart`, without the auto-save-as-version step
(`saveEdits: false`): an agent peeking at a sibling shouldn't create versions.

**modifyAndTest logs**: executeIsolated already returned them; modifyAndTest
dropped them. Returned now on success, assertion and error paths.

**Context budget**: the system prompt was ~550 chars over its ceiling, so the
ray-query docs live in the `manifold-api` subdoc, with a one-line pointer in
ai.md; the zoom examples live in `visual-verification.md`.

## Human

(Review follow-up, no new human input: an independent review subagent's
findings on the first push.)

## Assistant

## Key decisions

**Id-returning reads keep focus on their object.** findFaces,
getPartTriangles, listRegions, paintExplain, getObjectPartInfo, partBoundary
and probe* left FOCUS_RETURNING_TOOLS: their answers feed a follow-up call
(paintFaces, probePixel) that would otherwise land on the user's object.
When focus does go back, the tool result says so and names the object to
pass on follow-ups.

**Return to the exact view, without auto-saving.** First tried making agent
switches save like a rail click, which would also keep slider overrides and
annotations. The e2e test showed the dirty check flags objects right after an
API save and old versions on switch-away, adding duplicate versions on every
peek. Instead `selectPart(…, { saveEdits: false })` stashes the outgoing
view in memory (version, code, params, annotations), and
`changeObject(id, { version })` restores it on the way back. The stash
lives at module scope because of the main.ts TDZ trap.

**A late switch-back can't hit a newer call.** executeTool bumps a
generation counter, and the switch-back only runs while it is unchanged.

Kept as-is (noted in the PR): the near plane ignores a reference ghost
outside the mesh sphere (ghosts are fit checks, so near the model), and
renderParts has no `clip` option yet.
