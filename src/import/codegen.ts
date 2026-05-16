import type { ImportedMesh } from './importedMesh';

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
export function generateImportCode(imports: ImportedMesh[]): string {
  if (imports.length === 0) return '// No imported meshes.\nreturn null;\n';

  const date = new Date().toISOString().slice(0, 10);
  const header =
    imports.length === 1
      ? `// Imported from ${imports[0].filename} on ${date}`
      : `// Imported ${imports.length} meshes on ${date}:\n${imports
          .map((m, i) => `//   [${i}] ${m.filename}`)
          .join('\n')}`;

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
