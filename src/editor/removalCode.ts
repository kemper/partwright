// Code edits behind the object list's part/piece delete (✕). Deleting a part or
// piece doesn't bake the mesh — it writes one line at the top of the code
// (`api.removePart('name')` / `api.removePiece([x, y, z])` in the JS engines,
// `remove_part("name");` / `remove_piece([x, y, z]);` in OpenSCAD), so the model
// stays parametric and the deletion is visible (and undoable) in the source.
// Pure string/array helpers so they unit-test in the vitest tier.

/** The line that deletes the part `name` (`'scad'` for OpenSCAD syntax). */
export function removePartCall(name: string, lang: 'js' | 'scad' = 'js'): string {
  return lang === 'scad' ? `remove_part(${JSON.stringify(name)});` : `api.removePart(${JSON.stringify(name)});`;
}

/** The line that deletes the separate piece touching `point`. */
export function removePieceCall(point: readonly [number, number, number], lang: 'js' | 'scad' = 'js'): string {
  const xyz = `[${point.map(formatCoord).join(', ')}]`;
  return lang === 'scad' ? `remove_piece(${xyz});` : `api.removePiece(${xyz});`;
}

function formatCoord(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  return String(Object.is(r, -0) ? 0 : r);
}

/** Insert `line` near the top of `code` — after any leading comment/blank lines
 *  (so a header comment stays first) but before any statement, because
 *  `api.removePart` must run before the `api.label` it cancels. Returns `code`
 *  unchanged when the exact line is already there. */
export function insertRemovalLine(code: string, line: string): string {
  const lines = code.split('\n');
  if (lines.some(l => l.trim() === line)) return code;
  let i = 0;
  let inBlock = false;
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t === '' || t.startsWith('//')) continue;
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    break;
  }
  lines.splice(i, 0, line);
  return lines.join('\n');
}

/** A point on the surface of a piece, for `api.removePiece`: the centroid of
 *  its largest triangle (a big triangle keeps the point well inside one face,
 *  and the choice is deterministic). Null for an empty triangle list. */
export function pieceAnchorPoint(
  mesh: { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number },
  triangles: Iterable<number>,
): [number, number, number] | null {
  const { vertProperties: vp, triVerts: tv, numProp: np } = mesh;
  let best: [number, number, number] | null = null;
  let bestArea = -1;
  for (const t of triangles) {
    const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, c = tv[t * 3 + 2] * np;
    const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
    const vx = vp[c] - vp[a], vy = vp[c + 1] - vp[a + 1], vz = vp[c + 2] - vp[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const area = cx * cx + cy * cy + cz * cz;
    if (area > bestArea) {
      bestArea = area;
      best = [
        (vp[a] + vp[b] + vp[c]) / 3,
        (vp[a + 1] + vp[b + 1] + vp[c + 1]) / 3,
        (vp[a + 2] + vp[b + 2] + vp[c + 2]) / 3,
      ];
    }
  }
  return best;
}
