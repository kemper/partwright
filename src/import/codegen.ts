import type { ImportedMesh } from './importedMesh';

export interface GenerateOptions {
  /** When false, generate code that uses `api.renderMesh()` instead of
   *  `Manifold.ofMesh()` — the mesh renders and exports but boolean ops,
   *  paint, and cross-sections won't work. */
  manifold?: boolean;
}

/** Generate JavaScript source for an imported-mesh session.
 *
 *  The mesh bytes are not embedded in the editor — they live on the Version's
 *  `importedMeshes` array and are exposed to the sandbox as `api.imports[i]`.
 *  This keeps the editor view human-readable and small even for million-triangle
 *  meshes, while still being fully runnable.
 *
 *  Multiple imports are merged with `Manifold.compose(...)` (not `union`) so each
 *  source mesh stays a distinct component, which preserves topology for later
 *  edits. */
export function generateImportCode(imports: ImportedMesh[], options: GenerateOptions = {}): string {
  if (imports.length === 0) return '// No imported meshes.\nreturn null;\n';

  const manifold = options.manifold !== false;
  const date = new Date().toISOString().slice(0, 10);
  const filenames = imports.length === 1
    ? imports[0].filename
    : `${imports.length} meshes:\n${imports.map((m, i) => `//   [${i}] ${m.filename}`).join('\n')}`;

  const header = manifold
    ? `// Imported from ${filenames} on ${date}`
    : `// Imported from ${filenames} on ${date} (render-only — not manifold).
// Replace api.renderMesh(...) with Manifold.ofMesh(...) once the mesh is repaired.`;

  if (!manifold) {
    // Render-only: a single mesh is rendered as-is. Compose() needs real
    // Manifolds so multi-mesh render-only would require unioning at the
    // viewport layer — out of scope for Phase 1; we only emit single-mesh.
    return `${header}
return api.renderMesh(api.imports[0]);
`;
  }

  if (imports.length === 1) {
    return `${header}
const { Manifold } = api;

return Manifold.ofMesh(api.imports[0]);
`;
  }

  const parts = imports
    .map((_, i) => `  Manifold.ofMesh(api.imports[${i}]),`)
    .join('\n');

  return `${header}
const { Manifold } = api;

return Manifold.compose([
${parts}
]);
`;
}
