#!/usr/bin/env node
// Scaffold a new surface-modifier math module.
// Usage: npm run new:modifier -- <camelCaseName>

import { existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

function printUsage() {
  console.error('Usage: npm run new:modifier -- <camelCaseName>');
  console.error('  e.g. npm run new:modifier -- myEffect');
  console.error('');
  console.error('  The name must start with a lowercase letter and contain only');
  console.error('  letters and digits (camelCase, no spaces or hyphens).');
}

const name = process.argv[2];

if (!name) {
  printUsage();
  process.exit(1);
}

// Validate: camelCase — starts with lowercase letter, only letters/digits
if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) {
  console.error(`Error: "${name}" is not a valid camelCase modifier name.`);
  console.error('  Must start with a lowercase letter and contain only letters and digits.');
  console.error('  Examples: myEffect  rippleTexture  woodGrain');
  process.exit(1);
}

// Derive Name (PascalCase) and NAME (UPPER_SNAKE_CASE)
const Name = name.charAt(0).toUpperCase() + name.slice(1);
const NAME = name
  .replace(/([a-z])([A-Z])/g, '$1_$2')
  .toUpperCase();

const outPath = resolve(REPO_ROOT, `src/surface/${name}Surface.ts`);

if (existsSync(outPath)) {
  console.error(`Error: ${outPath} already exists. Remove it first if you want to regenerate.`);
  process.exit(1);
}

const template = `\
// Surface math for the ${Name} modifier.
// Pure logic — no DOM, no WASM imports — so this can be unit-tested directly.

import type { MeshData } from '../geometry/types';

export interface ${Name}Options {
  /** TODO: describe your option */
  intensity: number;
}

export const DEFAULT_${NAME}_OPTIONS: ${Name}Options = {
  intensity: 0.5,
};

/** Apply the ${name} effect to \`mesh\`. Returns a modified mesh. */
export function ${name}Surface(mesh: MeshData, opts: ${Name}Options): MeshData {
  // TODO: implement
  return mesh;
}
`;

writeFileSync(outPath, template, 'utf8');
console.log(`Created src/surface/${name}Surface.ts`);
console.log('');
console.log('Next steps to wire up the modifier:');
console.log(`1. src/surface/modifiers.ts — import ${name}Surface, add apply${Name}() function following applyFuzzySkin() as a pattern, add '${name}' to SurfaceModifierId`);
console.log(`2. src/surface/surfaceOps.ts / surfaceOpSpec.ts — if this modifier is available in-code (api.surface.${name}), add it to the SurfaceOpId union and the options allow-list`);
console.log(`3. src/ui/surfaceModal.ts — add a UI tab for the modifier`);
console.log(`4. src/main.ts — add apply${Name} case to buildSurfaceModifier() and window.partwright.apply${Name}()`);
console.log(`5. src/ai/tools.ts — add tool schema + dispatch + SAVE_GATED entry`);
console.log(`6. public/ai/textures.md — document the new modifier`);
console.log(`7. tests/unit/surface.test.ts — add unit tests for ${name}Surface()`);
console.log(`8. tests/surface-${name}.spec.ts — add golden-path e2e spec`);
