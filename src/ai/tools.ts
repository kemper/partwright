// Tool bridge: defines the schemas the model sees and dispatches calls to
// window.partwright. The set of tools the model receives is filtered by the
// per-session scope toggles (see settings.ts). Disabled tools are removed
// from the request payload entirely — the model can't call what isn't there.

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
    description: 'Run code and commit the result as a new gallery version in the current session. The preferred way to make progress — leaves a versioned record. Returns geometry stats and the saved version number.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to run (overwrites the editor with the run-passing variant).' },
        label: { type: 'string', description: 'Short label for the gallery (e.g. "tapered legs"). Defaults to v<index>.' },
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
    description: 'Paint a labelled feature by name. The label must have been registered in the current run via api.label(shape, name) or api.labeledUnion. This is the bullseye for "describe how to make and paint a model" workflows: write the geometry with labels, then paint by name — no coordinate guessing, no bounding-box estimation, no fan-bleed. Survives boolean ops because manifold-3d propagates originalID through runOriginalID on the result mesh. Only works for manifold-js (SCAD has no equivalent); falls back to paintComponent / paintInBox there. For multi-feature models, batch with paintByLabels in one round-trip instead of N sequential paintByLabel calls.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Name passed to api.label() in the model code.' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[r, g, b] in 0..1.' },
        name: { type: 'string', description: 'Optional region name; defaults to the label.' },
      },
      required: ['label', 'color'],
    },
  },
  {
    name: 'paintByLabels',
    description: 'Batch sibling of paintByLabel. Paint N labelled features in one tool call. Use this for any multi-feature paint job — a 9-feature smiley paints in 1 round-trip instead of 9. The viewport refresh coalesces under rAF so total cost is one frame regardless of batch size. Returns {results: [...], failed: [{label, error}]} — partial failures are reported per-label and do not abort the batch.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Array of paint specs, each {label, color, name?} — same shape as a single paintByLabel call.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
              name: { type: 'string' },
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
    name: 'applyDeformer',
    description: 'Apply a procedural deformer (inflate or smooth) to a coplanar region of the current mesh. The region is selected by raycasting from a seed point along a seed normal — use probePixel first to find these from a rendered view. Saves a new version automatically; the version becomes locked (read-only, fork to edit code). Calling applyDeformer again creates a NEW version on top of the previous one — the deformer stack replays in order on reload. Validates the result with Manifold.ofMesh and rejects non-manifold output.',
    input_schema: {
      type: 'object',
      properties: {
        seedPoint: {
          type: 'object',
          description: 'World-space surface hit. Use the `point` from probePixel.',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          required: ['x', 'y', 'z'],
        },
        seedNormal: {
          type: 'object',
          description: 'Surface normal at the seed. Use the `normal` from probePixel.',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          required: ['x', 'y', 'z'],
        },
        deformer: { type: 'string', enum: ['inflate', 'smooth'], description: '"inflate" pushes region vertices along their averaged normals; "smooth" Laplacian-averages them with their region neighbours, boundary pinned.' },
        distance: { type: 'number', description: 'Inflate only. World units, positive = outward, negative = inward (deflate). Default 1.' },
        iterations: { type: 'integer', description: 'Smooth only. Number of Laplacian iterations (1..10 typical). Default 3.' },
        tolerance: { type: 'number', description: 'Region coplanarity threshold as cosine of max bend angle, 0..1. Default 0.9995 (≈1.8°). Lower values include more curved/bent neighbouring faces.' },
        label: { type: 'string', description: 'Optional gallery label for the saved version. Auto-generated (e.g. "inflate +2.00", "smooth ×3") when omitted.' },
      },
      required: ['seedPoint', 'seedNormal', 'deformer'],
    },
  },
  {
    name: 'listAppliedDeformers',
    description: 'Return the deformers stored on the currently loaded version, in apply order: {id, kind, params, regionDescriptor, order}. Useful for verifying state before chaining another applyDeformer call, or for understanding what a loaded session already has applied.',
    input_schema: { type: 'object', properties: {} },
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
  'loadVersion',
  'addSessionNote',
  'listSessionNotes',
  'findFaces',
  'listComponents',
  'listLabels',
  'probePixel',
  'paintPreview',
  'paintExplain',
  'listAppliedDeformers',
]);

const RUN_GATED = new Set(['runCode']);
const SAVE_GATED = new Set(['runAndSave', 'loadVersion']);
const PAINT_GATED = new Set(['paintRegion', 'paintFaces', 'paintNear', 'paintInBox', 'paintSlab', 'paintNearestRegion', 'paintComponent', 'paintByLabel', 'paintByLabels', 'paintConnected', 'undoLastPaint', 'redoLastPaint', 'removeRegion', 'clearColors']);
/** Sculpt deformer tools save a new locked version and mutate the in-memory
 *  mesh, so they require both runCode (to have a mesh in the first place)
 *  and saveVersions (to persist the deformer). Read-only listAppliedDeformers
 *  is in ALWAYS_AVAILABLE above. */
const SCULPT_GATED = new Set(['applyDeformer']);
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
    if (SCULPT_GATED.has(t.name)) return toggles.scope.runCode && toggles.scope.saveVersions;
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
    const api = getApi();
    // Tools that ship images back to the model bypass the generic JSON
    // dispatch — they need the data-URL → multimodal-image wrapping.
    if (name === 'renderView') return executeRenderView(api, input);
    if (name === 'renderViews') return await executeRenderViews(api, input);
    if (name === 'runIsolated') return await executeRunIsolated(api, input);

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
      return api.runAndSave(input.code as string, input.label as string | undefined);
    case 'getGeometryData':
      return api.getGeometryData();
    case 'getMeshSummary':
      return api.getMeshSummary();
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
    case 'paintRegion':
      return api.paintRegion(input);
    case 'paintFaces':
      return api.paintFaces(input);
    case 'paintNear':
      return api.paintNear(input);
    case 'paintInBox':
      return api.paintInBox(input);
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
    case 'applyDeformer':
      return await api.applyDeformer(input);
    case 'listAppliedDeformers':
      return api.listAppliedDeformers();
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
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
