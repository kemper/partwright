// Tool bridge: defines the schemas the model sees and dispatches calls to
// window.partwright. The set of tools the model receives is filtered by the
// per-session scope toggles (see settings.ts). Disabled tools are removed
// from the request payload entirely — the model can't call what isn't there.
//
// Flow per tool call:
//   1. chatLoop.ts sends user input + history + system prompt to anthropic.ts.
//   2. anthropic.ts streams back a tool_use content block.
//   3. chatLoop.ts calls executeTool(name, input) defined in this file.
//   4. executeTool reaches into window.partwright (built in main.ts) and
//      wraps the return value into a tool_result block.
//   5. The result is appended to history and fed back to Claude next turn.
//
// Argument validation lives on the API side (src/validation/apiValidation.ts)
// so the same checks apply to console/MCP callers, not just the model.

import type { ChatToggles } from './types';
import type { Language } from '../geometry/engines/types';
import { RENDER_VIEW_MODES, EDGE_MODES } from '../renderer/multiview';
import { getRenderBudget } from './settings';
import { applyLiteralPatch, applyPatches } from './patch';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

import type { ImageSource } from './types';

export interface ToolExecResult {
  content: string;
  isError: boolean;
  /** Optional image to forward back to the model as a multimodal content
   *  block. Set by renderView (and any future tools that produce vision
   *  output) so the agent can self-verify against a fresh snapshot. */
  image?: ImageSource;
}

const ALL_TOOLS: ToolDefinition[] = [
  {
    name: 'getActiveLanguage',
    description: 'Returns the editor\'s current modeling language: "manifold-js", "scad", "replicad", or "voxel". The per-turn system suffix already includes this, but call when in doubt or after a tool sequence that might have switched it.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'setActiveLanguage',
    description: 'Switch the editor between "manifold-js", "scad", and "replicad". Your in-progress code in the previous language is stashed as a per-session draft and restored when you switch back, so flipping is cheap and non-destructive — saved versions in this session are untouched and remember the language they were authored in. "replicad" is a full BREP / OpenCASCADE session — pick it when the user wants exact fillets, chamfers, STEP export, or mechanical-CAD interop. (Inside a manifold-js session you can also access BREP via `api.BREP.*` without switching languages — only switch when STEP export or a BREP-only workflow is required.) "voxel" is a blocky colored-cube engine (pure JS): build with `api.voxels()` then v.set/v.fillBox/v.sphere/v.line in hex or [r,g,b] colors and `return v` — pick it for Minecraft-style / pixel-art models or after an image-to-voxel import. Use when the user asks, or when the new request maps obviously better to one of the engines; still avoid unnecessary back-and-forth since each switch costs a tool round-trip.',
    input_schema: {
      type: 'object',
      properties: {
        lang: { type: 'string', enum: ['manifold-js', 'scad', 'replicad', 'voxel'] },
      },
      required: ['lang'],
    },
  },
  {
    name: 'getCode',
    description: 'Read the current code in the editor. Always available. Returns the full source as a string.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'setCode',
    description: 'Replace the editor contents. Does NOT auto-run — call runAndSave or runCode after to render.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'New editor contents (must be a complete program ending in `return manifold;`).' },
      },
      required: ['code'],
    },
  },
  {
    name: 'getParams',
    description: 'Read the current model\'s Customizer parameters — the tweakable knobs it declares via `api.params({...})`. Returns `{ schema, values }`: `schema` lists each parameter (key, type, default, min/max/options) and `values` its current resolved value. Returns empty arrays/objects when the model declares none. Call before setParams to discover what can be tweaked without re-reading the code.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'setParams',
    description: 'Tweak one or more Customizer parameters and re-run the model — the same effect as the user dragging the Parameters panel\'s sliders, but driven from code. Pass an object of `{ paramKey: value }`. Out-of-range or wrong-type values are clamped / fall back to the default (never errors on a bad value); unknown keys are ignored. Returns the updated geometry stats and resolved parameter values. Prefer this over rewriting the code when you only need to change a declared dimension/option — it\'s cheaper and preserves the model. Errors only if the model declares no parameters.',
    input_schema: {
      type: 'object',
      properties: {
        values: {
          type: 'object',
          description: 'Map of parameter key → new value, e.g. { "width": 50, "rows": 3, "rounded": false }.',
        },
      },
      required: ['values'],
    },
  },
  {
    name: 'runCode',
    description: 'Run the given code (or the editor contents if `code` is omitted) and return the resulting geometry stats. Does NOT save a version. Use for quick iteration before committing.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Optional code to run instead of editor contents.' },
      },
    },
  },
  {
    name: 'runAndSave',
    description: 'Run code and commit the result as a new gallery version in the current session. The preferred way to make progress — leaves a versioned record. Returns geometry stats and the saved version number. Optionally pass `assertions` to validate before saving — the version is NOT saved if assertions fail.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to run (overwrites the editor with the run-passing variant).' },
        label: { type: 'string', description: 'Short label for the gallery (e.g. "tapered legs"). Defaults to v<index>.' },
        assertions: {
          type: 'object',
          description: 'Optional geometry assertions. Version is NOT saved if any assertion fails.',
          properties: {
            isManifold: { type: 'boolean', description: 'Must be a valid manifold.' },
            maxComponents: { type: 'integer', description: 'Max component count.' },
            minVolume: { type: 'number', description: 'Minimum volume.' },
            maxVolume: { type: 'number', description: 'Maximum volume.' },
            genus: { type: 'integer', description: 'Exact genus.' },
            minGenus: { type: 'integer', description: 'Minimum genus.' },
            maxGenus: { type: 'integer', description: 'Maximum genus.' },
            minBounds: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Minimum bounding box dimensions [x,y,z].' },
            maxBounds: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Maximum bounding box dimensions [x,y,z].' },
            minTriangles: { type: 'integer', description: 'Minimum triangle count.' },
            maxTriangles: { type: 'integer', description: 'Maximum triangle count.' },
            boundsRatio: {
              type: 'object',
              description: 'Proportion assertions.',
              properties: {
                widthToDepth: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[min, max] ratio of width to depth.' },
                widthToHeight: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[min, max] ratio of width to height.' },
                depthToHeight: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[min, max] ratio of depth to height.' },
              },
            },
            notes: { type: 'string', description: 'Optional note text attached to the saved version.' },
          },
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'getGeometryData',
    description: 'Read the current geometry stats (volume, surfaceArea, vertexCount, triangleCount, isManifold, componentCount, boundingBox). Cheap — no re-execution. Returns `stale: true` when the editor code changed since the last run (setCode without a subsequent run) — call runAndSave/run first if you need fresh stats. Returns `containedComponents: N` when N components are fully enclosed inside another solid and excluded from the floater check.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getMeshSummary',
    description: 'Group triangles by coplanar regions and return per-group {centroid, normal, area, bbox, triangleIds}. Use `maxGroups: 8` and `maxTrianglesPerGroup: 0` aggressively — the full mesh on complex models is hundreds of groups and tens of thousands of triangle ids, all charged as input tokens. Pass `withinBox` to scope to one feature of the model.',
    input_schema: {
      type: 'object',
      properties: {
        tolerance: { type: 'number', description: 'Coplanarity cosine in [-1, 1]. Default 0.999.' },
        minTriangles: { type: 'integer', description: 'Drop groups smaller than this. Default 1.' },
        maxGroups: { type: 'integer', description: 'Return only the N largest groups. Default unlimited — pass 8-16 for a first pass.' },
        maxTrianglesPerGroup: { type: 'integer', description: 'Cap triangleIds per group. Pass 0 to OMIT triangleIds entirely (saves the most tokens — use this when you just need centroids/normals to plan painting).' },
        withinBox: { type: 'object', description: 'Optional {min: [x,y,z], max: [x,y,z]} — return only groups whose bbox intersects this region. Use to focus on one feature (e.g. the eyes of a face) without pulling the whole mesh summary.' },
      },
    },
  },
  {
    name: 'listComponents',
    description: 'Decompose the current manifold into its boolean-distinct components and return {index, centroid, boundingBox, volume, surfaceArea} for each. Use this for "paint each feature" workflows on unioned models — for a smiley built from head + 2 eyes + mouth, this returns 4 components with bboxes. Prefer paintComponent(index, color) if you intend to paint right after — it skips this query entirely.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'paintComponent',
    description: 'Paint a boolean-distinct component (from listComponents) in one call. Equivalent to listComponents → paintInBox(component.boundingBox) but a single round-trip. Use whenever the user wants "paint the Nth piece a color" — eyes, nose, mouth on a unioned smiley, arms of a robot, etc.',
    input_schema: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: 'Component index from listComponents() (0-based).' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[r, g, b] in 0..1.' },
        name: { type: 'string', description: 'Optional human-readable region name. Defaults to "Component <index>".' },
        topOnly: { type: 'boolean', description: 'If true, only paint upward-facing triangles (skip side walls + bottom). Same shortcut as paintInBox.topOnly.' },
      },
      required: ['index', 'color'],
    },
  },
  {
    name: 'listLabels',
    description: 'Return labels registered in the current run via api.label(shape, name) — the cleanest paint primitive on agent-authored geometry, in both manifold-js and SCAD (where labels come from top-level `label("name") <expr>;` wrappers). Each entry: {name, triangleCount, bbox, centroid}. Empty when the code did not call api.label or `label("name")`. Use to confirm labels resolved correctly before paintByLabel; otherwise prefer calling paintByLabel directly to save a round-trip.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'paintByLabel',
    description: 'Paint a labelled feature by name. The label must have been registered in the current run via api.label(shape, name) / api.labeledUnion (manifold-js) or label("name") <expr>; at the top level of the source (SCAD). This is the bullseye for "describe how to make and paint a model" workflows: write the geometry with labels, then paint by name — no coordinate guessing, no bounding-box estimation, no fan-bleed. For manifold-js it survives boolean ops because manifold-3d propagates originalID through runOriginalID. For SCAD it only survives at the top level — labels inside a CGAL boolean ({ ... } of difference/intersection/etc.) are lost; fall back to paintComponent / paintInBox there. For multi-feature models, batch with paintByLabels in one round-trip instead of N sequential paintByLabel calls. IMPORTANT: api.label only tracks surfaces that exist in the original labeled shape. Boolean subtraction creates NEW triangles at the cut surface (e.g. the inner wall of a mug after subtracting the void) — those new triangles have NO label. Use probePixel + paintConnected for inner surfaces created by boolean ops.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Name passed to api.label() in the model code.' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[r, g, b] in 0..1.' },
        name: { type: 'string', description: 'Optional region name; defaults to the label.' },
        topOnly: { type: 'boolean', description: 'Restrict to upward-facing triangles only (normal within 30° of +Z). Useful when a label covers both top and side faces and you only want the top.' },
        normalCone: {
          type: 'object',
          description: 'Restrict to triangles whose normal is within angleDeg of the given axis. Overrides topOnly.',
          properties: {
            axis: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            angleDeg: { type: 'number' },
          },
          required: ['axis', 'angleDeg'],
        },
      },
      required: ['label', 'color'],
    },
  },
  {
    name: 'paintByLabels',
    description: 'Batch sibling of paintByLabel. Paint N labelled features in one tool call. Use this for any multi-feature paint job — a 9-feature smiley paints in 1 round-trip instead of 9. The viewport refresh coalesces under rAF so total cost is one frame regardless of batch size. Returns {results: [...], failed: [{label, error}]} — partial failures are reported per-label and do not abort the batch. Each item supports optional topOnly/normalCone to filter the label\'s triangle set — useful when a label spans top and side faces but you only want the top.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Array of paint specs, each {label, color, name?, topOnly?, normalCone?}.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
              name: { type: 'string' },
              topOnly: { type: 'boolean', description: 'Restrict to upward-facing triangles (normal within 30° of +Z).' },
              normalCone: {
                type: 'object',
                properties: {
                  axis: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                  angleDeg: { type: 'number' },
                },
                required: ['axis', 'angleDeg'],
              },
            },
            required: ['label', 'color'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'probePixel',
    description: 'Click in your own perception. Translates a pixel in a renderView image back to a world-space surface hit on the mesh: {point, normal, distance, triangleId, nextStep}. The view must match the renderView call (same elevation/azimuth/ortho/size). This is THE tool for organic geometry: render → identify the feature visually → probePixel to get exact coords → paintConnected or paintNear. The returned point is exactly on the mesh surface (raycast, not snap), so paintRegion-style seed-precision worries are gone. Front-most hit = occlusion correct. A background pixel does NOT fail — it returns {hit:false, modelPixelBounds, hint} reporting where the model projects in this view, so just re-aim inside those bounds and probe again (pixel estimates off a render carry ±10-20px error, so the occasional miss is normal). THIN FEATURES: if the same feature keeps missing (e.g. a rim, a wire, a thin stripe) and the model only occupies a small fraction of the frame on the minor axis, the miss-hint suggests doubling the renderView `size` — each pixel then covers half the real area, so the same ±20px aim error stays on the feature.',
    input_schema: {
      type: 'object',
      properties: {
        pixel: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] pixel position. (0, 0) is top-left.' },
        view: {
          type: 'object',
          description: 'Camera spec. MUST match the renderView call that produced the image — same elevation, azimuth, ortho, size.',
          properties: {
            elevation: { type: 'number' },
            azimuth: { type: 'number' },
            ortho: { type: 'boolean' },
            size: { type: 'integer' },
          },
        },
      },
      required: ['pixel', 'view'],
    },
  },
  {
    name: 'paintConnected',
    description: 'Flood-fill paint from a surface seed, gated by deviation from the SEED normal (not adjacent-face). This is what paintRegion should have been on smooth meshes — paintRegion compares adjacent pairs and is bimodal (all or nothing) on capsules / spheres / organic surfaces, paintConnected keeps the reference fixed at the seed so 30° gives you "this region of the surface facing roughly this way", regardless of how curved the connecting topology is. Best paired with probePixel — probe a pixel in a render, hand the {point, normal} straight to paintConnected.',
    input_schema: {
      type: 'object',
      properties: {
        seed: {
          type: 'object',
          description: 'Surface seed. `point` is required; `normal` optional (defaults to the nearest triangle\'s normal).',
          properties: {
            point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            normal: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
          },
          required: ['point'],
        },
        maxDeviationDeg: { type: 'number', description: 'Maximum angle (degrees) a neighbor\'s normal may deviate from the seed normal. Default 30. Use larger values to follow curved features; smaller values to stay on a single facet.' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        name: { type: 'string' },
      },
      required: ['seed', 'color'],
    },
  },
  {
    name: 'getFeatureCentroids',
    description: 'Token-cheap planning aid: returns coplanar face groups with just centroid + normal + bbox + area (NO triangle IDs). Use this when planning where to paint without committing yet — cheaper than getMeshSummary because the triangleIds payload is omitted. Optional `withinBox` scopes to one feature.',
    input_schema: {
      type: 'object',
      properties: {
        maxGroups: { type: 'integer', description: 'Return the N largest groups. Default 32.' },
        withinBox: { type: 'object', description: 'Optional {min: [x,y,z], max: [x,y,z]} — only groups whose bbox intersects.' },
      },
    },
  },
  {
    name: 'renderView',
    description: 'Render the current model from ONE angle and return the PNG as a multimodal image. Cheap (one render, ~1500 input tokens next turn). Use when you have a specific suspicion to confirm from a known angle. For general "did this paint land correctly" verification, prefer renderViews — a single angle can hide an error visible from another.',
    input_schema: {
      type: 'object',
      properties: {
        elevation: { type: 'number', description: 'Camera elevation in degrees. 0 = side view, 90 = top. Default 30.' },
        azimuth: { type: 'number', description: 'Camera azimuth in degrees. 0 = front, 90 = right, 180 = back, 270 = left. Default 0.' },
        ortho: { type: 'boolean', description: 'true = orthographic (technical drawing), false = perspective. Default false.' },
        size: { type: 'integer', description: 'Pixel size of the rendered square. Default 320. Larger costs more tokens.' },
        edges: { type: 'string', enum: [...EDGE_MODES], description: 'Edge overlay style. "crease" (default for uncolored models) draws only feature edges — corners and the silhouette — so the shape reads cleanly without facet noise on curves. "none" is a plain shaded surface (best when reading painted colors; the default for painted models). "wireframe" draws every triangle edge — use only to inspect tessellation or debug a failed boolean.' },
      },
    },
  },
  {
    name: 'renderViews',
    description: 'Render MULTIPLE labeled angles as ONE composite PNG. THIS IS HOW YOU SEE YOUR WORK reliably — a single angle can hide an asymmetric error that another angle catches. Costs ~1500-2500 input tokens at the default size. Default `views: "auto"` picks angles by the model\'s bounding box: flat disks get [Top, Iso] (a front elevation of a disk is a useless sliver), tall columns get [Front, Right, Iso] (the top of a column is a useless dot), everything else gets [Front, Top, Iso]. `tri`/`all` force a set; `box` renders all 6 orthographic faces (front/back/left/right/top/bottom) — use it for the FINAL all-faces check, because back/left/bottom are never shown by auto/tri/all and that is exactly where an unseen mistake hides. For total control pass an explicit `angles` list. While iterating keep `size` small (default 320); for the final inspection bump it (512-768) for a sharper read.',
    input_schema: {
      type: 'object',
      properties: {
        views: { type: 'string', enum: [...RENDER_VIEW_MODES], description: '"auto" (default) picks angles from the model aspect ratio. "tri" = front + top + iso (3 cells). "all" = front + right + top + iso (4 cells). "box" = all 6 orthographic faces front/back/left/right/top/bottom (guaranteed all-faces check). Ignored when `angles` is given.' },
        angles: { type: 'array', description: 'Explicit list of camera angles; overrides `views`. Same angle semantics as renderView. Use to put specific suspect angles side-by-side in one composite.', items: { type: 'object', properties: { elevation: { type: 'number', description: '0 = side, 90 = top, -90 = bottom.' }, azimuth: { type: 'number', description: '0 = front, 90 = right, 180 = back, 270 = left.' }, ortho: { type: 'boolean', description: 'true = orthographic. Default false.' }, label: { type: 'string', description: 'Optional caption for the cell.' } }, required: ['elevation', 'azimuth'] } },
        size: { type: 'integer', description: 'Pixel size per cell. Default 320. Raise to 512-768 for a high-resolution final check; larger costs more tokens.' },
        edges: { type: 'string', enum: [...EDGE_MODES], description: 'Edge overlay applied to every tile. "crease" (default for uncolored models) draws only feature edges — corners and silhouette — so shape reads cleanly without facet noise on curves. "none" is a plain shaded surface (best for reading painted colors; default for painted models). "wireframe" draws every triangle edge — use only to inspect tessellation or debug a failed boolean.' },
      },
    },
  },
  {
    name: 'runIsolated',
    description: 'Run code WITHOUT side effects — does not modify the editor, does not save a version, does not affect currentMeshData. Returns {geometryData, thumbnail}; the thumbnail is forwarded back to you as a multimodal image so you can see the result. Use to TEST unfamiliar primitives (revolve axis behavior, hull edge cases, decompose ordering) on a 3-line snippet before committing a full runAndSave. Default thumbnail is a 4-iso composite; pass `view` for a single named angle — top-down (elevation: 90) is the right choice when verifying a feature on a flat face (a smile on a head, a logo on a panel) since iso angles hide top-facing geometry.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to run in the active language. Must return a Manifold (manifold-js) or evaluate to one (SCAD).' },
        view: {
          type: 'object',
          description: 'Optional view spec for a single-angle thumbnail. Same shape as renderView (elevation/azimuth/ortho/size). Omit for the default 4-iso composite.',
          properties: {
            elevation: { type: 'number' },
            azimuth: { type: 'number' },
            ortho: { type: 'boolean' },
            size: { type: 'integer' },
          },
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'paintExplain',
    description: 'Diagnose an existing painted region. Returns {triangleCount, area, bbox, centroid, normalHistogram, thumbnail}. Use after a paint that looks wrong — the histogram tells you which axis the region faces (e.g. zPos: 0.7 means 70% of the surface area faces up), the thumbnail shows the region tinted yellow on the current model. Cheaper and more diagnostic than paint → renderViews → undo. Pass `withImage: false` for stats-only when you only need the histogram.',
    input_schema: {
      type: 'object',
      properties: {
        region: { description: 'Region id (integer, from listRegions) or name (string).' },
        withImage: { type: 'boolean', description: 'Default true. Pass false for stats-only (skip the thumbnail render).' },
      },
      required: ['region'],
    },
  },
  {
    name: 'paintPreview',
    description: 'DRY-RUN: returns {triangleCount, bbox, centroid, totalArea, largestTriangleArea} for what a paint op WOULD select, WITHOUT committing. Same selector args as paintInBox / paintNear / paintFaces. The cheapest way to catch a bad selector — count alone is essentially free; ALWAYS call before any non-trivial paint. The `largestTriangleArea / (totalArea / triangleCount)` ratio is the fan-topology diagnostic: ratios > ~10 mean a long radial triangle is dragging the selection beyond its intended footprint (common with cylinder / revolve meshes) — fix with `coverageMode: "fully_inside"` or a `maxTriangleArea` cap, or refine the mesh before painting. Pass `withImage: true` when the count or area ratio is suspicious — the thumbnail shows the real triangle extents tinted yellow.',
    input_schema: {
      type: 'object',
      properties: {
        box: { type: 'object', description: '{min: [x,y,z], max: [x,y,z]}' },
        point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        radius: { type: 'number' },
        normalCone: { type: 'object', description: 'Optional {axis: [x,y,z], angleDeg: n} to restrict to faces pointing roughly in that direction.' },
        triangleIds: { type: 'array', items: { type: 'integer' }, description: 'Explicit triangle list — mostly for verifying findFaces results.' },
        withImage: { type: 'boolean', description: 'Default false (stats-only, free). Pass true to also return the highlighted thumbnail when the count is surprising or you want a visual sanity check.' },
        coverageMode: { type: 'string', enum: ['centroid', 'fully_inside', 'any_vertex_inside'], description: 'How a triangle is tested for containment. Default "centroid" (cheap, historical). "fully_inside" excludes long radial fan triangles whose centroid is in the selection but whose vertices extend outside — the right choice for painting on cylinder/revolve geometry.' },
        maxTriangleArea: { type: 'number', description: 'Backstop against fan-topology bleed: skip any triangle whose world area exceeds this. Set it ~3-5× the typical triangle area of the feature you intend to paint.' },
      },
    },
  },
  {
    name: 'getSessionContext',
    description: 'Read the current session: notes, version history with labels, current version. Call FIRST when resuming work — gives you what was decided previously.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'listVersions',
    description: 'List versions in the current session: { id, index, label, timestamp, status }.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'loadVersion',
    description: 'Load a previously saved version by index. Updates the editor and viewport. Use to compare against an earlier state.',
    input_schema: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: '1-based version index.' },
      },
      required: ['index'],
    },
  },
  {
    name: 'saveVersion',
    description: 'Snapshot the CURRENT editor code, geometry, color regions, and annotations as a new gallery version WITHOUT re-running the code. Use this to persist a painted/annotated state — unlike runAndSave it does NOT re-execute the code, so it won\'t re-resolve color regions against regenerated triangles (re-running new geometry with colors in memory misaligns them). For committing a code change, prefer runAndSave (runs + validates + saves in one call). Returns {id, index, label} on success, {skipped, reason} when nothing changed since the current version, or {error} if no session is active.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Short label for the gallery version. Defaults to v<index>.' },
      },
    },
  },
  {
    name: 'addSessionNote',
    description: 'Append a durable note to the session log. Notes survive compaction and are visible to future agents. Prefix with one of [REQUIREMENT], [DECISION], [FEEDBACK], [MEASUREMENT], [ATTEMPT], [TODO].',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Note body, prefixed with a tag.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'listSessionNotes',
    description: 'Read all session notes ordered by time. Cheaper than getSessionContext when you only want notes.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'readDoc',
    description: 'Fetch one of the topic-specific docs from /ai/<name>.md. Use this when the core ai.md points you at a subdoc and you need its full content before writing code. Names: curves, bosl2, replicad, sdf, voxel, colors, print-safety, reference-images, file-io, annotations, relief, iteration-workflow, gotchas, visual-verification, spending, manifold-api.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          enum: ['curves', 'bosl2', 'replicad', 'sdf', 'voxel', 'colors', 'print-safety', 'reference-images', 'file-io', 'annotations', 'relief', 'textures'],
          description: 'Subdoc name without the .md extension.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'paintRegion',
    description: 'Paint the coplanar region containing a point with the given color. Best paint primitive when you know exactly where to click.',
    input_schema: {
      type: 'object',
      properties: {
        point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z] world point on the face.' },
        normal: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Optional normal hint to disambiguate at edges.' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[r, g, b] in 0..1.' },
        name: { type: 'string', description: 'Optional human-readable region name.' },
        tolerance: { type: 'number', description: 'Coplanarity angle tolerance in degrees.' },
      },
      required: ['point', 'color'],
    },
  },
  {
    name: 'paintFaces',
    description: 'Paint a specific set of triangle ids. Last-resort primitive — prefer paintInBox / paintNear / paintSlab when the intent is "all faces matching a geometric predicate", because they collapse the find+paint pair into one tool call (saves a full round-trip plus the triangleId payload).',
    input_schema: {
      type: 'object',
      properties: {
        triangleIds: { type: 'array', items: { type: 'integer' } },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        name: { type: 'string' },
      },
      required: ['triangleIds', 'color'],
    },
  },
  {
    name: 'paintNear',
    description: 'Paint every triangle within `radius` of `point` (optionally constrained by a normal cone). One call, no triangleId shuttling. Use for "paint the faces around this corner / nub / boss". Pass `topOnly: true` to skip side walls and the bottom face — the most common over-paint cause. On fan-topology meshes (cylinder/revolve/linear_extrude surfaces), pass `coverageMode: "fully_inside"` and/or `maxTriangleArea` to avoid long radial triangles bleeding paint outside the radius.',
    input_schema: {
      type: 'object',
      properties: {
        point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        radius: { type: 'number' },
        normalCone: { type: 'object', description: 'Optional {axis: [x,y,z], angleDeg: n} to restrict to faces pointing roughly in that direction.' },
        topOnly: { type: 'boolean', description: 'Shortcut for normalCone: {axis: [0,0,1], angleDeg: 30}. Common case: paint only upward-facing faces in the region.' },
        coverageMode: { type: 'string', enum: ['centroid', 'fully_inside', 'any_vertex_inside'], description: 'Triangle containment test. Default "centroid". "fully_inside" requires all 3 vertices within radius — defangs fan-bleed.' },
        maxTriangleArea: { type: 'number', description: 'Skip triangles larger than this. Use to filter out the long radial triangles that cylinder/revolve produce.' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        name: { type: 'string' },
      },
      required: ['point', 'radius', 'color'],
    },
  },
  {
    name: 'paintStroke',
    description: 'Paint a SMOOTH brush stroke along a path of surface points, subdividing the mesh under the stroke so the painted edge is rounded (not stair-stepped along triangle boundaries). This is the only paint tool that changes the tessellation — it is more expensive than the region selectors, so reach for `paintNear`/`paintInBox`/`paintConnected`/`paintRegion` first and use this ONLY when a visibly rounded painted edge matters (e.g. a curved racing stripe, a soft-edged logo patch). Get `points` from `probePixel` against a rendered view (render → pick pixels along the desired stroke → probePixel each → pass the world-space hits here). `radius` is in mesh units. `resolution` sets smoothness (target triangle edge = radius / resolution; higher = smoother + more triangles), default 256, range 2–1024. For absolute control, `maxEdge` overrides it with a target edge length in mesh units (e.g. maxEdge 0.1 for crisp 0.1-unit edges). `shape` is circle (default), square, or diamond.',
    input_schema: {
      type: 'object',
      properties: {
        points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, description: 'Ordered world-space surface points [[x,y,z], ...] along the stroke path (from probePixel). A single point stamps a rounded dot.' },
        radius: { type: 'number', description: 'Brush radius in mesh units (must be > 0).' },
        resolution: { type: 'number', description: 'Smoothness detail: target triangle edge = radius / resolution. Higher = smoother + more triangles. Default 256, clamped 2–1024.' },
        maxEdge: { type: 'number', description: 'Optional absolute override for the target edge length (mesh units). Takes precedence over resolution.' },
        shape: { type: 'string', enum: ['circle', 'square', 'diamond'], description: 'Brush footprint shape. Default "circle".' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        name: { type: 'string' },
      },
      required: ['points', 'radius', 'color'],
    },
  },
  {
    name: 'paintInBox',
    description: 'Paint every triangle whose centroid is inside the axis-aligned box (optionally constrained by a normal cone). One call. Use for "paint the top half / the right rim / everything below z=0". Pass `topOnly: true` to skip side walls and the bottom face — the most common over-paint cause. On fan-topology meshes (cylinder/revolve/linear_extrude surfaces), pass `coverageMode: "fully_inside"` and/or `maxTriangleArea` to avoid long radial triangles bleeding paint outside the box. On BREP-engine solids (replicad language, or a manifold-js session whose return value came through `BREP.toManifold`), OCCT booleans can leave interior intersection-seam triangles inside the bounding volume — the centroid test then catches them and you get patchy paint on a surface that looks solid. Default to `coverageMode: "fully_inside"` on BREP, or use `paintConnected` from a probePixel seed instead.',
    input_schema: {
      type: 'object',
      properties: {
        box: { type: 'object', description: '{min: [x,y,z], max: [x,y,z]}' },
        normalCone: { type: 'object', description: 'Optional {axis: [x,y,z], angleDeg: n}.' },
        topOnly: { type: 'boolean', description: 'Shortcut for normalCone: {axis: [0,0,1], angleDeg: 30}. Common case: paint the top face of a feature without catching its sides.' },
        coverageMode: { type: 'string', enum: ['centroid', 'fully_inside', 'any_vertex_inside'], description: 'Triangle containment test. Default "centroid". "fully_inside" requires all 3 vertices inside the box — defangs fan-bleed.' },
        maxTriangleArea: { type: 'number', description: 'Skip triangles larger than this. Use to filter out the long radial triangles that cylinder/revolve produce.' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        name: { type: 'string' },
      },
      required: ['box', 'color'],
    },
  },
  {
    name: 'paintInOrientedBox',
    description: 'Paint every triangle whose centroid lies inside a rotated oriented bounding box (OBB). Same selector as the UI Box paint tool. Reach for this when paintInBox catches the wrong faces because the feature is at an angle to the world axes — diagonal handles, tilted lids, rotated wings, etc. Defaults to the identity quaternion (no rotation) when `quaternion` is omitted, making it equivalent to paintInBox with the same center+size. The painted edge is SMOOTHED by default — the mesh is subdivided near the box faces so the edge follows the box, not the coarse tessellation. Pass `smooth: false` to keep the blocky edge, or tune `resolution` / `maxEdge`.',
    input_schema: {
      type: 'object',
      properties: {
        box: {
          type: 'object',
          description: '{center: [x,y,z], size: [sx,sy,sz], quaternion?: [x,y,z,w]} — size is the full extent along each box-local axis, not half-extent. Quaternion defaults to identity [0,0,0,1] if omitted.',
          properties: {
            center: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            size: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            quaternion: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
          },
          required: ['center', 'size'],
        },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        name: { type: 'string' },
        smooth: { type: 'boolean', description: 'Smooth the painted edge by subdividing the mesh near the box faces. Default true; pass false for the raw (blocky) tessellation.' },
        resolution: { type: 'number', description: 'Smoothing detail: target boundary edge = model bbox diagonal / resolution. Higher = smoother + more triangles. Default 256, range 2–1024.' },
        maxEdge: { type: 'number', description: 'Optional absolute override for the target boundary edge length (mesh units). Takes precedence over resolution.' },
      },
      required: ['box', 'color'],
    },
  },
  {
    name: 'paintSlab',
    description: 'Paint everything in a Z-slab (or arbitrary-axis slab). One call. Use for "paint the rim of this disk", "paint the side walls", "paint the top 5mm". Same coverageMode / maxTriangleArea options as the other selectors. The two slab edges are SMOOTHED by default — the mesh is subdivided along them so the painted band has clean straight edges across coarse faces. Pass `smooth: false` to keep the blocky edge, or tune `resolution` / `maxEdge`.',
    input_schema: {
      type: 'object',
      properties: {
        axis: { type: 'string', enum: ['x', 'y', 'z'], description: 'Slab axis. Or pass `normal` for an arbitrary direction.' },
        normal: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Use instead of axis for an oblique slab.' },
        offset: { type: 'number', description: 'Slab center along the axis/normal.' },
        thickness: { type: 'number', description: 'Slab thickness (paint catches anything within ±thickness/2 of offset).' },
        coverageMode: { type: 'string', enum: ['centroid', 'fully_inside', 'any_vertex_inside'], description: 'Triangle containment test. Default "centroid". "fully_inside" requires all 3 vertex projections within the slab range.' },
        maxTriangleArea: { type: 'number', description: 'Skip triangles larger than this.' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        name: { type: 'string' },
        smooth: { type: 'boolean', description: 'Smooth the slab edges by subdividing the mesh along them. Default true; pass false for the raw (blocky) tessellation.' },
        resolution: { type: 'number', description: 'Smoothing detail: target boundary edge = model bbox diagonal / resolution. Higher = smoother + more triangles. Default 256, range 2–1024.' },
        maxEdge: { type: 'number', description: 'Optional absolute override for the target boundary edge length (mesh units). Takes precedence over resolution.' },
      },
      required: ['offset', 'thickness', 'color'],
    },
  },
  {
    name: 'paintNearestRegion',
    description: 'Paint the nearest coplanar region to `point` within `searchRadius`. Use when paintRegion fails because the click point landed slightly off a face (common with iso-view coordinates).',
    input_schema: {
      type: 'object',
      properties: {
        point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        searchRadius: { type: 'number', description: 'How far to look for a face. Default ~1.0.' },
        name: { type: 'string' },
      },
      required: ['point', 'color'],
    },
  },
  {
    name: 'findFaces',
    description: 'Search for triangles matching a box / normal / color predicate. Returns { triangleIds, count }. Use ONLY when you need to *inspect* matches first — if you intend to paint them right after, call paintInBox / paintNear / paintSlab directly instead and skip the round-trip.',
    input_schema: {
      type: 'object',
      properties: {
        box: { type: 'object', description: '{min: [x,y,z], max: [x,y,z]}' },
        normal: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        normalTolerance: { type: 'number' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        region: { type: 'string' },
        maxResults: { type: 'integer' },
        coverageMode: { type: 'string', enum: ['centroid', 'fully_inside', 'any_vertex_inside'], description: 'Triangle containment test for the `box` predicate. Default "centroid". Use "fully_inside" on cylinder/revolve meshes to exclude long radial triangles.' },
        maxTriangleArea: { type: 'number', description: 'Skip triangles larger than this.' },
      },
    },
  },
  {
    name: 'undoLastPaint',
    description: 'Undo the SINGLE most recent paint operation. Always prefer this over clearColors when you only need to fix one mistake — clearColors wipes every region and forces you to repaint everything from scratch. The undone region goes onto a redo stack you can recover with redoLastPaint.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'redoLastPaint',
    description: 'Reapply the most recently undone paint operation. Use after an over-eager undoLastPaint.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'listRegions',
    description: 'List every committed color region on the current mesh, in paint order. Each entry: {id, name, color, source, triangles (count), order, visible, bbox, centroid}. Returns [] when nothing is painted. This is the inventory you read to get a region id/name for removeRegion, paintExplain, and assertPaint — sibling of listComponents (mesh pieces) and listLabels (api.label features).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'removeRegion',
    description: 'Remove ONE color region by id (from listRegions). Use to delete a specific mistake when it is not the most recent paint operation — undoLastPaint is faster for the most recent.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Region id from listRegions().' },
      },
      required: ['id'],
    },
  },
  {
    name: 'clearColors',
    description: 'Remove ALL color regions from the current version. Destructive — only use when you want a completely clean slate. To fix a single mistake, call undoLastPaint or removeRegion(id) instead.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'forkVersion',
    description: 'Fork a prior version: load version N, apply new code or patches, validate against optional assertions, and save as a new version — all atomically. Use this to branch off a known-good version without the fragile loadVersion → getCode → modify → runAndSave chain. Provide either `code` (full replacement) or `patches` (find/replace array applied to the parent\'s code — more concise when only a few values change). Each patch\'s `find` MUST occur exactly once in the parent code; a find that matches zero or multiple times is an ERROR (the fork is rejected, not silently saved unchanged), so read the parent code first and copy the exact text including whitespace. Patch matching is whitespace-flexible — if the exact text is not found, a whitespace-normalized match is tried automatically (handles auto-reformatted code). Color regions on the parent are re-applied to the forked geometry automatically (each region\'s descriptor is re-resolved against the new mesh) unless you pass `carryColors: false` — no need to repaint after a geometry tweak. To fork from unsaved editor code: call `saveVersion("checkpoint")` first to commit it, then `forkVersion({index: <that index>}, ...)`. Returns {parent, version, geometry, diff (geometry stats), codeDiff (what actually changed in the source — verify your patch landed here), colors: {carried, dropped}, galleryUrl} on success, or {error} / {passed: false, failures} on failure.',
    input_schema: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: '1-based version index to fork from (from listVersions).' },
        code: { type: 'string', description: 'Full replacement code for the forked version. Provide this or patches, not both.' },
        patches: {
          type: 'array',
          description: 'Find/replace substitutions applied in sequence to the parent version\'s code. More concise than providing the full program when only a few values change. Each `find` must match exactly once or the call errors — include surrounding context to keep it unique.',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'Exact string to find. Must occur exactly once in the (running) code.' },
              replace: { type: 'string', description: 'Replacement string.' },
            },
            required: ['find', 'replace'],
          },
        },
        carryColors: { type: 'boolean', description: 'Re-apply the parent version\'s color regions to the forked geometry. Default true. Pass false for an intentionally uncolored fork.' },
        label: { type: 'string', description: 'Short label for the new version.' },
        assertions: {
          type: 'object',
          description: 'Optional geometry assertions. Version is NOT saved if any assertion fails.',
          properties: {
            isManifold: { type: 'boolean' },
            maxComponents: { type: 'integer' },
            minVolume: { type: 'number' },
            maxVolume: { type: 'number' },
            genus: { type: 'integer' },
            minGenus: { type: 'integer' },
            maxGenus: { type: 'integer' },
            minBounds: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            maxBounds: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            minTriangles: { type: 'integer' },
            maxTriangles: { type: 'integer' },
            boundsRatio: {
              type: 'object',
              properties: {
                widthToDepth: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                widthToHeight: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                depthToHeight: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              },
            },
            notes: { type: 'string' },
          },
        },
      },
      required: ['index'],
    },
  },
  {
    name: 'copyColorsFromVersion',
    description: 'Transfer the color regions from a prior version onto the CURRENT geometry in one call — instead of repainting region by region after a geometry change. Each region\'s geometry-relative descriptor (box / slab / byLabel / coplanar / connectedFromSeed) is re-resolved against the current mesh; regions that no longer resolve (a dropped label, or raw-triangle regions on changed topology) are skipped and listed in `dropped`. Replaces any colors currently on the model. In-memory like any paint op — your next runAndSave serializes the current regions, so they persist with it. (forkVersion already carries colors automatically; reach for this after a runAndSave when you rebuilt geometry that matches an earlier painted version.) Returns {source, carried, dropped}.',
    input_schema: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: '1-based version index to copy colors from (from listVersions).' },
      },
      required: ['index'],
    },
  },
  {
    name: 'runAndAssert',
    description: 'Run code and check geometry assertions WITHOUT saving a version. Returns {passed, failures?, stats}. Use for "does this code produce valid geometry?" checks before committing with runAndSave.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to run.' },
        assertions: {
          type: 'object',
          description: 'Geometry assertions to check.',
          properties: {
            isManifold: { type: 'boolean' },
            maxComponents: { type: 'integer' },
            minVolume: { type: 'number' },
            maxVolume: { type: 'number' },
            genus: { type: 'integer' },
            minGenus: { type: 'integer' },
            maxGenus: { type: 'integer' },
            minBounds: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            maxBounds: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            minTriangles: { type: 'integer' },
            maxTriangles: { type: 'integer' },
            boundsRatio: {
              type: 'object',
              properties: {
                widthToDepth: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                widthToHeight: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                depthToHeight: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              },
            },
            notes: { type: 'string' },
          },
        },
      },
      required: ['code', 'assertions'],
    },
  },
  {
    name: 'runAndExplain',
    description: 'Run code in isolation and decompose the result into its boolean-distinct components — the diagnostic to reach for when getGeometryData reports componentCount > 1 and you need to know WHICH pieces failed to union. Does NOT save a version or touch the editor/viewport. Returns {stats, components, hints?, containmentWarnings?}: `components` is the per-piece breakdown ({index, volume, surfaceArea, centroid, boundingBox}, or null when the result is a single component), `hints` names the main body vs. tiny floaters and which face/axis a floater sits on with a concrete .translate() overlap suggestion, and `containmentWarnings` flags pieces fully hidden inside another (geometrically invisible). Turns a failed union into an actionable fix instead of guessing coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to run in the active language. Must return a Manifold (manifold-js) or evaluate to one (SCAD).' },
      },
      required: ['code'],
    },
  },
  {
    name: 'query',
    description: 'Multi-query the current geometry in one call. Pass any combination of sliceAt (cross-section areas at given Z heights), decompose (component breakdown), boundingBox. Returns only the keys you asked for. Cheaper than separate calls. Returns `stale: true` in both the top-level result and `stats` when the editor code changed since the last run — geometry reflects the previous execution.',
    input_schema: {
      type: 'object',
      properties: {
        sliceAt: { type: 'array', items: { type: 'number' }, description: 'Z heights to slice at.' },
        decompose: { type: 'boolean', description: 'Include component breakdown.' },
        boundingBox: { type: 'boolean', description: 'Include bounding box.' },
      },
    },
  },
  {
    name: 'modifyAndTest',
    description: 'Apply string substitution(s) to the current editor code, run the result, and return stats — WITHOUT saving a version or changing the editor. Use to test a tweak before committing. Provide either a single `find`/`replace` pair or a `patches` array for multiple simultaneous substitutions; each `find` must match exactly once or the call errors (no silent no-op). Returns {modifiedCode, codeDiff: {changed, added, removed, diff}, stats, passed?, failures?} — check codeDiff.changed to confirm the tweak actually altered the code.',
    input_schema: {
      type: 'object',
      properties: {
        find: { type: 'string', description: 'Exact string to find in current code. Use this for a single substitution.' },
        replace: { type: 'string', description: 'Replacement string (paired with find).' },
        patches: {
          type: 'array',
          description: 'Multiple find/replace pairs applied in sequence. Use when adjusting several parameters at once.',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'Exact string to find.' },
              replace: { type: 'string', description: 'Replacement string.' },
            },
            required: ['find', 'replace'],
          },
        },
        assertions: {
          type: 'object',
          description: 'Optional geometry assertions.',
          properties: {
            isManifold: { type: 'boolean' },
            maxComponents: { type: 'integer' },
            minVolume: { type: 'number' },
            maxVolume: { type: 'number' },
            genus: { type: 'integer' },
            minGenus: { type: 'integer' },
            maxGenus: { type: 'integer' },
            minBounds: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            maxBounds: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            minTriangles: { type: 'integer' },
            maxTriangles: { type: 'integer' },
            boundsRatio: {
              type: 'object',
              properties: {
                widthToDepth: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                widthToHeight: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                depthToHeight: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              },
            },
            notes: { type: 'string' },
          },
        },
      },
      required: [],
    },
  },
  {
    name: 'probeRay',
    description: 'Cast a ray from `origin` in `direction` and return mesh intersection hits: [{point, normal, distance, triangleId}]. Use to find exact surface coordinates and normals when you know the ray but not the pixel. Pairs well with paintRegion (feed hit.point + hit.normal as seed).',
    input_schema: {
      type: 'object',
      properties: {
        origin: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Ray origin in world space [x,y,z].' },
        direction: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Ray direction (need not be normalized).' },
      },
      required: ['origin', 'direction'],
    },
  },
  {
    name: 'listParts',
    description: 'List the parts in the active session: [{id, name, order, isCurrent}]. A session can hold multiple parts — independent objects, each with its own code and version history. The current part is what runCode / runAndSave / paint / export act on.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getCurrentPart',
    description: 'Return the active part {id, name, order}, or null when no session is open.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'createPart',
    description: 'Create a new, empty part in the active session and switch to it. The editor resets to a starter snippet; call runAndSave to commit its first version. Use to model a second (third, …) object in the same session.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Optional part name (e.g. "Lid"). Auto-named "Part N" when omitted.' },
      },
    },
  },
  {
    name: 'changePart',
    description: "Switch the active part. Pass the part id from listParts(). Loads that part's latest version into the editor/viewport; all later code, paint, and version operations act on it.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Part id from listParts().' },
      },
      required: ['id'],
    },
  },
  {
    name: 'renamePart',
    description: 'Rename a part. Pass its id (from listParts) and the new name.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Part id from listParts().' },
        name: { type: 'string', description: 'New part name.' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'deletePart',
    description: "Delete a part and all its versions. Refuses to delete a session's last remaining part. If the active part is deleted, an adjacent part becomes active.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Part id from listParts().' },
      },
      required: ['id'],
    },
  },
  {
    name: 'assertPaint',
    description: 'Verify a painted region matches expected geometry. Returns {passed, failures?}. Use after painting to catch regressions when the mesh changes. `region` is the region id (integer) or name (string) from listRegions().',
    input_schema: {
      type: 'object',
      properties: {
        region: { description: 'Region id (integer) or name (string) from listRegions().' },
        expectedTriangleCount: { description: 'Exact integer or {min?, max?} object.' },
        expectedBoundingBox: {
          type: 'object',
          description: 'Object with any subset of axis keys {x?, y?, z?} each [min, max].',
          properties: {
            x: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
            y: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
            z: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          },
        },
        expectedCentroid: {
          type: 'object',
          description: 'Object with any subset of axis keys {x?, y?, z?} each [min, max].',
          properties: {
            x: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
            y: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
            z: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          },
        },
      },
      required: ['region'],
    },
  },
  {
    name: 'sliceAtZVisual',
    description: 'Cross-section at height z. Returns a rasterized PNG thumbnail of the profile (attached as an image) plus {area, contours} — area is the cross-sectional area, contours is the count of closed loops (1 = solid, >1 = hollow or multi-piece). Use to visually inspect wall thickness, hollow interiors, or layer profiles — you can actually see the cross-section shape.',
    input_schema: {
      type: 'object',
      properties: {
        z: { type: 'number', description: 'Height at which to slice.' },
      },
      required: ['z'],
    },
  },
  {
    name: 'paintInCylinder',
    description: 'Paint triangles whose centroids fall within a cylindrical shell: rMin ≤ dist(centroid, axis) ≤ rMax AND zMin ≤ centroid.z ≤ zMax. The canonical tool for inner walls of hollow cylinders, mugs, vases, and any revolved shape where paintInBox catches too many faces. Set rMin > 0 to exclude the axis core; set rMax to the inner radius to select only the inner surface. Optional normalCone/topOnly for further filtering.',
    input_schema: {
      type: 'object',
      properties: {
        center: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
          description: 'Center of the cylinder axis in the XY plane [cx, cy]. Use [0, 0] for Z-centered models.',
        },
        rMin: { type: 'number', description: 'Minimum radial distance from axis (0 to include everything up to rMax).' },
        rMax: { type: 'number', description: 'Maximum radial distance from axis.' },
        zMin: { type: 'number', description: 'Bottom of the cylindrical band.' },
        zMax: { type: 'number', description: 'Top of the cylindrical band.' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[r, g, b] in 0..1.' },
        name: { type: 'string', description: 'Optional region name.' },
        normalCone: {
          type: 'object',
          description: 'Further restrict to triangles whose normal is within angleDeg of the given axis.',
          properties: {
            axis: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            angleDeg: { type: 'number' },
          },
          required: ['axis', 'angleDeg'],
        },
        topOnly: { type: 'boolean', description: 'Shortcut: only upward-facing triangles (normal within 30° of +Z).' },
        coverageMode: {
          type: 'string',
          enum: ['centroid', 'fully_inside', 'any_vertex_inside'],
          description: 'centroid (default): centroid inside the shell. fully_inside: all 3 vertices inside. any_vertex_inside: at least 1 vertex inside.',
        },
        maxTriangleArea: { type: 'number', description: 'Skip triangles larger than this area. Use to avoid fan-bleed on cylinder topology.' },
      },
      required: ['rMin', 'rMax', 'zMin', 'zMax', 'color'],
    },
  },
  {
    name: 'importImageAsRelief',
    description: 'Generate a colour-printable Part from a raster image. REQUIRES USER CONFIRMATION — only call when the user has explicitly asked to import an image. By default produces a FLAT colour tile (keychain-style — paint regions on a thin tile, AMS-friendly). Pass quantized.output="silhouette" to cut the tile to the image\'s subject outline (background removed), or quantized.output="relief" for a stepped-height relief (each cluster gets its own Z layer). Pass mode="luminance" for a tonal embossment with no colour clusters. `src` is a data: or http(s) image URL. After creation, paint, then read getReliefSwapGuide() for the single-nozzle swap plan if relevant.',
    input_schema: {
      type: 'object',
      properties: {
        src: { type: 'string', description: 'Image data: URL or http(s) URL.' },
        mode: { type: 'string', enum: ['luminance', 'quantized', 'ai'], description: 'Image→geometry mapping. "luminance" is a heightmap relief. "quantized" produces a coloured tile (see quantized.output). Default quantized.' },
        options: {
          type: 'object',
          description: 'Common relief knobs to override.',
          properties: {
            widthMm: { type: 'number' },
            layerHeight: { type: 'number' },
            baseThickness: { type: 'number' },
            maxHeight: { type: 'number' },
            resolution: { type: 'integer', description: 'Max grid columns (<=512).' },
            smoothing: { type: 'number' },
          },
        },
        quantized: {
          type: 'object',
          description: 'Quantized-mode + tile overrides. Only used when mode is "quantized" (or "ai").',
          properties: {
            clusters: { type: 'integer', description: 'Number of colour clusters (2..12). Default 5.' },
            colorSpace: { type: 'string', enum: ['rgb', 'lab'], description: 'Clustering colour space. Lab is perceptual (default).' },
            dither: { type: 'boolean', description: 'Floyd–Steinberg dithering at cluster boundaries.' },
            output: { type: 'string', enum: ['flat', 'silhouette', 'relief'], description: '"flat" (default) = flat colour tile (keychain). "silhouette" = flat tile cut to the image subject (background removed). "relief" = stepped relief — each cluster gets its own Z layer.' },
            paintingMode: { type: 'string', enum: ['multi-color', 'single-nozzle'], description: 'Stepped-relief painting mode. Both values produce the SAME per-cluster relief geometry (a continuous quantized-height relief); this only gates single-nozzle printability validation, not the mesh. "multi-color" (default) skips the check (AMS / multi-material). "single-nozzle" runs the swap-guide layer-fit check that verifies each colour can be reproduced by horizontal filament swaps.' },
            shape: { type: 'string', enum: ['rect', 'rounded', 'circle'], description: 'Tile outline for flat mode. Default "rect".' },
            cornerRadiusMm: { type: 'number', description: 'Corner radius for "rounded" shape, mm.' },
            chamferMm: { type: 'number', description: 'Top-edge chamfer / bevel depth, mm. 0 = sharp. Up to ~2 mm.' },
            holes: {
              type: 'array',
              description: 'Zero or more circular keychain holes. Centre coords are mm with (0,0) at the tile centre and +Y toward the top edge.',
              items: {
                type: 'object',
                properties: {
                  cxMm: { type: 'number' },
                  cyMm: { type: 'number' },
                  diameterMm: { type: 'number' },
                },
                required: ['cxMm', 'cyMm', 'diameterMm'],
              },
            },
          },
        },
      },
      required: ['src'],
    },
  },
  {
    name: 'importSvgAsRelief',
    description: 'Generate a multi-colour tile Part from raw SVG text. REQUIRES USER CONFIRMATION — only call when the user has explicitly asked to import an SVG. Each `<path fill>` becomes one seed colour region with CRISP boundaries — no k-means clustering, so the SVG\'s exact colours and shapes are preserved. Vastly better than importImageAsRelief for vector logos, icons, and illustrations. Tile geometry knobs (output/shape/hole) work the same as importImageAsRelief; default output is "silhouette" so the tile takes the SVG\'s overall outline.',
    input_schema: {
      type: 'object',
      properties: {
        svgText: { type: 'string', description: 'Raw SVG source text (including the <svg>...</svg> root).' },
        options: {
          type: 'object',
          properties: {
            widthMm: { type: 'number' },
            layerHeight: { type: 'number' },
            baseThickness: { type: 'number' },
            maxHeight: { type: 'number' },
            resolution: { type: 'integer', description: 'Max grid columns (<=512). Higher = crisper.' },
            smoothing: { type: 'number' },
          },
        },
        quantized: {
          type: 'object',
          description: 'Tile overrides (the SVG path doesn\'t cluster — fields like clusters/dither are ignored here).',
          properties: {
            output: { type: 'string', enum: ['flat', 'silhouette'], description: 'Default "silhouette" — uses the SVG outline as the tile shape.' },
            shape: { type: 'string', enum: ['rect', 'rounded', 'circle'] },
            cornerRadiusMm: { type: 'number' },
            chamferMm: { type: 'number', description: 'Top-edge chamfer depth, mm. 0 = sharp.' },
            holes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  cxMm: { type: 'number' },
                  cyMm: { type: 'number' },
                  diameterMm: { type: 'number' },
                },
                required: ['cxMm', 'cyMm', 'diameterMm'],
              },
            },
          },
        },
      },
      required: ['svgText'],
    },
  },
  {
    name: 'getReliefSwapGuide',
    description: 'Return the advisory single-nozzle filament-swap guide for the current relief: ordered swaps {atLayer, atZ, color, filamentName?}, derived height bands, totals, a printability score (0..1), and warnings where horizontal color variation cannot be reproduced on a single nozzle (use AMS or constrain paint to Z-slabs there). Reflects the current painting — call after painting.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'setReliefPreviewMode',
    description: 'Switch the relief optical preview: "flat" (raw paint), "ams" (glossy filament look), or "single-nozzle" (simulates light through the translucent layer stack — what a single-nozzle swap print would look like). Affects what renderView/renderViews show, so set "single-nozzle" before rendering to self-check a stepped-relief print.',
    input_schema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['flat', 'ams', 'single-nozzle'] } },
      required: ['mode'],
    },
  },
  {
    name: 'applyFuzzySkin',
    description: `Apply a fuzzy-skin surface texture to the current model — a 3D-printing finish that roughens the surface with fine, irregular noise displacement along per-vertex normals. Saves a new version.

**When to use:** After the geometry is final, before or after paint. Paint is carried through subdivision automatically (preserveColor: true) — region descriptors (coplanar/slab/label) re-resolve against the denser mesh; raw triangle-id regions survive as nearest-triangle transfers.

**Parameters:** amplitude = peak outward displacement (world units; start at ~1% of model diagonal); scale = characteristic feature size (smaller → finer fuzz; ~4% of diagonal is a good default); octaves = 1–5 fractal layers (more → busier surface; default 2); seed = reproducibility.

**Return:** { ok, label, geometry, colorsCarried, warnings? }. warnings is an array of strings — always check it. Typical warnings: amplitude-too-large (try ≤ 5% of diagonal), scale-too-small/too-large, color-transfer-low-coverage (repaint those areas or use copyColorsFromVersion).

**Workflow guidance:** call renderViews after to verify the texture. For fine-tuning: apply → render → undo (loadVersion to the prior version) → re-apply with adjusted params.`,
    input_schema: {
      type: 'object',
      properties: {
        amplitude: {
          type: 'number',
          description: 'Peak displacement in world units. Default: ~1% of model diagonal. Keep ≤ 5% to avoid manifold artifacts.',
        },
        scale: {
          type: 'number',
          description: 'Characteristic feature size in world units (smaller = finer fuzz). Default ~4% of diagonal.',
        },
        octaves: {
          type: 'integer',
          description: 'Fractal octaves 1–5 (more = busier/noisier surface). Default 2.',
          minimum: 1,
          maximum: 5,
        },
        seed: {
          type: 'integer',
          description: 'Deterministic seed. Different seeds produce different patterns with identical parameters. Default 1.',
        },
        quality: {
          type: 'integer',
          description: 'Mesh detail 1 (draft, ~4× fewer triangles) to 5 (ultra, ~4× more). Default 3. Higher = smoother displacement curves, longer compute. Use 4–5 for final renders, 1–2 for quick iteration.',
          minimum: 1,
          maximum: 5,
        },
        preserveColor: {
          type: 'boolean',
          description: 'Carry existing paint regions onto the retessellated mesh. Default true. Pass false for an intentionally clean-slate texture.',
        },
      },
    },
  },
  {
    name: 'applyKnitTexture',
    description: `Apply a knit-stitch surface texture — a repeating brick-offset V-pattern mimicking hand-knitted fabric (stockinette stitch). Each stitch is a smooth raised bump arranged in alternating rows whose horizontal offset creates the characteristic interlocking V shapes.

**When to use:** After the geometry is final; works best on organic and rounded models. Paint is carried through subdivision automatically (preserveColor: true).

**Key parameters:**
- amplitude: peak bump height (world units; ~3% of diagonal is a good start)
- stitchWidth: width of one stitch (horizontal repeat; ~5% of diagonal)
- stitchHeight: height of one stitch (default stitchWidth × 1.4 — stitches are taller than wide)
- rowOffset: brick pattern offset in [0,1] (default 0.5 = classic half-stitch)
- roundness: 0 = sharp V-ridges (heavy column contrast), 1 = soft round bumps (default 0.5)
- grainAngleDeg: rotate the knit grain in the XY plane (default 0 = stitches run up Z)
- variation: per-stitch amplitude jitter 0–1 (default 0.1 for organic handmade feel)
- seed: deterministic seed for per-stitch variation

**Return:** { ok, label, geometry, colorsCarried, warnings? }. warnings is an array of strings — always check it. Typical warnings: amplitude-too-large, stitchWidth/Height too large (too few stitches visible) or too small (invisible), color-transfer-low-coverage.

**Workflow guidance:** Start with default parameters, render to verify, then tune. A coarser stitchWidth (10–20% of diagonal) gives a chunky knit look; finer (3–6%) gives a tight knit. For sweater-like geometry, grainAngleDeg=0 (stitches vertical) is typical.`,
    input_schema: {
      type: 'object',
      properties: {
        amplitude: {
          type: 'number',
          description: 'Peak displacement in world units. Default ~3% of model diagonal. Keep ≤ 5% to avoid manifold artifacts.',
        },
        stitchWidth: {
          type: 'number',
          description: 'Horizontal stitch repeat in world units. Default ~5% of diagonal. Larger = chunkier knit.',
        },
        stitchHeight: {
          type: 'number',
          description: 'Vertical stitch repeat in world units. Default stitchWidth × 1.4 (stitches taller than wide).',
        },
        rowOffset: {
          type: 'number',
          description: 'Brick-pattern horizontal offset for alternating rows as a fraction [0, 1]. Default 0.5 (half-stitch, classic stockinette).',
          minimum: 0,
          maximum: 1,
        },
        roundness: {
          type: 'number',
          description: 'Blend from sharp V-ridges (0) to soft circular bumps (1). Default 0.5.',
          minimum: 0,
          maximum: 1,
        },
        grainAngleDeg: {
          type: 'number',
          description: 'Rotate the knit grain in the XY plane, degrees. 0 = stitches run up the Z axis (default, natural for standing models). 90 = stitches run left–right.',
        },
        variation: {
          type: 'number',
          description: 'Per-stitch amplitude variation 0–1. 0.1 = each stitch varies by ±10% for an organic handmade feel (default). 0 = perfectly uniform machine-knit look.',
          minimum: 0,
          maximum: 1,
        },
        seed: {
          type: 'integer',
          description: 'Deterministic seed for per-stitch variation. Default 1.',
        },
        quality: {
          type: 'integer',
          description: 'Mesh detail 1 (draft) to 5 (ultra). Default 3. Higher = smoother stitch curves.',
          minimum: 1,
          maximum: 5,
        },
        preserveColor: {
          type: 'boolean',
          description: 'Carry existing paint regions onto the retessellated mesh. Default true. Pass false for an intentionally unpainted result.',
        },
      },
    },
  },
  {
    name: 'applyCableKnit',
    description: `Apply a cable-knit surface texture — pairs of Gaussian ply ridges that cross sinusoidally within each cable column, mimicking traditional rope-like cable knit fabric. Saves a new version.

**When to use:** After the geometry is final; ideal for sweaters, hats, and organic shapes. Paint is carried through subdivision automatically (preserveColor: true).

**Key parameters:**
- amplitude: peak ply-ridge height (~3% of diagonal is a good start)
- cableWidth: width of one cable column (~8% of diagonal)
- cablePitch: distance between twist repeats along the column (default cableWidth × 2.5)
- plyWidth: width of each individual ply ridge (default cableWidth × 0.3)
- grainAngleDeg: rotate the cable grain in the XY plane (default 0 = cables run up Z)
- variation: per-cable jitter 0–1 (default 0.08)
- seed: deterministic seed for variation

**Return:** { ok, label, geometry, colorsCarried, warnings? }. warnings is an array of strings — always check it. Typical warnings: amplitude-too-large, cableWidth too large (too few cables visible).

**Workflow guidance:** Start with defaults. A wider cableWidth (15–25% of diagonal) gives bold Aran-style cables; narrower (5–8%) gives a fine twisted-rope look. Pair with knit background by layering.`,
    input_schema: {
      type: 'object',
      properties: {
        amplitude: {
          type: 'number',
          description: 'Peak ply-ridge displacement in world units. Default ~3% of model diagonal.',
        },
        cableWidth: {
          type: 'number',
          description: 'Width of one cable column in world units. Default ~8% of diagonal.',
        },
        cablePitch: {
          type: 'number',
          description: 'Length of one twist repeat along the column. Default cableWidth × 2.5.',
        },
        plyWidth: {
          type: 'number',
          description: 'Width of each individual ply ridge. Default cableWidth × 0.3.',
        },
        grainAngleDeg: {
          type: 'number',
          description: 'Rotate cable columns in the XY plane, degrees. 0 = cables run up Z (default).',
        },
        variation: {
          type: 'number',
          description: 'Per-cable amplitude jitter 0–1. Default 0.08.',
          minimum: 0,
          maximum: 1,
        },
        seed: {
          type: 'integer',
          description: 'Deterministic seed for per-cable variation. Default 1.',
        },
        quality: {
          type: 'integer',
          description: 'Mesh detail 1 (draft) to 5 (ultra). Default 3. Higher = smoother ply ridges.',
          minimum: 1,
          maximum: 5,
        },
        preserveColor: {
          type: 'boolean',
          description: 'Carry existing paint onto the retessellated mesh. Default true.',
        },
      },
    },
  },
  {
    name: 'applyWaffleStitch',
    description: `Apply a waffle-stitch surface texture — a regular grid of recessed cells with raised border ridges, producing the classic waffle-knit or waffle-iron look. Set rowOffset=0.5 for a honeycomb/brick variant. Saves a new version.

**When to use:** After geometry is final. Works well on flat-ish or gently curved surfaces; the grid pattern reads clearly on large, low-curvature areas. Paint is carried automatically.

**Key parameters:**
- amplitude: height of the raised border (~2.5% of diagonal is a good start)
- cellWidth: width of one cell (~6% of diagonal)
- cellHeight: height of one cell (default cellWidth for square cells)
- sharpness: 1 = soft rounded borders, 3–5 = crisp waffle, 8+ = very thin crisp border (default 3)
- rowOffset: 0 = straight grid (waffle, default); 0.5 = honeycomb offset; any value [0,1] shifts alternate rows
- grainAngleDeg: rotate the grid in the XY plane (default 0)

**Return:** { ok, label, geometry, colorsCarried, warnings? }. Typical warnings: amplitude-too-large, cellWidth out of range.

**Workflow guidance:** Increase sharpness for a more defined waffle. Use rowOffset=0.5 for a diamond/honeycomb pattern. Try cellWidth = 10–15% of diagonal for a chunky waffle blanket look.`,
    input_schema: {
      type: 'object',
      properties: {
        amplitude: {
          type: 'number',
          description: 'Peak border height in world units. Default ~2.5% of model diagonal.',
        },
        cellWidth: {
          type: 'number',
          description: 'Width of one waffle cell in world units. Default ~6% of diagonal.',
        },
        cellHeight: {
          type: 'number',
          description: 'Height of one waffle cell in world units. Default cellWidth (square cells).',
        },
        sharpness: {
          type: 'number',
          description: 'Controls border width vs. cell recess. 1 = soft rounded, 3 = crisp waffle (default), 8+ = very thin crisp border.',
          minimum: 1,
        },
        rowOffset: {
          type: 'number',
          description: 'Alternating-row horizontal offset as a fraction [0, 1]. 0 = straight grid (default). 0.5 = honeycomb offset.',
          minimum: 0,
          maximum: 1,
        },
        grainAngleDeg: {
          type: 'number',
          description: 'Rotate the cell grid in the XY plane, degrees. Default 0.',
        },
        seed: {
          type: 'integer',
          description: 'Deterministic seed (reserved for future variation). Default 1.',
        },
        quality: {
          type: 'integer',
          description: 'Mesh detail 1 (draft) to 5 (ultra). Default 3. Higher = crisper cell borders.',
          minimum: 1,
          maximum: 5,
        },
        preserveColor: {
          type: 'boolean',
          description: 'Carry existing paint onto the retessellated mesh. Default true.',
        },
      },
    },
  },
  {
    name: 'applyFurVelvet',
    description: `Apply a fur/velvet surface texture — directional pile using anisotropic FBM noise. Simulates velvet, velour, short fur, or chenille: the noise is sampled at fine scale perpendicular to the grain (creating individual fibers) and coarse scale along the grain (smooth fiber length). Saves a new version.

**When to use:** After geometry is final. Works best on soft, organic forms. Paint is carried automatically.

**Key parameters:**
- amplitude: pile height (~2.5% of diagonal)
- fiberSpacing: cross-grain repeat (individual fiber width; ~2% of diagonal for fine velvet, ~4% for shaggy fur)
- fiberLength: along-grain scale (default fiberSpacing × 6 — fibers are 6× longer than wide)
- octaves: fractal detail layers 1–4 (2 = default for fine sub-fiber detail)
- grainAngleDeg: rotate the fiber direction in the XY plane (default 0 = fibers run up Z)
- seed: deterministic seed for the noise pattern

**Return:** { ok, label, geometry, colorsCarried, warnings? }. Typical warnings: amplitude-too-large, fiberSpacing out of range.

**Workflow guidance:** Smaller fiberSpacing = denser, finer velvet. Larger = coarser fur. Adjust grainAngleDeg to match the model's natural grain direction. Pair with paint to simulate different colored fur patches.`,
    input_schema: {
      type: 'object',
      properties: {
        amplitude: {
          type: 'number',
          description: 'Pile height in world units. Default ~2.5% of model diagonal.',
        },
        fiberSpacing: {
          type: 'number',
          description: 'Cross-grain fiber spacing in world units. Default ~2% of diagonal. Smaller = finer velvet; larger = shaggy fur.',
        },
        fiberLength: {
          type: 'number',
          description: 'Along-grain scale (fiber length). Default fiberSpacing × 6.',
        },
        octaves: {
          type: 'integer',
          description: 'Fractal octaves 1–4. More = finer sub-fiber detail. Default 2.',
          minimum: 1,
          maximum: 4,
        },
        grainAngleDeg: {
          type: 'number',
          description: 'Rotate the fiber grain in the XY plane, degrees. Default 0 = fibers run up Z.',
        },
        seed: {
          type: 'integer',
          description: 'Deterministic noise seed. Default 1.',
        },
        quality: {
          type: 'integer',
          description: 'Mesh detail 1 (draft) to 5 (ultra). Default 3. Higher = finer fiber strands.',
          minimum: 1,
          maximum: 5,
        },
        preserveColor: {
          type: 'boolean',
          description: 'Carry existing paint onto the retessellated mesh. Default true.',
        },
      },
    },
  },
  {
    name: 'applyWovenFabric',
    description: `Apply a woven-fabric surface texture — a plain-weave interlacing pattern where warp and weft threads alternate over/under at each crossing, producing the characteristic checker-board weave. Saves a new version.

**When to use:** After geometry is final. Looks great on cloth-like forms (bags, cushions, baskets). Paint is carried automatically.

**Key parameters:**
- amplitude: peak thread height (~2% of diagonal)
- threadSpacing: distance between thread center-lines (the weave cell size; ~4% of diagonal)
- threadWidth: width of each thread bump as fraction of spacing [0.1–0.9] (default 0.4)
- underDepth: how much the under-thread is recessed [0–1] (0 = flat valleys; 0.3 = subtle dip, default; 1 = deep recess)
- grainAngleDeg: rotate the weave in the XY plane (default 0 = warp runs up Z)
- seed: deterministic seed

**Return:** { ok, label, geometry, colorsCarried, warnings? }. Typical warnings: amplitude-too-large, threadSpacing out of range.

**Workflow guidance:** threadWidth 0.4 = loose weave with visible gaps; 0.7 = tight weave; 0.9 = nearly closed. Increase underDepth for a more pronounced over-under contrast.`,
    input_schema: {
      type: 'object',
      properties: {
        amplitude: {
          type: 'number',
          description: 'Peak thread displacement in world units. Default ~2% of model diagonal.',
        },
        threadSpacing: {
          type: 'number',
          description: 'Distance between thread center-lines in world units (weave cell size). Default ~4% of diagonal.',
        },
        threadWidth: {
          type: 'number',
          description: 'Width of each thread bump as a fraction of threadSpacing [0.1–0.9]. 0.4 = default (open weave); 0.7 = tight weave.',
          minimum: 0.1,
          maximum: 0.9,
        },
        underDepth: {
          type: 'number',
          description: 'How much the under-thread is depressed relative to amplitude [0–1]. 0 = flat valleys; 0.3 = subtle dip (default); 1 = deep recess.',
          minimum: 0,
          maximum: 1,
        },
        grainAngleDeg: {
          type: 'number',
          description: 'Rotate the weave in the XY plane, degrees. Default 0 = warp runs up Z.',
        },
        seed: {
          type: 'integer',
          description: 'Deterministic seed. Default 1.',
        },
        quality: {
          type: 'integer',
          description: 'Mesh detail 1 (draft) to 5 (ultra). Default 3. Higher = finer thread definition.',
          minimum: 1,
          maximum: 5,
        },
        preserveColor: {
          type: 'boolean',
          description: 'Carry existing paint onto the retessellated mesh. Default true.',
        },
      },
    },
  },
  {
    name: 'finish',
    description: 'Signal that the user\'s request is fully complete and you have nothing left to do. This ENDS your turn. Auto-continue is on: if you stop WITHOUT calling finish, you will be automatically resumed to keep working — so never end with a plain "all done" message; call finish instead. Call it once, only when the task is genuinely complete and verified. Optionally include a one-line summary of what you accomplished.',
    input_schema: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'Optional one-line summary of the completed work.' } },
    },
  },
];

const ALWAYS_AVAILABLE = new Set([
  'getActiveLanguage',
  'setActiveLanguage',
  'getCode',
  'setCode',
  'getParams',
  'getGeometryData',
  'getMeshSummary',
  'getFeatureCentroids',
  'getSessionContext',
  'listVersions',
  // loadVersion is intentionally NOT here — it's listed in SAVE_GATED so
  // the model can't rewind state when the user has paused commits.
  // addSessionNote is intentionally NOT here — it's NOTES_GATED so the budget
  // can stop the model from spending a tool round-trip on notes the chat
  // transcript already records.
  'listSessionNotes',
  // getShareLink is intentionally NOT a chat tool. The encoded share URL is
  // enormous, so returning it as a tool result would dump the whole design into
  // the model's context for no benefit — the in-app user just clicks the toolbar
  // Share button (↗). The capability lives on window.partwright.getShareLink()
  // for EXTERNAL agents (no toolbar to click); see public/ai.md.
  'readDoc',
  'findFaces',
  'listComponents',
  'listLabels',
  // listRegions is a pure read, not a paint mutation, so it stays always-on
  // even when paintFaces is disabled — its consumers paintExplain/assertPaint
  // are always-available and need a region id to target.
  'listRegions',
  'probePixel',
  'paintPreview',
  'paintExplain',
  'forkVersion',
  'runAndAssert',
  'runAndExplain',
  'query',
  'modifyAndTest',
  'probeRay',
  'listParts',
  'getCurrentPart',
  'createPart',
  'changePart',
  'renamePart',
  'deletePart',
  'assertPaint',
  'sliceAtZVisual',
  'paintInCylinder',
  'importImageAsRelief',
  'importSvgAsRelief',
  'getReliefSwapGuide',
  'setReliefPreviewMode',
]);

/** Tools that require explicit user confirmation before executing.
 *  The UI shows a blocking prompt and the model receives an error if declined. */
export const CONFIRM_REQUIRED_TOOLS = new Set([
  'importImageAsRelief',
  'importSvgAsRelief',
]);

const RUN_GATED = new Set(['runCode', 'setParams']);
const SAVE_GATED = new Set(['runAndSave', 'loadVersion', 'saveVersion', 'applyFuzzySkin', 'applyKnitTexture', 'applyCableKnit', 'applyWaffleStitch', 'applyFurVelvet', 'applyWovenFabric']);
const PAINT_GATED = new Set(['paintRegion', 'paintFaces', 'paintNear', 'paintStroke', 'paintInBox', 'paintInOrientedBox', 'paintSlab', 'paintNearestRegion', 'paintComponent', 'paintByLabel', 'paintByLabels', 'paintConnected', 'undoLastPaint', 'redoLastPaint', 'removeRegion', 'clearColors', 'copyColorsFromVersion']);
/** Tools that ship a PNG back to the model via a multimodal content
 *  block. Gated by the Views vision toggle so the user can disable
 *  vision spend in one place — when off, the agent has to reason from
 *  code + stats alone. runIsolated is here because its primary value is
 *  the thumbnail; without vision it degrades to just the stats. */
const VIEWS_GATED = new Set(['renderView', 'renderViews', 'runIsolated']);
// `finish` only exists in auto-continue mode — it's the sentinel the model
// calls to end a turn (otherwise the loop resumes it). Off-mode never offers
// it, so off-mode behavior is unchanged.
const AUTORESUME_GATED = new Set(['finish']);
/** Gated by the Session-notes scope toggle. When off, the budget keeps the
 *  model from spending a tool round-trip writing notes the chat already holds. */
const NOTES_GATED = new Set(['addSessionNote']);

export function buildToolList(toggles: ChatToggles): ToolDefinition[] {
  // Plan-mode turns are tool-free — the model's only job is to write a plan.
  // An empty list prevents any tool call, including always-available read
  // tools that could otherwise be used to set code or query session state.
  if (toggles.planFirst) return [];

  return ALL_TOOLS.filter(t => {
    if (ALWAYS_AVAILABLE.has(t.name)) return true;
    if (RUN_GATED.has(t.name)) return toggles.scope.runCode;
    if (SAVE_GATED.has(t.name)) {
      // loadVersion (rewind) and saveVersion (snapshot) don't execute code,
      // so they only need the saveVersions scope. Gating loadVersion here also
      // keeps the model from rewinding state when the user has paused commits.
      // runAndSave runs first, so it additionally needs the runCode scope.
      const nonRunning = t.name === 'loadVersion' || t.name === 'saveVersion';
      return nonRunning ? toggles.scope.saveVersions : (toggles.scope.runCode && toggles.scope.saveVersions);
    }
    if (PAINT_GATED.has(t.name)) return toggles.scope.paintFaces;
    if (NOTES_GATED.has(t.name)) return toggles.scope.sessionNotes;
    if (VIEWS_GATED.has(t.name)) return toggles.vision.views;
    if (AUTORESUME_GATED.has(t.name)) return toggles.autoResume === true;
    return false;
  });
}

type PartwrightAPI = Record<string, (...args: unknown[]) => unknown>;

function getApi(): PartwrightAPI {
  const w = window as unknown as { partwright?: PartwrightAPI };
  if (!w.partwright) {
    throw new Error('window.partwright is not ready — the Partwright engine has not finished initializing.');
  }
  return w.partwright;
}

/** Dispatches a tool call to window.partwright and stringifies the result.
 *  Errors are caught and returned with isError: true so the loop can feed
 *  them back to the model for self-correction. Tools that return an
 *  image (renderView today) bypass the JSON path and return a structured
 *  ToolExecResult directly. */
export async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolExecResult> {
  try {
    // `finish` is a control sentinel, not a window.partwright call — the agent
    // loop reads it to end the turn. Acknowledge it without touching the API.
    if (name === 'finish') {
      const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
      return { content: summary ? `Marked complete: ${summary}` : 'Turn marked complete.', isError: false };
    }
    // Pre-flight: code-writing tools must match the active session
    // language. The agent loop will retry with the corrected language
    // when this errors, which is faster and clearer than letting the
    // wrong-language code reach the engine and fail with a parse error.
    if (name === 'setCode' || name === 'runAndSave' || name === 'runCode') {
      const code = typeof input.code === 'string' ? input.code : '';
      if (code.length > 0) {
        const mismatch = detectLanguageMismatch(code);
        if (mismatch) return { content: mismatch, isError: true };
      }
    }
    const api = getApi();
    // Tools that ship images back to the model bypass the generic JSON
    // dispatch — they need the data-URL → multimodal-image wrapping.
    if (name === 'renderView') return executeRenderView(api, input);
    if (name === 'renderViews') return await executeRenderViews(api, input);
    if (name === 'runIsolated') return await executeRunIsolated(api, input);
    if (name === 'sliceAtZVisual') return await executeSliceAtZVisual(api, input);

    const result = await dispatch(api, name, input);
    if (result === undefined) return { content: '(ok)', isError: false };
    if (typeof result === 'string') return { content: result, isError: false };
    // If a dispatch returned an object that already looks like our
    // ToolExecResult shape (image-bearing), pass it through. Otherwise
    // serialize normally.
    if (result && typeof result === 'object' && 'content' in (result as Record<string, unknown>) && 'isError' in (result as Record<string, unknown>)) {
      return result as ToolExecResult;
    }
    return { content: JSON.stringify(result, null, 2), isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: msg, isError: true };
  }
}

/** Returns an error message when the supplied code clearly doesn't match
 *  the active session language, or null when it looks plausible. The
 *  detector is intentionally conservative — false positives bounce the
 *  model into a wasted retry, so we only flag patterns we're highly
 *  confident about (`Manifold.` API calls in a SCAD session, `module ` /
 *  trailing `;` blocks with no `return` in a JS session). */
function detectLanguageMismatch(code: string): string | null {
  const lang = readActiveLanguage();
  if (lang === null) return null;
  if (lang === 'scad') {
    // Strong JS markers in a SCAD session — manifold-3d API calls and
    // explicit `return` statements (SCAD has no return keyword).
    if (/\bManifold\s*\./.test(code) || /\bCrossSection\s*\./.test(code) || /^\s*return\s+/m.test(code) || /\bconst\s*\{\s*Manifold\b/.test(code)) {
      return 'Language mismatch: this session is OpenSCAD (.scad) but the code looks like manifold-js (JavaScript). Rewrite using SCAD syntax: `cube([w,d,h], center=true);`, `cylinder(h=…, r1=…, r2=…, $fn=64);`, `translate([x,y,z]) <child>;`, `union() { ... }`, etc. No `return`, no `Manifold.` calls.';
    }
  } else if (lang === 'replicad') {
    // BREP sessions must return a BrepShape, not a Manifold. Calling
    // `Manifold.cube()` without piping through BREP is the usual mistake.
    if (/\bModule\s*=/.test(code) || /^\s*module\s+\w+\s*\(/m.test(code) || /^\s*\$fn\s*=/m.test(code)) {
      return 'Language mismatch: this session is BREP/replicad but the code uses OpenSCAD syntax. Rewrite using the BREP API: `const { BREP } = api;`, `return BREP.box([w,d,h]).fillet(2);`. No `module`, no `$fn`.';
    }
    if (/^\s*return\s+(api\.)?Manifold\b/m.test(code)) {
      return 'Language mismatch: this session is BREP/replicad, which must `return` a BREP shape (api.BREP.box/cylinder/sphere/…), not a Manifold. If you want fillets/chamfers inside a Manifold session instead, call setActiveLanguage("manifold-js") and use api.BREP from within it.';
    }
  } else if (lang === 'manifold-js') {
    // Strong SCAD markers in a JS session — `module name() {}` /
    // `function foo() = …` / `$fn = …;` are SCAD-only constructs.
    if (/^\s*module\s+\w+\s*\(/m.test(code) || /^\s*\$fn\s*=/m.test(code) || /^\s*function\s+\w+\s*\([^)]*\)\s*=/m.test(code)) {
      return 'Language mismatch: this session is manifold-js (JavaScript) but the code uses OpenSCAD-only syntax (`module`, `$fn`, or function-equals). Rewrite using the manifold-js API: `const { Manifold, CrossSection } = api;`, `Manifold.cube(...)`, `.translate(...)`, ending with `return manifold;`.';
    }
  }
  // 'voxel' sessions get no mismatch heuristic — the voxel engine surfaces a
  // targeted "return a grid" error on its own.
  return null;
}

/** Read the live engine language without forcing every consumer of
 *  `tools.ts` to import the engine module statically. The function lives
 *  in `src/geometry/engine.ts` and is already loaded by the app shell at
 *  startup, so a require-style lookup via `window.partwright` is safe. */
const SUBDOC_NAMES = new Set(['curves', 'bosl2', 'replicad', 'sdf', 'voxel', 'colors', 'print-safety', 'reference-images', 'file-io', 'annotations', 'relief', 'textures', 'iteration-workflow', 'gotchas', 'visual-verification', 'spending', 'manifold-api']);

/** Fetch a topic subdoc by short name. Same fetch path for Anthropic and
 *  local providers — both run inside the user's browser tab, so this is
 *  served by the dev server / Cloudflare Pages alongside the rest of the
 *  static site. The model gets the raw markdown back as the tool result. */
async function readSubdoc(name: string): Promise<{ content: string; isError: boolean }> {
  if (!SUBDOC_NAMES.has(name)) {
    return { content: `Unknown subdoc "${name}". Valid names: ${Array.from(SUBDOC_NAMES).join(', ')}.`, isError: true };
  }
  try {
    const res = await fetch(`/ai/${name}.md`, { cache: 'force-cache' });
    if (!res.ok) return { content: `Failed to fetch /ai/${name}.md: ${res.status} ${res.statusText}`, isError: true };
    const text = await res.text();
    return { content: text, isError: false };
  } catch (err) {
    return { content: `Failed to fetch /ai/${name}.md: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

function readActiveLanguage(): 'manifold-js' | 'scad' | 'replicad' | 'voxel' | null {
  try {
    const w = window as unknown as { partwright?: { getActiveLanguage?: () => 'manifold-js' | 'scad' | 'replicad' | 'voxel' } };
    const lang = w.partwright?.getActiveLanguage?.();
    return lang === 'manifold-js' || lang === 'scad' || lang === 'replicad' || lang === 'voxel' ? lang : null;
  } catch {
    return null;
  }
}

function executeRenderView(api: PartwrightAPI, input: Record<string, unknown>): ToolExecResult {
  const result = api.renderView(input) as string | { error: string } | null | undefined;
  const elevation = (input.elevation as number | undefined) ?? 30;
  const azimuth = (input.azimuth as number | undefined) ?? 0;
  const ortho = (input.ortho as boolean | undefined) ?? false;
  // Mirror the budget-driven default size applied in window.partwright.renderView
  // so the label reports the size actually rendered.
  const size = (input.size as number | undefined) ?? getRenderBudget().defaultPx;
  const label = `view: elev=${elevation}°, az=${azimuth}°${ortho ? ', ortho' : ''}, ${size}px`;
  return wrapImageResult(result, 'renderView', label);
}

async function executeRenderViews(api: PartwrightAPI, input: Record<string, unknown>): Promise<ToolExecResult> {
  const result = await api.renderViews(input) as string | { error: string } | null | undefined;
  // Mirror the budget-driven defaults applied in window.partwright.renderViews.
  const budget = getRenderBudget();
  const angles = input.angles as unknown[] | undefined;
  const views = (input.views as string | undefined) ?? budget.angles;
  const size = (input.size as number | undefined) ?? budget.defaultPx;
  const label = angles && angles.length > 0
    ? `views: ${angles.length} custom angles (${size}px per cell)`
    : `views: ${views} composite (${size}px per cell)`;
  return wrapImageResult(result, 'renderViews', label);
}

async function executeRunIsolated(api: PartwrightAPI, input: Record<string, unknown>): Promise<ToolExecResult> {
  const code = input.code as string;
  const view = input.view as Record<string, unknown> | undefined;
  const result = await api.runIsolated(code, view) as { geometryData?: unknown; thumbnail?: string | null; error?: string } | undefined;
  if (!result || typeof result !== 'object') return { content: 'runIsolated returned no result', isError: true };
  if ('error' in result && typeof result.error === 'string') return { content: result.error, isError: true };
  const stats = result.geometryData ?? {};
  const summary = `runIsolated stats: ${JSON.stringify(stats, null, 2)}`;
  if (typeof result.thumbnail !== 'string') {
    return { content: summary, isError: false };
  }
  const img = parseImageDataUrl(result.thumbnail);
  if (!img) return { content: summary, isError: false };
  return {
    content: `${summary}\n\nThumbnail attached — this is what the code would produce without side effects. Use to verify before runAndSave.`,
    isError: false,
    image: { ...img, label: 'runIsolated preview' },
  };
}

async function executeSliceAtZVisual(api: PartwrightAPI, input: Record<string, unknown>): Promise<ToolExecResult> {
  const result = api.sliceAtZVisual(input.z as number) as { svg: string; area: number; contours: number } | null;
  if (!result) return { content: 'sliceAtZVisual: no geometry loaded — run code first.', isError: true };
  const contourDesc = result.contours === 1 ? 'solid' : result.contours > 1 ? 'hollow/multi-piece' : 'empty';
  const summary = `Cross-section at z=${input.z}: area=${result.area.toFixed(3)}, contours=${result.contours} (${contourDesc})`;
  try {
    const pngBase64 = await rasterizeSvg(result.svg, 320);
    return {
      content: `${summary}\n\nProfile image attached — inspect for wall thickness, hollow interior shape, and contour count.`,
      isError: false,
      image: { data: pngBase64, mediaType: 'image/png', label: `slice z=${input.z}` },
    };
  } catch {
    return { content: summary, isError: false };
  }
}

function rasterizeSvg(svg: string, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) { reject(new Error('no canvas context')); return; }
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      ctx.fillStyle = '#1c1c1c';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      const dataUrl = canvas.toDataURL('image/png');
      resolve(dataUrl.replace(/^data:image\/png;base64,/, ''));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG rasterization failed')); };
    img.src = url;
  });
}

function wrapImageResult(result: string | { error: string } | null | undefined, toolName: string, label: string): ToolExecResult {
  if (result == null) return { content: `${toolName} returned no image — is there geometry loaded? Run code first.`, isError: true };
  if (typeof result === 'object' && 'error' in result) return { content: result.error, isError: true };
  if (typeof result !== 'string') return { content: `${toolName} returned an unexpected value`, isError: true };
  const img = parseImageDataUrl(result);
  if (!img) return { content: `${toolName} returned a non-data-URL string`, isError: true };
  return {
    content: `Rendered ${label}. The image is attached to this result — inspect it visually before deciding next steps.`,
    isError: false,
    image: { ...img, label },
  };
}

function parseImageDataUrl(dataUrl: string): { data: string; mediaType: ImageSource['mediaType'] } | null {
  const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) return null;
  const mediaTypeStr = match[1];
  const safeMedia: ImageSource['mediaType'] =
    mediaTypeStr === 'image/png' || mediaTypeStr === 'image/jpeg' ||
    mediaTypeStr === 'image/gif' || mediaTypeStr === 'image/webp'
      ? mediaTypeStr
      : 'image/png';
  return { data: match[2], mediaType: safeMedia };
}

async function dispatch(api: PartwrightAPI, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'getActiveLanguage':
      return api.getActiveLanguage();
    case 'setActiveLanguage':
      return api.setActiveLanguage(input.lang as Language);
    case 'getCode':
      return api.getCode();
    case 'setCode':
      return api.setCode(input.code as string);
    case 'runCode':
      return api.run(input.code as string | undefined);
    case 'runAndSave':
      return api.runAndSave(input.code as string, input.label as string | undefined, input.assertions as Record<string, unknown> | undefined);
    case 'getParams':
      return api.getParams();
    case 'setParams':
      return api.setParams(input.values as Record<string, unknown>);
    case 'getGeometryData':
      return api.getGeometryData();
    case 'getMeshSummary':
      return api.getMeshSummary(input);
    case 'getSessionContext':
      return api.getSessionContext();
    case 'listVersions':
      return api.listVersions();
    case 'loadVersion':
      return api.loadVersion({ index: input.index as number });
    case 'saveVersion':
      return api.saveVersion(input.label as string | undefined);
    case 'addSessionNote':
      return api.addSessionNote(input.text as string);
    case 'listSessionNotes':
      return api.listSessionNotes();
    case 'readDoc':
      return readSubdoc(input.name as string);
    case 'paintRegion':
      return api.paintRegion(input);
    case 'paintFaces':
      return api.paintFaces(input);
    case 'paintNear':
      return api.paintNear(input);
    case 'paintStroke':
      return api.paintStroke(input);
    case 'paintInBox':
      return api.paintInBox(input);
    case 'paintInOrientedBox':
      return api.paintInOrientedBox(input);
    case 'paintSlab':
      return api.paintSlab(input);
    case 'paintNearestRegion':
      return api.paintNearestRegion(input);
    case 'findFaces':
      return api.findFaces(input);
    case 'listComponents':
      return api.listComponents();
    case 'paintComponent':
      return api.paintComponent(input);
    case 'listLabels':
      return api.listLabels();
    case 'paintByLabel':
      return api.paintByLabel(input);
    case 'paintByLabels':
      return api.paintByLabels(input.items as unknown[]);
    case 'probePixel':
      return api.probePixel(input);
    case 'paintConnected':
      return api.paintConnected(input);
    case 'getFeatureCentroids':
      return api.getFeatureCentroids(input);
    case 'paintExplain': {
      // paintExplain returns {thumbnail, ...stats}. Image-on by default
      // because the visual is the most useful diagnostic for the model;
      // strip when withImage: false.
      const wantImage = input.withImage !== false;
      const apiInput = { ...input };
      delete apiInput.withImage;
      const result = await api.paintExplain(apiInput) as Record<string, unknown> | undefined;
      if (!result || typeof result !== 'object') return result;
      if ('error' in result) return result;
      const thumbnail = result.thumbnail as string | undefined;
      delete result.thumbnail;
      if (wantImage && typeof thumbnail === 'string') {
        const img = parseImageDataUrl(thumbnail);
        if (img) {
          const summary = `paintExplain: ${JSON.stringify(result)}. Region triangles highlighted yellow over the current model.`;
          return {
            content: summary,
            isError: false,
            image: { ...img, label: `paintExplain "${result.name}"` },
          } satisfies ToolExecResult;
        }
      }
      return result;
    }
    case 'paintPreview': {
      // paintPreview returns {triangleCount, bbox, centroid, [thumbnail]}.
      // The underlying API takes `withImage` directly and skips the WebGL
      // render when false (count-only is the cheap sanity check). Pass
      // through unchanged.
      const wantImage = input.withImage === true;
      const result = await api.paintPreview(input) as Record<string, unknown> | undefined;
      if (!result || typeof result !== 'object') return result;
      const thumbnail = result.thumbnail as string | undefined;
      delete result.thumbnail;
      if (wantImage && typeof thumbnail === 'string') {
        const img = parseImageDataUrl(thumbnail);
        if (img) {
          return {
            content: `Preview: ${JSON.stringify(result)}. Candidate triangles are highlighted yellow over the current model.`,
            isError: false,
            image: { ...img, label: 'paintPreview' },
          } satisfies ToolExecResult;
        }
      }
      return result;
    }
    case 'undoLastPaint':
      return api.undoLastPaint();
    case 'redoLastPaint':
      return api.redoLastPaint();
    case 'listRegions':
      return api.listRegions();
    case 'removeRegion':
      return api.removeRegion(input.id as number);
    case 'clearColors':
      return api.clearColors();
    case 'forkVersion': {
      const forkPatches = input.patches as Array<{ find: string; replace: string }> | undefined;
      const forkTransform = forkPatches
        ? (code: string) => applyPatches(forkPatches, code)
        : (_code: string) => input.code as string;
      return api.forkVersion({ index: input.index }, forkTransform, input.label as string | undefined, input.assertions as Record<string, unknown> | undefined, input.carryColors as boolean | undefined);
    }
    case 'copyColorsFromVersion':
      return api.copyColorsFromVersion({ index: input.index });
    case 'runAndAssert':
      return api.runAndAssert(input.code, input.assertions);
    case 'runAndExplain':
      return api.runAndExplain(input.code as string);
    case 'query':
      return api.query(input);
    case 'modifyAndTest': {
      const mtPatches = input.patches as Array<{ find: string; replace: string }> | undefined;
      return api.modifyAndTest((code: unknown) => {
        const s = code as string;
        if (mtPatches) return applyPatches(mtPatches, s);
        if (typeof input.find === 'string') return applyLiteralPatch(s, input.find, input.replace);
        throw new Error('modifyAndTest requires either {find, replace} or {patches:[...]}.');
      }, input.assertions as Record<string, unknown> | undefined);
    }
    case 'probeRay':
      return api.probeRay(input.origin, input.direction);
    case 'listParts':
      return api.listParts();
    case 'getCurrentPart':
      return api.getCurrentPart();
    case 'createPart':
      return api.createPart(input.name as string | undefined);
    case 'changePart':
      return api.changePart(input.id as string);
    case 'renamePart':
      return api.renamePart(input.id as string, input.name as string);
    case 'deletePart':
      return api.deletePart(input.id as string);
    case 'assertPaint':
      return api.assertPaint(input);
    case 'paintInCylinder':
      return api.paintInCylinder(input);
    case 'importImageAsRelief':
      return api.importImageAsRelief(input);
    case 'importSvgAsRelief':
      return api.importSvgAsRelief(input);
    case 'getReliefSwapGuide':
      return api.getReliefSwapGuide();
    case 'setReliefPreviewMode':
      return api.setReliefPreviewMode(input.mode);
    case 'applyFuzzySkin':
      return api.applyFuzzySkin(input);
    case 'applyKnitTexture':
      return api.applyKnitTexture(input);
    case 'applyCableKnit':
      return api.applyCableKnit(input);
    case 'applyWaffleStitch':
      return api.applyWaffleStitch(input);
    case 'applyFurVelvet':
      return api.applyFurVelvet(input);
    case 'applyWovenFabric':
      return api.applyWovenFabric(input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
