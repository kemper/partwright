/**
 * Per-triangle-cell atlas parameterization — the leaf shared by the texture
 * bake (src/color/textureBake.ts) and the viewport's textured render path.
 *
 * Every triangle owns one square cell of the atlas, derived purely from its
 * index: overlap-free by construction, no unwrap, and nothing to persist —
 * UVs are a formula over (triangleIndex, atlasSize, grid). Lives under
 * renderer/ because the viewport must not import feature layers, while
 * feature layers may import the renderer.
 */

/** Atlas cell (texel origin + edge length) for a triangle. */
export function cellForTriangle(t: number, atlasSize: number, grid: number): { x: number; y: number; cell: number } {
  const cell = atlasSize / grid;
  return { x: (t % grid) * cell, y: Math.floor(t / grid) * cell, cell };
}

/** Per-corner UVs for a triangle's cell, inset by ~a texel so bilinear
 *  filtering never crosses into the neighboring cell. V is in three.js
 *  convention (bottom-up). Corner order matches the triangle's vertex
 *  order: A→(0,0), B→(1,0), C→(0,1) in cell space — the same barycentric
 *  frame the bake writes. */
export function cellUVsForTriangle(t: number, atlasSize: number, grid: number): [number, number][] {
  const { x, y, cell } = cellForTriangle(t, atlasSize, grid);
  const inset = 0.75 / atlasSize;
  const u0 = x / atlasSize + inset, v0 = y / atlasSize + inset;
  const u1 = (x + cell) / atlasSize - inset, v1 = (y + cell) / atlasSize - inset;
  return [[u0, 1 - v0], [u1, 1 - v0], [u0, 1 - v1]];
}
