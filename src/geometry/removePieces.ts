// The post-run half of `api.removePiece([x, y, z])` / SCAD `remove_piece(...)`:
// drop the separate pieces (connected components) of a finished Manifold that
// touch given points. Shared by the manifold-js and OpenSCAD engines. Points
// rather than indices, so the right piece stays removed when edits elsewhere
// reorder the components.

/** Drop every separate piece (connected component) of `model` that touches one
 *  of `points` — the post-run half of `api.removePiece`. A piece "touches" a
 *  point when a tiny cube centred on it overlaps the piece, so a point taken on
 *  the piece's surface matches it (and only it: pieces are physically apart).
 *  Returns `model` untouched when nothing matches. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withoutPiecesAt(Manifold: any, model: any, points: [number, number, number][]): any {
  const pieces = model.decompose();
  const box = model.boundingBox();
  const diag = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  const e = Math.max(diag * 1e-3, 1e-3);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const touches = (piece: any, p: [number, number, number]): boolean => {
    const b = piece.boundingBox();
    for (let i = 0; i < 3; i++) {
      if (p[i] < b.min[i] - e || p[i] > b.max[i] + e) return false;
    }
    return !piece.intersect(Manifold.cube([e, e, e], true).translate(p)).isEmpty();
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keep = pieces.filter((piece: any) => !points.some(p => touches(piece, p)));
  if (keep.length === pieces.length) return model;
  return keep.length > 0 ? Manifold.compose(keep) : Manifold.union([]);
}
