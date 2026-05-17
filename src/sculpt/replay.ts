// Stroke replay — given a base mesh and a list of strokes, produce the
// final sculpted mesh. Subdivision is applied once at the recorded
// level (which is shared across all strokes of a version), then every
// stroke's samples are applied in order.

import type { MeshData } from '../geometry/types';
import type { SerializedStroke } from './types';
import { subdivide } from './subdivide';
import { applyPush, applySmooth, cloneMesh } from './brushes';

/** Replay every stroke in `strokes` over `baseMesh`. Returns a new
 *  mesh; the input is not mutated. If `strokes` is empty, the base mesh
 *  is returned untouched. */
export function replayStrokes(baseMesh: MeshData, strokes: readonly SerializedStroke[]): MeshData {
  if (!strokes || strokes.length === 0) return baseMesh;

  // All strokes share the same subdivision level (it's pinned to the
  // first stroke of the version — see strokes.ts). Apply it once.
  const level = strokes[0].subdivisionLevel;
  let mesh = level > 0 ? subdivide(baseMesh, level) : cloneMesh(baseMesh);

  for (const stroke of strokes) {
    for (const p of stroke.points) {
      if (stroke.brush === 'push') {
        applyPush(
          mesh,
          [p.x, p.y, p.z],
          [p.nx, p.ny, p.nz],
          stroke.radius,
          stroke.strength,
        );
      } else if (stroke.brush === 'smooth') {
        applySmooth(
          mesh,
          [p.x, p.y, p.z],
          stroke.radius,
          stroke.strength,
        );
      }
    }
  }

  return mesh;
}
