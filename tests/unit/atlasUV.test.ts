import { describe, it, expect } from 'vitest';
import { cellForTriangle, cellUVsForTriangle } from '../../src/renderer/atlasUV';

describe('atlas cell parameterization', () => {
  it('assigns distinct, in-bounds cells row-major by triangle index', () => {
    const atlas = 8192, grid = 1024;
    expect(cellForTriangle(0, atlas, grid)).toEqual({ x: 0, y: 0, cell: 8 });
    expect(cellForTriangle(1, atlas, grid)).toEqual({ x: 8, y: 0, cell: 8 });
    expect(cellForTriangle(grid, atlas, grid)).toEqual({ x: 0, y: 8, cell: 8 });
    const last = cellForTriangle(grid * grid - 1, atlas, grid);
    expect(last.x).toBe(atlas - 8);
    expect(last.y).toBe(atlas - 8);
  });

  it('keeps UVs strictly inside the cell (bilinear can never cross cells)', () => {
    const atlas = 8192, grid = 1024;
    for (const t of [0, 7, 1023, 1024, 555555, grid * grid - 1]) {
      const { x, y, cell } = cellForTriangle(t, atlas, grid);
      for (const [u, v] of cellUVsForTriangle(t, atlas, grid)) {
        expect(u).toBeGreaterThan(x / atlas);
        expect(u).toBeLessThan((x + cell) / atlas);
        const vTex = 1 - v; // back to top-down texel space
        expect(vTex).toBeGreaterThan(y / atlas);
        expect(vTex).toBeLessThan((y + cell) / atlas);
      }
    }
  });
});
