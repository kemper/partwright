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

import { detectorIds, paramsJsonSchema } from '../segmentation/registry';
import type { ChatToggles } from './types';
import type { Language } from '../geometry/engines/types';
import { RENDER_VIEW_MODES, EDGE_MODES } from '../renderer/multiview';
import { getRenderBudget } from './settings';
import { assetPath } from '../deployment';
import { applyLiteralPatch, applyPatches } from './patch';
import { specJsonSchema } from '../figure/characterSpec';

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
  'visual-verification', 'spending', 'manifold-api', 'reconstruction', 'deform', 'segmentation',
  // Deprecated: 'print-fit' split into 'fasteners' + 'joints'. Kept so an older
  // cached prompt requesting it gets the redirect stub instead of an error.
  'print-fit',
] as const;

/** Part-detection schema pieces, derived from the detector registry so a new
 *  detector or param reaches the AI tools without editing this file. */
const PART_DETECTOR_IDS = detectorIds();
const PART_PARAMS_SCHEMA = paramsJsonSchema();

/** AI tools pass part refs as strings (one JSON type keeps the schema inside
 *  Gemini's subset); turn numeric strings back into the 1-based ids the API
 *  takes, leaving names alone. */
function normalizePartOps(ops: unknown): unknown {
  if (!Array.isArray(ops)) return ops;
  const ref = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v);
  return ops.map((op) => {
    if (!op || typeof op !== 'object') return op;
    const o = { ...(op as Record<string, unknown>) };
    if ('id' in o) o.id = ref(o.id);
    if ('to' in o) o.to = ref(o.to);
    if (Array.isArray(o.ids)) o.ids = o.ids.map(ref);
    // focus with no id (or "none") clears the focus.
    if (o.op === 'focus' && (o.id === undefined || o.id === '' || o.id === 'none')) o.id = null;
    return o;
  });
}

/** A part-ref list from an AI tool call (strings; all-digit = 1-based id). */
function partRefs(v: unknown): unknown[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map((x) => (typeof x === 'string' && /^\d+$/.test(x.trim()) ? Number(x.trim()) : x));
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
    name: 'buildCharacter',
    description: 'Build a posed, painted figure from a Character Creator SPEC and commit it as a version — the token-cheap way to make a person/toy figure: fill in parameters instead of writing + debugging figure code. Any subset of fields; missing ones take defaults; every field is validated (bad ones are listed in the error). Style: body.proportions "realistic" | "chibi" | "funko" (vinyl-pop: huge wide head; also set headsTall 3), body.headScale {x,y,z} to resize the head. body.headSink (≈0.4 = neckless toy), body.mittens. Face: eyeStyle "bead" (glossy toy eyes + glint), browThickness/browWidth (bold brows ≈ 3/1.5), jaw/chin/cheek. Hair: "anime" (flat swoopy ribbon locks: lockShape/chunk/spike/swoop/fringe/seed), "shag" (layered spiky jet-black mop: crown/layers/raggedness/flare/notched/crownSize/backWidth/tipWidth), "captured" (the Tsubasa Funko hairdo: volume/length/capturedFringe/spikiness/smooth/tilt/windowScale/mirror) or "mop". pose.hold {kind:"ball", radius, cup, cupL?, cupR?, handScale} = both hands hold a soccer ball (colors.ball base + pose.hold.color panels). Clothing: top.trim {collar, cuffs} (colors.trim); top.print [{text, where:"chest"|"back", size, x, z, color}] = embossed letters/numbers (e.g. N on the chest, 10 on the back); pants.length "shorts" (knee-length, hem) | "briefs"; socks {on, height, stripes, stripeSpan} (colors.socks + colors.sockStripe); feet {style:"toy", size, height, cleats} = chunky vinyl sneakers with studs. Colors are "#rrggbb" per region (skin, hair, top, pants, feet, sole, eyes/iris/pupil, eyeHighlight, lips, brows, trim, socks, sockStripe, base, ball). Figure-from-a-photo loop: view the photo once → fill the spec → buildCharacter → photoMatch (text only) → adjust spec fields from worst[] → repeat; tweak with getCharacterSpec. Returns geometry stats + version (the generated code is NOT echoed — call getCode only if you must hand-edit something the spec cannot express).',
    input_schema: {
      type: 'object',
      properties: {
        spec: specJsonSchema(),
        label: { type: 'string', description: 'Version label (default "Character").' },
      },
      required: ['spec'],
    },
  },
  {
    name: 'getCharacterSpec',
    description: 'Read the Character Creator spec embedded in the current code (its `// @character` header; older v1 specs are migrated). Returns {spec, version} — the full normalized spec, every detail field included (trim, print, socks, toy shoes, bead eyes, head sink, hair knobs) — or {error} when the code was not generated by buildCharacter. Edit fields and pass the spec back to buildCharacter.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'listCharacterPresets',
    description: 'List the Character Creator starting characters (the panel\'s preset cards: child, elder, chibi, Funko soccer star, vinyl toy, anime hero, elf, mannequin, …) as [{id, label, description}]. Pass id to get that preset\'s full spec — a ready starting point to tweak and hand to buildCharacter.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'A preset id from the list; returns {id, label, description, spec}.' } },
    },
  },
  {
    name: 'randomCharacter',
    description: 'Build a random but coherent figure (the panel\'s 🎲 Random: a body-plan style — realistic / chibi / funko — and age drive proportions; hair, clothing, pose and colours are drawn from the spec\'s options) and commit it as a version. Returns {seed, spec, geometry, version}; the same seed re-creates the same character, and the spec can be tweaked and passed to buildCharacter.',
    input_schema: {
      type: 'object',
      properties: {
        seed: { type: 'integer', minimum: 0, maximum: 4294967295, description: 'Reproducible roll (omit for a fresh one).' },
        label: { type: 'string', description: 'Version label (default "Random character").' },
      },
    },
  },
  {
    name: 'photoMatch',
    description: 'TEXT-ONLY likeness check of the current model against a reference photo — call this INSTEAD of renderView/renderViews for routine "does it look like the photo yet?" passes, and keep image renders for checkpoints (e.g. every 3–5 edits, or before finishing). Renders the model flat from `view` (default front: azimuth 0, elevation 0, ortho — match the photo\'s camera; azimuth 0 = model front faces -Y, 90 = faces +X), segments the photo (backdrop estimated from its border, or pass `bg`), normalises both silhouettes to a common height and returns: silhouetteIoU (1 = identical outline), aspect (model vs photo w/h), bands[] (10 horizontal slices top→bottom: photo/model width as % of height, widthDiffPct, dx centre offset), regions[] (per api.label part: iou, areaRatio, widthRatio/heightRatio, dx/dy centroid offset in % of height, photoColor vs model colour) and worst[] — the 3–5 most actionable findings in plain words (e.g. "hair: model 27% narrower across bands 0–1", "shoes: model region 28% smaller"). Fix the worst[] items, re-run photoMatch, and watch silhouetteIoU climb. Exclude parts the photo does not show (e.g. a display base) with `exclude`. If warnings say the photo silhouette touches the crop edge, or the aspect differs wildly, pass `crop`, `bg`, `pixelAspect` (stretched video frames) or `fit: "box"` (compare proportions only). Needs labelled parts with colours for the region analysis (silhouette metrics work without). outline[] is a compact text diff of the outline ("photo-only at bands 2–4 left: up to 3.1% of height (hair) → grow"); bands also carry left/right edge offsets (outward-positive). Pass `bands: 20` for a finer profile once the coarse shape is right. Have photos from several angles? Pass `views: [{image, azimuth, elevation}, …]` to score them all in one call (returns the mean silhouetteIoU + per-view results). Parts the photo cannot tell apart (white ball on a white shirt) come back with `lowConfidence` and their size findings suppressed — `merge` them ([["jersey","ball"]]) or `ignore` them. Busy backdrop: the scorer auto-switches to a colour model; pass `mask` (attachment id of a white-on-black silhouette) if it still fails. warnings[] also flag a reference too small to judge fine detail.',
    input_schema: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'Reference photo: an image attachment id or label (from getAttachments / getReferenceImages), or a data:image/ URL. Omit when exactly one image is attached.' },
        view: {
          type: 'object',
          description: 'Camera for the model render, matching the photo. Default {azimuth: 0, elevation: 0, ortho: true} (front).',
          properties: {
            azimuth: { type: 'number', description: 'Degrees. 0 = front (camera at -Y), 90 = right (+X), 180 = back, 270 = left.' },
            elevation: { type: 'number', description: 'Degrees, 0 = horizon, positive = looking down.' },
            ortho: { type: 'boolean', description: 'Orthographic projection (default true).' },
          },
        },
        crop: { type: 'object', description: 'Optional crop of the photo in its pixels {x, y, w, h} — isolate one view of a multi-view sheet or cut away clutter.', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } },
        bg: { type: 'string', description: 'Photo background colour "#rrggbb" when auto-estimation fails (busy or vignetted backdrops).' },
        bgTolerance: { type: 'number', description: 'RGB distance around bg (or the estimated backdrop) that counts as background.' },
        exclude: { type: 'array', items: { type: 'string' }, description: 'Part (label) names to leave out of the model render, e.g. ["base"] when the photo shows no stand.' },
        fit: { type: 'string', enum: ['height', 'box'], description: '"height" (default): common height, aspect kept. "box": also stretch the model to the photo width, comparing proportions only.' },
        pixelAspect: { type: 'number', description: 'Multiply the photo\'s widths by this before comparing (e.g. 0.6 for a horizontally stretched video frame). Default 1.' },
        bands: { type: 'integer', description: 'Horizontal bands in the width/edge profile (default 10, 2–60). Use 20 for fine outline work.' },
        merge: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Part groups scored as ONE region, e.g. [["jersey","ball","socks","shoes"]] when the photo cannot separate them.' },
        ignore: { type: 'array', items: { type: 'string' }, description: 'Part names left out of the region findings (they still count toward the silhouette).' },
        mask: { type: 'string', description: 'Manual subject silhouette for the photo (white = subject): an image attachment id/label or data:image/ URL. Overrides background estimation.' },
        bgMode: { type: 'string', enum: ['auto', 'border', 'grabcut'], description: '"auto" (default): border-estimated backdrop, switching to a colour model when the border is busy. "grabcut": always use the colour model. "border": never switch.' },
        views: {
          type: 'array',
          description: 'Score several photos/angles in one call (replaces image/view/mask). Each: {image, azimuth, elevation, ortho?, label?, crop?, bg?, bgTolerance?, mask?, pixelAspect?}; top-level crop/bg/bgTolerance/pixelAspect are defaults.',
          items: {
            type: 'object',
            properties: {
              image: { type: 'string' },
              azimuth: { type: 'number' },
              elevation: { type: 'number' },
              ortho: { type: 'boolean' },
              label: { type: 'string' },
              crop: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } },
              bg: { type: 'string' },
              bgTolerance: { type: 'number' },
              mask: { type: 'string' },
              pixelAspect: { type: 'number' },
            },
          },
        },
      },
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
    name: 'probePixels',
    description: 'Batch probePixel: probe MANY pixels of one renderView image in one call (one camera, one BVH) -> {results:[{pixel, hit, point?, normal?, triangleId?}], hitCount, missCount, modelPixelBounds?}. Use to trace a seam, a stroke path or several seeds off a render in one round-trip instead of N probePixel calls. The view must match the renderView call.',
    input_schema: {
      type: 'object',
      properties: {
        pixels: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, description: '[[x, y], ...] pixel positions. (0, 0) is top-left.' },
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
      required: ['pixels', 'view'],
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
        withinPart: { type: 'string', description: 'Optional part (label) name: clip the paint to that part so it cannot bleed across its edge. Use the parts of an imported mesh after detectParts → acceptParts, or any api.label region (listLabels).' },
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
        withinPart: { type: 'string', description: 'Optional part (label) name: preview the selection clipped to that part, as a withinPart paint will be.' },
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
    description: 'Fetch one of the topic-specific docs from /ai/<name>.md. Use this when the core ai.md points you at a subdoc and you need its full content before writing code. Names: curves, bosl2, replicad, sdf, figure, voxel, colors, print-safety, fasteners, joints, gears, threads, reference-images, file-io, annotations, printing, relief, textures, mechanisms, deform, iteration-workflow, gotchas, visual-verification, spending, manifold-api.',
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
        withinPart: { type: 'string', description: 'Optional part (label) name: clip the paint to that part so it cannot bleed across its edge. Use the parts of an imported mesh after detectParts → acceptParts, or any api.label region (listLabels).' },
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
        withinPart: { type: 'string', description: 'Optional part (label) name: ids outside that part are dropped.' },
      },
      required: ['triangleIds', 'color'],
    },
  },
  {
    name: 'getPartTriangles',
    description: 'Triangle ids of one PART (an api.label region, incl. parts accepted from detectParts) on the current paint mesh -> {name, count, area, bbox, triangleIds, truncated?}. Mostly for inspection — to paint inside a part pass `withinPart` to the paint tools instead.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Part (label) name (listLabels / listObjectParts).' },
        maxResults: { type: 'integer', minimum: 1, description: 'Cap on returned ids (default 5000); count is always the full size.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'partBoundary',
    description: 'The seam between two parts (labels) as ordered polylines of surface points -> {loops:[{points, closed, length, pointCount}], count}, longest first. A collar running round the neck is one closed loop. Use to measure a seam or place things along it; to PAINT a band along it use paintAlongBoundary.',
    input_schema: {
      type: 'object',
      properties: {
        a: { type: 'string', description: 'First part (label) name.' },
        b: { type: 'string', description: 'Second part (label) name.' },
        maxPointsPerLoop: { type: 'integer', minimum: 2, description: 'Resample long loops to at most this many points (default 256).' },
      },
      required: ['a', 'b'],
    },
  },
  {
    name: 'paintAlongBoundary',
    description: 'Paint a smooth band along the seam between two parts — collars, cuffs, hems, sock bands, belt edges: features with NO sculpted groove of their own, which part detection cannot find and seeds should not be used for. Each seam loop becomes a smooth paintStroke (clean curved edges). side "a"/"b" puts the whole width on that part with the band edge exactly on the seam; "both" (default) centres it on the seam. -> {regions:[{id,name,triangles}], loops}.',
    input_schema: {
      type: 'object',
      properties: {
        between: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2, description: '[partA, partB] — two touching parts (labels).' },
        width: { type: 'number', description: 'Band width in model units.' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[r,g,b] 0..1' },
        side: { type: 'string', enum: ['a', 'b', 'both'], description: 'Where the band lies (default "both").' },
        name: { type: 'string' },
        resolution: { type: 'number', description: 'paintStroke smoothness (target edge = width / resolution).' },
        maxEdge: { type: 'number', description: 'Absolute target edge length (overrides resolution).' },
      },
      required: ['between', 'width', 'color'],
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
        withinPart: { type: 'string', description: 'Optional part (label) name: clip the paint to that part so it cannot bleed across its edge. Use the parts of an imported mesh after detectParts → acceptParts, or any api.label region (listLabels).' },
      },
      required: ['point', 'radius', 'color'],
    },
  },
  {
    name: 'paintStroke',
    description: 'Paint a SMOOTH brush stroke along a path of surface points, subdividing the mesh under the stroke so the painted edge is rounded (not stair-stepped along triangle boundaries). This is the only paint tool that changes the tessellation — it is more expensive than the region selectors, so reach for `paintNear`/`paintInBox`/`paintConnected`/`paintRegion` first and use this ONLY when a visibly rounded painted edge matters (e.g. a curved racing stripe, a soft-edged logo patch). Get `points` from `probePixel` against a rendered view (render → pick pixels along the desired stroke → probePixel each → pass the world-space hits here). `radius` is in mesh units. `points` is a path: gaps between consecutive points are filled automatically, so a few corner points paint a continuous band. `resolution` sets smoothness (target triangle edge = radius / resolution; higher = smoother + more triangles), default 16, range 2–1024 (the edge is clipped exactly, so 16 already gives a smooth curve). For absolute control, `maxEdge` overrides it with a target edge length in mesh units (e.g. maxEdge 0.1 for crisp 0.1-unit edges). `shape` is circle (default), square, or diamond.',
    input_schema: {
      type: 'object',
      properties: {
        points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, description: 'Ordered world-space surface points [[x,y,z], ...] along the stroke path (from probePixel). A single point stamps a rounded dot.' },
        radius: { type: 'number', description: 'Brush radius in mesh units (must be > 0).' },
        resolution: { type: 'number', description: 'Smoothness detail: target triangle edge = radius / resolution. Higher = smoother + more triangles. Default 16, clamped 2–1024.' },
        maxEdge: { type: 'number', description: 'Optional absolute override for the target edge length (mesh units). Takes precedence over resolution.' },
        shape: { type: 'string', enum: ['circle', 'square', 'diamond'], description: 'Brush footprint shape. Default "circle".' },
        wrapAngleDeg: { type: 'number', description: 'Wrap tolerance (0–180): the max edge bend, in degrees, paint may flow across. The stroke follows gentle curves/bumps but stops at sharper folds — 90 stops at right-angle corners (so paint on one face of a box stays off the adjacent faces), 180 (default) wraps across any edge. Lower it to keep a stroke on a single face.' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        name: { type: 'string' },
        withinPart: { type: 'string', description: 'Optional part (label) name: clip the paint to that part so it cannot bleed across its edge. Use the parts of an imported mesh after detectParts → acceptParts, or any api.label region (listLabels).' },
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
        withinPart: { type: 'string', description: 'Optional part (label) name: clip the stamp to that part so it cannot spill onto neighbouring parts.' },
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
        withinPart: { type: 'string', description: 'Optional part (label) name: clip the paint to that part so it cannot bleed across its edge. Use the parts of an imported mesh after detectParts → acceptParts, or any api.label region (listLabels).' },
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
        withinPart: { type: 'string', description: 'Optional part (label) name: clip the paint to that part so it cannot bleed across its edge. Use the parts of an imported mesh after detectParts → acceptParts, or any api.label region (listLabels).' },
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
        withinPart: { type: 'string', description: 'Optional part (label) name: clip the paint to that part so it cannot bleed across its edge. Use the parts of an imported mesh after detectParts → acceptParts, or any api.label region (listLabels).' },
        smooth: { type: 'boolean', description: 'Smooth the slab edges by subdividing the mesh along them. Default true; pass false for the raw (blocky) tessellation.' },
        resolution: { type: 'number', description: 'Smoothing detail: target boundary edge = model bbox diagonal / resolution. Higher = smoother + more triangles. Default 256, range 2–1024.' },
        maxEdge: { type: 'number', description: 'Optional absolute override for the target boundary edge length (mesh units). Takes precedence over resolution.' },
      },
      required: ['offset', 'thickness', 'color'],
    },
  },
  {
    name: 'paintPattern',
    description: 'Paint an algorithmic colour PATTERN over a part in ONE call: "soccer" (truncated-icosahedron ball — 12 pentagons in colors[1] on colors[0], fitted to the part), "stripes", "spots", "patches", "gradient", "checker". Scope it with withinPart (a label / detected part). smooth:true (soccer, stripes, checker) clips the colour seams sub-triangle so edges are crisp, saved as one small descriptor — NEVER fake pattern edges with many paintStroke calls (that bloats the session and still leaves pinholes). Soccer recipe: {pattern:"soccer", withinPart:"ball", colors:["#ffffff","#111111"], smooth:true}. Returns {id, triangles, markTriangles, meshTriangles, smooth, maxEdge, sphere?}.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', enum: ['soccer', 'stripes', 'spots', 'patches', 'gradient', 'checker'] },
        colors: { type: 'array', items: { type: 'string' }, description: 'Palette as hex strings: [base, mark, third?]. Soccer: [white, black].' },
        withinPart: { type: 'string', description: 'Part (label) to paint — e.g. a detected part after detectParts → acceptParts, or an api.label region (listLabels). Soccer fits the ball to this part.' },
        scope: { type: 'object', description: 'Optional extra narrowing: {label?, above?:{axis,at}, below?:{axis,at}, box?:{min,max}, sphere?:{center,radius}} (triangle-centroid tests, ANDed).' },
        scale: { type: 'number', description: 'Feature size (stripe period / spot spacing / checker cell). Default ~1/8 of the model diagonal. Unused by soccer.' },
        axis: { type: 'string', enum: ['x', 'y', 'z'], description: 'Stripe axis (bands run across it). Default z.' },
        warp: { type: 'number', description: 'Noise wiggle 0..1 for stripes/patches/checker edges.' },
        coverage: { type: 'number', description: 'Stripe duty / spot radius / base fraction (0..1). Soccer: pentagon size factor, 1 = standard ball, up to 1.45.' },
        seed: { type: 'number' },
        anchors: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'gradient: extremity points. soccer: anchors[0] = a world point one pentagon is centred toward (default +X of the ball centre); anchors[1] sets the roll (default +Z).' },
        smooth: { type: 'boolean', description: 'Clip seams sub-triangle along the analytic pattern boundary (soccer / stripes / checker only). Default false.' },
        resolution: { type: 'number', description: 'Smoothing detail: target edge = model diagonal / resolution. Default: soccer radius/100, else diagonal/256.' },
        maxEdge: { type: 'number', description: 'Absolute target edge length for the smoothed seam (overrides resolution).' },
        name: { type: 'string' },
      },
      required: ['pattern', 'colors'],
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
        withinPart: { type: 'string', description: 'Optional part (label) name: clip the paint to that part so it cannot bleed across its edge. Use the parts of an imported mesh after detectParts → acceptParts, or any api.label region (listLabels).' },
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
        region: { type: 'integer', description: 'Region id from listRegions().' },
        withinPart: { type: 'string', description: 'Only triangles of this part (label).' },
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
    name: 'listObjects',
    description: 'List the OBJECTS in the active session: [{id, name, order, isCurrent}]. A session can hold multiple objects — independent printable things, each with its own code and version history (each becomes its own object in a multi-object 3MF). The current object is the default target for runCode / runAndSave / paint / export, but those tools also take an optional `object` target (name, id, or index) so you can act on any object directly without switching focus first. Not to be confused with PARTS — the api.label regions inside one object (see listObjectParts).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getCurrentObject',
    description: "Return the active object {id, name, order}, or null when no session is open. You rarely need this: changeObject returns the object it switched to, listObjects marks the current one (isCurrent), and every object-scoped tool takes an `object` target — so prefer addressing objects by name/index over reading the current selection (which the user can change while you work).",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'createObject',
    description: 'Create a new, empty OBJECT in the active session and switch to it. The editor resets to a starter snippet; call runAndSave to commit its first version. Use for a second (third, …) separately-versioned, separately-printed thing in the same session (e.g. a box and its lid). To add a piece to the CURRENT model (a handle on a mug), edit its code instead — wrap the new shape in api.label(shape, "handle") so it shows up as a part.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Optional object name (e.g. "Lid"). Auto-named "Object N" when omitted.' },
      },
    },
  },
  {
    name: 'changeObject',
    description: "Switch the active object — i.e. change what the USER sees in the editor/viewport. Address it by name, id (from listObjects), or 0-based index. Loads that object's latest version. You usually do NOT need this just to work on a different object: every object-scoped tool (getCode, runCode, runAndSave, paint*, getGeometryData, …) takes an optional `object` target that addresses an object directly. Use changeObject only when you want to move the user's focus, or to reset the editor to an object's latest saved version.",
    input_schema: {
      type: 'object',
      properties: {
        object: { description: 'The object to switch to — its name, id (from listObjects), or 0-based index.' },
        id: { type: 'string', description: 'Deprecated alias for `object` — an object id from listObjects().' },
      },
    },
  },
  {
    name: 'renameObject',
    description: 'Rename an object. Address it by name, id (from listObjects), or 0-based index, and give the new name.',
    input_schema: {
      type: 'object',
      properties: {
        object: { description: 'The object to rename — its name, id (from listObjects), or 0-based index.' },
        id: { type: 'string', description: 'Deprecated alias for `object` — an object id from listObjects().' },
        name: { type: 'string', description: 'New object name.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'deleteObject',
    description: "Delete an object and all its versions. It moves to the session's Recover deleted bin (restoreObject brings it back until it expires). If the active object is deleted, an adjacent object becomes active. Deleting a session's only object resets it to a fresh, empty \"Object 1\" (result has reset: true). Address it by name, id (from listObjects), or 0-based index.",
    input_schema: {
      type: 'object',
      properties: {
        object: { description: 'The object to delete — its name, id (from listObjects), or 0-based index.' },
        id: { type: 'string', description: 'Deprecated alias for `object` — an object id from listObjects().' },
      },
    },
  },
  {
    name: 'listDeleted',
    description: 'List what can be undeleted in this session (the Recover deleted modal): objects in the deleted-objects bin {id, name, versionCount, deletedAt, expiresAt} and parts/pieces removed in code by deleteObjectPart {object, kind, name | point+label, call}. Use before restoreObject / restoreObjectPart.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'restoreObject',
    description: "Undelete an object from the Recover deleted bin (id or name from listDeleted().objects) with all of its versions, back at its old place in the object list. If the session's only object is an untouched blank (left by deleting the last object) it is replaced. Returns {restored, droppedBlank?}.",
    input_schema: {
      type: 'object',
      properties: {
        object: { type: 'string', description: 'Deleted object id or name from listDeleted().objects.' },
      },
      required: ['object'],
    },
  },
  {
    name: 'listPartDetectors',
    description: 'List the part-detection algorithms (see detectParts) with their params, defaults, whether they need seeds, and bestFor guidance, plus the editParts op list. Read before detecting parts on an imported mesh.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'detectParts',
    description: 'Split an IMPORTED mesh (e.g. a fused STL figurine) into named parts — hair, face, eyes, shirt, ball… — so paint can follow real part boundaries instead of boxes/slabs/normal floods. Creates a DRAFT (nothing saved), shows a coloured overlay and opens the Part Detection panel so the user can refine it by hand. "auto-merge" (Auto patches) needs no seeds: it splits the surface along its grooves into generic "patch N" parts — rename/merge them with editParts, or convert them to seeds (editParts seedsFromParts) and refine. For "crease-watershed" pass seeds: one or more {label, point} per part — get points from probePixel on a renderViews image; several seeds may share a label (add more for big or wrapped parts like a shirt front+back). Boundaries settle on the sculpted grooves between seeds and cover hidden surfaces too (inner arms behind a ball). "pieces" needs no seeds (separate bodies). Returns {parts:[{id,name,triCount,areaFrac,neighbors,regions,anchor}], quality, unassigned}. Then call renderParts to SEE the result and fix it with editParts. Read /ai/segmentation.md first.',
    input_schema: {
      type: 'object',
      properties: {
        algorithm: { type: 'string', enum: [...PART_DETECTOR_IDS], description: 'Detector id from listPartDetectors.' },
        seeds: {
          type: 'array',
          description: 'Named seed points (required by seeded detectors).',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Part name this seed belongs to.' },
              point: { type: 'array', items: { type: 'number' }, description: '[x, y, z] on the surface (from probePixel / probeRay).' },
              color: { type: 'string', description: 'Optional "#rrggbb": becomes the part\'s colour (kept through acceptParts). listPartDetectors labelPresets has default colours for common figure parts.' },
              maxRadius: { type: 'number', description: 'Optional cap (model units, measured along the surface) on how far this seed may grow — stops a seed on an ungrooved area leaking. Prefer paintAlongBoundary for collars/cuffs.' },
            },
            required: ['label', 'point'],
          },
        },
        params: PART_PARAMS_SCHEMA,
        featureOptions: {
          type: 'object',
          description: 'Shared surface analysis. Usually omit.',
          properties: {
            normalSmoothRadius: { type: 'number', minimum: 0, description: 'World-unit radius for denoising normals before measuring grooves. Omit = raw (default); try ~3× the mesh edge length only on very noisy scans.' },
            normalSmoothEdgeLengths: { type: 'number', minimum: 0, description: 'Same denoise, as a multiple of the median edge length (3 ≈ a noisy scan). Ignored when normalSmoothRadius is set.' },
          },
        },
        importIndex: { type: 'integer', minimum: 0, description: 'Which import (default 0).' },
      },
      required: ['algorithm'],
    },
  },
  {
    name: 'autoDetectParts',
    description: 'Seedless first pass on an IMPORTED mesh — the same proposal an interactive STL import runs. Tries every automatic detector (listPartDetectors autoPropose:true), cheapest first, and the first that splits the mesh into 2+ parts REPLACES the current draft (e.g. "pieces" on a multi-body figure, one body per colour). Returns {proposed:true, proposedBy, tried, parts, quality} — then renderParts to check and editParts to rename — or {proposed:false, tried, reason} with the existing draft untouched (one solid piece: place named seeds and call detectParts with a seeded detector; or too many loose pieces to be colour bodies).',
    input_schema: {
      type: 'object',
      properties: {
        importIndex: { type: 'integer', minimum: 0, description: 'Which import (default 0).' },
      },
    },
  },
  {
    name: 'reopenParts',
    description: 'Re-open the parts saved on an import (by acceptParts) as the draft, with the seeds that produced them, so they can be refined (editParts / detectParts) and accepted again.',
    input_schema: { type: 'object', properties: { importIndex: { type: 'integer', minimum: 0, description: 'Which import (default 0).' } } },
  },
  {
    name: 'previewPartPresets',
    description: 'Run every preset of a detector (listPartDetectors shows them) WITHOUT changing the draft — locked parts and a focus are honoured — and return them ranked best-first by a groove/island score, with a contact-sheet image. Pick one with applyPartPreset. Also fills the panel\'s preset strip for the user.',
    input_schema: {
      type: 'object',
      properties: {
        algorithm: { type: 'string', enum: [...PART_DETECTOR_IDS], description: 'Detector (default: the draft\'s, else auto-merge).' },
        seeds: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, point: { type: 'array', items: { type: 'number' } } } }, description: 'Seeds for a seeded detector (default: the current seeds).' },
        view: { type: 'string', enum: ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso', 'backIso'] },
        importIndex: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'applyPartPreset',
    description: 'Make one of the previewPartPresets results the draft (by its index in that ranked list).',
    input_schema: { type: 'object', properties: { index: { type: 'integer', minimum: 0 } }, required: ['index'] },
  },
  {
    name: 'setPartSelection',
    description: 'Select draft parts so the user sees which ones you mean: they are highlighted on the model and ticked in the Part Detection panel (where the user can merge/solo/lock them from the action bar). parts: ids ("4") or names; omit or [] to clear. mode: replace (default) / add / toggle / remove.',
    input_schema: {
      type: 'object',
      properties: {
        parts: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['replace', 'add', 'toggle', 'remove'] },
      },
    },
  },
  {
    name: 'setPartsView',
    description: 'Solo view: mode "solo" shows only the given parts (default: the selection) in colour and greys out the rest — use it to show the user exactly what one part covers; mode "all" restores every colour.',
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['all', 'solo'] },
        parts: { type: 'array', items: { type: 'string' }, description: 'Part ids ("4") or names.' },
      },
      required: ['mode'],
    },
  },
  {
    name: 'partAt',
    description: 'Which draft part is at a world point (e.g. from probePixel) -> {id, name}.',
    input_schema: { type: 'object', properties: { point: { type: 'array', items: { type: 'number' }, description: '[x, y, z]' } }, required: ['point'] },
  },
  {
    name: 'previewSeeds',
    description: 'Check seeds BEFORE detectParts: for each seed, the triangle it lands on, the nearest surface point, its distance off the surface, a miss flag (too far off — detection would snap it somewhere unintended), and (with a draft) the part there now -> {seeds:[...], misses, hint?}. Omit seeds to check the current pins.',
    input_schema: {
      type: 'object',
      properties: {
        seeds: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, point: { type: 'array', items: { type: 'number' } }, maxRadius: { type: 'number' } }, required: ['label', 'point'] } },
        importIndex: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'openPartsPanel',
    description: 'Open the Part Detection panel for the user (detectParts and reopenParts already open it). Use when handing a draft over for manual refinement.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getPartDraft',
    description: 'Summary of the current part-detection draft (parts, quality, seeds), or {draft:null}.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'editParts',
    description: 'Edit the part draft with a batch of ops (atomic — a bad op rolls the batch back). Part refs are the 1-based ids from the summary/renderParts legend, or part names (pass ids as strings like "4"; an all-digit string is always read as an id, so give parts non-numeric names). Parts own PINS (shown on the model): every part has at least one (automatic pins sit in each region; seeds you add are placed pins). Ops: {op:"merge", ids:[...], name?} (the merged part keeps all their pins) · {op:"rename", id, name} (renaming to another part\'s name merges them) · {op:"setColor", id, color:"#rrggbb"} (becomes the part\'s model colour on accept) · {op:"delete", id} (→ unassigned) · {op:"reassign", point, to (id or a NEW name), radius?} (no radius = the connected region under the point; reassigned triangles become FIXED — pin moves never undo them) · {op:"brush", to (id or a NEW name), points:[[x,y,z]…] + radius, and/or triangles:[source triangle indices], mode?:"triangles"|"patches"} (a brush stroke as ONE undo step: "triangles" (default) moves the triangles within radius of the stroke into "to" and fixes them; "patches" moves every part the stroke touches into "to" WHOLE, pins included — a brush-merge) · {op:"split", id, seeds:[{label,point}…]} · {op:"absorbSmall", minAreaFrac} · {op:"smoothBoundaries", iterations?} · {op:"addSeed", seed:{label,point,color?}} (adds a pin for that part — a NEW name makes a new part — and re-grows only the parts around it; color sets the part\'s colour) · {op:"removeSeed", index} · {op:"moveSeed", index, point} (indexes into the summary\'s seeds) · {op:"seedsFromParts"} (reset every part to automatic pins; switches a seedless draft to crease-watershed) · {op:"lock", id, locked?} (locked parts keep their triangles when detection re-runs) · {op:"focus", id} / {op:"focus"} (later detections only change that part\'s area; no id clears) · {op:"setEdgeSmoothing", iterations 0–20} (smooth sub-triangle boundaries; acceptParts cuts the mesh along them; 0 = off) · {op:"reorder", id, position} (1-based; order = label order on accept) · {op:"clear", algorithm?} (remove every part and pin; with algorithm also switch the draft\'s method; undoable) · {op:"rerun"} (re-detect the whole model) · {op:"undo"}.',
    input_schema: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['merge', 'rename', 'setColor', 'delete', 'reassign', 'brush', 'split', 'absorbSmall', 'smoothBoundaries', 'addSeed', 'removeSeed', 'moveSeed', 'seedsFromParts', 'lock', 'focus', 'setEdgeSmoothing', 'reorder', 'clear', 'rerun', 'undo'] },
              id: { type: 'string', description: 'Part id ("4") or name.' },
              ids: { type: 'array', items: { type: 'string' }, description: 'merge: part ids or names.' },
              name: { type: 'string' },
              color: { type: 'string', description: '#rrggbb' },
              point: { type: 'array', items: { type: 'number' }, description: '[x,y,z]' },
              to: { type: 'string', description: 'reassign / brush target: part id or a new part name.' },
              radius: { type: 'number' },
              points: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'brush: the stroke, [[x,y,z], …] on the surface (with radius).' },
              triangles: { type: 'array', items: { type: 'integer' }, description: 'brush: source (import) triangle indices to move.' },
              mode: { type: 'string', enum: ['triangles', 'patches'], description: 'brush: "triangles" (default) moves the brushed triangles; "patches" moves every touched part whole.' },
              seeds: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, point: { type: 'array', items: { type: 'number' } }, maxRadius: { type: 'number' } } } },
              seed: { type: 'object', properties: { label: { type: 'string' }, point: { type: 'array', items: { type: 'number' } }, color: { type: 'string', description: 'Optional "#rrggbb" for the pin\'s part.' }, maxRadius: { type: 'number', description: 'Optional geodesic growth cap (model units).' } } },
              algorithm: { type: 'string', enum: [...PART_DETECTOR_IDS], description: 'clear: also switch the draft to this method (start a seeded method fresh).' },
              index: { type: 'integer' },
              minAreaFrac: { type: 'number' },
              iterations: { type: 'integer' },
              locked: { type: 'boolean', description: 'lock: false unlocks.' },
              minRegionFrac: { type: 'number', description: 'seedsFromParts: regions smaller than this fraction of their part get no seed (default 0.01).' },
              position: { type: 'integer', description: 'reorder: new 1-based position.' },
            },
            required: ['op'],
          },
        },
      },
      required: ['ops'],
    },
  },
  {
    name: 'renderParts',
    description: 'Render the part draft in colour with each part\'s id number drawn on a visible spot in every view (plus a legend) and return the image. Use after detectParts/editParts to check every part landed right — compare against the reference image; parts hidden from all views are listed in hiddenParts. Named views assume a model facing −Y (front = azimuth 0); for a figure facing +X use angles [{azimuth:90,elevation:5}] for its front. focus zooms the camera onto one part (small parts: eyes, buttons).',
    input_schema: {
      type: 'object',
      properties: {
        views: { type: 'array', items: { type: 'string', enum: ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso', 'backIso'] }, description: 'Default ["front","right","back","iso"].' },
        angles: { type: 'array', items: { type: 'object', properties: { azimuth: { type: 'number' }, elevation: { type: 'number' } } }, description: 'Custom camera angles instead of named views (degrees; azimuth 0 = from −Y, 90 = from +X; elevation −90..90).' },
        focus: { type: 'string', description: 'Part id ("4") or name: frame the camera on that part\'s bounding box.' },
        size: { type: 'integer', minimum: 128, maximum: 1600, description: 'Tile px (default 480).' },
        numbered: { type: 'boolean', description: 'Draw part numbers (default true).' },
      },
    },
  },
  {
    name: 'comparePartDetectors',
    description: 'Run 1–6 detector configurations side by side WITHOUT replacing the draft; returns a quality table and a contact-sheet image (one numbered view per config). Use to choose a detector/params before committing to one.',
    input_schema: {
      type: 'object',
      properties: {
        configs: { type: 'array', items: { type: 'object', properties: { algorithm: { type: 'string', enum: [...PART_DETECTOR_IDS] }, seeds: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, point: { type: 'array', items: { type: 'number' } } } } }, params: PART_PARAMS_SCHEMA }, required: ['algorithm'] } },
        view: { type: 'string', enum: ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso', 'backIso'] },
        size: { type: 'integer', minimum: 128, maximum: 800 },
      },
      required: ['configs'],
    },
  },
  {
    name: 'setPartsOverlay',
    description: 'Show or hide the part-draft overlay in the viewport.',
    input_schema: { type: 'object', properties: { visible: { type: 'boolean' } }, required: ['visible'] },
  },
  {
    name: 'acceptParts',
    description: 'Commit the part draft: the parts are stored on the import and the code switches to api.importWithParts(i), so every part becomes a real label (paintByLabel, listObjectParts, the object rail) and each part keeps the colour it shows as its model colour (its setColor / seed colour, else its overlay colour). Saves a version. Show the user renderParts and get their OK first.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Version label (default "Detected parts").' },
        smoothEdges: { type: 'boolean', description: 'With edge smoothing on (the default, 3), the import is re-meshed along the smooth part boundaries. false keeps the original triangles.' },
        applyColors: { type: 'boolean', description: 'Default true: every part\'s visible colour becomes its model colour. false saves labels only (no colours).' },
      },
    },
  },
  {
    name: 'discardParts',
    description: 'Drop the part draft and its overlay.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'listObjectParts',
    description: "List the current object's PARTS and PIECES, exactly as the object list in the left rail shows them. Parts are the api.label(shape, name) regions (SCAD label(), BREP.label) — tracked through every union/cut, so they survive several shapes fusing into one solid; each has {name, triangleCount, color?}. lostParts are labels that ended with no triangles. unlabeledTriangleCount is geometry no part covers. Pieces are the physically separate solids (connected components), each named by the part covering most of it — use them to check a print-in-place mechanism really splits into N moving pieces. When the user says \"the handle\" or \"the lid part\", this is where those names live.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'highlightObjectPart',
    description: 'Tint one part (by label name) or piece of the current object in the viewport so the user can see which one you mean — the same as clicking it in the object list. Visual only (no paint, no version); cleared on the next run. Pass exactly one of part / piece / unlabeled, or clear:true.',
    input_schema: {
      type: 'object',
      properties: {
        part: { type: 'string', description: 'Part (api.label) name from listObjectParts.' },
        piece: { type: 'integer', minimum: 0, description: '0-based piece index from listObjectParts.' },
        unlabeled: { type: 'boolean', description: 'true = tint the geometry no part covers.' },
        clear: { type: 'boolean', description: 'true = remove the highlight.' },
      },
    },
  },
  {
    name: 'setObjectPartHidden',
    description: 'Hide (or show again) one part (by api.label name) or piece (0-based index) of the current object in the viewport — the eye toggle in the object list. View only: the code, versions and exports still include it; useful to see inside or behind a part. Hidden state lasts until shown again (piece hides reset when the pieces change). Pass exactly one of part / piece; hidden defaults to true.',
    input_schema: {
      type: 'object',
      properties: {
        part: { type: 'string', description: 'Part (api.label) name from listObjectParts.' },
        piece: { type: 'integer', minimum: 0, description: '0-based piece index from listObjectParts.' },
        hidden: { type: 'boolean', description: 'true = hide (default), false = show again.' },
      },
    },
  },
  {
    name: 'deleteObjectPart',
    description: "Delete one part (by label name) or one piece (0-based index) of the current object, as listed by listObjectParts — the same as its ✕ in the object list. Inserts a removal line at the top of the code (api.removePart('name') / api.removePiece([x,y,z]) in JS, BREP and voxel objects; remove_part(\"name\"); / remove_piece([x,y,z]); in OpenSCAD), re-runs, and saves a version (earlier versions keep the part). A part detected on an imported mesh is cut out and its opening capped. Refuses piece deletes on BREP objects and on a single-piece object, and restores the code if the target doesn't actually go away. Pass exactly one of part / piece.",
    input_schema: {
      type: 'object',
      properties: {
        part: { type: 'string', description: 'Part (api.label) name from listObjectParts.' },
        piece: { type: 'integer', minimum: 0, description: '0-based piece index from listObjectParts.' },
      },
    },
  },
  {
    name: 'restoreObjectPart',
    description: "Undo deleteObjectPart: bring back a part or piece removed in code by taking out its removal line (api.removePart / api.removePiece, or remove_part / remove_piece in OpenSCAD), re-running and saving a version. Pass `part` (an api.label name) or `call` (the removal call from listDeleted().parts — required for pieces), plus `object` when the same removal exists in several objects. Opens the owning object if it isn't the current one. Returns {ok, restored, object, version?, note?} — `note` means nothing came back (the label/geometry changed since) and the no-op line was just dropped.",
    input_schema: {
      type: 'object',
      properties: {
        part: { type: 'string', description: 'Removed part (api.label) name.' },
        call: { type: 'string', description: 'Removal call from listDeleted().parts, e.g. api.removePiece([1, 2, 3]); or remove_piece([1, 2, 3]);' },
        object: { type: 'string', description: 'Optional owning object name or id (from listDeleted().parts).' },
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
        withinPart: { type: 'string', description: 'Optional part (label) name: clip the paint to that part so it cannot bleed across its edge. Use the parts of an imported mesh after detectParts → acceptParts, or any api.label region (listLabels).' },
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

/** Tools whose effect is scoped to a single OBJECT — they read or mutate the
 *  active object's code, geometry, paint, or version history. Each gains an
 *  optional `object` target (injected below) so the model can address an object
 *  directly instead of leaning on the shared "current object" pointer, which
 *  the human can move from the object list mid-turn. When `object` is supplied,
 *  executeTool switches focus to it *before* running the op (see
 *  `focusTargetObject`), so the op always acts on the object the model named —
 *  not on whatever the user last clicked. The object-management tools
 *  (listObjects / changeObject / createObject / …) are deliberately excluded:
 *  they already take an explicit target or operate at the session level.
 *  (Objects were called "parts" before the rename; the legacy `part` key is
 *  still accepted as the target.) */
export const OBJECT_TARGETABLE_TOOLS = new Set<string>([
  'getActiveLanguage', 'setActiveLanguage',
  'getCode', 'setCode', 'runCode', 'runAndSave', 'runAndAssert', 'runAndExplain',
  'getParams', 'setParams', 'getGeometryData', 'getMeshSummary', 'getFeatureCentroids',
  'listVersions', 'loadVersion', 'saveVersion', 'forkVersion', 'copyColorsFromVersion',
  'modifyAndTest', 'query', 'findFaces', 'listComponents', 'listLabels', 'getModelColors',
  'listRegions', 'probePixel', 'probePixels', 'probeRay', 'paintPreview', 'paintExplain',
  'getPartTriangles', 'partBoundary', 'paintAlongBoundary',
  'paintRegion', 'paintFaces', 'paintNear', 'paintStroke', 'paintImage', 'paintInBox', 'paintInOrientedBox',
  'paintSlab', 'paintPattern', 'paintNearestRegion', 'paintComponent', 'paintByLabel', 'paintByLabels',
  'paintConnected', 'paintInCylinder', 'undoLastPaint', 'redoLastPaint', 'removeRegion',
  'clearColors', 'assertPaint', 'sliceAtZVisual', 'checkPrintability',
  'renderView', 'renderViews',
  'applySurfaceTexture', 'applyVoronoiLamp', 'engraveModel', 'voxelizeModel',
  'scaleModel', 'placeModel', 'rotateModel', 'layFlatModel', 'deleteObjectPart',
]);

// The shared `object` target schema, injected into every targetable tool so the
// description stays in one place. Typeless on purpose — it accepts a name/id
// string OR a 0-based index number (resolvePartTarget in main.ts handles both).
const OBJECT_TARGET_PROP = {
  description: 'Optional. The OBJECT to act on — addressed by its name, its id (from listObjects), or its 0-based index. Defaults to the current object. Pass this to target a specific object directly instead of relying on the current selection; it also makes a separate changeObject call unnecessary. Switching focus to the object is visible to the user.',
};
for (const tool of ALL_TOOLS) {
  if (OBJECT_TARGETABLE_TOOLS.has(tool.name) && !('object' in tool.input_schema.properties)) {
    tool.input_schema.properties.object = OBJECT_TARGET_PROP;
  }
}

const ALWAYS_AVAILABLE = new Set([
  'listPartDetectors',
  'getPartDraft',
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
  'probePixels',
  'getPartTriangles',
  'partBoundary',
  'partAt',
  'previewSeeds',
  'paintPreview',
  'paintExplain',
  'forkVersion',
  'runAndAssert',
  'runAndExplain',
  'query',
  'modifyAndTest',
  'probeRay',
  'listObjects',
  'getCurrentObject',
  'createObject',
  'changeObject',
  'renameObject',
  'deleteObject',
  'listDeleted',
  'restoreObject',
  'listObjectParts',
  'highlightObjectPart',
  // Text-only likeness score: renders offscreen but returns no image, so it is
  // NOT views-gated — it exists precisely so likeness checks skip images.
  'photoMatch',
  // Pure read of the current code's `// @character` header.
  'getCharacterSpec',
  // Pure read of the built-in Character Creator presets.
  'listCharacterPresets',
  'setObjectPartHidden',
  'assertPaint',
  'sliceAtZVisual',
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
 *  modifyAndTest, forkVersion, createObject, importImageAsRelief,
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
  'listObjects', 'getCurrentObject', 'listObjectParts', 'listDeleted', 'assertPaint', 'sliceAtZVisual', 'checkPrintability', 'photoMatch', 'getCharacterSpec', 'listCharacterPresets',
  'getPrinterSettings', 'getReliefSwapGuide', 'listPartDetectors', 'getPartDraft', 'partAt',
  'probePixels', 'getPartTriangles', 'partBoundary', 'previewSeeds',
  // Idempotent renders of the CURRENT saved geometry — no code execution, no
  // mutation. Still gated by VIEWS_GATED below so vision-off keeps them out.
  'renderView', 'renderViews',
]);

/** Tools that are safe to auto-retry on error: pure reads/queries, idempotent
 *  renders, and runs that don't commit (re-executing reproduces the same
 *  transient state). The chat loop's `autoRetry` re-invokes a failed tool, so
 *  it must NOT re-run non-idempotent mutations — `runAndSave`/`saveVersion`/
 *  `forkVersion` (would duplicate a version), the `paint*` family (would
 *  double-paint or stack a second region), `addSessionNote` (would append
 *  twice), the relief imports (already confirmed once — a retry skips the
 *  prompt), the surface modifiers (re-bake), `modifyAndTest` (a patch won't
 *  re-match after it's applied), and the object/code mutators. Anything not in
 *  this set runs exactly once even when the user opted into retries. */
export const RETRY_SAFE_TOOLS = new Set([
  // Pure reads / queries
  'getActiveLanguage', 'getCode', 'getParams', 'getGeometryData', 'getMeshSummary',
  'getFeatureCentroids', 'getReferenceImages', 'getAttachments', 'getSessionContext', 'listVersions',
  'listSessionNotes', 'readDoc', 'findFaces', 'listComponents', 'listLabels',
  'getModelColors',
  'listRegions', 'probePixel', 'paintPreview', 'paintExplain', 'query', 'probeRay',
  'listObjects', 'getCurrentObject', 'listObjectParts', 'listDeleted', 'assertPaint', 'sliceAtZVisual', 'checkPrintability', 'photoMatch', 'getCharacterSpec', 'listCharacterPresets',
  'getPrinterSettings', 'getReliefSwapGuide', 'listPartDetectors', 'getPartDraft', 'partAt',
  'probePixels', 'getPartTriangles', 'partBoundary', 'previewSeeds',
  // Visual-only view state; re-applying it is idempotent.
  'highlightObjectPart', 'setObjectPartHidden',
  // Idempotent renders (produce a snapshot; no persistent mutation)
  'renderView', 'renderViews', 'runIsolated', 'renderParts',
  // Run-without-commit (re-running the same code reproduces the same state)
  'runCode', 'runAndAssert', 'runAndExplain',
]);

const RUN_GATED = new Set(['runCode', 'setParams']);
const SAVE_GATED = new Set(['runAndSave', 'loadVersion', 'saveVersion', 'deleteObjectPart', 'restoreObjectPart', 'applySurfaceTexture', 'applyVoronoiLamp', 'engraveModel', 'voxelizeModel', 'convertToCode', 'scaleModel', 'placeModel', 'rotateModel', 'layFlatModel', 'acceptParts', 'buildCharacter', 'randomCharacter']);
/** Part-detection draft tools (#1025): they prepare paint, so they ride the
 *  paint scope, but a draft never touches the session (only acceptParts,
 *  above, commits) — so they are NOT model-changing for auto-review. The
 *  image-returning ones additionally need the Views vision toggle. */
const PARTS_GATED = new Set(['detectParts', 'autoDetectParts', 'editParts', 'discardParts', 'setPartsOverlay', 'reopenParts', 'applyPartPreset', 'openPartsPanel', 'setPartSelection', 'setPartsView']);
const PARTS_VIEW_GATED = new Set(['renderParts', 'comparePartDetectors', 'previewPartPresets']);
const PAINT_GATED = new Set(['paintRegion', 'paintFaces', 'paintNear', 'paintStroke', 'paintAlongBoundary', 'paintImage', 'paintInBox', 'paintInOrientedBox', 'paintSlab', 'paintPattern', 'paintNearestRegion', 'paintComponent', 'paintByLabel', 'paintByLabels', 'paintConnected', 'undoLastPaint', 'redoLastPaint', 'removeRegion', 'clearColors', 'copyColorsFromVersion']);

/** Tools that change the model (code, versions, textures, transforms, paint).
 *  A turn that called none of these only inspected or answered, so there is
 *  nothing for an automatic review to grade. */
export function isModelChangingTool(name: string): boolean {
  return name === 'runCode' || name === 'setCode' || name === 'setParams' || SAVE_GATED.has(name) || PAINT_GATED.has(name);
}
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
    if (PARTS_GATED.has(t.name)) return toggles.scope.paintFaces;
    if (PARTS_VIEW_GATED.has(t.name)) return toggles.scope.paintFaces && toggles.vision.views;
    if (NOTES_GATED.has(t.name)) return toggles.scope.sessionNotes;
    if (VIEWS_GATED.has(t.name)) return toggles.vision.views;
    if (AUTORESUME_GATED.has(t.name)) return toggles.autoResume === true;
    return false;
  });
}

type PartwrightAPI = Record<string, (...args: unknown[]) => unknown>;

/** The renderParts tool takes custom angles as `angles` (a Gemini-safe
 *  schema: no string-or-object union); the API takes them as `views`. */
function renderPartsArgs(input: Record<string, unknown>): Record<string, unknown> {
  const { angles, views, ...rest } = input;
  if (Array.isArray(angles) && angles.length > 0) return { ...rest, views: Array.isArray(views) ? [...views, ...angles] : angles };
  return views === undefined ? rest : { ...rest, views };
}

function getApi(): PartwrightAPI {
  const w = window as unknown as { partwright?: PartwrightAPI };
  if (!w.partwright) {
    throw new Error('window.partwright is not ready — the Partwright engine has not finished initializing.');
  }
  return w.partwright;
}

/** Switch focus to the object an object-scoped tool named via its `object`
 *  target, so the op runs against that object rather than whatever the user
 *  last selected in the object list. `target` is an object name, id, or 0-based
 *  index (mirrors resolvePartTarget on the API side). No-op when the target is
 *  already current — which avoids reloading the object and clobbering any
 *  in-progress editor draft on it. Returns an error string on a bad target, or
 *  null on success. */
async function focusTargetObject(api: PartwrightAPI, target: string | number): Promise<string | null> {
  const objects = api.listObjects() as Array<{ id: string; name: string; order: number; isCurrent: boolean }> | undefined;
  if (!Array.isArray(objects) || objects.length === 0) {
    return `Cannot target object ${JSON.stringify(target)}: no active session with objects. Open a session first.`;
  }
  let match: { id: string; isCurrent: boolean } | undefined;
  if (typeof target === 'number') {
    if (!Number.isInteger(target) || target < 0) return `Cannot target object: index must be a non-negative integer (got ${JSON.stringify(target)}).`;
    match = [...objects].sort((a, b) => a.order - b.order)[target];
  } else {
    match = objects.find(p => p.id === target) ?? objects.find(p => p.name === target);
  }
  if (!match) return `Cannot target object ${JSON.stringify(target)}: no matching object (by name, id, or index). Call listObjects() to see what's available.`;
  if (match.isCurrent) return null; // already focused — don't reload and clobber an in-progress edit
  const switched = await api.changeObject(match.id) as { error?: string } | undefined;
  if (switched && typeof switched === 'object' && 'error' in switched && switched.error) {
    return `Cannot target object ${JSON.stringify(target)}: ${switched.error}`;
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
    // Object addressing: an object-scoped tool may name an `object` target (name,
    // id, or 0-based index; `part` is the pre-rename spelling, still accepted).
    // Switch focus to it before running so the op acts on the addressed object —
    // not whatever the user last clicked. Strip the keys first so the per-tool
    // APIs (which reject unknown keys) never see them.
    if (OBJECT_TARGETABLE_TOOLS.has(name)) {
      const target = (input.object ?? input.part) as string | number | undefined;
      delete input.object;
      delete input.part;
      if (target != null) {
        const focusErr = await focusTargetObject(api, target);
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
        withinPart: input.withinPart,
      });
    }
    case 'paintInBox':
      return api.paintInBox(input);
    case 'paintInOrientedBox':
      return api.paintInOrientedBox(input);
    case 'paintSlab':
      return api.paintSlab(input);
    case 'paintPattern':
      return api.paintPattern(input);
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
    case 'probePixels':
      return api.probePixels(input.pixels, input.view);
    case 'getPartTriangles':
      return api.getPartTriangles(input.name, input.maxResults !== undefined ? { maxResults: input.maxResults } : undefined);
    case 'partBoundary':
      return api.partBoundary(input.a, input.b, input.maxPointsPerLoop !== undefined ? { maxPointsPerLoop: input.maxPointsPerLoop } : undefined);
    case 'paintAlongBoundary':
      return api.paintAlongBoundary(input);
    case 'photoMatch':
      return await api.photoMatch(input);
    case 'buildCharacter': {
      // Always commits (the chat AI's work should leave a version), and drops
      // the generated code from the result — it is a few KB the model only
      // needs if it falls back to hand-editing (getCode), which keeps the
      // spec → build → photoMatch loop token-cheap.
      const r = await api.buildCharacter(input.spec, { save: true, label: (input.label as string | undefined) ?? 'Character' }) as Record<string, unknown>;
      if (r && typeof r === 'object' && typeof r.code === 'string') {
        const { code, ...rest } = r;
        return { ...rest, codeChars: (code as string).length };
      }
      return r;
    }
    case 'getCharacterSpec':
      return api.getCharacterSpec();
    case 'listCharacterPresets': {
      const presets = api.listCharacterPresets() as Array<{ id: string; label: string; description: string; spec: unknown }>;
      if (input.id === undefined) return presets.map(({ id, label, description }) => ({ id, label, description }));
      const hit = presets.find(p => p.id === input.id);
      return hit ?? { error: `listCharacterPresets: unknown id ${JSON.stringify(input.id)} — one of ${presets.map(p => p.id).join(', ')}` };
    }
    case 'randomCharacter': {
      // Commits like buildCharacter and drops the generated code (token-cheap).
      const r = await api.randomCharacter({ seed: input.seed, save: true, label: input.label }) as Record<string, unknown>;
      if (r && typeof r === 'object' && typeof r.code === 'string') {
        const { code, ...rest } = r;
        return { ...rest, codeChars: (code as string).length };
      }
      return r;
    }
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
    // Pre-rename tool names (`listParts` …) still dispatch, so a chat whose
    // history carries them — or a model that reaches for the old name — works.
    case 'listObjects':
    case 'listParts':
      return api.listObjects();
    case 'getCurrentObject':
    case 'getCurrentPart':
      return api.getCurrentObject();
    case 'createObject':
    case 'createPart':
      return api.createObject(input.name as string | undefined);
    case 'changeObject':
    case 'changePart':
      return api.changeObject((input.object ?? input.part ?? input.id) as string | number);
    case 'renameObject':
    case 'renamePart':
      return api.renameObject((input.object ?? input.part ?? input.id) as string | number, input.name as string);
    case 'deleteObject':
    case 'deletePart':
      return api.deleteObject((input.object ?? input.part ?? input.id) as string | number);
    case 'listPartDetectors':
      return api.listPartDetectors();
    case 'detectParts': {
      const result = await api.detectParts(input);
      // Hand the draft to the user: the panel opens so they can refine it.
      if (result && typeof result === 'object' && !('error' in result)) api.openPartsPanel();
      return result;
    }
    case 'reopenParts': {
      const result = await api.reopenParts(input);
      if (result && typeof result === 'object' && !('error' in result)) api.openPartsPanel();
      return result;
    }
    case 'applyPartPreset':
      return api.applyPartPreset(input.index);
    case 'setPartSelection': {
      const refs = partRefs(input.parts) ?? [];
      return api.setPartSelection(refs.length ? refs : null, input.mode === undefined ? undefined : { mode: input.mode });
    }
    case 'setPartsView': {
      const refs = partRefs(input.parts);
      return api.setPartsView(refs ? { mode: input.mode, parts: refs } : { mode: input.mode });
    }
    case 'partAt':
      return api.partAt(input.point);
    case 'previewSeeds':
      return api.previewSeeds(input.seeds, input.importIndex !== undefined ? { importIndex: input.importIndex } : undefined);
    case 'openPartsPanel':
      return api.openPartsPanel();
    case 'autoDetectParts': {
      const result = await api.autoDetectParts(input) as Record<string, unknown>;
      // A proposal is a draft too: hand it to the user like detectParts does.
      if (result && typeof result === 'object' && result.proposed === true) api.openPartsPanel();
      return result;
    }
    case 'getPartDraft':
      return api.getPartDraft();
    case 'editParts':
      return api.editParts({ ops: normalizePartOps(input.ops) });
    case 'renderParts':
    case 'comparePartDetectors':
    case 'previewPartPresets': {
      const result = (name === 'renderParts'
        ? await api.renderParts(renderPartsArgs(input))
        : name === 'previewPartPresets'
          ? await api.previewPartPresets(input)
          : await api.comparePartDetectors(input.configs, {
            ...(input.view !== undefined ? { view: input.view } : {}),
            ...(input.size !== undefined ? { size: input.size } : {}),
          })) as Record<string, unknown>;
      if (!result || typeof result !== 'object' || 'error' in result) return result;
      const image = result.image as string | undefined;
      delete result.image;
      const img = typeof image === 'string' ? parseImageDataUrl(image) : null;
      if (!img) return result;
      return {
        content: `${name}: ${JSON.stringify(result)}`,
        isError: false,
        image: { ...img, label: name },
      } satisfies ToolExecResult;
    }
    case 'setPartsOverlay':
      return api.setPartsOverlay(input.visible);
    case 'acceptParts':
      return api.acceptParts(input);
    case 'discardParts':
      return api.discardParts();
    case 'listObjectParts':
      return api.listObjectParts();
    case 'highlightObjectPart': {
      if (input.clear === true) return api.highlightObjectPart(null);
      if (typeof input.part === 'string') return api.highlightObjectPart(input.part);
      if (typeof input.piece === 'number') return api.highlightObjectPart({ piece: input.piece });
      if (input.unlabeled === true) return api.highlightObjectPart({ unlabeled: true });
      return { error: 'highlightObjectPart: pass one of part, piece, unlabeled:true, or clear:true.' };
    }
    case 'setObjectPartHidden': {
      const hidden = input.hidden === undefined ? true : input.hidden === true;
      if (typeof input.part === 'string') return api.setObjectPartHidden(input.part, hidden);
      if (typeof input.piece === 'number') return api.setObjectPartHidden({ piece: input.piece }, hidden);
      return { error: 'setObjectPartHidden: pass one of part (name) or piece (index).' };
    }
    case 'deleteObjectPart': {
      if (typeof input.part === 'string') return api.deleteObjectPart(input.part);
      if (typeof input.piece === 'number') return api.deleteObjectPart({ piece: input.piece });
      return { error: 'deleteObjectPart: pass one of part (name) or piece (index).' };
    }
    case 'restoreObjectPart': {
      const target: Record<string, unknown> = {};
      if (typeof input.part === 'string') target.part = input.part;
      if (typeof input.call === 'string') target.call = input.call;
      if (typeof input.object === 'string') target.object = input.object;
      return api.restoreObjectPart(target);
    }
    case 'listDeleted':
      return api.listDeleted();
    case 'restoreObject':
      return api.restoreObject(input.object);
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
