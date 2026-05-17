// Sculpt stroke types — serializable stroke records that replay over a
// code-generated mesh. Mirrors the descriptor pattern used by paint
// regions (see ../color/regions.ts) so persistence and re-load work the
// same way.

export type BrushKind = 'push' | 'smooth';

export interface StrokePoint {
  x: number;
  y: number;
  z: number;
  /** Surface normal at the hit point. The `push` brush moves vertices
   *  along this direction; `smooth` ignores it but it's still recorded
   *  so future brushes can reuse the orientation. */
  nx: number;
  ny: number;
  nz: number;
}

export interface SerializedStroke {
  id: string;
  brush: BrushKind;
  points: StrokePoint[];
  /** World-space brush radius. Vertices within this distance of each
   *  stroke point feel the brush. */
  radius: number;
  /** 0..1 — falloff multiplier scale. */
  strength: number;
  /** Number of midpoint-subdivision passes applied to the base mesh
   *  before this stroke was recorded. The first stroke on a version
   *  pins the subdivision level for the whole version; all subsequent
   *  strokes share it. Replay applies subdivision before strokes. */
  subdivisionLevel: number;
}
