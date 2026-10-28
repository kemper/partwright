// Adding an imported model to an existing JavaScript object as named parts,
// without baking the object's code away.
//
// The object's code is wrapped in an immediately-invoked function and
// composed with the import:
//
//   api.movePart("a", [10, 0, 0]);            // leading edit / removal lines stay on top
//   const __partwrightBase = (() => {
//     …the object's code, unchanged…
//   })();
//   return api.Manifold.compose([__partwrightBase, api.importWithParts(1)]);
//
// A second import extends the compose list instead of nesting another wrapper.
// Leading part-edit and removal lines are hoisted above the wrapper so edits
// added later (which go at the top, src/editor/partOpCode.ts) still run after
// them. Pure string/array helpers so they unit-test in the vitest tier.

import { parsePartOpLine } from '../editor/partOpCode';
import type { ImportedMesh, ImportedMeshParts } from './importedMesh';

const BASE = '__partwrightBase';
const COMPOSE_RE = new RegExp(`^return api\\.Manifold\\.compose\\(\\[${BASE}((?:, api\\.importWithParts\\(\\d+\\))*)\\]\\);\\s*$`);

/** `code` with `api.importWithParts(importIndex)` composed beside what it
 *  returns (see the module comment). */
export function composeImportIntoCode(code: string, importIndex: number): string {
  const call = `api.importWithParts(${importIndex})`;
  const lines = code.replace(/\s+$/, '').split('\n');
  const last = lines.length - 1;
  const m = COMPOSE_RE.exec(lines[last].trim());
  if (m) {
    lines[last] = `return api.Manifold.compose([${BASE}${m[1]}, ${call}]);`;
    return lines.join('\n') + '\n';
  }
  // Keep the header comments, removal lines and part-edit lines on top.
  let i = 0;
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('//')) continue;
    if (/^api\.(removePart|removePiece)\(/.test(t) || parsePartOpLine(t)) continue;
    break;
  }
  while (i > 0 && lines[i - 1].trim() === '') i--;
  const head = lines.slice(0, i);
  const body = lines.slice(i).map(l => (l.trim() === '' ? '' : `  ${l}`));
  return [
    ...head,
    `const ${BASE} = (() => {`,
    ...body,
    '})();',
    `return api.Manifold.compose([${BASE}, ${call}]);`,
    '',
  ].join('\n');
}

/** `mesh`'s parts, renamed where a name is in `taken` ("name 2", "name 3"…);
 *  a mesh without parts becomes one part named `name`. */
export function importAsParts(mesh: ImportedMesh, name: string, taken: Iterable<string>): ImportedMeshParts {
  const used = new Set(taken);
  const unique = (n: string) => {
    if (!used.has(n)) { used.add(n); return n; }
    const stem = n.replace(/ \d+$/, '');
    for (let k = 2; ; k++) {
      const c = `${stem} ${k}`;
      if (!used.has(c)) { used.add(c); return c; }
    }
  };
  const numTri = mesh.triVerts.length / 3;
  if (mesh.parts && mesh.parts.names.length > 0 && mesh.parts.triPart.length === numTri) {
    return { ...mesh.parts, names: mesh.parts.names.map(unique) };
  }
  return { names: [unique(name)], colors: [null], triPart: new Int32Array(numTri) };
}

type Box = { min: [number, number, number]; max: [number, number, number] };

/** The offset that puts `add` beside `base`: just past its +X side (a `gap`
 *  apart), centred on it in Y and on the same floor. */
export function besideOffset(base: Box, add: Box, gap: number): [number, number, number] {
  return [
    base.max[0] + gap - add.min[0],
    (base.min[1] + base.max[1]) / 2 - (add.min[1] + add.max[1]) / 2,
    base.min[2] - add.min[2],
  ];
}

/** The axis-aligned box of a stride-`numProp` vertex array (null when empty). */
export function vertexBox(vertProperties: Float32Array, numProp: number): Box | null {
  const n = Math.floor(vertProperties.length / numProp);
  if (n === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = vertProperties[i * numProp + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/** A copy of `vertProperties` moved by `d` (other properties untouched). */
export function translatedVerts(vertProperties: Float32Array, numProp: number, d: [number, number, number]): Float32Array {
  const out = new Float32Array(vertProperties);
  for (let i = 0; i < out.length; i += numProp) {
    out[i] += d[0];
    out[i + 1] += d[1];
    out[i + 2] += d[2];
  }
  return out;
}
