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
import { assetPath } from '../deployment';
import { applyLiteralPatch, applyPatches } from './patch';

export interface ToolDefinition {
  name: string;
  description: string;
  // `input_schema` is JSON Schema, but it's sent verbatim to every provider —
  // and Gemini's API only accepts an OpenAPI *subset*. Keep schemas within that
  // subset: type, description, properties, required, items, enum, minimum,
  // maximum. Keywords Gemini rejects (it 400s the whole tool list with
  // `Unknown name "X" … Cannot find field`) must be stripped by
  // `sanitizeSchemaForGemini` in gemini.ts — it already drops `$schema`,
  // `additionalProperties`, `exclusiveMinimum`, and `exclusiveMaximum`. If you
  // reach for a keyword not in that safe list (e.g. `pattern`, `const`,
  // `oneOf`), add it to the sanitizer's strip set in the same change.
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

import type { ImageSource } from './types';
import { compositeReferenceGrid } from './images';

export interface ToolExecResult {
  content: string;
  isError: boolean;
  /** Optional image to forward back to the model as a multimodal content
   *  block. Set by renderView (and any future tools that produce vision
   *  output) so the agent can self-verify against a fresh snapshot. */
  image?: ImageSource;
}

/** The subdocs `readDoc` can fetch from /ai/<name>.md. Single source of truth
 *  for both the readDoc tool's input-schema `enum` (what the model is allowed
 *  to request) and the runtime `SUBDOC_NAMES` validator — keep them derived
 *  from this so the schema can't silently omit a name the validator accepts
 *  (which previously schema-blocked the model from 5 valid subdocs). */
export const SUBDOC_NAMES_LIST = [
  'curves', 'bosl2', 'replicad', 'sdf', 'figure', 'voxel', 'colors', 'print-safety',
  'fasteners', 'joints', 'gears', 'threads', 'reference-images', 'file-io', 'annotations',
  'printing', 'relief', 'textures', 'mechanisms', 'iteration-workflow', 'gotchas',
  'visual-verification', 'spending', 'manifold-api', 'reconstruction',
  // Deprecated: 'print-fit' split into 'fasteners' + 'joints'. Kept so an older
  // cached prompt requesting it gets the redirect stub instead of an error.
  'print-fit',
] as const;

export const ALL_TOOLS: ToolDefinition[] = [
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
    description: 'Tweak one or more Customizer parameters and re-run the model — the same effect as the user dragging the Parameters panel\'s sliders, but driven from code. Pass an object of `{ paramKey: value }`. A numeric value beyond the declared min/max is honored as typed (the bounds only size the slider — they don\'t clamp); only wrong-type/unparseable values fall back to the default (never errors on a bad value); unknown keys are ignored. Returns the updated geometry stats and resolved parameter values. Prefer this over rewriting the code when you only need to change a declared dimension/option — it\'s cheaper and preserves the model. Errors only if the model declares no parameters.',
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
    name: 'getModelColors',
    description: 'Report the colors the current run declared in code via api.label(shape, name, {color}) (and api.labeledUnion entries with a color). These render and export automatically as a derived underlay — no paint step — and the editor stays editable; manual paint composites on top. Returns {count, colors: [{name, color, triangleCount}]}; an empty list means no colors were declared (or the labelled triangles vanished in a boolean — check listLabels().lostLabels). Sibling of listLabels (uncolored label features) and listRegions (manual paint regions).',
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
    name: 'getReferenceImages',
    description: 'See the reference IMAGES the user attached to this session (the "Attachments" panel — e.g. photos or alternate-angle views to model from or match). Returns ALL image attachments as ONE labeled grid image (each tile captioned with its label) plus a text list of the labels. Call this at the START of any task that refers to attached photos/views, and again whenever you need to re-check them — do NOT guess at a subject you have not actually seen. For non-image attachments (reference models, PDFs, notes) use getAttachments. If nothing is attached, it says so.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getAttachments',
    description: 'List ALL files the user pinned to this session (the "Attachments" panel): reference images, reference models (STL/STEP/3MF), documents (PDF), and text/notes. Returns a manifest — each entry\'s id, kind (image|model|document|text|other), media type, label, the user\'s free-form DESCRIPTION of why it matters (shown as "↳ …" — read these, they\'re the key signal), when it was added, and source (user vs captured from a chat upload). Text/notes attachments include their contents inline. These are DURABLE project context: they survive clearing the chat, so use this to recover reference material an earlier conversation was working from. To actually SEE image attachments, call getReferenceImages.',
    input_schema: { type: 'object', properties: {} },
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
    description: 'DRY-RUN: returns {triangleCount, bbox, centroid, totalArea, largestTriangleArea} for what a paint op WOULD select, WITHOUT committing. Same selector args as paintInBox / paintNear / paintFaces / paintInCylinder / paintSlab (pass `cylinder` or `slab` to dry-run those). The cheapest way to catch a bad selector — count alone is essentially free; ALWAYS call before any non-trivial paint. The `cylinder` / `slab` previews show the UNSMOOTHED selection (preview never subdivides) — perfect for validating a radial-shell or slab offset/thickness before committing the real smoothing paint. The `largestTriangleArea / (totalArea / triangleCount)` ratio is the fan-topology diagnostic: ratios > ~10 mean a long radial triangle is dragging the selection beyond its intended footprint (common with cylinder / revolve meshes) — fix with `coverageMode: "fully_inside"` or a `maxTriangleArea` cap, or refine the mesh before painting. Pass `withImage: true` when the count or area ratio is suspicious — the thumbnail shows the real triangle extents tinted yellow.',
    input_schema: {
      type: 'object',
      properties: {
        box: { type: 'object', description: '{min: [x,y,z], max: [x,y,z]}' },
        cylinder: { type: 'object', description: 'Radial-shell selector: {rMin, rMax, zMin, zMax, center?: [a,b], axis?: "x"|"y"|"z"}. axis (default z) picks the shell axis; radius is measured in the plane normal to it. Previews the same triangles paintInCylinder would select (unsmoothed).' },
        slab: { type: 'object', description: 'Slab selector: {axis: "x"|"y"|"z" OR normal: [nx,ny,nz], offset, thickness}. Previews the same triangles paintSlab would select (unsmoothed).' },
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
    description: 'Fetch one of the topic-specific docs from /ai/<name>.md. Use this when the core ai.md points you at a subdoc and you need its full content before writing code. Names: curves, bosl2, replicad, sdf, figure, voxel, colors, print-safety, fasteners, joints, gears, threads, reference-images, file-io, annotations, printing, relief, textures, mechanisms, iteration-workflow, gotchas, visual-verification, spending, manifold-api.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          enum: [...SUBDOC_NAMES_LIST],
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
        wrapAngleDeg: { type: 'number', description: 'Wrap tolerance (0–180): the max edge bend, in degrees, paint may flow across. The stroke follows gentle curves/bumps but stops at sharper folds — 90 stops at right-angle corners (so paint on one face of a box stays off the adjacent faces), 180 (default) wraps across any edge. Lower it to keep a stroke on a single face.' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        name: { type: 'string' },
      },
      required: ['points', 'radius', 'color'],
    },
  },
  {
    name: 'paintImage',
    description: 'Project a RASTER IMAGE onto the surface as paint — the right tool for a logo, graphic, styled text/wordmark, or any picture-on-a-surface (a shirt graphic, a sticker/decal, a label, face/skin detail). It maps the actual image pixels onto the triangles, so a logo stays a logo and lettering stays legible — unlike the solid-colour region tools (paintNear/paintInBox), which can only flood one flat colour and turn a graphic into a blob. The image background is removed by default so only the subject paints. THE IMAGE: pass `imageRef` (1-based index of a session reference image — call getReferenceImages first to see what the user attached and its index) OR `imageUrl` (a data: or same-origin URL). PLACEMENT, two ways: (1) easiest — pass `view` (front/back/left/right/top/bottom) and it projects flat along that axis onto the surface facing the camera, auto-anchored at the model centre; add `label` to centre it on an api.label region (e.g. the shirt) and, if you omit `size`, to auto-size it to that region; (2) precise — pass explicit `at` (surface point) + `normal` (outward direction there) from probePixel/probeRay. `size` is the decal width in model units. `rotationDeg` twists it around the axis. Returns {ok, name, triangles, avgColor} or {error}. Verify with renderView/renderViews from the projection direction afterwards.',
    input_schema: {
      type: 'object',
      properties: {
        imageRef: { type: 'number', description: '1-based index of a session reference image to paint (the order getReferenceImages lists them). Use this for an image the user attached.' },
        imageUrl: { type: 'string', description: 'Alternative to imageRef: a data: URL or same-origin image URL.' },
        view: { type: 'string', enum: ['front', 'back', 'left', 'right', 'top', 'bottom'], description: 'Project flat along this view axis onto the surface facing it, auto-anchored at the model centre. The simplest placement. front=-Y, back=+Y, right=+X, left=-X, top=+Z, bottom=-Z.' },
        label: { type: 'string', description: 'Centre the projection on this api.label region (and auto-size to it when `size` is omitted). Combine with `view`, or with `at`+`normal` for explicit control.' },
        at: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Explicit stamp centre on the surface (world coords), from probePixel/probeRay. Use with `normal` for precise placement instead of `view`.' },
        normal: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Explicit outward projection direction at `at`. Pair with `at`.' },
        size: { type: 'number', description: 'Decal width in model units. Optional when `label` is given (auto-sized to the label footprint).' },
        rotationDeg: { type: 'number', description: 'Rotate the image around the projection axis, degrees. Default 0.' },
        detail: { type: 'number', description: 'Triangle rows across the stamp; higher = crisper (default 96). 0 = flat stamp on the existing tessellation.' },
        removeBackground: { type: 'boolean', description: 'Drop the image background so only the subject paints. Default true.' },
        name: { type: 'string' },
      },
      required: [],
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
    description: 'List the parts in the active session: [{id, name, order, isCurrent}]. A session can hold multiple parts — independent objects, each with its own code and version history. The current part is the default target for runCode / runAndSave / paint / export, but those tools also take an optional `part` target (name, id, or index) so you can act on any part directly without switching focus first.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getCurrentPart',
    description: "Return the active part {id, name, order}, or null when no session is open. You rarely need this: changePart returns the part it switched to, listParts marks the current one (isCurrent), and every part-scoped tool takes a `part` target — so prefer addressing parts by name/index over reading the current selection (which the user can change while you work).",
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
    description: "Switch the active part — i.e. change what the USER sees in the editor/viewport. Address it by name, id (from listParts), or 0-based index. Loads that part's latest version. You usually do NOT need this just to work on a different part: every part-scoped tool (getCode, runCode, runAndSave, paint*, getGeometryData, …) takes an optional `part` target that addresses a part directly. Use changePart only when you want to move the user's focus, or to reset the editor to a part's latest saved version.",
    input_schema: {
      type: 'object',
      properties: {
        part: { description: 'The part to switch to — its name, id (from listParts), or 0-based index.' },
        id: { type: 'string', description: 'Deprecated alias for `part` — a part id from listParts().' },
      },
    },
  },
  {
    name: 'renamePart',
    description: 'Rename a part. Address it by name, id (from listParts), or 0-based index, and give the new name.',
    input_schema: {
      type: 'object',
      properties: {
        part: { description: 'The part to rename — its name, id (from listParts), or 0-based index.' },
        id: { type: 'string', description: 'Deprecated alias for `part` — a part id from listParts().' },
        name: { type: 'string', description: 'New part name.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'deletePart',
    description: "Delete a part and all its versions. Refuses to delete a session's last remaining part. If the active part is deleted, an adjacent part becomes active. Address it by name, id (from listParts), or 0-based index.",
    input_schema: {
      type: 'object',
      properties: {
        part: { description: 'The part to delete — its name, id (from listParts), or 0-based index.' },
        id: { type: 'string', description: 'Deprecated alias for `part` — a part id from listParts().' },
      },
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
    description: 'Paint triangles whose centroids fall within a cylindrical shell: rMin ≤ dist(centroid, axis) ≤ rMax AND zMin ≤ height ≤ zMax. The canonical tool for inner walls of hollow cylinders, mugs, vases, and any revolved shape where paintInBox catches too many faces. Set rMin > 0 to exclude the axis core; set rMax to the inner radius to select only the inner surface. The shell runs along the chosen axis (default z); for an x- or y-aligned cylinder pass axis. Optional normalCone/topOnly for further filtering.',
    input_schema: {
      type: 'object',
      properties: {
        center: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
          description: 'Center of the cylinder axis in the radial plane [a, b]. For axis="z" this is [x, y]; for "x" it is [y, z]; for "y" it is [z, x]. Use [0, 0] for an axis-centered model.',
        },
        axis: {
          type: 'string',
          enum: ['x', 'y', 'z'],
          description: 'World axis the shell runs along (default z). Radius is measured in the plane normal to it and the zMin..zMax band runs along it.',
        },
        rMin: { type: 'number', description: 'Minimum radial distance from axis (0 to include everything up to rMax).' },
        rMax: { type: 'number', description: 'Maximum radial distance from axis.' },
        zMin: { type: 'number', description: 'Start of the band along the chosen axis.' },
        zMax: { type: 'number', description: 'End of the band along the chosen axis.' },
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
    name: 'checkPrintability',
    description: 'Analyze the current model for 3D-printing problems and return a structured report: bed fit, overhangs that need support, thin walls (a sampled estimate), small features, tip-over stability (centre of mass vs base footprint), and watertightness. Every check carries a level — pass / warn / fail (fail = won\'t print as-is). Reads the build volume + nozzle from printer settings unless you override them. Call this before telling the user a model is print-ready, and again after geometry changes; then fix any fails — thicken walls, re-orient to remove overhangs, use the Resize tool to fit the bed, or use the Split tool when it is simply too big for the bed. The same check runs automatically on STL / OBJ / 3MF / GLB export and warns via a toast.',
    input_schema: {
      type: 'object',
      properties: {
        bed: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Optional build-volume override [x, y, z] in mm.' },
        nozzleWidth: { type: 'number', description: 'Optional nozzle-width override (mm). Drives the thin-wall / small-feature checks.' },
        overhangAngleDeg: { type: 'number', description: 'Optional overhang threshold — downward surfaces shallower than this many degrees from horizontal are flagged. Default 45 (the classic 45° rule).' },
      },
    },
  },
  {
    name: 'getPrinterSettings',
    description: 'Read the target printer settings: build volume bed [x, y, z] (mm), nozzleWidth, overhangAngleDeg, clearance. These drive the checkPrintability tool and the pre-export printability warning.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'setPrinterSettings',
    description: 'Update the target printer settings. Pass any subset of {bed:[x,y,z], nozzleWidth, overhangAngleDeg, clearance}. Use when the user names their printer or bed size (e.g. "I have an Ender 3" → bed [220, 220, 250]; "Bambu" → [256, 256, 256]).',
    input_schema: {
      type: 'object',
      properties: {
        bed: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Build volume [x, y, z] in mm.' },
        nozzleWidth: { type: 'number', description: 'Nozzle diameter (mm), e.g. 0.4.' },
        overhangAngleDeg: { type: 'number', description: 'Overhang threshold in degrees from horizontal (default 45).' },
        clearance: { type: 'number', description: 'Assembly clearance (mm) used for split connector holes.' },
      },
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
    name: 'applySurfaceTexture',
    description: `Apply a surface texture (fuzzy skin, knit, cable knit, waffle, fur/velvet, woven, knurl grip, voronoi relief, or smooth) to the WHOLE current model and save a new version.

**Routing — prefer the default.** mode 'auto' (default): in a manifold-js session the texture is written INTO THE CODE as an \`api.surface.<id>({…})\` call (inserted before the final return, or the existing call for that id is updated in place) — the model stays parametric, the texture recomputes when the code changes, and saved versions keep the computed result. In a SCAD/BREP/voxel session it falls back to BAKING the textured mesh (the parametric source is replaced — the returned warnings say so). mode 'code' forces the in-code path (errors off manifold-js); mode 'bake' forces the destructive bake. To fine-tune on manifold-js, just call again with new opts — the code call is edited in place, no undo round-trip needed.

**opts by id** (all optional — size-relative defaults fill in; amplitude in world units, start ~1–3% of model diagonal; quality 1–5 mesh detail; seed for reproducibility):
- fuzzy: amplitude, scale (feature size, ~4% of diagonal), octaves (1–5), seed, quality
- knit: amplitude, stitchWidth, stitchHeight, rowOffset (0–1), roundness (0–1), grainAngleDeg, variation, seed, quality, algorithm ('bfs'|'lscm'|'harmonic')
- cable: amplitude, cableWidth, cablePitch, plyWidth, grainAngleDeg, variation, seed, quality
- waffle: amplitude, cellWidth, cellHeight, sharpness (1=soft…8+=thin border), rowOffset (0.5=honeycomb), grainAngleDeg, seed, quality
- fur: amplitude, fiberSpacing, fiberLength, octaves, grainAngleDeg, seed, quality
- woven: amplitude, threadSpacing, threadWidth (0.1–0.9 fraction), underDepth (0–1), grainAngleDeg, seed, quality
- knurl: amplitude (ridge height), cellWidth/cellHeight (ridge spacing), style ('diamond'|'straight'|'ribs'), profile ('round' soft cosine bumps | 'pyramid' straight-sided machinist diamonds), sharpness (1 soft … 6+ sharp peaks), grainAngleDeg, seed, quality — the machinist grip pattern (diamond cross-hatch, axial splines, or finger ribs)
- voronoi: amplitude, cellSize, wallWidth (fraction), raised (false = engraved channels), jitter (0–1), grainAngleDeg, seed, quality
- smooth: iterations (Taubin passes, ~5), subdivide (default true)
Plus preserveColor (default true — bake path only; on the code path paint re-resolves against the textured mesh every run automatically).

**Scoping (code path / manifold-js only).** By default the texture covers the whole skin. Add ONE of these to opts to limit it to part of the model:
- label: 'name' — texture only the triangles of an \`api.label(shape, 'name', …)\` region. Lets you texture one shape of a union (e.g. a knurled grip on a smooth body): label that shape in the code, union it, then \`applySurfaceTexture('knurl', { label: 'grip' })\`.
- region: { point: [x,y,z], radius } — texture every triangle whose surface is within \`radius\` of a world-space point. Use getGeometryData's bbox/centroid to pick a point on the model.
(Scoping is ignored on the bake path; pass label/region only with mode 'auto'/'code'.)

**Return:** { path: 'code'|'bake', ok, … } — code path: { call, replaced, version, geometry }; bake path: { label, geometry, colorsCarried, warnings? }. Always check warnings. Call renderViews after to verify.`,
    input_schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          enum: ['fuzzy', 'knit', 'cable', 'waffle', 'fur', 'woven', 'knurl', 'voronoi', 'smooth'],
          description: 'Which texture to apply.',
        },
        opts: {
          type: 'object',
          description: "That id's options (see the per-id list in the tool description) plus preserveColor. Omit for size-relative defaults.",
        },
        mode: {
          type: 'string',
          enum: ['auto', 'code', 'bake'],
          description: "Routing. Default 'auto' (in-code on manifold-js, bake elsewhere). Only pass 'bake' when the user explicitly wants the mesh flattened.",
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'applyVoronoiLamp',
    description: `Turn the current model into a **true perforated Voronoi shell** — a "Voronoi lamp" / planter: a thin hollow wall with the cell interiors cut clean through, leaving a see-through network of struts along the cell edges. Saves a new version.

**This is the real cutaway, not a texture.** Unlike the voronoi relief texture (\`applySurfaceTexture\` with id 'voronoi' — displacement only, no holes), this opens actual windows through the wall. \`output:'mesh'\` (default) bakes a smooth manifold-js mesh (Taubin-rounded, no engine change). \`output:'voxel'\` switches the session to the \`voxel\` language (paintable, \`.vox\`-exportable, blockier).

**When to use:** when the user wants a Voronoi lamp / lampshade, a perforated planter, or any see-through cell-lattice shell. Start from a closed solid (vase, sphere, vessel).

**Key parameters:**
- cellSize: approximate spacing between cells, world units (~16% of diagonal)
- wallThickness: shell thickness in world units (~3% of diagonal); the struts are this thick
- strutWidth: kept edge-network width as a fraction of cellSize [0.05–0.6] (default 0.3; smaller = thinner struts / bigger windows)
- resolution: field/voxel resolution along the longest axis (default 140, up to 256). **Auto-raised** so struts resolve to ≥6 cells, so you rarely need to touch it; the default mesh output meshes a continuous SDF (smooth walls, no voxel stair-stepping), and higher resolution sharpens the struts
- jitter: cell irregularity [0–1] (1 = irregular Voronoi, default; 0 = a regular grid of windows)
- grainAngleDeg, seed: orient / reshuffle the cell layout
- watertight: keep only the largest connected web → one printable manifold piece (default true — leave on)
- output: 'mesh' (default, smooth manifold-js mesh) or 'voxel' (paintable voxel session)
- smooth: voxel output only — round the struts (default true)

**Return:** { ok, label, geometry, warnings? }. Verify with renderViews — check the windows are open. With watertight on, the result should be manifold (isManifold true).

**Workflow guidance:** the defaults are tuned to look good on a typical solid; mostly just adjust cellSize (fewer/larger vs more/smaller cells) and strutWidth (thicker vs thinner struts). If windows don't open, lower strutWidth or raise cellSize. Keep watertight on for printing.`,
    input_schema: {
      type: 'object',
      properties: {
        cellSize: { type: 'number', description: 'Approximate spacing between cells in world units. Default ~16% of diagonal.' },
        wallThickness: { type: 'number', description: 'Shell wall thickness in world units (strut thickness through the wall). Default ~3% of diagonal.' },
        strutWidth: { type: 'number', description: 'Kept edge-network width as a fraction of cellSize [0.05–0.6]. Default 0.3. Smaller = thinner struts, larger windows.', minimum: 0.05, maximum: 0.6 },
        resolution: { type: 'integer', description: 'Field/voxel resolution along the longest axis [16–256]. Higher = crisper struts, slower. Default 110.', minimum: 16, maximum: 256 },
        jitter: { type: 'number', description: 'Cell irregularity [0–1]. 1 = irregular Voronoi (default); 0 = a regular grid.', minimum: 0, maximum: 1 },
        grainAngleDeg: { type: 'number', description: 'Rotate the cell pattern in the XY plane, degrees. Default 0.' },
        seed: { type: 'integer', description: 'Deterministic seed — change to reshuffle the cell layout. Default 1.' },
        watertight: { type: 'boolean', description: 'Keep only the largest connected strut web — one watertight, manifold, printable piece (drops loose fragments). Default true — leave on unless you want the raw multi-part cut.' },
        output: { type: 'string', enum: ['mesh', 'voxel'], description: "'mesh' (default): smooth manifold-js mesh, no engine change. 'voxel': switch to the voxel engine (paintable / .vox)." },
        smooth: { type: 'boolean', description: 'Voxel output only: round the struts with a smoothing pass. Default true.' },
        preserveColor: { type: 'boolean', description: 'Sample model paint onto the struts. Default true.' },
      },
    },
  },
  {
    name: 'engraveModel',
    description: `Stamp **text** onto the current model: carve it as recessed channels (engrave), cut holes clean through the wall (cut-through), or — with \`raised: true\` — **EMBOSS it as a raised relief**. Saves a new version.

**This removes (or, embossing, adds) material** — unlike the relief textures (\`applySurfaceTexture\`: voronoi, knit, waffle…) which only displace the surface skin. The text is rasterized (the app's font path) and projected onto a chosen face (planar) or wrapped around the Z axis (cylindrical), then subtracted from (or unioned onto) the solid.

**When to use:** to label / brand a part (a name on a tag, a logo plate), cut a stencil, perforate a sign, or add raised lettering. Start from a slab, plate, ring, or cylinder.

**Key parameters:**
- text: the string to engrave/emboss (required)
- raised: true = EMBOSS — raise the text \`depth\` above the face instead of carving (through is ignored). Default false.
- through: false (default) recesses to \`depth\`; true cuts a hole clean through the wall (stencil)
- depth: engrave depth — or emboss height with raised — in world units (ignored when through); default ~6% of the model diagonal
- size: stamp width in world units — how wide the text spans across the face; default ~70% of the face
- color: paint the letters ('#rrggbb' hex) for a multicolor print — the raised relief (emboss) or the channel walls (engrave/through). Existing paint is still carried.
- mode: 'planar' (default — onto one face) or 'cylindrical' (wrap around Z, e.g. text around a ring/cup)
- axis + side: planar face — axis 'x'|'y'|'z' (default 'z') and side 'min'|'max' (default 'max' = the +axis face). For cylindrical, side 'outer' (default) or 'inner'.
- resolution: field resolution [48–256], default 180. Thin strokes need higher; raise it if letters look mushy.
- watertight: keep only the largest connected piece (default true).

**Return:** { ok, label, geometry, warnings? }. Verify with renderViews — check the letters are legible, (for through) the holes are open, and (for raised) the relief stands proud. With watertight on the result should be manifold.

**Note:** engraving an **image** is supported only from the Surface UI panel (it needs local image bytes); this tool handles text.`,
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to engrave/cut. Required.' },
        font: { type: 'string', enum: ['regular', 'bold', 'italic', 'bold-italic'], description: "Font weight/style. Default 'bold' (heavier strokes engrave more legibly)." },
        through: { type: 'boolean', description: 'true = cut clean through the wall (stencil); false (default) = recess to `depth`. Ignored when raised.' },
        raised: { type: 'boolean', description: 'true = EMBOSS: add the text as a raised relief `depth` high instead of carving it. Default false.' },
        depth: { type: 'number', description: 'Engrave depth — or emboss height when raised — in world units (ignored when through). Default ~6% of the model diagonal.' },
        size: { type: 'number', description: 'Stamp width in world units — how wide the text spans. Default ~70% of the face span.' },
        color: { type: 'string', description: "Paint the letters for a multicolor print, '#rrggbb' hex — colors the raised relief (emboss) or the channel walls (engrave/through). Existing paint is still carried." },
        mode: { type: 'string', enum: ['planar', 'cylindrical'], description: "'planar' (default): onto one flat face. 'cylindrical': wrap the text around the Z axis." },
        axis: { type: 'string', enum: ['x', 'y', 'z'], description: "Planar only: which face axis. Default 'z' (top/bottom)." },
        side: { type: 'string', enum: ['min', 'max', 'outer', 'inner'], description: "Planar: 'max' (default, +axis face) or 'min'. Cylindrical: 'outer' (default) or 'inner'." },
        posU: { type: 'number', description: 'Planar only: stamp center across the face, as a fraction [0–1] of the bbox on the first in-plane axis. Default 0.5 (centered); 0.25/0.75 = quarter points.', minimum: 0, maximum: 1 },
        posV: { type: 'number', description: 'Planar only: stamp center up the face, as a fraction [0–1] of the bbox on the second in-plane axis. Default 0.5 (centered).', minimum: 0, maximum: 1 },
        rotationDeg: { type: 'number', description: 'Rotate the stamp in the face plane (planar) or around Z (cylindrical), degrees. Default 0.' },
        curveAxis: { type: 'string', enum: ['none', 'u', 'v'], description: "Planar/free only: bend the flat stamp around a surface. 'v' = wrap around the vertical axis (text curves left↔right, e.g. around a cylinder/tower/mug); 'u' = wrap around the horizontal axis (text curves up↔down, over a dome). 'none' (default) = flat." },
        curveAngleDeg: { type: 'number', description: 'Total arc the curved stamp subtends, in degrees (used with curveAxis). The whole word spans this angle; larger = tighter wrap. Default 90.' },
        resolution: { type: 'integer', description: 'Field resolution along the longest axis [48–256]. Higher = crisper letters, slower. Default 180.', minimum: 48, maximum: 256 },
        watertight: { type: 'boolean', description: 'Keep only the largest connected piece — one manifold result. Default true.' },
        preserveColor: { type: 'boolean', description: 'Carry existing paint onto the carved mesh. Default true.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'voxelizeModel',
    description: `Convert the current model into the voxel engine — a grid of colored cubes (Minecraft / pixel-art look). Saves a new version and switches the session to the voxel language.

**When to use:** for a deliberately blocky aesthetic, or to hand a model to the voxel-paint tools.

**Parameters:** resolution = voxels along the longest axis (higher → finer and slower; start ~32); smooth = lightly round the voxel result (default false); preserveColor = sample existing paint into the voxels (default true).

**Cross-engine note:** this replaces the session's code with a voxels.decode(...) program; the prior manifold-js / SCAD / BREP source is no longer editable. Returns { ok, label, geometry, warnings? }.`,
    input_schema: {
      type: 'object',
      properties: {
        resolution: { type: 'integer', description: 'Voxels along the longest axis. Higher = finer and slower. Default ~32.', minimum: 4, maximum: 256 },
        smooth: { type: 'boolean', description: 'Lightly round the voxelized result. Default false.' },
        preserveColor: { type: 'boolean', description: 'Sample existing paint into the voxel colors. Default true.' },
      },
    },
  },
  {
    name: 'convertToCode',
    description: `Rebuild the current model (typically a mesh import) as self-contained, editable manifold-js code — a smooth remake interpolated from measured Z-sections, with no dependency on the import. Runs the generated code, saves a version, and measures the remake against the source.

**When to use:** the user imported an STL and wants editable code instead of an opaque mesh wrapper, or asks to "reverse-engineer" / "convert this model to code". Requires a manifold-js session with a model loaded.

**After it returns:** check metrics.chamfer (mean surface deviation) and metrics.hausdorff (worst point). Distances below metrics.sampleSpacing are sampling noise, not real error. Use evalAgainstImport to re-measure after you edit the generated code.

Returns { ok, stats, metrics, version } or { error }.`,
    input_schema: {
      type: 'object',
      properties: {
        quality: { type: 'string', enum: ['draft', 'standard', 'fine'], description: "Speed/smoothness preset. 'draft' ≈ 4× faster, 'fine' ≈ 4× slower and smoothest. Default 'standard'." },
        step: { type: 'number', description: 'Explicit Z-section pitch (world units); overrides the preset. Smaller = more sections.' },
        edge: { type: 'number', description: 'Explicit levelSet edge length (world units); smaller = finer surface + slower build.' },
      },
    },
  },
  {
    name: 'evalAgainstImport',
    description: `Measure how faithful the current model is to an imported mesh: chamfer (mean surface deviation), hausdorff (worst point), and per-direction quantiles from matched surface samples.

**When to use:** after convertToCode or after editing reconstructed code, to verify the remake still matches the imported original. Distances below sampleSpacing are sampling noise. Returns { ok, importIndex, filename, chamfer, hausdorff, ... } or { error }.`,
    input_schema: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: 'Imported-mesh index (default 0).', minimum: 0 },
        samples: { type: 'integer', description: 'Surface samples per mesh — more = tighter noise floor, slower. Default from settings (~4000).', minimum: 100, maximum: 200000 },
      },
    },
  },
  {
    name: 'profileModel',
    description: `MEASURE the shape of an imported mesh (default) or the current model: sweeps cross-sections along each axis, fits primitives to every section, and merges steady fits into runs — a run of circular sections IS a measured cylinder ("circle r≈2.31 from z=8.1..14.0"), a run of rect sections IS a measured box. Organic/multi-blob regions are reported as such.

**When to use:** FIRST step of any reconstruction — it hands you the semantic skeleton (which features are true primitives, with measured dimensions) without guessing from renders. Pass axis+at for one detailed section including hole/bore circle fits (e.g. measure a chimney bore).

Returns { ok, measured, bbox, axes: [{axis, runs: [{kind, from, to, circle?, rect?, meanHoles?, sampleHoles?}]}] } or { error }. With axis+at it instead returns one section probe: { ok, measured, at, kind, outerCount, holeCount, outer, circle, rect, holes }. Each fit carries rmsRel/rmsResidual — near zero means the fit is real.`,
    input_schema: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: 'Imported-mesh index (default 0).', minimum: 0 },
        source: { type: 'string', enum: ['import', 'model'], description: "What to measure. Default: the import (falls back to the current model when none)." },
        sectionsPerAxis: { type: 'integer', description: 'Sections per axis (default 48; more = finer runs, slower).', minimum: 8, maximum: 256 },
        axis: { type: 'string', enum: ['x', 'y', 'z'], description: 'With `at`: probe ONE section in detail instead of sweeping.' },
        at: { type: 'number', description: 'Coordinate along `axis` for the single-section probe.' },
      },
    },
  },
  {
    name: 'compareToImport',
    description: `Voxel symmetric-difference between the current model and an imported mesh: volume IoU plus LOCALIZED findings — every disagreement blob signed ('excess' = your model has material the target lacks, 'missing' = the reverse), sized, and positioned (centroid, bbox, relCentroid 0..1 within the target).

**When to use:** when evalAgainstImport's scalar says something is off and you need to know WHAT and WHERE. Each finding is actionable: a compact 'missing' blob is a feature you haven't modeled; a thin-skin blob is a surface offset. Slower than evalAgainstImport.

Returns { ok, volumeIoU, excessVolume, missingVolume, findings: [{id, sign, volume, centroid, bbox, relCentroid, extent, thickness, classification, hint}] } or { error }.`,
    input_schema: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: 'Imported-mesh index (default 0).', minimum: 0 },
        maxFindings: { type: 'integer', description: 'Cap on reported findings (default 12).', minimum: 1, maximum: 64 },
      },
    },
  },
  {
    name: 'fitInscribed',
    description: `Find the largest axis-aligned box or Z-axis cylinder that fits entirely INSIDE an imported mesh (default) or the current model — measured from a voxel occupancy grid. Returns the primitive's dimensions and the fraction of the mesh volume it covers.

**When to use:** to give a reconstruction a clean primitive core (model the inscribed primitive exactly, union a section-interpolated remainder around it), or to read a feature's true inner dimensions. A high volumeFraction (>0.6) means the shape is mostly that primitive.

Returns { ok, measured, kind, center, size|r/z0/z1, volume, volumeFraction } or { error }.`,
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['box', 'cylinder'], description: "Primitive to fit (default 'box'; cylinder is Z-axis)." },
        index: { type: 'integer', description: 'Imported-mesh index (default 0).', minimum: 0 },
        source: { type: 'string', enum: ['import', 'model'], description: 'What to measure (default: the import).' },
      },
    },
  },
  {
    name: 'scaleModel',
    description: `Resize the current model by per-axis multiplicative factors and save a new version. 1 = unchanged, 2 = double, 0.5 = half. For a uniform resize pass the same factor for sx, sy, and sz.

**Write-back:** mode 'auto' (default) keeps a manifold-js model parametric (wraps the source in an editable .scale([sx, sy, sz])) when safe, otherwise bakes to a mesh; 'parametric' forces editable code; 'bake' flattens to a mesh. A SCAD/BREP/painted/voxel model can only bake. Factors must be positive (a negative or zero scale would mirror or collapse the mesh). Returns { ok, noop?, label, geometry, warnings? }.`,
    input_schema: {
      type: 'object',
      properties: {
        sx: { type: 'number', description: 'X-axis scale factor (1 = no change).', exclusiveMinimum: 0 },
        sy: { type: 'number', description: 'Y-axis scale factor (1 = no change).', exclusiveMinimum: 0 },
        sz: { type: 'number', description: 'Z-axis scale factor (1 = no change).', exclusiveMinimum: 0 },
        mode: { type: 'string', enum: ['auto', 'parametric', 'bake'], description: "Write-back mode. Default 'auto'." },
        preserveColor: { type: 'boolean', description: 'Carry existing paint onto the scaled mesh. Default true.' },
      },
      required: ['sx', 'sy', 'sz'],
    },
  },
  {
    name: 'placeModel',
    description: `Reposition the current model on the print bed and save a new version. Combine any of dropToFloor (sit the model's bottom on Z=0), centerX, centerY, centerZ. Use this to fix a model that floats above or sinks below the bed, or to center it.

**Write-back:** mode 'auto' (default) keeps the model parametric (an editable .translate) when safe, otherwise bakes to a mesh; 'parametric' forces editable code; 'bake' flattens to a mesh. A SCAD/BREP/painted model can only bake. Returns { ok, noop?, geometry, warnings? } — noop:true when already positioned.`,
    input_schema: {
      type: 'object',
      properties: {
        dropToFloor: { type: 'boolean', description: "Move the model so its lowest point sits on Z=0 (the bed)." },
        centerX: { type: 'boolean', description: 'Center the model on the X axis.' },
        centerY: { type: 'boolean', description: 'Center the model on the Y axis.' },
        centerZ: { type: 'boolean', description: 'Center the model on the Z axis.' },
        mode: { type: 'string', enum: ['auto', 'parametric', 'bake'], description: "Write-back mode. Default 'auto'." },
        preserveColor: { type: 'boolean', description: 'Carry existing paint when baking. Default true.' },
      },
    },
  },
  {
    name: 'rotateModel',
    description: `Rotate the current model by Euler angles in degrees, about its own center, and save a new version. Same write-back modes as placeModel (auto / parametric / bake). Returns { ok, geometry, warnings? }.`,
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Rotation about the X axis, in degrees.' },
        y: { type: 'number', description: 'Rotation about the Y axis, in degrees.' },
        z: { type: 'number', description: 'Rotation about the Z axis, in degrees.' },
        mode: { type: 'string', enum: ['auto', 'parametric', 'bake'], description: "Write-back mode. Default 'auto'." },
        preserveColor: { type: 'boolean', description: 'Carry existing paint when baking. Default true.' },
      },
    },
  },
  {
    name: 'layFlatModel',
    description: `Auto-orient the current model for printing: rotate its largest flat face down onto the bed and drop it to the floor. Saves a new version. Same write-back modes as placeModel. Returns { ok, geometry, warnings? }.`,
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['auto', 'parametric', 'bake'], description: "Write-back mode. Default 'auto'." },
        preserveColor: { type: 'boolean', description: 'Carry existing paint when baking. Default true.' },
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

/** Tools whose effect is scoped to a single part — they read or mutate the
 *  active part's code, geometry, paint, or version history. Each gains an
 *  optional `part` target (injected below) so the model can address a part
 *  directly instead of leaning on the shared "current part" pointer, which the
 *  human can move from the part menu mid-turn. When `part` is supplied,
 *  executeTool switches focus to it *before* running the op (see
 *  `focusTargetPart`), so the op always acts on the part the model named — not
 *  on whatever the user last clicked. The part-management tools (listParts /
 *  changePart / createPart / …) are deliberately excluded: they already take an
 *  explicit target or operate at the session level. */
export const PART_TARGETABLE_TOOLS = new Set<string>([
  'getActiveLanguage', 'setActiveLanguage',
  'getCode', 'setCode', 'runCode', 'runAndSave', 'runAndAssert', 'runAndExplain',
  'getParams', 'setParams', 'getGeometryData', 'getMeshSummary', 'getFeatureCentroids',
  'listVersions', 'loadVersion', 'saveVersion', 'forkVersion', 'copyColorsFromVersion',
  'modifyAndTest', 'query', 'findFaces', 'listComponents', 'listLabels', 'getModelColors',
  'listRegions', 'probePixel', 'probeRay', 'paintPreview', 'paintExplain',
  'paintRegion', 'paintFaces', 'paintNear', 'paintStroke', 'paintImage', 'paintInBox', 'paintInOrientedBox',
  'paintSlab', 'paintNearestRegion', 'paintComponent', 'paintByLabel', 'paintByLabels',
  'paintConnected', 'paintInCylinder', 'undoLastPaint', 'redoLastPaint', 'removeRegion',
  'clearColors', 'assertPaint', 'sliceAtZVisual', 'checkPrintability',
  'renderView', 'renderViews',
  'applySurfaceTexture', 'applyVoronoiLamp', 'engraveModel', 'voxelizeModel',
  'scaleModel', 'placeModel', 'rotateModel', 'layFlatModel',
]);

// The shared `part` target schema, injected into every targetable tool so the
// description stays in one place. Typeless on purpose — it accepts a name/id
// string OR a 0-based index number (resolvePartTarget in main.ts handles both).
const PART_TARGET_PROP = {
  description: 'Optional. The part to act on — addressed by its name, its id (from listParts), or its 0-based index. Defaults to the current part. Pass this to target a specific part directly instead of relying on the current selection; it also makes a separate changePart call unnecessary. Switching focus to the part is visible to the user.',
};
for (const tool of ALL_TOOLS) {
  if (PART_TARGETABLE_TOOLS.has(tool.name) && !('part' in tool.input_schema.properties)) {
    tool.input_schema.properties.part = PART_TARGET_PROP;
  }
}

const ALWAYS_AVAILABLE = new Set([
  'getActiveLanguage',
  'setActiveLanguage',
  'getCode',
  'setCode',
  'getParams',
  'getGeometryData',
  'getMeshSummary',
  'getFeatureCentroids',
  'getReferenceImages',
  'getAttachments',
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
  'getModelColors',
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
  // Reconstruction measurements — pure reads over the mesh/import, no
  // mutation, so they're always available (like query/probeRay).
  'evalAgainstImport',
  'profileModel',
  'compareToImport',
  'fitInscribed',
  'paintInCylinder',
  'checkPrintability',
  'getPrinterSettings',
  'setPrinterSettings',
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

/** Pure-read tools the model may call during plan mode to ground its plan in
 *  the current session state (open code, versions, geometry, notes, docs).
 *  Deliberately excludes anything that mutates the session (setCode,
 *  modifyAndTest, forkVersion, createPart, importImageAsRelief,
 *  setActiveLanguage, setPrinterSettings, setReliefPreviewMode) AND anything
 *  that executes user code (runCode, runAndAssert, runAndExplain, runIsolated)
 *  — the point of plan mode is to plan, not to build. renderView/renderViews
 *  are allowed because they only snapshot the current saved geometry (no code
 *  execution), and they stay gated by the Views vision toggle so the user's
 *  cost preferences still apply. */
const PLAN_MODE_TOOLS = new Set([
  'getActiveLanguage', 'getCode', 'getParams', 'getGeometryData', 'getMeshSummary',
  'getFeatureCentroids', 'getReferenceImages', 'getAttachments', 'getSessionContext', 'listVersions',
  'listSessionNotes', 'readDoc', 'findFaces', 'listComponents', 'listLabels',
  'getModelColors',
  'listRegions', 'probePixel', 'paintPreview', 'paintExplain', 'query', 'probeRay',
  'listParts', 'getCurrentPart', 'assertPaint', 'sliceAtZVisual', 'checkPrintability',
  'getPrinterSettings', 'getReliefSwapGuide',
  // Idempotent renders of the CURRENT saved geometry — no code execution, no
  // mutation. Still gated by VIEWS_GATED below so vision-off keeps them out.
  'renderView', 'renderViews',
  // Reconstruction measurements — pure reads, safe while planning
  'evalAgainstImport', 'profileModel', 'compareToImport', 'fitInscribed',
]);

/** Tools that are safe to auto-retry on error: pure reads/queries, idempotent
 *  renders, and runs that don't commit (re-executing reproduces the same
 *  transient state). The chat loop's `autoRetry` re-invokes a failed tool, so
 *  it must NOT re-run non-idempotent mutations — `runAndSave`/`saveVersion`/
 *  `forkVersion` (would duplicate a version), the `paint*` family (would
 *  double-paint or stack a second region), `addSessionNote` (would append
 *  twice), the relief imports (already confirmed once — a retry skips the
 *  prompt), the surface modifiers (re-bake), `modifyAndTest` (a patch won't
 *  re-match after it's applied), and the part/code mutators. Anything not in
 *  this set runs exactly once even when the user opted into retries. */
export const RETRY_SAFE_TOOLS = new Set([
  // Pure reads / queries
  'getActiveLanguage', 'getCode', 'getParams', 'getGeometryData', 'getMeshSummary',
  'getFeatureCentroids', 'getReferenceImages', 'getAttachments', 'getSessionContext', 'listVersions',
  'listSessionNotes', 'readDoc', 'findFaces', 'listComponents', 'listLabels',
  'getModelColors',
  'listRegions', 'probePixel', 'paintPreview', 'paintExplain', 'query', 'probeRay',
  'listParts', 'getCurrentPart', 'assertPaint', 'sliceAtZVisual', 'checkPrintability',
  'getPrinterSettings', 'getReliefSwapGuide',
  // Idempotent reconstruction measurements
  'evalAgainstImport', 'profileModel', 'compareToImport', 'fitInscribed',
  // Idempotent renders (produce a snapshot; no persistent mutation)
  'renderView', 'renderViews', 'runIsolated',
  // Run-without-commit (re-running the same code reproduces the same state)
  'runCode', 'runAndAssert', 'runAndExplain',
]);

const RUN_GATED = new Set(['runCode', 'setParams']);
const SAVE_GATED = new Set(['runAndSave', 'loadVersion', 'saveVersion', 'applySurfaceTexture', 'applyVoronoiLamp', 'engraveModel', 'voxelizeModel', 'convertToCode', 'scaleModel', 'placeModel', 'rotateModel', 'layFlatModel']);
const PAINT_GATED = new Set(['paintRegion', 'paintFaces', 'paintNear', 'paintStroke', 'paintImage', 'paintInBox', 'paintInOrientedBox', 'paintSlab', 'paintNearestRegion', 'paintComponent', 'paintByLabel', 'paintByLabels', 'paintConnected', 'undoLastPaint', 'redoLastPaint', 'removeRegion', 'clearColors', 'copyColorsFromVersion']);
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
  // Plan-mode turns expose the pure-read subset (PLAN_MODE_TOOLS) so the model
  // can ground its plan in the actual session state — the open code, saved
  // versions, geometry stats, session notes, and docs — instead of guessing.
  // Mutating tools and code-execution tools stay hidden until the user
  // approves. renderView/renderViews are still filtered by VIEWS_GATED so a
  // vision-off session doesn't pay for images during planning either.
  if (toggles.planFirst) {
    return ALL_TOOLS.filter(t => {
      if (!PLAN_MODE_TOOLS.has(t.name)) return false;
      if (VIEWS_GATED.has(t.name)) return toggles.vision.views;
      return true;
    });
  }

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

/** Switch focus to the part a part-scoped tool named via its `part` target, so
 *  the op runs against that part rather than whatever the user last selected in
 *  the part menu. `target` is a part name, id, or 0-based index (mirrors
 *  resolvePartTarget on the API side). No-op when the target is already current
 *  — which avoids reloading the part and clobbering any in-progress editor draft
 *  on it. Returns an error string on a bad target, or null on success. */
async function focusTargetPart(api: PartwrightAPI, target: string | number): Promise<string | null> {
  const parts = api.listParts() as Array<{ id: string; name: string; order: number; isCurrent: boolean }> | undefined;
  if (!Array.isArray(parts) || parts.length === 0) {
    return `Cannot target part ${JSON.stringify(target)}: no active session with parts. Open a session first.`;
  }
  let match: { id: string; isCurrent: boolean } | undefined;
  if (typeof target === 'number') {
    if (!Number.isInteger(target) || target < 0) return `Cannot target part: index must be a non-negative integer (got ${JSON.stringify(target)}).`;
    match = [...parts].sort((a, b) => a.order - b.order)[target];
  } else {
    match = parts.find(p => p.id === target) ?? parts.find(p => p.name === target);
  }
  if (!match) return `Cannot target part ${JSON.stringify(target)}: no matching part (by name, id, or index). Call listParts() to see what's available.`;
  if (match.isCurrent) return null; // already focused — don't reload and clobber an in-progress edit
  const switched = await api.changePart(match.id) as { error?: string } | undefined;
  if (switched && typeof switched === 'object' && 'error' in switched && switched.error) {
    return `Cannot target part ${JSON.stringify(target)}: ${switched.error}`;
  }
  return null;
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
    // Part addressing: a part-scoped tool may name a `part` target (name, id, or
    // 0-based index). Switch focus to it before running so the op acts on the
    // addressed part — not whatever the user last clicked. Strip the key first so
    // the per-tool APIs (which reject unknown keys) never see it.
    if (PART_TARGETABLE_TOOLS.has(name)) {
      const target = input.part as string | number | undefined;
      delete input.part;
      if (target != null) {
        const focusErr = await focusTargetPart(api, target);
        if (focusErr) return { content: focusErr, isError: true };
      }
    }
    // Tools that ship images back to the model bypass the generic JSON
    // dispatch — they need the data-URL → multimodal-image wrapping.
    if (name === 'renderView') return executeRenderView(api, input);
    if (name === 'renderViews') return await executeRenderViews(api, input);
    if (name === 'runIsolated') return await executeRunIsolated(api, input);
    if (name === 'sliceAtZVisual') return await executeSliceAtZVisual(api, input);
    if (name === 'getReferenceImages') return await executeGetReferenceImages(api);
    if (name === 'getAttachments') return executeGetAttachments(api);

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
const SUBDOC_NAMES = new Set<string>(SUBDOC_NAMES_LIST);

/** Fetch a topic subdoc by short name. Same fetch path for Anthropic and
 *  local providers — both run inside the user's browser tab, so this is
 *  served by the dev server / Cloudflare Pages alongside the rest of the
 *  static site. The model gets the raw markdown back as the tool result. */
async function readSubdoc(name: string): Promise<{ content: string; isError: boolean }> {
  if (!SUBDOC_NAMES.has(name)) {
    return { content: `Unknown subdoc "${name}". Valid names: ${Array.from(SUBDOC_NAMES).join(', ')}.`, isError: true };
  }
  try {
    const res = await fetch(assetPath(`/ai/${name}.md`), { cache: 'force-cache' });
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

async function executeGetReferenceImages(api: PartwrightAPI): Promise<ToolExecResult> {
  const raw = typeof api.getImages === 'function' ? api.getImages() : [];
  const images = (Array.isArray(raw) ? raw : []) as Array<{ src?: string; label?: string }>;
  const usable = images
    .filter(im => typeof im.src === 'string' && im.src.length > 0)
    .map(im => ({ src: im.src as string, label: im.label }));
  if (usable.length === 0) {
    return {
      content: 'No reference images are attached to this session. If the task refers to photos or views, ask the user to attach them in the Attachments panel (or via the Self-Modeling Studio) — do not invent a subject. (Non-image attachments, if any, are listed by getAttachments.)',
      isError: false,
    };
  }
  const labels = usable.map((im, i) => `${i + 1}. ${im.label?.trim() || '(no label)'}`).join('\n');
  let grid: ImageSource | null = null;
  try { grid = await compositeReferenceGrid(usable); } catch { grid = null; }
  if (!grid) {
    return { content: `${usable.length} reference image(s) attached, but the grid could not be rendered. Labels:\n${labels}`, isError: false };
  }
  return {
    content: `${usable.length} reference image(s), tiled left-to-right, top-to-bottom in the attached grid:\n${labels}`,
    image: grid,
    isError: false,
  };
}

interface AttachmentEntry {
  id?: string;
  kind?: string;
  mediaType?: string;
  src?: string;
  label?: string;
  description?: string;
  addedAt?: number;
  source?: string;
}

/** Decode a text attachment's `data:` URL to its string contents, capped so a
 *  large file can't blow the tool result. Returns null when it isn't decodable
 *  inline (remote URL, non-text payload). */
function decodeTextAttachment(src: string | undefined): string | null {
  if (!src || !src.startsWith('data:')) return null;
  const comma = src.indexOf(',');
  if (comma < 0) return null;
  const meta = src.slice(5, comma);
  const payload = src.slice(comma + 1);
  const CAP = 4000;
  try {
    let text: string;
    if (/;base64/i.test(meta)) {
      const bin = atob(payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      text = new TextDecoder().decode(bytes);
    } else {
      text = decodeURIComponent(payload);
    }
    return text.length > CAP ? `${text.slice(0, CAP)}\n…(truncated, ${text.length} chars total)` : text;
  } catch {
    return null;
  }
}

function executeGetAttachments(api: PartwrightAPI): ToolExecResult {
  const raw = typeof api.getAttachments === 'function' ? api.getAttachments() : [];
  const items = (Array.isArray(raw) ? raw : []) as AttachmentEntry[];
  if (items.length === 0) {
    return {
      content: 'No attachments are pinned to this session. Reference files (images, models, PDFs, notes) added in the Attachments panel — or images uploaded in this chat — would appear here. If the task needs reference material, ask the user to attach it.',
      isError: false,
    };
  }
  const imageCount = items.filter(a => a.kind === 'image').length;
  const lines: string[] = [];
  items.forEach((a, i) => {
    const when = typeof a.addedAt === 'number' ? new Date(a.addedAt).toISOString().slice(0, 10) : 'date unknown';
    const parts = [
      `${i + 1}. [${a.kind ?? 'other'}] ${a.label?.trim() || '(no label)'}`,
      a.mediaType ? `type=${a.mediaType}` : null,
      `added ${when}`,
      a.source ? `via ${a.source}` : null,
      a.id ? `id=${a.id}` : null,
    ].filter(Boolean);
    lines.push(parts.join(' · '));
    // The description is the user's "why this matters" note — the most
    // important signal for the model, so surface it prominently per entry.
    const desc = a.description?.trim();
    if (desc) lines.push(`   ↳ ${desc.replace(/\n/g, ' ')}`);
    if (a.kind === 'text') {
      const text = decodeTextAttachment(a.src);
      if (text) lines.push(`   ---\n${text.split('\n').map(l => `   ${l}`).join('\n')}\n   ---`);
    }
  });
  const hint = imageCount > 0
    ? `\n\n${imageCount} image attachment(s) above — call getReferenceImages to view them.`
    : '';
  return {
    content: `${items.length} attachment(s) pinned to this session:\n${lines.join('\n')}${hint}`,
    isError: false,
  };
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
      // preserveCamera: an AI re-render keeps the user's current orbit/zoom
      // instead of snapping back to the default framing every turn.
      return api.run(input.code as string | undefined, { preserveCamera: true });
    case 'runAndSave':
      return api.runAndSave(input.code as string, input.label as string | undefined, input.assertions as Record<string, unknown> | undefined, { preserveCamera: true });
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
    case 'paintImage': {
      // Resolve the image source: imageUrl wins; else imageRef indexes the
      // session reference images (1-based, matching getReferenceImages).
      let imageUrl = typeof input.imageUrl === 'string' ? input.imageUrl : undefined;
      if (!imageUrl && input.imageRef != null) {
        const imgs = typeof api.getImages === 'function' ? api.getImages() : [];
        // Index the SAME filtered list getReferenceImages numbers (entries with a
        // usable src), so a 1-based imageRef the model read there resolves here.
        const list = ((Array.isArray(imgs) ? imgs : []) as Array<{ src?: string }>)
          .filter(im => typeof im.src === 'string' && im.src.length > 0);
        const entry = list[Number(input.imageRef) - 1];
        if (!entry) {
          return { error: `paintImage: no reference image at index ${input.imageRef}. Call getReferenceImages to list attached images and their indices.` };
        }
        imageUrl = entry.src;
      }
      if (!imageUrl) {
        return { error: 'paintImage: provide imageRef (1-based index from getReferenceImages) or imageUrl.' };
      }
      return api.paintImage({
        imageUrl,
        view: input.view,
        label: input.label,
        at: input.at,
        normal: input.normal,
        size: input.size,
        rotationDeg: input.rotationDeg,
        detail: input.detail,
        removeBackground: input.removeBackground,
        name: input.name,
      });
    }
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
    case 'getModelColors':
      return api.getModelColors();
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
      return api.changePart((input.part ?? input.id) as string | number);
    case 'renamePart':
      return api.renamePart((input.part ?? input.id) as string | number, input.name as string);
    case 'deletePart':
      return api.deletePart((input.part ?? input.id) as string | number);
    case 'assertPaint':
      return api.assertPaint(input);
    case 'paintInCylinder':
      return api.paintInCylinder(input);
    case 'checkPrintability':
      return api.checkPrintability(input);
    case 'getPrinterSettings':
      return api.getPrinterSettings();
    case 'setPrinterSettings':
      return api.setPrinterSettings(input);
    case 'importImageAsRelief':
      return api.importImageAsRelief(input);
    case 'importSvgAsRelief':
      return api.importSvgAsRelief(input);
    case 'getReliefSwapGuide':
      return api.getReliefSwapGuide();
    case 'setReliefPreviewMode':
      return api.setReliefPreviewMode(input.mode);
    case 'applySurfaceTexture':
      return api.applySurfaceTexture(
        input.id as 'fuzzy' | 'knit' | 'cable' | 'waffle' | 'fur' | 'woven' | 'knurl' | 'voronoi' | 'smooth',
        input.opts as Record<string, number | boolean | string> | undefined,
        input.mode as 'auto' | 'code' | 'bake' | undefined,
      );
    case 'applyVoronoiLamp':
      return api.applyVoronoiLamp(input);
    case 'engraveModel':
      return api.engraveModel(input);
    case 'voxelizeModel':
      return api.voxelizeModel(input);
    case 'convertToCode':
      return api.convertToCode(input);
    case 'evalAgainstImport':
      return api.evalAgainstImport(
        input.index as number | undefined,
        input.samples !== undefined ? { samples: input.samples as number } : undefined,
      );
    case 'profileModel':
      return api.profileModel(input);
    case 'compareToImport':
      return api.compareToImport(
        input.index as number | undefined,
        input.maxFindings !== undefined ? { maxFindings: input.maxFindings as number } : undefined,
      );
    case 'fitInscribed':
      return api.fitInscribed(input);
    case 'scaleModel':
      return api.scaleModel(input.sx as number, input.sy as number, input.sz as number, { mode: input.mode as 'auto' | 'parametric' | 'bake' | undefined, preserveColor: input.preserveColor as boolean | undefined });
    case 'placeModel':
      return api.placeModel(input);
    case 'rotateModel':
      return api.rotateModel(input);
    case 'layFlatModel':
      return api.layFlatModel(input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
