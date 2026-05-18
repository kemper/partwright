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
import { RENDER_VIEW_MODES } from '../renderer/multiview';

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
    description: 'Returns the editor\'s current modeling language: "manifold-js" or "scad". The per-turn system suffix already includes this, but call when in doubt or after a tool sequence that might have switched it.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'setActiveLanguage',
    description: 'Switch the editor between "manifold-js" and "scad". Switching DISCARDS the current editor contents and resets to a stub — only do this when the user asked for the switch, or when the new request is much better expressed in the other language. Do NOT switch back and forth speculatively.',
    input_schema: {
      type: 'object',
      properties: {
        lang: { type: 'string', enum: ['manifold-js', 'scad'] },
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
    description: 'Read the current geometry stats (volume, surfaceArea, vertexCount, triangleCount, isManifold, componentCount, boundingBox). Cheap — no re-execution.',
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
    description: 'Return labels registered in the current run via api.label(shape, name) — the cleanest paint primitive on agent-authored manifold-js geometry. Each entry: {name, triangleCount, bbox, centroid}. Empty when the code did not call api.label. Use to confirm labels resolved correctly before paintByLabel; otherwise prefer calling paintByLabel directly to save a round-trip.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'paintByLabel',
    description: 'Paint a labelled feature by name. The label must have been registered in the current run via api.label(shape, name) or api.labeledUnion. This is the bullseye for "describe how to make and paint a model" workflows: write the geometry with labels, then paint by name — no coordinate guessing, no bounding-box estimation, no fan-bleed. Survives boolean ops because manifold-3d propagates originalID through runOriginalID on the result mesh. Only works for manifold-js (SCAD has no equivalent); falls back to paintComponent / paintInBox there. For multi-feature models, batch with paintByLabels in one round-trip instead of N sequential paintByLabel calls. IMPORTANT: api.label only tracks surfaces that exist in the original labeled shape. Boolean subtraction creates NEW triangles at the cut surface (e.g. the inner wall of a mug after subtracting the void) — those new triangles have NO label. Use probePixel + paintConnected for inner surfaces created by boolean ops.',
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
    description: 'Click in your own perception. Translates a pixel in a renderView image back to a world-space surface hit on the mesh: {point, normal, distance, triangleId} or null when the pixel is background. The view must match the renderView call (same elevation/azimuth/ortho/size). This is THE tool for organic geometry: render → identify the feature visually → probePixel to get exact coords → paintConnected or paintNear. The returned point is exactly on the mesh surface (raycast, not snap), so paintRegion-style seed-precision worries are gone. Front-most hit = occlusion correct.',
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
      },
    },
  },
  {
    name: 'renderViews',
    description: 'Render MULTIPLE labeled angles as ONE composite PNG. THIS IS HOW YOU SEE YOUR WORK reliably — a single angle can hide an asymmetric error that another angle catches. Costs ~1500-2500 input tokens. Default `views: "auto"` picks angles by the model\'s bounding box: flat disks get [Top, Iso] (a front elevation of a disk is a useless sliver), tall columns get [Front, Right, Iso] (the top of a column is a useless dot), everything else gets [Front, Top, Iso]. Use `tri` or `all` to force a specific set.',
    input_schema: {
      type: 'object',
      properties: {
        views: { type: 'string', enum: [...RENDER_VIEW_MODES], description: '"auto" (default) picks angles from the model aspect ratio. "tri" = front + top + iso (3 cells). "all" = front + right + top + iso (4 cells).' },
        size: { type: 'integer', description: 'Pixel size per cell. Default 320.' },
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
    description: 'Fetch one of the topic-specific docs from /ai/<name>.md. Use this when the core ai.md points you at a subdoc and you need its full content before writing code. Names: curves, bosl2, colors, print-safety, reference-images, file-io, annotations.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          enum: ['curves', 'bosl2', 'colors', 'print-safety', 'reference-images', 'file-io', 'annotations'],
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
    name: 'paintInBox',
    description: 'Paint every triangle whose centroid is inside the axis-aligned box (optionally constrained by a normal cone). One call. Use for "paint the top half / the right rim / everything below z=0". Pass `topOnly: true` to skip side walls and the bottom face — the most common over-paint cause. On fan-topology meshes (cylinder/revolve/linear_extrude surfaces), pass `coverageMode: "fully_inside"` and/or `maxTriangleArea` to avoid long radial triangles bleeding paint outside the box.',
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
    description: 'Paint every triangle whose centroid lies inside a rotated oriented bounding box (OBB). Same selector as the UI Box paint tool. Reach for this when paintInBox catches the wrong faces because the feature is at an angle to the world axes — diagonal handles, tilted lids, rotated wings, etc. Defaults to the identity quaternion (no rotation) when `quaternion` is omitted, making it equivalent to paintInBox with the same center+size.',
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
      },
      required: ['box', 'color'],
    },
  },
  {
    name: 'paintSlab',
    description: 'Paint everything in a Z-slab (or arbitrary-axis slab). One call. Use for "paint the rim of this disk", "paint the side walls", "paint the top 5mm". Same coverageMode / maxTriangleArea options as the other selectors.',
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
    description: 'Fork a prior version: load version N, apply new code or patches, validate against optional assertions, and save as a new version — all atomically. Use this to branch off a known-good version without the fragile loadVersion → getCode → modify → runAndSave chain. Provide either `code` (full replacement) or `patches` (find/replace array applied to the parent\'s code — more concise when only a few values change). Returns {parent, version, geometry, diff, galleryUrl} on success, or {error} / {passed: false, failures} on failure.',
    input_schema: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: '1-based version index to fork from (from listVersions).' },
        code: { type: 'string', description: 'Full replacement code for the forked version. Provide this or patches, not both.' },
        patches: {
          type: 'array',
          description: 'Find/replace substitutions applied in sequence to the parent version\'s code. More concise than providing the full program when only a few values change.',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'Exact string to find.' },
              replace: { type: 'string', description: 'Replacement string.' },
            },
            required: ['find', 'replace'],
          },
        },
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
    name: 'query',
    description: 'Multi-query the current geometry in one call. Pass any combination of sliceAt (cross-section areas at given Z heights), decompose (component breakdown), boundingBox. Returns only the keys you asked for. Cheaper than separate calls.',
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
    description: 'Apply string substitution(s) to the current editor code, run the result, and return stats — WITHOUT saving a version or changing the editor. Use to test a tweak before committing. Provide either a single `find`/`replace` pair or a `patches` array for multiple simultaneous substitutions. Returns {modifiedCode, stats, passed?, failures?}.',
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
    name: 'createSession',
    description: 'Create a new named session and make it active. Returns {id, url, galleryUrl}. Call before runAndSave when there is no active session, or when starting a new design.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Session name (e.g. "Castle v2").' },
      },
    },
  },
  {
    name: 'listSessions',
    description: 'List all sessions saved in this browser. Returns [{id, name, updated}] newest first. Use to find a session to open, or to check what work exists.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'openSession',
    description: 'Open an existing session by id (from listSessions). Makes it the active session. Always call getSessionContext() after opening to read notes and version history.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session id from listSessions().' },
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
];

const ALWAYS_AVAILABLE = new Set([
  'getActiveLanguage',
  'setActiveLanguage',
  'getCode',
  'setCode',
  'getGeometryData',
  'getMeshSummary',
  'getFeatureCentroids',
  'getSessionContext',
  'listVersions',
  // loadVersion is intentionally NOT here — it's listed in SAVE_GATED so
  // the model can't rewind state when the user has paused commits.
  'addSessionNote',
  'listSessionNotes',
  'readDoc',
  'findFaces',
  'listComponents',
  'listLabels',
  'probePixel',
  'paintPreview',
  'paintExplain',
  'forkVersion',
  'runAndAssert',
  'query',
  'modifyAndTest',
  'probeRay',
  'createSession',
  'listSessions',
  'openSession',
  'assertPaint',
  'sliceAtZVisual',
  'paintInCylinder',
]);

const RUN_GATED = new Set(['runCode']);
const SAVE_GATED = new Set(['runAndSave', 'loadVersion']);
const PAINT_GATED = new Set(['paintRegion', 'paintFaces', 'paintNear', 'paintInBox', 'paintInOrientedBox', 'paintSlab', 'paintNearestRegion', 'paintComponent', 'paintByLabel', 'paintByLabels', 'paintConnected', 'undoLastPaint', 'redoLastPaint', 'removeRegion', 'clearColors']);
/** Tools that ship a PNG back to the model via a multimodal content
 *  block. Gated by the Views vision toggle so the user can disable
 *  vision spend in one place — when off, the agent has to reason from
 *  code + stats alone. runIsolated is here because its primary value is
 *  the thumbnail; without vision it degrades to just the stats. */
const VIEWS_GATED = new Set(['renderView', 'renderViews', 'runIsolated']);

export function buildToolList(toggles: ChatToggles): ToolDefinition[] {
  return ALL_TOOLS.filter(t => {
    if (ALWAYS_AVAILABLE.has(t.name)) return true;
    if (RUN_GATED.has(t.name)) return toggles.scope.runCode;
    if (SAVE_GATED.has(t.name)) {
      // loadVersion is non-mutating but gating it under saveVersions keeps
      // the model from rewinding state when the user has paused commits.
      return t.name === 'loadVersion' ? toggles.scope.saveVersions : (toggles.scope.runCode && toggles.scope.saveVersions);
    }
    if (PAINT_GATED.has(t.name)) return toggles.scope.paintFaces;
    if (VIEWS_GATED.has(t.name)) return toggles.vision.views;
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
  } else {
    // Strong SCAD markers in a JS session — `module name() {}` /
    // `function foo() = …` / `$fn = …;` are SCAD-only constructs.
    if (/^\s*module\s+\w+\s*\(/m.test(code) || /^\s*\$fn\s*=/m.test(code) || /^\s*function\s+\w+\s*\([^)]*\)\s*=/m.test(code)) {
      return 'Language mismatch: this session is manifold-js (JavaScript) but the code uses OpenSCAD-only syntax (`module`, `$fn`, or function-equals). Rewrite using the manifold-js API: `const { Manifold, CrossSection } = api;`, `Manifold.cube(...)`, `.translate(...)`, ending with `return manifold;`.';
    }
  }
  return null;
}

/** Read the live engine language without forcing every consumer of
 *  `tools.ts` to import the engine module statically. The function lives
 *  in `src/geometry/engine.ts` and is already loaded by the app shell at
 *  startup, so a require-style lookup via `window.partwright` is safe. */
const SUBDOC_NAMES = new Set(['curves', 'bosl2', 'colors', 'print-safety', 'reference-images', 'file-io', 'annotations']);

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

function readActiveLanguage(): 'manifold-js' | 'scad' | null {
  try {
    const w = window as unknown as { partwright?: { getActiveLanguage?: () => 'manifold-js' | 'scad' } };
    const lang = w.partwright?.getActiveLanguage?.();
    return lang === 'manifold-js' || lang === 'scad' ? lang : null;
  } catch {
    return null;
  }
}

function executeRenderView(api: PartwrightAPI, input: Record<string, unknown>): ToolExecResult {
  const result = api.renderView(input) as string | { error: string } | null | undefined;
  const elevation = (input.elevation as number | undefined) ?? 30;
  const azimuth = (input.azimuth as number | undefined) ?? 0;
  const ortho = (input.ortho as boolean | undefined) ?? false;
  const size = (input.size as number | undefined) ?? 320;
  const label = `view: elev=${elevation}°, az=${azimuth}°${ortho ? ', ortho' : ''}, ${size}px`;
  return wrapImageResult(result, 'renderView', label);
}

async function executeRenderViews(api: PartwrightAPI, input: Record<string, unknown>): Promise<ToolExecResult> {
  const result = await api.renderViews(input) as string | { error: string } | null | undefined;
  const views = (input.views as string | undefined) ?? 'auto';
  const size = (input.size as number | undefined) ?? 320;
  const label = `views: ${views} composite (${size}px per cell)`;
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
    case 'removeRegion':
      return api.removeRegion(input.id as number);
    case 'clearColors':
      return api.clearColors();
    case 'forkVersion': {
      const forkPatches = input.patches as Array<{ find: string; replace: string }> | undefined;
      const forkTransform = forkPatches
        ? (code: string) => forkPatches.reduce((c, p) => c.replace(p.find, p.replace), code)
        : (_code: string) => input.code as string;
      return api.forkVersion({ index: input.index }, forkTransform, input.label as string | undefined, input.assertions as Record<string, unknown> | undefined);
    }
    case 'runAndAssert':
      return api.runAndAssert(input.code, input.assertions);
    case 'query':
      return api.query(input);
    case 'modifyAndTest': {
      const mtPatches = input.patches as Array<{ find: string; replace: string }> | undefined;
      return api.modifyAndTest((code: unknown) => {
        let s = code as string;
        if (mtPatches) return mtPatches.reduce((c, p) => c.replace(p.find, p.replace), s);
        return s.replace(input.find as string, input.replace as string);
      }, input.assertions as Record<string, unknown> | undefined);
    }
    case 'probeRay':
      return api.probeRay(input.origin, input.direction);
    case 'createSession':
      return api.createSession(input.name as string | undefined);
    case 'listSessions':
      return api.listSessions();
    case 'openSession':
      return api.openSession(input.id as string);
    case 'assertPaint':
      return api.assertPaint(input);
    case 'paintInCylinder':
      return api.paintInCylinder(input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
