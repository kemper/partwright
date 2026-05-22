// Autocomplete for the manifold-js sandbox API.
//
// Signatures are transcribed from manifold-3d's encapsulated type defs and the
// `api` object the engine injects (src/geometry/engines/manifoldJs.ts), so the
// hints match what actually runs. The matcher is heuristic (no type inference):
// `Manifold.`/`CrossSection.`/`api.` resolve to their own members; any other
// `.` offers the union of instance methods (most chains are Manifold).

import { snippetCompletion } from '@codemirror/autocomplete';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { javascriptLanguage } from '@codemirror/lang-javascript';

/** A callable member — completes to `name()` with the cursor between the parens. */
function fn(label: string, detail: string, info: string): Completion {
  return snippetCompletion(`${label}(\${})`, { label, detail, info, type: 'function' });
}

/** A non-callable member (property / class / keyword). */
function val(label: string, detail: string, info: string, type: Completion['type']): Completion {
  return { label, detail, info, type };
}

const MANIFOLD_STATIC: Completion[] = [
  fn('cube', '(size?, center?)', 'Axis-aligned box. size is [x,y,z] or a number; center shifts the box to the origin.'),
  fn('cylinder', '(height, radiusLow, radiusHigh?, circularSegments?, center?)', 'Cylinder or cone along Z. Set radiusHigh for a cone.'),
  fn('sphere', '(radius, circularSegments?)', 'Geodesic sphere of the given radius.'),
  fn('tetrahedron', '()', 'Tetrahedron centered at the origin with a vertex at (1,1,1).'),
  fn('extrude', '(polygons, height, nDivisions?, twistDegrees?, scaleTop?, center?)', 'Extrude a CrossSection / polygons along Z.'),
  fn('revolve', '(polygons, circularSegments?, revolveDegrees?)', 'Revolve a CrossSection / polygons around the Y-axis (becomes Z).'),
  fn('ofMesh', '(mesh)', 'Build a Manifold from a Mesh (e.g. api.imports[0]).'),
  fn('smooth', '(mesh, sharpenedEdges?)', 'Create a smooth (tangent-carrying) Manifold from a mesh; refine() to interpolate.'),
  fn('levelSet', '(sdf, bounds, edgeLength, level?, tolerance?)', 'Marching-tetrahedra surface from a signed-distance function.'),
  fn('union', '(a, b)  |  (manifolds[])', 'Boolean union of two manifolds or a list.'),
  fn('difference', '(a, b)  |  (manifolds[])', 'Boolean difference (subtract the tail of a list from its head).'),
  fn('intersection', '(a, b)  |  (manifolds[])', 'Boolean intersection of two manifolds or a list.'),
  fn('compose', '(manifolds[])', 'Topological compose (no boolean) — avoid overlaps. Inverse of decompose().'),
  fn('hull', '(points[])', 'Convex hull of the given manifolds / [x,y,z] points.'),
  fn('reserveIDs', '(count)', 'Reserve a run of unique original IDs for multi-material meshes.'),
];

const MANIFOLD_INSTANCE: Completion[] = [
  fn('add', '(other)', 'Boolean union with another Manifold.'),
  fn('subtract', '(other)', 'Boolean difference — remove other from this.'),
  fn('intersect', '(other)', 'Boolean intersection with another Manifold.'),
  fn('translate', '([x,y,z])  |  (x, y, z)', 'Move in space (chainable, lazy).'),
  fn('rotate', '([x,y,z])  |  (x, y, z)', 'Euler rotation in degrees, applied X then Y then Z.'),
  fn('scale', '([x,y,z] | n)', 'Scale per-component or uniformly.'),
  fn('mirror', '(normal)', 'Mirror over the plane through the origin with this normal.'),
  fn('transform', '(mat4)', 'Apply a column-major affine matrix (last row ignored).'),
  fn('warp', '(fn)', 'Move each vertex via fn(vert) without changing topology.'),
  fn('refine', '(n)', 'Split every edge into n pieces (n > 1).'),
  fn('refineToLength', '(length)', 'Subdivide edges down to roughly the given length.'),
  fn('refineToTolerance', '(tolerance)', 'Subdivide curved regions to within tolerance of the smooth surface.'),
  fn('setProperties', '(numProp, fn)', 'Rewrite per-vertex properties via fn(newProp, position, oldProp).'),
  fn('calculateCurvature', '(gaussianIdx, meanIdx)', 'Store Gaussian/mean curvature into property channels.'),
  fn('calculateNormals', '(normalIdx, minSharpAngle)', 'Compute vertex normals into property channels.'),
  fn('smoothByNormals', '(normalIdx)', 'Fill tangents from existing normal properties.'),
  fn('smoothOut', '(minSharpAngle?, minSmoothness?)', 'Smooth edges below minSharpAngle (then refine()).'),
  fn('split', '(cutter)', 'Returns [intersection, difference] with the cutter.'),
  fn('splitByPlane', '(normal, originOffset)', 'Returns [above, below] split by a half-space.'),
  fn('trimByPlane', '(normal, originOffset)', 'Remove everything behind the half-space plane.'),
  fn('slice', '(height)', 'CrossSection of this solid at the given Z height.'),
  fn('project', '()', 'CrossSection of the projected outline onto the XY plane.'),
  fn('hull', '()', 'Convex hull of this Manifold.'),
  fn('decompose', '()', 'Split into topologically disconnected Manifolds.'),
  fn('getMesh', '(normalIdx?)', 'Return a renderer-friendly Mesh of this Manifold.'),
  fn('asOriginal', '()', 'Reset IDs so this copy is referenced by descendants.'),
  fn('originalID', '()', 'Original ID if this is an original, else -1.'),
  fn('boundingBox', '()', 'Axis-aligned bounding box {min, max}.'),
  fn('volume', '()', 'Volume of the solid.'),
  fn('surfaceArea', '()', 'Total surface area.'),
  fn('genus', '()', 'Topological genus (number of handles).'),
  fn('numTri', '()', 'Triangle count.'),
  fn('numVert', '()', 'Vertex count.'),
  fn('numEdge', '()', 'Edge count.'),
  fn('numProp', '()', 'Properties per vertex.'),
  fn('isEmpty', '()', 'Whether the Manifold has no triangles.'),
  fn('status', '()', 'Error status for an empty/invalid Manifold.'),
  fn('tolerance', '()', 'Current epsilon tolerance.'),
  fn('setTolerance', '(tolerance)', 'Copy with a new tolerance (simplifies when increased).'),
  fn('simplify', '(tolerance?)', 'Copy simplified to within tolerance.'),
  fn('minGap', '(other, searchLength)', 'Minimum gap to another Manifold (0..searchLength).'),
];

const CROSSSECTION_STATIC: Completion[] = [
  fn('square', '(size?, center?)', 'Square/rectangle. size is [x,y] or a number; center shifts to the origin.'),
  fn('circle', '(radius, circularSegments?)', 'Circle of the given radius.'),
  fn('union', '(a, b)  |  (list)', 'Boolean union of cross-sections / polygons.'),
  fn('difference', '(a, b)  |  (list)', 'Boolean difference of cross-sections / polygons.'),
  fn('intersection', '(a, b)  |  (list)', 'Boolean intersection of cross-sections / polygons.'),
  fn('hull', '(polygons[])', 'Convex hull of a list of polygons / cross-sections.'),
  fn('compose', '(polygons[])', 'Batch-union a list into one CrossSection.'),
  fn('ofPolygons', '(contours, fillRule?)', 'Build a CrossSection from contour polygons.'),
];

const CROSSSECTION_INSTANCE: Completion[] = [
  fn('extrude', '(height, nDivisions?, twistDegrees?, scaleTop?, center?)', 'Extrude this cross-section along Z into a Manifold.'),
  fn('revolve', '(circularSegments?, revolveDegrees?)', 'Revolve this cross-section into a Manifold.'),
  fn('add', '(other)', 'Boolean union with another cross-section.'),
  fn('subtract', '(other)', 'Boolean difference.'),
  fn('intersect', '(other)', 'Boolean intersection.'),
  fn('translate', '([x,y])  |  (x, y)', 'Move in the plane (chainable, lazy).'),
  fn('rotate', '(degrees)', 'Rotate about Z, in degrees.'),
  fn('scale', '([x,y] | n)', 'Scale per-component or uniformly.'),
  fn('mirror', '(axis)', 'Mirror over the given axis vector.'),
  fn('offset', '(delta, joinType?, miterLimit?, circularSegments?)', 'Inflate/deflate contours by delta.'),
  fn('simplify', '(epsilon?)', 'Remove near-collinear vertices (clean up after offset).'),
  fn('hull', '()', 'Convex hull of this cross-section.'),
  fn('decompose', '()', 'Split into disconnected cross-sections.'),
  fn('toPolygons', '()', 'Return the contours as simple polygons.'),
  fn('area', '()', 'Total covered area.'),
  fn('bounds', '()', 'Axis-aligned bounding rectangle.'),
  fn('numVert', '()', 'Vertex count.'),
  fn('numContour', '()', 'Contour count.'),
  fn('isEmpty', '()', 'Whether there are no contours.'),
];

/** Union of instance methods, deduped by label, for `expr.` where the receiver
 *  type is unknown. */
const INSTANCE_ANY: Completion[] = (() => {
  const seen = new Set<string>();
  const out: Completion[] = [];
  for (const c of [...MANIFOLD_INSTANCE, ...CROSSSECTION_INSTANCE]) {
    if (seen.has(c.label)) continue;
    seen.add(c.label);
    out.push(c);
  }
  return out;
})();

const API_MEMBERS: Completion[] = [
  val('Manifold', 'class', 'The Manifold (3D solid) class.', 'class'),
  val('CrossSection', 'class', 'The CrossSection (2D) class.', 'class'),
  val('Curves', 'namespace', 'Helpers for parametric curves / paths.', 'variable'),
  val('imports', 'Mesh[]', 'Imported meshes (e.g. STL) — pass to Manifold.ofMesh(api.imports[i]).', 'variable'),
  fn('label', '(shape, name)', 'Tag a shape so painted regions can target it by name.'),
  fn('labeledUnion', '(parts)', 'Union [{name, shape}, …], tagging each part for later paint-by-label.'),
  fn('setCircularSegments', '(segments)', 'Force the default circle/sphere/cylinder segment count.'),
  fn('setMinCircularAngle', '(angle)', 'Set the minimum angle between circular segments (degrees).'),
  fn('setMinCircularEdgeLength', '(length)', 'Set the minimum circular segment edge length.'),
  fn('renderMesh', '(mesh)', 'Low-level: hand a raw mesh to the renderer.'),
];

const GLOBALS: Completion[] = [
  val('api', 'sandbox', 'The injected sandbox API: { Manifold, CrossSection, Curves, imports, label, … }.', 'variable'),
  val('Manifold', 'class', 'The Manifold (3D solid) class (via api).', 'class'),
  val('CrossSection', 'class', 'The CrossSection (2D) class (via api).', 'class'),
  val('return', 'keyword', 'Your code must return a Manifold.', 'keyword'),
  val('const', 'keyword', 'Declare a constant, e.g. const { Manifold } = api;', 'keyword'),
];

/** CodeMirror completion source for the manifold-js sandbox API. */
function manifoldCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w$]*$/);
  const wordFrom = word ? word.from : context.pos;
  const charBefore = wordFrom > 0 ? context.state.sliceDoc(wordFrom - 1, wordFrom) : '';

  if (charBefore === '.') {
    const line = context.state.doc.lineAt(context.pos);
    const head = context.state.sliceDoc(line.from, wordFrom - 1); // text up to (excl.) the dot
    const objMatch = /([A-Za-z_$][\w$]*)\s*$/.exec(head);
    const obj = objMatch?.[1];
    let options: Completion[];
    if (obj === 'Manifold') options = MANIFOLD_STATIC;
    else if (obj === 'CrossSection') options = CROSSSECTION_STATIC;
    else if (obj === 'api') options = API_MEMBERS;
    else options = INSTANCE_ANY; // unknown receiver or a call result like cube(…).
    return { from: wordFrom, options, validFor: /^[\w$]*$/ };
  }

  // Top-level identifier: suggest globals while typing, or on explicit Ctrl+Space.
  if ((word && word.from < word.to) || context.explicit) {
    return { from: wordFrom, options: GLOBALS, validFor: /^[\w$]*$/ };
  }
  return null;
}

/** Editor extension registering the sandbox-API completions for JavaScript.
 *  Scoped to the JS language, so OpenSCAD sessions are unaffected. */
export const manifoldApiCompletion = javascriptLanguage.data.of({
  autocomplete: manifoldCompletionSource,
});
