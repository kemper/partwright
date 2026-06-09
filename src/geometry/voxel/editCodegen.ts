// Code generation for committing Voxel Studio edits back to the editor.
//
// Two paths, matching the two commit actions:
//   • "Save as raw voxel data" replaces the whole editor with a
//     `voxels.decode(...)` of the final grid (see generateVoxelImportCode in
//     imageToVoxel.ts).
//   • "Update code" keeps the user's procedural source and appends the manual
//     edits as explicit `v.set(...)` / `v.remove(...)` statements before the
//     final `return`, so the code stays human-readable and editable.
//
// Pure logic (no DOM/engine) so it unit-tests in the vitest tier.

import type { VoxelGrid, Surfacing } from './grid';

/** The grid delta between the baseline (the code's own output) and the edited
 *  grid: cells to set (added or recolored) and cells to remove. */
export interface VoxelEditOps {
  /** `[x, y, z, rgb]` for each occupied cell whose color differs from baseline. */
  set: Array<[number, number, number, number]>;
  /** `[x, y, z]` for each baseline cell that no longer exists. */
  remove: Array<[number, number, number]>;
}

/** Compute the edit delta from `before` (the code's output) to `after` (the
 *  studio-edited grid). */
export function diffGrids(before: VoxelGrid, after: VoxelGrid): VoxelEditOps {
  const set: VoxelEditOps['set'] = [];
  const remove: VoxelEditOps['remove'] = [];
  after.forEach((x, y, z, rgb) => {
    if (before.get(x, y, z) !== rgb) set.push([x, y, z, rgb]);
  });
  before.forEach((x, y, z) => {
    if (!after.has(x, y, z)) remove.push([x, y, z]);
  });
  return { set, remove };
}

/** Total number of statements a delta produces. */
export function editOpCount(ops: VoxelEditOps): number {
  return ops.set.length + ops.remove.length;
}

function hex(rgb: number): string {
  return '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');
}

/** Render the delta as `<v>.set(...)` / `<v>.remove(...)` source lines. */
export function formatEditOps(ops: VoxelEditOps, varName: string): string {
  const lines: string[] = [];
  for (const [x, y, z, rgb] of ops.set) lines.push(`${varName}.set(${x}, ${y}, ${z}, '${hex(rgb)}');`);
  for (const [x, y, z] of ops.remove) lines.push(`${varName}.remove(${x}, ${y}, ${z});`);
  return lines.join('\n');
}

/** The chained surfacing method for a grid's setting, as source you append to
 *  the returned-grid expression — e.g. `.smooth({ strength: 0.5, baseLayers: 2 })`
 *  or `.blocky()`. Only non-default options are emitted. For the default blocky
 *  surfacing it returns `''` unless `explicitBlocky` is set (the Voxel Studio
 *  "update code" path passes it so a `.blocky()` deterministically overrides any
 *  `.smooth()` the original code applied). */
export function formatSurfacingCall(surf: Surfacing, explicitBlocky = false): string {
  if (surf.mode !== 'smooth') return explicitBlocky ? '.blocky()' : '';
  const o: string[] = [];
  if (surf.algorithm && surf.algorithm !== 'surfaceNets') o.push(`algorithm: '${surf.algorithm}'`);
  if (surf.iterations !== 2) o.push(`iterations: ${surf.iterations}`);
  if (surf.detail !== undefined && surf.detail !== 1) o.push(`detail: ${surf.detail}`);
  if (surf.strength !== undefined && surf.strength !== 1) o.push(`strength: ${surf.strength}`);
  if (surf.flatBottom) o.push('flatBottom: true');
  if (surf.baseLayers !== undefined) o.push(`baseLayers: ${surf.baseLayers}`);
  if (surf.lockBox) o.push(`lockBox: [[${surf.lockBox.min.join(', ')}], [${surf.lockBox.max.join(', ')}]]`);
  return o.length ? `.smooth({ ${o.join(', ')} })` : '.smooth()';
}

/** Append the edit ops to the user's procedural code, just before its final
 *  `return`. Binds the returned grid to a local so the ops apply to whatever
 *  expression the code returns (a bare `v`, a `voxels().…` chain, etc.), then
 *  returns that local. `surfacingCall` (from {@link formatSurfacingCall}) is
 *  applied to that local after the edits, so Voxel Studio's rounding settings
 *  land as code. Returns null if there's no trailing `return …;` to hook onto
 *  (the caller then falls back to a full replace). A no-op (no edits and no
 *  surfacing change) returns the code unchanged. */
export function appendVoxelEditsToCode(code: string, ops: VoxelEditOps, surfacingCall = ''): string | null {
  const hasEdits = editOpCount(ops) > 0;
  if (!hasEdits && !surfacingCall) return code;
  const trimmed = code.replace(/\s+$/, '');
  // Greedy prefix forces the match onto the LAST `return …;` in the source.
  const m = /^([\s\S]*)\breturn\b([\s\S]*?);\s*$/.exec(trimmed);
  if (!m) return null;
  const prefix = m[1].replace(/\s+$/, '');
  const expr = m[2].trim();
  const VAR = '__voxStudio';
  const editBlock = hasEdits ? `// --- Voxel Studio edits ---\n${formatEditOps(ops, VAR)}\n` : '';
  const surfBlock = surfacingCall ? `${VAR}${surfacingCall};\n` : '';
  return `${prefix}\n\nconst ${VAR} = ${expr};\n${editBlock}${surfBlock}return ${VAR};\n`;
}
